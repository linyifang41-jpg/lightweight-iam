const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const policyService = require('./policy.service');
const workflowService = require('./workflow.service');

// 访问请求与审批流（IGA）：自助申请 → 逐级审批 → 自动赋权
// 多级审批：approval_levels 来自 settings（默认 1），同一审批人不可重复审批

const VALID_STATUSES = ['pending', 'approved', 'rejected'];

// 申请者当前有效角色 id（直接 + 组继承）
function effectiveRoleIds(userId) {
  const rows = getDb().prepare(`
    SELECT r.id FROM roles r
    JOIN user_roles ur ON r.id = ur.role_id
    WHERE ur.user_id = ?
    UNION
    SELECT r.id FROM roles r
    JOIN group_roles gr ON r.id = gr.role_id
    JOIN group_members gm ON gr.group_id = gm.group_id
    WHERE gm.user_id = ?
  `).all(userId, userId);
  return rows.map(r => r.id);
}

function enrichRequest(req) {
  const db = getDb();
  const requester = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user_id);
  const roleIds = JSON.parse(req.role_ids || '[]');
  const roles = roleIds.map(id => (db.prepare('SELECT id, name FROM roles WHERE id = ?').get(id) || { name: id }));
  return {
    ...req,
    username: requester ? requester.username : req.user_id,
    role_ids: roleIds,
    roles,
    approved_by: JSON.parse(req.approved_by || '[]')
  };
}

function getRequest(id) {
  const req = getDb().prepare('SELECT * FROM access_requests WHERE id = ?').get(id);
  return req ? enrichRequest(req) : null;
}

