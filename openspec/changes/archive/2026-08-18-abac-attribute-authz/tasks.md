## 1. 数据模型

- [x] 1.1 `src/models/database.js`：建表 `user_attributes`（user_id, attr_key, attr_value）与 `abac_policies`（id/name/description/resource_type/effect/priority/enabled/conditions/created_at/updated_at）
- [x] 1.2 权限种子新增 `abac:manage` 并绑定 admin 角色

## 2. 决策服务

- [x] 2.1 `src/services/authz.service.js`：用户属性解析（内置字段 + user_attributes JOIN）、条件求值（eq/ne/in/contains/exists/gt/ge/lt/le）、`authorize`（deny 优先 + 优先级）、策略 CRUD、用户属性设置

## 3. 路由

- [x] 3.1 `src/routes/authz.js`：`POST /authz/check`（登录可调）
- [x] 3.2 `src/routes/admin.js`：`GET/POST /admin/abac/policies`、`PUT/DELETE /admin/abac/policies/:id`、`PUT /admin/users/:id/attributes`（requirePermission abac:manage + CSRF）
- [x] 3.3 挂载 authz 路由（index.js）

## 4. 前端

- [x] 4.1 admin.html"ABAC 策略"页签：策略列表/创建/编辑/删除、条件行编辑器

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 29 节：用户属性设置 → 策略创建/非法拒绝/无权限403 → allow 命中/deny 覆盖/未命中 default → 策略更新删除
- [x] 5.2 全量回归通过（预计 140 + 新增）