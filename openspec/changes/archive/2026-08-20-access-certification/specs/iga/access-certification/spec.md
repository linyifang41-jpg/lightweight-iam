# iga/access-certification Specification

## Purpose
访问认证（定期复审）：管理员创建复审活动，快照指定范围内全部用户-角色分配为待确认项；复审人逐项确认保留或撤销，撤销即时回收权限；到期未处理项按策略自动处置。

## ADDED Requirements

### Requirement: 创建复审活动
具备 `cert:manage` 权限者可创建复审活动（`POST /admin/certifications`）：提供 name、范围（departmentId 或 userIds）、截止日、auto_action（keep/revoke）。创建时快照范围内全部 user-role 分配为 pending 复审项。审计 `cert.create`。

#### Scenario: 按部门快照
- **WHEN** 管理员按部门创建活动
- **THEN** 该部门全部用户的角色分配生成为复审项，状态 pending

#### Scenario: 无权限 403
- **WHEN** 无 `cert:manage` 用户创建活动
- **THEN** 返回 403

### Requirement: 复审与处置
具备 `cert:review` 权限者可查看活动明细（`GET /admin/certifications/:id`）并对复审项做决策（`POST /admin/certifications/:id/items/:itemId/decision`，action=keep|revoke）。revoke 即时删除该用户角色并审计 `cert.review_revoke`。审计 `cert.review_keep`。

#### Scenario: 确认保留
- **WHEN** 复审人对某项执行 keep
- **THEN** 该项状态 kept，用户角色保留

#### Scenario: 撤销权限
- **WHEN** 复审人对某项执行 revoke
- **THEN** 该项状态 revoked，用户角色被立即回收，审计 `cert.review_revoke`

### Requirement: 关闭活动与到期自动处置
具备 `cert:manage` 权限者可关闭活动（`POST /admin/certifications/:id/close`）。未处理（pending）项按活动 auto_action 批量处置：revoke 则回收角色并审计 `cert.auto_revoke`。到期活动在列表/明细访问时惰性自动关闭。审计 `cert.close`。

#### Scenario: 关闭并处置未审项
- **WHEN** 管理员关闭活动
- **THEN** pending 项按 auto_action 处置（revoke 回收权限 / keep 保留），活动状态 closed

#### Scenario: 到期自动关闭
- **WHEN** 访问已过截止日的活动
- **THEN** 自动关闭并按 auto_action 处置 pending 项

### Requirement: 复审活动列表与统计
具备 `cert:review` 权限者可查看活动列表（`GET /admin/certifications`），含每项统计（总数/待审/保留/撤销）与状态。

#### Scenario: 列表含统计
- **WHEN** GET /admin/certifications
- **THEN** 返回活动列表 + pending/kept/revoked 计数 + status