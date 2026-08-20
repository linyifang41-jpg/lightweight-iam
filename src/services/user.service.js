const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const policyService = require('./policy.service');

// 备用验证码字符集（剔除易混淆字符 I/O/0/1）
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECOVERY_COUNT = 10;

function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

function isValidPhone(phone) {
  const phoneRegex = /^1[3-9]\d{9}$/;
  return phoneRegex.test(phone);
}

// 密码强度校验：委托给策略服务（可配置最小长度/字符要求/弱密码黑名单）
function isValidPassword(password) {
  const check = policyService.validatePassword(password);
  return check.valid ? { valid: true } : { valid: false, reason: check.reason };
}

class UserService {
  async createUser({ username, email, phone, password, realm }) {
    if (email && !isValidEmail(email)) {
      throw new Error('邮箱格式不正确');
    }
    if (phone && !isValidPhone(phone)) {
      throw new Error('电话格式不正确');
    }
    // 密码强度校验
    const pwdCheck = policyService.validatePassword(password);
    if (!pwdCheck.valid) {
      throw new Error(pwdCheck.reason);
    }
    // 邮箱和手机号都可选，登录后再绑定
    const r = UserService.normalizeRealm(realm);
    if (r === null) {
      throw new Error('租户名称不合法（仅允许字母、数字、连字符、下划线，2-32位）');
    }

    const db = getDb();
    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);

    db.prepare('INSERT INTO users (id, username, email, phone, password_hash, password_changed_at, realm) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, email || null, phone || null, passwordHash, new Date().toISOString(), r);

    // 记录密码历史
    policyService.recordPassword(id, passwordHash);

    return { id, username, email, phone, realm: r };
  }

  async findByUsername(username, realm = UserService.DEFAULT_REALM) {
    return getDb().prepare('SELECT * FROM users WHERE username = ? AND realm = ?').get(username, realm);
  }

  async findByEmailOrPhone(account, realm = UserService.DEFAULT_REALM) {
    if (isValidEmail(account)) {
      return getDb().prepare('SELECT * FROM users WHERE email = ? AND realm = ?').get(account, realm);
    } else if (isValidPhone(account)) {
      return getDb().prepare('SELECT * FROM users WHERE phone = ? AND realm = ?').get(account, realm);
    }
    return null;
  }

  static get DEFAULT_REALM() { return 'default'; }

  static isValidRealm(realm) {
    return typeof realm === 'string' && /^[A-Za-z0-9_-]{2,32}$/.test(realm);
  }

  static normalizeRealm(realm) {
    if (!realm || realm === '') return UserService.DEFAULT_REALM;
    return UserService.isValidRealm(realm) ? realm : null;
  }

  async findById(id) {
    return getDb().prepare(
      'SELECT id, username, email, phone, status, email_verified, phone_verified, totp_enabled, must_change_password, department_id FROM users WHERE id = ?'
    ).get(id);
  }

