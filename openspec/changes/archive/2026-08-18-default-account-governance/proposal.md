## Why

等保合规要求治理默认/内置账户：说明书 3.1"默认账户治理"仍 🟡（首次登录强制改密✅，默认账户治理⬜）。系统种子账户 `admin`、`lin` 使用公开初始密码，是常见入侵入口；当前无检测、无处置手段。本批实现：**默认账户风险检测 + 强制改密/禁用默认凭据登录/删除 + 登录拦截策略**。

## What Changes

- users 表加列 `is_seed`（内置/种子账户标记）、`password_login_allowed`（默认凭据登录开关）
- 新权限点 `gov:manage`（种子 + admin 绑定）；策略设置新增 `default_account_policy`
- 新增 `src/services/gov.service.js`：
  - `detectDefaultAccounts()`：列出种子账户，检测密码是否仍等于默认密码字典（admin/Admin123、lin/lin123456 等）
  - `forceReset(id)`：强制改密（must_change_password=1 + 吊销会话）
  - `disablePasswordLogin(id)` / `enablePasswordLogin(id)`：禁用/恢复默认凭据登录
  - `deleteDefaultAccount(id)`：删除默认账户（内置 admin 受保护）
- `src/routes/auth.js` 登录拦截：`default_account_policy=1` 时，种子账户用默认密码登录被拒绝（提示需管理员处置）并审计 `auth.login_default_blocked`
- 新端点（`gov:manage` + CSRF）：`GET /admin/default-accounts`、`POST /admin/default-accounts/:id/force-reset`、`POST /admin/default-accounts/:id/disable-login`、`POST /admin/default-accounts/:id/enable-login`、`DELETE /admin/default-accounts/:id`
- 审计：`gov.detect`、`gov.force_reset`、`gov.disable_login`、`gov.enable_login`、`gov.delete_account`
- admin.html 新增"默认账户治理"页签
- `/tmp/iam_test.sh` 新增第 32 节

## Capabilities

### New Capabilities
- `iam/default-account`: 默认账户治理（检测 + 处置 + 登录拦截策略）

### Modified Capabilities

## Impact

- `src/models/database.js`：users 加列 `is_seed`/`password_login_allowed`、权限种子加 `gov:manage`、设置种子加 `default_account_policy`
- `src/services/policy.service.js`：DEFAULT_SETTINGS 加 `default_account_policy`
- 新文件 `src/services/gov.service.js`
- `src/routes/auth.js`：登录默认凭据拦截
- `src/routes/admin.js`：gov 治理端点
- `public/admin.html`：默认账户治理页签
- `/tmp/iam_test.sh` 新增用例（预期 214 + 新增）