# IAM 项目开发日志

## 2026-08-12

### 1. 需求调研

**调研结论：**
- IAM = 身份认证 + 授权管理 + 审计日志
- 技术选型：Node.js + SQLite + JWT

### 2. 项目初始化

**已完成：**
- ✅ 创建项目结构
- ✅ 实现用户注册/登录 API
- ✅ JWT Token 认证
- ✅ SQLite 数据库
- ✅ RBAC 表结构

### 3. SSO 单点登录

**架构：**
- IdP（认证中心）: localhost:8080
- 应用A 员工门户: localhost:8081
- 应用B 项目管理系统: localhost:8082

**实现原理：**
1. 登录成功 → 写入 `sso_token` cookie（24小时有效）
2. 访问应用 → 浏览器自动携带 cookie
3. 应用调 IdP `/sso/verify` 验证 → 自动登录

### 4. 邮箱/手机号绑定功能

**新增 API：**
| 接口 | 方法 | 功能 |
|------|------|------|
| /auth/bind-email | POST | 绑定邮箱（检查是否被占用） |
| /auth/bind-phone | POST | 绑定手机号（检查是否被占用） |

**前端功能：**
- 注册时：可选择"暂不绑定"，只用用户名注册
- 登录成功页：显示绑定状态，未绑定显示"去绑定"按钮
- 点击"去绑定" → 弹窗输入 → 提交绑定
- 绑定失败（已占用）→ 显示错误提示

### 5. P0 问题修复（2026-08-12）

| 问题 | 修复方案 | 状态 |
|------|----------|------|
| 每次重启丢失用户 | 删除 DROP TABLE，只用 CREATE TABLE IF NOT EXISTS | ✅ |
| JWT Secret 硬编码 | 使用 dotenv + .env 文件 | ✅ |
| CORS 允许所有来源 | 限制为 localhost:8080/8081/8082 | ✅ |
| 登录无限制 | 添加 express-rate-limit（5次/分钟） | ✅ |
| 无 .gitignore | 添加 .gitignore | ✅ |

### 6. 测试结果

- ✅ 用户注册成功
- ✅ 用户登录成功
- ✅ SSO 自动登录（访问应用A/B无需再次登录）
- ✅ 绑定邮箱/手机号成功
- ✅ 绑定已被占用的邮箱 → 返回错误
- ✅ 重启后数据保留
- ✅ 登录限流生效（5次后拒绝）

### 7. 启动方式

```bash
cd ~/Desktop/IAM-project
npm run start:all
# IAM: http://localhost:8080
# 应用A: http://localhost:8081
# 应用B: http://localhost:8082
```

### 8. 环境变量配置

编辑 `.env` 文件：
```
JWT_SECRET=你的密钥
IAM_PORT=8080
APP_A_PORT=8081
APP_B_PORT=8082
```

### 9. 待开发

- [ ] Refresh Token 自动刷新
- [ ] 密码强度校验
- [ ] RBAC 角色权限管理
- [ ] 审计日志
- [ ] 密码重置功能

## 2026-08-13 代码整合重构

### 优化内容

1. **统一配置模块** `config.js`
   - 集中管理端口、URL、JWT、数据库、SSO cookie 配置
   - 所有模块从 `config.js` 读取配置，不再硬编码

2. **抽取公共页面模板** `apps/template.js`
   - appA/appB 共用同一套 HTML 模板
   - 通过参数（标题/主题色/卡片/链接）区分品牌
   - 消除了约 80 行重复 HTML

3. **统一 SSO 客户端** `apps/sso-client.js`
   - 使用配置模块的 cookie 名称、地址

4. **一键启动脚本** `start.js`
   - `npm start` 同时启动 IAM + 应用A + 应用B
   - 优雅关闭所有子进程

5. **环境变量规范化** `.env`
   - IAM_PORT / APP_A_PORT / APP_B_PORT / JWT_SECRET 等

### 测试结果

- ✅ 三个服务一键启动
- ✅ SSO 自动登录正常（应用A/B）
- ✅ 绑定邮箱正常
- ✅ session 返回绑定的 email
- ✅ 重启后数据保留

### 最终目录结构

