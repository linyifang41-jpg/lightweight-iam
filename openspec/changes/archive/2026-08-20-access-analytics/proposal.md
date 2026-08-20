## Why

说明书 6.4"策略违规检测 ⬜"（检测过度授权/权限漂移 privilege creep）与 6.3"角色挖掘 ⬜"（从现状自动归纳角色模型）。批量做完访问请求、复审、工作流、JIT 后，缺少对现有授权状况的分析视角。本批实现 **权限分析（Access Analytics）**：基于现有授权数据做策略违规检测（僵尸持权/高风险权限持有/权限聚集）与角色挖掘（共现权限组合建议新角色），为访问复审与日常治理提供数据支撑，纯内部实现、不依赖外部系统。

## What Changes

- 新增 `src/services/analytics.service.js`：
  - `detectViolations()`：检测项（zombie_access / high_risk_perm / privilege_concentration），返回带严重级与建议的记录
  - `roleMining({ minSupport })`：基于用户有效权限集做权限共现统计，输出候选角色（权限集合 + 覆盖用户 + 支持度）
  - `promoteRole({ name, permissions })`：将候选角色落库（复用 role 创建逻辑）
- 设置：`analytics_inactive_days`（僵尸判定天数，默认 90）、`analytics_sensitive_perms`（高风险权限名集合，逗号分隔）、`analytics_perm_threshold`（权限聚集阈值，默认 15）
- 权限：`analytics:view`（查看分析），seed 给 admin
- 端点：
  - `GET /admin/analytics/violations`（违规列表 + 统计）
  - `GET /admin/analytics/role-mining`（候选角色）
  - `POST /admin/analytics/role-mining/promote`（一键落库）
- 审计：`analytics.violations_view`、`analytics.rolemining_view`、`analytics.role_promote`
- admin.html 新增"📊 权限分析"页签
- `/tmp/iam_test.sh` 新增第 37 节

## Capabilities

### New Capabilities
- `iga/access-analytics`: 权限分析（策略违规检测 + 角色挖掘）

### Modified Capabilities

## Impact

- `src/services/analytics.service.js`（新）
- `src/services/policy.service.js`：DEFAULT_SETTINGS 三键
- `src/models/database.js`：seed 权限加 `analytics:view`
- `src/routes/admin.js`：分析端点
- `public/admin.html`：权限分析页签
- `/tmp/iam_test.sh`：第 37 节（预期 329 + 新增）