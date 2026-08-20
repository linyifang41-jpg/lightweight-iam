const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { getDb } = require('../models/database');

// Webhook 事件流：审计动作作为事件异步推送

function toRow(row) {
  return { ...row };
}

function list() {
  return getDb().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all().map(toRow);
}

function getWebhook(id) {
  return getDb().prepare('SELECT * FROM webhooks WHERE id = ?').get(id) || null;
}

function create({ url, secret, events, createdBy }) {
  const db = getDb();
  if (!url || !/^https?:\/\//.test(url)) throw new Error('URL 须为 http(s)');
  if (!secret) throw new Error('签名密钥必填');
  const id = uuidv4();
  db.prepare('INSERT INTO webhooks (id, url, secret, events, enabled, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP)')
    .run(id, url, secret, events || '*', createdBy || null);
  return getWebhook(id);
}

function update(id, { url, secret, events, enabled }) {
  const db = getDb();
  const w = getWebhook(id);
  if (!w) throw new Error('订阅不存在');
  if (url !== undefined && !/^https?:\/\//.test(url)) throw new Error('URL 须为 http(s)');
  db.prepare('UPDATE webhooks SET url = ?, secret = ?, events = ?, enabled = ? WHERE id = ?')
    .run(url !== undefined ? url : w.url, secret !== undefined ? secret : w.secret, events !== undefined ? events : w.events, enabled !== undefined ? (enabled ? 1 : 0) : w.enabled, id);
  return getWebhook(id);
}

function remove(id) {
  const db = getDb();
  const w = getWebhook(id);
  if (!w) throw new Error('订阅不存在');
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  return true;
}

// 匹配：* 全量；前缀 user.*；否则精确动作名
function matches(rule, action) {
  const r = rule.trim();
  if (r === '*') return true;
  if (r.endsWith('.*')) return action.startsWith(r.slice(0, -1));
  return r === action;
}

function dispatch(action, payload) {
  try {
    const hooks = getDb().prepare('SELECT * FROM webhooks WHERE enabled = 1').all();
    for (const h of hooks) {
      const rules = (h.events || '*').split(',').map(s => s.trim()).filter(Boolean);
      if (!rules.some(r => matches(r, action))) continue;
      const body = JSON.stringify({ event: action, ...payload, timestamp: new Date().toISOString() });
      const sig = crypto.createHmac('sha256', h.secret).update(body).digest('hex');
      send(h, body, sig);
    }
  } catch (e) {
    // webhook 分发失败不影响主流程
  }
}

async function send(h, body, sig) {
  try {
    const res = await fetch(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-IAM-Signature': `sha256=${sig}` },
      body,
      signal: AbortSignal.timeout(10000)
    });
    const ok = res.ok;
    getDb().prepare("UPDATE webhooks SET last_sent_at = CURRENT_TIMESTAMP, last_status = ?, last_error = ? WHERE id = ?")
      .run(ok ? 'ok' : 'error', ok ? null : `HTTP ${res.status}`, h.id);
  } catch (e) {
    getDb().prepare("UPDATE webhooks SET last_sent_at = CURRENT_TIMESTAMP, last_status = 'error', last_error = ? WHERE id = ?")
      .run(e.message, h.id);
  }
}

async function test(id) {
  const w = getWebhook(id);
  if (!w) throw new Error('订阅不存在');
  const body = JSON.stringify({ event: 'test', timestamp: new Date().toISOString() });
  const sig = crypto.createHmac('sha256', w.secret).update(body).digest('hex');
  try {
    const res = await fetch(w.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-IAM-Signature': `sha256=${sig}` },
      body,
      signal: AbortSignal.timeout(10000)
    });
    getDb().prepare("UPDATE webhooks SET last_sent_at = CURRENT_TIMESTAMP, last_status = ?, last_error = ? WHERE id = ?")
      .run(res.ok ? 'ok' : 'error', res.ok ? null : `HTTP ${res.status}`, id);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    getDb().prepare("UPDATE webhooks SET last_sent_at = CURRENT_TIMESTAMP, last_status = 'error', last_error = ? WHERE id = ?")
      .run(e.message, id);
    return { ok: false, status: 0, error: e.message };
  }
}

module.exports = { list, getWebhook, create, update, remove, dispatch, test };