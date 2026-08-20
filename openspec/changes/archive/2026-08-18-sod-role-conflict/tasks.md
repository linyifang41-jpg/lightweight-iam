## 1. 数据层

- [x] 1.1 `database.js`：建 `sod_rules` 表（id/type/left_id/right_id/description，唯一索引 type+left+right）

## 2. 检测核心与服务

- [x] 2.1 `admin.service.js`：`checkSoD(type, ids)` 遍历互斥对抛错；`addSodRule`/`listSodRules`/`deleteSodRule`（id 归一化 + 去重 + 类型/存在性校验）
- [x] 2.2 `assignRole`：加入后检测用户有效角色（直接+继承），冲突抛错
- [x] 2.3 `setGroupRoles`：组集合检测 + 逐成员有效角色检测
- [x] 2.4 `createRole` / `updateRolePermissions`：权限集合互斥检测

## 3. 路由

- [x] 3.1 `admin.js`：GET/POST/DELETE `/admin/sod-rules`（role:manage + csrf），审计 `sod.rule_create`/`sod.rule_delete`/`user.assign_role_conflict`/`group.set_roles_conflict`/`role.permission_conflict`

## 4. 前端

- [x] 4.1 `admin.html`：角色页签加"互斥规则"（列出现有规则、添加角色互斥对、删除）

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 26 节：建两角色→配互斥→assignRole 冲突被拒→移除后成功→组角色冲突被拒→角色权限互斥被拒→正常分配成功
- [x] 5.2 全量回归通过（预计 90 + 新增）