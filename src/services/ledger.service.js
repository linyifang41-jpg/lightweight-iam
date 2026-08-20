const { getDb } = require('../models/database');

// 权限审计台账服务（IGA Access Ledger）：全量"用户-角色-权限"视图，含来源标记

class LedgerService {
  // 聚合每个用户的角色（含来源）与权限（去重并集）
  getLedger(query = '') {
    const db = getDb();
    const users = db.prepare('SELECT id, username, status, department_id FROM users ORDER BY username').all();

    const directRoles = db.prepare(`
      SELECT ur.user_id AS user_id, r.id AS role_id, r.name AS role_name, '直接' AS source
      FROM user_roles ur JOIN roles r ON ur.role_id = r.id
    `).all();

    const inheritedRoles = db.prepare(`
      SELECT gm.user_id AS user_id, r.id AS role_id, r.name AS role_name, '组:' || g.name AS source
      FROM group_members gm
      JOIN group_roles gr ON gm.group_id = gr.group_id
      JOIN roles r ON gr.role_id = r.id
      JOIN groups g ON gm.group_id = g.id
    `).all();

    const rolePerms = db.prepare(`
      SELECT rp.role_id AS role_id, p.name AS permission
      FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id
    `).all();
    const permsByRole = {};
    for (const rp of rolePerms) {
      (permsByRole[rp.role_id] = permsByRole[rp.role_id] || new Set()).add(rp.permission);
    }

    const q = (query || '').trim().toLowerCase();
    const rows = [];
    for (const u of users) {
      if (q && !u.username.toLowerCase().includes(q)) continue;
      const roles = [];
      const permSet = new Set();
      for (const r of directRoles) {
        if (r.user_id !== u.id) continue;
        roles.push({ id: r.role_id, name: r.role_name, source: r.source });
        (permsByRole[r.role_id] || []).forEach(p => permSet.add(p));
      }
      for (const r of inheritedRoles) {
        if (r.user_id !== u.id) continue;
        roles.push({ id: r.role_id, name: r.role_name, source: r.source });
        (permsByRole[r.role_id] || []).forEach(p => permSet.add(p));
      }
      rows.push({
        userId: u.id,
        username: u.username,
        status: u.status,
        roles,
        permissions: [...permSet].sort()
      });
    }
    return rows;
  }

  exportLedgerCSV(query = '') {
    const rows = this.getLedger(query);
    const lines = ['用户,角色(来源),权限'];
    for (const r of rows) {
      const roles = r.roles.map(x => `${x.name}(${x.source})`).join(' | ');
      lines.push([r.username, roles, r.permissions.join(' | ')].map(csvEscape).join(','));
    }
    return lines.join('\n');
  }
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return `"${s.replace(/"/g, '""')}"`;
}

module.exports = new LedgerService();