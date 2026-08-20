# Lightweight IAM - 轻量级统一身份认证管理系统

一个轻量级的统一身份认证（IAM）系统，实现**一次登录，访问所有关联系统**（SSO 单点登录）。

## ✨ 功能特性

- ✅ 用户注册 / 登录（用户名、邮箱、手机号）
- ✅ 邮箱/手机号格式校验与绑定
- ✅ SSO 单点登录 + 单点登出（一次登录，访问多个系统）
- ✅ JWT（access 30min + refresh 7day）+ 令牌轮换 + 黑名单吊销
- ✅ RBAC 权限模型 + 用户组继承 + 组织架构（部门）
- ✅ 会话管理：设备列表、强制下线、并发会话上限、自助撤销设备
- ✅ 登录失败锁定（防暴力破解，可配置）
- ✅ 可配置密码策略：长度/字符组合、弱密码黑名单、历史防重用、密码过期
- ✅ 管理员：用户启用/禁用/归档/删除、强制重置密码、批量导入导出
- ✅ 审计日志（记录 + CSV 导出）
- ✅ TOTP 两步验证、邮箱/手机验证码、忘记密码
- ✅ CSRF 防护、登录/注册限流（可配置）
- ✅ 数据持久化（重启不丢失）

## 🏗 系统架构

```
┌───────────────────────────────────────────────────────┐
│                IAM 认证中心 (IdP)                      │
│                localhost:8080                          │
│   登录 → 写入 sso_token cookie → 验证接口              │
└───────────────┬───────────────────────────┬───────────┘
                │                           │
       ┌────────▼───────┐          ┌────────▼────────┐
       │ 应用A 员工门户   │          │ 应用B 项目管理系统 │
       │ localhost:8081  │          │ localhost:8082   │
       └────────────────┘          └─────────────────┘
```

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动全部服务（IAM + 应用A + 应用B）
npm start

# 或分别启动
npm run start:iam
npm run start:appA
npm run start:appB
```

## 📖 使用说明

1. 打开 `http://localhost:8080/` 注册账号
2. 登录后进入控制台，可绑定邮箱/手机号
3. 访问 `http://localhost:8081`（员工门户）→ 自动登录
4. 访问 `http://localhost:8082`（项目管理）→ 自动登录
5. **只需登录一次，所有关联系统免密访问**

## 📁 项目结构

```
IAM-project/
├── start.js                 # 一键启动脚本
├── config.js                # 统一配置模块
├── .env                     # 环境变量
├── src/                     # IAM 认证中心 (IdP)
│   ├── index.js             # 服务器入口
│   ├── models/database.js   # SQLite 数据库 + 表迁移 + 种子数据
│   ├── routes/auth.js       # 认证/绑定/会话/改密/TOTP 接口
│   ├── routes/admin.js      # 管理后台接口
│   ├── routes/sso.js        # SSO 验证接口
│   ├── services/
│   │   ├── user.service.js  # 用户服务（策略/历史/组继承）
│   │   ├── admin.service.js # 管理服务（组/部门/导入导出/审计导出）
│   │   ├── policy.service.js# 密码策略
│   │   ├── session.service.js # 会话管理
│   │   ├── token.service.js # JWT 黑名单
│   │   ├── audit.service.js # 审计日志
│   │   └── verify.service.js# 验证码
│   ├── middleware/auth.js   # 认证中间件
│   ├── middleware/csrf.js   # CSRF 防护
│   └── utils/jwt.js         # JWT 工具
├── apps/                    # 关联应用 (SP)
│   ├── appA.js              # 应用A 员工门户
│   ├── appB.js              # 应用B 项目管理系统
│   ├── sso-client.js        # SSO 客户端库
│   └── template.js          # 公共页面模板
├── public/                  # 前端静态页面
│   ├── index.html           # 注册/登录页
│   ├── login.html           # SSO 登录页（TOTP/强制改密/忘记密码）
│   ├── login-success.html   # 登录成功控制台（安全中心）
│   ├── admin.html           # 管理后台（7 个页签）
│   └── logout.html          # 全局登出页
└── data/                    # SQLite 数据库文件
```

## ⚙️ 配置

编辑 `.env` 文件：

```env
IAM_PORT=8080
APP_A_PORT=8081
APP_B_PORT=8082
JWT_SECRET=你的安全密钥
JWT_EXPIRES_IN=24h

# 可选：覆盖默认限流（次/分钟）
IAM_LOGIN_RATE_MAX=5
IAM_REGISTER_RATE_MAX=3
```

登录/注册限流也支持在管理后台「安全策略」页签在线调整。

## 🔐 技术栈

- Node.js + Express
- SQLite (better-sqlite3)
- JWT (jsonwebtoken)
- bcryptjs（密码加密）
- dotenv（环境变量）
- express-rate-limit（限流）
- speakeasy（TOTP 两步验证）

## 📝 主要 API

| 接口 | 方法 | 功能 |
|------|------|------|
| /auth/register | POST | 注册 |
| /auth/login | POST | 登录（限流） |
| /auth/logout | POST | 登出（吊销会话） |
| /auth/refresh | POST | 刷新令牌（轮换） |
| /auth/me | GET | 获取当前用户 |
| /auth/sessions | GET/POST/:id/revoke | 查看/撤销自己的登录设备 |
| /auth/change-password | POST | 修改密码（全量登出） |
| /auth/change-password-pending | POST | 强制改密（临时令牌） |
| /auth/forgot-password | POST | 发送重置码 |
| /auth/reset-password | POST | 重置密码 |
| /auth/totp/setup·enable·disable | POST | TOTP 两步验证 |
| /auth/bind-email·bind-phone | POST | 绑定邮箱/手机号 |
| /auth/send-verify-code·verify-code | POST | 验证码发送/校验 |
| /auth/password-policy | GET | 获取当前密码策略 |
| /sso/verify | POST | SSO 验证 token |
| /sso/session | GET | 检查登录状态 |
| /admin/users | GET/POST | 用户列表/创建 |
| /admin/users/:id/status | PUT | 启用/禁用/归档 |
| /admin/users/:id/password | PUT | 强制重置密码 |
| /admin/users/:id/department | PUT | 设置部门 |
| /admin/users/:id | DELETE | 删除用户 |
| /admin/users/export·import | GET/POST | 批量导出/导入 CSV |
| /admin/roles·:id/permissions | GET/POST/PUT | 角色管理 |
| /admin/groups·:id/members·roles | GET/POST/PUT | 用户组管理 |
| /admin/departments | GET/POST/PUT/DELETE | 组织架构管理 |
| /admin/sessions/:id/revoke | POST | 强制下线 |
| /admin/settings | GET/PUT | 安全策略配置 |
| /admin/audit-logs/export | GET | 审计日志 CSV 导出 |

## 🌐 管理后台

默认管理员：`admin / Admin123`（首次启动自动创建，改密后请妥善保管）。
登录后进入控制台 → 点击「管理后台」或访问 `http://localhost:8080/admin.html`。

包含页签：用户管理 / 角色权限 / 用户组 / 组织架构 / 会话管理 / 安全策略 / 审计日志。
