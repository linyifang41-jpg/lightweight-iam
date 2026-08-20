## Why

当前 SSO 为自研 cookie + 自研 `/sso/verify`，仅同域应用可用，无法被标准 OIDC Relying Party 接入。规格说明书第四章节"OIDC（OpenID Connect）"标为未实现。实现标准 OIDC Provider（授权码模式）可让任意 OIDC 客户端（Keycloak、标准 RP 库）对接本 IAM，是投入产出最高的协议落地。

## What Changes

- 新增 OIDC Provider：
  - 发现端点 `/.well-known/openid-configuration`
  - JWKS 端点 `/oidc/jwks`（RS256，Node 内置 crypto 生成 RSA 密钥对，持久化）
  - 授权端点 `/oidc/authorize`（Authorization Code Flow：client_id/redirect_uri/scope/state；未登录跳登录页，登录后回跳）
  - Token 端点 `/oidc/token`（code 换 id_token + access_token + refresh_token）
  - UserInfo 端点 `/oidc/userinfo`
- 客户端注册管理：管理后台新增"OIDC 应用"页签（client_id/client_secret/redirect_uri 白名单）
- 审计：OIDC authorize/token 事件留痕
- 保留现有 cookie SSO（向后兼容），OIDC 作为标准通道并存

## Capabilities

### New Capabilities
- `protocol/oidc`: OIDC Provider——发现/JWKS/授权码/token/userinfo 标准端点与客户端管理

### Modified Capabilities

## Impact

- `src/models/database.js`：新增 `oidc_clients` 表、`oidc_auth_codes` 表
- `src/services/oidc.service.js`（新建）：RSA 密钥管理、授权码签发校验、ID Token 生成
- `src/routes/oidc.js`（新建）：well-known/jwks/authorize/token/userinfo
- `src/index.js`：挂载路由
- `src/models/database.js`：seedData 权限点 `oidc:manage`
- `src/routes/admin.js`：OIDC 客户端 CRUD
- `public/admin.html`：新增"OIDC 应用"页签
- 测试脚本 `/tmp/iam_test.sh` 新增用例（完整授权码流程）