```
IAM-project/
├── start.js              # 一键启动
├── config.js             # 统一配置
├── .env                  # 环境变量
├── src/                  # IAM 认证中心
│   ├── index.js
│   ├── models/database.js
│   ├── routes/{auth,sso}.js
│   ├── services/user.service.js
│   ├── middleware/auth.js
│   └── utils/jwt.js
├── apps/                 # 关联应用
│   ├── appA.js
│   ├── appB.js
│   ├── sso-client.js
│   └── template.js
├── public/               # 前端页面
│   ├── index.html
│   ├── login.html
│   └── login-success.html
└── data/                 # 数据库

## 2026-08-13 高优先级安全优化

### 优化内容

1. **Token 改用 POST body 传递**
   - `/sso/verify` 从 GET query 改为 POST body
   - 避免 token 泄露到日志、浏览器历史、Referer header

2. **密码强度校验**
   - 后端 + 前端双重校验
   - 规则：至少 8 位，包含字母和数字

3. **单点登出（全局退出）**
   - 新增 `token_blacklist` 表，登出时吊销 token（jti 机制）
   - 登出清除所有应用本地会话 cookie
   - 即使 JWT 未过期，吊销后立即失效

4. **Refresh Token 自动刷新**
   - access token 缩短为 30 分钟，refresh token 7 天
   - 新增 `/auth/refresh` 接口和 `/sso/refresh` 跳转端点
   - 应用检测 token 过期 → 自动跳 IdP 刷新 → 无感续期

### 新增文件
- `src/services/token.service.js` - token 黑名单管理
- `public/logout.html` - 全局登出页面

### 测试结果
- ✅ 弱密码（纯数字/纯字母）注册被拒绝
- ✅ 强密码注册成功
- ✅ verify 仅支持 POST，GET 返回 404
- ✅ refresh token 成功刷新 access token
- ✅ 单点登出后 token 立即失效（黑名单生效）
- ✅ SSO 自动登录应用 A/B 正常

## 2026-08-14 中优先级优化

### 优化内容

1. **RBAC 接口化**（新增 `src/routes/admin.js` + `src/services/admin.service.js`）
   - 用户管理：列表、创建、启用/禁用（status 字段）
   - 角色管理：列表、创建、权限分配
   - 权限管理：权限列表
   - 权限控制：`user:manage` / `role:manage` / `audit:view`

2. **用户管理页**（新增 `public/admin.html`）
   - 用户管理 Tab：创建用户、分配角色、启用/禁用
   - 角色权限 Tab：查看角色、创建角色、勾选权限
   - 审计日志 Tab：查看操作记录
   - 登录成功页自动检测 admin 角色并显示入口

3. **审计日志**（新增 `src/services/audit.service.js`）
   - 新增 `audit_logs` 表
   - 记录：注册、登录成功/失败、登出、绑定邮箱/手机号、创建用户、状态变更、角色分配/移除、创建角色、权限更新

4. **CSRF 防护**（新增 `src/middleware/csrf.js`）
   - 双提交 cookie 模式：登录时下发 `csrf_token` cookie（JS 可读），前端写操作带 `X-CSRF-Token` header
   - 应用于：创建用户、状态变更、角色分配/移除、创建角色、权限更新、登出、绑定邮箱/手机号

5. **注册限流**
   - 每个 IP 每分钟最多 3 次注册，防止批量灌号

### 种子数据
- 权限：user:manage / role:manage / audit:view
- 角色：admin（全部权限）/ user（默认）
- 管理员账号：admin / Admin123（幂等，已存在不覆盖）

### 测试结果
- ✅ 种子 admin 账号可登录
- ✅ 无 CSRF 请求被拒（403），有 CSRF 放行
- ✅ 创建用户 / 分配角色 / 禁用用户全部正常
- ✅ 禁用用户后其 token 立即失效（401）
- ✅ 审计日志完整记录所有操作
- ✅ 注册限流：第 4 次起被拦截

## 2026-08-14 低优先级优化（一期）+ SSO 重定向流程修复

### SSO 重定向流程（按 OAuth2/OIDC 重定向模型修复）
- **标准流程**：未登录访问应用 → 302 到 IAM 登录页（携带完整回跳地址）→ 登录 → 跳回原应用 → 应用验证 → 建立本地会话
- **修复**：redirect 参数从相对路径改为完整 URL（`http://localhost:8081/`），登录后正确跳回原应用而非 IAM 首页
- **open redirect 防护**（OWASP）：
  - 服务端 `/sso/refresh` 用白名单校验（`src/utils/safe-redirect.js`）
  - 前端 login.html 校验 redirect 域名白名单（localhost:8080/8081/8082）
  - 恶意 redirect 一律回退到默认地址

### 新增功能
1. **忘记密码**：`/auth/forgot-password`（发重置码）+ `/auth/reset-password`（重置），重置后吊销该用户全部 token
2. **邮箱/手机验证**：`/auth/send-verify-code` + `/auth/verify-code`，验证码 10 分钟有效，一次性使用
3. **TOTP 两步验证**：`/auth/totp/setup` + `/auth/totp/enable` + `/auth/totp/disable`，登录时两步验证（RFC 6238，兼容 Google Authenticator）
4. **修改密码**：`/auth/change-password`
5. **TOTP 登录前端**：login.html 支持第二步动态码输入

