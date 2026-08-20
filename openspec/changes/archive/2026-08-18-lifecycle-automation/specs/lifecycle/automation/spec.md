## Purpose
以事件驱动方式（IGA joiner/mover/leaver）自动化账号生命周期：入职自动开通并赋权、转岗重配权限、离职回收权限与会话。

## ADDED Requirements

### Requirement: 入职（Joiner）
`POST /admin/lifecycle/join`：创建账号并赋权，一次完成入职。入参 username、password（缺省走策略自动生成）、email/phone、departmentId、groupIds、roleIds。可要求首登强制改密。

#### Scenario: 正常入职
- **WHEN** 管理员调用 join 且 username 不存在
- **THEN** 创建用户、加入指定组、分配角色、设部门，审计 `lifecycle.join`，返回用户 id

#### Scenario: 用户名已存在
- **WHEN** join 的 username 已存在
- **THEN** 返回 400 且不重复创建

#### Scenario: 强制改密
- **WHEN** 入职要求首登改密
- **THEN** 用户 `must_change_password=1`

### Requirement: 转岗（Mover）
`POST /admin/lifecycle/move`：更新部门并重配权限。入参 userId、departmentId（可空=不修改）、addGroupIds/removeGroupIds、addRoleIds/removeRoleIds。

#### Scenario: 正常转岗
- **WHEN** 管理员调用 move
- **THEN** 部门更新、组/角色按增删调整，审计 `lifecycle.move`

#### Scenario: 用户不存在
- **WHEN** move 的 userId 不存在
- **THEN** 返回 400

### Requirement: 离职（Leaver）
`POST /admin/lifecycle/leave`：回收权限并停用/归档。入参 userId、mode（disabled|archived）、revokeRoles（默认 true）。

#### Scenario: 正常离职
- **WHEN** 管理员调用 leave
- **THEN** 用户状态改为 disabled/archived，移除直接角色，吊销全部会话与 token，审计 `lifecycle.leave`

#### Scenario: 用户不存在
- **WHEN** leave 的 userId 不存在
- **THEN** 返回 400

### Requirement: 权限校验
三个端点均需 `user:manage` 权限，需 CSRF。

#### Scenario: 无权限被拒
- **WHEN** 无 `user:manage` 权限的用户调用 join/move/leave
- **THEN** 返回 403

#### Scenario: 缺 CSRF 被拒
- **WHEN** 请求缺 CSRF token
- **THEN** 返回 403