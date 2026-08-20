// Token 服务：管理黑名单（用于单点登出、token 吊销、重置密码后全量吊销）
const { getDb } = require('../models/database');

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

class TokenService {
  // 将单个 token 加入黑名单
  async revoke(decoded) {
    if (!decoded || !decoded.jti) return;
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO token_blacklist (jti, exp) VALUES (?, ?)')
      .run(decoded.jti, decoded.exp * 1000);
    // 清理过期黑名单
    db.prepare('DELETE FROM token_blacklist WHERE exp < ?').run(Date.now());
  }

  // 吊销某个用户的全部 token（重置密码/修改密码后调用）
  // 通过插入一条"用户级吊销"记录实现，isRevoked 检查时对比签发时间
  revokeAllForUser(userId) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO token_blacklist (jti, exp, user_id, created_at) VALUES (?, ?, ?, ?)')
      .run(`user_revoke:${userId}`, Date.now() + TEN_YEARS_MS, userId, new Date().toISOString());
  }

  // 按 jti 直接吊销（强制下线/踢出时使用）
  revokeJti(jti) {
    if (!jti) return;
    getDb().prepare('INSERT OR IGNORE INTO token_blacklist (jti, exp) VALUES (?, ?)')
      .run(jti, Date.now() + TEN_YEARS_MS);
  }

  // 批量吊销多个 jti
  revokeJtis(jtis) {
    for (const jti of jtis || []) this.revokeJti(jti);
  }

  // 检查 token 是否在黑名单（单个吊销 或 用户级吊销且签发早于吊销时间）
  isRevoked(decoded) {
    if (!decoded || !decoded.jti) return true;
    const db = getDb();
    // 单个 token 吊销
    const row = db.prepare('SELECT jti FROM token_blacklist WHERE jti = ?').get(decoded.jti);
    if (row) return true;
    // 用户级吊销：token 签发时间（iat，秒级）早于吊销时间则失效
    // 注意：JWT 的 iat 为秒精度，吊销时间统一取秒级比较，避免同秒新签发 token 被误吊销
    if (decoded.userId && decoded.iat) {
      const revokeRow = db.prepare('SELECT created_at FROM token_blacklist WHERE jti = ?').get(`user_revoke:${decoded.userId}`);
      if (revokeRow) {
        const revokeTimeSec = Math.floor(new Date(revokeRow.created_at).getTime() / 1000);
        if (decoded.iat < revokeTimeSec) return true;
      }
    }
    return false;
  }
}

module.exports = new TokenService();