## Why

说明书 8.3"Webhook/事件流 ⬜"：用户事件对外推送。IAM 产生的审计动作（用户增删、角色分配、访问审批、JIT、应急访问等）需要对外集成（通知、SIEM、自动化）。本批实现 **Webhook/事件流**：订阅审计事件（按动作/前缀或 *），事件发生时以 HMAC-SHA256 签名异步推送 JSON 到目标 URL，支持订阅管理、启用停用、测试与投递状态记录。纯内部实现，借助本地测试接收器端到端验证。

## What Changes

- 新表 `webhooks`（id/url/secret/events(逗号分隔或 *)/enabled(0|1)/created_by/created_at/last_sent_at/last_status/last_error）
- 权限：`webhook:manage`，seed 给 admin
- 新增 `src/services/webhook.service.js`：
  - `create/list/update/remove/`、`test`
  - `dispatch(action, payload)`：对匹配订阅异步推送（HMAC-SHA256 签名头 X-IAM-Signature、Content-Type application/json、10s 超时、不阻塞主流程），记录 last_sent_at/last_status
- 集成：`audit.service.log()` 成功后调用 `webhook.dispatch(action, ...)`（fire-and-forget），所有审计动作即事件
- 端点：`GET/POST /admin/webhooks`、`PUT/DELETE /admin/webhooks/:id`、`POST /admin/webhooks/:id/test`
- 审计：`webhook.create/update/delete/test`
- admin.html 新增"🔗 Webhook"页签
- `/tmp/iam_test.sh` 第 40 节（含本地测试接收器）

## Capabilities

### New Capabilities
- `integration/webhook-events`: Webhook 事件流推送

### Modified Capabilities

## Impact

- `src/services/webhook.service.js`（新）
- `src/services/audit.service.js`：log() 尾部挂 dispatch
- `src/models/database.js`：建表 + 权限 seed
- `src/routes/admin.js`：端点
- `public/admin.html`：Webhook 页签
- `/tmp/iam_test.sh`：第 40 节（预期 381 + 新增）