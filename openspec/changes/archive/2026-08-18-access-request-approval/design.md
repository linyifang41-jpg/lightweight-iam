## Context

现有基建：`adminService.assignRole`（含 SoD 检查 `checkSoD`）、`userService._roleIdsQuery`（直接+组继承有效角色）、`policyService`（settings）、`auditService.log`。审批人判定复用现有 `requirePermission('approval:manage')` 中间件。

## Goals / Non-Goals

**Goals:**
- 自助申请→逐级审批→自动赋权的完整闭环
- 审批级数可配置（默认 1）
- SoD 预检，冲突自动拒绝
- 审计留痕

**Non-Goals:**
- 工作流引擎（多分支/会签/转办/升级）——仅线性逐级审批
- 申请人为他人代申请（仅本人申请）
- 权限到期/定期复审（后续"访问认证 Access Certification"再做）

## Decisions

### 决策1：数据模型
`access_requests` 表：
- `id`、`user_id`、`role_ids`（JSON 数组）、`reason`、`status`（pending/approved/rejected）
- `approval_levels`（请求快照，避免改策略影响进行中请求）、`approvals_count`、`approved_by`（JSON 审批人 id 数组）
- `note`、`created_at`、`decided_at`、`decided_by`

### 决策2：多级审批语义
审批级数来自 settings `approval_levels`（默认 1）。每次 approve 记录审批人 id，去重（同人二次审批报错）。`approvals_count` 达到 `approval_levels` 时自动赋权。拒绝任意时刻立即终结。

### 决策3：自动赋权与 SoD
赋权前对「当前有效角色 + 申请角色」合并集合做 `adminService.checkSoD('role', ids)` 预检，冲突则请求置 rejected（备注"自动拒绝：职责分离冲突…"）。通过则逐个 `assignRole`，状态置 approved。申请者已禁用/归档则拒绝。

### 决策4：权限点与 UI
新增 `approval:manage` 种子权限（admin 自动绑定）。审批端点 requirePermission('approval:manage') + CSRF。admin.html 新增"访问审批"页签；用户侧仅提供 API（自助申请）。

## Risks / Trade-offs

- [线性审批] 非完整工作流引擎，多级仅支持串行逐级，不满足复杂会签场景。
- [审批人权限] 任何持 `approval:manage` 的人可审批全部请求，未做基于资源所有者的定向派单。
- [即时赋权] 通过后立即生效（与会话内权限即时生效一致）；未做定时生效。

## Migration Plan

1. database.js：建表 `access_requests`；种子权限加 `approval:manage`；默认设置加 `approval_levels: '1'`。
2. 新建 `src/services/access.service.js`。
3. `src/routes/auth.js` 加自助端点；`src/routes/admin.js` 加审批端点。
4. admin.html 加"访问审批"页签。
5. 测试脚本新增第 30 节；全量回归。

## Open Questions