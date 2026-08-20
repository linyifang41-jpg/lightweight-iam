// 应用端 SSO 客户端库
// 思路：应用是 SP（Service Provider），IAM 是 IdP（Identity Provider）
// 应用请求 IAM 的 /sso/verify 接口验证 sso_token cookie
// 遵循 OAuth2/OIDC 重定向模型：未登录 → 302 到 IdP 登录页 → 登录后跳回原应用
const express = require('express');
const cookieParser = require('cookie-parser');
const config = require('../config');

const IDP_BASE = config.urls.iam;

// 构造完整的原应用回跳地址（登录后跳回此地址，而非相对路径）
function buildReturnUrl(req) {
  return `http://${req.headers.host}${req.originalUrl}`;
}

function createSSOApp(options = {}) {
  const app = express();
  app.use(cookieParser());

  // 检查 SSO 登录状态的中间件
  async function ssoMiddleware(req, res, next) {
    const localSession = req.cookies && req.cookies[options.localCookie];

    if (localSession) {
      // 已有本地会话，直接放行
      try {
        req.ssoUser = JSON.parse(localSession);
        return next();
      } catch (e) {
        // 本地会话损坏，继续走验证
      }
    }

    // 没有本地会话，用 sso_token cookie 去 IdP 验证
    const ssoToken = req.cookies && req.cookies[config.sso.cookieName];

    if (!ssoToken) {
      // 完全没登录，重定向到 IdP 登录页（携带完整回跳地址 + 应用标识）
      const returnUrl = buildReturnUrl(req);
      return res.redirect(`${IDP_BASE}/login.html?redirect=${encodeURIComponent(returnUrl)}&app=${encodeURIComponent(options.appName)}`);
    }

    try {
      // 请求 IdP 验证 token（POST body 传递，避免 URL 泄露）
      const verifyRes = await fetch(`${IDP_BASE}/sso/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: ssoToken }),
      });
      const data = await verifyRes.json();

      if (data.valid) {
        // 验证通过，建立本地会话
        res.cookie(options.localCookie, JSON.stringify(data.user), {
          path: '/',
          httpOnly: true,
          maxAge: config.sso.cookieMaxAge,
        });
        req.ssoUser = data.user;
        return next();
      }

      if (data.expired) {
        // token 过期，跳 IdP 刷新端点实现无感续期（同样携带完整回跳地址）
        const refreshUrl = `${IDP_BASE}/sso/refresh?redirect=${encodeURIComponent(buildReturnUrl(req))}`;
        return res.redirect(refreshUrl);
      }

      // token 无效/被吊销，重定向到 IdP 登录（携带完整回跳地址）
      const returnUrl = buildReturnUrl(req);
      return res.redirect(`${IDP_BASE}/login.html?redirect=${encodeURIComponent(returnUrl)}&app=${encodeURIComponent(options.appName)}`);
    } catch (error) {
      // IdP 不可用
      return res.status(503).json({ error: '认证中心不可用，请稍后再试' });
    }
  }

  app.use(ssoMiddleware);

  // 登出：清除本地会话，跳 IdP 全局登出
  app.get('/logout', (req, res) => {
    res.clearCookie(options.localCookie, { path: '/' });
    // 跳到 IdP 的全局登出页面，触发单点登出
    res.redirect(`${IDP_BASE}/logout.html`);
  });

  return app;
}

module.exports = { createSSOApp, IDP_BASE };