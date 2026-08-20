## Context

已有 permissions（含敏感集合 analytics_sensitive_perms 设置）、service_accounts、user_attributes（可存 shared 标记）、credentials（凭据保险库，credential:manage）、adminService.userEffectiveRoleIds、审计、admin 全权限。测试辅助齐全。

## Goals / Non-Goals

**Goals:**
- 自动发现特权账号（管理员/服务/共享）并入台账（幂等去重）
- 手动登记 + 风险分级 + 退管 + 审查标记
- 与凭据保险库关联
- 统计视图 + 页签 + 全审计

**Non-Goals:**
- 自动回收/禁用特权账号（只登记台账）
- 与外部系统同步
- 轮换触发

## Decisions

### 决策1：数据模型
`privileged_accounts(id, account_type('admin'|'service'|'shared'), ref_user_id, ref_sa_id, display_name, owner, risk_level, reason, status('active'|'retired'), source('auto'|'manual'), last_review_at, created_by, created_at, updated_at)`。admin 类型用 ref_user_id，service 用 ref_sa_id，shared 可 ref_user_id 或仅 display_name。

### 决策2：自动发现
- admin：用户状态 active 且有效权限（直接+组）交集 analytics_sensitive_perms 非空
- service：service_accounts.status='active'
- shared：user_attributes 中存在 user_id 且 attribute 名约定 `shared` 值 '1' 的用户
去重：同 type+ref 已存在 active 记录则跳过。

### 决策3：风险分级
默认 admin=high、service=medium、shared=medium；登记可覆盖。

### 决策4：关联保险库
`link_vault(id, credentialId)`：校验凭据存在，存 credential_id 列，返回更新记录。

### 决策5：权限与审计
新权限 `pam:manage`（seed 给 admin）。审计 pam.view/discover/register/retire/review/link_vault。

## Risks / Trade-offs

- [误发现] 持有任一敏感权限即视为特权用户，可能过宽；以登记台账人工可纠偏（risk/reason 可改，退管可移除）。
- [共享标记] 依赖 user_attributes 约定键 shared；无统一标记时自动发现 shared 为空，靠手动登记补充。
- [去重边界] 已退管记录不参与去重，允许重新登记。

## Migration Plan

1. database.js：建表 + 权限 pam:manage seed。
2. 新建 privileged.service.js。
3. admin.js 端点 + admin.html 页签。
4. 测试第 39 节 + 全量回归。

## Open Questions