### 新增文件
- `src/utils/totp.js` - TOTP 实现（RFC 6238 + base32）
- `src/utils/safe-redirect.js` - 安全重定向（防 open redirect）
- `src/services/verify.service.js` - 验证码服务

### 测试结果
- ✅ 未登录访问应用 → 302 到登录页，redirect 为完整 URL
- ✅ 登录后跳回原应用（含深层路径 /tasks）
- ✅ SSO 免登录：登录一个应用后访问另一个应用无需重复登录
- ✅ open redirect 防护：恶意 URL 回退到 /
- ✅ TOTP 用户两步登录完整流程
- ✅ 忘记密码重置后旧 token 全部失效

## 2026-08-14 低优先级优化（二期）说明

### HTTPS（生产必做，本地 demo 暂缓）
- 所有 cookie 已设 `sameSite: 'lax'`，生产需将 IAM 与关联系统全部升级为 HTTPS
- 需在反向代理（Nginx）或 Node https 模块配置 TLS 证书
- cookie 需加 `secure: true` 属性（HTTPS 下生效）

### 分布式会话（多实例部署需 Redis）
- 当前 token 黑名单与验证码存单机 SQLite，仅适合单实例
- 多实例场景需迁移到 Redis：
  - token 黑名单 → Redis SETNX + TTL
  - 验证码 → Redis STRING + TTL
  - 会话 → Redis SESSION
- 建议使用 Redis 集群 + session 统一存储方案

### 验证码发送（生产需替换）
- 当前 demo 直接返回验证码（无短信/邮件通道）
- 生产应接入短信网关（阿里云/腾讯云 SMS）或邮件服务（SMTP/SendGrid）

## 2026-08-14 缺失功能完善（调研对标 Keycloak/Casdoor/阿里云 IDaaS/等保2.0）

### 调研结论（业界标准 IAM 功能 vs 本系统）
- 已有：SSO+单点登出、RBAC、JWT+Refresh+黑名单、TOTP、验证码、CSRF、限流、审计、忘记/修改密码、管理控制台
- 缺失补齐（本批）：会话管理、账户锁定、可配置密码策略（防重用/过期/黑名单）、管理员强制改密、账号删除/归档、批量导入导出、用户组、组织架构、审计报表导出、自助会话管理

### 高优先级
1. **会话管理**
   - 新增 `sessions` 表：记录登录设备/IP/UA、登录时间、最近活跃、过期时间
   - 登录/TOTP登录/强制改密自动记录会话；每次请求心跳更新 last_active_at
   - 管理员：会话列表 + 强制下线（吊销该会话 access+refresh token）
   - 用户自助：`/auth/sessions` 查看自己的登录设备、撤销任一设备（`/auth/sessions/:id/revoke`）
   - 并发会话上限：`max_sessions_per_user` 策略，超限自动踢最旧会话（默认 0 不限）
   - refresh 令牌轮换：刷新时旧 refresh token 立即吊销

2. **账户锁定**（等保2.0 身份鉴别）
   - 新增 `failed_attempts` / `locked_until` 字段
   - 登录失败 N 次锁定 X 分钟（可配置，默认 5 次/15 分钟），锁定期间返回 423
   - 成功登录/重置密码/管理员改密自动解锁
   - 登录账号不存在时统一返回"账号或密码错误"，防账号枚举

3. **密码策略可配置化**（新增 `settings` 表 + `policy.service.js`）
   - 可配置：最小长度、需字母/数字/特殊字符、历史密码防重用条数、密码有效期（过期强制改）、登录锁定参数、并发会话上限
   - 新增 `password_history` 表实现防重用（默认保留最近 3 次）
   - 弱密码黑名单（常见弱密码字典，注册/改密/重置均校验）
   - 密码过期（`password_max_age_days`）后登录强制改密
   - 前端注册页/登录页动态读取策略提示

4. **管理员强制重置密码**
   - `/admin/users/:id/password`：设置新密码 + `must_change_password=1` + 吊销全部会话
   - 用户下次登录返回 `mustChangePassword` + 临时令牌，改密完成后自动登录
   - 新增 `/auth/change-password-pending` 接口
   - login.html 强制改密表单

### 中优先级
5. **账号状态机 + 批量导入导出**
   - 状态：active / disabled / archived；禁用/归档自动吊销会话
   - 物理删除：清理 user_roles/group_members/sessions/password_history（内置 admin 不可删）
   - 导出用户 CSV（`/admin/users/export`，带 BOM，Excel 兼容）
   - 批量导入用户 CSV（`/admin/users/import`，含逐行错误报告）

6. **用户组**（`groups` / `group_members` / `group_roles`）
   - 组内成员自动继承组角色（`user:manage`/`group:manage` 权限）
   - 权限查询合并直接角色 + 组继承角色
   - admin.html 用户组管理（创建/删组/成员/角色勾选）