  // 登录时使用的完整信息（含口令哈希、锁定状态、密码变更时间）
  async findByIdAuth(id) {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  // 账户是否已过有效期（UTC 比较，避免 JS/本地时区偏差）
  isExpired(user) {
    if (!user || !user.account_expires_at) return false;
    const row = getDb().prepare("SELECT 1 AS r WHERE datetime('now') > datetime(?)").get(user.account_expires_at);
    return !!row;
  }

  setAccountExpiry(userId, expiresAt) {
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    db.prepare('UPDATE users SET account_expires_at = ? WHERE id = ?').run(expiresAt, userId);
    return db.prepare('SELECT account_expires_at FROM users WHERE id = ?').get(userId).account_expires_at;
  }

  clearAccountExpiry(userId) {
    const db = getDb();
    db.prepare('UPDATE users SET account_expires_at = NULL WHERE id = ?').run(userId);
  }

  // 惰性清理：将已过期且状态为 active 的账户自动禁用（每次最多处理一批）
  autoDisableExpired() {
    const db = getDb();
    const expired = db.prepare("SELECT id, username FROM users WHERE status = 'active' AND account_expires_at IS NOT NULL AND datetime('now') > datetime(account_expires_at) LIMIT 50").all();
    for (const u of expired) {
      db.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(u.id);
    }
    return expired;
  }

  async verifyPassword(plain, hashed) {
    return bcrypt.compare(plain, hashed);
  }

  // 用户直接角色 + 通过用户组继承的角色
  _roleIdsQuery() {
    return `
      SELECT role_id FROM user_roles WHERE user_id = ?
      UNION
      SELECT gr.role_id FROM group_roles gr
      JOIN group_members gm ON gr.group_id = gm.group_id
      WHERE gm.user_id = ?
    `;
  }

  async getUserRoles(userId) {
    return getDb().prepare(`
      SELECT DISTINCT r.* FROM roles r
      WHERE r.id IN (${this._roleIdsQuery()})
      ORDER BY r.name
    `).all(userId, userId);
  }

  async getUserPermissions(userId) {
    return getDb().prepare(`
      SELECT DISTINCT p.name FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id IN (${this._roleIdsQuery()})
    `).all(userId, userId).map(r => r.name);
  }

  async bindEmail(userId, email) {
    if (!isValidEmail(email)) {
      throw new Error('邮箱格式不正确');
    }
    // 检查邮箱是否已被其他用户使用
    const existing = getDb().prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, userId);
    if (existing) {
      throw new Error('该邮箱已被其他用户绑定');
    }
    getDb().prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    return { success: true };
  }

