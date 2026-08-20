## Context

角色/权限模型：`roles`、`permissions`、`user_roles`（用户直接角色）、`role_permissions`、`groups`、`group_roles`、`group_members`。分配点集中在 `admin.service.js`（assignRole/setGroupRoles/createRole/updateRolePermissions），路由在 `admin.js`（requirePermission('role:manage')）。审计走 `auditService.log`。

## Goals / Non-Goals

**Goals:**
- 互斥角色对、互斥权限对的配置与检测
- 三个分配点（assignRole/setGroupRoles/权限集合）拦截冲突
- 管理端 UI + 审计

**Non-Goals:**
- 互斥"权限点级"全局策略（如某权限全局禁用）
- 变更前预演/审批流
- 与其他授权维度（ABAC/MAC）联动

## Decisions

### 决策1：规则表结构
`sod_rules(id TEXT PK, type TEXT CHECK(role|permission), left_id, right_id, description)`。规则以 (type,left,right) 唯一索引；插入时归一化（按 id 排序）保证 (A,B)=(B,A) 同一条。

### 决策2：有效角色集合 = 直接 + 组继承
用户有效角色 = `user_roles` ∪ 所属各组的 `group_roles`。assignRole 检测用加入后集合；setGroupRoles 先测组集合、再逐成员测有效集合。

### 决策3：检测失败抛错，路由返回 400
`checkSoD(type, ids)` 遍历互斥对，命中抛 `Error('职责分离冲突：<名称A> 与 <名称B> 互斥')`。现有路由 catch 已统一 400。

### 决策4：addGroupMember 不逐成员重算
组角色在 setGroupRoles 已验；成员加入组仅继承组角色，组角色本身无冲突，故 addGroupMember 不重复检测（文档注明）。

### 决策5：UI 入口
admin.html 角色管理页签增加"互斥规则"配置（新增/删除角色互斥对，含搜索选择）。保持简单。

## Risks / Trade-offs

- [逐成员检测] 组员多时 setGroupRoles 检测为 O(成员×规则)，demo 规模可接受。
- [历史数据] 旧数据可能已存在冲突组合，规则新增时仅对后续分配生效，不回溯清理（文档注明）。

## Migration Plan

1. database.js：`sod_rules` 表 + 唯一索引。
2. admin.service.js：checkSoD 核心 + 3 处调用点。
3. admin.js：3 个 sod-rules 端点。
4. admin.html：互斥配置 UI。
5. 测试脚本新增第 26 节；全量回归。

## Open Questions

无。