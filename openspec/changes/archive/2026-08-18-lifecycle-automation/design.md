## Context

基建齐全：`userService.createUser`（含密码策略校验、强制改密）、`adminService.assignRole/removeRole/addGroupMember/setGroupRoles/setUserStatus/setUserDepartment`、`sessionService.revokeAllForUser`、`tokenService.revokeAllForUser`、`auditService.log`。路由模板 `requirePermission('user:manage')` + `csrfProtection`。

## Goals / Non-Goals

**Goals:**
- join/move/leave 三类事件驱动操作
- 权限回收（leave 移除角色 + 吊销会话/token）
- 管理端 UI + 审计

**Non-Goals:**
- 与外部 HR 系统对接（SCIM/HR 源为后续批次）
- 定时批量同步（保留 CSV 导入作为批量通道）
- 审批流/通知

## Decisions

### 决策1：leave 默认全量回收
离职默认：移除直接角色、移出所有组、吊销全部会话与 token、状态置 disabled/archived。保证"离人即离权"。

### 决策2：move 用增删集合而非全量替换
move 明确 add/remove 列表，避免误覆盖组角色；departmentId 缺省时不修改部门（区别于置空需显式传 `departmentId: ''`）。

### 决策3：join 密码缺省时自动生成
`password` 缺省由 `policyService.generatePassword()` 生成（若存在），并置 must_change_password=1，保证合规。若策略无生成函数，则必填 password。

### 决策4：复用现有服务方法
lifecycle.service.js 组合调用 userService/adminService，不重复造轮子；每次操作单事务。

### 决策5：审计 action 命名
`lifecycle.join` / `lifecycle.move` / `lifecycle.leave`，detail 含目标用户与关键变更。

## Risks / Trade-offs

- [revokeAllForUser] leave 吊销会话会使被离职用户立即掉线——正是期望行为。
- [move 角色冲突] 增删角色走 adminService.assignRole/removeRole，SoD 冲突仍会被拦截（保留既有防护）。

## Migration Plan

1. 新建 `lifecycle.service.js`。
2. `admin.js` 加 3 个端点（user:manage + csrf）。
3. `admin.html` 生命周期页签。
4. 测试脚本新增第 27 节；全量回归。

## Open Questions

无。