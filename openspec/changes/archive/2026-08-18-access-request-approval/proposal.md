## Why

说明书"访问请求与审批流"⬜（六、身份治理与合规）。当前开通权限只能管理员直接操作，缺少**自助申请 → 审批 → 自动开通**闭环（IGA 核心能力，等保与合规审计需求）。本批实现最小可行审批流：用户申请角色 → 审批人（`approval:manage` 权限）逐级审批 → 全部通过后自动赋权；SoD 冲突自动拒绝。

## What Changes

- 新表 `access_requests`：申请者、角色集合、原因、状态（pending/approved/rejected）、审批级数、已审批人数、审批人列表、审批备注
- 新权限点 `approval:manage`（种子 + admin 角色绑定）
- 新策略 `approval_levels`（默认 1，可配置审批级数）
- 新增 `src/services/access.service.js`：
  - `submitRequest`：校验角色存在/未拥有，创建 pending 请求
  - `approveRequest`：去重同一审批人；达到级数自动赋权（先 SoD 预检，冲突自动拒绝）
  - `rejectRequest`：拒绝并记录
  - `listRequests` / `listUserRequests`
- 路由：
  - 自助：`POST /auth/access-requests`、`GET /auth/access-requests`（登录可调）
  - 审批：`GET /admin/access-requests`、`POST /admin/access-requests/:id/approve`、`POST /admin/access-requests/:id/reject`（需 `approval:manage` + CSRF）
- 审计：`access.request_submit/approve/reject/granted`
- admin.html 新增"访问审批"页签
- `/tmp/iam_test.sh` 新增第 30 节

## Capabilities

### New Capabilities
- `iga/access-request`: 访问请求与审批流（自助申请→多级审批→自动开通）

### Modified Capabilities

## Impact

- `src/models/database.js`：建表 `access_requests`、权限种子加 `approval:manage`、默认设置加 `approval_levels`
- 新文件 `src/services/access.service.js`
- `src/routes/auth.js`、`src/routes/admin.js` 各加端点
- `public/admin.html`：访问审批页签
- `/tmp/iam_test.sh` 新增用例（预期 168 + 新增）