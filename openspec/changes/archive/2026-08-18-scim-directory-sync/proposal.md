## Why

说明书"目录同步（SCIM 2.0）"⬜。SCIM 2.0（RFC 7643/7644）是身份源与目标系统间用户账号自动开通/更新/禁用的行业标准（Okta/Azure/Keycloak 均支持）。本系统已有完整用户/状态/审计基建，需暴露 SCIM 2.0 REST+JSON 端点供上游（身份源）调用，实现跨域用户同步。

## What Changes

- `src/routes/scim.js`：SCIM 2.0 端点（Bearer token 认证，token 存 settings `scim_token`）
  - `GET /scim/v2/ServiceProviderConfig`：能力声明
  - `GET /scim/v2/ResourceTypes`、`GET /scim/v2/Schemas`：元数据
  - `GET /scim/v2/Users`（支持 `filter=userName eq`/`id eq` 分页）、`GET /scim/v2/Users/:id`
  - `POST /scim/v2/Users`：创建用户（userName→username，emails/phoneNumbers→email/phone，active→status）
  - `PUT /scim/v2/Users/:id`：全量替换（含 active 禁用/启用）
  - `PATCH /scim/v2/Users/:id`：增量更新（active、userName、emails）
  - `DELETE /scim/v2/Users/:id`：删除/归档（含 SCIM 规范 `{"schemas":[...],"active":false}` 软删除响应）
- 管理端可生成/重置 `scim_token`（settings），安全策略页新增项
- 审计：`scim.user.create/update/delete`、`scim.auth_failed`
- 启动路由挂载 `app.use('/scim/v2', ...)`

## Capabilities

### New Capabilities
- `directory/scim-sync`: SCIM 2.0 用户目录同步

### Modified Capabilities

## Impact

- 新文件 `src/routes/scim.js`
- `src/services/policy.service.js`：`DEFAULT_SETTINGS` 加 `scim_token`（空默认）
- `src/app.js`：挂载 scim 路由
- `public/admin.html`：安全策略页加 SCIM token 配置
- `/tmp/iam_test.sh` 新增用例