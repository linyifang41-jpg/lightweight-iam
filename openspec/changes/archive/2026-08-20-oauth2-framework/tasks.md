## 1. OIDC / OAuth2 端点

- [x] 1.1 `src/routes/oidc.js`：`/oidc/token` 支持 `grant_type=refresh_token`（client 认证 + 令牌校验 + 轮换 + 审计 `oidc.refresh`）
- [x] 1.2 `src/routes/oidc.js`：发现文档补 `revocation_endpoint`/`introspection_endpoint`、grant_types_supported 加 refresh_token/client_credentials
- [x] 1.3 `src/routes/oauth.js`：`POST /oauth/revoke`（RFC 7009：token + token_type_hint，统一 200，审计 `oauth.revoke`）
- [x] 1.4 `src/routes/oauth.js`：`POST /oauth/introspect`（RFC 7662：客户端认证，全类型令牌检视，审计 `oauth.introspect`）

## 2. 测试与回归

- [x] 2.1 新增 `/tmp/iam_test.sh` 第 33 节：refresh_token 轮换→旧刷新失效；revoke access/refresh→introspect active=false→userinfo 401；未知 token revoke 200；introspect 全类型（人类/client/refresh）+ 未认证 401 + 无效 active=false
- [x] 2.2 全量回归通过（预计 238 + 新增）