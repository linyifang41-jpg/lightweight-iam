## Context

现有登录链路：登录成功后设置 cookie（sso_token）+ 自研 `/sso/verify` 供同域应用校验。JWT 工具 `src/utils/jwt.js` 提供 HS256 签发（`generateTokens`/`safeVerify`）。前端登录页 `login.html` 有 `getSafeRedirect()` 处理回跳。无任何 OIDC/OAuth 库；Node 内置 `crypto` 可用于 RSA 密钥生成与 RS256 签名。

## Goals / Non-Goals

**Goals:**
- 标准 OIDC Authorization Code Flow 全链路（discovery/jwks/authorize/token/userinfo）
- 客户端注册管理（含 redirect_uri 白名单）
- 与现有 cookie SSO 并存，不破坏现有功能

**Non-Goals:**
- 不做隐式流/混合流（response_type 仅 code）
- 不做 refresh_token grant（授权码流暂不开放 refresh grant，可后续扩展）
- 不做 OIDC 登出（end_session_endpoint）与前端登出
- 不做动态客户端注册（RFC 7591）
- 不做 scope 级 claim 过滤（openid 即返回基础 claims）

## Decisions

### 决策1：RS256 + Node 内置 crypto 生成 RSA 密钥
- 首次启动生成 2048-bit RSA 密钥对，私钥 PEM 存入 DB（settings 表 key=`oidc_rsa_private_key`），公钥计算导出 JWK 供 jwks 端点。
- 备选：引入 `jsonwebtoken`/`jose` —— 项目未用任何 JWT 库（自研 HS256），为避免依赖引入，用 crypto 自实现 RS256 签名（Node `crypto.sign`/`verify`）。ID Token 与现有 HS256 令牌体系相互独立。
- 私钥存 DB 是单机可接受方案（同 JWT_SECRET 类），生产应迁移 KMS/环境变量。

### 决策2：授权码存 DB（oidc_auth_codes 表）
- 字段：code、client_id、user_id、nonce、expires_at、used（0/1）、created_at。
- 5 分钟过期、单次使用（used 置 1 后拒绝）。换取 token 时校验 client + code + 未使用 + 未过期。
- 备选：签名 code（自包含）—— 无法及时吊销、审计性差，不采用。

### 决策3：登录复用现有认证流程，authorize 用 cookie 判定会话
- authorize 检查 sso_token cookie：有效则直接发码回跳；无效则跳 `login.html?redirect=<authorize-url 编码>`，登录成功后前端回跳到完整 authorize URL，再次进入授权流程。
- 复用现有 `authMiddleware` 逻辑但以轻量方式（校验 cookie 有效性即可），不强制 admin 权限。

### 决策4：access_token 复用现有 HS256 体系，id_token 用 RS256
- access_token 用现有 `generateTokens` 签发（type=access），userinfo 用 `safeVerify` 校验；id_token 按 OIDC 标准用 RS256 独立签发（含 iss/aud/sub/nonce）。
- 理由：最小改动 + userinfo 复用现有吊销体系；id_token 必须按标准可被 RP 用 JWKS 验签，故独立。

### 决策5：客户端管理走 admin 路由，权限点 `oidc:manage`
- client_id = `oidc-` + uuid 前 8 位；client_secret = 32 字节 base64url（生成后仅返回一次，DB 存哈希? —— 折中：本项目单机 demo 存明文但列表不返回，reveal 需再次完整展示；为简单，存哈希校验）。
- 实际存储：client_secret 存 SHA-256 哈希，创建响应返回明文一次。

## Risks / Trade-offs

- [私钥存 DB] 私钥泄露即签名冒用 → 单机可接受；文档标注生产迁移 KMS。
- [id_token RS256 自实现] 需严格按 JWT 结构（base64url header.payload.signature）→ 用标准 claims，crypto.sign 正确实现。
- [scope 不细分] 只返回基础 claims → 符合最小可用，后续可扩展。
- [并发 code 竞争] used 标记非原子 → better-sqlite3 同步单线程，无竞争。

## Migration Plan

1. migrate() 新增两张表 + settings 写入 RSA 私钥（幂等）
2. 新建 oidc.service + oidc.js 路由并挂载
3. admin.js 客户端 CRUD + admin.html 页签
4. 测试脚本新增授权码全流程用例

## Open Questions

无。