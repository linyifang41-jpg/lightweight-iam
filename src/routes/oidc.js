const express = require('express');
const oidcService = require('../services/oidc.service');
const tokenService = require('../services/token.service');
const sessionService = require('../services/session.service');
const userService = require('../services/user.service');
const auditService = require('../services/audit.service');
const { safeVerify } = require('../utils/jwt');
const { generateTokens } = require('../utils/jwt');
const config = require('../../config');

const router = express.Router();
router.use(express.urlencoded({ extended: true }));

// OIDC 发现文档
router.get('/.well-known/openid-configuration', (req, res) => {
  res.json({
    issuer: config.urls.iam,
    authorization_endpoint: `${config.urls.iam}/oidc/authorize`,
    token_endpoint: `${config.urls.iam}/oidc/token`,
    userinfo_endpoint: `${config.urls.iam}/oidc/userinfo`,
    jwks_uri: `${config.urls.iam}/oidc/jwks`,
    revocation_endpoint: `${config.urls.iam}/oauth/revoke`,
    introspection_endpoint: `${config.urls.iam}/oauth/introspect`,
    scopes_supported: ['openid', 'profile', 'email', 'phone'],
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    grant_types_supported: ['authorization_code', 'refresh_token', 'client_credentials'],
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  });
});

// JWKS
router.get('/oidc/jwks', (req, res) => {
  res.json({ keys: [oidcService.jwkFromPublicKey()] });
});

// 授权端点（Authorization Code Flow）
router.get('/oidc/authorize', async (req, res) => {
  const { client_id, redirect_uri, response_type, scope, state, nonce } = req.query;

  const client = oidcService.getClientByClientId(client_id || '');
  if (!client) {
    return res.status(400).json({ error: 'invalid_request', error_description: '未知 client_id' });
  }
  if (response_type !== 'code') {
    return res.status(400).json({ error: 'unsupported_response_type' });
  }
  if (!client.redirectUris.includes(redirect_uri || '')) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri 未在白名单' });
  }
  if (scope && !scope.split(' ').includes('openid')) {
    return res.status(400).json({ error: 'invalid_scope' });
  }

  const buildReturnUrl = (code) => {
    const qs = new URLSearchParams({ code });
    if (state) qs.set('state', state);
    return `${redirect_uri}${redirect_uri.includes('?') ? '&' : '?'}${qs.toString()}`;
  };

  // 检查登录态（sso_token cookie）
  const token = req.cookies && req.cookies[config.sso.cookieName];
  let user = null;
  if (token) {
    const decoded = safeVerify(token);
    if (decoded && decoded.type === 'access' && !tokenService.isRevoked(decoded)) {
      user = await userService.findById(decoded.userId);
      if (user && user.status !== 'active') user = null;
    }
  }

  if (!user) {
    const loginRedirect = `${config.urls.iam}/oidc/authorize?${new URLSearchParams({ client_id, redirect_uri, response_type, scope, state, nonce }).toString()}`;
    return res.redirect(`/login.html?redirect=${encodeURIComponent(loginRedirect)}`);
  }

  const code = oidcService.generateCode({ clientId: client.clientId, userId: user.id, nonce });
  auditService.log({ userId: user.id, username: user.username, action: 'oidc.authorize', ip: req.ip, detail: { clientId: client.clientId } });
  res.redirect(buildReturnUrl(code));
});

// Token 端点
router.post('/oidc/token', async (req, res) => {
  const { grant_type, code, refresh_token, client_id, client_secret } = req.body;
  const client = oidcService.verifyClient(client_id || '', client_secret || '');
  if (!client) {
    return res.status(401).json({ error: 'invalid_client' });
  }

  if (grant_type === 'refresh_token') {
    if (!refresh_token) {
      return res.status(400).json({ error: 'invalid_request', error_description: '缺少 refresh_token' });
    }
    const decoded = safeVerify(refresh_token);
    if (!decoded || decoded.type !== 'refresh' || tokenService.isRevoked(decoded)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'refresh token 无效、过期或已失效' });
    }
    const user = await userService.findById(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(400).json({ error: 'invalid_grant', error_description: '用户不可用' });
    }

    // 轮换：签发新令牌，旧 refresh 立即失效
    const tokens = generateTokens(user);
    sessionService.updateByRefreshJti(decoded.jti, { jti: tokens.accessJti, refreshJti: tokens.refreshJti });
    tokenService.revoke(decoded);
    const idToken = oidcService.signIdToken({
      clientId: client.clientId, userId: user.id, username: user.username,
      name: user.name, email: user.email, phone: user.phone, nonce: null,
    });
    auditService.log({ userId: user.id, username: user.username, action: 'oidc.refresh', ip: req.ip, detail: { clientId: client.clientId } });
    return res.json({
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: 30 * 60,
      refresh_token: tokens.refreshToken,
      id_token: idToken,
    });
  }

  if (grant_type !== 'authorization_code') {
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }
  const result = oidcService.consumeCode({ code: code || '', clientId: client.clientId });
  if (!result) {
    return res.status(400).json({ error: 'invalid_grant', error_description: '授权码无效、过期或已被使用' });
  }

  const user = await userService.findById(result.userId);
  if (!user || user.status !== 'active') {
    return res.status(400).json({ error: 'invalid_grant', error_description: '用户不可用' });
  }

  const tokens = generateTokens(user);
  const idToken = oidcService.signIdToken({
    clientId: client.clientId,
    userId: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    phone: user.phone,
    nonce: result.nonce,
  });
  auditService.log({ userId: user.id, username: user.username, action: 'oidc.token', ip: req.ip, detail: { clientId: client.clientId } });

  res.json({
    access_token: tokens.accessToken,
    token_type: 'Bearer',
    expires_in: 30 * 60,
    refresh_token: tokens.refreshToken,
    id_token: idToken,
  });
});

// UserInfo 端点
router.get('/oidc/userinfo', async (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'invalid_token' });

  const decoded = safeVerify(token);
  if (!decoded || decoded.type !== 'access' || tokenService.isRevoked(decoded)) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const user = await userService.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: 'invalid_token' });
  }

  res.json({
    sub: user.id,
    preferred_username: user.username,
    name: user.name,
    email: user.email,
    email_verified: !!user.email_verified,
    phone_number: user.phone,
    phone_number_verified: !!user.phone_verified,
  });
});

module.exports = router;