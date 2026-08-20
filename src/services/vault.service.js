const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');

// 凭据保险库服务（PAM Vault 雏形）：AES-256-GCM 加密存储特权账号凭据
// 密钥由 VAULT_KEY 派生；未配置时回退到 JWT_SECRET 派生，保证开箱可用

function deriveKey() {
  const source = process.env.VAULT_KEY || process.env.JWT_SECRET || 'iam-vault-fallback-key';
  return crypto.createHash('sha256').update(source).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const [, ivB64, tagB64, dataB64] = String(payload).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

class VaultService {
  listCredentials() {
    return getDb().prepare(
      'SELECT id, name, system, username, note, created_at, updated_at FROM credentials ORDER BY created_at DESC'
    ).all();
  }

  createCredential({ name, system, username, password, note }) {
    if (!name || !password) throw new Error('名称和密码为必填项');
    const id = uuidv4();
    getDb().prepare(
      'INSERT INTO credentials (id, name, system, username, encrypted_password, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, name, system || null, username || null, encrypt(password), note || null);
    return { id };
  }

  deleteCredential(id) {
    const result = getDb().prepare('DELETE FROM credentials WHERE id = ?').run(id);
    if (result.changes === 0) throw new Error('凭据不存在');
  }

  revealCredential(id) {
    const row = getDb().prepare('SELECT * FROM credentials WHERE id = ?').get(id);
    if (!row) throw new Error('凭据不存在');
    return { id: row.id, name: row.name, system: row.system, username: row.username, password: decrypt(row.encrypted_password), note: row.note };
  }
}

module.exports = new VaultService();