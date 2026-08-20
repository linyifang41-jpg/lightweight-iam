# pam/break-glass Specification

## Purpose
应急访问（Break-glass）：紧急时无需审批、但强制 TOTP 强认证的限时高权限通道，全程留痕，事后由 `breakglass:manage` 审查人审阅闭环。

## ADDED Requirements

### Requirement: 发起应急访问
已启用 TOTP 的用户可通过 `POST /auth/breakglass/start`（登录+CSRF，体 {code, reason, durationMinutes?}）发起。校验：`breakglass_enabled='1'`、用户已绑定 TOTP、`totp.verifyCode(user.totp_secret, code)` 通过、理由非空、时长不超 `breakglass_duration`（默认30）。通过后授予应急角色（`breakglass_role_id` 指定或默认含全部权限的 break-glass 角色），记录 started 事件。已有未结束应急事件时 400。审计 `breakglass.start`；码错误/未绑 TOTP/停用 → 400 且审计 `breakglass.denied`。

#### Scenario: 强认证通过并开启
- **WHEN** 已绑 TOTP 用户提交正确动态码与理由
- **THEN** 创建 started 事件，用户获应急角色，返回事件

#### Scenario: 未绑 TOTP 被拒
- **WHEN** 未绑定 TOTP 的用户发起
- **THEN** 400，审计 breakglass.denied

#### Scenario: 动态码错误被拒
- **WHEN** 提交错误动态码
- **THEN** 400，审计 breakglass.denied

#### Scenario: 重复开启被拒
- **WHEN** 已有进行中应急事件又发起
- **THEN** 400

### Requirement: 结束应急
用户可 `POST /auth/breakglass/end`（仅自己有 active 事件）结束；具备 `breakglass:manage` 者可 `POST /admin/breakglass/:id/end` 结束任意 active 事件。结束：回收应急角色、置 ended。审计 `breakglass.end`。

#### Scenario: 自主结束
- **WHEN** 应急用户提交结束
- **THEN** 角色回收，事件 ended

#### Scenario: 管理端强制结束
- **WHEN** 审查人结束他人 active 事件
- **THEN** 角色回收，事件 ended

### Requirement: 事后审查
具备 `breakglass:manage` 者可查看全部事件（`GET /admin/breakglass`）并对 ended 事件 `POST /admin/breakglass/:id/review`（{reviewNote}）置 reviewed。已审查事件不可重复（400）。审计 `breakglass.review`。

#### Scenario: 审查闭环
- **WHEN** 审查人对 ended 事件提交审查意见
- **THEN** 事件置 reviewed

#### Scenario: 重复审查 400
- **WHEN** 对已 reviewed 事件再次审查
- **THEN** 400

### Requirement: 到期自动回收
`GET /admin/breakglass` 或用户 `GET /auth/breakglass` 时惰性检查 started 且已超过 expires（started_at + duration）：回收角色、置 ended、审计 `breakglass.end`。

#### Scenario: 到期回收
- **WHEN** 超过应急时长后访问列表
- **THEN** 角色回收，事件 ended

### Requirement: 无权限拦截
不具备 `breakglass:manage` 的用户访问管理端点返回 403。

#### Scenario: 403
- **WHEN** 普通用户请求 /admin/breakglass
- **THEN** 403