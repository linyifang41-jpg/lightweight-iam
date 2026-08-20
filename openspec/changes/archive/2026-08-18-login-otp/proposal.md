## Why

说明书"短信/邮件 OTP"标注为部分实现（仅绑定验证码✅，登录OTP⬜）。等保要求重要系统双因素认证。实现登录二次认证 OTP：策略开关开启后，未启用 TOTP 的用户登录时需输入短信/邮件验证码，与既有 TOTP 通道并存（TOTP 优先）。

## What Changes

- 新策略 `login_otp_enabled`（默认关闭，管理端可配）
- 登录链路：`login_otp_enabled=1` 且用户未启用 TOTP 时，登录返回 `otpRequired: true` + `loginToken`，前端进入 OTP 输入
- 新端点：
  - `POST /auth/send-login-otp`：为登录中的用户生成验证码（demo 直接返回，生产发短信/邮件）
  - `POST /auth/verify-login-otp`：校验 loginToken + 验证码，成功发登录凭证（复用 TOTP 登录会话逻辑）
- 登录页新增 OTP 表单（发送验证码 → 输入 → 验证）
- 审计：`auth.login_otp_sent`、`auth.login_otp_failed`、`auth.login_otp`（成功）

## Capabilities

### New Capabilities
- `mfa/login-otp`: 登录 OTP——策略开关、验证码生成/校验、登录集成

### Modified Capabilities

## Impact

- `src/services/policy.service.js`：`DEFAULT_SETTINGS` 加 `login_otp_enabled: '0'`
- `src/services/verify.service.js`：支持 `login_otp` 类型（已有 createCode/verifyCode 泛化）
- `src/routes/auth.js`：登录分支 + send/verify 端点
- `public/login.html`：OTP 表单与逻辑
- 测试脚本 `/tmp/iam_test.sh` 新增用例