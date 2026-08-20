const express = require('express');
const { safeVerify } = require('../utils/jwt');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');
const sessionService = require('../services/session.service');
const config = require('../../config');
const { safeRedirect } = require('../utils/safe-redirect');

const router = express.Router();

// SSO 验证接口 - 应用调用此接口验证 token 并获取用户信息
// 使用 POST + body 传递 token，避免 token 出现在 URL（日志/历史记录）
router.post('/verify', async (req, res) => {
  const token = req.body && req.body.token;

  if (!token) {
    return res.status(401).json({ valid: false, error: '缺少 token' });
  }

  const decoded = safeVerify(token);
  if (!decoded || decoded.type === 'refresh') {
    return res.status(401).json({ valid: false, error: 'token 无效或已过期', expired: true });
  }

  // 检查 token 是否被吊销（单点登出）
  if (tokenService.isRevoked(decoded)) {
    return res.status(401).json({ valid: false, error: 'token 已失效，请重新登录' });
  }

  const user = await userService.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ valid: false, error: '用户不存在或已禁用' });
  }

  res.json({
    valid: true,
    user: {
      userId: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone
    }
  });
});

// SSO 检查当前登录状态（通过 cookie）
router.get('/session', async (req, res) => {
  const token = req.cookies && req.cookies[config.sso.cookieName];

  if (!token) {
    return res.json({ loggedIn: false });
  }

  const decoded = safeVerify(token);
  if (!decoded || decoded.type !== 'access') {
    return res.json({ loggedIn: false });
  }

  if (tokenService.isRevoked(decoded)) {
    return res.json({ loggedIn: false });
  }

  const user = await userService.findById(decoded.userId);
  if (!user) {
    return res.json({ loggedIn: false });
  }

  res.json({
    loggedIn: true,
    user: { userId: user.id, username: user.username, email: user.email, phone: user.phone }
  });
});

// SSO 刷新跳转端点：应用检测到 token 过期时，重定向到这里
// 验证 refresh token 有效则刷新并跳回原应用，实现无感续期
router.get('/refresh', async (req, res) => {
  const rawRedirect = req.query.redirect;
  // open redirect 防护：只允许跳转到白名单内的关联系统
  const redirect = safeRedirect(rawRedirect, '/');
  const refreshToken = req.cookies && req.cookies[config.sso.refreshCookieName];

  if (!refreshToken) {
    // 没有 refresh token，跳登录页
    return res.redirect(`/login.html?redirect=${encodeURIComponent(redirect)}`);
  }

  const decoded = safeVerify(refreshToken);
  if (!decoded || decoded.type !== 'refresh' || tokenService.isRevoked(decoded)) {
    return res.redirect(`/login.html?redirect=${encodeURIComponent(redirect)}`);
  }

  const user = await userService.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.redirect(`/login.html?redirect=${encodeURIComponent(redirect)}`);
  }

  // 刷新 token
  const { generateTokens } = require('../utils/jwt');
  const tokens = generateTokens(user);

  // 更新会话持有的 jti + 刷新令牌轮换
  sessionService.updateByRefreshJti(decoded.jti, { jti: tokens.accessJti, refreshJti: tokens.refreshJti });
  tokenService.revoke(decoded);

  res.cookie(config.sso.cookieName, tokens.accessToken, {
    path: '/',
    httpOnly: true,
    maxAge: config.sso.cookieMaxAge,
    sameSite: 'lax'
  });
  res.cookie(config.sso.refreshCookieName, tokens.refreshToken, {
    path: '/',
    httpOnly: true,
    maxAge: config.sso.refreshCookieMaxAge,
    sameSite: 'lax'
  });

  // 跳回原应用
  res.redirect(redirect);
});

module.exports = router;