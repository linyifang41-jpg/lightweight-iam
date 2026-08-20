## 1. 数据层

- [x] 1.1 `src/models/database.js`：migrate 新增 `users.realm`（TEXT DEFAULT 'default'）
- [x] 1.2 迁移旧 `username` 唯一索引为 `(username, realm)` 复合唯一索引

## 2. 服务层

- [x] 2.1 `user.service.js`：`findByUsername(username, realm)`、`findByEmailOrPhone(account, realm)`、`createUser({..., realm})` 支持租户维度，默认 `default`
- [x] 2.2 realm 校验函数 `isValidRealm()`（正则，默认租户兜底）

## 3. 认证路由

- [x] 3.1 `auth.js` 注册：解析 realm，按租户校验用户名唯一性
- [x] 3.2 `auth.js` 登录：解析 realm，按租户查找账号，非法 realm 400

## 4. 前端

- [x] 4.1 `login.html`：租户选择（下拉默认 `default` + 输入）
- [x] 4.2 `register.html`：租户输入（默认 `default`）
- [x] 4.3 `admin.html` 用户列表：显示租户列

## 5. 测试与回归

- [x] 5.1 更新 `/tmp/iam_test.sh`：新增第 23 节——跨租户同用户名隔离（A 租户注册/登录成功，B 租户同用户名互不影响）、非法 realm 拒绝、默认租户兼容（存量登录不受影响）
- [x] 5.2 全量回归通过（预计 71 + 新增）