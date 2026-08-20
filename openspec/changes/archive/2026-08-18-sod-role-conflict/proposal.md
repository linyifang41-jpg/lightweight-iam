## Why

说明书 5.1"职责分离（SoD）"⬜。等保要求互斥角色/权限冲突检测：一个主体不得同时拥有冲突的角色或权限。当前 assignRole / setGroupRoles / updateRolePermissions 不做任何冲突检查，可造成越权组合（如同时拥有"审批人"与"付款复核"）。

## What Changes

- 新表 `sod_rules`（type: role|permission，left_id/right_id 互斥对，description）
- 冲突检测核心 `adminService.checkSoD(type, ids)`：给定集合是否含互斥对，含则抛错
- 检测点：
  - `assignRole`：用户直接角色 + 组继承角色，加新角色后若含互斥对 → 拒绝
  - `setGroupRoles`：组角色集合互斥检测 + 每个组员有效角色（直接+继承）冲突检测 → 拒绝
  - `createRole` / `updateRolePermissions`：角色权限集合含互斥权限 → 拒绝
- 管理端点：`GET/POST/DELETE /admin/sod-rules`（需 role:manage）
- 管理端 admin.html 新增互斥配置
- 审计：`sod.rule_create`、`sod.rule_delete`、`user.assign_role_conflict`、`group.set_roles_conflict`、`role.permission_conflict`

## Capabilities

### New Capabilities
- `iam/sod`: 职责分离——互斥角色/权限对管理与冲突检测

### Modified Capabilities

## Impact

- `src/models/database.js`：建 `sod_rules` 表
- `src/services/admin.service.js`：checkSoD + assignRole/setGroupRoles/createRole/updateRolePermissions 检测
- `src/routes/admin.js`：sod-rules 端点
- `public/admin.html`：互斥配置 UI
- `/tmp/iam_test.sh` 新增用例