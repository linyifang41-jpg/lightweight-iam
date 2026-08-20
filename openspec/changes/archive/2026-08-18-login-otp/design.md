## Context

登录路由 `src/routes/auth.js` 已有 TOTP 分支（登录时 `user.totp_enabled` → 返回 `totpRequired: true, loginToken`，`/verify-login-totp` 校验后发凭证）。`verify.service.js` 提供泛化的 `createCode(userId, type)`/`verifyCode(userId, type, code)`（10 分钟 TTL，旧码作废，demo 直接返回 code）。`signLoginToken` 签发 5 分钟 `login_pending` 类型 JWT。登录页 `login.html` 已有 TOTP 表单模式。

## Goals / Non-Goals

**Goals:**
- `login_otp_enabled` 策略开关
- 登录 OTP 发送/校验端点
- 登录页 OTP 表单
- 审计留痕

**Non-Goals:**
- 真实短信/邮件通道（demo 直接返回 code，注释标注生产替换）
- OTP 发送频率限制（复用现有验证码作废机制；登录已有限流器）
- 与 TOTP 合并的单一流程

## Decisions

### 决策1：复用 login_pending token 语义
登录 OTP 与 TOTP 共用 `signLoginToken` 签发的 `login_pending` JWT（5 分钟）。send 端点校验 loginToken 有效即可生成验证码；verify 端点校验 loginToken + verifyCode。TOTP 的 verify 端点不受影响（独立校验 totp_enabled）。

### 决策2：verify 端点双通道复用同一"发凭证"逻辑
`verify-login-totp` 与 `verify-login-otp` 都复用"generateTokens + createOrReuse + 并发控制 + cookie + CSRF"尾部。为不重复代码，抽一个 `_issueLoginSession(res, user, req, action)` 辅助函数（本 change 内联实现，不改动 TOTP 端点行为）。

### 决策3：策略开关的登录分支顺序
登录顺序：强制改密/密码过期 → TOTP（若启用）→ OTP（若策略开启）→ 直接登录。OTP 分支放在 TOTP 之后，保证 TOTP 用户不落到 OTP。

### 决策4：发送目标
demo 无通道，send 端点不强制要求绑定邮箱/手机（直接返回 code）。生产注释说明需按用户 email/phone 发送。

## Risks / Trade-offs

- [demo 直出 code] 与现有 send-verify-code 一致；生产必须替换为真实通道，否则形同虚设。
- [login_pending 共用] OTP 用户理论上也能调用 verify-login-totp？—— 不会，verify-login-totp 校验 `user.totp_enabled`，OTP 用户为 false 会被拒。

## Migration Plan

1. policy.service.js：DEFAULT_SETTINGS 加 `login_otp_enabled: '0'`。
2. verify.service.js：无需改动（createCode 已泛化，type='login_otp'）。
3. auth.js：登录分支 + send/verify 端点 + 发凭证辅助函数。
4. login.html：OTP 表单 + 逻辑。
5. 测试脚本新增第 25 节；全量回归。

## Open Questions

无。