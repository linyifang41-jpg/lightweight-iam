const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../../config');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');
const sessionService = require('../services/session.service');
const policyService = require('../services/policy.service');
const auditService = require('../services/audit.service');
const verifyService = require('../services/verify.service');
const accessService = require('../services/access.service');
const jitService = require('../services/jit.service');
const breakglassService = require('../services/breakglass.service');
const govService = require('../services/gov.service');
const totp = require('../utils/totp');
const { generateTokens, verifyToken, safeVerify, signLoginToken, signChangeToken } = require('../utils/jwt');
const { authMiddleware } = require('../middleware/auth');
const { setCsrfToken, csrfProtection } = require('../middleware/csrf');

const router = express.Router();

// 登录限流：每个 IP 每分钟最多 5 次尝试（可用 IAM_LOGIN_RATE_MAX 覆盖）
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: config.rateLimit.loginMax,
  message: { error: '登录尝试过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 注册限流：每个 IP 每分钟最多 3 次注册，防止批量灌号
const registerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimit.registerMax,
  message: { error: '注册过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, email, phone, password, realm } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: '请提供用户名和密码' });
    }
    // 邮箱和手机号都改为可选，登录后再绑定

    const r = userService.normalizeRealm(realm);
    if (r === null) {
      return res.status(400).json({ error: '租户名称不合法（仅允许字母、数字、连字符、下划线，2-32位）' });
    }

    const existing = await userService.findByUsername(username, r);
    if (existing) {
      return res.status(409).json({ error: '该租户下用户名已存在' });
    }

    const user = await userService.createUser({ username, email, phone, password, realm: r });
    auditService.log({ userId: user.id, username: user.username, action: 'user.register', ip: req.ip });
    res.status(201).json({ message: '注册成功', user });
  } catch (error) {
    res.status(400).json({ error: error.message || '注册失败' });
  }
});

