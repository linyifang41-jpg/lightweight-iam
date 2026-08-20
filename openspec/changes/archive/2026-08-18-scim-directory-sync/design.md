## Context

现有基建：`userService.createUser`（密码策略校验）、`adminService.createUserByAdmin/setUserStatus/deleteUser`、`auditService.log`、`policyService` settings 表。Bearer 认证模式参考 oidc.js（`req.headers.authorization` 解析）。settings 用 key/value 表。

## Goals / Non-Goals

**Goals:**
- SCIM 2.0 核心端点：ServiceProviderConfig/ResourceTypes/Schemas/Users CRUD
- Bearer token 认证 + 管理端配置
- 审计

**Non-Goals:**
- Groups/Bulk/Me 端点（说明书仅"用户账号自动开通/更新/禁用"）
- 密码明文回传（SCIM 不返回 password）
- OAuth bearer 签发（仅共享密钥 token）

## Decisions

### 决策1：认证为共享密钥
`scim_token` 存 settings。中间件校验 `Authorization: Bearer <token>` 与 settings 一致，不一致 401。token 由管理端生成（crypto.randomBytes）。

### 决策2：用户映射
- `userName` → username（唯一，租户 default）
- `emails[0].value` → email；`phoneNumbers[0].value` → phone
- `active` → status（true=active / false=disabled）
- 密码：POST 缺 password 时用随机密码 + must_change_password=1

### 决策3：DELETE 语义
SCIM 允许 `PATCH {"active":false}` 软删除；DELETE 走物理删除（与现有 user.delete 一致）。返回 204。

### 决策4：PUT 全量替换 active 驱动状态
PUT 时 active 决定 status：false→disabled（吊销会话），true→active。userName/email/phone 一并更新。

### 决策5：错误响应按 SCIM 规范
错误返回 `{"schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],"detail":...,"status":...}`。

## Risks / Trade-offs

- [共享密钥] 非 OAuth，安全性靠 token 强度 + HTTPS；生产建议换 Bearer token 签发。
- [租户] 仅 default 租户，SCIM 不传 realm。

## Migration Plan

1. policy.service.js：DEFAULT_SETTINGS 加 `scim_token: ''`。
2. 新建 `src/routes/scim.js`（含认证中间件、filter 解析、映射、审计）。
3. `src/app.js` 挂载 `/scim/v2`。
4. admin.html 安全策略页加 SCIM token 配置。
5. 测试脚本新增第 28 节；全量回归。

## Open Questions

无。