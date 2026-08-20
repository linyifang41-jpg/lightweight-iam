const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../../config');

function generateTokens(user) {
  // access token 带唯一 jti，用于登出时加入黑名单
  const accessJti = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  const accessToken = jwt.sign(
    { userId: user.id, username: user.username, type: 'access' },
    config.jwt.secret,
    { expiresIn: config.jwt.accessExpiresIn, jwtid: accessJti }
  );
  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh' },
    config.jwt.secret,
    { expiresIn: config.jwt.refreshExpiresIn, jwtid: refreshJti }
  );
  return { accessToken, refreshToken, accessJti, refreshJti };
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

// TOTP 登录临时令牌（5 分钟有效，仅用于两步验证阶段）
function signLoginToken(userId, username) {
  return jwt.sign(
    { userId, username, type: 'login_pending' },
    config.jwt.secret,
    { expiresIn: '5m', jwtid: crypto.randomUUID() }
  );
}

// 强制改密临时令牌（10 分钟有效，仅用于"下次登录必须改密"流程）
function signChangeToken(userId, username) {
  return jwt.sign(
    { userId, username, type: 'change_pending' },
    config.jwt.secret,
    { expiresIn: '10m', jwtid: crypto.randomUUID() }
  );
}

// 安全地验证 token，失败返回 null 而不是抛异常
function safeVerify(token) {
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch (e) {
    return null;
  }
}

module.exports = { generateTokens, verifyToken, safeVerify, signLoginToken, signChangeToken };