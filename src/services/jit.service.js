const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const policyService = require('./policy.service');
const auditService = require('./audit.service');

// 即时访问（JIT）：按需限时提权，到期自动回收
// 状态机：pending → active（审批通过）→ expired（到期）/ revoked（主动撤销）；pending → rejected

function toGrant(row) {
  return {
    ...row,
    expiresAt: row.expires_at,
    grantedAt: row.granted_at,
    decidedAt: row.decided_at,
    createdAt: row.created_at
  };
}

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

// 惰性到期：active 且已过 expires_at → 回收角色 + 置 expired
function removeRoleIfNoOtherActiveGrant(g, excludeId) {
  const other = getDb().prepare(`
    SELECT COUNT(*) AS c FROM temporary_grants
    WHERE user_id = ? AND role_id = ? AND status = 'active' AND id != ?
  `).get(g.user_id, g.role_id, excludeId || '');
  return other.c === 0;
}

function expireOverdue() {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare("SELECT * FROM temporary_grants WHERE status = 'active' AND expires_at IS NOT NULL").all();
  for (const g of rows) {
    if (new Date(g.expires_at).getTime() <= now) {
      if (removeRoleIfNoOtherActiveGrant(g, g.id)) {
        db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(g.user_id, g.role_id);
      }
      db.prepare("UPDATE temporary_grants SET status = 'expired', decided_at = ? WHERE id = ?").run(new Date().toISOString(), g.id);
      const u = db.prepare('SELECT username FROM users WHERE id = ?').get(g.user_id);
      auditService.log({ userId: g.user_id, username: u ? u.username : g.user_id, action: 'jit.expire', ip: null, detail: { id: g.id, userId: g.user_id, roleId: g.role_id, minutes: g.duration_minutes } });
    }
  }
  return rows.length;
}

// 用户自助申请临时提权
function requestGrant({ userId, roleId, reason, durationMinutes }) {
  const db = getDb();
  if (policyService.getSetting('jit_enabled') !== '1') throw new Error('JIT 即时访问已停用');
  const user = db.prepare('SELECT id, status FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('用户不存在');
  if (user.status !== 'active') throw new Error('账号状态异常');
  const role = db.prepare('SELECT id, name FROM roles WHERE id = ?').get(roleId);
  if (!role) throw new Error('角色不存在');
  const maxMin = policyService.getInt('jit_max_minutes', 480);
  const dur = parseInt(durationMinutes, 10);
  if (Number.isNaN(dur) || dur < 1) throw new Error('时长无效');
  if (dur > maxMin) throw new Error(`单次提权时长不得超过 ${maxMin} 分钟`);
  const combined = [...new Set([...effectiveRoleIds(userId), roleId])];
  adminService.checkSoD('role', combined);

  const id = uuidv4();
  db.prepare(`INSERT INTO temporary_grants (id, user_id, role_id, reason, duration_minutes, status, requested_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)`)
    .run(id, userId, roleId, reason || null, dur, userId);
  return toGrant(db.prepare('SELECT * FROM temporary_grants WHERE id = ?').get(id));
}

function getGrant(id) {
  const row = getDb().prepare('SELECT * FROM temporary_grants WHERE id = ?').get(id);
  return row ? toGrant(row) : null;
}

// 列表（先惰性回收）
function listGrants(status) {
  expireOverdue();
  let rows;
  if (status) {
    rows = getDb().prepare('SELECT * FROM temporary_grants WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = getDb().prepare('SELECT * FROM temporary_grants ORDER BY created_at DESC').all();
  }
  return rows.map(toGrant);
}

// 用户自己的提权（含活跃中）
function myGrants(userId) {
  expireOverdue();
  return getDb().prepare('SELECT * FROM temporary_grants WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(toGrant);
}

function approveGrant(id, approverId, approverName) {
  const db = getDb();
  const g = getGrant(id);
  if (!g) throw new Error('提权单不存在');
  if (g.status !== 'pending') throw new Error('该提权单已处理');
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(g.user_id, g.role_id);
  const expiresAt = new Date(Date.now() + g.duration_minutes * 60 * 1000).toISOString();
  db.prepare("UPDATE temporary_grants SET status = 'active', granted_by = ?, granted_at = CURRENT_TIMESTAMP, expires_at = ?, decided_at = ? WHERE id = ?")
    .run(approverName, expiresAt, new Date().toISOString(), id);
  return getGrant(id);
}

function rejectGrant(id, approverName) {
  const g = getGrant(id);
  if (!g) throw new Error('提权单不存在');
  if (g.status !== 'pending') throw new Error('该提权单已处理');
  getDb().prepare("UPDATE temporary_grants SET status = 'rejected', granted_by = ?, decided_at = ? WHERE id = ?")
    .run(approverName, new Date().toISOString(), id);
  return getGrant(id);
}

function revokeGrant(id, approverName) {
  const db = getDb();
  const g = getGrant(id);
  if (!g) throw new Error('提权单不存在');
  if (g.status !== 'active') throw new Error('仅可撤销生效中的提权');
  if (removeRoleIfNoOtherActiveGrant(g, id)) {
    db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(g.user_id, g.role_id);
  }
  db.prepare("UPDATE temporary_grants SET status = 'revoked', granted_by = ?, decided_at = ? WHERE id = ?")
    .run(approverName, new Date().toISOString(), id);
  return getGrant(id);
}

module.exports = { requestGrant, getGrant, listGrants, myGrants, approveGrant, rejectGrant, revokeGrant, expireOverdue };