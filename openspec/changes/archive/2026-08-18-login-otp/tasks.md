## 1. 策略与登录分支

- [x] 1.1 `policy.service.js`：`DEFAULT_SETTINGS` 加 `login_otp_enabled: '0'`
- [x] 1.2 `auth.js` 登录：TOTP 分支后加 OTP 分支（login_otp_enabled && !totp_enabled → otpRequired + loginToken）

## 2. OTP 端点

- [x] 2.1 `POST /auth/send-login-otp`：校验 loginToken → 生成 login_otp 验证码（旧码作废）→ 返回 code（demo），审计 `auth.login_otp_sent`
- [x] 2.2 `POST /auth/verify-login-otp`：校验 loginToken + verifyCode → 发登录凭证（复用 TOTP 尾部逻辑抽 `_issueLoginSession`），审计 `auth.login_otp` / `auth.login_otp_failed`

## 3. 前端

- [x] 3.1 `login.html`：OTP 表单（显示 loginToken → 发送验证码按钮 → 输入 → 验证 → 登录成功跳转）

## 4. 测试与回归

- [x] 4.1 更新 `/tmp/iam_test.sh`：新增第 25 节——开启策略→登录返回 otpRequired→发送验证码→错误码失败→正确码成功；关闭策略→登录直接成功
- [x] 4.2 全量回归通过（预计 85 + 新增）