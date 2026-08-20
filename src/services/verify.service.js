const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');

const CODE_TTL_MINUTES = 10;

// 验证码服务：用于邮箱/手机号验证和忘记密码
// 说明：demo 环境没有真实短信/邮件通道，验证码直接返回给前端展示
class VerifyService {
  _generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6位数字
  }

  _hash(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  // 创建验证码（type: email | phone | password_reset）
  createCode(userId, type) {
    const code = this._generateCode();
    const db = getDb();
    // 使该用户该类型的旧验证码失效
    db.prepare('UPDATE verification_codes SET used = 1 WHERE user_id = ? AND type = ? AND used = 0')
      .run(userId, type);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();
    db.prepare('INSERT INTO verification_codes (user_id, type, code_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(userId, type, this._hash(code), expiresAt);
    return code;
  }

  // 校验验证码，成功后标记为已使用
  verifyCode(userId, type, code) {
    if (!code) return false;
    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM verification_codes
      WHERE user_id = ? AND type = ? AND used = 0
      ORDER BY id DESC LIMIT 1
    `).get(userId, type);
    if (!row) return false;
    if (new Date(row.expires_at).getTime() < Date.now()) return false;
    if (row.code_hash !== this._hash(code)) return false;
    db.prepare('UPDATE verification_codes SET used = 1 WHERE id = ?').run(row.id);
    return true;
  }

  // 忘记密码重置：生成重置码，返回 code（demo 直接返回，生产应发邮件/短信）
  createPasswordReset(userId) {
    const code = this.createCode(userId, 'password_reset');
    return code;
  }
}

module.exports = new VerifyService();