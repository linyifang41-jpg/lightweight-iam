## 1. 数据层与密钥

- [x] 1.1 `src/models/database.js`：新增 `oidc_clients` 表（id/client_id/client_secret_hash/name/redirect_uris/created_at）与 `oidc_auth_codes` 表（code/client_id/user_id/nonce/expires_at/used/created_at）
- [x] 1.2 settings 表幂等写入 `oidc_rsa_private_key`（首次生成 2048-bit RSA 私钥 PEM）；seedData 权限点新增 `oidc:manage`

## 2. OIDC 服务

- [x] 2.1 新建 `src/services/oidc.service.js`：`getRsaKey()`（读 settings，无则生成）、`signJwtRS256(payload)`、`jwkFromPublicKey()`、`generateCode({clientId,userId,nonce})`、`consumeCode({code,clientId})`、`createClient({name,redirectUris})`、`listClients()`、`deleteClient(id)`、`verifyClient(clientId, clientSecret)`
- [x] 2.2 ID Token claims：iss/aud=client_id/sub=userId/exp/iat/nonce/name/email

## 3. OIDC 路由

- [x] 3.1 新建 `src/routes/oidc.js`：`GET /.well-known/openid-configuration`、`GET /oidc/jwks`
- [x] 3.2 `GET /oidc/authorize`：校验 client/redirect_uri；未登录跳 `login.html?redirect=...`；已登录发 code 回跳（含 state）
- [x] 3.3 `POST /oidc/token`：authorization_code grant，校验 client secret + code，返回 id_token/access_token/refresh_token/token_type/expires_in；审计 `oidc.token`
- [x] 3.4 `GET /oidc/userinfo`：Bearer access_token 校验，返回 sub/username/email/phone
- [x] 3.5 `src/index.js`：挂载 oidc 路由

## 4. 管理端客户端管理

- [x] 4.1 `src/routes/admin.js`：`GET/POST /admin/oidc-clients`（oidc:manage）、`DELETE /admin/oidc-clients/:id`；审计 `oidc.client_create`/`oidc.client_delete`
- [x] 4.2 `public/admin.html`：新增"🔌 OIDC 应用"页签——列表、创建表单（名称/redirect_uri 逗号分隔）、client_secret 一次性展示、删除

## 5. 测试与回归

- [x] 5.1 更新 `/tmp/iam_test.sh`：新增第 22 节——创建客户端→well-known 断言端点→未登录 authorize 跳登录→登录后授权码换取 token→id_token 为 RS256 三段式→userinfo 返回 sub→code 二次使用失败→删除客户端
- [x] 5.2 全量回归通过（预计 58 + 新增）