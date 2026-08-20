## Why

说明书 7.6"应急访问（Break-glass）⬜"：紧急通道 + 强认证 + 全程留痕 + 事后审查。异常场景下（如审批人不在线）运维需立即进入高权限执行应急操作。本批实现 **Break-glass 应急访问**：已启用 TOTP 的用户可凭理由 + 动态码强制二次认证进入限时应急模式（临时授予高权限角色），到期自动回收；全程留痕并由具备 `breakglass:manage` 的审查人审阅；与 JIT（需审批）互补（Break-glass 免审批但事后必审）。

## What Changes

- 新表 `breakglass_events`（id/user_id/reason/status(started|ended|reviewed)/duration_minutes/started_at/ended_at/role_id/role_name/reviewed_by/review_note/created_at）
- 设置：`breakglass_enabled`（默认 '1'）、`breakglass_duration`（默认 30 分钟）、`breakglass_role_id`（授予的应急角色，默认自动创建含全部权限的 break-glass 角色）
- 权限：`breakglass:use`（申请）、`breakglass:manage`（审查/结束），seed 给 admin
- 新增 `src/services/breakglass.service.js`：`start`（TOTP step-up + 理由 + 限时授角色）、`end`（回收）、`review`（事后审查）、`list`、`activeEvent`、惰性过期回收
- 端点：
  - 自助：`POST /auth/breakglass/start`（登录+CSRF，体含 code/reason）、`GET /auth/breakglass`（我的应急记录）、`POST /auth/breakglass/end`
  - 管理：`GET /admin/breakglass`、`POST /admin/breakglass/:id/review`、`POST /admin/breakglass/:id/end`
- 审计：`breakglass.start`、`breakglass.end`、`breakglass.review`、`breakglass.denied`（未绑 TOTP/码错误/停用）
- admin.html 新增"🚨 应急访问"页签
- `/tmp/iam_test.sh` 新增第 38 节

## Capabilities

### New Capabilities
- `pam/break-glass`: 应急访问（免审批限时提权 + 强认证 + 事后审查）

### Modified Capabilities

## Impact

- `src/services/breakglass.service.js`（新）
- `src/services/policy.service.js`：DEFAULT_SETTINGS 三键
- `src/models/database.js`：建表 + 权限 seed + 设置种子
- `src/routes/auth.js` + `src/routes/admin.js`：端点
- `public/admin.html`：应急访问页签
- `/tmp/iam_test.sh`：第 38 节（预期 343 + 新增）