const express = require('express');
const crypto = require('crypto');
const { authMiddleware, requirePermission } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const adminService = require('../services/admin.service');
const auditService = require('../services/audit.service');
const policyService = require('../services/policy.service');
const vaultService = require('../services/vault.service');
const ledgerService = require('../services/ledger.service');
const oidcService = require('../services/oidc.service');
const userService = require('../services/user.service');
const lifecycleService = require('../services/lifecycle.service');
const authzService = require('../services/authz.service');
const accessService = require('../services/access.service');
const serviceAccountService = require('../services/service-account.service');
const govService = require('../services/gov.service');
const certService = require('../services/cert.service');
const workflowService = require('../services/workflow.service');
const jitService = require('../services/jit.service');
const analyticsService = require('../services/analytics.service');
const breakglassService = require('../services/breakglass.service');
const privilegedService = require('../services/privileged.service');
const webhookService = require('../services/webhook.service');

const router = express.Router();

router.use(authMiddleware);

// 用户管理（需 user:manage 权限）
router.get('/users', requirePermission('user:manage'), (req, res) => {
  res.json({ users: adminService.listUsers() });
});

router.post('/users', requirePermission('user:manage'), csrfProtection, async (req, res) => {
  try {
    const { username, email, phone, password, realm } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: '请提供用户名和密码' });
    }
    const user = adminService.createUserByAdmin({ username, email, phone, password, realm });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.create', ip: req.ip, detail: { target: user.username } });
    res.status(201).json({ message: '用户创建成功', user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/users/:id/status', requirePermission('user:manage'), csrfProtection, (req, res) => {
  try {
    const { status } = req.body;
    adminService.setUserStatus(req.params.id, status);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.status_change', ip: req.ip, detail: { target: req.params.id, status } });
    res.json({ message: '用户状态已更新' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 管理员强制重置密码（下次登录必须改密，吊销所有会话）
router.put('/users/:id/password', requirePermission('user:manage'), csrfProtection, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: '请提供新密码' });
    await adminService.forceResetPassword(req.params.id, newPassword);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.force_reset_password', ip: req.ip, detail: { target: req.params.id } });
    res.json({ message: '密码已重置，该用户下次登录需修改密码，所有会话已下线' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 删除用户（物理删除 + 清理关联数据）
router.delete('/users/:id', requirePermission('user:manage'), csrfProtection, (req, res) => {
  try {
    const { username } = adminService.deleteUser(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.delete', ip: req.ip, detail: { target: username } });
    res.json({ message: '用户已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 生命周期自动化（IGA joiner / mover / leaver）=====
router.post('/lifecycle/join', requirePermission('user:manage'), csrfProtection, async (req, res) => {
  try {
    const { username, password, email, phone, departmentId, groupIds, roleIds, mustChangePassword, realm } = req.body;
    const user = await lifecycleService.join({ username, password, email, phone, departmentId, groupIds, roleIds, mustChangePassword, realm });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'lifecycle.join', ip: req.ip, detail: { target: user.username, departmentId, groupIds, roleIds } });
    res.status(201).json({ message: '入职成功，账号已开通并赋权', user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/lifecycle/move', requirePermission('user:manage'), csrfProtection, async (req, res) => {
  try {
    const { userId, departmentId, addGroupIds, removeGroupIds, addRoleIds, removeRoleIds } = req.body;
    const result = await lifecycleService.move({ userId, departmentId, addGroupIds, removeGroupIds, addRoleIds, removeRoleIds });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'lifecycle.move', ip: req.ip, detail: { target: result.username, departmentId, addGroupIds, removeGroupIds, addRoleIds, removeRoleIds } });
    res.json({ message: '转岗成功，权限已调整', result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/lifecycle/leave', requirePermission('user:manage'), csrfProtection, async (req, res) => {
  try {
    const { userId, mode, revokeRoles } = req.body;
    const result = await lifecycleService.leave({ userId, mode, revokeRoles });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'lifecycle.leave', ip: req.ip, detail: { target: result.username, status: result.status } });
    res.json({ message: '离职处理完成，权限已回收，会话已下线', result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 设置用户部门
router.put('/users/:id/department', requirePermission('dept:manage'), csrfProtection, (req, res) => {
  try {
    const { departmentId } = req.body;
    userService.setDepartment(req.params.id, departmentId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.set_department', ip: req.ip, detail: { target: req.params.id, departmentId } });
    res.json({ message: '部门已更新' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 设置/清除账户有效期（YYYY-MM-DD 或留空清除）
router.put('/users/:id/expiry', requirePermission('user:manage'), csrfProtection, (req, res) => {
  try {
    const { expiresAt } = req.body;
    const userId = req.params.id;
    if (expiresAt) {
      const m = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt);
      if (!m) throw new Error('有效期格式应为 YYYY-MM-DD');
      userService.setAccountExpiry(userId, `${expiresAt} 23:59:59`);
    } else {
      userService.clearAccountExpiry(userId);
    }
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.set_expiry', ip: req.ip, detail: { target: userId, expiresAt: expiresAt || null } });
    res.json({ message: expiresAt ? '账户有效期已设置' : '账户有效期已清除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/users/:id/roles', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    const { roleId } = req.body;
    adminService.assignRole(req.params.id, roleId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.assign_role', ip: req.ip, detail: { target: req.params.id, roleId } });
    res.json({ message: '角色已分配' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/users/:id/roles/:roleId', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    adminService.removeRole(req.params.id, req.params.roleId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.remove_role', ip: req.ip, detail: { target: req.params.id, roleId: req.params.roleId } });
    res.json({ message: '角色已移除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 批量导入/导出用户
router.get('/users/export', requirePermission('user:manage'), (req, res) => {
  const csv = adminService.exportUsersCSV();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="users-${Date.now()}.csv"`);
  res.send(csv);
});

router.post('/users/import', requirePermission('user:manage'), csrfProtection, (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv) return res.status(400).json({ error: '请提供 CSV 内容' });
    const result = adminService.importUsersCSV(csv);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.import', ip: req.ip, detail: { created: result.created.length, errors: result.errors.length } });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 角色管理（需 role:manage 权限）
router.get('/roles', requirePermission('role:manage'), (req, res) => {
  res.json({ roles: adminService.listRoles() });
});

router.post('/roles', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    const { name, description, permissionIds } = req.body;
    const role = adminService.createRole({ name, description, permissionIds });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'role.create', ip: req.ip, detail: { name } });
    res.status(201).json({ message: '角色创建成功', role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/roles/:id/permissions', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    const { permissionIds } = req.body;
    adminService.updateRolePermissions(req.params.id, permissionIds || []);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'role.permission_update', ip: req.ip, detail: { roleId: req.params.id } });
    res.json({ message: '角色权限已更新' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 权限列表
router.get('/permissions', requirePermission('role:manage'), (req, res) => {
  res.json({ permissions: adminService.listPermissions() });
});

// ===== 职责分离（SoD）=====
router.get('/sod-rules', requirePermission('role:manage'), (req, res) => {
  res.json({ rules: adminService.listSodRules() });
});

router.post('/sod-rules', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    const { type, leftId, rightId, description } = req.body;
    const rule = adminService.addSodRule({ type, leftId, rightId, description });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sod.rule_create', ip: req.ip, detail: { type, leftId, rightId } });
    res.status(201).json({ message: '互斥规则已添加', rule });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/sod-rules/:id', requirePermission('role:manage'), csrfProtection, (req, res) => {
  try {
    adminService.deleteSodRule(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sod.rule_delete', ip: req.ip, detail: { ruleId: req.params.id } });
    res.json({ message: '互斥规则已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 会话管理（需 session:manage 权限）=====
router.get('/sessions', requirePermission('session:manage'), (req, res) => {
  res.json({ sessions: adminService.listSessions() });
});

router.post('/sessions/:id/revoke', requirePermission('session:manage'), csrfProtection, (req, res) => {
  try {
    const session = adminService.revokeSession(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'session.force_offline', ip: req.ip, detail: { target: session.user_id } });
    res.json({ message: '已强制下线该会话' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 用户组（需 group:manage 权限）=====
router.get('/groups', requirePermission('group:manage'), (req, res) => {
  res.json({ groups: adminService.listGroups() });
});

router.post('/groups', requirePermission('group:manage'), csrfProtection, (req, res) => {
  try {
    const { name, description } = req.body;
    const group = adminService.createGroup({ name, description });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'group.create', ip: req.ip, detail: { name } });
    res.status(201).json({ message: '组创建成功', group });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/groups/:id', requirePermission('group:manage'), csrfProtection, (req, res) => {
  try {
    adminService.deleteGroup(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'group.delete', ip: req.ip, detail: { groupId: req.params.id } });
    res.json({ message: '组已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/groups/:id/members', requirePermission('group:manage'), csrfProtection, (req, res) => {
  try {
    const { userId } = req.body;
    adminService.addGroupMember(req.params.id, userId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'group.add_member', ip: req.ip, detail: { groupId: req.params.id, userId } });
    res.json({ message: '已添加成员' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/groups/:id/members/:userId', requirePermission('group:manage'), csrfProtection, (req, res) => {
  try {
    adminService.removeGroupMember(req.params.id, req.params.userId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'group.remove_member', ip: req.ip, detail: { groupId: req.params.id, userId: req.params.userId } });
    res.json({ message: '已移除成员' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/groups/:id/roles', requirePermission('group:manage'), csrfProtection, (req, res) => {
  try {
    const { roleIds } = req.body;
    adminService.setGroupRoles(req.params.id, roleIds || []);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'group.set_roles', ip: req.ip, detail: { groupId: req.params.id, roleIds } });
    res.json({ message: '组角色已更新' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 组织架构/部门（需 dept:manage 权限）=====
router.get('/departments', requirePermission('dept:manage'), (req, res) => {
  res.json({ departments: adminService.listDepartments() });
});

router.post('/departments', requirePermission('dept:manage'), csrfProtection, (req, res) => {
  try {
    const { name, parentId } = req.body;
    const dept = adminService.createDepartment({ name, parentId });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'dept.create', ip: req.ip, detail: { name } });
    res.status(201).json({ message: '部门创建成功', dept });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/departments/:id', requirePermission('dept:manage'), csrfProtection, (req, res) => {
  try {
    const { name } = req.body;
    adminService.renameDepartment(req.params.id, name);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'dept.rename', ip: req.ip, detail: { deptId: req.params.id, name } });
    res.json({ message: '部门已重命名' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/departments/:id', requirePermission('dept:manage'), csrfProtection, (req, res) => {
  try {
    adminService.deleteDepartment(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'dept.delete', ip: req.ip, detail: { deptId: req.params.id } });
    res.json({ message: '部门已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 安全策略（需 policy:manage 权限）=====
router.get('/settings', requirePermission('policy:manage'), (req, res) => {
  res.json({ settings: adminService.getSettings() });
});

// SCIM token 状态（是否已配置，不泄露明文）
router.get('/scim/status', requirePermission('policy:manage'), (req, res) => {
  const token = policyService.getSetting('scim_token');
  res.json({ configured: !!token });
});

// 生成/重置 SCIM token（仅此处返回明文一次）
router.post('/scim/token', requirePermission('policy:manage'), csrfProtection, (req, res) => {
  const token = crypto.randomBytes(32).toString('base64url');
  policyService.updateSettings({ scim_token: token });
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'scim.token_regenerated', ip: req.ip });
  res.json({ message: 'SCIM Token 已生成', token });
});

router.put('/settings', requirePermission('policy:manage'), csrfProtection, (req, res) => {
  try {
    const settings = adminService.updateSettings(req.body);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'policy.update', ip: req.ip, detail: { settings: req.body } });
    res.json({ message: '安全策略已更新', settings });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 审计日志（需 audit:view 权限）
router.get('/audit-logs', requirePermission('audit:view'), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ logs: auditService.list(Math.min(limit, 200)) });
});

router.get('/audit-logs/export', requirePermission('audit:view'), (req, res) => {
  const csv = adminService.exportAuditLogsCSV();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
  res.send(csv);
});

// ===== 凭据保险库（需 credential:manage 权限）=====
router.get('/credentials', requirePermission('credential:manage'), (req, res) => {
  res.json({ credentials: vaultService.listCredentials() });
});

router.post('/credentials', requirePermission('credential:manage'), csrfProtection, (req, res) => {
  try {
    const { id } = vaultService.createCredential(req.body);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'vault.create', ip: req.ip, detail: { id, name: req.body.name } });
    res.status(201).json({ message: '凭据已保存', id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/credentials/:id', requirePermission('credential:manage'), csrfProtection, (req, res) => {
  try {
    vaultService.deleteCredential(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'vault.delete', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '凭据已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/credentials/:id/reveal', requirePermission('credential:manage'), (req, res) => {
  try {
    const cred = vaultService.revealCredential(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'vault.reveal', ip: req.ip, detail: { id: cred.id, name: cred.name } });
    res.json(cred);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 权限审计台账（需 ledger:view 权限）=====
router.get('/ledger', requirePermission('ledger:view'), (req, res) => {
  res.json({ ledger: ledgerService.getLedger(req.query.q || '') });
});

router.get('/ledger/export', requirePermission('ledger:view'), (req, res) => {
  const csv = ledgerService.exportLedgerCSV(req.query.q || '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="access-ledger-${Date.now()}.csv"`);
  res.send(csv);
});

// ===== OIDC 客户端管理（需 oidc:manage 权限）=====
router.get('/oidc-clients', requirePermission('oidc:manage'), (req, res) => {
  res.json({ clients: oidcService.listClients() });
});

router.post('/oidc-clients', requirePermission('oidc:manage'), csrfProtection, (req, res) => {
  try {
    const { name, redirectUris } = req.body;
    const uris = Array.isArray(redirectUris) ? redirectUris : String(redirectUris || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!name) throw new Error('应用名不能为空');
    if (!uris.length) throw new Error('至少需要一个回调地址');
    const client = oidcService.createClient({ name, redirectUris: uris });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'oidc.client_create', ip: req.ip, detail: { clientId: client.clientId, name } });
    res.status(201).json({ message: 'OIDC 客户端已创建', client });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/oidc-clients/:id', requirePermission('oidc:manage'), csrfProtection, (req, res) => {
  const ok = oidcService.deleteClient(req.params.id);
  if (!ok) return res.status(404).json({ error: '客户端不存在' });
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'oidc.client_delete', ip: req.ip, detail: { id: req.params.id } });
  res.json({ message: 'OIDC 客户端已删除' });
});

// ===== ABAC 属性授权（需 abac:manage 权限）=====
router.get('/abac/policies', requirePermission('abac:manage'), (req, res) => {
  res.json({ policies: authzService.listPolicies() });
});

router.post('/abac/policies', requirePermission('abac:manage'), csrfProtection, (req, res) => {
  try {
    const policy = authzService.createPolicy(req.body);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'abac.policy_create', ip: req.ip, detail: { name: policy.name, resourceType: policy.resource_type, effect: policy.effect } });
    res.status(201).json({ message: 'ABAC 策略已创建', policy });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/abac/policies/:id', requirePermission('abac:manage'), csrfProtection, (req, res) => {
  try {
    const policy = authzService.updatePolicy(req.params.id, req.body);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'abac.policy_update', ip: req.ip, detail: { id: req.params.id, name: policy.name } });
    res.json({ message: 'ABAC 策略已更新', policy });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/abac/policies/:id', requirePermission('abac:manage'), csrfProtection, (req, res) => {
  try {
    authzService.deletePolicy(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'abac.policy_delete', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: 'ABAC 策略已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 设置用户扩展属性（供 ABAC 决策使用）
router.put('/users/:id/attributes', requirePermission('abac:manage'), csrfProtection, (req, res) => {
  try {
    const result = authzService.setUserAttributes(req.params.id, req.body.attributes);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'abac.attr_update', ip: req.ip, detail: { target: req.params.id, attributes: result.attributes } });
    res.json({ message: '用户属性已更新', ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 用户属性（决策上下文视图）
router.get('/users/:id/attributes', requirePermission('abac:manage'), (req, res) => {
  const attrs = authzService.getUserAttributes(req.params.id);
  if (!attrs) return res.status(404).json({ error: '用户不存在' });
  res.json({ attributes: attrs });
});

// ===== 访问请求与审批流（需 approval:manage 权限）=====
router.get('/access-requests', requirePermission('approval:manage'), (req, res) => {
  res.json({ requests: accessService.listRequests(req.query.status) });
});

router.post('/access-requests/:id/approve', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const request = accessService.approveRequest(req.params.id, req.user.id, req.body.note);
    auditService.log({ userId: req.user.id, username: req.user.username, action: request.status === 'approved' ? 'access.approve' : 'access.reject_auto', ip: req.ip, detail: { requestId: req.params.id, status: request.status, note: request.note } });
    const msg = request.status === 'approved' ? '审批通过，角色已自动开通' : (request.status === 'rejected' ? '审批未通过（' + (request.note || '') + '）' : '审批已记录，等待下一位审批人');
    res.json({ message: msg, request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/access-requests/:id/reject', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const request = accessService.rejectRequest(req.params.id, req.user.id, req.body.note);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'access.reject', ip: req.ip, detail: { requestId: req.params.id, note: request.note } });
    res.json({ message: '访问请求已拒绝', request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 服务账号（非人类身份，需 sa:manage 权限）=====
router.get('/service-accounts', requirePermission('sa:manage'), (req, res) => {
  res.json({ serviceAccounts: serviceAccountService.listServiceAccounts() });
});

router.post('/service-accounts', requirePermission('sa:manage'), csrfProtection, (req, res) => {
  try {
    const { name, description, permissions, ownerId, tokenTtlMinutes } = req.body;
    const result = serviceAccountService.createServiceAccount({ name, description, permissions, ownerId, tokenTtlMinutes });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sa.create', ip: req.ip, detail: { name: result.serviceAccount.name, clientId: result.clientId } });
    res.status(201).json({ message: '服务账号已创建（secret 仅展示一次）', clientId: result.clientId, clientSecret: result.clientSecret, serviceAccount: result.serviceAccount });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/service-accounts/:id', requirePermission('sa:manage'), csrfProtection, (req, res) => {
  try {
    const sa = serviceAccountService.updateServiceAccount(req.params.id, req.body);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sa.update', ip: req.ip, detail: { name: sa.name, status: sa.status } });
    res.json({ message: '服务账号已更新', serviceAccount: sa });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/service-accounts/:id/secret', requirePermission('sa:manage'), csrfProtection, (req, res) => {
  try {
    const { clientId, clientSecret } = serviceAccountService.regenerateSecret(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sa.secret', ip: req.ip, detail: { clientId } });
    res.json({ message: '凭据已重发，旧令牌全部作废（secret 仅展示一次）', clientId, clientSecret });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/service-accounts/:id', requirePermission('sa:manage'), csrfProtection, (req, res) => {
  try {
    serviceAccountService.deleteServiceAccount(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'sa.delete', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '服务账号已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 默认账户治理（等保，需 gov:manage 权限）=====
router.get('/default-accounts', requirePermission('gov:manage'), (req, res) => {
  const result = govService.detectDefaultAccounts();
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'gov.detect', ip: req.ip, detail: { highRisk: result.highRisk } });
  res.json(result);
});

router.post('/default-accounts/:id/force-reset', requirePermission('gov:manage'), csrfProtection, (req, res) => {
  try {
    govService.forceReset(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'gov.force_reset', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '已强制改密：下次登录必须先修改密码，全部会话已吊销' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/default-accounts/:id/disable-login', requirePermission('gov:manage'), csrfProtection, (req, res) => {
  try {
    govService.setPasswordLoginAllowed(req.params.id, false);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'gov.disable_login', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '默认凭据登录已禁用（SSO/OTP/TOTP 不受影响）' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/default-accounts/:id/enable-login', requirePermission('gov:manage'), csrfProtection, (req, res) => {
  try {
    govService.setPasswordLoginAllowed(req.params.id, true);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'gov.enable_login', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '默认凭据登录已恢复' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/default-accounts/:id', requirePermission('gov:manage'), csrfProtection, (req, res) => {
  try {
    govService.deleteDefaultAccount(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'gov.delete_account', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '默认账户已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 访问复审（Access Certification，cert:manage / cert:review）=====
router.get('/certifications', requirePermission('cert:review'), (req, res) => {
  res.json({ campaigns: certService.listCampaigns() });
});

router.post('/certifications', requirePermission('cert:manage'), csrfProtection, (req, res) => {
  try {
    const { name, scopeType, scopeValue, dueDate, autoAction } = req.body;
    if (!name) throw new Error('活动名称必填');
    if (!['dept', 'users'].includes(scopeType)) throw new Error('范围类型必须为 dept 或 users');
    if (scopeType === 'users' && (!Array.isArray(scopeValue) || scopeValue.length === 0)) throw new Error('用户范围需至少一个用户');
    const result = certService.createCampaign({ name, scopeType, scopeValue, dueDate, autoAction, createdBy: req.user.id });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'cert.create', ip: req.ip, detail: { id: result.id, itemCount: result.itemCount, scopeType } });
    res.status(201).json({ message: `复审活动已创建（共 ${result.itemCount} 项待复审）`, campaign: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/certifications/:id', requirePermission('cert:review'), (req, res) => {
  try {
    res.json({ campaign: certService.getCampaign(req.params.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/certifications/:id/items/:itemId/decision', requirePermission('cert:review'), csrfProtection, (req, res) => {
  try {
    const { action, note } = req.body;
    const result = certService.reviewItem(req.params.id, req.params.itemId, action, req.user.username, note);
    auditService.log({ userId: req.user.id, username: req.user.username, action: `cert.review_${action}`, ip: req.ip, detail: { campaignId: req.params.id, itemId: req.params.itemId, userId: result.userId, roleId: result.roleId } });
    res.json({ message: action === 'revoke' ? '已撤销该用户角色' : '已确认保留', result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/certifications/:id/close', requirePermission('cert:manage'), csrfProtection, (req, res) => {
  try {
    const result = certService.closeCampaign(req.params.id, req.user.username, false);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'cert.close', ip: req.ip, detail: { id: req.params.id, action: result.action, disposed: result.disposed } });
    res.json({ message: result.disposed > 0 ? `活动已关闭，${result.disposed} 个未处理项按「${result.action === 'revoke' ? '撤销' : '保留'}」处置` : '活动已关闭（无未处理项）', result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 工作流引擎（workflow:manage）=====
router.get('/workflows', requirePermission('workflow:manage'), (req, res) => {
  res.json({ workflows: workflowService.listWorkflows() });
});

router.post('/workflows', requirePermission('workflow:manage'), csrfProtection, (req, res) => {
  try {
    const { name, type, definition, active } = req.body;
    const wf = workflowService.createWorkflow({ name, type, definition, active });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'wf.create', ip: req.ip, detail: { id: wf.id, name: wf.name, type: wf.type } });
    res.status(201).json({ message: '工作流已创建', workflow: wf });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/workflows/:id', requirePermission('workflow:manage'), csrfProtection, (req, res) => {
  try {
    const { active } = req.body;
    workflowService.setActive(req.params.id, !!active);
    auditService.log({ userId: req.user.id, username: req.user.username, action: active ? 'wf.activate' : 'wf.deactivate', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: active ? '工作流已启用' : '工作流已停用' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/workflows/:id', requirePermission('workflow:manage'), csrfProtection, (req, res) => {
  try {
    workflowService.deleteWorkflow(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'wf.delete', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: '工作流已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 待办任务（工作流审批）
router.get('/workflow-tasks', requirePermission('approval:manage'), (req, res) => {
  const tasks = workflowService.listTasks({ status: 'pending' });
  res.json({ tasks });
});

// 实例列表
router.get('/workflow-instances', requirePermission('workflow:manage'), (req, res) => {
  res.json({ instances: workflowService.listInstances(req.query.entityType) });
});

router.post('/workflow-tasks/:id/decision', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const { decision, note } = req.body;
    const task = workflowService.listTasks({}).find(t => t.id === req.params.id);
    if (!task) throw new Error('任务不存在');
    const result = workflowService.decide(task.instance_id, task.id, decision, req.user, note);
    auditService.log({ userId: req.user.id, username: req.user.username, action: `wf.decide_${decision}`, ip: req.ip, detail: { taskId: task.id, instanceId: task.instance_id, node: task.node_name, state: result.instanceStatus || result.state } });
    res.json({ message: decision === 'approved' ? '已通过，流程推进' : '已拒绝，流程终止', result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 即时访问 JIT（临时提权，approval:manage）=====
router.get('/jit-grants', requirePermission('approval:manage'), (req, res) => {
  res.json({ grants: jitService.listGrants(req.query.status) });
});

router.post('/jit-grants/:id/approve', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const grant = jitService.approveGrant(req.params.id, req.user.id, req.user.username);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'jit.approve', ip: req.ip, detail: { id: grant.id, userId: grant.user_id, roleId: grant.role_id, minutes: grant.duration_minutes } });
    res.json({ message: `已批准，临时授权 ${grant.duration_minutes} 分钟`, grant });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jit-grants/:id/reject', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const grant = jitService.rejectGrant(req.params.id, req.user.username);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'jit.reject', ip: req.ip, detail: { id: grant.id, userId: grant.user_id, roleId: grant.role_id } });
    res.json({ message: '已拒绝该提权申请', grant });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jit-grants/:id/revoke', requirePermission('approval:manage'), csrfProtection, (req, res) => {
  try {
    const grant = jitService.revokeGrant(req.params.id, req.user.username);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'jit.revoke', ip: req.ip, detail: { id: grant.id, userId: grant.user_id, roleId: grant.role_id } });
    res.json({ message: '已撤销，临时授权即时回收', grant });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 权限分析（策略违规检测 + 角色挖掘）=====
router.get('/analytics/violations', requirePermission('analytics:view'), (req, res) => {
  const result = analyticsService.detectViolations();
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'analytics.violations_view', ip: req.ip, detail: { total: result.total } });
  res.json(result);
});

router.get('/analytics/role-mining', requirePermission('analytics:view'), (req, res) => {
  const result = analyticsService.roleMining(req.query.minSupport);
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'analytics.rolemining_view', ip: req.ip, detail: { minSupport: result.minSupport, count: result.candidates.length } });
  res.json(result);
});

router.post('/analytics/role-mining/promote', requirePermission('analytics:view'), csrfProtection, (req, res) => {
  try {
    const { name, permissionNames, userIds } = req.body;
    const role = analyticsService.promoteRole({ name, permissionNames, userIds });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'analytics.role_promote', ip: req.ip, detail: { name: role.name, id: role.id, perms: role.permissionCount, users: role.userCount } });
    res.status(201).json({ message: '候选角色已落库', role });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 应急访问 Break-glass（管理端，breakglass:manage）=====
router.get('/breakglass', requirePermission('breakglass:manage'), (req, res) => {
  res.json({ events: breakglassService.list(req.query.status) });
});

router.post('/breakglass/:id/end', requirePermission('breakglass:manage'), csrfProtection, (req, res) => {
  try {
    const event = breakglassService.end(req.params.id, req.user);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'breakglass.end', ip: req.ip, detail: { id: event.id, by: 'admin' } });
    res.json({ message: '应急访问已强制结束，权限已回收', event });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/breakglass/:id/review', requirePermission('breakglass:manage'), csrfProtection, (req, res) => {
  try {
    const { reviewNote } = req.body;
    const event = breakglassService.review(req.params.id, req.user.username, reviewNote);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'breakglass.review', ip: req.ip, detail: { id: event.id, note: reviewNote } });
    res.json({ message: '应急事件已审查闭环', event });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 特权账号发现与登记（pam:manage）=====
router.get('/privileged-accounts', requirePermission('pam:manage'), (req, res) => {
  const { type, status, risk } = req.query;
  const result = privilegedService.list({ type, status, risk });
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.view', ip: req.ip, detail: { total: result.stats.total } });
  res.json(result);
});

router.post('/privileged-accounts/discover', requirePermission('pam:manage'), csrfProtection, (req, res) => {
  const result = privilegedService.discover();
  auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.discover', ip: req.ip, detail: { added: result.addedCount } });
  res.json({ message: `自动发现完成，新增 ${result.addedCount} 条`, ...result });
});

router.post('/privileged-accounts', requirePermission('pam:manage'), csrfProtection, (req, res) => {
  try {
    const { type, userId, saId, owner, riskLevel, reason, displayName } = req.body;
    const record = privilegedService.register({ type, userId, saId, owner, riskLevel, reason, displayName });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.register', ip: req.ip, detail: { id: record.id, type, name: record.display_name } });
    res.status(201).json({ message: '特权账号已登记', record });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/privileged-accounts/:id/retire', requirePermission('pam:manage'), csrfProtection, (req, res) => {
  try {
    const { reason } = req.body;
    const record = privilegedService.retire(req.params.id, reason);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.retire', ip: req.ip, detail: { id: record.id, name: record.display_name } });
    res.json({ message: '特权账号已退管', record });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/privileged-accounts/:id/review', requirePermission('pam:manage'), csrfProtection, (req, res) => {
  try {
    const record = privilegedService.review(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.review', ip: req.ip, detail: { id: record.id } });
    res.json({ message: '已标记审查', record });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/privileged-accounts/:id/link-vault', requirePermission('pam:manage'), csrfProtection, (req, res) => {
  try {
    const { credentialId } = req.body;
    const record = privilegedService.linkVault(req.params.id, credentialId);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'pam.link_vault', ip: req.ip, detail: { id: record.id, credentialId } });
    res.json({ message: '已关联凭据保险库', record });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== Webhook 事件流（webhook:manage）=====
router.get('/webhooks', requirePermission('webhook:manage'), (req, res) => {
  res.json({ webhooks: webhookService.list() });
});

router.post('/webhooks', requirePermission('webhook:manage'), csrfProtection, (req, res) => {
  try {
    const { url, secret, events } = req.body;
    const webhook = webhookService.create({ url, secret, events, createdBy: req.user.username });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'webhook.create', ip: req.ip, detail: { id: webhook.id, url, events: webhook.events } });
    res.status(201).json({ message: 'Webhook 订阅已创建', webhook });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/webhooks/:id', requirePermission('webhook:manage'), csrfProtection, (req, res) => {
  try {
    const { url, secret, events, enabled } = req.body;
    const webhook = webhookService.update(req.params.id, { url, secret, events, enabled });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'webhook.update', ip: req.ip, detail: { id: webhook.id, enabled: webhook.enabled } });
    res.json({ message: 'Webhook 订阅已更新', webhook });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/webhooks/:id', requirePermission('webhook:manage'), csrfProtection, (req, res) => {
  try {
    webhookService.remove(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'webhook.delete', ip: req.ip, detail: { id: req.params.id } });
    res.json({ message: 'Webhook 订阅已删除' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/webhooks/:id/test', requirePermission('webhook:manage'), csrfProtection, async (req, res) => {
  try {
    const result = await webhookService.test(req.params.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'webhook.test', ip: req.ip, detail: { id: req.params.id, ok: result.ok } });
    res.json({ message: result.ok ? '测试投递成功' : '测试投递失败', ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;