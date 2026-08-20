## 1. 数据模型与种子

- [x] 1.1 `src/models/database.js`：建表 `temporary_grants`；设置种子新增 `jit_max_minutes`、`jit_enabled`

## 2. 提权服务

- [x] 2.1 `src/services/jit.service.js`：requestGrant（时长上限/SoD 预检）/listGrants/myGrants/approveGrant/rejectGrant/revokeGrant/expireOverdue（惰性回收）
- [x] 2.2 `src/services/policy.service.js`：DEFAULT_SETTINGS 加 `jit_max_minutes: '480'`、`jit_enabled: '1'`

## 3. 路由

- [x] 3.1 `src/routes/auth.js`：`POST /auth/jit-requests`（自助申请）、`GET /auth/jit-requests`（我的提权）
- [x] 3.2 `src/routes/admin.js`：`GET /admin/jit-grants`、`POST /admin/jit-grants/:id/approve|reject|revoke`

## 4. 前端

- [x] 4.1 admin.html"即时访问（JIT）"页签：列表/审批/撤销/到期回收

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 36 节：申请→审批→限时生效→到期自动回收→撤销→超时长 400→SoD 400→重复操作 400→jit_enabled=0 时 403→审计
- [x] 5.2 全量回归通过（预计 307 + 新增）