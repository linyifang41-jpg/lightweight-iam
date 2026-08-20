## Why

用户开启 TOTP 两步验证后，一旦手机丢失/重装，将无法再生成动态码登录，只能联系管理员重置——这是 MFA 的常见锁死场景。等保/主流 IdP（Keycloak、Entra、Google）均提供一次性备用验证码（Recovery Codes）作为应急通道。

## What Changes

- 开启 TOTP 时自动生成一组一次性备用验证码（10 个，格式 `XXXX-XXXX`），只展示一次，DB 存哈希
- 登录 TOTP 验证步骤支持输入备用验证码完成登录；每个备用码只能使用一次
- 安全中心提供"查看备用码/重新生成"入口，重新生成会使旧码全部作废
- 关闭 TOTP 时清空备用码
- 新增用户表字段 `recovery_codes`（JSON 存哈希数组）及 `recovery_generated_at`
- 审计事件：`user.recovery_generate`、`auth.login_recovery`

## Capabilities

### New Capabilities
- `mfa/recovery-codes`: MFA 备用验证码——生成、单次使用、重新生成、登录应急验证

### Modified Capabilities

## Impact

- `src/models/database.js`：users 表迁移新增 `recovery_codes`、`recovery_generated_at`
- `src/services/user.service.js`：生成/校验/使用/清除备用码
- `src/routes/auth.js`：`totp/setup-enable` 流程返回备用码；`verify-login-totp` 支持备用码；新增 `totp/recovery` 查看/重新生成接口
- `public/login-success.html`：安全中心新增"两步验证 + 备用码"区块（当前 TOTP UI 缺失，一并补齐设置/关闭/备用码）
- `public/login.html`：TOTP 表单支持输入备用码
- 测试脚本 `/tmp/iam_test.sh` 新增用例