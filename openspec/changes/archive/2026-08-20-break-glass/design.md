## Context

已有 TOTP 流程（totp.setup/enable/disable、totp.verifyCode）、roles/user_roles、adminService.assignRole/userEffectiveRoleIds、settings 机制、惰性回收模式（JIT/cert）、审计。admin 角色拥有全部权限。测试辅助齐全。

## Goals / Non-Goals

**Goals:**
- 强认证（TOTP step-up）+ 理由的限时应急提权
- 到期/手动/管理端强制结束，均回收角色
- 事后审查闭环
- 全程审计 + 页签

**Non-Goals:**
- 多重审批（免审批是特性）
- 应急期间的实时操作监控（只留痕，不做会话录制）
- 多级审查（单层 review 即可）

## Decisions

### 决策1：应急角色
设置 `breakglass_role_id` 指定；为空时启动时自动创建"break-glass"角色（含全部权限，复用全部权限列表 seed），授予/回收仅操作该角色。

### 决策2：强认证方式
复用用户已绑定的 TOTP secret：`POST /auth/breakglass/start` 提交动态码，`totp.verifyCode` 校验通过才授予。未绑 TOTP 直接拒绝（强认证前置条件）。

### 决策3：状态机
started → ended（自主/管理端/到期）→ reviewed（事后审查）。ended 才可 review；reviewed 不可重复。

### 决策4：到期回收
惰性：列表/我的记录接口先 expireOverdue：started 且 started_at + duration < now → 回收角色 + ended + 审计。

### 决策5：权限与审计
`breakglass:use`（申请/自结束）、`breakglass:manage`（查看/强制结束/审查）。审计 breakglass.start/end/review/denied。

### 决策6：结束校验
用户自结束仅限自己的 active 事件；管理端可结束任意 active。不可结束非 active。

## Risks / Trade-offs

- [强认证强度] 仅 TOTP（非硬件 key）；作为单因素 step-up 可接受。
- [惰性回收] 到期瞬间可能有秒级窗口；与 JIT 一致。
- [角色篡改] 应急角色由设置指定，若被改动需重新评估；默认含全部权限。

## Migration Plan

1. database.js：建表 breakglass_events + 权限 seed + 设置种子（breakglass_enabled/duration/role_id）。
2. policy.service.js：DEFAULT_SETTINGS 三键。
3. 新建 breakglass.service.js。
4. auth.js + admin.js 端点；admin.html 页签。
5. 测试第 38 节 + 全量回归。

## Open Questions