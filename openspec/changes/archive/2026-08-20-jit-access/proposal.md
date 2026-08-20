## Why

说明书 7.5"即时访问（JIT）⬜"：按需临时提权，用完即回收。特权操作应遵循最小权限：长期授权 + 限时提权。本批实现 **JIT 即时访问（临时提权）**：用户按需申请临时角色（限时）→ 审批 → 生效并授予 → 到期自动回收（惰性）；管理端可随时撤销；全程审计。与访问请求（永久授权）、访问复审（定期确认）形成完整 IGA/PAM 闭环。

## What Changes

- 新表 `temporary_grants`（id/user_id/role_id/reason/duration_minutes/status(pending|active|expired|revoked)/granted_by/granted_at/expires_at/requested_by/decided_at）
- 设置 `jit_max_minutes`（单次提权上限，默认 480）、`jit_enabled`（默认 '1'）
- 新增 `src/services/jit.service.js`：
  - `requestGrant`（用户自助：角色+原因+时长，校验上限与 SoD）
  - `listGrants`（含惰性到期回收：active 且已过 expires_at → expired 并回收 user_roles）
  - `approveGrant` / `rejectGrant` / `revokeGrant`（approval:manage）
  - `activeGrantsForUser`
- 端点：
  - 用户自助：`POST /auth/jit-requests`（登录+CSRF）
  - 管理：`GET /admin/jit-grants`、`POST /admin/jit-grants/:id/approve`、`/reject`、`/revoke`（approval:manage+CSRF）
- 审计：`jit.request`、`jit.approve`、`jit.reject`、`jit.revoke`、`jit.expire`
- admin.html 新增"⚡ 即时访问（JIT）"页签（列表/审批/撤销）
- `/tmp/iam_test.sh` 新增第 36 节

## Capabilities

### New Capabilities
- `pam/jit-access`: 即时访问（限时提权 + 审批 + 到期自动回收）

### Modified Capabilities

## Impact

- `src/models/database.js`：建表 temporary_grants + 设置种子 jit_max_minutes/jit_enabled
- `src/services/policy.service.js`：DEFAULT_SETTINGS 加两键
- 新文件 `src/services/jit.service.js`
- `src/routes/auth.js`：用户自助申请端点
- `src/routes/admin.js`：管理端点
- `public/admin.html`：JIT 页签
- `/tmp/iam_test.sh` 新增用例（预期 307 + 新增）