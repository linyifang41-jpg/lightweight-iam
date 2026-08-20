## Purpose
提供标准 OIDC Provider（Authorization Code Flow）：发现端点、JWKS、授权端点、Token 端点、UserInfo 端点及客户端管理，使任意标准 OIDC Relying Party 可对接本 IAM。

## ADDED Requirements

### Requirement: OIDC 发现与 JWKS
系统暴露 `/.well-known/openid-configuration` 发现文档，包含 issuer、authorization_endpoint、token_endpoint、userinfo_endpoint、jwks_uri、scopes_supported、response_types_supported、subject_types_supported、id_token_signing_alg_values_supported（含 RS256）。JWKS 端点返回 RSA 公钥（kty=RSA，含 n/e），签名密钥由系统内置生成并持久化，支持 RS256 验签。

#### Scenario: 发现文档可访问
- **WHEN** 客户端 GET `/.well-known/openid-configuration`
- **THEN** 返回含 issuer 与各端点 URL 的 JSON

#### Scenario: JWKS 返回公钥
- **WHEN** 客户端 GET `/oidc/jwks`
- **THEN** 返回含 RSA 公钥的 JWKS JSON，可验证 RS256 签名

### Requirement: 授权端点（Authorization Code Flow）
`/oidc/authorize` 支持 client_id、redirect_uri、response_type=code、scope（含 openid）、state。未登录用户跳转登录页并在登录后回跳授权（携带 state）；已登录用户直接回跳。redirect_uri 必须在客户端注册白名单内，否则拒绝。code 一次性、短有效期（5 分钟），与 client_id、用户绑定。

#### Scenario: 未登录发起授权
- **WHEN** 未登录用户访问授权端点
- **THEN** 跳转登录页，登录完成后回跳授权并最终重定向到 redirect_uri?code=xxx&state=xxx

#### Scenario: redirect_uri 不在白名单
- **WHEN** 授权请求携带未注册的 redirect_uri
- **THEN** 返回错误（invalid_request），不重定向

#### Scenario: code 一次性
- **WHEN** 同一授权码被重复换取 token
- **THEN** 第二次请求失败（invalid_grant）

### Requirement: Token 端点
`/oidc/token` 支持 grant_type=authorization_code，校验 client_id/client_secret 与授权码，返回 id_token（RS256 签名 JWT，含 iss/sub/aud/exp/iat/nonce）、access_token、refresh_token、token_type=Bearer、expires_in。授权码使用后立即作废。

#### Scenario: 正确换取 token
- **WHEN** 携带有效授权码与 client 凭据请求 token 端点
- **THEN** 返回含 id_token 的标准 token 响应

#### Scenario: client 凭据错误
- **WHEN** client_secret 不匹配
- **THEN** 返回 invalid_client 错误

### Requirement: UserInfo 端点
`/oidc/userinfo` 接受 Bearer access_token，返回当前用户标准 claims（sub、preferred_username、email、phone 等）。令牌无效返回 401。

#### Scenario: 有效令牌获取用户信息
- **WHEN** 携带有效 access_token 请求 userinfo
- **THEN** 返回含 sub 与用户属性的 claims

#### Scenario: 无效令牌
- **WHEN** access_token 无效或已过期
- **THEN** 返回 401

### Requirement: OIDC 客户端管理
具有 `oidc:manage` 权限的管理员可创建/查看/删除 OIDC 客户端（client_id 自动生成、client_secret 生成后仅展示一次、redirect_uri 白名单数组）。删除客户端后其授权码全部作废。

#### Scenario: 创建客户端
- **WHEN** 管理员提交应用名与 redirect_uri 列表
- **THEN** 生成 client_id/client_secret 并保存，审计 `oidc.client_create`

#### Scenario: 客户端删除
- **WHEN** 管理员删除客户端
- **THEN** 客户端及其授权码被删除，审计 `oidc.client_delete`