// 密码策略（公开，供前端提示）
router.get('/password-policy', (req, res) => {
  const s = policyService.getAllSettings();
  res.json({
    minLength: parseInt(s.min_password_length, 10),
    requireLetter: s.require_letter === '1',
    requireNumber: s.require_number === '1',
    requireSpecial: s.require_special === '1'
  });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { account, username, password, realm } = req.body;
    const loginAccount = account || username;

    if (!loginAccount || !password) {
      return res.status(400).json({ error: '请提供账号和密码' });
    }

    const r = userService.normalizeRealm(realm);
    if (r === null) {
      return res.status(400).json({ error: '租户名称不合法（仅允许字母、数字、连字符、下划线，2-32位）' });
    }

    const user = await userService.findByEmailOrPhone(loginAccount, r) || await userService.findByUsername(loginAccount, r);

    // 惰性清理过期账户（每次登录触达）
    userService.autoDisableExpired();

    // 账号不存在时统一提示，避免账号枚举
    if (!user) {
      auditService.log({ username: loginAccount, action: 'auth.login_failed', ip: req.ip });
      return res.status(401).json({ error: '账号或密码错误' });
    }

    // 账户过期检查（早于锁定/禁用，先过期再鉴权）
    if (userService.isExpired(user)) {
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_expired', ip: req.ip });
      return res.status(423).json({ error: '账户已过期，请联系管理员' });
    }

    // 账号锁定检查
    if (policyService.isLocked(user)) {
      const minutes = Math.ceil(policyService.remainingLockSeconds(user) / 60);
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_locked', ip: req.ip });
      return res.status(423).json({ error: `账号已锁定，请在 ${minutes} 分钟后再试` });
    }

    // 禁用账号
    if (user.status !== 'active') {
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_disabled', ip: req.ip });
      return res.status(403).json({ error: '账号已被禁用，请联系管理员' });
    }

    const valid = await userService.verifyPassword(password, user.password_hash);
    if (!valid) {
      const r = policyService.registerFailure(user.id);
      auditService.log({
        userId: user.id, username: user.username, action: 'auth.login_failed', ip: req.ip,
        detail: r.locked ? { locked: true, minutes: r.minutes } : { remaining: r.remaining }
      });
      if (r.locked) {
        return res.status(423).json({ error: `密码错误次数过多，账号已锁定 ${r.minutes} 分钟` });
      }
      return res.status(401).json({ error: '账号或密码错误' });
    }

    policyService.resetFailures(user.id);

    // 默认账户治理：禁用默认凭据登录的账户（SSO/OTP/TOTP 不受影响）
    if (user.password_login_allowed === 0) {
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_password_blocked', ip: req.ip });
      return res.status(401).json({ error: '该账户默认凭据登录已被禁用，请联系管理员' });
    }

    // 默认账户治理：策略开启时拦截"种子账户仍使用默认密码"的登录
    if (policyService.getSetting('default_account_policy') === '1' && govService.usesDefaultPassword(user)) {
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_default_blocked', ip: req.ip });
      return res.status(401).json({ error: '默认账户需由管理员先处置（强制改密或禁用默认凭据）' });
    }

    // 强制改密 / 密码过期：先完成改密再发登录凭证
    if (user.must_change_password === 1 || policyService.isPasswordExpired(user)) {
      const changeToken = signChangeToken(user.id, user.username);
      auditService.log({ userId: user.id, username: user.username, action: 'auth.must_change_password', ip: req.ip });
      return res.json({ mustChangePassword: true, changeToken });
    }

    // TOTP 两步验证：如果用户已开启，先返回临时登录令牌，等待动态码
    if (user.totp_enabled) {
      const loginToken = signLoginToken(user.id, user.username);
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_totp_pending', ip: req.ip });
      return res.json({ totpRequired: true, loginToken });
    }

    // 登录 OTP 两步验证：策略开启且未启用 TOTP 的用户进入 OTP 流程
    if (policyService.getSetting('login_otp_enabled') === '1') {
      const loginToken = signLoginToken(user.id, user.username);
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_otp_pending', ip: req.ip });
      return res.json({ otpRequired: true, loginToken });
    }

    const tokens = generateTokens(user);

    // 记录/复用登录会话（同设备重复登录替换旧会话）
    const { oldJtis } = sessionService.createOrReuse({
      userId: user.id, jti: tokens.accessJti, refreshJti: tokens.refreshJti,
      ip: req.ip, userAgent: req.headers['user-agent'], deviceId: req.body.deviceId
    });
    tokenService.revokeJtis(oldJtis);
    // 并发会话上限：超出时踢掉最旧会话
    tokenService.revokeJtis(sessionService.enforceMaxSessions(user.id));

    // 设置 SSO access token cookie（短有效期）
    res.cookie(config.sso.cookieName, tokens.accessToken, {
      path: '/',
      httpOnly: true,
      maxAge: config.sso.cookieMaxAge,
      sameSite: 'lax'
    });

    // 设置 refresh token cookie（长有效期，用于自动续期）
    res.cookie(config.sso.refreshCookieName, tokens.refreshToken, {
      path: '/',
      httpOnly: true,
      maxAge: config.sso.refreshCookieMaxAge,
      sameSite: 'lax'
    });

    // 下发 CSRF token cookie（JS 可读，用于双提交校验）
    setCsrfToken(res);

    auditService.log({ userId: user.id, username: user.username, action: 'auth.login', ip: req.ip });
    res.json({ message: '登录成功', accessToken: tokens.accessToken });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// 强制改密：登录后带着 changeToken 提交新密码，完成后再发正式登录凭证
router.post('/change-password-pending', async (req, res) => {
  try {
    const { changeToken, newPassword } = req.body;
    if (!changeToken || !newPassword) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const decoded = safeVerify(changeToken);
    if (!decoded || decoded.type !== 'change_pending') {
      return res.status(401).json({ error: '改密会话已过期，请重新登录' });
    }
    const user = await userService.findByIdAuth(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户状态异常，请重新登录' });
    }
    await userService.completeForcedPasswordChange(user.id, newPassword);

    // 改密后发正式登录凭证
    const tokens = generateTokens(user);
    const { oldJtis } = sessionService.createOrReuse({
      userId: user.id, jti: tokens.accessJti, refreshJti: tokens.refreshJti,
      ip: req.ip, userAgent: req.headers['user-agent'], deviceId: req.body.deviceId
    });
    tokenService.revokeJtis(oldJtis);
    tokenService.revokeJtis(sessionService.enforceMaxSessions(user.id));

    res.cookie(config.sso.cookieName, tokens.accessToken, {
      path: '/', httpOnly: true, maxAge: config.sso.cookieMaxAge, sameSite: 'lax'
    });
    res.cookie(config.sso.refreshCookieName, tokens.refreshToken, {
      path: '/', httpOnly: true, maxAge: config.sso.refreshCookieMaxAge, sameSite: 'lax'
    });
    setCsrfToken(res);

    auditService.log({ userId: user.id, username: user.username, action: 'user.forced_password_change', ip: req.ip });
    res.json({ message: '密码修改成功，已自动登录', accessToken: tokens.accessToken });
  } catch (error) {
    res.status(400).json({ error: error.message || '修改失败' });
  }
});

// 刷新 access token（用 refresh token 换新）
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies && req.cookies[config.sso.refreshCookieName];

  if (!refreshToken) {
    return res.status(401).json({ error: '缺少 refresh token' });
  }

  const decoded = safeVerify(refreshToken);
  if (!decoded || decoded.type !== 'refresh') {
    return res.status(401).json({ error: 'refresh token 无效或已过期' });
  }

  // 检查 refresh token 是否已被吊销
  if (tokenService.isRevoked(decoded)) {
    return res.status(401).json({ error: 'refresh token 已失效，请重新登录' });
  }

  const user = await userService.findById(decoded.userId);
  if (!user || user.status !== 'active') {
    return res.status(401).json({ error: '用户不存在或已禁用' });
  }

  const tokens = generateTokens(user);

  // 更新会话持有的 jti
  sessionService.updateByRefreshJti(decoded.jti, { jti: tokens.accessJti, refreshJti: tokens.refreshJti });
  // 刷新令牌轮换：旧 refresh token 立即失效
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

  res.json({ message: '刷新成功', accessToken: tokens.accessToken });
});

