## Purpose
实现职责分离（SoD）：互斥角色/权限对的配置与分配时冲突检测，阻止同一主体持有互斥授权组合。

## ADDED Requirements

### Requirement: 互斥规则管理
系统支持维护互斥规则。规则按类型区分：`role`（互斥角色对）、`permission`（互斥权限对）。每对规则唯一（A,B）与（B,A）视为同一条。

#### Scenario: 新增互斥角色对
- **WHEN** 管理员调用 `POST /admin/sod-rules`（role:manage，type=role, leftId=A, rightId=B）
- **THEN** 创建成功，审计 `sod.rule_create`；重复创建（含反向）返回已存在

#### Scenario: 删除互斥规则
- **WHEN** 管理员调用 `DELETE /admin/sod-rules/:id`
- **THEN** 删除成功，审计 `sod.rule_delete`

#### Scenario: 列出互斥规则
- **WHEN** 管理员调用 `GET /admin/sod-rules`
- **THEN** 返回全部规则（含对应名称）

### Requirement: 用户角色分配冲突检测
`assignRole` 分配角色时，若该用户的有效角色集合（直接分配 + 组继承）加入新角色后含互斥角色对，则拒绝分配。

#### Scenario: 分配互斥角色被拒
- **WHEN** 用户已有角色 B，且存在互斥对 (A,B)，管理员再分配 A
- **THEN** 返回 400，错误含冲突信息，不产生分配，审计 `user.assign_role_conflict`

#### Scenario: 正常分配不受影响
- **WHEN** 无互斥关系
- **THEN** 分配成功

### Requirement: 组角色冲突检测
`setGroupRoles` 设置组角色时，组角色集合不得含互斥对；且组内任一成员的有效角色集合不得因本次设置产生互斥。

#### Scenario: 组角色含互斥被拒
- **WHEN** 组角色集合含互斥对 (A,B)
- **THEN** 拒绝，审计 `group.set_roles_conflict`

#### Scenario: 组员有效角色冲突被拒
- **WHEN** 组角色本身无冲突，但某组员直接持有 B，且互斥对 (A,B) 存在
- **THEN** 拒绝，审计 `group.set_roles_conflict`

### Requirement: 角色权限冲突检测
`createRole` / `updateRolePermissions` 设置角色权限时，权限集合不得含互斥权限对。

#### Scenario: 权限集合含互斥被拒
- **WHEN** 权限集合含互斥权限对 (P,Q)
- **THEN** 拒绝，审计 `role.permission_conflict`