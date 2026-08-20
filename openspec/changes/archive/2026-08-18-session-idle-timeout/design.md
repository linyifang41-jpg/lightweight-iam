## Context

现有系统基于 JWT access(30m) + refresh(7d) 双令牌，会话表 `sessions` 已记录 `last_active_at`，`authMiddleware` 每次鉴权调用 `sessionService.touch(jti)` 刷新活跃时间。`settings` 表存放策略，`policy.service.js` 的 `DEFAULT_SETTINGS` 定义策略默认值，管理端安全策略页通过 `GET/PUT /api/policy/settings` 读写。无独立前端心跳，活跃判定复用鉴权请求本身。

## Goals / Non-Goals

**Goals:**
- 以最小的侵入实现基于 `last_active_at` 的空闲超时吊销
- 管理端可配置、前端 401 自动跳登录
- 审计留痕

**Non-Goals:**
- 不引入独立的心跳轮询接口（鉴权请求即心跳，避免多余请求）
- 不做绝对超时（absolute timeout），仅做空闲超时
- 不改变 token 自身有效期策略

## Decisions

### 决策1：判定时机放在 authMiddleware 鉴权成功之后、touch 之前
- 理由：鉴权是唯一统一入口（`/me`、管理端、会话接口都经它），在 touch 前检查 `last_active_at` 可区分"超时"与"本次活跃"。若先 touch 再检查，会把超时请求误判为活跃。
- 备选：独立 `GET /api/heartbeat` 轮询 —— 增加请求量与复杂度，不必要。

### 决策2：超时判定使用 SQL 时间比较，吊销记录来源 `system_idle_timeout`
- 在 `session.service.js` 新增 `enforceIdleTimeout(jti, minutes)`：按 jti 查询会话，若 `last_active_at < now - minutes` 则 `revokeById(..., 'system_idle_timeout')` 并返回被吊销的 jtis（供 token 黑名单），同时返回 `{ timedOut: true }` 供中间件响应 401。
- 复用现有 `revokeById`，保证状态/审计一致。
- 备选：仅 401 不吊销 —— 会导致 token 仍有效、反复触发，不安全，不采用。

### 决策3：策略默认 15 分钟，0=关闭
- 等保要求超时自动退出；默认 15 分钟为常见基线（对照 Windows/各 IdP 默认）。0 保留原行为兼容。

### 决策4：令牌级黑名单 + 会话级吊销双管齐下
- 空闲超时吊销后，把该会话持有的 jti/refresh_jti 加入 token 黑名单，并清空前端 cookie 由前端 401 处理完成。refresh 令牌同批失效，避免 refresh 续命绕过。

## Risks / Trade-offs

- [长时后台任务误判] 若某请求处理超过阈值才回到鉴权，理论上会误判超时 → 阈值为分钟级，处理耗时远小于阈值，风险可忽略；且 refresh 机制可自动恢复，仅提示重新登录。
- [依赖鉴权才刷新活跃] 页面开着但不发请求会被判超时 → 这正是"空闲超时"的本意，符合等保要求。
- [并发上限交互] 超时吊销会增加一次吊销，与 max_sessions 各自独立 → 不冲突，spec 已覆盖。

## Migration Plan

1. 数据库 `seedData` 增加 `session_idle_timeout_minutes: '15'` 默认值（INSERT OR IGNORE，不影响存量）
2. 后端三处策略相关文件同步新增字段
3. 前端安全策略页新增输入框并纳入读写 keys
4. 发布后旧会话自动按新策略判定，无需数据迁移

## Open Questions

无。