// 登出 - 单点登出：吊销 token + 清除所有 cookie + 关闭会话
router.post('/logout', csrfProtection, async (req, res) => {
  // 吊销 access token
  const accessToken = req.cookies && req.cookies[config.sso.cookieName];
  let logoutUser = null;
  if (accessToken) {
    const decoded = safeVerify(accessToken);
    if (decoded && decoded.userId) {
      const u = await userService.findById(decoded.userId);
      logoutUser = u;
    }
    await tokenService.revoke(decoded);
    // 关闭对应会话
    sessionService.revokeByJti(decoded && decoded.jti, 'user');
  }
  // 吊销 refresh token
  const refreshToken = req.cookies && req.cookies[config.sso.refreshCookieName];
  if (refreshToken) {
    const decoded = safeVerify(refreshToken);
    await tokenService.revoke(decoded);
  }

  // 清除 IAM 的 cookie
  res.clearCookie(config.sso.cookieName, { path: '/' });
  res.clearCookie(config.sso.refreshCookieName, { path: '/' });
  res.clearCookie(config.sso.csrfCookieName, { path: '/' });

  // 清除所有关联应用的本地会话 cookie（实现单点登出）
  for (const name of config.sso.appSessions) {
    res.clearCookie(name, { path: '/' });
  }

  auditService.log({
    userId: logoutUser ? logoutUser.id : null,
    username: logoutUser ? logoutUser.username : null,
    action: 'auth.logout',
    ip: req.ip
  });

  res.json({ message: '已全局登出' });
});

router.get('/me', authMiddleware, async (req, res) => {
  const roles = await userService.getUserRoles(req.user.id);
  res.json({ user: req.user, roles });
});

