## Why

说明书 4.2"OAuth 2.0 ⬜"。当前有 OIDC 授权码（/oidc/authorize + /oidc/token）与服务账号 client_credentials（/oauth/token），但缺少完整 OAuth2 服务器要素：refresh_token grant、RFC 7009 令牌吊销（revoke）、RFC 7662 令牌检视（introspect）。本批补齐，将 OIDC + 服务账号统一为完整 OAuth2 框架。

## What Changes

- `/oidc/token` 支持 `grant_type=refresh_token`：校验 refresh token（未吊销 + 用户 active）+ client 认证 → 轮换签发新 access/refresh/id_token，旧 refresh 立即失效（复用现有 tokenService/sessionService 轮换逻辑）
- 新增 `POST /oauth/revoke`（RFC 7009）：按 token（可带 token_type_hint）吊销 access/refresh/client 令牌；未知/无效令牌也返回 200
- 新增 `POST /oauth/introspect`（RFC 7662）：客户端认证（OIDC client_id+secret 或有效 Bearer 令牌）后检视令牌，返回 active/scope/sub/token_type/exp/iat 等；无效返回 `{"active":false}`
- OIDC 发现文档更新：`grant_types_supported` 加 refresh_token/client_credentials；新增 `revocation_endpoint`、`introspection_endpoint`
- 审计：`oidc.refresh`、`oauth.revoke`、`oauth.introspect`
- `/tmp/iam_test.sh` 新增第 33 节

## Capabilities

### New Capabilities
- `protocol/oauth2`: OAuth 2.0 正式框架（refresh_token grant + 令牌吊销 + 令牌检视）

### Modified Capabilities

## Impact

- `src/routes/oidc.js`：/oidc/token 加 refresh_token grant；发现文档补端点
- `src/routes/oauth.js`：新增 POST /oauth/revoke、POST /oauth/introspect
- `/tmp/iam_test.sh` 新增用例（预期 238 + 新增）