# workflow/engine Specification

## Purpose
通用工作流引擎：按可配置定义（approval / condition / action 节点）驱动业务对象流转。审批节点生成待办并按指定审批人（角色或用户）决策；条件节点按上下文数据选择分支；动作节点执行业务回调。访问请求审批可选接入，旧逻辑保留兼容。

## Requirements

### Requirement: 工作流定义管理
具备 `workflow:manage` 权限者可创建/查看/启停/删除工作流定义（`POST/GET /admin/workflows`、`PUT/DELETE /admin/workflows/:id`）。定义含 type（如 access_request）、name、节点列表（approval/condition/action）。审计 `wf.create` / `wf.activate` / `wf.deactivate` / `wf.delete`。

#### Scenario: 创建多级审批工作流
- **WHEN** 管理员创建 access_request 工作流：两级 approval（先用户角色组、后 admin）
- **THEN** 定义保存并生效（active），后续请求按此流转

#### Scenario: 无权限 403
- **WHEN** 无 `workflow:manage` 用户访问
- **THEN** 返回 403

### Requirement: 启动与流转
业务发起时调用 `startInstance(type, entityId, data, onComplete, onReject)`：找到该 type 的 active 工作流，无则回退单级默认（保持旧行为）。按节点顺序推进：approval → 生成待办并暂停；condition → 按 data 求值选分支；action → 执行回调继续。到达末端即 complete 并触发 onComplete。审计 `wf.start` / `wf.complete` / `wf.action_*`。

#### Scenario: 两级审批通过后授权
- **WHEN** 一级审批人通过、二级审批人通过
- **THEN** 实例 complete，onComplete 执行（角色授予）

### Requirement: 审批决策
具备 `approval:manage` 权限或为待办 assignee 的用户可查看待办（`GET /admin/workflow-tasks`）并决策（`POST /admin/workflow-tasks/:id/decision`，approved/rejected）。通过 → 推进；拒绝 → 实例 terminate 并触发 onReject（业务回滚/标记拒绝）。已处理任务不可重复决策（400）。审计 `wf.decide_approve` / `wf.decide_reject` / `wf.terminate`。

#### Scenario: 任一审批人拒绝即终止
- **WHEN** 某级审批人拒绝
- **THEN** 实例终止，onReject 执行（请求标记拒绝，不授权）

#### Scenario: 重复决策 400
- **WHEN** 对已处理任务再次决策
- **THEN** 返回 400

### Requirement: 访问请求接入
开启设置 `workflow_engine_enabled='1'` 后，新提交的访问请求（`access.service.submitRequest`）自动启动 access_request 工作流实例（data 含 user/roles/reason）；`approveRequest`/`rejectRequest` 委托引擎。关闭时行为与旧版一致（approval_levels）。

#### Scenario: 开启后走引擎
- **WHEN** 开启引擎并提交请求
- **THEN** 生成工作流实例与首批待办，请求状态 pending

#### Scenario: 关闭时旧逻辑
- **WHEN** 引擎关闭
- **THEN** 请求按 approval_levels 计数审批（原行为）