7. **组织架构/部门**（`departments` 表）
   - 部门树（parent_id）、用户归属部门、重命名/删除（含子部门检查）
   - admin.html 部门管理 + 用户列表部门列/下拉分配

8. **审计报表与导出**
   - 审计日志导出 CSV（`/admin/audit-logs/export`）
   - 新增审计事件：登录锁定/禁用、强制下线、强制改密、删除用户、导入、组/部门/策略操作等

9. **自助会话管理前端**
   - login-success.html 安全中心：修改密码（改后全量登出）、查看/下线登录设备

### 新增/修改文件
- 新增：`src/services/policy.service.js`、`src/services/session.service.js`
- 修改：`src/models/database.js`（新表+迁移）、`src/routes/{auth,admin,sso}.js`、`src/services/{user,admin,token}.service.js`、`src/middleware/auth.js`、`src/utils/jwt.js`（返回 jti + changeToken）、`config.js`（限流可配置）
- 前端：`admin.html`（7 个页签）、`login.html`（强制改密/忘记密码）、`login-success.html`（安全中心）、`index.html`（动态密码策略提示）

### 修复的 Bug
- **刷新令牌轮换**：`/auth/refresh` 与 `/sso/refresh` 旧 refresh token 立即吊销
- **同秒误吊销**：`user_revoke` 时间比较改为秒级，避免同一秒内新签发 token 被误判失效
- **强制改密未解锁**：管理员改密/重置密码现在同时清除锁定状态

### 测试结果（38 项全部通过）
- ✅ 弱密码黑名单/长度/字符要求校验
- ✅ 密码历史防重用（改回近期密码被拒）
- ✅ 5 次失败锁定、锁定期内正确密码也被拒、管理员重置解锁
- ✅ 强制改密完整流程（登录→必须改密→改密→自动登录）
- ✅ 管理员强制下线后用户 token 立即失效（401）
- ✅ 并发会话上限=1 时旧会话被踢
- ✅ 用户组角色继承（自定义角色带权限，成员获得权限）
- ✅ 部门设置/列表、批量导入（成功+逐行错误）、审计 CSV 导出
- ✅ SSO 完整流程（未登录重定向→登录→应用A→应用B 免登录→全局登出）
- ✅ 默认登录限流第 6 次被拦截（可配置）

## 2026-08-14 Bug 修复：同设备重复登录会话堆积

### 问题现象
同一设备重复登录同一账号（登录→退出→再登录），"我的设备/会话列表"会显示多条完全相同的记录。

### 根因
登录（普通登录/TOTP 登录/强制改密）每次都无条件 `INSERT` 新会话，未做设备维度去重。

### 修复方案
1. **设备标识**：
   - 新增 `public/js/device.js`：前端首次访问在 `localStorage` 生成持久化 `deviceId`（`iam_device_id`），登录请求随 body 携带
   - 后端 `session.service.js` 新增 `resolveDeviceId()`：优先使用前端 deviceId；未携带（如 curl/脚本）时用 UA 哈希兜底
2. **会话复用**（`session.service.js` 的 `create` → `createOrReuse`）：
   - 同用户同设备已有 active 会话时，**复用该会话**（更新 jti/refresh_jti/IP/UA），不再新建
   - 复用后旧 access/refresh token 立即加入黑名单（令牌已轮换）
   - 不同设备各自独立会话，互不影响
3. **表结构**：`sessions` 表新增 `device_id` 列（幂等迁移）
4. **接入点**：`/auth/login`、`/auth/verify-login-totp`、`/auth/change-password-pending` 三处登录入口统一走 `createOrReuse`

### 测试结果
- ✅ 同一设备登录 3 次 → 会话列表仅 1 条，且会话 id 复用
- ✅ 复用后首次登录的旧令牌立即失效（401）
- ✅ 加入另一设备 → 各自独立会话（互不干扰）
- ✅ 无 deviceId 请求（UA 兜底）同样去重
- ✅ 全量回归 40/40 通过（新增 test 18 同设备去重用例）

### 补充修复（同一问题反馈后深化）
- **会话列表仍重复显示的根因**：
  - `listForUser` 未过滤 `status`，把已吊销的历史会话也返回给用户 → 改为只返回 `active` 会话
  - `listForUser` 的 SELECT 缺少 `jti` 字段，导致 `/auth/sessions` 的 `current`（[当前]标记）恒为 false → 补上 jti 并计算后剥离，不暴露给前端
  - 修复前遗留的 `device_id IS NULL` 旧会话：登录时自动吊销清理（`legacy_cleanup`），不再堆积
- ✅ 复现用户场景（登录→查看→退出→登录×3）：每次查看仅 1 条设备且标记 [当前]
- ✅ 全量回归 40/40 通过