// ===== 自助会话管理：查看/撤销自己的登录设备 =====
router.get('/sessions', authMiddleware, async (req, res) => {
  const sessions = sessionService.listForUser(req.user.id);
  // 标记当前会话（通过当前 access token 的 jti）
  const curJti = (() => {
    const token = req.cookies && req.cookies[config.sso.cookieName] || (req.headers.authorization || '').replace(/^Bearer /, '');
    const decoded = safeVerify(token);
    return decoded && decoded.jti;
  })();
  res.json({
    sessions: sessions.map(s => {
      const { jti, ...rest } = s;
      return { ...rest, current: jti === curJti };
    })
  });
});

router.post('/sessions/:id/revoke', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const row = sessionService.findById(req.params.id);
    if (!row) return res.status(404).json({ error: '会话不存在' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: '无权操作该会话' });
    const { jtis } = sessionService.revokeById(row.id, 'user');
    tokenService.revokeJtis(jtis);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.session_revoke', ip: req.ip });
    res.json({ message: '已下线该设备' });
  } catch (e) {
    res.status(400).json({ error: e.message || '操作失败' });
  }
});

// 绑定邮箱
router.post('/bind-email', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: '请提供邮箱地址' });
    }
    await userService.bindEmail(req.user.id, email);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.bind_email', ip: req.ip });
    res.json({ message: '绑定成功' });
  } catch (error) {
    res.status(400).json({ error: error.message || '绑定失败' });
  }
});

// 绑定手机号
router.post('/bind-phone', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: '请提供手机号' });
    }
    await userService.bindPhone(req.user.id, phone);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.bind_phone', ip: req.ip });
    res.json({ message: '绑定成功' });
  } catch (error) {
    res.status(400).json({ error: error.message || '绑定失败' });
  }
});

// 发送验证码（type: email | phone）用于绑定后验证
router.post('/send-verify-code', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { type } = req.body;
    if (!['email', 'phone'].includes(type)) {
      return res.status(400).json({ error: '无效的验证码类型' });
    }
    const target = type === 'email' ? req.user.email : req.user.phone;
    if (!target) {
      return res.status(400).json({ error: `请先绑定${type === 'email' ? '邮箱' : '手机号'}` });
    }
    const code = verifyService.createCode(req.user.id, type);
    // demo：无短信/邮件通道，直接返回验证码；生产环境应改为发送
    auditService.log({ userId: req.user.id, username: req.user.username, action: `user.verify_${type}_send`, ip: req.ip });
    res.json({ message: '验证码已发送', code });
  } catch (error) {
    res.status(400).json({ error: error.message || '发送失败' });
  }
});

// 校验验证码（type: email | phone）
router.post('/verify-code', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { type, code } = req.body;
    if (!['email', 'phone'].includes(type)) {
      return res.status(400).json({ error: '无效的验证码类型' });
    }
    const ok = verifyService.verifyCode(req.user.id, type, code);
    if (!ok) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
    if (type === 'email') {
      userService.setEmailVerified(req.user.id);
    } else {
      userService.setPhoneVerified(req.user.id);
    }
    auditService.log({ userId: req.user.id, username: req.user.username, action: `user.verify_${type}_success`, ip: req.ip });
    res.json({ message: `${type === 'email' ? '邮箱' : '手机号'}验证成功` });
  } catch (error) {
    res.status(400).json({ error: error.message || '验证失败' });
  }
});

// 忘记密码：发送重置验证码（需提供用户名/邮箱/手机号）
router.post('/forgot-password', async (req, res) => {
  try {
    const { account, realm } = req.body;
    if (!account) {
      return res.status(400).json({ error: '请提供用户名、邮箱或手机号' });
    }
    const r = userService.normalizeRealm(realm);
    if (r === null) {
      return res.status(400).json({ error: '租户名称不合法' });
    }
    const user = await userService.findByEmailOrPhone(account, r) || await userService.findByUsername(account, r);
    if (!user) {
      // 不泄露账号是否存在
      return res.json({ message: '如果账号存在，重置码将发送' });
    }
    const code = verifyService.createPasswordReset(user.id);
    auditService.log({ userId: user.id, username: user.username, action: 'user.forgot_password', ip: req.ip });
    // demo：直接返回验证码；生产环境应发送到邮箱/手机
    res.json({ message: '重置验证码已生成', code, userId: user.id });
  } catch (error) {
    res.status(400).json({ error: error.message || '请求失败' });
  }
});

