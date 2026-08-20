## 1. 数据与权限

- [x] 1.1 `src/models/database.js`：建表 privileged_accounts；权限 seed 加 pam:manage

## 2. 服务

- [x] 2.1 `src/services/privileged.service.js`：discover（自动发现幂等）/list/register/retire/review/linkVault

## 3. 路由与前端

- [x] 3.1 `src/routes/admin.js`：GET /admin/privileged-accounts、POST /admin/privileged-accounts、POST /admin/privileged-accounts/discover、POST /admin/privileged-accounts/:id/retire、POST /admin/privileged-accounts/:id/review、PUT /admin/privileged-accounts/:id/link-vault（pam:manage）
- [x] 3.2 admin.html"特权账号"页签：发现/登记/退管/审查/关联保险库

## 4. 测试与回归

- [x] 4.1 `/tmp/iam_test.sh` 第 39 节：自动发现（admin 敏感权限/service/shared）、幂等去重、手动登记、退管/重复退管 400、审查、关联保险库、统计、403、审计
- [x] 4.2 全量回归通过（预计 364 + 新增）