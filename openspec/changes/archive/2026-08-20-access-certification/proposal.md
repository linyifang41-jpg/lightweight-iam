## Why

说明书 6.2"访问认证（Access Certification）⬜"。权限存在长期累积、离职/调岗未回收的幽灵权限风险。定期复审让主管逐项确认用户权限是否仍需保留，超期未审按策略自动处置。与已有访问请求审批流（access_requests）互补：申请→审批→授权，复审→确认→回收。本批实现 **访问复审活动（Certification Campaign）**。

## What Changes

- 新表 `certifications`（活动：name/status/due_date/scope/auto_action/created_by）与 `certification_items`（复审项：user+role 快照，pending/kept/revoked + 审批人/备注）
- 新权限点 `cert:manage`（创建/关闭活动）、`cert:review`（逐项复审）；admin 自动绑定
- 策略设置 `certification_due_action`（'keep'/'revoke'）：截止未处理项的默认动作
- 新增 `src/services/cert.service.js`：
  - `createCampaign`：按范围（部门或指定用户）快照全部 user-role 分配为复审项
  - `listCampaigns` / `getCampaign`：列表 + 明细 + 统计（待审/保留/撤销）
  - `reviewItem`：单项 keep / revoke（revoke 即时回收 user_roles + 审计）
  - `closeCampaign`：未处理项按 auto_action 批量处置后关闭
  - 惰性到期检查：列表/明细时自动关闭到期活动
- 新端点（`cert:manage` / `cert:review` + CSRF）：`GET/POST /admin/certifications`、`GET /admin/certifications/:id`、`POST /admin/certifications/:id/items/:itemId/decision`、`POST /admin/certifications/:id/close`
- 审计：`cert.create`、`cert.review_keep/revoke`、`cert.close`、`cert.auto_revoke`、`cert.auto_keep`
- admin.html 新增"访问复审"页签
- `/tmp/iam_test.sh` 新增第 34 节

## Capabilities

### New Capabilities
- `iga/access-certification`: 访问复审（定期确认与回收用户权限）

### Modified Capabilities

## Impact

- `src/models/database.js`：建表 certifications/certification_items；权限种子加 cert:manage/cert:review；设置种子加 certification_due_action
- `src/services/policy.service.js`：DEFAULT_SETTINGS 加 certification_due_action
- 新文件 `src/services/cert.service.js`
- `src/routes/admin.js`：复审端点
- `public/admin.html`：访问复审页签
- `/tmp/iam_test.sh` 新增用例（预期 265 + 新增）