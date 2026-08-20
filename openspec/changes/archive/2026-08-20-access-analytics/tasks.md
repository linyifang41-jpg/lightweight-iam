## 1. 数据与设置

- [x] 1.1 `src/models/database.js`：permissions seed 加 `analytics:view`；settings 种子加 analytics_inactive_days/analytics_sensitive_perms/analytics_perm_threshold/analytics_min_support
- [x] 1.2 `src/services/policy.service.js`：DEFAULT_SETTINGS 加四键

## 2. 分析服务

- [x] 2.1 `src/services/analytics.service.js`：detectViolations（zombie_access/high_risk_perm/privilege_concentration）+ roleMining（权限共现候选，去重已存在角色）+ promoteRole（建角色可选分配）

## 3. 路由与前端

- [x] 3.1 `src/routes/admin.js`：GET /admin/analytics/violations、GET /admin/analytics/role-mining、POST /admin/analytics/role-mining/promote（analytics:view）
- [x] 3.2 admin.html"权限分析"页签：违规列表 + 角色挖掘候选 + 一键落库

## 4. 测试与回归

- [x] 4.1 `/tmp/iam_test.sh` 第 37 节：僵尸持权/敏感权限/权限聚集检出、minSupport 过滤、候选去重、promote 落库、403、审计
- [x] 4.2 全量回归通过（预计 329 + 新增）