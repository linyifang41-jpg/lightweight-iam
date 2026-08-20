## 1. 数据模型

- [x] 1.1 `src/models/database.js`：建表 `service_accounts`；权限种子新增 `sa:manage`

## 2. 服务账号服务

- [x] 2.1 `src/services/service-account.service.js`：create/regenerateSecret/update（禁用 bump ver）/delete/issueToken（校验+签发）/list

## 3. 路由与中间件

- [x] 3.1 `src/routes/oauth.js`：`POST /oauth/token`（client_credentials，RFC 6749 错误格式）
- [x] 3.2 `src/middleware/auth.js`：client 令牌分支（ver 校验 + scope 过滤 + last_used_at）
- [x] 3.3 admin 路由：`GET/POST /admin/service-accounts`、`PUT/DELETE /admin/service-accounts/:id`、`POST /admin/service-accounts/:id/secret`（sa:manage + CSRF）
- [x] 3.4 挂载 oauth 路由（index.js）

## 4. 前端

- [x] 4.1 admin.html"服务账号"页签：列表/创建/重发 secret/启停/删除

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 31 节：创建→换发令牌→按权限访问→scope 收窄→凭据错误 401→禁用/重发作废旧令牌→删除→无权限 403
- [x] 5.2 全量回归通过（预计 193 + 新增）