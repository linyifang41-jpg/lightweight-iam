## 1. 数据模型与种子

- [x] 1.1 `src/models/database.js`：建表 `certifications`、`certification_items`；权限种子新增 `cert:manage`、`cert:review`；设置种子新增 `certification_due_action`

## 2. 复审服务

- [x] 2.1 `src/services/cert.service.js`：createCampaign（范围快照）/listCampaigns/getCampaign（统计）/reviewItem（keep/revoke 回收权限）/closeCampaign（pending 按 auto_action 处置）/autoCloseExpired（惰性到期）
- [x] 2.2 `src/services/policy.service.js`：DEFAULT_SETTINGS 加 `certification_due_action: 'revoke'`

## 3. 路由

- [x] 3.1 admin 路由：`GET/POST /admin/certifications`、`GET /admin/certifications/:id`、`POST /admin/certifications/:id/items/:itemId/decision`、`POST /admin/certifications/:id/close`（cert:manage / cert:review + CSRF）

## 4. 前端

- [x] 4.1 admin.html"访问复审"页签：创建活动 + 明细/逐项 keep/revoke + 关闭 + 统计

## 5. 测试与回归

- [x] 5.1 新增 `/tmp/iam_test.sh` 第 34 节：创建→快照→keep→revoke 回收权限→关闭处置未审项→到期自动关闭→无权限 403→审计
- [x] 5.2 全量回归通过（预计 265 + 新增）