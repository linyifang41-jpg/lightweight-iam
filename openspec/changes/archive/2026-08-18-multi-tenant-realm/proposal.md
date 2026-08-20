## Why

规格说明书"多租户（Realm）"标注为实现待办。本次为多租户打下最小可行基础：预留 realm 概念与字段，实现登录/注册按租户隔离，为后续租户管理、数据隔离、租户管理员等批次铺路。默认租户 `default` 保持现有行为完全不变（向后兼容）。

## What Changes

- users 表新增 `realm` 字段（默认 `default`），现有用户自动归入默认租户
- 登录页新增租户选择（下拉+手动输入，默认 `default`）
- 注册按租户隔离用户名唯一性；登录按租户查找账号
- 用户查找 API（`findByUsername`/`findByEmailOrPhone`）支持 realm 维度
- 用户列表（管理端）暂不按 realm 过滤 → 超管跨租户可见全部（"跨租户"能力本次以不过滤方式天然成立）

## Capabilities

### New Capabilities
- `tenant/realm`: 多租户 Realm 基础——realm 字段预留、登录/注册按租户隔离、默认租户兼容

### Modified Capabilities

## Impact

- `src/models/database.js`：migrate 新增 `users.realm` 列
- `src/services/user.service.js`：`findByUsername`/`findByEmailOrPhone`/`createUser` 支持 realm
- `src/routes/auth.js`：注册/登录接收 realm 参数并按租户校验
- `public/login.html`、`public/register.html`：租户选择 UI
- 测试脚本 `/tmp/iam_test.sh`：新增跨租户隔离用例