// 用户自助提交访问请求
function submitRequest({ userId, roleIds, reason }) {
  const db = getDb();
  if (!Array.isArray(roleIds) || !roleIds.length) throw new Error('请至少申请一个角色');
  if (new Set(roleIds).size !== roleIds.length) throw new Error('申请角色不能重复');
  const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (user.status !== 'active') throw new Error('账号状态异常，无法申请权限');

  const owned = new Set(effectiveRoleIds(userId));
  for (const rid of roleIds) {
    if (!db.prepare('SELECT id FROM roles WHERE id = ?').get(rid)) throw new Error('角色不存在');
    if (owned.has(rid)) throw new Error('所选角色已拥有，无需申请');
  }

  const levels = policyService.getInt('approval_levels', 1);
  const id = uuidv4();
  db.prepare('INSERT INTO access_requests (id, user_id, role_ids, reason, status, approval_levels, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, JSON.stringify(roleIds), reason || null, 'pending', levels, '[]', new Date().toISOString());

  // 工作流引擎开启时：启动 access_request 工作流实例
  if (policyService.getSetting('workflow_engine_enabled') === '1') {
    const callbacks = {
      onAction: (action, params, data) => {
        if (action === 'grant_role') {
          adminService.assignRole(userId, params.roleId || roleIds[0]);
        }
        return {};
      },
      onComplete: (instanceId, data, requestId) => {
        try {
          const combined = [...new Set([...effectiveRoleIds(userId), ...roleIds])];
          adminService.checkSoD('role', combined);
        } catch (e) {
          db.prepare("UPDATE access_requests SET status = 'rejected', note = ?, decided_at = ? WHERE id = ?")
            .run(`自动拒绝：${e.message}`, new Date().toISOString(), requestId);
          return;
        }
        for (const rid of roleIds) adminService.assignRole(userId, rid);
        db.prepare("UPDATE access_requests SET status = 'approved', note = ?, decided_at = ? WHERE id = ?")
          .run('工作流审批通过', new Date().toISOString(), requestId);
      },
      onReject: (instanceId, data, requestId, note) => {
        db.prepare("UPDATE access_requests SET status = 'rejected', note = ?, decided_at = ? WHERE id = ?")
          .run(note || '工作流审批拒绝', new Date().toISOString(), requestId);
      }
    };
    workflowService.startInstance({ type: 'access_request', entityId: id, data: { userId, roleIds, reason }, ...callbacks });
  }
  return getRequest(id);
}

// 审批：批准一级。达到级数后自动赋权（SoD 预检，冲突自动拒绝）
function approveRequest(requestId, approverId, note) {
  const db = getDb();
  const req = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(requestId);
  if (!req) throw new Error('请求不存在');
  if (req.status !== 'pending') throw new Error('该请求已结束，无法审批');

  // 工作流引擎开启时：委托引擎对当前待办决策
  if (policyService.getSetting('workflow_engine_enabled') === '1') {
    const inst = db.prepare("SELECT * FROM workflow_instances WHERE entity_type = 'access_request' AND entity_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1").get(requestId);
    if (!inst) throw new Error('未找到运行中的工作流实例');
    const task = db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending' ORDER BY node_index LIMIT 1").get(inst.id);
    if (!task) throw new Error('没有待处理任务');
    const approver = db.prepare('SELECT id, username FROM users WHERE id = ?').get(approverId);
    workflowService.decide(inst.id, task.id, 'approved', approver, note);
    return getRequest(requestId);
  }

  const approvedBy = JSON.parse(req.approved_by || '[]');
  if (approvedBy.includes(approverId)) throw new Error('您已审批过该请求');

  approvedBy.push(approverId);
  const count = approvedBy.length;
  const roleIds = JSON.parse(req.role_ids || '[]');
  const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(req.user_id);
  if (!user) throw new Error('申请者不存在');
  if (user.status !== 'active') {
    db.prepare("UPDATE access_requests SET status = 'rejected', note = ?, decided_at = ?, decided_by = ? WHERE id = ?")
      .run('申请者账号非激活，自动拒绝', new Date().toISOString(), approverId, requestId);
    return getRequest(requestId);
  }

  if (count >= req.approval_levels) {
    // 自动赋权：先 SoD 预检，再逐个分配
    const combined = [...new Set([...effectiveRoleIds(req.user_id), ...roleIds])];
    try {
      adminService.checkSoD('role', combined);
    } catch (e) {
      db.prepare("UPDATE access_requests SET status = 'rejected', approvals_count = ?, approved_by = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?")
        .run(count, JSON.stringify(approvedBy), `自动拒绝：${e.message}`, new Date().toISOString(), approverId, requestId);
      return getRequest(requestId);
    }
    for (const rid of roleIds) {
      adminService.assignRole(req.user_id, rid);
    }
    db.prepare("UPDATE access_requests SET status = 'approved', approvals_count = ?, approved_by = ?, note = ?, decided_at = ?, decided_by = ? WHERE id = ?")
      .run(count, JSON.stringify(approvedBy), note || null, new Date().toISOString(), approverId, requestId);
  } else {
    db.prepare('UPDATE access_requests SET approvals_count = ?, approved_by = ? WHERE id = ?')
      .run(count, JSON.stringify(approvedBy), requestId);
  }
  return getRequest(requestId);
}

// 拒绝
function rejectRequest(requestId, approverId, note) {
  const db = getDb();
  const req = db.prepare('SELECT id, status FROM access_requests WHERE id = ?').get(requestId);
  if (!req) throw new Error('请求不存在');
  if (req.status !== 'pending') throw new Error('该请求已结束，无法审批');

  if (policyService.getSetting('workflow_engine_enabled') === '1') {
    const inst = db.prepare("SELECT * FROM workflow_instances WHERE entity_type = 'access_request' AND entity_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1").get(requestId);
    if (!inst) throw new Error('未找到运行中的工作流实例');
    const task = db.prepare("SELECT * FROM workflow_tasks WHERE instance_id = ? AND status = 'pending' ORDER BY node_index LIMIT 1").get(inst.id);
    if (!task) throw new Error('没有待处理任务');
    const approver = db.prepare('SELECT id, username FROM users WHERE id = ?').get(approverId);
    workflowService.decide(inst.id, task.id, 'rejected', approver, note);
    return getRequest(requestId);
  }

  db.prepare("UPDATE access_requests SET status = 'rejected', note = ?, decided_at = ?, decided_by = ? WHERE id = ?")
    .run(note || null, new Date().toISOString(), approverId, requestId);
  return getRequest(requestId);
}

// 审批视角列表（可按状态过滤）
function listRequests(status) {
  let rows;
  if (status && VALID_STATUSES.includes(status)) {
    rows = getDb().prepare('SELECT * FROM access_requests WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = getDb().prepare('SELECT * FROM access_requests ORDER BY created_at DESC').all();
  }
  return rows.map(enrichRequest);
}

// 用户自助查询自己的请求
function listUserRequests(userId) {
  return getDb().prepare('SELECT * FROM access_requests WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(enrichRequest);
}

module.exports = { submitRequest, approveRequest, rejectRequest, listRequests, listUserRequests, getRequest };