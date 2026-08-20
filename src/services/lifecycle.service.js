const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const userService = require('./user.service');
const tokenService = require('./token.service');
const sessionService = require('./session.service');

// 生命周期自动化：入职/转岗/离职（IGA joiner / mover / leaver）
class LifecycleService {
  // 入职：创建账号 + 赋权 + 设部门
  async join({ username, password, email, phone, departmentId, groupIds, roleIds, mustChangePassword, realm }) {
    if (!username || !password) {
      throw new Error('入职必须提供用户名和初始密码');
    }
    const user = adminService.createUserByAdmin({ username, email, phone, password, realm });
    try {
      if (departmentId) {
        userService.setDepartment(user.id, departmentId);
      }
      for (const gid of groupIds || []) {
        adminService.addGroupMember(gid, user.id);
      }
      for (const rid of roleIds || []) {
        adminService.assignRole(user.id, rid);
      }
      if (mustChangePassword) {
        getDb().prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(user.id);
      }
    } catch (e) {
      adminService.deleteUser(user.id);
      throw e;
    }
    return { ...user, mustChangePassword: !!mustChangePassword };
  }

  // 转岗：更新部门 + 增删组/角色
  async move({ userId, departmentId, addGroupIds, removeGroupIds, addRoleIds, removeRoleIds }) {
    const user = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    if (departmentId !== undefined && departmentId !== null) {
      userService.setDepartment(userId, departmentId);
    }
    for (const gid of addGroupIds || []) {
      adminService.addGroupMember(gid, userId);
    }
    for (const gid of removeGroupIds || []) {
      adminService.removeGroupMember(gid, userId);
    }
    for (const rid of addRoleIds || []) {
      adminService.assignRole(userId, rid);
    }
    for (const rid of removeRoleIds || []) {
      adminService.removeRole(userId, rid);
    }
    return { userId, username: user.username };
  }

  // 离职：状态流转 + 全量回收权限 + 吊销会话
  async leave({ userId, mode, revokeRoles = true }) {
    const user = getDb().prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    const status = mode === 'archived' ? 'archived' : 'disabled';
    adminService.setUserStatus(userId, status);
    const db = getDb();
    const groupIds = db.prepare('SELECT group_id FROM group_members WHERE user_id = ?').all(userId).map(r => r.group_id);
    for (const gid of groupIds) {
      adminService.removeGroupMember(gid, userId);
    }
    if (revokeRoles) {
      const roleIds = db.prepare('SELECT role_id FROM user_roles WHERE user_id = ?').all(userId).map(r => r.role_id);
      for (const rid of roleIds) {
        adminService.removeRole(userId, rid);
      }
    }
    return { userId, username: user.username, status };
  }
}

module.exports = new LifecycleService();