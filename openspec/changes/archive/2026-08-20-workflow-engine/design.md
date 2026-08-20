## Context

现有 access.service 的审批是"级数计数"：approveRequest 累计 approved_by 达 approval_levels 即赋权。本批实现通用引擎并把访问请求接入（可选开关）。admin 路由用 requirePermission + csrfProtection + auditService.log；测试脚本有 urlencoded api 与 TMPBODY 模式。

## Goals / Non-Goals

**Goals:**
- 工作流定义 CRUD（approval/condition/action 节点，节点属性 approver=角色或用户）
- 实例推进：approval 暂停等审批、condition 分支、action 回调
- 审批决策：通过推进 / 拒绝终止 + 业务回调
- 待办列表（管理员与 assignee）
- 访问请求可选接入引擎
- 全审计

**Non-Goals:**
- 并行会签/多实例节点（每人一任务的"all"语义）
- 定时/超时自动流转、通知集成
- 图形化设计器（JSON 编辑器）

## Decisions

### 决策1：节点模型
- `approval`：`{type:'approval', name, approver:{type:'role'|'user', id}, note}`；生成一个待办任务，assignee 为角色时该角色任一有权限者可决策（决策者需 approval:manage 或直接命中 assignee 用户）
- `condition`：`{type:'condition', name, field, op:'eq'|'in'|'gt'|'lt'|'true', value, trueNext, falseNext}`；field 从 instance.data 取值
- `action`：`{type:'action', name, action, params}`；执行回调 `onAction(action, params, data)`，返回值写回 data，然后推进
- 节点数组 `nodes[]`，默认按顺序执行；condition 用 trueNext/falseNext 指定目标节点索引

### 决策2：审批 assignee 匹配
- 任务 assignee_type='role' 时：决策人须具备该角色，或具 `approval:manage`；assignee_type='user' 时：仅该用户或 `approval:manage`
- 已处理任务重复决策 400；非 assignee 无权限 403

### 决策3：回调与兼容
- access.service 传入 onComplete（assign roles + 标记 approved）、onReject（标记 rejected）、onAction（grant/notify 等）
- 引擎不感知业务表；`entityId` 指向 access_requests.id
- 设置 `workflow_engine_enabled` 默认 '0'：关闭时 submitRequest/approve/reject 走旧逻辑

### 决策4：权限与审计
- `workflow:manage`：定义 CRUD；决策复用 `approval:manage`
- 审计动作：wf.create/activate/deactivate/delete/start/complete/terminate/decide_approve/decide_reject/action_*

## Risks / Trade-offs

- [配置复杂性] JSON 定义对非技术管理员不友好，本期提供 JSON 编辑器 + 示例模板，后续可图形化。
- [行为切换] 引擎开关影响请求审批路径，测试需覆盖开关两侧。
- [回调耦合] 业务回调通过参数注入避免循环依赖。

## Migration Plan

1. database.js：3 表 + 权限 workflow:manage + 设置 workflow_engine_enabled。
2. policy.service.js：DEFAULT_SETTINGS 加 workflow_engine_enabled。
3. 新建 workflow.service.js。
4. access.service.js 分支接入。
5. admin.js 端点 + admin.html 页签。
6. 测试第 35 节 + 全量回归。

## Open Questions