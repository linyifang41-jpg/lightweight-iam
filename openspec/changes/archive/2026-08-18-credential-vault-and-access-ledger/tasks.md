## 1. 数据层与权限点

- [x] 1.1 `src/models/database.js`：新增 `credentials` 表（id/name/system/username/encrypted_password/note/created_at/updated_at）
- [x] 1.2 seedData 权限数组新增 `credential:manage`、`ledger:view`

## 2. 凭据保险库服务

- [x] 2.1 新建 `src/services/vault.service.js`：`deriveKey()`（VAULT_KEY 或 JWT_SECRET 派生 32 字节）、`encrypt(plain)`、`decrypt(payload)`
- [x] 2.2 `listCredentials()`：列表不含密文列；`createCredential({name,system,username,password,note})`；`deleteCredential(id)`；`revealCredential(id)` 解密返回明文

## 3. 权限台账服务

- [x] 3.1 新建 `src/services/ledger.service.js`：`getLedger(query)`——遍历用户，聚合直接角色（来源"直接"）与继承角色（来源"组:名称"），权限按角色去重并集；`exportLedgerCSV()`

## 4. 路由

- [x] 4.1 `src/routes/admin.js`：`GET/POST /admin/credentials`（credential:manage）、`DELETE /admin/credentials/:id`、`GET /admin/credentials/:id/reveal`（审计 vault.reveal）
- [x] 4.2 `GET /admin/ledger`（ledger:view，支持 ?q= 检索）、`GET /admin/ledger/export`（CSV）
- [x] 4.3 各创建/删除操作审计 `vault.create`/`vault.delete`

## 5. 管理端 UI

- [x] 5.1 `public/admin.html`：导航新增"🔑 凭据保险库"页签——凭据列表（脱敏）、新增表单、查看明文按钮、删除按钮
- [x] 5.2 `public/admin.html`：导航新增"📗 权限台账"页签——检索框、表格（用户/角色及来源/权限）、导出 CSV 按钮
- [x] 5.3 authActionNames 映射新增 vault/recovery/session.idle_timeout 等审计事件

## 6. 测试与回归

- [x] 6.1 更新 `/tmp/iam_test.sh`：新增第 21 节——创建凭据→列表不含明文→reveal 返回明文→DB 存密文→台账含组继承来源→CSV 导出；第 20 节 MFA 用例
- [x] 6.2 全量回归 58 用例全部通过