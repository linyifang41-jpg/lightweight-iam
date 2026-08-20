const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { getDb } = require('../models/database');
const config = require('../../config');

// 服务账号（非人类身份）：client_id/secret 凭据 + client_credentials 短期令牌
// ver 版本号：重发 secret 或禁用时递增，旧令牌即时作废

const VALID_STATUSES = ['active', 'disabled'];

function genClientId() {
  return crypto.randomBytes(18).toString('base64url');
}

function genClientSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function toRecord(row) {
  if (!row) return null;
  const { client_secret_hash, ...rest } = row;
  return { ...rest, permissions: JSON.parse(row.permissions || '[]') };
}

function findById(id) {
  return toRecord(getDb().prepare('SELECT * FROM service_accounts WHERE id = ?').get(id));
}

function findByClientId(clientId) {
  return toRecord(getDb().prepare('SELECT * FROM service_accounts WHERE client_id = ?').get(clientId));
}

function listServiceAccounts() {
  return getDb().prepare('SELECT * FROM service_accounts ORDER BY created_at DESC').all().map(toRecord);
}

function validatePermissions(permissions) {
  if (!Array.isArray(permissions) || !permissions.length) throw new Error('至少分配一个权限');
  const names = new Set(getDb().prepare('SELECT name FROM permissions').all().map(r => r.name));
  for (const p of permissions) {
    if (!names.has(p)) throw new Error(`权限不存在：${p}`);
  }
  return [...new Set(permissions)];
}

function createServiceAccount({ name, description, permissions, ownerId, tokenTtlMinutes }) {
  const db = getDb();
  if (!name || !String(name).trim()) throw new Error('名称不能为空');
  if (db.prepare('SELECT id FROM service_accounts WHERE name = ?').get(name)) throw new Error('服务账号名称已存在');
  const perms = validatePermissions(permissions);
  const ttl = tokenTtlMinutes ? parseInt(tokenTtlMinutes, 10) : 15;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) throw new Error('token 有效期需为 1-1440 分钟');

  const id = uuidv4();
  const clientId = genClientId();
  const clientSecret = genClientSecret();
  db.prepare('INSERT INTO service_accounts (id, name, description, client_id, client_secret_hash, status, permissions, ver, token_ttl_minutes, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, name.trim(), description || null, clientId, bcrypt.hashSync(clientSecret, 10), 'active', JSON.stringify(perms), 1, ttl, ownerId || null, new Date().toISOString());
  return { serviceAccount: findById(id), clientId, clientSecret };
}

function updateServiceAccount(id, patch) {
  const db = getDb();
  const sa = db.prepare('SELECT * FROM service_accounts WHERE id = ?').get(id);
  if (!sa) throw new Error('服务账号不存在');

  const name = patch.name !== undefined ? String(patch.name).trim() : sa.name;
  if (!name) throw new Error('名称不能为空');
  if (name !== sa.name && db.prepare('SELECT id FROM service_accounts WHERE name = ? AND id != ?').get(name, id)) {
    throw new Error('服务账号名称已存在');
  }
  let status = patch.status !== undefined ? patch.status : sa.status;
  if (!VALID_STATUSES.includes(status)) throw new Error('status 只能是 active 或 disabled');
  let permissions = patch.permissions !== undefined ? validatePermissions(patch.permissions) : JSON.parse(sa.permissions || '[]');
  let ttl = patch.tokenTtlMinutes !== undefined ? parseInt(patch.tokenTtlMinutes, 10) : sa.token_ttl_minutes;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 1440) throw new Error('token 有效期需为 1-1440 分钟');

  // 禁用或 secret 轮换前 ver 递增
  const ver = (status !== 'active' && sa.status === 'active') ? sa.ver + 1 : sa.ver;

  db.prepare('UPDATE service_accounts SET name = ?, description = ?, status = ?, permissions = ?, token_ttl_minutes = ?, ver = ?, expires_at = ? WHERE id = ?')
    .run(name, patch.description !== undefined ? (patch.description || null) : sa.description, status, JSON.stringify(permissions), ttl, ver, patch.expiresAt !== undefined ? (patch.expiresAt || null) : sa.expires_at, id);
  return findById(id);
}

function regenerateSecret(id) {
  const db = getDb();
  const sa = db.prepare('SELECT id, ver FROM service_accounts WHERE id = ?').get(id);
  if (!sa) throw new Error('服务账号不存在');
  const clientSecret = genClientSecret();
  db.prepare('UPDATE service_accounts SET client_secret_hash = ?, ver = ? WHERE id = ?')
    .run(bcrypt.hashSync(clientSecret, 10), sa.ver + 1, id);
  return { clientId: db.prepare('SELECT client_id FROM service_accounts WHERE id = ?').get(id).client_id, clientSecret };
}

function deleteServiceAccount(id) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM service_accounts WHERE id = ?').get(id)) throw new Error('服务账号不存在');
  db.prepare('DELETE FROM service_accounts WHERE id = ?').run(id);
  return { success: true };
}

// 校验 client_id/secret，签发短期访问令牌
async function issueToken({ clientId, clientSecret, scope }) {
  const row = getDb().prepare('SELECT * FROM service_accounts WHERE client_id = ?').get(clientId);
  if (!row) return { error: 'invalid_client', status: 401 };
  const sa = toRecord(row);
  if (sa.status !== 'active') return { error: 'invalid_client', status: 401 };
  if (sa.expires_at && new Date(sa.expires_at).getTime() < Date.now()) return { error: 'invalid_client', status: 401 };
  const ok = await bcrypt.compare(clientSecret, row.client_secret_hash);
  if (!ok) return { error: 'invalid_client', status: 401 };

  const ttlMinutes = sa.token_ttl_minutes || 15;
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    { sub: sa.id, name: sa.name, type: 'client', ver: sa.ver, scope: scope || null },
    config.jwt.secret,
    { expiresIn: `${ttlMinutes}m`, jwtid: jti }
  );
  getDb().prepare('UPDATE service_accounts SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), sa.id);
  return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlMinutes * 60, jti };
}

module.exports = {
  createServiceAccount,
  updateServiceAccount,
  regenerateSecret,
  deleteServiceAccount,
  listServiceAccounts,
  findById,
  findByClientId,
  issueToken
};