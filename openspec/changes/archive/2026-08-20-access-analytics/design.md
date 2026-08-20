## Context

现有：roles/user_roles/role_permissions/group_roles/group_members（RBAC+组继承）、permissions 按名 seed、audit_logs 记录 auth.login 可推导最近登录、settings 机制（policyService.getSetting）、adminService.assignRole/checkSoD、admin 角色拥有全部权限、测试脚本辅助齐全。

## Goals / Non-Goals

**Goals:**
- 三项违规检测（僵尸持权/敏感权限持有/权限聚集）
- 权限共现的角色挖掘候选
- 候选一键落库（建角色+可选分配）
- 全审计 + 页签

**Non-Goals:**
- 机器学习/复杂统计（用简单阈值与共现计数）
- 自动执行回收（只建议，动作走现有审批/复审）
- 时序趋势图（本次只做快照分析）

## Decisions

### 决策1：最近登录来源
无 login_logs 表，以 `audit_logs` 中 `action='auth.login'` 的 max(created_at) 作为最近登录；从未登录者为 NULL → 视为僵尸候选（需同时持有角色）。

### 决策2：敏感权限集
permissions 表不加列，用设置 `analytics_sensitive_perms`（逗号分隔权限名）配置，默认核心管理权限列表；用户若经角色/组获得其中任一即命中 high_risk_perm。

### 决策3：有效权限计算
复用 adminService 已有逻辑（直接角色 + 组继承去重）。有效权限数 = 用户全部角色（含组）权限并集大小。

### 决策4：角色挖掘算法
对每个用户取其有效权限集；两两权限组合在所有用户中的共现计数；组合覆盖用户数 >= minSupport 且组合大小 >= 2 时作为候选。O(n_users × k²)（k=每用户权限数），数据量小可行。输出按 support 降序，最多 N（默认 20）条。

### 决策5：权限与审计
新权限 `analytics:view`（seed 给 admin）；端点记录 analytics.violations_view / rolemining_view / role_promote。

### 决策6：设置键
`analytics_inactive_days`（'90'）、`analytics_sensitive_perms`（逗号串）、`analytics_perm_threshold`（'15'）、`analytics_min_support`（'2'），均入 DEFAULT_SETTINGS + settings 种子。

## Risks / Trade-offs

- [僵尸判定] 依赖审计留存；若审计被清空，未登录用户会误判为僵尸——可接受（审计默认全量保留）。
- [共现挖掘] 候选包含受试者已存在角色的权限组合，可能重复建议既有角色——去重（跳过与已有角色权限集完全相同的候选）。
- [性能] 权限共现全对扫描，用户/权限规模大时 O(nk²) 成本上升；当前规模可控。

## Migration Plan

1. database.js：permissions seed 加 `analytics:view`；settings 种子加四键。
2. policy.service.js：DEFAULT_SETTINGS 加四键。
3. 新建 analytics.service.js。
4. admin.js 端点 + admin.html 页签。
5. 测试第 37 节 + 全量回归。

## Open Questions