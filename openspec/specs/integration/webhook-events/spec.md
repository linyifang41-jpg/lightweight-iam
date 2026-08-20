# integration/webhook-events Specification

## Purpose
Webhook 事件流：将 IAM 审计动作作为事件对外异步推送（HMAC-SHA256 签名），支持订阅管理、测试与投递状态。

## Requirements

### Requirement: 订阅管理
具备 `webhook:manage` 者可通过 `POST /admin/webhooks` 创建订阅（{url, secret, events}，events 为动作名/前缀逗号列表或 '*'），`GET /admin/webhooks` 列表，`PUT /admin/webhooks/:id` 更新（url/secret/events/enabled），`DELETE /admin/webhooks/:id` 删除。URL 须 http(s)。审计 `webhook.create/update/delete`。

#### Scenario: 创建订阅
- **WHEN** 创建 events=user.* 的订阅
- **THEN** 返回订阅记录，enabled=1

#### Scenario: 删除订阅
- **WHEN** 删除某订阅
- **THEN** 记录消失

### Requirement: 事件推送
任一审计动作写入后触发 dispatch：匹配订阅（events 含该动作、前缀匹配或 '*'）→ 异步 POST JSON（{event, userId, username, ip, detail, timestamp}）到 url，请求头 `X-IAM-Signature: sha256=<HMAC-SHA256(secret, body)>`、`Content-Type: application/json`、超时 10s。失败不影响主流程；投递后更新 last_sent_at/last_status/last_error。

#### Scenario: 匹配事件被推送
- **WHEN** 发生订阅内动作且产生审计日志
- **THEN** 接收端收到带正确签名的 JSON 事件

#### Scenario: 不匹配事件不推送
- **WHEN** 发生非订阅事件
- **THEN** 接收端未收到

#### Scenario: 停用订阅不推送
- **WHEN** enabled=0 的订阅命中事件
- **THEN** 不推送

### Requirement: 测试投递
`POST /admin/webhooks/:id/test` 向订阅发送事件 {event:'test'}。返回投递结果。审计 `webhook.test`。

#### Scenario: 测试成功
- **WHEN** 触发测试
- **THEN** 接收端收到 test 事件，返回成功

### Requirement: 无权限拦截
不具备 `webhook:manage` 的用户访问 webhook 端点返回 403。

#### Scenario: 403
- **WHEN** 普通用户请求 /admin/webhooks
- **THEN** 403
