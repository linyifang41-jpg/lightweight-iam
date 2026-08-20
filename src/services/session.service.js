const crypto = require('crypto');
const { getDb } = require('../models/database');
const policyService = require('./policy.service');

// 会话管理服务：记录登录设备/IP/UA、心跳、强制下线、并发控制
function detectDevice(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad')) return 'iOS 移动端';
  if (ua.includes('android')) return 'Android 移动端';
  if (ua.includes('mobile')) return '移动端';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';
  if (ua.includes('bot')) return '爬虫/脚本';
  return '未知设备';
}

// 设备标识：优先使用前端生成的 deviceId（localStorage），
// 未提供时用 UA 哈希兜底，保证同一设备重复登录复用一个会话
function resolveDeviceId(deviceId = '', userAgent = '') {
  if (deviceId && typeof deviceId === 'string' && deviceId.length <= 64) return deviceId;
  const ua = (userAgent || '').normalize('NFKC').toLowerCase().trim();
  return 'ua:' + crypto.createHash('sha256').update(ua || 'unknown').digest('hex').slice(0, 24);
}

class SessionService {
  // 创建会话；同一用户在同一设备已有 active 会话时复用（替换令牌），避免重复堆积
  createOrReuse({ userId, jti, refreshJti, ip, userAgent, deviceId }) {
    const db = getDb();
    const deviceKey = resolveDeviceId(deviceId, userAgent);
    const existing = db.prepare(
      "SELECT * FROM sessions WHERE user_id = ? AND device_id = ? AND status = 'active' AND expires_at > datetime('now')"
    ).get(userId, deviceKey);

    // 清理该用户修复前遗留的旧会话（device_id 为空，无法归属设备），避免列表堆积
    const legacy = db.prepare(
      "SELECT id FROM sessions WHERE user_id = ? AND device_id IS NULL AND status = 'active'"
    ).all(userId);

    const oldJtis = [];
    for (const r of legacy) {
      const { jtis } = this.revokeById(r.id, 'legacy_cleanup');
      oldJtis.push(...jtis);
    }

    if (existing) {
      db.prepare('UPDATE sessions SET jti = ?, refresh_jti = ?, device = ?, ip = ?, user_agent = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(jti || null, refreshJti || null, detectDevice(userAgent), ip || null, userAgent || null, existing.id);
      if (existing.jti) oldJtis.push(existing.jti);
      if (existing.refresh_jti) oldJtis.push(existing.refresh_jti);
      return { id: existing.id, replaced: true, oldJtis };
    }

    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO sessions (id, user_id, jti, refresh_jti, device, device_id, ip, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, jti || null, refreshJti || null, detectDevice(userAgent), deviceKey, ip || null, userAgent || null, expiresAt);
    return { id, replaced: false, oldJtis };
  }

  // 兼容旧调用（仍可单独创建，不查重）
  create(params) {
    return this.createOrReuse(params).id;
  }

  // 心跳：更新最后活跃时间
  touch(jti) {
    if (!jti) return;
    getDb().prepare('UPDATE sessions SET last_active_at = CURRENT_TIMESTAMP WHERE jti = ? AND status = ?').run(jti, 'active');
  }

  // 空闲超时判定：会话最后活跃时间超过 minutes 则吊销，返回是否超时及待加入黑名单的 jtis
  // 注意：last_active_at 由 SQLite CURRENT_TIMESTAMP(UTC) 写入，判定也用 SQLite datetime 比较，
  // 避免 JS new Date() 按本地时区解析导致 8 小时偏差
  enforceIdleTimeout(jti, minutes) {
    if (!jti || !minutes || minutes <= 0) return { timedOut: false, jtis: [] };
    const db = getDb();
    const active = db.prepare(
      "SELECT id FROM sessions WHERE jti = ? AND status = 'active' AND last_active_at >= datetime('now', ?)"
    ).get(jti, `-${minutes} minutes`);
    if (active) return { timedOut: false, jtis: [] };
    const row = db.prepare(
      "SELECT * FROM sessions WHERE jti = ? AND status = 'active'"
    ).get(jti);
    if (!row || !row.last_active_at) return { timedOut: false, jtis: [] };
    const { jtis } = this.revokeById(row.id, 'system_idle_timeout');
    return { timedOut: true, jtis };
  }

  // 刷新 token 后更新会话持有的 jti
  updateByRefreshJti(oldRefreshJti, { jti, refreshJti }) {
    if (!oldRefreshJti) return null;
    const row = getDb().prepare('SELECT id FROM sessions WHERE refresh_jti = ?').get(oldRefreshJti);
    if (!row) return null;
    getDb().prepare('UPDATE sessions SET jti = ?, refresh_jti = ?, last_active_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(jti || null, refreshJti || null, row.id);
    return row.id;
  }

  findByJti(jti) {
    return getDb().prepare('SELECT * FROM sessions WHERE jti = ?').get(jti);
  }

  findById(id) {
    return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  }

  listForUser(userId) {
    return getDb().prepare(
      'SELECT id, jti, device, ip, status, created_at, last_active_at FROM sessions WHERE user_id = ? AND status = ? ORDER BY created_at DESC'
    ).all(userId, 'active');
  }

  listAll() {
    return getDb().prepare(`
      SELECT s.id, s.user_id, u.username, s.device, s.ip, s.status, s.created_at, s.last_active_at, s.revoked_by
      FROM sessions s LEFT JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `).all();
  }

  // 吊销单个会话（返回其持有的 jti 列表，供 token 黑名单使用）
  revokeById(id, by) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    if (!row) throw new Error('会话不存在');
    if (row.status !== 'active') return { session: row, jtis: [] };
    db.prepare('UPDATE sessions SET status = ?, revoked_at = ?, revoked_by = ? WHERE id = ?')
      .run('revoked', new Date().toISOString(), by || 'admin', id);
    const jtis = [];
    if (row.jti) jtis.push(row.jti);
    if (row.refresh_jti) jtis.push(row.refresh_jti);
    return { session: row, jtis };
  }

  revokeByJti(jti, by) {
    if (!jti) return { session: null, jtis: [] };
    const row = getDb().prepare('SELECT * FROM sessions WHERE jti = ?').get(jti);
    if (!row) return { session: null, jtis: [] };
    return this.revokeById(row.id, by);
  }

  revokeAllForUser(userId, by) {
    const rows = getDb().prepare("SELECT id FROM sessions WHERE user_id = ? AND status = 'active'").all(userId);
    const allJtis = [];
    for (const r of rows) {
      const { jtis } = this.revokeById(r.id, by);
      allJtis.push(...jtis);
    }
    return allJtis;
  }

  // 并发上限控制：超过 max 时踢掉最旧会话，返回需要加入黑名单的 jti
  enforceMaxSessions(userId) {
    const max = policyService.maxSessionsPerUser();
    if (!max || max <= 0) return [];
    const db = getDb();
    const active = db.prepare("SELECT id FROM sessions WHERE user_id = ? AND status = 'active' ORDER BY created_at ASC").all(userId);
    if (active.length <= max) return [];
    const toKick = active.slice(0, active.length - max);
    const allJtis = [];
    for (const r of toKick) {
      const { jtis } = this.revokeById(r.id, 'system_max_sessions');
      allJtis.push(...jtis);
    }
    return allJtis;
  }
}

module.exports = new SessionService();