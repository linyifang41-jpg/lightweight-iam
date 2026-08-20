# workload/service-accounts Specification

## Purpose
为应用/服务提供非人类身份：管理员创建服务账号（client_id + client_secret），机器通过 OAuth2 client_credentials 换发短期访问令牌，令牌可访问本系统受保护 API（权限点由服务账号绑定，scope 可收窄）。

## Requirements

### Requirement: 服务账号管理
具备 `sa:manage` 权限者可创建/编辑/禁用/删除服务账号。创建时返回 client_id 与 client_secret（明文仅展示一次）。secret 可重发（旧令牌作废）。

#### Scenario: 创建服务账号
- **WHEN** 管理员 POST /admin/service-accounts 提交 name + permissions
- **THEN** 返回 201 + clientId + clientSecret（明文一次），审计 `sa.create`

#### Scenario: 重发凭据
- **WHEN** 管理员 POST /admin/service-accounts/:id/secret
- **THEN** 返回新 secret，旧令牌全部作废，审计 `sa.secret`

#### Scenario: 禁用/启用
- **WHEN** PUT /admin/service-accounts/:id 设 status=disabled
- **THEN** 禁用生效，已有令牌失效；重新启用后需重新获取令牌

#### Scenario: 无权限 403
- **WHEN** 无 `sa:manage` 用户访问服务账号端点
- **THEN** 返回 403

### Requirement: 客户端凭证令牌（client_credentials）
`POST /oauth/token`（form 编码）：`grant_type=client_credentials&client_id=..&client_secret=..&scope=..`，校验通过后签发短期 JWT 访问令牌。

#### Scenario: 换发令牌成功
- **WHEN** client_id/secret 正确
- **THEN** 返回 access_token + token_type=Bearer + expires_in（TTL 由服务账号 token_ttl_minutes 决定）

#### Scenario: 凭据错误
- **WHEN** secret 错误或 client_id 不存在
- **THEN** 返回 401 + `{"error":"invalid_client"}`，审计 `sa.auth_failed`

#### Scenario: 禁用/过期拒绝
- **WHEN** 服务账号已禁用或过期
- **THEN** 返回 401 invalid_client

### Requirement: 服务账号令牌访问 API
服务账号令牌可访问受保护端点；权限 = 服务账号权限 ∩ scope（缺省全部）。

#### Scenario: 按权限访问
- **WHEN** 服务账号持有 audit:view 且请求 GET /admin/audit-logs
- **THEN** 返回 200

#### Scenario: 无对应权限拒绝
- **WHEN** 服务账号无 user:manage 请求 GET /admin/users
- **THEN** 返回 403

#### Scenario: scope 收窄
- **WHEN** 换发令牌时 scope="audit:view"（账号本身持 audit:view+user:manage）
- **THEN** 令牌仅具备 audit:view，访问用户列表 403、访问审计日志 200

#### Scenario: 令牌作废
- **WHEN** 服务账号被禁用、删除或 secret 重发后使用旧令牌
- **THEN** 返回 401
