## 1. 数据模型与种子

- [x] 1.1 `src/models/database.js`：建表 `workflows`、`workflow_instances`、`workflow_tasks`；权限种子新增 `workflow:manage`；设置种子新增 `workflow_engine_enabled`

## 2. 工作流引擎

- [x] 2.1 `src/services/workflow.service.js`：createWorkflow/listWorkflows/setActive/deleteWorkflow/startInstance/advance/decide/listTasks（含 assignee 匹配、condition 求值、action 回调、状态机 running/completed/terminated）
- [x] 2.2 `src/services/policy.service.js`：DEFAULT_SETTINGS 加 `workflow_engine_enabled: '0'`

## 3. 接入访问请求

- [x] 3.1 `src/services/access.service.js`：submitRequest 开启时启动实例（onComplete 赋权/onReject 拒绝）；approveRequest/rejectRequest 委托引擎；关闭时旧逻辑

## 4. 路由与前端

- [x] 4.1 admin 路由：`GET/POST /admin/workflows`、`PUT/DELETE /admin/workflows/:id`、`GET /admin/workflow-tasks`、`POST /admin/workflow-tasks/:id/decision`
- [x] 4.2 admin.html"工作流"页签：定义管理（JSON）+ 启停 + 待办审批

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 35 节：创建两级审批工作流→开启引擎→请求走引擎（两级通过后赋权）→拒绝路径（权限不授予）→重复决策 400→关闭引擎走旧逻辑→403→审计
- [x] 5.2 全量回归通过（预计 284 + 新增）