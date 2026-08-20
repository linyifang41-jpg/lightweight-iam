## Purpose
预留多租户（Realm）基础能力：用户归属租户、登录/注册按租户隔离，默认租户行为完全兼容，为后续租户管理、数据隔离与租户管理员批次打基础。

## ADDED Requirements

### Requirement: Realm 字段预留
系统为每个用户记录所属租户（realm），默认租户为 `default`。现有用户自动归属默认租户，原有登录/注册行为不变。

#### Scenario: 现有用户归属默认租户
- **WHEN** 系统升级后查询存量用户
- **THEN** 其 realm 均为 `default`，可用原账号密码正常登录

#### Scenario: 新建用户默认租户
- **WHEN** 注册请求未携带 realm
- **THEN** 用户归属默认租户 `default`

### Requirement: 按租户隔离登录
登录接口接受 realm 参数，账号查找限定在指定租户内。不同租户可存在相同用户名，互不影响。未指定 realm 时默认查默认租户。

#### Scenario: 同用户名跨租户隔离
- **WHEN** 租户 A 与租户 B 各有用户 `zhangsan`，分别以正确密码在各自租户登录
- **THEN** 各自登录成功；在对方租户用对方密码登录则失败

#### Scenario: 租户不匹配登录失败
- **WHEN** 用户 `zhangsan` 在租户 A，以租户 B 身份登录
- **THEN** 返回"账号或密码错误"（账号不存在提示统一，防枚举）

### Requirement: 按租户隔离注册
注册接口接受 realm 参数，用户名唯一性限定在指定租户内。

#### Scenario: 同用户名可在不同租户注册
- **WHEN** 租户 B 注册 `zhangsan`，而租户 A 已存在 `zhangsan`
- **THEN** 注册成功（不冲突）

### Requirement: 租户标识规范
realm 仅允许字母、数字、连字符与下划线，长度 2-32；保留名 `default`。非法 realm 拒绝。

#### Scenario: 非法租户名拒绝
- **WHEN** 注册/登录携带非法 realm（如含空格或非法字符）
- **THEN** 返回错误提示

### Requirement: 跨租户管理（超管）
管理端用户列表不按 realm 过滤，超级管理员可查看全部租户用户（租户管理员等细化权限后续批次实现）。

#### Scenario: 超管可见全租户用户
- **WHEN** 管理员查看用户列表
- **THEN** 可见包含不同 realm 的全部用户