## Purpose
基于属性（用户部门/职级/扩展属性、资源属性、上下文）的访问控制：管理员配置 ABAC 策略规则，任何登录态调用方可调用决策点做 allow/deny 判断。deny 优先于 allow，未命中规则时由调用方按 RBAC 兜底。

## ADDED Requirements

### Requirement: 用户属性模型
用户除内置字段（department/status/realm）外可设置扩展属性（key-value），存 `user_attributes` 表。管理端可读取/设置。

#### Scenario: 设置用户扩展属性
- **WHEN** 管理员 PUT /admin/users/:id/attributes {"attributes":{"title":"总监","cost_center":"CC-01"}}
- **THEN** 用户属性被保存，审计 `abac.attr_update`

#### Scenario: 决策时解析用户属性
- **WHEN** 决策点评估 `user.attr.title`
- **THEN** 使用该用户扩展属性值；内置字段 user.department 解析为部门名、user.status 为账号状态

### Requirement: ABAC 策略规则管理
`abac_policies` 表保存规则：name、description、resource_type（`*`=全局）、effect（allow/deny）、priority、enabled、conditions（JSON 数组，每项 `{lhs, op, rhs}`）。管理端点需 `abac:manage` 权限 + CSRF。

#### Scenario: 创建策略
- **WHEN** 管理员 POST /admin/abac/policies 提交合法规则
- **THEN** 返回 201 + 规则，审计 `abac.policy_create`

#### Scenario: 非法规则被拒
- **WHEN** lhs 不在白名单（user.* / resource.* / context.*）或 op 非法
- **THEN** 返回 400 错误

#### Scenario: 更新与删除策略
- **WHEN** PUT /admin/abac/policies/:id / DELETE
- **THEN** 规则被更新/删除，审计 `abac.policy_update/delete`

#### Scenario: 无权限访问
- **WHEN** 用户无 `abac:manage` 权限操作策略端点
- **THEN** 返回 403

### Requirement: 策略决策点（PDP）
`POST /authz/check`（需登录）：入参 `{action, resourceType, resource}`，决策上下文含 user 属性、resource 属性、context（now/ip 等）。遍历 enabled 策略（resourceType 精确匹配或 `*`）：全部条件满足则命中；deny 优先于 allow；无命中返回 default。

#### Scenario: allow 命中
- **WHEN** 匹配的 allow 规则命中且无 deny 命中
- **THEN** 返回 decision=allow, allowed=true，附 matchedRule

#### Scenario: deny 覆盖 allow
- **WHEN** 同一请求同时命中 deny 与 allow 规则
- **THEN** 返回 decision=deny, allowed=false

#### Scenario: 未命中返回 default
- **WHEN** 无任何规则命中
- **THEN** 返回 decision=default, allowed=true（由调用方按 RBAC 兜底）

#### Scenario: 条件运算
- **WHEN** 规则含 op=eq/in/contains/exists/gt/ge/lt/le
- **THEN** 按语义正确比较（数值与字符串）

### Requirement: 管理端界面
admin.html 新增"ABAC 策略"页签：策略列表、创建（资源类型/effect/条件行）、编辑、删除。

#### Scenario: 页面加载策略列表
- **WHEN** 进入 ABAC 页签
- **THEN** 渲染全部策略规则