// TOTP 两步验证：提交动态码完成登录
router.post('/verify-login-totp', async (req, res) => {
  try {
    const { loginToken, code } = req.body;
    if (!loginToken || !code) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const decoded = safeVerify(loginToken);
    if (!decoded || decoded.type !== 'login_pending') {
      return res.status(401).json({ error: '登录会话已过期，请重新登录' });
    }
    const user = await userService.findByIdAuth(decoded.userId);
    if (!user || user.status !== 'active' || !user.totp_enabled) {
      return res.status(401).json({ error: '用户状态异常，请重新登录' });
    }
    // 优先 TOTP 动态码，不通过时尝试一次性备用码
    if (!totp.verifyCode(user.totp_secret, code)) {
      if (userService.verifyRecoveryCode(user.id, code)) {
        auditService.log({ userId: user.id, username: user.username, action: 'auth.login_recovery', ip: req.ip });
      } else {
        auditService.log({ userId: user.id, username: user.username, action: 'auth.login_totp_failed', ip: req.ip });
        return res.status(400).json({ error: '动态码或备用码错误' });
      }
    }
    const tokens = generateTokens(user);

    // 会话记录 + 并发控制
    const { oldJtis } = sessionService.createOrReuse({
      userId: user.id, jti: tokens.accessJti, refreshJti: tokens.refreshJti,
      ip: req.ip, userAgent: req.headers['user-agent'], deviceId: req.body.deviceId
    });
    tokenService.revokeJtis(oldJtis);
    tokenService.revokeJtis(sessionService.enforceMaxSessions(user.id));

    res.cookie(config.sso.cookieName, tokens.accessToken, {
      path: '/', httpOnly: true, maxAge: config.sso.cookieMaxAge, sameSite: 'lax'
    });
    res.cookie(config.sso.refreshCookieName, tokens.refreshToken, {
      path: '/', httpOnly: true, maxAge: config.sso.refreshCookieMaxAge, sameSite: 'lax'
    });
    setCsrfToken(res);

    auditService.log({ userId: user.id, username: user.username, action: 'auth.login', ip: req.ip });
    res.json({ message: '登录成功', accessToken: tokens.accessToken });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// 登录 OTP：发送验证码（demo 直接返回 code，生产应发短信/邮件）
router.post('/send-login-otp', async (req, res) => {
  try {
    const { loginToken } = req.body;
    if (!loginToken) return res.status(400).json({ error: '缺少必要参数' });
    const decoded = safeVerify(loginToken);
    if (!decoded || decoded.type !== 'login_pending') {
      return res.status(401).json({ error: '登录会话已过期，请重新登录' });
    }
    const user = await userService.findByIdAuth(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户状态异常，请重新登录' });
    }
    const code = verifyService.createCode(user.id, 'login_otp');
    auditService.log({ userId: user.id, username: user.username, action: 'auth.login_otp_sent', ip: req.ip });
    res.json({ message: '验证码已发送', code });
  } catch (error) {
    res.status(400).json({ error: error.message || '发送失败' });
  }
});

// 登录 OTP：校验验证码并完成登录
router.post('/verify-login-otp', async (req, res) => {
  try {
    const { loginToken, code } = req.body;
    if (!loginToken || !code) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const decoded = safeVerify(loginToken);
    if (!decoded || decoded.type !== 'login_pending') {
      return res.status(401).json({ error: '登录会话已过期，请重新登录' });
    }
    const user = await userService.findByIdAuth(decoded.userId);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户状态异常，请重新登录' });
    }
    if (!verifyService.verifyCode(user.id, 'login_otp', code)) {
      auditService.log({ userId: user.id, username: user.username, action: 'auth.login_otp_failed', ip: req.ip });
      return res.status(400).json({ error: '验证码错误或已过期' });
    }

    const tokens = generateTokens(user);
    const { oldJtis } = sessionService.createOrReuse({
      userId: user.id, jti: tokens.accessJti, refreshJti: tokens.refreshJti,
      ip: req.ip, userAgent: req.headers['user-agent'], deviceId: req.body.deviceId
    });
    tokenService.revokeJtis(oldJtis);
    tokenService.revokeJtis(sessionService.enforceMaxSessions(user.id));

    res.cookie(config.sso.cookieName, tokens.accessToken, {
      path: '/', httpOnly: true, maxAge: config.sso.cookieMaxAge, sameSite: 'lax'
    });
    res.cookie(config.sso.refreshCookieName, tokens.refreshToken, {
      path: '/', httpOnly: true, maxAge: config.sso.refreshCookieMaxAge, sameSite: 'lax'
    });
    setCsrfToken(res);

    auditService.log({ userId: user.id, username: user.username, action: 'auth.login_otp', ip: req.ip });
    res.json({ message: '登录成功', accessToken: tokens.accessToken });
  } catch (error) {
    res.status(500).json({ error: '登录失败' });
  }
});

// 忘记密码：用验证码重置密码
router.post('/reset-password', async (req, res) => {
  try {
    const { userId, code, newPassword } = req.body;
    if (!userId || !code || !newPassword) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    const ok = verifyService.verifyCode(userId, 'password_reset', code);
    if (!ok) {
      return res.status(400).json({ error: '验证码错误或已过期' });
    }
    await userService.resetPassword(userId, newPassword);
    // 重置密码后吊销该用户所有 token
    tokenService.revokeAllForUser(userId);
    const user = await userService.findById(userId);
    auditService.log({ userId, username: user ? user.username : null, action: 'user.reset_password', ip: req.ip });
    res.json({ message: '密码已重置，请用新密码登录' });
  } catch (error) {
    res.status(400).json({ error: error.message || '重置失败' });
  }
});

// 修改密码（已登录）——改密后吊销所有会话，需重新登录
router.post('/change-password', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    await userService.changePassword(req.user.id, oldPassword, newPassword);
    // 改密后吊销所有 token 与会话（安全要求）
    tokenService.revokeAllForUser(req.user.id);
    sessionService.revokeAllForUser(req.user.id, 'password_changed');
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.change_password', ip: req.ip });
    res.json({ message: '密码修改成功，请重新登录' });
  } catch (error) {
    res.status(400).json({ error: error.message || '修改失败' });
  }
});

