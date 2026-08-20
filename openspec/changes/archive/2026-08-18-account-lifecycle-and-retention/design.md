## Context

`users` 表已有 `status`（active/disabled/archived）、`password_changed_at`、`locked_until` 等字段；登录路由在 `src/routes/auth.js`（有 `auth.login_locked`/`auth.login_disabled` 等审计）；`policy.service.js` 用 `DEFAULT_SETTINGS` + settings 表管理安全策略；`audit.service.js` 用 `log()` 写 `audit_logs` 表（created_at 为 UTC，参照会话超时经验，时间比较用 SQLite datetime）。管理端 `admin.html` 有用户列表与安全策略面板。

## Goals / Non-Goals

**Goals:**
- 账户有效期设置/清除、过期登录拦截、惰性自动禁用
- 审计日志留存周期配置与惰性清理

**Non-Goals:**
- 到期前提醒（邮件/站内通知）
- 生命周期自动化（入职/转岗/离职）
- 细粒度日志分类保留

## Decisions

### 决策1：过期判定统一用 UTC，避免时区偏差
参照会话空闲超时经验：`account_expires_at` 存 ISO 字符串；过期判定用 SQLite `datetime('now') > datetime(account_expires_at)`，避免 JS `new Date()` 与 SQLite UTC 的 8 小时偏差。登录拦截在密码校验**之前**（与锁定/禁用同层，先过期再鉴权，减少无谓校验）。

### 决策2：惰性清理而非后台定时器
- 触发点：每次登录成功/失败触达 + 服务启动时执行一次 `autoDisableExpired()`。
- 优点：单实例无定时器竞态、零常驻开销；演示环境可测。
- 生产可后续加定时任务，逻辑复用。

### 决策3：清理动作留痕但防风暴
`autoDisableExpired()` 只处理 `status='active'` 且已过期用户；每个禁用写一条 `user.auto_disable_expired` 审计。登录拦截过期（未及禁用）时写 `auth.login_expired` 并返回 423。自动禁用与登录拦截并存，两层保障。

### 决策4：审计清理采用惰性+批次上限
- `audit_retention_days` 默认 `365`；`0` 永久保留。
- 触发：`auditService.log()` 写入后，若配置非 0 且上次清理间隔超过阈值（简化：每次写后概率性/计数触发，演示用每次写后触发但带上限）。
- 清理 SQL：`DELETE FROM audit_logs WHERE created_at < datetime('now', ?) LIMIT 5000`（SQLite DELETE 支持 LIMIT），避免大表全删阻塞。
- 用 settings 记录 `last_audit_cleanup_at` 防止每次写日志都执行清理（至少间隔 1 小时）。

### 决策5：管理端交互
- 用户列表新增"有效期"列，显示到期时间；操作区"设有效期"按钮弹 prompt 输入 ISO 日期（YYYY-MM-DD）或留空清除。
- 安全策略面板新增"审计日志留存天数"数字输入。
- 管理员设置/清除有效期审计 `user.set_expiry`。

## Risks / Trade-offs

- [惰性清理时延] 日志超期后需等下次写入才触发清理 → 可接受（演示+低流量），生产配定时任务。
- [过期自动禁用可能影响长期会话] 已登录的 access token（30 分钟）在到期后短期内仍有效 → 可接受，refresh 续期时会再触发检查（会话超时层已有强制下线）。
- [DELETE LIMIT 兼容性] better-sqlite3 基于较新 SQLite，支持带 LIMIT 的 DELETE。

## Migration Plan

1. migrate()：`users.account_expires_at` 列；`audit.service`/`policy.service` 设置项。
2. policy.service.js：`DEFAULT_SETTINGS` 加 `audit_retention_days: '365'`。
3. user.service.js：`setAccountExpiry(userId, expiresAt)`/`clearAccountExpiry(userId)`/`isExpired(user)`；`autoDisableExpired()`。
4. auth.js：登录过期拦截 + 每次登录触达 autoDisableExpired。
5. audit.service.js：log() 后惰性清理。
6. admin.js/admin.html：过期设置端点与 UI、retention 策略项。
7. 测试脚本新增用例；全量回归。

## Open Questions

无。