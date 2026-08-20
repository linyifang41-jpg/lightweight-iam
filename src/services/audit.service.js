const { getDb } = require('../models/database');
const policyService = require('./policy.service');
const webhookService = require('./webhook.service');

// 审计日志服务：记录敏感操作
class AuditService {
  log({ userId, username, action, ip, detail }) {
    try {
      getDb().prepare(
        'INSERT INTO audit_logs (user_id, username, action, ip, detail) VALUES (?, ?, ?, ?, ?)'
      ).run(userId || null, username || null, action, ip || null, detail ? JSON.stringify(detail) : null);
      this._lazyCleanup();
      // 事件流：审计动作异步推送 webhook（不阻塞主流程）
      webhookService.dispatch(action, { userId: userId || null, username: username || null, ip: ip || null, detail: detail || null });
    } catch (e) {
      // 审计失败不影响主流程
      console.error('审计日志写入失败:', e.message);
    }
  }

  // 惰性清理超期审计日志：audit_retention_days>0 且距上次清理≥1小时才执行，每次最多 5000 条
  _lazyCleanup() {
    try {
      const db = getDb();
      const days = policyService.getInt('audit_retention_days', 365);
      if (!days || days <= 0) return;

      const last = policyService.getSetting('last_audit_cleanup_at');
      if (last) {
        const withinHour = db.prepare("SELECT 1 AS r WHERE datetime('now') < datetime(?, '+1 hours')").get(last);
        if (withinHour) return;
      }

      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run('last_audit_cleanup_at', new Date().toISOString());

      db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?) LIMIT 5000").run(`-${days} days`);
    } catch (e) {
      console.error('审计日志清理失败:', e.message);
    }
  }

  list(limit = 50) {
    return getDb().prepare(
      'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }
}

module.exports = new AuditService();