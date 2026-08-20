## Context

现有基建：OIDC 授权码流（`oidc.js` / `oidc.service.js`，client 表存 sha256 secret 哈希，授权码一次性、5 分钟 TTL）；`/oauth/token`（`oauth.js`）client_credentials 签发 `type:'client'` 令牌；`generateTokens`（`utils/jwt.js`）签发人类 access（type:'access'）与 refresh（type:'refresh'）令牌，均带 jti；`tokenService.revoke/isRevoked/revokeJtis`（token_blacklist 黑名单）；`sessionService.updateByRefreshJti` 用于轮换；`/auth/refresh` 已实现 refresh 轮换先例。授权码换取时已返回 refresh_token 字段（但未支持其 grant）。

## Goals / Non-Goals

**Goals:**
- refresh_token grant（轮换 + 旧令牌作废）
- RFC 7009 revoke（access/refresh/client 令牌，统一 200）
- RFC 7662 introspect（客户端认证 + 全类型令牌检视）
- 发现文档补全
- 全动作审计

**Non-Goals:**
- client_secret_basic / PKCE 扩展（现有 client_secret_post 够用）
- 设备流 / 授权码 + PKCE / password grant（不属于本批）
- 管理端 UI（协议端点，API 层交付 + 测试覆盖）

## Decisions

### 决策1：refresh_token grant 复用现有轮换机制
在 `/oidc/token` 增加分支：`grant_type=refresh_token` 时要求 client 认证 + refresh token 有效；校验逻辑与 `/auth/refresh` 一致（safeVerify type==='refresh'、isRevoked、user active）；轮换用 `sessionService.updateByRefreshJti(oldJti, {jti, refreshJti})` + `tokenService.revoke(oldDecoded)`；返回新 access/refresh/id_token。错误按 OAuth2：400 invalid_grant。

### 决策2：revoke 按 token_type_hint + 自动探测
`token_type_hint` 优先；无 hint 时解码判定（type 'access'/'client'→access，'refresh'→refresh）。统一 `tokenService.revoke(decoded)` 加黑名单。任何结果均 200（RFC 7009）。client 凭据校验：若带 client_id 则校验为合法 OIDC client，否则允许匿名（简化，但审计记录）。

### 决策3：introspect 客户端认证 + 全类型检视
调用方认证二选一：(a) client_id+client_secret（OIDC verifyClient）；(b) Bearer 有效 access/client 令牌。目标令牌分类：type 'access'（人类）→ sub=userId、username；type 'client'（服务账号）→ sub=sa.id、name、scope；type 'refresh' → sub=userId、token_type=refresh_token。active=签名有效且未吊销且未过期。无效返回 {"active":false}，未认证返回 401。

### 决策4：审计
新增 `oidc.refresh`、`oauth.revoke`、`oauth.introspect`，detail 记录 clientId/token 类型/主体。

### 决策5：scope 透出
client 令牌的 scope 来自 JWT payload；人类 access 令牌 scope 为 null（本系统基于 RBAC，无 OAuth scope 语义）。

## Risks / Trade-offs

- [revoke 匿名调用] 允许无客户端凭据吊销，换取简化；审计留痕；生产可要求 client 认证（后续加固）。
- [refresh 返回 id_token] 与 OIDC 规范一致（refresh 后可选返回 id_token），本实现直接返回，客户端无需再走授权码。
- [轮换即失效] 沿用现有人类会话刷新语义，安全性优先。

## Migration Plan

1. `oidc.js`：/oidc/token 加 refresh_token 分支；发现文档补端点与 grant_types。
2. `oauth.js`：新增 POST /oauth/revoke、POST /oauth/introspect。
3. 测试脚本新增第 33 节；全量回归。

## Open Questions