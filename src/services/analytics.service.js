const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const policyService = require('./policy.service');

// 权限分析：策略违规检测（僵尸持权/敏感权限持有/权限聚集） + 角色挖掘（权限共现候选）

function effectiveRoleIds(userId) {
  return adminService.userEffectiveRoleIds(userId);
}

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

function lastLoginAt(userId) {
  const row = getDb().prepare("SELECT MAX(created_at) AS at FROM audit_logs WHERE user_id = ? AND action = 'auth.login'").get(userId);
  return row && row.at ? row.at : null;
}

// 违规检测
function detectViolations() {
  const db = getDb();
  const inactiveDays = policyService.getInt('analytics_inactive_days', 90);
  const threshold = policyService.getInt('analytics_perm_threshold', 15);
  const sensitive = (policyService.getSetting('analytics_sensitive_perms') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const users = db.prepare("SELECT id, username, status FROM users WHERE status = 'active'").all();
  const violations = [];
  const now = Date.now();

  for (const u of users) {
    const roles = effectiveRoleIds(u.id);
    const perms = effectivePermissionNames(u.id);
    if (roles.length === 0 && perms.length === 0) continue;

    // 僵尸持权：有授权但很久未登录/从未登录
    const last = lastLoginAt(u.id);
    const never = last === null;
    const stale = !never && (now - new Date(last).getTime()) > inactiveDays * 86400 * 1000;
    if (never || stale) {
      violations.push({
        type: 'zombie_access',
        severity: 'high',
        userId: u.id,
        username: u.username,
        roles,
        perms,
        lastLogin: last,
        suggestion: '账号长期未登录仍持有权限，建议回收或暂停'
      });
    }

    // 敏感权限持有
    const hits = perms.filter(p => sensitive.includes(p));
    if (hits.length > 0) {
      violations.push({
        type: 'high_risk_perm',
        severity: 'high',
        userId: u.id,
        username: u.username,
        roles,
        perms: hits,
        suggestion: '持有高风险敏感权限，建议按最小权限复审'
      });
    }

    // 权限聚集
    if (perms.length > threshold) {
      violations.push({
        type: 'privilege_concentration',
        severity: 'medium',
        userId: u.id,
        username: u.username,
        roles,
        permCount: perms.length,
        suggestion: `有效权限数 ${perms.length} 超过阈值 ${threshold}，建议检查过度授权`
      });
    }
  }

  const bySeverity = { high: 0, medium: 0, low: 0 };
  for (const v of violations) bySeverity[v.severity] = (bySeverity[v.severity] || 0) + 1;
  return { total: violations.length, bySeverity, violations };
}

// 角色挖掘：权限共现候选（组合覆盖用户数 >= minSupport，去重已存在角色）
function roleMining(minSupport) {
  const db = getDb();
  const support = Math.max(1, parseInt(minSupport, 10) || policyService.getInt('analytics_min_support', 2));
  const users = db.prepare("SELECT id FROM users WHERE status = 'active'").all();
  const userPerms = new Map();
  for (const u of users) {
    const perms = effectivePermissionNames(u.id);
    if (perms.length >= 2) userPerms.set(u.id, new Set(perms));
  }

  const cooccur = new Map(); // key: sorted perm pair → { perms, users:Set }
  for (const [uid, set] of userPerms) {
    const arr = [...set].sort();
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]}||${arr[j]}`;
        if (!cooccur.has(key)) cooccur.set(key, { perms: [arr[i], arr[j]], users: new Set() });
        cooccur.get(key).users.add(uid);
      }
    }
  }

  // 已存在角色权限集，用于去重
  const existing = db.prepare(`
    SELECT r.name, GROUP_CONCAT(p.name, ',') AS perms FROM roles r
    JOIN role_permissions rp ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id
  `).all();
  const existingSets = existing.map(e => new Set((e.perms || '').split(',').filter(Boolean)));

  const candidates = [];
  for (const { perms, users: covered } of cooccur.values()) {
    if (covered.size < support) continue;
    const permSet = new Set(perms);
    if (existingSets.some(es => es.size === permSet.size && [...permSet].every(p => es.has(p)))) continue;
    candidates.push({
      permissions: perms,
      support: covered.size,
      coveredUsers: [...covered]
    });
  }
  candidates.sort((a, b) => b.support - a.support);
  return { minSupport: support, candidates: candidates.slice(0, 20) };
}

// 候选落库：建角色 + 可选分配用户（permissionNames 解析为 id）
function promoteRole({ name, permissionNames, userIds }) {
  const db = getDb();
  if (!name || !name.trim()) throw new Error('角色名称必填');
  const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(name);
  if (role) throw new Error('角色已存在');
  const permIds = (permissionNames || []).map(pn => {
    const p = db.prepare('SELECT id FROM permissions WHERE name = ?').get(pn);
    return p ? p.id : null;
  }).filter(Boolean);
  const rid = uuidv4();
  db.prepare('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)').run(rid, name, '由权限分析角色挖掘落地');
  for (const pid of permIds) {
    db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(rid, pid);
  }
  for (const uid of userIds || []) {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(uid);
    if (u) db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(uid, rid);
  }
  return { id: rid, name, permissionCount: permIds.length, userCount: (userIds || []).length };
}

module.exports = { detectViolations, roleMining, promoteRole, effectivePermissionNames };