## 1. 服务

- [x] 1.1 `lifecycle.service.js`：`join()`（建用户+组+角色+部门+改密）、`move()`（部门+增删组/角色）、`leave()`（状态+移除角色+移出组+吊销会话/token）

## 2. 路由

- [x] 2.1 `admin.js`：`POST /admin/lifecycle/join|move|leave`（user:manage + csrf），审计三事件

## 3. 前端

- [x] 3.1 `admin.html`：生命周期页签（入职/转岗/离职表单 + 消息区）

## 4. 测试与回归

- [x] 4.1 新增 `/tmp/iam_test.sh` 第 27 节：join 成功+改密+重复报错 → move 换部门+加角色 → leave disabled 后登录被拒+会话吊销
- [x] 4.2 全量回归通过（预计 98 + 新增）