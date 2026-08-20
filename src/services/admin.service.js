const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { getDb } = require('../models/database');
const userService = require('./user.service');
const tokenService = require('./token.service');
const sessionService = require('./session.service');
const policyService = require('./policy.service');
const { isValidEmail, isValidPhone, isValidPassword } = require('./user.service');

const VALID_STATUSES = ['active', 'disabled', 'archived'];

// 管理服务：用户/角色/权限/会话/群组/部门/安全策略（RBAC）
class AdminService {
  listUsers() {
    const users = getDb().prepare(
      'SELECT id, username, email, phone, status, department_id, realm, account_expires_at, created_at FROM users ORDER BY created_at DESC'
    ).all();
    for (const u of users) {
      u.roles = getDb().prepare(`
        SELECT r.id, r.name FROM roles r
        JOIN user_roles ur ON r.id = ur.role_id
        WHERE ur.user_id = ?
      `).all(u.id);
      u.department = u.department_id ? getDb().prepare('SELECT id, name FROM departments WHERE id = ?').get(u.department_id) : null;
    }
    return users;
  }

  setUserStatus(userId, status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error('无效的状态值');
    }
    const result = getDb().prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
    if (result.changes === 0) {
      throw new Error('用户不存在');
    }
    // 禁用/归档时吊销其全部会话与 token
    if (status !== 'active') {
      tokenService.revokeAllForUser(userId);
      const jtis = sessionService.revokeAllForUser(userId, 'admin_status_change');
      tokenService.revokeJtis(jtis);
    }
    return { success: true };
  }

  deleteUser(userId) {
    const db = getDb();
    const user = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    if (user.username === 'admin') throw new Error('不能删除内置管理员账号');
    // 清理关联数据
    tokenService.revokeAllForUser(userId);
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM group_members WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM password_history WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return { success: true, username: user.username };
  }

  createUserByAdmin({ username, email, phone, password, realm }) {
    if (email && !isValidEmail(email)) throw new Error('邮箱格式不正确');
    if (phone && !isValidPhone(phone)) throw new Error('电话格式不正确');
    const pwdCheck = policyService.validatePassword(password);
    if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
    const r = userService.normalizeRealm(realm);
    if (r === null) throw new Error('租户名称不合法');
    const existing = getDb().prepare('SELECT id FROM users WHERE username = ? AND realm = ?').get(username, r);
    if (existing) throw new Error('该租户下用户名已存在');

    const db = getDb();
    const id = uuidv4();
    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, username, email, phone, password_hash, password_changed_at, realm) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, email || null, phone || null, passwordHash, new Date().toISOString(), r);
    policyService.recordPassword(id, passwordHash);
    return { id, username, email, phone, realm: r };
  }

  // 管理员强制重置密码：下次登录必须改密，同时吊销所有会话
  forceResetPassword(userId, newPassword) {
    return userService.adminSetPassword(userId, newPassword).then(() => {
      tokenService.revokeAllForUser(userId);
      const jtis = sessionService.revokeAllForUser(userId, 'admin_reset_password');
      tokenService.revokeJtis(jtis);
      return { success: true };
    });
  }

  // ===== 职责分离（SoD）=====
  // 给定类型与 id 集合，若存在互斥对则抛错
  checkSoD(type, ids) {
    if (!Array.isArray(ids) || ids.length < 2) return;
    const rules = getDb().prepare('SELECT * FROM sod_rules WHERE type = ?').all(type);
    const set = new Set(ids);
    const nameOf = type === 'role'
      ? (id) => (getDb().prepare('SELECT name FROM roles WHERE id = ?').get(id) || {}).name
      : (id) => (getDb().prepare('SELECT name FROM permissions WHERE id = ?').get(id) || {}).name;
    for (const r of rules) {
      if (set.has(r.left_id) && set.has(r.right_id)) {
        const a = nameOf(r.left_id) || r.left_id;
        const b = nameOf(r.right_id) || r.right_id;
        throw new Error(`职责分离冲突：${a} 与 ${b} 互斥`);
      }
    }
  }

  // 用户有效角色集合（直接分配 + 组继承）
  userEffectiveRoleIds(userId) {
    const db = getDb();
    const rows = db.prepare(`
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

  addSodRule({ type, leftId, rightId, description }) {
    if (!['role', 'permission'].includes(type)) throw new Error('无效的规则类型');
    if (!leftId || !rightId || leftId === rightId) throw new Error('互斥对象不能为空或相同');
    const table = type === 'role' ? 'roles' : 'permissions';
    const db = getDb();
    for (const id of [leftId, rightId]) {
      if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) {
        throw new Error(`${type === 'role' ? '角色' : '权限'}不存在`);
      }
    }
    const [a, b] = leftId < rightId ? [leftId, rightId] : [rightId, leftId];
    const existing = db.prepare('SELECT id FROM sod_rules WHERE type = ? AND left_id = ? AND right_id = ?').get(type, a, b);
    if (existing) throw new Error('该互斥规则已存在');
    const id = uuidv4();
    db.prepare('INSERT INTO sod_rules (id, type, left_id, right_id, description) VALUES (?, ?, ?, ?, ?)')
      .run(id, type, a, b, description || null);
    return { id, type, leftId: a, rightId: b };
  }

  listSodRules() {
    const db = getDb();
    const rules = db.prepare('SELECT * FROM sod_rules ORDER BY type, left_id').all();
    const nameOf = (table) => (id) => (db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(id) || {}).name;
    for (const r of rules) {
      r.leftName = nameOf(r.type === 'role' ? 'roles' : 'permissions')(r.left_id) || r.left_id;
      r.rightName = nameOf(r.type === 'role' ? 'roles' : 'permissions')(r.right_id) || r.right_id;
    }
    return rules;
  }

  deleteSodRule(ruleId) {
    const db = getDb();
    if (!db.prepare('SELECT id FROM sod_rules WHERE id = ?').get(ruleId)) throw new Error('规则不存在');
    db.prepare('DELETE FROM sod_rules WHERE id = ?').run(ruleId);
    return { success: true };
  }

  assignRole(userId, roleId) {
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    const role = getDb().prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
    if (!role) throw new Error('角色不存在');
    this.checkSoD('role', [...new Set([...this.userEffectiveRoleIds(userId), roleId])]);
    getDb().prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
    return { success: true };
  }

  removeRole(userId, roleId) {
    getDb().prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(userId, roleId);
    return { success: true };
  }

  listRoles() {
    const roles = getDb().prepare('SELECT * FROM roles ORDER BY name').all();
    for (const r of roles) {
      r.permissions = getDb().prepare(`
        SELECT p.id, p.name FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        WHERE rp.role_id = ?
      `).all(r.id);
      r.memberCount = getDb().prepare('SELECT COUNT(*) AS c FROM user_roles WHERE role_id = ?').get(r.id).c;
    }
    return roles;
  }

  listPermissions() {
    return getDb().prepare('SELECT * FROM permissions ORDER BY name').all();
  }

  createRole({ name, description, permissionIds }) {
    if (!name) throw new Error('角色名不能为空');
    const existing = getDb().prepare('SELECT id FROM roles WHERE name = ?').get(name);
    if (existing) throw new Error('角色已存在');
    if (Array.isArray(permissionIds) && permissionIds.length) {
      this.checkSoD('permission', permissionIds);
    }
    const id = uuidv4();
    getDb().prepare('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)')
      .run(id, name, description || null);
    if (Array.isArray(permissionIds)) {
      const stmt = getDb().prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
      for (const pid of permissionIds) stmt.run(id, pid);
    }
    return { id, name, description };
  }

  updateRolePermissions(roleId, permissionIds) {
    const role = getDb().prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
    if (!role) throw new Error('角色不存在');
    this.checkSoD('permission', permissionIds || []);
    getDb().prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const stmt = getDb().prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
    for (const pid of permissionIds) stmt.run(roleId, pid);
    return { success: true };
  }

  // ===== 会话管理（管理员视角）=====
  listSessions() {
    return sessionService.listAll();
  }

  revokeSession(sessionId) {
    const { jtis, session } = sessionService.revokeById(sessionId, 'admin');
    tokenService.revokeJtis(jtis);
    return session;
  }

  // ===== 用户组 =====
  listGroups() {
    const groups = getDb().prepare('SELECT * FROM groups ORDER BY name').all();
    for (const g of groups) {
      g.memberCount = getDb().prepare('SELECT COUNT(*) AS c FROM group_members WHERE group_id = ?').get(g.id).c;
      g.members = getDb().prepare(`
        SELECT u.id, u.username, u.email FROM users u
        JOIN group_members gm ON u.id = gm.user_id
        WHERE gm.group_id = ? ORDER BY u.username
      `).all(g.id);
      g.roles = getDb().prepare(`
        SELECT r.id, r.name FROM roles r
        JOIN group_roles gr ON r.id = gr.role_id
        WHERE gr.group_id = ? ORDER BY r.name
      `).all(g.id);
    }
    return groups;
  }

  createGroup({ name, description }) {
    if (!name) throw new Error('组名不能为空');
    const existing = getDb().prepare('SELECT id FROM groups WHERE name = ?').get(name);
    if (existing) throw new Error('组已存在');
    const id = uuidv4();
    getDb().prepare('INSERT INTO groups (id, name, description) VALUES (?, ?, ?)').run(id, name, description || null);
    return { id, name, description };
  }

  deleteGroup(groupId) {
    const db = getDb();
    const g = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    if (!g) throw new Error('组不存在');
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM group_roles WHERE group_id = ?').run(groupId);
    db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    return { success: true };
  }

  addGroupMember(groupId, userId) {
    const db = getDb();
    if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId)) throw new Error('组不存在');
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw new Error('用户不存在');
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)').run(groupId, userId);
    return { success: true };
  }

  removeGroupMember(groupId, userId) {
    getDb().prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId);
    return { success: true };
  }

  setGroupRoles(groupId, roleIds) {
    const db = getDb();
    if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId)) throw new Error('组不存在');
    const ids = roleIds || [];
    this.checkSoD('role', ids);
    const members = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?').all(groupId);
    for (const m of members) {
      const direct = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(m.user_id).map(r => r.role_id);
      this.checkSoD('role', [...new Set([...ids, ...direct])]);
    }
    db.prepare('DELETE FROM group_roles WHERE group_id = ?').run(groupId);
    const stmt = db.prepare('INSERT OR IGNORE INTO group_roles (group_id, role_id) VALUES (?, ?)');
    for (const rid of ids) stmt.run(groupId, rid);
    return { success: true };
  }

  // ===== 组织架构/部门 =====
  listDepartments() {
    return getDb().prepare('SELECT * FROM departments ORDER BY name').all();
  }

  createDepartment({ name, parentId }) {
    if (!name) throw new Error('部门名不能为空');
    const existing = getDb().prepare('SELECT id FROM departments WHERE name = ?').get(name);
    if (existing) throw new Error('部门已存在');
    if (parentId && !getDb().prepare('SELECT id FROM departments WHERE id = ?').get(parentId)) throw new Error('上级部门不存在');
    const id = uuidv4();
    getDb().prepare('INSERT INTO departments (id, name, parent_id) VALUES (?, ?, ?)').run(id, name, parentId || null);
    return { id, name, parentId };
  }

  renameDepartment(deptId, name) {
    if (!name) throw new Error('部门名不能为空');
    const d = getDb().prepare('SELECT id FROM departments WHERE id = ?').get(deptId);
    if (!d) throw new Error('部门不存在');
    const dup = getDb().prepare('SELECT id FROM departments WHERE name = ? AND id != ?').get(name, deptId);
    if (dup) throw new Error('部门已存在');
    getDb().prepare('UPDATE departments SET name = ? WHERE id = ?').run(name, deptId);
    return { success: true };
  }

  deleteDepartment(deptId) {
    const db = getDb();
    const d = db.prepare('SELECT id FROM departments WHERE id = ?').get(deptId);
    if (!d) throw new Error('部门不存在');
    const hasChildren = db.prepare('SELECT id FROM departments WHERE parent_id = ?').get(deptId);
    if (hasChildren) throw new Error('请先删除或迁移子部门');
    db.prepare('UPDATE users SET department_id = NULL WHERE department_id = ?').run(deptId);
    db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);
    return { success: true };
  }

  setUserDepartment(userId, departmentId) {
    const db = getDb();
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw new Error('用户不存在');
    if (departmentId && !db.prepare('SELECT id FROM departments WHERE id = ?').get(departmentId)) throw new Error('部门不存在');
    userService.setDepartment(userId, departmentId || null);
    return { success: true };
  }

  // ===== 安全策略 =====
  getSettings() {
    return policyService.getAllSettings();
  }

  updateSettings(obj) {
    return policyService.updateSettings(obj);
  }

  // ===== 批量导入导出 =====
  exportUsersCSV() {
    const users = getDb().prepare(
      'SELECT id, username, email, phone, status, department_id, created_at FROM users ORDER BY created_at DESC'
    ).all();
    const deptMap = {};
    for (const d of this.listDepartments()) deptMap[d.id] = d.name;
    const headers = ['username', 'email', 'phone', 'status', 'department'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = users.map(u => [
      u.username, u.email, u.phone, u.status, deptMap[u.department_id] || ''
    ].map(esc).join(','));
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n') + '\n';
  }

  // CSV 列: username, email, phone, password, department
  importUsersCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV 内容为空');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idx = (name) => headers.indexOf(name);
    const iUser = idx('username');
    const iEmail = idx('email');
    const iPhone = idx('phone');
    const iPass = idx('password');
    const iDept = idx('department');
    if (iUser < 0 || iPass < 0) throw new Error('CSV 必须包含 username 和 password 列');

    const db = getDb();
    const created = [];
    const errors = [];
    const tx = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        // 简单 CSV 解析（支持带引号字段）
        const cells = this._parseCsvLine(lines[i]);
        const username = (cells[iUser] || '').trim();
        const password = (cells[iPass] || '').trim();
        const email = (cells[iEmail] || '').trim() || null;
        const phone = (cells[iPhone] || '').trim() || null;
        const deptName = (cells[iDept] || '').trim() || null;
        try {
          if (!username) throw new Error('用户名为空');
          if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) throw new Error('用户名已存在');
          const pwdCheck = policyService.validatePassword(password);
          if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
          let deptId = null;
          if (deptName) {
            const d = db.prepare('SELECT id FROM departments WHERE name = ?').get(deptName);
            deptId = d ? d.id : null;
          }
          const id = uuidv4();
          const passwordHash = bcrypt.hashSync(password, 10);
          db.prepare('INSERT INTO users (id, username, email, phone, password_hash, department_id, password_changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run(id, username, email, phone, passwordHash, deptId, new Date().toISOString());
          policyService.recordPassword(id, passwordHash);
          created.push(username);
        } catch (e) {
          errors.push(`第${i + 1}行 ${username}: ${e.message}`);
        }
      }
    });
    tx();
    return { created, errors };
  }

  _parseCsvLine(line) {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { cells.push(cur); cur = ''; }
        else cur += ch;
      }
    }
    cells.push(cur);
    return cells;
  }

  exportAuditLogsCSV() {
    const logs = getDb().prepare('SELECT * FROM audit_logs ORDER BY created_at DESC').all();
    const headers = ['time', 'user', 'action', 'ip', 'detail'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = logs.map(l => [l.created_at, l.username, l.action, l.ip, l.detail].map(esc).join(','));
    return '\uFEFF' + headers.join(',') + '\n' + rows.join('\n') + '\n';
  }
}

module.exports = new AdminService();