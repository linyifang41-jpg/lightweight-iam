# protocol/oauth2 Specification

## Purpose
补齐 OAuth 2.0 正式框架：refresh_token grant、RFC 7009 令牌吊销、RFC 7662 令牌检视，与现有 OIDC 授权码 / 服务账号 client_credentials 统一为完整 OAuth2 服务器。

## ADDED Requirements

### Requirement: refresh_token grant
`POST /oidc/token` 支持 `grant_type=refresh_token`：请求含 refresh_token + client_id + client_secret。校验 refresh token（JWT type=refresh、未被吊销、对应用户 active）通过后轮换签发新的 access_token / refresh_token / id_token，旧 refresh token 立即失效。

#### Scenario: 刷新令牌成功
- **WHEN** 提供有效 refresh_token + 正确 client 凭据
- **THEN** 返回 200 + 新 access_token + refresh_token + id_token，审计 `oidc.refresh`

#### Scenario: 刷新令牌已失效
- **WHEN** refresh_token 已被吊销或过期
- **THEN** 返回 400 invalid_grant

#### Scenario: 轮换后旧刷新令牌失效
- **WHEN** 使用轮换前的旧 refresh_token 再次请求
- **THEN** 返回 400 invalid_grant

### Requirement: 令牌吊销（RFC 7009）
`POST /oauth/revoke`：请求含 token（可选 token_type_hint=access_token|refresh_token）。按类型吊销令牌（加入黑名单）；未知或无效令牌同样返回 200。审计 `oauth.revoke`。

#### Scenario: 吊销 access token
- **WHEN** 提交有效 access token 至 revoke
- **THEN** 返回 200，之后该令牌访问受保护端点返回 401

#### Scenario: 吊销 refresh token
- **WHEN** 提交有效 refresh token 至 revoke
- **THEN** 返回 200，之后该 refresh token 无法再换发

#### Scenario: 未知令牌仍返回 200
- **WHEN** 提交无效/未知 token
- **THEN** 返回 200（不泄露有效性）

### Requirement: 令牌检视（RFC 7662）
`POST /oauth/introspect`：调用方须通过客户端认证（OIDC client_id+secret，或有效 Bearer 访问令牌）。检视目标令牌：access / client / refresh 令牌返回 active 及相关属性（sub、scope、token_type、exp、iat）；无效/未知/过期返回 `{"active":false}`。审计 `oauth.introspect`。

#### Scenario: 检视有效 access token
- **WHEN** 以合法客户端认证检视未吊销的 access token
- **THEN** 返回 active=true + sub + token_type=Bearer + exp

#### Scenario: 检视服务账号令牌
- **WHEN** 检视 client_credentials 签发的令牌
- **THEN** 返回 active=true + sub（服务账号 id）+ scope

#### Scenario: 检视吊销后令牌
- **WHEN** 令牌已被吊销或已过期
- **THEN** 返回 active=false

#### Scenario: 调用方未认证
- **WHEN** 未提供合法客户端认证
- **THEN** 返回 401

### Requirement: 发现文档更新
OIDC 发现文档补充 OAuth2 端点信息：grant_types_supported 含 authorization_code/refresh_token/client_credentials；revocation_endpoint、introspection_endpoint。

#### Scenario: 发现文档包含新端点
- **WHEN** GET /.well-known/openid-configuration
- **THEN** 返回含 revocation_endpoint/introspection_endpoint 且 grant_types_supported 覆盖三种 grant