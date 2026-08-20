const bcrypt = require('bcryptjs');
const { getDb } = require('../models/database');

// 安全策略服务：密码策略、弱密码黑名单、登录锁定、密码过期
const DEFAULT_SETTINGS = {
  min_password_length: '8',
  require_letter: '1',
  require_number: '1',
  require_special: '0',
  password_history_count: '3',
  password_max_age_days: '0',
  max_sessions_per_user: '0',
  session_idle_timeout_minutes: '15',
  login_fail_lock_count: '5',
  login_fail_lock_minutes: '15',
  audit_retention_days: '365',
  login_otp_enabled: '0',
  scim_token: '',
  approval_levels: '1',
  default_account_policy: '0',
  certification_due_action: 'revoke',
  workflow_engine_enabled: '0',
  jit_max_minutes: '480',
  jit_enabled: '1',
  analytics_inactive_days: '90',
  analytics_sensitive_perms: 'cert:manage,credential:manage,oidc:manage,sa:manage,gov:manage,policy:manage,role:manage,approval:manage,dept:manage,group:manage,session:manage,abac:manage,workflow:manage,analytics:view',
  analytics_perm_threshold: '15',
  analytics_min_support: '2',
  breakglass_enabled: '1',
  breakglass_duration: '30',
  breakglass_role_id: ''
};

// 常见弱密码黑名单（生产可扩展为字典文件/接口）
const WEAK_PASSWORDS = [
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  'qwerty', 'qwerty123', 'abc123', 'abcdef', 'iloveyou', 'welcome',
  'letmein', 'monkey', 'dragon', 'football', '111111', '000000',
  'admin', 'admin123', 'administrator', 'root', 'root123',
  'a123456', 'a1234567', 'a12345678', '12345678a', '12345678b',
  'woaini', 'aixin', 'asdfgh', 'zxcvbn', '1q2w3e4r', 'qazwsx'
];

class PolicyService {
  getSetting(key) {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : (DEFAULT_SETTINGS[key] !== undefined ? DEFAULT_SETTINGS[key] : null);
  }

  getInt(key, def) {
    const v = parseInt(this.getSetting(key), 10);
    return Number.isNaN(v) ? def : v;
  }

  getAllSettings() {
    const rows = getDb().prepare('SELECT key, value FROM settings').all();
    const merged = { ...DEFAULT_SETTINGS };
    for (const r of rows) {
      if (DEFAULT_SETTINGS[r.key] !== undefined) merged[r.key] = r.value;
    }
    return merged;
  }

  updateSettings(obj) {
    const db = getDb();
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const tx = db.transaction((entries) => {
      for (const [k, v] of entries) upsert.run(k, v);
    });
    tx(Object.entries(obj).filter(([k]) => DEFAULT_SETTINGS[k] !== undefined));
    return this.getAllSettings();
  }

  // 基础密码强度校验（不含历史）
  validatePassword(password) {
    const minLen = this.getInt('min_password_length', 8);
    if (!password) return { valid: false, reason: '请输入密码' };
    if (password.length < minLen) return { valid: false, reason: `密码至少 ${minLen} 位` };
    if (this.getSetting('require_letter') === '1' && !/[a-zA-Z]/.test(password)) {
      return { valid: false, reason: '密码需包含字母' };
    }
    if (this.getSetting('require_number') === '1' && !/\d/.test(password)) {
      return { valid: false, reason: '密码需包含数字' };
    }
    if (this.getSetting('require_special') === '1' && !/[^a-zA-Z0-9]/.test(password)) {
      return { valid: false, reason: '密码需包含特殊字符' };
    }
    if (WEAK_PASSWORDS.includes(password.toLowerCase())) {
      return { valid: false, reason: '密码过于常见，容易被破解，请更换' };
    }
    return { valid: true };
  }

  // 带历史防重用的校验（改密/重置时使用）
  async validatePasswordForUser(userId, password) {
    const check = this.validatePassword(password);
    if (!check.valid) return check;
    const historyCount = this.getInt('password_history_count', 3);
    if (historyCount > 0) {
      const history = getDb().prepare(
        'SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?'
      ).all(userId, historyCount);
      for (const h of history) {
        if (await bcrypt.compare(password, h.password_hash)) {
          return { valid: false, reason: `不能使用最近 ${historyCount} 次使用过的密码` };
        }
      }
    }
    return { valid: true };
  }

  // 记录新密码到历史表，并裁剪只保留最近 N 条
  recordPassword(userId, passwordHash) {
    const db = getDb();
    db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)').run(userId, passwordHash);
    const historyCount = this.getInt('password_history_count', 3);
    if (historyCount > 0) {
      db.prepare(`
        DELETE FROM password_history WHERE user_id = ? AND id NOT IN (
          SELECT id FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?
        )
      `).run(userId, userId, historyCount);
    }
  }

  // 密码是否过期（password_max_age_days = 0 表示永不过期）
  isPasswordExpired(user) {
    const days = this.getInt('password_max_age_days', 0);
    if (days <= 0) return false;
    if (!user.password_changed_at) return false;
    const changed = new Date(user.password_changed_at).getTime();
    return Date.now() - changed > days * 24 * 60 * 60 * 1000;
  }

  // ===== 登录锁定 =====
  isLocked(user) {
    if (!user || !user.locked_until) return false;
    return new Date(user.locked_until).getTime() > Date.now();
  }

  remainingLockSeconds(user) {
    if (!user || !user.locked_until) return 0;
    const ms = new Date(user.locked_until).getTime() - Date.now();
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  }

  registerFailure(userId) {
    const count = this.getInt('login_fail_lock_count', 5);
    const minutes = this.getInt('login_fail_lock_minutes', 15);
    const db = getDb();
    const user = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(userId);
    const attempts = (user && user.failed_attempts ? user.failed_attempts : 0) + 1;
    if (attempts >= count) {
      const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?').run(until, userId);
      return { locked: true, minutes };
    }
    db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(attempts, userId);
    return { locked: false, remaining: count - attempts };
  }

  resetFailures(userId) {
    getDb().prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);
  }

  // 并发会话上限（0 表示不限）
  maxSessionsPerUser() {
    return this.getInt('max_sessions_per_user', 0);
  }
}

module.exports = new PolicyService();