## Context

现有基建：RBAC（roles→permissions、user_roles、group_roles 组继承）、`userService.getUserPermissions`、`adminService`、`auditService.log`、`policyService`（settings）、部门表 departments（用户 department_id）。决策点需与既有权限体系并存：ABAC 提供属性级规则，未命中时由调用方按 RBAC 兜底。

## Goals / Non-Goals

**Goals:**
- 用户属性模型（内置字段 + 扩展 key-value 属性）
- ABAC 策略 CRUD（条件表达式：lhs/op/rhs）
- 决策点 `/authz/check`（deny 优先于 allow）
- 管理端页签 + 审计

**Non-Goals:**
- 资源对象/实例存储（resource 由调用方随请求传入，不持久化）
- 策略引擎外部化（OPA/XACML/Rego）
- 会话内强制接入（本批只提供 PDP 端点，应用按需接入）

## Decisions

### 决策1：属性来源
- 用户内置属性：`username`、`status`、`realm`、`department`（经 department_id JOIN 解析为部门名，无部门为空串）
- 用户扩展属性：新表 `user_attributes(user_id, attr_key, attr_value)`，决策表达式用 `user.attr.<key>` 引用
- 资源属性：调用方在 `/authz/check` 的 `resource` 对象中传入，表达式 `resource.<key>`
- 上下文：`context.now`（ISO 时间）、`context.ip`（请求 IP）

### 决策2：条件表达式
conditions 为 JSON 数组，每项 `{lhs, op, rhs}`：
- lhs 白名单：`user.attr.<key>` / `user.department` / `user.status` / `user.realm` / `resource.<key>` / `context.now` / `context.ip`
- op：eq / ne / in（rhs 为 JSON 数组）/ contains（rhs 数组，lhs 值属于集合）/ exists（rhs 忽略）/ gt / ge / lt / le（数值比较）
- 单条规则所有条件同时满足即命中（AND）

### 决策3：决策语义
遍历 enabled 且 resource_type 匹配（精确或 `*`）的策略：命中则记录 effect；**deny 优先于 allow**；同 effect 取 priority 高者。返回 `decision`（allow/deny/default）+ `matchedRule`（id/name）+ `allowed`（deny=false，其余 true）。无命中 → default，allowed=true。

### 决策4：权限点
新增种子权限 `abac:manage`，admin 角色预绑。策略 CRUD 端点 requirePermission('abac:manage') + CSRF。`/authz/check` 仅需登录（authMiddleware）。

### 决策5：资源类型匹配
`resource_type` 精确匹配入参 resourceType；`*` 为全局通配。规则内亦可加 `resource.<attr>` 条件细分。

## Risks / Trade-offs

- [属性扩展] user_attributes 为 demo 级 key-value，无类型/校验约束，生产可换为 schema 化属性目录。
- [调用方兜底] 未命中规则时决策点返回 default，是否拒绝取决于调用方 RBAC 判定，需文档说明。
- [性能] 决策点全表扫描策略（量小可接受）；量大需索引/编译缓存。

## Migration Plan

1. database.js：建表 `user_attributes`、`abac_policies`；权限种子加 `abac:manage` 并绑定 admin。
2. 新建 `src/services/authz.service.js`（属性解析、条件求值、策略 CRUD、authorize）。
3. 新建 `src/routes/authz.js`（`POST /authz/check`）；`src/routes/admin.js` 加策略/属性端点。
4. index.js 挂载 authz 路由。
5. admin.html 加"ABAC 策略"页签。
6. 测试脚本新增第 29 节；全量回归。

## Open Questions