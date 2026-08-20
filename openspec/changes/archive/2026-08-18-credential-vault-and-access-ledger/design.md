## Context

现有系统：RBAC（user_roles/role_permissions）+ 组继承（group_roles/group_members）+ 部门，`user.service.js` 已有 `_roleIdsQuery()`（UNION 直接+继承角色）与 `getUserPermissions`。管理端 `admin.js` 用 `requirePermission` 控制权限，权限点在 `database.js` seedData 的 permissions 数组定义。无任何加密工具库；Node 内置 `crypto` 可用。`.env` 有 `JWT_SECRET`。

## Goals / Non-Goals

**Goals:**
- 凭据保险库：AES-256-GCM 加密存储、受控查看留痕、审计
- 权限台账：全量用户×角色×权限聚合 + 来源标记 + CSV 导出 + 检索
- 两个新权限点控制访问

**Non-Goals:**
- 不做凭据自动轮换、动态取用（JIT）、会话录制等完整 PAM
- 不做角色挖掘/审批流等完整 IGA
- 加密密钥管理不接 KMS，使用环境变量派生密钥

## Decisions

### 决策1：凭据加密用 Node `crypto` AES-256-GCM
- 密钥由 `VAULT_KEY` 环境变量派生（SHA-256 → 32 字节）；未设置时回退到基于 `JWT_SECRET` 派生，保证开箱可用但可被运维覆盖。
- GCM 提供认证加密（防篡改），存储格式 `iv:authTag:ciphertext`（base64）。每次加密随机 IV。
- 备选：引入 `@sindresorhus/crypto`/`node:crypto` 的 scrypt —— 内置 crypto 足够，避免新依赖。

### 决策2：新表 `credentials`
- 字段：`id, name, system, username, encrypted_password, note, created_at, updated_at`。
- 列表接口永不返回 `encrypted_password` 明文；仅 `GET /credentials/:id/reveal` 解密返回，并审计 `vault.reveal`。

### 决策3：台账复用现有 RBAC 查询，新增来源标记
- `_roleIdsQuery()` 只给角色 id，无法区分来源。台账单独 SQL：直接角色 JOIN user_roles；继承角色 JOIN group_roles+group_members，带来源字符串。权限聚合按角色去重。
- 备选：改造 `_roleIdsQuery` 带来源 —— 影响现有 `getUserRoles/getUserPermissions`，风险大，不采用。

### 决策4：权限点 `credential:manage`、`ledger:view`
- 在 seedData permissions 数组新增两个权限点，admin 角色自动获得（现有逻辑：给 admin 绑定全部权限）。
- 台账查看用 `ledger:view`（audit 类），凭据管理用 `credential:manage`。

## Risks / Trade-offs

- [密钥泄露导致凭据全解密] 密钥基于 env → 运维保管 env；不落盘明文；审计留痕。
- [无独立密钥管理] 适合本项目单机形态 → 文档说明生产接 KMS。
- [台账 SQL 复杂度] 来源标记需两次 JOIN → 聚合后内存去重，数据量级（单机演示）可接受。

## Migration Plan

1. `migrate()` 新增 `credentials` 表（CREATE TABLE IF NOT EXISTS）
2. seedData 补权限点（幂等 INSERT OR IGNORE，admin 角色同步绑定）
3. 新增 vault/ledger service，挂载路由
4. admin.html 新增页签与交互
5. 测试脚本新增用例

## Open Questions

无。