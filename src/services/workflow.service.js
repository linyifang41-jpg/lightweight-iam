const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');

// 通用工作流引擎：定义（approval/condition/action 节点）→ 实例 → 待办任务
// 状态机：running → completed（全节点走完）/ terminated（审批拒绝）

// ===== 定义管理 =====

function createWorkflow({ name, type, definition, active }) {
  if (!name || !type) throw new Error('名称与类型必填');
  if (!Array.isArray(definition?.nodes) || definition.nodes.length === 0) throw new Error('节点列表不能为空');
  const id = uuidv4();
  getDb().prepare('INSERT INTO workflows (id, name, type, definition, active) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, type, JSON.stringify(definition), active ? 1 : 0);
  return getWorkflow(id);
}

function getWorkflow(id) {
  const row = getDb().prepare('SELECT * FROM workflows WHERE id = ?').get(id);
  return row ? { ...row, definition: JSON.parse(row.definition) } : null;
}

function listWorkflows() {
  return getDb().prepare('SELECT * FROM workflows ORDER BY created_at DESC').all().map(r => ({ ...r, definition: JSON.parse(r.definition) }));
}

function setActive(id, active) {
  const row = getDb().prepare('SELECT id FROM workflows WHERE id = ?').get(id);
  if (!row) throw new Error('工作流不存在');
  getDb().prepare('UPDATE workflows SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  return { success: true };
}

function deleteWorkflow(id) {
  const row = getDb().prepare('SELECT id FROM workflows WHERE id = ?').get(id);
  if (!row) throw new Error('工作流不存在');
  getDb().prepare('DELETE FROM workflows WHERE id = ?').run(id);
  return { success: true };
}

// ===== 实例与流转 =====

function getInstance(id) {
  return getDb().prepare('SELECT * FROM workflow_instances WHERE id = ?').get(id);
}

function findWorkflowFor(type) {
  return getDb().prepare('SELECT * FROM workflows WHERE type = ? AND active = 1 ORDER BY created_at ASC').get(type);
}

function startInstance({ type, entityId, data, onComplete, onReject, onAction }) {
  const wf = findWorkflowFor(type);
  if (!wf) throw new Error(`没有该类型的启用工作流（${type}）`);
  const instance = {
    id: uuidv4(), workflow_id: wf.id, entity_type: type, entity_id: entityId,
    current_index: 0, status: 'running', data: JSON.stringify(data || {})
  };
  getDb().prepare(`INSERT INTO workflow_instances (id, workflow_id, entity_type, entity_id, current_index, status, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(instance.id, instance.workflow_id, instance.entity_type, instance.entity_id, instance.current_index, instance.status, instance.data);
  advance(instance.id, { onComplete, onReject, onAction });
  return getInstance(instance.id);
}

// 状态上下文：实例在首次停顿时需记录回调，运行时每次以 db 里存的状态为准。
// 业务回调由调用方传入；此处通过附加在实例上的当前任务无法持久化闭包，因此把回调存进内存 Map。
const CALLBACKS = new Map();

function attachCallbacks(instanceId, cbs) {
  CALLBACKS.set(instanceId, cbs || {});
}

function getCallbacks(instanceId) {
  return CALLBACKS.get(instanceId) || {};
}

// 从 current_index 开始推进；遇 approval 生成待办即停；遇 action 执行回调继续；遇 condition 跳转；越界即 complete
function advance(instanceId, cbs) {
  const inst = getInstance(instanceId);
  if (!inst) throw new Error('实例不存在');
  if (inst.status !== 'running') throw new Error('实例已结束');
  if (cbs) attachCallbacks(instanceId, cbs);
  const callbacks = getCallbacks(instanceId);
  const wf = getWorkflow(inst.workflow_id);
  const data = JSON.parse(inst.data || '{}');
  let idx = inst.current_index;
  const nodes = wf.definition.nodes;
  const guard = nodes.length * 2 + 1;
  let step = 0;

  while (step++ < guard) {
    if (idx >= nodes.length) break;
    const node = nodes[idx];
    if (!node) break;
    if (node.type === 'approval') {
      createTask(instanceId, idx, node);
      return { state: 'awaiting', index: idx };
    }
    if (node.type === 'condition') {
      const go = evalCondition(node, data);
      const next = go ? node.trueNext : node.falseNext;
      if (next === null || next === undefined) { idx += 1; } else { idx = Number(next); }
      continue;
    }
    if (node.type === 'action') {
      let result = null;
      if (callbacks.onAction) {
        result = callbacks.onAction(node.action, node.params, data, inst.entity_id);
        if (result && typeof result === 'object') Object.assign(data, result);
      }
      idx += 1;
      continue;
    }
    idx += 1;
  }

  getDb().prepare("UPDATE workflow_instances SET status = 'completed', current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(nodes.length, instanceId);
  if (callbacks.onComplete) callbacks.onComplete(instanceId, data, inst.entity_id);
  CALLBACKS.delete(instanceId);
  return { state: 'completed' };
}

function evalCondition(node, data) {
  const val = data[node.field];
  switch (node.op) {
    case 'eq': return String(val) === String(node.value);
    case 'in': return Array.isArray(node.value) && node.value.includes(String(val));
    case 'gt': return Number(val) > Number(node.value);
    case 'lt': return Number(val) < Number(node.value);
    case 'true': return !!val;
    case 'empty': return val === null || val === undefined || val === '';
    default: return true;
  }
}

function createTask(instanceId, nodeIndex, node) {
  const t = { id: uuidv4(), instance_id: instanceId, node_index: nodeIndex, node_name: node.name || null };
  if (node.approver && node.approver.type === 'user') {
    t.assignee_type = 'user';
    t.assignee_id = node.approver.id;
  } else {
    t.assignee_type = 'role';
    t.assignee_id = (node.approver && node.approver.id) || '';
  }
  getDb().prepare(`INSERT INTO workflow_tasks (id, instance_id, node_index, node_name, assignee_type, assignee_id, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')`)
    .run(t.id, t.instance_id, t.node_index, t.node_name, t.assignee_type, t.assignee_id);
  return t;
}

// 待办任务（可按 assignee 过滤）
function listTasks({ assigneeType, assigneeId, status } = {}) {
  const conds = [];
  const args = [];
  if (assigneeType) { conds.push('assignee_type = ?'); args.push(assigneeType); }
  if (assigneeId) { conds.push('assignee_id = ?'); args.push(assigneeId); }
  if (status) { conds.push('status = ?'); args.push(status); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM workflow_tasks ${where} ORDER BY created_at DESC`).all(...args);
}

// 判断决策者是否有权处理该任务
function canDecide(task, user) {
  if (!user) return false;
  if (task.assignee_type === 'user') return task.assignee_id === user.id;
  if (task.assignee_id === '') return false;
  const perm = getDb().prepare(`SELECT 1 FROM role_permissions rp
    JOIN user_roles ur ON ur.role_id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = ? AND p.name = 'approval:manage' LIMIT 1`).get(user.id);
  if (perm) return true;
  const hasRole = getDb().prepare('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? LIMIT 1').get(user.id, task.assignee_id);
  return !!hasRole;
}

// 审批决策：approved → 推进；rejected → 终止并回调 onReject
function decide(instanceId, taskId, decision, user, note) {
  const db = getDb();
  if (!['approved', 'rejected'].includes(decision)) throw new Error('无效决策');
  const task = db.prepare('SELECT * FROM workflow_tasks WHERE id = ? AND instance_id = ?').get(taskId, instanceId);
  if (!task) throw new Error('任务不存在');
  if (task.status !== 'pending') throw new Error('该任务已处理');
  const inst = getInstance(instanceId);
  if (!inst || inst.status !== 'running') throw new Error('实例已结束');
  if (!canDecide(task, user)) throw new Error('无权处理该任务');

  db.prepare('UPDATE workflow_tasks SET status = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP, note = ? WHERE id = ?')
    .run(decision, user.username, note || null, taskId);
  if (decision === 'rejected') {
    db.prepare("UPDATE workflow_instances SET status = 'terminated', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(instanceId);
    const callbacks = getCallbacks(instanceId);
    const data = JSON.parse(inst.data || '{}');
    if (callbacks.onReject) callbacks.onReject(instanceId, data, inst.entity_id, note, task.node_index);
    CALLBACKS.delete(instanceId);
    return { instanceStatus: 'terminated' };
  }
  db.prepare('UPDATE workflow_instances SET current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(task.node_index + 1, instanceId);
  return advance(instanceId);
}

// 实例列表（含任务）
function listInstances(entityType) {
  let rows;
  if (entityType) {
    rows = getDb().prepare('SELECT * FROM workflow_instances WHERE entity_type = ? ORDER BY created_at DESC').all(entityType);
  } else {
    rows = getDb().prepare('SELECT * FROM workflow_instances ORDER BY created_at DESC').all();
  }
  return rows.map(r => ({
    ...r, data: JSON.parse(r.data || '{}'),
    tasks: getDb().prepare('SELECT * FROM workflow_tasks WHERE instance_id = ? ORDER BY node_index').all(r.id)
  }));
}

module.exports = {
  createWorkflow, getWorkflow, listWorkflows, setActive, deleteWorkflow,
  startInstance, advance, decide, listTasks, listInstances, getInstance, canDecide
};