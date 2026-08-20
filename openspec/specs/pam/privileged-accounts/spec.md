# pam/privileged-accounts Specification

## Purpose
特权账号发现与登记：自动清点特权账号（管理员/服务/共享）并形成登记台账，支持退管、风险分级、审查标记与凭据保险库关联。

## Requirements

### Requirement: 自动发现
具备 `pam:manage` 者可通过 `POST /admin/privileged-accounts/discover` 触发自动发现并入台账（source=auto，重复自动去重）：
- 持有 `analytics_sensitive_perms` 集合中任一权限的用户 → type=admin
- 状态 active 的 service_accounts → type=service
- 用户属性/标记为"共享账号"的用户（user_attributes 中 shared=1）→ type=shared
返回新增数与清单。审计 `pam.discover`。

#### Scenario: 发现管理员与服务账号
- **WHEN** 存在持有敏感权限的用户与活跃服务账号
- **THEN** 台账中新增对应 admin/service 记录，source=auto

#### Scenario: 重复发现去重
- **WHEN** 再次 discover
- **THEN** 不产生重复记录（按 ref 去重）

### Requirement: 手动登记
具备 `pam:manage` 者可通过 `POST /admin/privileged-accounts` 手动登记特权账号（type/owner/riskLevel/reason；admin 可关联 userId，service 可关联 saId，shared 可关联 userId 或仅登记名称）。审计 `pam.register`。

#### Scenario: 登记共享账号
- **WHEN** 登记 type=shared 账号并附负责人与风险级
- **THEN** 台账新增记录

### Requirement: 清单与统计
`GET /admin/privileged-accounts` 返回台账（支持 type/status/risk 过滤）与统计（total / byType / byRisk / 待审查数 / 未关联保险库数）。审计 `pam.view`。

#### Scenario: 列表含统计
- **WHEN** 查询台账
- **THEN** 返回记录数组与统计对象

### Requirement: 退管与审查
`POST /admin/privileged-accounts/:id/retire` 将账号退管（status=retired，需提供 reason）；`POST /admin/privileged-accounts/:id/review` 标记 last_review_at 为当前。已退管不可重复退管（400）。审计 `pam.retire` / `pam.review`。

#### Scenario: 退管
- **WHEN** 退管某特权账号
- **THEN** status=retired

#### Scenario: 重复退管 400
- **WHEN** 再次退管已退管账号
- **THEN** 400

### Requirement: 关联保险库
`PUT /admin/privileged-accounts/:id/link-vault` 将登记记录与凭据保险库凭据关联（存 credential_id）。审计 `pam.link_vault`。

#### Scenario: 关联凭据
- **WHEN** 为记录关联 credentialId
- **THEN** 记录保存该关联

### Requirement: 无权限拦截
不具备 `pam:manage` 的用户访问特权账号端点返回 403。

#### Scenario: 403
- **WHEN** 普通用户请求 /admin/privileged-accounts
- **THEN** 403
