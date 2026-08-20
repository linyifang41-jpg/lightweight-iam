## Why

说明书"生命周期自动化（入职/转岗/离职）"⬜。企业 IGA（SailPoint/Entra）核心：HR 事件驱动账号开通/回收。现有系统有完整基建（用户/角色/组/部门/会话/审计），但无"一键生命周期操作"，入职需多步手工、转岗不重配权限、离职不自动回收。

## What Changes

- `lifecycle.service.js`：joiner / mover / leaver 三类操作
  - **join（入职）**：创建用户 + 分配部门/组/角色，支持默认密码策略与强制首登改密，幂等（重复报错）
  - **move（转岗）**：更新部门 + 可增删组/角色，全量重配权限
  - **leave（离职）**：停用/归档 + 吊销全部会话与 token + 可选移除直接角色，审计 `lifecycle.leave`
- 路由 `POST /admin/lifecycle/join|move|leave`（需 `user:manage`）
- 审计：`lifecycle.join`、`lifecycle.move`、`lifecycle.leave`
- 管理端 admin.html 新增"生命周期"页签（入职/转岗/离职表单）
- 后端用户导入 CSV 已存在，生命周期操作互为补充（事件驱动式，非批量）

## Capabilities

### New Capabilities
- `lifecycle/automation`: 入职/转岗/离职 IGA 操作与回收

### Modified Capabilities

## Impact

- 新文件 `src/services/lifecycle.service.js`
- `src/routes/admin.js`：3 个生命周期端点
- `public/admin.html`：生命周期页签
- `/tmp/iam_test.sh` 新增用例
- 说明书 5.2/一 相应标 ✅