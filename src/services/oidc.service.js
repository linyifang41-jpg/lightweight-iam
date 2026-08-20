const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const config = require('../../config');

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

function getRsaKey() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('oidc_rsa_private_key');
  if (row && row.value) {
    return { privateKey: row.value };
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('oidc_rsa_private_key', privatePem);
  return { privateKey: privatePem, publicKey };
}

function jwkFromPublicKey() {
  const { privateKey } = getRsaKey();
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid: crypto.createHash('sha256').update(privateKey).digest('base64url').slice(0, 16),
    n: jwk.n,
    e: jwk.e,
  };
}

function signIdToken({ clientId, userId, username, name, email, phone, nonce }) {
  const { privateKey } = getRsaKey();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: config.urls.iam,
    sub: userId,
    aud: clientId,
    exp: now + 60 * 60,
    iat: now,
    nonce,
  };
  if (username) payload.preferred_username = username;
  if (name) payload.name = name;
  if (email) payload.email = email;
  if (phone) payload.phone_number = phone;
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', header: { kid: jwkFromPublicKey().kid } });
}

function generateCode({ clientId, userId, nonce }) {
  const db = getDb();
  const code = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString();
  db.prepare('INSERT INTO oidc_auth_codes (code, client_id, user_id, nonce, expires_at, used) VALUES (?, ?, ?, ?, ?, 0)')
    .run(code, clientId, userId, nonce || null, expiresAt);
  return code;
}

function consumeCode({ code, clientId }) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM oidc_auth_codes WHERE code = ?').get(code);
  if (!row || row.client_id !== clientId || row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE oidc_auth_codes SET used = 1 WHERE code = ?').run(code);
  return { userId: row.user_id, nonce: row.nonce };
}

function hashSecret(secret) {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function createClient({ name, redirectUris }) {
  const db = getDb();
  const id = uuidv4();
  const clientId = 'oidc-' + crypto.randomBytes(4).toString('hex');
  const clientSecret = crypto.randomBytes(32).toString('base64url');
  const uris = (Array.isArray(redirectUris) ? redirectUris : []).map(u => u.trim()).filter(Boolean);
  db.prepare('INSERT INTO oidc_clients (id, client_id, client_secret_hash, name, redirect_uris) VALUES (?, ?, ?, ?, ?)')
    .run(id, clientId, hashSecret(clientSecret), name, JSON.stringify(uris));
  return { id, clientId, clientSecret, name, redirectUris: uris };
}

function listClients() {
  const db = getDb();
  return db.prepare('SELECT id, client_id, name, redirect_uris, created_at FROM oidc_clients').all()
    .map(r => ({ id: r.id, clientId: r.client_id, name: r.name, redirectUris: JSON.parse(r.redirect_uris || '[]'), createdAt: r.created_at }));
}

function getClientByClientId(clientId) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM oidc_clients WHERE client_id = ?').get(clientId);
  if (!r) return null;
  return { id: r.id, clientId: r.client_id, clientSecretHash: r.client_secret_hash, name: r.name, redirectUris: JSON.parse(r.redirect_uris || '[]') };
}

function verifyClient(clientId, clientSecret) {
  const c = getClientByClientId(clientId);
  if (!c) return null;
  if (c.clientSecretHash !== hashSecret(clientSecret)) return null;
  return c;
}

function deleteClient(id) {
  const db = getDb();
  const c = db.prepare('SELECT client_id FROM oidc_clients WHERE id = ?').get(id);
  if (!c) return false;
  db.prepare('DELETE FROM oidc_auth_codes WHERE client_id = ?').run(c.client_id);
  db.prepare('DELETE FROM oidc_clients WHERE id = ?').run(id);
  return true;
}

module.exports = {
  getRsaKey,
  jwkFromPublicKey,
  signIdToken,
  generateCode,
  consumeCode,
  createClient,
  listClients,
  getClientByClientId,
  verifyClient,
  deleteClient,
  hashSecret,
  AUTH_CODE_TTL_MS,
};