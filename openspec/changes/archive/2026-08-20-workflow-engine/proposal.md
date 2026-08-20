## Why

现有访问请求审批为"级数计数"（approval_levels，同一请求累计 N 人通过即放行），无法表达"先部门主管→再安全管理员"这类顺序多级审批、条件分支与自动化动作。说明书 6.6"工作流引擎（多级审批）⬜"。本批实现**通用工作流引擎**：可配置审批链（approval 节点按角色/用户指定审批人）、条件节点、动作节点（授权/回收回调），并将访问请求审批接入；默认关闭，开启后新请求走引擎，旧逻辑保留兼容。

## What Changes

- 新表 `workflows`（定义：type/definition JSON/active）、`workflow_instances`（实例：当前节点/状态/上下文 data）、`workflow_tasks`（待办：assignee/状态/决策人）
- 新权限点 `workflow:manage`；admin 自动绑定
- 设置 `workflow_engine_enabled`（'0'/'1'，默认 '0'）
- 新增 `src/services/workflow.service.js`：
  - `createWorkflow` / `listWorkflows` / `setActive` / `deleteWorkflow`
  - `startInstance`（按 type 找 active 工作流，无则回退单级默认）
  - `advance`（顺序执行：approval→生成待办并停；condition→按 data 选择走向；action→执行回调并继续）
  - `decide`（审批通过→advance；拒绝→terminate 并回调业务回滚）
  - `listTasks`（待办列表）
- 接入 `access.service.js`：开启后 `submitRequest` 启动工作流实例（回调 onComplete 赋权 / onReject 标记拒绝）；`approveRequest`/`rejectRequest` 委托引擎
- 端点（`workflow:manage` + CSRF）：`GET/POST /admin/workflows`、`PUT/DELETE /admin/workflows/:id`、`GET /admin/workflow-tasks`、`POST /admin/workflow-tasks/:id/decision`
- 审计：`wf.create`、`wf.activate/deactivate/delete`、`wf.start`、`wf.decide_approve/reject`、`wf.complete`、`wf.terminate`、`wf.action_grant`
- admin.html 新增"工作流"页签（定义管理 + 待办审批）
- `/tmp/iam_test.sh` 新增第 35 节

## Capabilities

### New Capabilities
- `workflow/engine`: 通用工作流引擎（多级审批编排 + 条件 + 动作回调）

### Modified Capabilities
- `iga/access-request`: 访问请求审批接入可选工作流引擎

## Impact

- `src/models/database.js`：建 3 表 + 权限 + 设置
- `src/services/policy.service.js`：DEFAULT_SETTINGS 加 workflow_engine_enabled
- 新文件 `src/services/workflow.service.js`
- `src/services/access.service.js`：分支接入引擎
- `src/routes/admin.js`：工作流端点
- `public/admin.html`：工作流页签
- `/tmp/iam_test.sh` 新增用例（预期 284 + 新增）