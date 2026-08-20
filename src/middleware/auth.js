const { safeVerify } = require('../utils/jwt');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');
const sessionService = require('../services/session.service');
const policyService = require('../services/policy.service');
const serviceAccountService = require('../services/service-account.service');
const config = require('../../config');

async function authMiddleware(req, res, next) {
  let token = null;
  
  // 优先从 Authorization header 获取 token
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }
  
  // 如果没有 header，尝试从 cookie 获取
  if (!token && req.cookies && req.cookies[config.sso.cookieName]) {
    token = req.cookies[config.sso.cookieName];
  }

  if (!token) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const decoded = safeVerify(token);
  if (!decoded) {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }

  // 服务账号令牌（client_credentials）：非人类身份
  if (decoded.type === 'client') {
    if (tokenService.isRevoked(decoded)) {
      return res.status(401).json({ error: '令牌已失效' });
    }
    const sa = serviceAccountService.findById(decoded.sub);
    if (!sa || sa.status !== 'active') {
      return res.status(401).json({ error: '服务账号不存在或已禁用' });
    }
    if (sa.expires_at && new Date(sa.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: '服务账号已过期' });
    }
    if (sa.ver !== decoded.ver) {
      return res.status(401).json({ error: '服务账号凭据已更新，请重新获取令牌' });
    }
    let permissions = sa.permissions;
    if (decoded.scope) {
      const requested = String(decoded.scope).split(/\s+/).filter(Boolean);
      permissions = permissions.filter(p => requested.includes(p));
    }
    req.user = { id: sa.id, username: sa.name, permissions, isServiceAccount: true };
    req.user.isServiceAccount = true;
    next();
    return;
  }

  if (decoded.type !== 'access') {
    return res.status(401).json({ error: '令牌无效或已过期' });
  }

  // 检查 token 是否被吊销（单点登出）
  if (tokenService.isRevoked(decoded)) {
    return res.status(401).json({ error: '令牌已失效，请重新登录' });
  }

  const user = await userService.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: '用户不存在或已禁用' });
  }

  // 空闲超时检查：会话最后活跃时间超过阈值则吊销并返回 401（需在 touch 之前判定）
  const idleMinutes = policyService.getInt('session_idle_timeout_minutes', 0);
  const { timedOut, jtis } = sessionService.enforceIdleTimeout(decoded.jti, idleMinutes);
  if (timedOut) {
    tokenService.revokeJtis(jtis);
    require('../services/audit.service').log({
      userId: user.id, username: user.username, action: 'session.idle_timeout', ip: req.ip,
      detail: { jti: decoded.jti }
    });
    return res.status(401).json({ error: '会话已超时，请重新登录' });
  }

  // 会话心跳：更新最后活跃时间
  sessionService.touch(decoded.jti);

  req.user = user;
  req.user.permissions = await userService.getUserPermissions(user.id);
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

module.exports = { authMiddleware, requirePermission };