// TOTP：获取设置信息（生成密钥）
router.post('/totp/setup', authMiddleware, csrfProtection, async (req, res) => {
  try {
    if (req.user.totp_enabled) {
      return res.status(400).json({ error: '已开启两步验证' });
    }
    const secret = totp.generateSecret();
    await userService.setTotpSecret(req.user.id, secret);
    const otpauthUri = totp.generateOtpAuthUri(secret, req.user.username);
    res.json({ secret, otpauthUri });
  } catch (error) {
    res.status(400).json({ error: error.message || '设置失败' });
  }
});

// TOTP：确认开启（用生成的密钥验证当前动态码）
router.post('/totp/enable', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await userService.findByIdAuth(req.user.id);
    if (!user.totp_secret) {
      return res.status(400).json({ error: '请先获取 TOTP 密钥' });
    }
    if (user.totp_enabled) {
      return res.status(400).json({ error: '已开启两步验证' });
    }
    if (!totp.verifyCode(user.totp_secret, code)) {
      return res.status(400).json({ error: '动态码错误' });
    }
    await userService.enableTotp(req.user.id);
    const recoveryCodes = userService.generateRecoveryCodes(req.user.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.totp_enable', ip: req.ip });
    res.json({ message: '两步验证已开启', recoveryCodes });
  } catch (error) {
    res.status(400).json({ error: error.message || '开启失败' });
  }
});

