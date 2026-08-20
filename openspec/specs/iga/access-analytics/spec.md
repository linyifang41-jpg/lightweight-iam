# iga/access-analytics Specification

## Purpose
权限分析：基于现有授权数据做策略违规检测（过度授权/权限漂移）与角色挖掘（自动归纳角色模型），为访问复审与权限治理提供数据支撑。

## Requirements

### Requirement: 策略违规检测
具备 `analytics:view` 者可通过 `GET /admin/analytics/violations` 获取违规列表与统计。检测项：
- `zombie_access`：状态 active 且持有角色，但最近登录（以 audit_logs 中 auth.login 最新记录计）早于 `analytics_inactive_days`（默认 90）或从未登录 → 高风险，建议回收。
- `high_risk_perm`：持有 `analytics_sensitive_perms` 集合中任一权限的用户 → 高风险，建议复审。
- `privilege_concentration`：有效权限数超过 `analytics_perm_threshold`（默认 15）的用户 → 中风险，建议复查。
返回每条记录含 severity / user / roles / perms / suggestion；并返回 total 与各 severity 计数。审计 `analytics.violations_view`。

#### Scenario: 僵尸持权被检出
- **WHEN** 用户 A 有角色但从未登录
- **THEN** 返回含 zombie_access 记录，severity=high

#### Scenario: 敏感权限持有被检出
- **WHEN** 用户 B 持有 analytics_sensitive_perms 中权限
- **THEN** 返回含 high_risk_perm 记录

#### Scenario: 权限聚集被检出
- **WHEN** 用户 C 有效权限数超过阈值
- **THEN** 返回含 privilege_concentration 记录，severity=medium

### Requirement: 角色挖掘
具备 `analytics:view` 者可通过 `GET /admin/analytics/role-mining?minSupport=N` 获取候选角色。算法：统计"同一用户有效权限集中共同出现的权限组合"（对共现权限做聚合），满足覆盖用户数 >= minSupport（默认 `analytics_min_support`，取 2）的作为候选。每个候选含 permissions、coveredUsers、support；按 support 降序。审计 `analytics.rolemining_view`。

#### Scenario: 共现权限组合被建议
- **WHEN** 至少 minSupport 个用户都同时拥有权限 P1、P2
- **THEN** 返回候选 {P1,P2}，support=该用户数

### Requirement: 候选角色落库
具备 `analytics:view`（创建角色还需 `role:manage`，admin 均具备）者可通过 `POST /admin/analytics/role-mining/promote` 将候选角色创建为正式角色：请求体 {name, permissionIds, userIds?}，创建角色并可选为 userIds 分配。审计 `analytics.role_promote`。

#### Scenario: 落库并分配
- **WHEN** 提交 promote（name=P1P2, permissionIds=[P1,P2], userIds=[U1,U2]）
- **THEN** 新角色创建，U1/U2 获得该角色，返回角色 id

### Requirement: 无权限拦截
不具备 `analytics:view` 的用户访问分析端点返回 403。

#### Scenario: 403
- **WHEN** 普通用户请求 /admin/analytics/violations
- **THEN** 返回 403
