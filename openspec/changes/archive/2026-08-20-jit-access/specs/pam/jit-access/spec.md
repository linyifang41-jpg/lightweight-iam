# pam/jit-access Specification

## Purpose
即时访问（JIT）：用户按需申请限时临时角色，审批通过后授予，到期自动回收（惰性），管理端可随时撤销。全程审计，实现特权最小化。

## ADDED Requirements

### Requirement: 自助申请临时提权
登录用户可申请临时角色（`POST /auth/jit-requests`，CSRF）：提供 roleId、reason、durationMinutes。校验：角色存在、时长在 `jit_max_minutes` 内、不与自己已有权限 SoD 冲突。生成 status=pending 记录。审计 `jit.request`。

#### Scenario: 正常申请
- **WHEN** 用户申请角色 X 30 分钟并附理由
- **THEN** 生成 pending 提权单，记录时长与理由

#### Scenario: 时长超限被拒
- **WHEN** 申请时长超过 jit_max_minutes
- **THEN** 400 拒绝

#### Scenario: SoD 冲突被拒
- **WHEN** 申请角色与自己现有角色互斥
- **THEN** 400 拒绝

### Requirement: 审批与生效
具备 `approval:manage` 者可查看提权单列表（`GET /admin/jit-grants`）并审批（`POST /admin/jit-grants/:id/approve`）或拒绝（`/reject`）。审批通过 → 授予 user_roles + status=active + expires_at；拒绝 → status=rejected。已处理单不可重复操作（400）。审计 `jit.approve` / `jit.reject`。

#### Scenario: 审批通过后限时生效
- **WHEN** 审批人通过提权单
- **THEN** 角色被授予，expires_at = now + duration，状态 active

#### Scenario: 重复操作 400
- **WHEN** 对已处理提权单再次审批
- **THEN** 返回 400

### Requirement: 到期自动回收
访问提权单列表（`GET /admin/jit-grants`）或用户查看自己提权（`GET /auth/jit-requests`）时，惰性检查 active 且已过 expires_at 的提权：回收 user_roles、置 expired、审计 `jit.expire`。

#### Scenario: 到期回收
- **WHEN** 超过 expires_at 后访问列表
- **THEN** 角色被回收，提权置 expired，审计 jit.expire

### Requirement: 主动撤销
具备 `approval:manage` 者可通过 `POST /admin/jit-grants/:id/revoke` 主动撤销 active 提权：回收角色、置 revoked、审计 `jit.revoke`。

#### Scenario: 主动撤销
- **WHEN** 审批人撤销某项 active 提权
- **THEN** 角色被回收，状态 revoked，审计 jit.revoke