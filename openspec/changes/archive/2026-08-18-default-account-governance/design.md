## Context

现有基建：`src/models/database.js` 有 `addColumnIfMissing` 迁移机制；`userService.resetPassword` / `forcePasswordChange`、`tokenService` 吊销、`authMiddleware` 强制改密判断（must_change_password）、`policyService.getSetting`、登录流程在 `src/routes/auth.js` `POST /auth/login`。种子账户 admin/lin 在 database.js seed 时创建。

## Goals / Non-Goals

**Goals:**
- 种子账户标记 + 默认密码检测
- 强制改密 / 禁用默认凭据登录 / 删除默认账户
- 策略开关控制默认凭据登录拦截
- 全部动作留审计

**Non-Goals:**
- 通用"弱密码扫描"（全用户字典爆破检测，仅种子账户检测默认密码，避免误报）
- 默认账户自动改名（重命名破坏系统内置引用，只提供删除/禁用/改密）
- 与外部 IdP 的默认账户联动

## Decisions

### 决策1：数据模型
users 加两列（addColumnIfMissing）：
- `is_seed INTEGER DEFAULT 0`：seed 时 admin/lin 置 1
- `password_login_allowed INTEGER DEFAULT 1`：0 表示禁用密码登录（默认凭据拦截）
种子账户清单：DB 中 `is_seed=1` 的记录，不依赖硬编码名单。

### 决策2：默认密码检测
检测范围仅 `is_seed=1` 账户，密码字典 = 该账户首次创建时使用的初始密码（admin/Admin123、lin/lin123456，存于常量）。用 `bcrypt.compareSync` 对哈希逐个比对。普通用户不检测。

### 决策3：处置动作
- `force-reset`：`must_change_password=1` + 吊销该用户全部令牌/会话（复用 tokenService/内部下线逻辑）→ 用户下次登录必须改密
- `disable-login`：`password_login_allowed=0`；登录接口在密码校验前检查该标志，拒绝并审计 `auth.login_password_blocked`
- `delete`：普通账户可删；`is_seed=1 AND username='admin'` 受保护返回 400

### 决策4：策略与登录拦截
`policy.settings` 新增 `default_account_policy`（'0'/'1'）。`POST /auth/login` 密码流程：若开启且用户 is_seed 且密码匹配默认密码字典 → 401"默认账户需先处置"，审计 `auth.login_default_blocked`。已改密的种子账户不受影响。`DEFAULT_SETTINGS` 必须包含该键（防止 updateSettings 过滤）。

### 决策5：权限点
新增 `gov:manage`，admin 自动绑定；治理端点均要求该权限 + CSRF。

## Risks / Trade-offs

- [仅种子检测] 不扫描全库弱口令，避免误报；普通账户弱口令治理走密码策略（复杂度/黑名单）已有。
- [admin 保护] 内置 admin 不提供删除，避免锁死系统；管理员可通过 force-reset 重新掌控。
- [禁用后 SSO 可用] password_login_allowed 仅影响密码通道，SSO/OTP/TOTP 登录不受影响——符合"默认凭据治理"目标。

## Migration Plan

1. database.js：users 加列 + 权限 `gov:manage` + 设置 `default_account_policy` + seed 标记 is_seed。
2. policy.service.js：DEFAULT_SETTINGS 加 `default_account_policy: '0'`。
3. 新建 `src/services/gov.service.js`（detect/forceReset/disablePasswordLogin/enablePasswordLogin/delete）。
4. auth.js 登录拦截 + 审计。
5. admin.js 治理端点；admin.html 页签。
6. 测试脚本新增第 32 节；全量回归。

## Open Questions
- 无。