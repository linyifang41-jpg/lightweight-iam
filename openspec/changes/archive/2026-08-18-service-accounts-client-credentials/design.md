## Context

现有基建：JWT 工具（`utils/jwt.js`，jsonwebtoken + jti）、`tokenService.isRevoked`（token_blacklist）、`authMiddleware`（目前仅识别 `type:'access'` 人类令牌）、`requirePermission`（按 `req.user.permissions`）、权限表 permissions（名字唯一）。OIDC 已有授权码令牌端点 `/oidc/token` 可参考格式。

## Goals / Non-Goals

**Goals:**
- 服务账号 CRUD + secret 重发 + 启停
- OAuth2 client_credentials 令牌端点（form 编码、标准错误格式）
- 服务账号令牌复用 authMiddleware/requirePermission 访问现有 API
- scope 收窄 + 短期 TTL

**Non-Goals:**
- 完整 OAuth2 服务器（authorization_code/password/refresh 等其余 grant 后续）
- JWT 内嵌权限签名（权限在服务端每次从 DB 读取，secret 轮换即时失效）
- 会话心跳/空闲超时（服务账号无交互会话）

## Decisions

### 决策1：数据模型
`service_accounts`：
- `client_id` 随机 base64url（24B），`client_secret` 随机（32B）→ bcrypt 存哈希，明文仅创建/重发时返回一次
- `permissions` JSON 数组（权限**名字**，校验存在于 permissions 表）
- `ver` 整数版本：重发 secret 或禁用时 +1，JWT 携带 ver，中间件比对，不一致即 401（旧令牌即时作废，无需黑名单）
- `token_ttl_minutes`（默认 15），`expires_at`（可选到期日）、`owner_id`、`last_used_at`

### 决策2：令牌格式
`POST /oauth/token`（express.urlencoded）：
- 成功：`{access_token, token_type:'Bearer', expires_in: ttl*60}`
- 失败：HTTP 401 + `{"error":"invalid_client","error_description":...}`（RFC 6749 风格）
- JWT payload：`{sub: sa.id, name: sa.name, type:'client', ver, scope, iat, exp, jti}`

### 决策3：权限与 scope
令牌有效权限 = 账号 permissions ∩ scope（空格分隔）。`authMiddleware` 解析 `type:'client'`：
- 查 SA（sub），校验 active + expires_at + ver
- `req.user = {id: sa.id, username: sa.name, permissions: [...], isServiceAccount: true}`
- 更新 last_used_at；跳过会话 idle 心跳逻辑

### 决策4：权限点
新增 `sa:manage`，admin 自动绑定。服务账号权限直接引用现有权限名字（非角色）。

## Risks / Trade-offs

- [secret 明文一次] 与现有 OIDC 客户端（client_secret 明文返回一次）一致。
- [版本作废] 禁用会 bump ver，重启用旧令牌也无效，需重新获取——安全优先。
- [非完整 OAuth] 仅 client_credentials，无 refresh 流，服务账号自行轮换。

## Migration Plan

1. database.js：建表 `service_accounts`；权限种子加 `sa:manage`。
2. 新建 `src/services/service-account.service.js`。
3. 新建 `src/routes/oauth.js`；index.js 挂载。
4. authMiddleware 加 client 分支。
5. admin.html 加"服务账号"页签。
6. 测试脚本新增第 31 节；全量回归。

## Open Questions