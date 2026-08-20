const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const policyService = require('./policy.service');

// 特权账号发现与登记

function toRow(row) {
  return { ...row };
}

function getRecord(id) {
  return getDb().prepare('SELECT * FROM privileged_accounts WHERE id = ?').get(id) || null;
}

function sensitivePerms() {
  return (policyService.getSetting('analytics_sensitive_perms') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

// 用户有效权限（直接角色 + 组继承）
function effectivePermissionNames(userId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT p.name FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    JOIN roles r ON r.id = rp.role_id
    JOIN (
      SELECT role_id FROM user_roles WHERE user_id = ?
      UNION
      SELECT gr.role_id FROM group_roles gr JOIN group_members gm ON gr.group_id = gm.group_id WHERE gm.user_id = ?
    ) ur ON r.id = ur.role_id
  `).all(userId, userId);
  return rows.map(r => r.name);
}

// 自动发现（幂等：同 type+ref 已存在 active 记录则跳过）
function discover() {
  const db = getDb();
  const sensitive = sensitivePerms();
  const added = [];

  const upsert = ({ type, refUserId, refSaId, name, risk, owner }) => {
    if (refUserId) {
      const ex = db.prepare("SELECT id FROM privileged_accounts WHERE account_type = ? AND ref_user_id = ? AND status = 'active'").get(type, refUserId);
      if (ex) return false;
    } else if (refSaId) {
      const ex = db.prepare("SELECT id FROM privileged_accounts WHERE account_type = ? AND ref_sa_id = ? AND status = 'active'").get(type, refSaId);
      if (ex) return false;
    }
    const id = uuidv4();
    db.prepare(`INSERT INTO privileged_accounts (id, account_type, ref_user_id, ref_sa_id, display_name, owner, risk_level, reason, status, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '自动发现', 'active', 'auto', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .run(id, type, refUserId || null, refSaId || null, name || null, owner || null, risk);
    added.push({ id, type, name });
    return true;
  };

  // admin：持有敏感权限的用户
  const users = db.prepare("SELECT id, username FROM users WHERE status = 'active'").all();
  for (const u of users) {
    const perms = effectivePermissionNames(u.id);
    if (perms.some(p => sensitive.includes(p))) {
      upsert({ type: 'admin', refUserId: u.id, name: u.username, risk: 'high' });
    }
  }
  // service：活跃服务账号
  const sas = db.prepare("SELECT id, name, description FROM service_accounts WHERE status = 'active'").all();
  for (const sa of sas) {
    upsert({ type: 'service', refSaId: sa.id, name: sa.name, risk: 'medium', owner: sa.description });
  }
  // shared：user_attributes.shared='1'
  const shared = db.prepare("SELECT ua.user_id, u.username FROM user_attributes ua JOIN users u ON u.id = ua.user_id WHERE ua.attr_key = 'shared' AND ua.attr_value = '1'").all();
  for (const s of shared) {
    upsert({ type: 'shared', refUserId: s.user_id, name: s.username, risk: 'medium' });
  }
  return { addedCount: added.length, added };
}

function list({ type, status, risk } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM privileged_accounts WHERE 1=1';
  const args = [];
  if (type) { sql += ' AND account_type = ?'; args.push(type); }
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (risk) { sql += ' AND risk_level = ?'; args.push(risk); }
  sql += ' ORDER BY created_at DESC';
  const records = db.prepare(sql).all(...args).map(toRow);

  const byType = {};
  const byRisk = {};
  let total = 0, pendingReview = 0, unlinked = 0;
  const all = db.prepare('SELECT * FROM privileged_accounts WHERE status = ?').all('active');
  for (const r of all) {
    total++;
    byType[r.account_type] = (byType[r.account_type] || 0) + 1;
    byRisk[r.risk_level] = (byRisk[r.risk_level] || 0) + 1;
    if (!r.last_review_at) pendingReview++;
    if (!r.credential_id) unlinked++;
  }
  return { records, stats: { total, byType, byRisk, pendingReview, unlinked } };
}

function register({ type, userId, saId, owner, riskLevel, reason, displayName }) {
  const db = getDb();
  if (!['admin', 'service', 'shared'].includes(type)) throw new Error('无效的账号类型');
  if (type === 'admin' && !userId) throw new Error('管理员账号需关联用户');
  if (type === 'service' && !saId) throw new Error('服务账号需关联服务账号');
  if (type === 'admin' || type === 'shared') {
    if (userId) {
      const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
      if (!u) throw new Error('用户不存在');
      const ex = db.prepare("SELECT id FROM privileged_accounts WHERE account_type = ? AND ref_user_id = ? AND status = 'active'").get(type, userId);
      if (ex) throw new Error('该账号已在台账中');
      displayName = displayName || u.username;
    }
  }
  if (type === 'service') {
    const sa = db.prepare('SELECT id, name FROM service_accounts WHERE id = ?').get(saId);
    if (!sa) throw new Error('服务账号不存在');
    displayName = displayName || sa.name;
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO privileged_accounts (id, account_type, ref_user_id, ref_sa_id, display_name, owner, risk_level, reason, status, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'manual', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(id, type, type === 'admin' || type === 'shared' ? (userId || null) : null, type === 'service' ? saId : null, displayName || null, owner || null, riskLevel || 'medium', reason || null);
  return getRecord(id);
}

function retire(id, reason) {
  const db = getDb();
  const r = getRecord(id);
  if (!r) throw new Error('记录不存在');
  if (r.status === 'retired') throw new Error('该账号已退管');
  db.prepare("UPDATE privileged_accounts SET status = 'retired', reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(reason || r.reason, id);
  return getRecord(id);
}

function review(id) {
  const db = getDb();
  const r = getRecord(id);
  if (!r) throw new Error('记录不存在');
  db.prepare('UPDATE privileged_accounts SET last_review_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  return getRecord(id);
}

function linkVault(id, credentialId) {
  const db = getDb();
  const r = getRecord(id);
  if (!r) throw new Error('记录不存在');
  const c = db.prepare('SELECT id FROM credentials WHERE id = ?').get(credentialId);
  if (!c) throw new Error('凭据不存在');
  db.prepare('UPDATE privileged_accounts SET credential_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(credentialId, id);
  return getRecord(id);
}

module.exports = { discover, list, register, retire, review, linkVault, getRecord };