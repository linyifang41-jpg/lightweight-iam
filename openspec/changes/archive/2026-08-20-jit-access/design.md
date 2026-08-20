## Context

已有 adminService.assignRole（校验角色存在，写 user_roles）、checkSoD、policyService 设置、惰性检查模式（cert.service autoCloseExpired）、auditService。auth.js 有用户自助端点（csrfProtection）。测试脚本 jget2/check/contains 辅助齐全。

## Goals / Non-Goals

**Goals:**
- 用户自助申请临时角色（限时 + 理由 + SoD 预检 + 时长上限）
- 管理审批通过/拒绝/撤销
- 到期惰性自动回收
- 全程审计

**Non-Goals:**
- 到期前提醒通知
- 定时任务（惰性即可）
- 提权叠加（同一角色重复 active 提权去重）

## Decisions

### 决策1：数据模型
`temporary_grants(id, user_id, role_id, reason, duration_minutes, status('pending'|'active'|'rejected'|'expired'|'revoked'), requested_by, granted_by, granted_at, expires_at, decided_at, created_at)`

### 决策2：审批流转
- pending → approve：INSERT user_roles（幂等）→ active + expires_at=now+duration
- pending → reject：rejected
- active → revoke：DELETE user_roles → revoked
- active 已过期 → 惰性 expire：DELETE user_roles → expired
- 非 pending/active 状态重复操作 → 400

### 决策3：惰性到期
`listGrants` 与用户 `myGrants` 先调用 `expireOverdue()`：SELECT active AND expires_at <= now → 逐条回收+审计。权限不依赖到期时间（user_roles 无过期列，靠 grant 记录驱动回收）。

### 决策4：权限与设置
- 申请：authMiddleware（登录用户），校验 role 存在、duration ∈ [1, jit_max_minutes]、与现有有效角色 SoD 冲突即拒
- 审批/撤销：`approval:manage`（复用现有）
- `jit_enabled='1'` 关闭时申请返回 403

### 决策5：审计动作
jit.request / jit.approve / jit.reject / jit.revoke / jit.expire，detail 含 grantId/user/role/duration。

## Risks / Trade-offs

- [惰性 vs 实时] 到期后需访问接口才回收；提权授予期间权限实时有效，到期瞬间可能仍有秒级窗口，符合 JIT 常见实现。
- [撤销仅 active] revoke 仅对 active；已 expired 的自然由惰性处理。
- [重复申请] 同一用户同一角色可多次申请；审批时 assignRole 幂等。

## Migration Plan

1. database.js：建表 + 设置种子 jit_max_minutes=480、jit_enabled='1'。
2. policy.service.js：DEFAULT_SETTINGS 加两键。
3. 新建 jit.service.js。
4. auth.js + admin.js 端点；admin.html 页签。
5. 测试第 36 节 + 全量回归。

## Open Questions