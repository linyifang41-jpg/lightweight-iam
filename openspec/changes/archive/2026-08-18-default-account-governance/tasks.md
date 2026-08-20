## 1. 数据模型与种子

- [x] 1.1 `src/models/database.js`：users 加列 `is_seed`、`password_login_allowed`；权限种子新增 `gov:manage`；设置种子新增 `default_account_policy`；seed 时 admin/lin 置 `is_seed=1`

## 2. 默认账户治理服务

- [x] 2.1 `src/services/gov.service.js`：detectDefaultAccounts（默认密码检测）/forceReset（强制改密+吊销会话）/disablePasswordLogin/enablePasswordLogin/deleteDefaultAccount（内置 admin 保护）

## 3. 登录拦截与路由

- [x] 3.1 `src/routes/auth.js`：`default_account_policy=1` 时种子账户默认密码登录拦截（401 + 审计 `auth.login_default_blocked`）；`password_login_allowed=0` 拦截审计 `auth.login_password_blocked`
- [x] 3.2 admin 路由：`GET /admin/default-accounts`、`POST /admin/default-accounts/:id/force-reset`、`POST /admin/default-accounts/:id/disable-login`、`POST /admin/default-accounts/:id/enable-login`、`DELETE /admin/default-accounts/:id`（gov:manage + CSRF）
- [x] 3.3 `src/services/policy.service.js`：DEFAULT_SETTINGS 加 `default_account_policy: '0'`

## 4. 前端

- [x] 4.1 admin.html"默认账户治理"页签：风险清单 + 强制改密/禁用登录/启用登录/删除

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 32 节：检测→强制改密→禁用登录→登录拦截→策略开关→删除→无权限 403→审计
- [x] 5.2 全量回归通过（预计 214 + 新增）