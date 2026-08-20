## Context

用户表已有 `username` 唯一约束（`users` 表 username TEXT UNIQUE），跨租户同用户名需改为复合唯一（username, realm）。当前 `findByUsername`/`findByEmailOrPhone` 全局查找，`createUser` 直插。登录/注册路由在 `src/routes/auth.js`。前端登录页 `login.html`、注册页 `register.html`。

## Goals / Non-Goals

**Goals:**
- users 表加 realm 字段，存量兼容
- 登录/注册按 realm 隔离
- 登录页租户选择 UI
- 超管跨租户（管理列表不过滤）

**Non-Goals（后续批次）:**
- 租户 CRUD 管理（创建/启停租户）
- 租户管理员角色与权限
- 角色/组/部门/凭据/审计按租户隔离
- 会话/令牌携带租户维度

## Decisions

### 决策1：realm 语义与默认值
- `default` 为保留默认租户；未指定 realm 一律 `default`。
- realm 校验：`/^[A-Za-z0-9_-]{2,32}$/`，不允许等于 `default` 以外的保留字（暂无）。
- admin 用户 realm = `default`（超管），通过"管理端列表不过滤"实现跨租户可见。

### 决策2：DB 迁移采用 addColumnIfMissing
- `ALTER TABLE users ADD COLUMN realm TEXT DEFAULT 'default'`，存量行自动填 default，无需回填脚本。
- 唯一约束：SQLite 无法直接改唯一约束，采用**应用层校验**（登录/注册时按 username+realm 查询），不动原 username 唯一索引。这意味着跨租户同用户名技术上依赖应用层过滤，避免升级复杂化——可接受（演示环境）。

### 决策3：查找 API 签名扩展，默认参数保兼容
- `findByUsername(username, realm = DEFAULT_REALM)`
- `findByEmailOrPhone(account, realm = DEFAULT_REALM)`
- `createUser({ username, email, phone, password, realm = DEFAULT_REALM })`
- 所有现有调用点不传 realm → 默认 default → 行为不变，回归兼容。

### 决策4：登录/注册接口接收 realm，默认 default
- body `realm` 可选；为空/缺省 → 'default'；非法 → 400。
- 登录时先按 realm 过滤查用户；账号不存在统一提示（防枚举）。
- TOTP/强制改密等 token 仅携带 userId，后续按 userId 查用户（userId 全局唯一），不受 realm 影响。

### 决策5：管理端列表不过滤
- `admin.service.js` 用户列表查询不加 realm 条件 → 超管跨租户可见全部。
- 列表响应附带 realm 字段（脱敏展示用户来源租户），管理 UI 显示租户列。

## Risks / Trade-offs

- [复合唯一缺失] 依赖应用层校验而非 DB 约束 → 并发竞态可能双插（better-sqlite3 同步单线程，实际无并发窗口）；后续批次可加 `(username, realm)` 唯一索引。
- [username 全局唯一索引仍存在] 跨租户同用户名插入时 SQLite 会因旧索引报 UNIQUE 冲突 → **必须先删除/替换旧唯一索引**。方案：迁移中检测旧唯一索引并替换为 `(username, realm)` 复合唯一索引。
- [存量 email/phone 无唯一索引] 查找按 realm 过滤即可，无迁移风险。

## Migration Plan

1. migrate()：`addColumnIfMissing('users','realm','TEXT DEFAULT \'default\'')`；删除旧 `username` 唯一索引，重建 `(username, realm)` 复合唯一索引（用 `CREATE UNIQUE INDEX IF NOT EXISTS`）。
2. user.service.js 三个函数支持 realm。
3. auth.js 登录/注册解析 realm 并校验。
4. login.html / register.html 租户选择 UI。
5. 测试脚本新增跨租户用例。

## Open Questions

无。