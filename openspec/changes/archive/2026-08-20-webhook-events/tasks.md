## 1. 数据与权限

- [x] 1.1 `src/models/database.js`：建表 webhooks；权限 seed 加 webhook:manage

## 2. 服务

- [x] 2.1 `src/services/webhook.service.js`：create/list/update/remove/test + dispatch（HMAC 签名 + fetch 异步推送 + 投递状态）
- [x] 2.2 `src/services/audit.service.js`：log() 尾部挂 dispatch（不阻塞）

## 3. 路由与前端

- [x] 3.1 `src/routes/admin.js`：GET/POST /admin/webhooks、PUT/DELETE /admin/webhooks/:id、POST /admin/webhooks/:id/test（webhook:manage）
- [x] 3.2 admin.html"Webhook"页签：订阅列表/新建/启停/测试/删除

## 4. 测试与回归

- [x] 4.1 `/tmp/iam_test.sh` 第 40 节：本地接收器；创建订阅→触发匹配事件收到且签名可验、不匹配事件不推送、停用不推送、test 投递、删除、403、审计
- [x] 4.2 全量回归通过（预计 381 + 新增）