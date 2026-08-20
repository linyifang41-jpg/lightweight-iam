const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');

// 动作 → 复审项状态归一（revoke → revoked / keep → kept）
const statusMap = { keep: 'kept', revoke: 'revoked' };

// 访问复审（Access Certification）：创建复审活动快照 user-role 分配，逐项确认保留/撤销，
// 到期未处理项按 auto_action（keep/revoke）自动处置。

function createCampaign({ name, scopeType, scopeValue, dueDate, autoAction, createdBy }) {
  const db = getDb();
  const id = uuidv4();
  const rows = [];
  const users = [];
  if (scopeType === 'dept') {
    users.push(...db.prepare('SELECT id FROM users WHERE department_id = ? AND status = ?').all(scopeValue, 'active'));
  } else if (scopeType === 'users') {
    const ids = (scopeValue || []).map(String);
    for (const uid of ids) {
      const u = db.prepare('SELECT id FROM users WHERE id = ? AND status = ?').get(uid, 'active');
      if (u) users.push(u);
    }
  }
  for (const u of users) {
    const roles = db.prepare(`
      SELECT r.id AS role_id, r.name AS role_name
      FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND r.name NOT IN ('admin','user')`).all(u.id);
    for (const r of roles) {
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(u.id);
      rows.push({
        id: uuidv4(), certification_id: id, user_id: u.id,
        user_name: user ? user.username : null,
        role_id: r.role_id, role_name: r.role_name, status: 'pending'
      });
    }
  }
  db.prepare(`INSERT INTO certifications (id, name, status, scope_type, scope_value, due_date, auto_action, created_by)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`)
    .run(id, name, scopeType, JSON.stringify(scopeValue), dueDate || null, autoAction || 'revoke', createdBy);
  const ins = db.prepare(`INSERT INTO certification_items
    (id, certification_id, user_id, user_name, role_id, role_name, status) VALUES (?,?,?,?,?,?,?)`);
  for (const r of rows) ins.run(r.id, r.certification_id, r.user_id, r.user_name, r.role_id, r.role_name, r.status);
  return { id, name, status: 'open', scopeType, scopeValue, dueDate, autoAction, itemCount: rows.length };
}

function getStats(certId) {
  const r = getDb().prepare(`SELECT COUNT(*) total,
    SUM(status='pending') pending, SUM(status='kept') kept, SUM(status='revoked') revoked
    FROM certification_items WHERE certification_id = ?`).get(certId);
  return { total: r.total || 0, pending: r.pending || 0, kept: r.kept || 0, revoked: r.revoked || 0 };
}

function toCampaign(row) {
  return {
    id: row.id, name: row.name, status: row.status, scopeType: row.scope_type,
    scopeValue: JSON.parse(row.scope_value || 'null'), dueDate: row.due_date,
    autoAction: row.auto_action, createdBy: row.created_by, createdAt: row.created_at, closedAt: row.closed_at
  };
}

// 惰性到期关闭：due_date 已过且 open → 按 auto_action 处置 pending 后关闭
function autoCloseExpired() {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare("SELECT * FROM certifications WHERE status = 'open' AND due_date IS NOT NULL").all();
  for (const c of rows) {
    if (new Date(c.due_date).getTime() <= now) {
      closeCampaign(c.id, 'system', true);
    }
  }
}

function listCampaigns() {
  autoCloseExpired();
  const rows = getDb().prepare('SELECT * FROM certifications ORDER BY created_at DESC').all();
  return rows.map((r) => ({ ...toCampaign(r), stats: getStats(r.id) }));
}

function getCampaign(id) {
  autoCloseExpired();
  const row = getDb().prepare('SELECT * FROM certifications WHERE id = ?').get(id);
  if (!row) throw new Error('活动不存在');
  const items = getDb().prepare('SELECT * FROM certification_items WHERE certification_id = ? ORDER BY user_name, role_name').all(id);
  return { ...toCampaign(row), stats: getStats(id), items };
}

// 单项决策：keep 保留 / revoke 即时回收 user_roles
function reviewItem(certId, itemId, action, reviewedBy, note) {
  const db = getDb();
  const cert = db.prepare('SELECT * FROM certifications WHERE id = ?').get(certId);
  if (!cert) throw new Error('活动不存在');
  if (cert.status !== 'open') throw new Error('活动已关闭');
  if (!['keep', 'revoke'].includes(action)) throw new Error('无效动作');
  const item = db.prepare('SELECT * FROM certification_items WHERE id = ? AND certification_id = ?').get(itemId, certId);
  if (!item) throw new Error('复审项不存在');
  if (item.status !== 'pending') throw new Error('该项已处置');
  if (action === 'revoke') {
    db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(item.user_id, item.role_id);
  }
  db.prepare('UPDATE certification_items SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, note = ? WHERE id = ?')
    .run(statusMap[action], reviewedBy, note || null, itemId);
  return { itemId, userId: item.user_id, roleId: item.role_id, action };
}

// 关闭活动：pending 项按 auto_action 批量处置
function closeCampaign(certId, closedBy, isAuto = false) {
  const db = getDb();
  const cert = db.prepare('SELECT * FROM certifications WHERE id = ?').get(certId);
  if (!cert) throw new Error('活动不存在');
  if (cert.status !== 'open') throw new Error('活动已关闭');
  const pendings = db.prepare("SELECT * FROM certification_items WHERE certification_id = ? AND status = 'pending'").all(certId);
  const action = cert.auto_action;
  for (const p of pendings) {
    if (action === 'revoke') {
      db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(p.user_id, p.role_id);
    }
    db.prepare('UPDATE certification_items SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(statusMap[action] || action, closedBy, p.id);
  }
  db.prepare('UPDATE certifications SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?').run('closed', certId);
  return { closed: true, auto: isAuto, action, disposed: pendings.length };
}

module.exports = {
  createCampaign,
  listCampaigns,
  getCampaign,
  reviewItem,
  closeCampaign,
  autoCloseExpired
};