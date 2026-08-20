## Why

等保测评要求账户生命周期管控与日志留存策略，说明书对应条目（"账户过期清理"、"数据保留策略"）均为未实现。实现两项控制：

1. **账户过期清理**：为账户设置有效期，到期自动停用（禁用），杜绝僵尸账户长期存活。
2. **数据保留策略**：审计日志留存周期可配置，超期自动清理，满足留存下限与合规删除要求。

## What Changes

- 账户有效期：`users.account_expires_at` 字段；登录时检查是否过期（过期拒绝登录+审计）；管理端用户列表显示有效期、支持设置/清除过期时间；启动与每日惰性清理将过期账户自动置为 `disabled`。
- 数据保留：新增安全策略 `audit_retention_days`（0=永久保留，默认 365）；审计写入后惰性清理超期日志；管理端安全策略页可配置；清理动作留痕。

## Capabilities

### New Capabilities
- `lifecycle/account-expiry`: 账户过期管理——有效期字段、登录拦截、自动禁用、管理端设置
- `compliance/audit-retention`: 审计日志数据保留——留存周期配置、超期自动清理

### Modified Capabilities

## Impact

- `src/models/database.js`：`users.account_expires_at` 列
- `src/services/policy.service.js`：`audit_retention_days` 默认设置项
- `src/services/user.service.js`：过期判定与设置/清除过期
- `src/services/audit.service.js`：`log()` 后惰性清理超期日志
- `src/routes/auth.js`：登录时过期拦截
- `src/routes/admin.js`：用户过期设置端点、策略保存包含 retention
- `public/admin.html`：用户列表过期列、设置 UI、安全策略 retention 项
- 测试脚本 `/tmp/iam_test.sh` 新增用例