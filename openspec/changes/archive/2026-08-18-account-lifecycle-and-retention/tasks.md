## 1. 数据层与策略

- [x] 1.1 `src/models/database.js`：migrate 新增 `users.account_expires_at`（TEXT）
- [x] 1.2 `policy.service.js`：`DEFAULT_SETTINGS` 新增 `audit_retention_days: '365'`

## 2. 账户过期

- [x] 2.1 `user.service.js`：`setAccountExpiry(userId, expiresAt)`、`clearAccountExpiry(userId)`、`isExpired(user)`、`autoDisableExpired()`（UTC 时间比较，disabled + 审计）
- [x] 2.2 `auth.js` 登录：过期拦截（423 + `auth.login_expired`）；登录触达执行 autoDisableExpired
- [x] 2.3 `index.js`：启动时执行一次 autoDisableExpired

## 3. 数据保留

- [x] 3.1 `audit.service.js`：`log()` 后惰性清理（audit_retention_days>0 且距上次清理≥1小时，DELETE LIMIT 5000，settings 记 last_audit_cleanup_at）

## 4. 管理端

- [x] 4.1 `admin.js`：`PUT /admin/users/:id/expiry`（user:manage，设/清有效期，审计 `user.set_expiry`）
- [x] 4.2 `admin.html`：用户列表"有效期"列 + 设有效期按钮；安全策略面板"审计日志留存天数"项

## 5. 测试与回归

- [x] 5.1 更新 `/tmp/iam_test.sh`：新增第 24 节——设有效期→过期登录被拒(423)→自动禁用→设后登录成功→清除有效期；retention 配置保存；审计清理（造超期日志→写日志触发清理→超期日志消失）
- [x] 5.2 全量回归通过（预计 80 + 新增）