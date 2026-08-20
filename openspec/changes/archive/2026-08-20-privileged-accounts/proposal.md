## Why

说明书 7.1"特权账号发现与登记 ⬜"：管理员/共享账号清点。管理好特权账号是 PAM 的起点：先清点"谁/哪些账号是特权账号"，再谈托管、轮换、监控。本批实现 **特权账号发现与登记**：自动发现（扫描持有敏感权限的用户 + 服务账号 + 标记为共享的账号）+ 手动登记（管理员/共享账号台账）+ 清单视图与统计；与凭据保险库联动（登记的共享账号可关联/查看保险库凭据）。纯内部实现。

## What Changes

- 新表 `privileged_accounts`（id/account_type('admin'|'service'|'shared')/ref_user_id/ref_sa_id/owner/risk_level(high|medium|low)/reason/status(active|retired)/source('auto'|'manual')/last_review_at/created_at/created_by/updated_at）
- 权限：`pam:manage`（登记/退管/关联），seed 给 admin
- 新增 `src/services/privileged.service.js`：
  - `discover()`：自动发现候选（持有敏感权限的用户 → admin 类型；service_accounts 活跃 → service；共享标记账号 → shared），并入台账（source=auto）
  - `list({ type, status, risk })`、`register({ type, userId?, saId?, owner, riskLevel, reason })`、`retire(id)`、`linkVault(id, credentialId)`、`markReviewed(id)`
  - 敏感权限集合复用 `analytics_sensitive_perms`
- 端点：`GET /admin/privileged-accounts`、`POST /admin/privileged-accounts/discover`、`POST /admin/privileged-accounts`（登记）、`POST /admin/privileged-accounts/:id/retire`、`POST /admin/privileged-accounts/:id/review`（标记已审查）、`PUT /admin/privileged-accounts/:id/link-vault`
- 审计：`pam.discover`、`pam.register`、`pam.retire`、`pam.review`、`pam.link_vault`
- admin.html 新增"🔐 特权账号"页签
- `/tmp/iam_test.sh` 新增第 39 节

## Capabilities

### New Capabilities
- `pam/privileged-accounts`: 特权账号发现与登记

### Modified Capabilities

## Impact

- `src/services/privileged.service.js`（新）
- `src/models/database.js`：建表 + 权限 seed
- `src/routes/admin.js`：端点
- `public/admin.html`：特权账号页签
- `/tmp/iam_test.sh`：第 39 节（预期 364 + 新增）