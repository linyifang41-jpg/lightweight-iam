## Why

说明书"ABAC 属性授权"⬜。当前仅 RBAC（角色+权限+组继承），无法按**属性**（用户部门/职级、资源密级、上下文时间）做访问控制。ABAC（NIST SP 800-162）是云 IAM（AWS IAM 策略 / Azure / 腾讯 IDaaS）的标准授权模型，可为"只能看本部门文档""涉密资源仅限特定职级"这类场景提供策略化授权。

## What Changes

- 新增属性模型：
  - `user_attributes` 表（user_id, attr_key, attr_value）：用户扩展属性（职级/成本中心等）
  - 用户内置属性映射：department（部门名）、status、realm、username
- 新增 ABAC 策略表 `abac_policies`：名称、资源类型（resource_type，`*`=全局）、effect（allow/deny）、优先级、启停、条件 JSON（conditions: `{lhs, op, rhs}[]`）
- 新增 `src/services/authz.service.js`（PDP）：
  - `evaluateConditions(conditions, ctx)`：lhs 支持 `user.department`/`user.status`/`user.attr.<k>`/`resource.<attr>`/`context.<attr>`，op 支持 eq/ne/in/contains/exists/gt/lt/ge/le
  - `authorize({userId, action, resourceType, resource})`：deny 优先于 allow，未命中返回 default（由调用方按 RBAC 兜底）
- 新增权限点 `abac:manage`（种子权限 + admin 角色）
- 管理端点（需 `abac:manage` + CSRF）：
  - `GET/POST /admin/abac/policies`、`PUT/DELETE /admin/abac/policies/:id`
  - `PUT /admin/users/:id/attributes`：设置用户扩展属性
- PDP 端点（需登录）：`POST /authz/check` → `{decision:'allow'|'deny'|'default', allowed, matchedRule}`
- 审计：`abac.policy_create/update/delete`、`abac.check`、`abac.attr_update`
- `public/admin.html` 新增"ABAC 策略"页签（规则 CRUD）
- `/tmp/iam_test.sh` 新增第 29 节

## Capabilities

### New Capabilities
- `iam/abac`: 基于属性的访问控制（策略规则 + 决策点 + 用户属性）

### Modified Capabilities

## Impact

- 新表 `user_attributes`、`abac_policies`（database.js 幂等迁移）
- 新文件 `src/services/authz.service.js`、`src/routes/authz.js`
- `src/routes/admin.js`：ABAC 策略/用户属性端点
- `src/models/database.js`：权限种子加 `abac:manage`、admin 角色绑定
- `public/admin.html`：ABAC 页签
- `/tmp/iam_test.sh` 新增用例（预期 140 + 新增）