## Why

说明书"非人类身份（Workload / Machine Identity）"整节⬜：服务账号、客户端凭证、短期凭证。当前仅有人类用户身份（users 表），应用/服务间机器身份调用无标准凭据。本批实现：**服务账号管理 + OAuth2 client_credentials 令牌端点 + 短期（可配 TTL）访问令牌**，服务账号令牌可访问现有受保护 API（复用 authMiddleware + RBAC 权限点）。

## What Changes

- 新表 `service_accounts`：name、client_id、client_secret_hash（bcrypt）、status、permissions（权限名数组）、token_ttl_minutes、owner_id、expires_at、last_used_at、ver（凭据版本，rotate/禁用时递增作废旧令牌）
- 新权限点 `sa:manage`（种子 + admin 绑定）
- 新增 `src/services/service-account.service.js`：
  - `createServiceAccount`：生成 client_id + 明文 secret（仅返回一次），bcrypt 存哈希
  - `regenerateSecret` / `updateServiceAccount`（禁用时 bump ver）/ `deleteServiceAccount`
  - `issueToken({clientId, clientSecret, scope})`：校验凭据/状态/有效期，签发 JWT（`type:'client'`、`sub`=sa id、`ver`、`scope`），TTL 可配
- 新增 `src/routes/oauth.js`：`POST /oauth/token`（grant_type=client_credentials，form 编码，标准 OAuth 错误格式 invalid_client）
- `authMiddleware` 扩展：识别 `type:'client'` 令牌 → 校验 SA 存在/启用/ver 匹配 → 按 scope 过滤权限 → 注入 `req.user`（isServiceAccount）
- 审计：`sa.create/update/secret/delete/token_issue`
- admin.html 新增"服务账号"页签
- `/tmp/iam_test.sh` 新增第 31 节

## Capabilities

### New Capabilities
- `workload/service-accounts`: 服务账号与客户端凭证（非人类身份 + 短期令牌）

### Modified Capabilities

## Impact

- `src/models/database.js`：建表 `service_accounts`、权限种子加 `sa:manage`
- 新文件 `src/services/service-account.service.js`、`src/routes/oauth.js`
- `src/middleware/auth.js`：client 令牌分支
- `src/index.js`：挂载 oauth 路由
- `public/admin.html`：服务账号页签
- `/tmp/iam_test.sh` 新增用例（预期 193 + 新增）