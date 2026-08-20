## 1. 数据与设置

- [x] 1.1 `src/models/database.js`：建表 breakglass_events；权限 seed 加 breakglass:use/breakglass:manage；设置种子 breakglass_enabled/duration/role_id
- [x] 1.2 `src/services/policy.service.js`：DEFAULT_SETTINGS 加三键

## 2. 应急服务

- [x] 2.1 `src/services/breakglass.service.js`：start（TOTP step-up + 理由 + 限时授角色）/end/review/list/myEvents/expireOverdue（惰性回收）+ 自动建应急角色

## 3. 路由与前端

- [x] 3.1 `src/routes/auth.js`：POST /auth/breakglass/start、GET /auth/breakglass、POST /auth/breakglass/end
- [x] 3.2 `src/routes/admin.js`：GET /admin/breakglass、POST /admin/breakglass/:id/review、POST /admin/breakglass/:id/end
- [x] 3.3 admin.html"应急访问"页签

## 4. 测试与回归

- [x] 4.1 `/tmp/iam_test.sh` 第 38 节：正确码开启/错误码拒绝/未绑 TOTP 拒绝/重复开启 400/自主结束/管理端结束/到期回收/审查/重复审查 400/403/审计
- [x] 4.2 全量回归通过（预计 343 + 新增）