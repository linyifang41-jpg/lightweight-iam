const crypto = require('crypto');
const config = require('../../config');

// CSRF 防护：双提交 cookie 模式
// 服务器在登录/刷新时下发 csrf_token cookie（JS 可读）
// 前端发起写操作时读取该 cookie，放入 X-CSRF-Token header
// 服务器校验 cookie 与 header 一致

function setCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(config.sso.csrfCookieName, token, {
    path: '/',
    httpOnly: false, // JS 需要读取
    sameSite: 'lax',
    maxAge: config.sso.refreshCookieMaxAge
  });
  return token;
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  const cookieToken = req.cookies && req.cookies[config.sso.csrfCookieName];
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF 校验失败，请刷新页面重试' });
  }
  next();
}

module.exports = { setCsrfToken, csrfProtection };