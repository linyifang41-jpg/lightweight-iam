## Purpose
以 SCIM 2.0（RFC 7643/7644）协议暴露用户目录，供上游身份源自动开通/更新/禁用用户账号。

## ADDED Requirements

### Requirement: SCIM 服务配置与认证
`GET /scim/v2/ServiceProviderConfig` 返回能力声明；所有写操作与用户查询需 `Authorization: Bearer <scim_token>`，token 存于 settings。

#### Scenario: ServiceProviderConfig 可匿名读取
- **WHEN** GET /scim/v2/ServiceProviderConfig
- **THEN** 返回 schemas/支持方法/过滤器等能力

#### Scenario: 写操作需有效 Bearer token
- **WHEN** 无 token 或 token 错误发起写操作
- **THEN** 返回 401，审计 `scim.auth_failed`

### Requirement: 用户查询
`GET /scim/v2/Users` 支持分页与 filter；`GET /scim/v2/Users/:id` 返回单个用户。

#### Scenario: 按 userName 过滤
- **WHEN** filter=userName eq "foo"
- **THEN** 返回匹配用户（totalResults/Resources）

#### Scenario: 按 id 查询
- **WHEN** GET /Users/:id 存在
- **THEN** 返回该用户 SCIM 资源

### Requirement: 用户创建
`POST /scim/v2/Users`：userName→username，emails/phoneNumbers→email/phone，active→status。密码缺省生成随机密码并要求首登改密。

#### Scenario: 创建成功
- **WHEN** userName 不存在
- **THEN** 返回 201 + SCIM 资源，审计 `scim.user.create`

#### Scenario: userName 已存在
- **WHEN** POST 的 userName 已存在
- **THEN** 返回 409 conflict

#### Scenario: active=false 创建
- **WHEN** active=false
- **THEN** 用户创建为 disabled

### Requirement: 用户更新
`PUT /Users/:id` 全量替换；`PATCH /Users/:id` 增量更新（active/userName/emails）。

#### Scenario: 禁用用户
- **WHEN** PUT/PATCH 设 active=false
- **THEN** 用户置 disabled 并吊销会话，审计 `scim.user.update`

#### Scenario: 启用用户
- **WHEN** PATCH 设 active=true
- **THEN** 用户置 active

### Requirement: 用户删除
`DELETE /Users/:id` 物理删除。

#### Scenario: 删除成功
- **WHEN** DELETE 已存在用户
- **THEN** 返回 204，审计 `scim.user.delete`

### Requirement: 管理端 token 配置
安全策略页提供生成/重置 SCIM token，token 写入 settings `scim_token`。

#### Scenario: 生成 token
- **WHEN** 管理员点击生成
- **THEN** 设置新随机 token 并展示一次