## 1. 数据层

- [x] 1.1 `src/models/database.js`：`migrate()` 增加 `addColumnIfMissing('users', 'recovery_codes', 'TEXT')` 与 `addColumnIfMissing('users', 'recovery_generated_at', 'DATETIME')`

## 2. 备用码服务逻辑（user.service.js）

- [x] 2.1 新增 `generateRecoveryCodes(userId)`：生成 10 个 `XXXX-XXXX` 备用码，DB 存 `[{hash,used}]` JSON + 时间，返回明文数组
- [x] 2.2 新增 `getRecoverySummary(userId)`：返回剩余可用数（不返回明文）
- [x] 2.3 新增 `verifyRecoveryCode(userId, code)`：规范化输入，匹配未使用备用码哈希则标记 used 并返回 true；格式/不存在/已使用返回 false
- [x] 2.4 `disableTotp` 增加清除 `recovery_codes`、`recovery_generated_at`

## 3. 路由（auth.js）

- [x] 3.1 `POST /auth/totp/enable`：成功后生成备用码，响应返回 `{ message, recoveryCodes }`
- [x] 3.2 `GET /auth/totp/recovery`：返回剩余可用数量与生成时间（不泄露明文）
- [x] 3.3 `POST /auth/totp/recovery/regenerate`（csrfProtection）：重新生成备用码，返回新明文；审计 `user.recovery_generate`
- [x] 3.4 `POST /auth/verify-login-totp`：TOTP 动态码不通过时尝试 `verifyRecoveryCode`，成功则审计 `auth.login_recovery` 并继续登录
- [x] 3.5 `POST /auth/totp/disable`：关闭后确认 `recovery_codes` 被清除

## 4. 前端

- [x] 4.1 `public/login-success.html`：安全中心新增"两步验证"区块——未开启显示开启入口（弹窗含 secret/动态码输入）；已开启显示状态 + 剩余备用码数 + "重新生成"按钮 + "关闭"按钮；开启成功展示备用码明文
- [x] 4.2 `public/login-success.html`：新增 MFA 设置弹窗与备用码展示/重新生成逻辑（含 CSRF header）
- [x] 4.3 `public/login.html`：TOTP 表单提示可输入动态码或备用码，去掉 `\d{6}` 严格限制，改用文本输入

## 5. 测试与回归

- [x] 5.1 更新 `/tmp/iam_test.sh`：新增第 20 节用例——开启 TOTP 断言 10 个备用码→备用码登录成功→同备用码二次登录失败→重新生成后新码不同→关闭 TOTP 后 summary=0
- [x] 5.2 全量回归 51 用例全部通过