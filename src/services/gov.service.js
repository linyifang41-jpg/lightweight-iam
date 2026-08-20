const bcrypt = require('bcryptjs');
const { getDb } = require('../models/database');
const tokenService = require('./token.service');
const sessionService = require('./session.service');

// 默认账户治理（等保）：识别种子账户 + 默认密码风险，强制改密/禁用默认凭据登录/删除
// is_seed=1 为内置种子账户；种子账户首次创建时的默认密码字典
const SEED_DEFAULT_PASSWORDS = {
  admin: 'Admin123',
  lin: 'lin123456'
};

function toRisk(row, usesDefaultPassword) {
  return {
    id: row.id,
    username: row.username,
    email: row.email || null,
    phone: row.phone || null,
    isSeed: !!row.is_seed,
    usesDefaultPassword,
    passwordLoginAllowed: !!row.password_login_allowed,
    mustChangePassword: !!row.must_change_password,
    status: row.status,
    createdAt: row.created_at
  };
}

// 判断账户是否仍在使用其默认密码（is_seed + 命中默认密码字典）
function usesDefaultPassword(row) {
  const defPwd = SEED_DEFAULT_PASSWORDS[row.username];
  return !!(row.is_seed && defPwd && row.password_hash && bcrypt.compareSync(defPwd, row.password_hash));
}

// 检测默认账户：is_seed=1 的账户，密码哈希是否仍等于其默认密码
function detectDefaultAccounts() {
  const rows = getDb().prepare("SELECT id, username, email, phone, password_hash, is_seed, password_login_allowed, must_change_password, status, created_at FROM users WHERE is_seed = 1").all();
  const risks = rows.map((row) => toRisk(row, usesDefaultPassword(row)));
  // 汇总：存在"仍使用默认密码"的种子账户即为高风险
  return { riskAccounts: risks, highRisk: risks.some(r => r.usesDefaultPassword) };
}

// 强制改密：must_change_password=1 + 吊销全部令牌与会话
function forceReset(id) {
  const row = getDb().prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!row) throw new Error('账户不存在');
  getDb().prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run(id);
  tokenService.revokeAllForUser(id);
  const jtis = sessionService.revokeAllForUser(id, 'gov.force_reset');
  tokenService.revokeJtis(jtis);
  return { success: true };
}

// 禁用/恢复默认凭据登录（仅影响密码通道，SSO/OTP/TOTP 不受影响）
function setPasswordLoginAllowed(id, allowed) {
  const row = getDb().prepare('SELECT id, is_seed FROM users WHERE id = ?').get(id);
  if (!row) throw new Error('账户不存在');
  getDb().prepare('UPDATE users SET password_login_allowed = ? WHERE id = ?').run(allowed ? 1 : 0, id);
  return { success: true };
}

// 删除默认账户（内置 admin 受保护）
function deleteDefaultAccount(id) {
  const row = getDb().prepare('SELECT id, username, is_seed FROM users WHERE id = ?').get(id);
  if (!row) throw new Error('账户不存在');
  if (row.is_seed && row.username === 'admin') throw new Error('内置 admin 账户不可删除');
  getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
  return { success: true };
}

module.exports = {
  detectDefaultAccounts,
  usesDefaultPassword,
  forceReset,
  setPasswordLoginAllowed,
  deleteDefaultAccount,
  SEED_DEFAULT_PASSWORDS
};