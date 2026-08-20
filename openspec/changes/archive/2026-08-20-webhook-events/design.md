## Context

audit.service.js 的 `log()` 是所有审计动作的唯一入口（express 中间件/路由调用）。webhook 挂在 auditService.log 之后即可覆盖全部事件，无需改各路由。Node ≥18 内置 fetch。测试端可在本机起 HTTP 接收器。

## Goals / Non-Goals

**Goals:**
- 订阅管理（创建/更新/删除/启停）
- 事件异步推送（签名 + 超时 + 不阻塞）
- 测试投递 + 投递状态记录
- 页签 + 全审计

**Non-Goals:**
- 重试队列/死信（只记录 last_status；失败靠测试/监控）
- 事件补发/回放
- 加密存储 secret（明文入库，界面上可改）

## Decisions

### 决策1：事件源
统一挂 `auditService.log()` 尾部：`webhookService.dispatch(action, {userId, username, ip, detail, timestamp})`。无 await（fire-and-forget），内部 try/catch，绝不影响主流程。

### 决策2：匹配规则
订阅 events 为逗号分隔：`*` 全量；`user.*` 前缀匹配（split('.') 首段相等）；否则精确动作名匹配。

### 决策3：签名
`X-IAM-Signature: sha256=<hmac_sha256_hex(secret, rawBody)>`，Content-Type: application/json。接收端可校验防伪造。

### 决策4：投递
Node 内置 fetch，AbortSignal.timeout(10000)，仅 http/https。成功后更新 last_sent_at + last_status='ok'；失败更新 last_status='error' + last_error。dispatch 对每条匹配订阅独立推送，逐个 catch。

### 决策5：权限与审计
新权限 `webhook:manage`（admin seed）。webhook.create/update/delete/test。

## Risks / Trade-offs

- [同步性] 异步推送与审计日志可能存在毫秒级延迟；可接受。
- [secret 明文] 存储层不加密；secret 仅用于签名，不用于存储敏感数据。
- [抖动] 无重试机制；大事件洪峰下个别失败仅记录。后续可加队列。

## Migration Plan

1. database.js：建表 + 权限 seed。
2. 新建 webhook.service.js（dispatch 用 global fetch）。
3. audit.service.js：log() 尾部调用 dispatch（try/catch）。
4. admin.js 端点 + admin.html 页签。
5. 测试第 40 节（本地接收器）+ 全量回归。

## Open Questions