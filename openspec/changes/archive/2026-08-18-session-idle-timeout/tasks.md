## 1. 后端策略与数据库

- [x] 1.1 `src/services/policy.service.js`：在 DEFAULT_SETTINGS 增加 `session_idle_timeout_minutes: '15'`
- [x] 1.2 `src/models/database.js`：seedData 的 defaultSettings 增加 `session_idle_timeout_minutes: '15'`

## 2. 会话服务空闲超时

- [x] 2.1 `src/services/session.service.js`：新增 `enforceIdleTimeout(jti, minutes)`，按 jti 查会话，超过阈值则 `revokeById(..., 'system_idle_timeout')` 并返回 `{ timedOut, jtis }`；未超时返回 `{ timedOut: false, jtis: [] }`
- [x] 2.2 空闲超时判定：使用 SQLite `datetime('now', ?)` 与 `last_active_at` 比较，避免 JS 本地时区解析偏差

## 3. 鉴权中间件接入

- [x] 3.1 `src/middleware/auth.js`：鉴权成功后、`sessionService.touch()` 之前调用 `enforceIdleTimeout`；若 `timedOut`，`tokenService.revokeJtis(jtis)` 后返回 401 `{ error: '会话已超时，请重新登录' }`；否则正常 touch 并继续

## 4. 管理端配置

- [x] 4.1 `public/admin.html`：安全策略页新增"会话空闲超时（分钟）"输入框 `set_session_idle_timeout_minutes`（0=关闭）
- [x] 4.2 `public/admin.html`：settings keys 数组加入 `session_idle_timeout_minutes`
- [x] 4.3 确认 `src/routes/admin.js` 策略读写接口透传新字段（经 `getAllSettings`/`DEFAULT_SETTINGS` 自动透传）

## 5. 审计

- [x] 5.1 `session.idle_timeout` 事件在鉴权中间件侧通过 `auditService.log` 记录（含 userId/username/jti）

## 6. 测试与回归

- [x] 6.1 更新 `/tmp/iam_test.sh`：新增空闲超时用例——策略设 1 分钟，用 sqlite3 将 `last_active_at` 改旧后调 `/me` 断言提示"会话已超时"且审计含 `session.idle_timeout`；用例结束恢复策略为 0
- [x] 6.2 全量回归 43 用例全部通过
