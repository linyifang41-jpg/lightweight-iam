## Purpose
用户自助申请权限（角色）→ 审批人逐级审批 → 全部通过自动赋权；SoD 冲突自动拒绝。审批级数可配（`approval_levels`）。

## ADDED Requirements

### Requirement: 自助提交访问请求
登录用户提交角色申请，附原因。角色须存在且为当前未拥有（直接或组继承）。

#### Scenario: 提交成功
- **WHEN** 用户 POST /auth/access-requests 提交未拥有且存在的角色
- **THEN** 返回 201 + pending 请求，审计 `access.request_submit`

#### Scenario: 角色已拥有被拒
- **WHEN** 提交的角色当前已拥有（含组继承）
- **THEN** 返回 400 错误

#### Scenario: 角色不存在
- **WHEN** 提交不存在的角色 id
- **THEN** 返回 400 错误

### Requirement: 审批列表
具备 `approval:manage` 权限者可查看请求（可按状态过滤）；无权限 403。

#### Scenario: 审批人查看
- **WHEN** 有权限用户 GET /admin/access-requests
- **THEN** 返回请求列表（含申请者用户名、角色名、状态、审批进度）

### Requirement: 审批（逐级）
审批人 approve/reject。同一审批人不能重复审批；达到 `approval_levels` 级后自动赋权。

#### Scenario: 单级审批通过自动赋权
- **WHEN** approval_levels=1 且审批人 approve
- **THEN** 请求置 approved，角色自动分配，审计 `access.approve` + `access.request_granted`

#### Scenario: 审批通过后角色生效
- **WHEN** 已自动赋权
- **THEN** 申请者获得该角色权限（如 user:manage）

#### Scenario: SoD 冲突自动拒绝
- **WHEN** 所申请角色与申请者现有角色互斥
- **THEN** 请求置 rejected（备注含"职责分离"），不赋权

#### Scenario: 多级审批
- **WHEN** approval_levels=2 且仅 1 人审批
- **THEN** 请求保持 pending，approvals_count=1；第 2 个不同审批人审批后自动赋权

#### Scenario: 同一审批人重复审批被拒
- **WHEN** 同一审批人对同一请求再次 approve
- **THEN** 返回 400 错误

#### Scenario: 拒绝
- **WHEN** 审批人 reject 并附备注
- **THEN** 请求置 rejected，审计 `access.reject`

### Requirement: 用户自助查询
用户可查看自己的请求与状态。

#### Scenario: 查询个人请求
- **WHEN** GET /auth/access-requests
- **THEN** 返回该用户全部请求