## Why

等保 2.0 安全计算环境要求"登录连接超时自动退出"（身份鉴别 b 项）。当前系统虽记录会话心跳（last_active_at），但无空闲超时强制退出机制，用户长时间挂机后会话仍长期有效，存在被他人冒用的风险。

## What Changes

- 新增安全策略 `session_idle_timeout_minutes`（分钟，0=关闭，默认 15），管理员可在安全策略页配置
- 请求鉴权时检查会话最后活跃时间，超过空闲阈值则吊销该会话并返回 401，前端跳转登录页
- 正常活跃请求（每次鉴权）自动续期最后活跃时间，不影响使用
- 审计日志新增 `session.idle_timeout` 事件，记录被空闲超时登出的会话

## Capabilities

### New Capabilities
- `session/session-management`: 会话管理新增"空闲超时自动退出"能力——基于会话最后活跃时间自动吊销超时会话

### Modified Capabilities

## Impact

- `src/services/policy.service.js`：新增策略项默认值、读取逻辑
- `src/services/session.service.js`：新增空闲超时判定与吊销
- `src/middleware/auth.js`：鉴权时接入空闲超时检查
- `src/models/database.js`：种子策略写入新默认值
- `public/admin.html`：安全策略页新增配置项
- `src/routes/admin.js`：策略保存接口透传新字段
- 测试脚本 `/tmp/iam_test.sh` 新增用例
