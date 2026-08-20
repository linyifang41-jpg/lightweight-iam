## Why

PAM 与 IGA 是等保/合规的两大核心：共享/特权账号凭据缺少安全托管，只能明文记录；且"谁拥有什么权限"没有集中台账，审计时需人工翻查。本项目已有 RBAC+组继承，可低成本落地"凭据保险库雏形"与"权限审计台账"两项基础能力。

## What Changes

- 新增**凭据保险库**（Vault 雏形）：管理员维护共享/特权账号凭据（如数据库 root、应用服务号），密码使用 AES-256-GCM 加密存储，仅可被授权管理员查看明文，查看/修改均审计留痕
- 新增**权限审计台账**（Access Ledger）：提供"用户×角色×权限"全量视图，含直接分配与组继承来源标记，支持 CSV 导出，覆盖审计"谁拥有什么权限"
- 管理后台新增两个页签：凭据保险库、权限台账

## Capabilities

### New Capabilities
- `pam/credential-vault`: 特权账号凭据保险库雏形——密文存储、受控查看、审计留痕
- `iga/access-ledger`: 权限审计台账——全量"用户-角色-权限"视图与来源追踪、CSV 导出

### Modified Capabilities

## Impact

- `src/models/database.js`：新增 `credentials` 表（加密密码列）
- `src/services/vault.service.js`（新建）：AES-256-GCM 加密/解密、CRUD、明文查看留痕
- `src/services/ledger.service.js`（新建）：权限台账聚合查询、CSV 导出
- `src/routes/admin.js`：新增 `/admin/credentials*` 与 `/admin/ledger` 接口（各自权限点）
- `src/models/database.js`：seedData 增加权限点 `credential:manage`、`ledger:view`
- `public/admin.html`：新增"凭据保险库""权限台账"页签
- 测试脚本 `/tmp/iam_test.sh` 新增用例