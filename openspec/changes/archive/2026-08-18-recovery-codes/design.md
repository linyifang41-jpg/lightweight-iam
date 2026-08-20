## Context

现有 TOTP 流程：`POST /auth/totp/setup`（生成密钥存库）→ `POST /auth/totp/enable`（验证动态码后 `totp_enabled=1`）；登录时 `/auth/login` 若 `totp_enabled` 返回 `totpRequired` + `loginToken`，前端 `/auth/verify-login-totp` 提交动态码完成登录。`users` 表通过 `migrate()` 幂等补列。用户表无 TOTP 前端 UI（security 中心仅有设备/改密），MFA 设置接口仅 API 可用。前端表单均用内联 `<script>`，有 `getDeviceId()` 等公共函数。

## Goals / Non-Goals

**Goals:**
- 一次性备用码：生成（SHA-256 哈希存储）、单次使用、重新生成、关闭清除
- 登录 TOTP 步骤同时接受动态码或备用码
- 补齐安全中心 MFA 自助 UI（设置/关闭/查看备用码/重新生成）
- 全链路审计留痕

**Non-Goals:**
- 不做备用码的时间有效期（一次性即用即焚，无过期需求）
- 不做短信/邮件 OTP 复用本通道
- 不改变 TOTP 算法本身

## Decisions

### 决策1：备用码存储采用 users 表 JSON 列（哈希数组），非独立表
- `users.recovery_codes` 存 `JSON.stringify([{hash, used:bool}])`，`recovery_generated_at` 记录生成时间。
- 理由：备用码生命周期与 TOTP 状态强绑定（开启生成/关闭清除），与用户行同事务更简单，避免新表 + 联表查询。数据量小（10 条哈希），JSON 足够。
- 备选：独立表 `recovery_codes` —— 规范化但需迁移+清理逻辑，收益有限，不采用。

### 决策2：备用码格式 `XXXX-XXXX`，字符集剔除易混淆字符
- 生成 8 位，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去 I/O/0/1）。
- 校验：用户输入转大写、去空格后按 `^[A-Z2-9]{4}-[A-Z2-9]{4}$` 匹配；存储统一为规范格式。
- 备选：纯数字 —— 与 TOTP 6 位混淆，用户体验差，不采用。

### 决策3：备用码校验接入 `verify-login-totp`
- 现有路由校验顺序：loginToken 有效 → 用户 totp_enabled → 先验证 TOTP 动态码（6 位数字）→ 不通过则尝试备用码（`XXXX-XXXX` 格式）。二者独立判定，任一通过即放行。
- 保持登录令牌语义不变，前端 `login.html` 表单支持输入任一格式。
- 待加入黑名单：登录后同现有流程 `createOrReuse` + `enforceMaxSessions`。

### 决策4：安全中心 MFA UI 补齐在 `login-success.html`
- 新增"两步验证"区块：未开启显示"去开启"（secret + otpauth URI + 输入动态码确认）；已开启显示"已开启" + 备用码管理（查看剩余/重新生成）。
- TOTP 校验沿用现有接口；重新生成需 CSRF。关闭 TOTP 用现有 `/totp/disable`。
- 理由：现无任何前端入口，属本功能必要组成（无 UI 则用户无法自助取用备用码）。

## Risks / Trade-offs

- [备用码明文泄露风险] 备用码仅展示一次且存哈希，泄露面限于生成瞬间 → 提供"重新生成"让用户随时轮换；审计留痕。
- [TOTP 与备用码同时存在] 校验顺序固定，不影响 TOTP 计数窗口 → 无冲突。
- [JSON 列可读性] 无独立表，但访问集中封装在 user.service，可维护 → 可接受。

## Migration Plan

1. `migrate()` 幂等补列 `recovery_codes TEXT`、`recovery_generated_at DATETIME`
2. 后端逻辑新增到 user.service + auth.js
3. 前端 login-success.html / login.html 更新
4. 无存量数据迁移，旧用户无需处理

## Open Questions

无。