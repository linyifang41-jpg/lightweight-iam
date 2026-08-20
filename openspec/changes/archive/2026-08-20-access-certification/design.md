## Context

现有基建：`user_roles`（user_id+role_id）、`users.department_id`、`departments` 表；`policyService` 设置机制（updateSettings 按 DEFAULT_SETTINGS 过滤，新增键必须入表）；admin 路由用 `requirePermission` + `csrfProtection` + `auditService.log`；测试脚本有 `uid/rid/did` 辅助与 urlencoded `api` 支持。访问请求审批流（access_requests）已实现"申请→审批→授权"，本批实现相反的"复审→确认/回收"闭环。

## Goals / Non-Goals

**Goals:**
- 复审活动（按部门/指定用户范围快照全部 user-role）
- 逐项 keep/revoke，revoke 即时回收权限
- 到期惰性自动关闭 + 未审项按策略处置
- 列表统计 + 全审计

**Non-Goals:**
- 多级复审工作流（主管→安全组审批链；后续工作流引擎承接）
- 复审提醒邮件/通知
- 与离职流程联动自动生成复审（后续）

## Decisions

### 决策1：数据模型
- `certifications(id, name, status('open'|'closed'), scope_type('dept'|'users'), scope_value(JSON), due_date, auto_action('keep'|'revoke'), created_by, created_at, closed_at)`
- `certification_items(id, certification_id, user_id, role_id, status('pending'|'kept'|'revoked'), reviewed_by, reviewed_at, note)`
- 创建时按范围查全部 active 用户的 user_roles 快照（不含 admin 保护项：admin 与内置角色不改）

### 决策2：复审动作
- `reviewItem`：keep → status=kept（不改权限）；revoke → DELETE user_roles + status=revoked + 审计
- 已处置项不可重复决策（400）；活动已关闭不可决策（400）
- 审计：`cert.review_keep` / `cert.review_revoke`（detail: campaignId/itemId/user/role）

### 决策3：关闭与到期
- `closeCampaign`：未处理 pending 项按 auto_action 处置（revoke→回收角色+`cert.auto_revoke`；keep→置 kept+`cert.auto_keep`），置 closed
- 惰性到期：listCampaigns/getCampaign 先 `autoCloseExpired()`（due_date 已过且 open → close）
- 关闭幂等：已 closed 再 close 返回 400

### 决策4：权限点
- `cert:manage`：创建/关闭/删除活动；`cert:review`：查看明细 + 决策。admin 自动绑定两者。端点按 action 用对应 requirePermission。

### 决策5：范围
- dept：department_id = 指定部门的所有 active 用户；users：显式 userIds 列表。快照仅取 active 用户。

## Risks / Trade-offs

- [快照非实时] 创建后新增的授权不在本活动内，符合复审快照语义。
- [admin 保护] 内置 admin 及其 admin 角色不进入复审项，避免误回收锁死系统。
- [auto revoke 默认] certification_due_action 默认 'revoke'（安全优先），可配为 keep。

## Migration Plan

1. database.js：建两表 + 权限 cert:manage/cert:review + 设置 certification_due_action。
2. policy.service.js：DEFAULT_SETTINGS 加 certification_due_action: 'revoke'。
3. 新建 `src/services/cert.service.js`。
4. admin.js 加复审端点；admin.html 页签。
5. 测试脚本新增第 34 节；全量回归。

## Open Questions