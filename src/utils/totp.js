// TOTP 实现（RFC 6238）
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Base32 编码（RFC 4648，无 padding）
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

// Base32 解码（容忍小写和空格）
function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 生成一个 TOTP 密钥（20 字节随机 → base32）
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// 计算指定时间戳的 TOTP 码
function generateCode(secret, timestamp = Date.now(), window = 0) {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / 30) + window;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return binary.toString().padStart(6, '0');
}

// 验证 TOTP 码（允许前后 1 个时间窗口，容忍时钟偏移）
function verifyCode(secret, code) {
  if (!code || !/^\d{6}$/.test(code)) return false;
  for (let window = -1; window <= 1; window++) {
    if (generateCode(secret, Date.now(), window) === code) {
      return true;
    }
  }
  return false;
}

// 生成 otpauth:// URI（供 Google Authenticator 等扫码）
function generateOtpAuthUri(secret, username, issuer = 'IAM') {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, generateCode, verifyCode, generateOtpAuthUri, base32Encode };