// TOTP：关闭
router.post('/totp/disable', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await userService.findByIdAuth(req.user.id);
    if (!user.totp_enabled || !user.totp_secret) {
      return res.status(400).json({ error: '两步验证未开启' });
    }
    if (!totp.verifyCode(user.totp_secret, code)) {
      return res.status(400).json({ error: '动态码错误' });
    }
    await userService.disableTotp(req.user.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.totp_disable', ip: req.ip });
    res.json({ message: '两步验证已关闭' });
  } catch (error) {
    res.status(400).json({ error: error.message || '关闭失败' });
  }
});

// 备用验证码：查看剩余数量（不泄露明文）
router.get('/totp/recovery', authMiddleware, async (req, res) => {
  const summary = userService.getRecoverySummary(req.user.id);
  res.json(summary);
});

// 备用验证码：重新生成（旧码全部作废）
router.post('/totp/recovery/regenerate', authMiddleware, csrfProtection, async (req, res) => {
  try {
    const user = await userService.findByIdAuth(req.user.id);
    if (!user.totp_enabled) {
      return res.status(400).json({ error: '两步验证未开启' });
    }
    const recoveryCodes = userService.generateRecoveryCodes(req.user.id);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'user.recovery_generate', ip: req.ip });
    res.json({ message: '备用验证码已重新生成，旧码全部作废', recoveryCodes });
  } catch (error) {
    res.status(400).json({ error: error.message || '生成失败' });
  }
});

// ===== 访问请求与审批流（IGA 自助申请）=====
router.get('/access-requests', authMiddleware, (req, res) => {
  try {
    res.json({ requests: accessService.listUserRequests(req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/access-requests', authMiddleware, csrfProtection, (req, res) => {
  try {
    const { roleIds, reason } = req.body;
    const request = accessService.submitRequest({ userId: req.user.id, roleIds, reason });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'access.request_submit', ip: req.ip, detail: { roleIds, status: request.status } });
    res.status(201).json({ message: '访问请求已提交，等待审批', request });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 即时访问 JIT（自助申请临时提权）=====
router.get('/jit-requests', authMiddleware, (req, res) => {
  try {
    res.json({ grants: jitService.myGrants(req.user.id) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/jit-requests', authMiddleware, csrfProtection, (req, res) => {
  try {
    const { roleId, reason, durationMinutes } = req.body;
    const grant = jitService.requestGrant({ userId: req.user.id, roleId, reason, durationMinutes });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'jit.request', ip: req.ip, detail: { id: grant.id, roleId, durationMinutes } });
    res.status(201).json({ message: '提权申请已提交，等待审批', grant });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ===== 应急访问 Break-glass（免审批 + 强认证 + 事后审查）=====
router.get('/breakglass', authMiddleware, (req, res) => {
  res.json({ events: breakglassService.myEvents(req.user.id) });
});

router.post('/breakglass/start', authMiddleware, csrfProtection, (req, res) => {
  try {
    const { code, reason, durationMinutes } = req.body;
    const event = breakglassService.start({ userId: req.user.id, code, reason, durationMinutes });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'breakglass.start', ip: req.ip, detail: { id: event.id, minutes: event.duration_minutes, reason: event.reason } });
    res.status(201).json({ message: '应急访问已开启（限时高权限）', event });
  } catch (e) {
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'breakglass.denied', ip: req.ip, detail: { error: e.message } });
    res.status(400).json({ error: e.message });
  }
});

router.post('/breakglass/end', authMiddleware, csrfProtection, (req, res) => {
  try {
    const events = breakglassService.myEvents(req.user.id);
    const active = events.find(e => e.status === 'started');
    if (!active) throw new Error('无进行中的应急事件');
    const event = breakglassService.end(active.id, req.user);
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'breakglass.end', ip: req.ip, detail: { id: event.id, by: 'self' } });
    res.json({ message: '应急访问已结束，权限已回收', event });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;