# iam/default-account Specification

## Purpose
治理默认/内置账户（等保）：识别种子账户与未改的默认密码风险，管理员可强制改密、禁用默认凭据登录、删除默认账户；策略开启后默认凭据登录被自动拦截并审计。

## Requirements

### Requirement: 默认账户风险检测
具备 `gov:manage` 权限者可查看默认账户风险清单（`GET /admin/default-accounts`）。清单项包含：用户名、是否种子账户、密码是否仍等于默认密码、是否处于强制改密待处理、账户状态、最近登录时间。

#### Scenario: 检测种子账户默认密码
- **WHEN** 管理员 GET /admin/default-accounts
- **THEN** 返回风险账户列表，含 isSeed 与 usesDefaultPassword 标记

#### Scenario: 无权限 403
- **WHEN** 无 `gov:manage` 用户访问治理端点
- **THEN** 返回 403

### Requirement: 默认账户处置
具备 `gov:manage` 权限者可对风险账户执行：强制改密（`POST /admin/default-accounts/:id/force-reset`）、禁用默认凭据登录（`POST /admin/default-accounts/:id/disable-login`）、恢复登录（`POST /admin/default-accounts/:id/enable-login`）、删除（`DELETE /admin/default-accounts/:id`）。内置 admin 账户不可删除。每个动作写入审计。

#### Scenario: 强制改密
- **WHEN** 管理员对种子账户执行 force-reset
- **THEN** 账户 must_change_password=1、现有会话全部吊销，审计 `gov.force_reset`

#### Scenario: 禁用默认凭据登录
- **WHEN** 管理员执行 disable-login
- **THEN** 该账户密码登录被拒绝（SSO/OTP/TOTP 等非密码通道不受影响），审计 `gov.disable_login`

#### Scenario: 内置 admin 不可删除
- **WHEN** 对内置 admin 执行 DELETE
- **THEN** 返回 400 拒绝，审计不产生

### Requirement: 默认凭据登录拦截
策略设置 `default_account_policy`（'0' 关闭 / '1' 开启）。开启时，种子账户使用默认密码发起密码登录被拒绝，返回提示"默认账户需由管理员先处置"，审计 `auth.login_default_blocked`。

#### Scenario: 策略开启拦截默认凭据
- **WHEN** 策略开启且种子账户以默认密码登录
- **THEN** 返回 401 + 默认账户处置提示，审计 `auth.login_default_blocked`

#### Scenario: 已改密/策略关闭不拦截
- **WHEN** 密码已非默认 或 策略关闭
- **THEN** 按常规登录流程处理