  async bindPhone(userId, phone) {
    if (!isValidPhone(phone)) {
      throw new Error('手机号格式不正确');
    }
    // 检查手机号是否已被其他用户使用
    const existing = getDb().prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, userId);
    if (existing) {
      throw new Error('该手机号已被其他用户绑定');
    }
    getDb().prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, userId);
    return { success: true };
  }

  // 设置邮箱已验证
  setEmailVerified(userId, verified = 1) {
    getDb().prepare('UPDATE users SET email_verified = ? WHERE id = ?').run(verified, userId);
  }

  setPhoneVerified(userId, verified = 1) {
    getDb().prepare('UPDATE users SET phone_verified = ? WHERE id = ?').run(verified, userId);
  }

  // TOTP
  async setTotpSecret(userId, secret) {
    getDb().prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, userId);
  }

  async enableTotp(userId) {
    getDb().prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
  }

  async disableTotp(userId) {
    getDb().prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, recovery_codes = NULL, recovery_generated_at = NULL WHERE id = ?').run(userId);
  }

  // ===== 备用验证码（Recovery Codes）=====

  // 生成一组一次性备用码，DB 仅存哈希，返回明文供一次性展示
  generateRecoveryCodes(userId) {
    const codes = [];
    for (let i = 0; i < RECOVERY_COUNT; i++) {
      let raw = '';
      for (let j = 0; j < 8; j++) {
        raw += RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)];
      }
      codes.push(`${raw.slice(0, 4)}-${raw.slice(4)}`);
    }
    const stored = codes.map(code => ({ hash: crypto.createHash('sha256').update(code).digest('hex'), used: false }));
    getDb().prepare('UPDATE users SET recovery_codes = ?, recovery_generated_at = ? WHERE id = ?')
      .run(JSON.stringify(stored), new Date().toISOString(), userId);
    return codes;
  }

  // 返回剩余可用备用码数量与生成时间（不泄露明文）
  getRecoverySummary(userId) {
    const row = getDb().prepare('SELECT recovery_codes, recovery_generated_at FROM users WHERE id = ?').get(userId);
    if (!row || !row.recovery_codes) return { count: 0, generatedAt: null };
    const codes = JSON.parse(row.recovery_codes);
    return { count: codes.filter(c => !c.used).length, generatedAt: row.recovery_generated_at };
  }

  // 校验并单次使用一个备用码（输入规范化：大写、去空格）
  verifyRecoveryCode(userId, code) {
    const normalized = String(code || '').toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalized)) return false;
    const row = getDb().prepare('SELECT recovery_codes FROM users WHERE id = ?').get(userId);
    if (!row || !row.recovery_codes) return false;
    const codes = JSON.parse(row.recovery_codes);
    const hash = crypto.createHash('sha256').update(normalized).digest('hex');
    const idx = codes.findIndex(c => c.hash === hash && !c.used);
    if (idx < 0) return false;
    codes[idx].used = true;
    getDb().prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), userId);
    return true;
  }

  // 修改密码（需验证当前密码，含历史防重用）
  async changePassword(userId, oldPassword, newPassword) {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    const valid = await bcrypt.compare(oldPassword, user.password_hash);
    if (!valid) throw new Error('当前密码不正确');
    if (oldPassword === newPassword) throw new Error('新密码不能与当前密码相同');
    const pwdCheck = await policyService.validatePasswordForUser(userId, newPassword);
    if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
    const newHash = await bcrypt.hash(newPassword, 10);
    getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?')
      .run(newHash, new Date().toISOString(), userId);
    policyService.recordPassword(userId, newHash);
    return { success: true };
  }

  // 重置密码（忘记密码，通过验证码验证后重置）——同时解除登录锁定
  async resetPassword(userId, newPassword) {
    const pwdCheck = await policyService.validatePasswordForUser(userId, newPassword);
    if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
    const newHash = await bcrypt.hash(newPassword, 10);
    getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(newHash, new Date().toISOString(), userId);
    policyService.recordPassword(userId, newHash);
    return { success: true };
  }

  // 管理员强制改密：设置新密码并要求下次登录必须修改（同时解除锁定）
  async adminSetPassword(userId, newPassword) {
    const user = getDb().prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('用户不存在');
    const pwdCheck = await policyService.validatePasswordForUser(userId, newPassword);
    if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
    const newHash = await bcrypt.hash(newPassword, 10);
    getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?')
      .run(newHash, new Date().toISOString(), userId);
    policyService.recordPassword(userId, newHash);
    return { success: true };
  }

  // 强制改密完成后调用（登录流程中带 changeToken 提交新密码）
  async completeForcedPasswordChange(userId, newPassword) {
    const pwdCheck = await policyService.validatePasswordForUser(userId, newPassword);
    if (!pwdCheck.valid) throw new Error(pwdCheck.reason);
    const newHash = await bcrypt.hash(newPassword, 10);
    getDb().prepare('UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ? WHERE id = ?')
      .run(newHash, new Date().toISOString(), userId);
    policyService.recordPassword(userId, newHash);
    return { success: true };
  }

  setMustChangePassword(userId, flag = 1) {
    getDb().prepare('UPDATE users SET must_change_password = ? WHERE id = ?').run(flag, userId);
  }

  setDepartment(userId, departmentId) {
    getDb().prepare('UPDATE users SET department_id = ? WHERE id = ?').run(departmentId, userId);
  }

  updateProfile(userId, { email, phone }) {
    getDb().prepare('UPDATE users SET email = COALESCE(?, email), phone = COALESCE(?, phone) WHERE id = ?')
      .run(email ?? null, phone ?? null, userId);
  }

  renameUser(userId, newUsername) {
    const u = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId);
    if (!u) throw new Error('用户不存在');
    const dup = getDb().prepare('SELECT id FROM users WHERE username = ? AND realm = (SELECT realm FROM users WHERE id = ?)').get(newUsername, userId);
    if (dup) throw new Error('用户名已存在');
    getDb().prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, userId);
    return { success: true, from: u.username, to: newUsername };
  }
}

module.exports = new UserService();
module.exports.isValidEmail = isValidEmail;
module.exports.isValidPhone = isValidPhone;
module.exports.isValidPassword = isValidPassword;
module.exports.DEFAULT_REALM = UserService.DEFAULT_REALM;
module.exports.isValidRealm = UserService.isValidRealm;
module.exports.normalizeRealm = UserService.normalizeRealm;