// 应用端 OIDC 客户端库（标准 Authorization Code Flow）
// 应用是 RP（Relying Party），IAM 是 OP（OpenID Provider）。
// 未登录 → 302 到 IAM /oidc/authorize → 用户登录授权 → 回调 /oidc/callback?code=
//   → 用 code+client_secret 换 access_token/id_token → 调 /oidc/userinfo 拿用户信息
//   → 建立本地会话 cookie → 跳回原页面。
// 登出 → 吊销本地 access_token（RFC 7009）→ 跳 IAM 全局登出页。
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const config = require('../config');

const IDP_BASE = config.urls.iam;

// state 存储（内存）：key=state, value={ returnUrl, at }，10 分钟过期
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanState() {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (now - v.at > STATE_TTL_MS) stateStore.delete(k);
  }
}

function createOIDCApp({ appName, clientId, clientSecret, redirectUri, localCookie }) {
  const app = express();
  app.use(cookieParser());

  async function authMiddleware(req, res, next) {
    // 回调与登出路由跳过登录校验
    if (req.path === '/oidc/callback' || req.path === '/logout') return next();

    const session = req.cookies && req.cookies[localCookie];
    if (session) {
      try {
        const s = JSON.parse(session);
        if (s.user && s.expiresAt && s.expiresAt > Date.now()) {
          req.oidcUser = s.user;
          req.oidcSession = s;
          return next();
        }
      } catch (e) { /* 本地会话损坏，重新走授权码流程 */ }
    }

    // 发起标准 OIDC 授权码流程
    cleanState();
    const state = crypto.randomBytes(16).toString('hex');
    const returnUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
    stateStore.set(state, { returnUrl, at: Date.now() });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email phone',
      state,
      nonce: crypto.randomBytes(8).toString('hex'),
    });
    return res.redirect(`${IDP_BASE}/oidc/authorize?${params.toString()}`);
  }

  app.use(authMiddleware);

  // OIDC 回调：接收 code，换取令牌并建立本地会话
  app.get('/oidc/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.status(400).send(`<h3>授权失败</h3><p>${error_description || error}</p><a href="/">重新登录</a>`);
    }
    if (!code) {
      return res.status(400).send('<h3>缺少授权码</h3><a href="/">重新登录</a>');
    }

    const entry = stateStore.get(state);
    if (!entry) {
      return res.status(400).send('<h3>state 无效或已过期</h3><a href="/">重新登录</a>');
    }
    stateStore.delete(state);

    try {
      // 用 code 换 access_token / id_token / refresh_token
      const tokRes = await fetch(`${IDP_BASE}/oidc/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      const tokens = await tokRes.json().catch(() => ({}));
      if (!tokRes.ok) {
        return res.status(502).send(`<h3>令牌换取失败</h3><p>${tokens.error_description || tokens.error || 'unknown'}</p><a href="/">重新登录</a>`);
      }

      // 调 userinfo 获取用户资料
      const uRes = await fetch(`${IDP_BASE}/oidc/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      let user = { username: 'oidc-user' };
      if (uRes.ok) {
        const u = await uRes.json();
        user = {
          sub: u.sub,
          username: u.preferred_username || '',
          name: u.name || '',
          email: u.email || '',
          phone: u.phone_number || '',
        };
      }

      const expiresInSec = tokens.expires_in || 1800;
      res.cookie(localCookie, JSON.stringify({
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
        refreshToken: tokens.refresh_token || null,
        user,
        expiresAt: Date.now() + expiresInSec * 1000,
      }), { path: '/', httpOnly: true, maxAge: expiresInSec * 1000 });

      return res.redirect(entry.returnUrl);
    } catch (err) {
      return res.status(502).send(`<h3>认证中心不可用</h3><p>${err.message}</p><a href="/">重试</a>`);
    }
  });

  // 登出：吊销本地 access_token + 清本地会话 + 跳 IAM 全局登出页
  app.get('/logout', async (req, res) => {
    const session = req.cookies && req.cookies[localCookie];
    res.clearCookie(localCookie, { path: '/' });
    if (session) {
      try {
        const s = JSON.parse(session);
        if (s.accessToken) {
          await fetch(`${IDP_BASE}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: s.accessToken,
              token_type_hint: 'access_token',
              client_id: clientId,
              client_secret: clientSecret,
            }),
          });
        }
      } catch (e) { /* 吊销失败不阻塞登出 */ }
    }
    res.redirect(`${IDP_BASE}/logout.html`);
  });

  return app;
}

module.exports = { createOIDCApp, IDP_BASE };