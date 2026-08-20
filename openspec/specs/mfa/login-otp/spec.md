# mfa/login-otp Specification

## Purpose
实现登录二次认证 OTP（短信/邮件一次性验证码），作为 TOTP 之外的等保双因素通道；策略开关控制，TOTP 用户优先走 TOTP。

## Requirements

### Requirement: 登录 OTP 策略开关
系统安全策略新增 `login_otp_enabled`（0=关闭/1=开启，默认关闭）。开启后，未启用 TOTP 的用户登录进入 OTP 二次认证；已启用 TOTP 的用户仍走 TOTP。

#### Scenario: 开关关闭时登录不受影响
- **WHEN** `login_otp_enabled=0`
- **THEN** 登录行为与原来完全一致

#### Scenario: 开关开启且未启用 TOTP
- **WHEN** 用户密码校验通过、未启用 TOTP、且策略开启
- **THEN** 返回 `otpRequired: true` 与 `loginToken`，不发登录凭证

#### Scenario: 开关开启但已启用 TOTP
- **WHEN** 用户已启用 TOTP
- **THEN** 仍走 TOTP 流程（TOTP 优先）

### Requirement: 发送登录 OTP 验证码
`POST /auth/send-login-otp`：需有效 loginToken，为用户生成 6 位验证码（10 分钟有效，旧码作废）。demo 环境直接返回 code 供前端展示，生产应发短信/邮件。

#### Scenario: 发送成功
- **WHEN** 携带有效 loginToken 请求发送
- **THEN** 返回验证码，审计 `auth.login_otp_sent`

#### Scenario: 无效 loginToken
- **WHEN** loginToken 缺失或失效
- **THEN** 返回 401

### Requirement: 校验登录 OTP
`POST /auth/verify-login-otp`：校验 loginToken 与验证码，成功后发登录凭证（cookie/会话/并发控制），与 TOTP 登录一致。

#### Scenario: 验证成功
- **WHEN** 验证码正确且在有效期内
- **THEN** 登录成功，设置 SSO cookie，审计 `auth.login_otp`

#### Scenario: 验证失败
- **WHEN** 验证码错误
- **THEN** 返回 400，审计 `auth.login_otp_failed`
