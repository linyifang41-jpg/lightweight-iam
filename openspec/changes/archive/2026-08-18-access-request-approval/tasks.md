## 1. 数据模型

- [x] 1.1 `src/models/database.js`：建表 `access_requests`
- [x] 1.2 权限种子新增 `approval:manage`；默认设置新增 `approval_levels: '1'`

## 2. 审批服务

- [x] 2.1 `src/services/access.service.js`：`submitRequest`（角色存在/未拥有校验）、`approveRequest`（去重+级数+SoD 预检+自动赋权）、`rejectRequest`、`listRequests`、`listUserRequests`

## 3. 路由

- [x] 3.1 `src/routes/auth.js`：`POST /auth/access-requests`、`GET /auth/access-requests`（登录）
- [x] 3.2 `src/routes/admin.js`：`GET /admin/access-requests`、`POST /admin/access-requests/:id/approve`、`POST /admin/access-requests/:id/reject`（requirePermission approval:manage + CSRF）

## 4. 前端

- [x] 4.1 admin.html"访问审批"页签：请求列表 + 通过/拒绝

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 30 节：提交→审批→自动赋权生效；SoD 冲突自动拒绝；无权限 403；已拥有角色 400；多级审批
- [x] 5.2 全量回归通过（预计 168 + 新增）