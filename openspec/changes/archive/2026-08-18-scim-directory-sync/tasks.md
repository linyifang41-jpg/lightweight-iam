## 1. 配置

- [x] 1.1 `policy.service.js`：`DEFAULT_SETTINGS` 加 `scim_token: ''`

## 2. SCIM 路由

- [x] 2.1 `src/routes/scim.js`：认证中间件（Bearer 比对 settings）+ ServiceProviderConfig/ResourceTypes/Schemas
- [x] 2.2 `Users` CRUD：GET（filter/分页）、GET/:id、POST（创建+随机密码+改密）、PUT（全量替换 active→status）、PATCH（active/userName/emails）、DELETE（物理删除）
- [x] 2.3 SCIM 错误响应格式 + 审计 `scim.user.create/update/delete`、`scim.auth_failed`

## 3. 挂载

- [x] 3.1 `src/app.js`：`app.use('/scim/v2', scimRouter)`

## 4. 前端

- [x] 4.1 `admin.html` 安全策略页：SCIM token 生成/重置/展示

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 28 节：匿名 ServiceProviderConfig 200 → 无 token 写操作 401 → POST 创建 → GET filter 匹配 → PATCH active=false 禁用 → 登录被拒 → DELETE 删除
- [x] 5.2 全量回归通过（预计 107 + 新增）