const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const adminService = require('./admin.service');
const policyService = require('./policy.service');
const auditService = require('./audit.service');
const totp = require('../utils/totp');

// 应急访问（Break-glass）：免审批 + TOTP 强认证 + 限时高权限 + 事后审查
// 状态机：started → ended（自主/管理端/到期）→ reviewed（事后审查）

function toEvent(row) {
  return {
    ...row,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at
  };
}

function getEvent(id) {
  const row = getDb().prepare('SELECT * FROM breakglass_events WHERE id = ?').get(id);
  return row ? toEvent(row) : null;
}

// 应急角色：设置指定或自动创建（含全部权限）
function ensureBreakglassRole() {
  const db = getDb();
  const configured = policyService.getSetting('breakglass_role_id');
  if (configured) return configured;
  let role = db.prepare("SELECT id FROM roles WHERE name = 'break-glass'").get();
  if (role) return role.id;
  const rid = uuidv4();
  db.prepare('INSERT INTO roles (id, name, description) VALUES (?, ?, ?)').run(rid, 'break-glass', '应急访问临时角色（全部权限）');
  const perms = db.prepare('SELECT id FROM permissions').all();
  for (const p of perms) {
    db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(rid, p.id);
  }
  return rid;
}

function toDate(ts) {
  if (!ts) return null;
  const s = ts.includes(' ') ? ts.replace(' ', 'T') : ts;
  return new Date(s.endsWith('Z') || s.endsWith('Z]') ? s : s + 'Z');
}

function expireOverdue() {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare("SELECT * FROM breakglass_events WHERE status = 'started'").all();
  for (const e of rows) {
    const dur = e.duration_minutes || policyService.getInt('breakglass_duration', 30);
    const start = toDate(e.started_at);
    if (!start) continue;
    const end = start.getTime() + dur * 60 * 1000;
    if (end <= now) {
      if (e.role_id) db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(e.user_id, e.role_id);
      db.prepare("UPDATE breakglass_events SET status = 'ended', ended_at = ?, ended_by = 'system' WHERE id = ?").run(new Date().toISOString(), e.id);
      const u = db.prepare('SELECT username FROM users WHERE id = ?').get(e.user_id);
      auditService.log({ userId: e.user_id, username: u ? u.username : e.user_id, action: 'breakglass.end', ip: null, detail: { id: e.id, by: 'system', auto: true } });
    }
  }
}

// 发起应急访问：TOTP step-up
function start({ userId, code, reason, durationMinutes }) {
  const db = getDb();
  if (policyService.getSetting('breakglass_enabled') !== '1') throw new Error('应急访问已停用');
  const user = db.prepare('SELECT id, username, status, totp_enabled, totp_secret FROM users WHERE id = ?').get(userId);
  if (!user || user.status !== 'active') throw new Error('账号状态异常');
  if (!user.totp_enabled || !user.totp_secret) throw new Error('需先开启 TOTP 两步验证');
  if (!code || !totp.verifyCode(user.totp_secret, code)) throw new Error('动态码校验失败');
  if (!reason || !reason.trim()) throw new Error('应急理由必填');
  const maxDur = policyService.getInt('breakglass_duration', 30);
  const dur = parseInt(durationMinutes, 10) || maxDur;
  if (dur < 1 || dur > maxDur) throw new Error(`应急时长须在 1~${maxDur} 分钟内`);
  const active = db.prepare("SELECT id FROM breakglass_events WHERE user_id = ? AND status = 'started'").get(userId);
  if (active) throw new Error('已有进行中的应急事件，请先结束');

  const roleId = ensureBreakglassRole();
  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId);
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  const id = uuidv4();
  db.prepare(`INSERT INTO breakglass_events (id, user_id, reason, duration_minutes, status, role_id, role_name, started_at, created_at)
    VALUES (?, ?, ?, ?, 'started', ?, ?, ?, CURRENT_TIMESTAMP)`)
    .run(id, userId, reason.trim(), dur, roleId, role ? role.name : roleId, new Date().toISOString());
  return getEvent(id);
}

// 结束：自主（仅自己 active）或管理端（任意 active）
function end(id, operator) {
  const db = getDb();
  const e = getEvent(id);
  if (!e) throw new Error('应急事件不存在');
  if (e.status !== 'started') throw new Error('该事件已结束');
  if (e.role_id) db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(e.user_id, e.role_id);
  db.prepare("UPDATE breakglass_events SET status = 'ended', ended_at = ?, ended_by = ? WHERE id = ?").run(new Date().toISOString(), operator.username, id);
  return getEvent(id);
}

// 事后审查（仅 ended）
function review(id, reviewerName, reviewNote) {
  const e = getEvent(id);
  if (!e) throw new Error('应急事件不存在');
  if (e.status === 'reviewed') throw new Error('该事件已审查');
  if (e.status !== 'ended') throw new Error('仅可审查已结束的应急事件');
  getDb().prepare("UPDATE breakglass_events SET status = 'reviewed', reviewed_by = ?, review_note = ? WHERE id = ?")
    .run(reviewerName, reviewNote || null, id);
  return getEvent(id);
}

function list(status) {
  expireOverdue();
  let rows;
  if (status) {
    rows = getDb().prepare('SELECT * FROM breakglass_events WHERE status = ? ORDER BY created_at DESC').all(status);
  } else {
    rows = getDb().prepare('SELECT * FROM breakglass_events ORDER BY created_at DESC').all();
  }
  return rows.map(toEvent);
}

function myEvents(userId) {
  expireOverdue();
  return getDb().prepare('SELECT * FROM breakglass_events WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(toEvent);
}

module.exports = { start, end, review, list, myEvents, getEvent, expireOverdue };