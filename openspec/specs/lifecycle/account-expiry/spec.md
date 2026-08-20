# lifecycle/account-expiry Specification

## Purpose
实现等保账户生命周期与日志留存控制：账户可设置有效期并到期自动禁用；审计日志可按配置周期自动清理，兼顾留存下限与合规删除。

## Requirements

### Requirement: 账户过期管理
系统为每个账户支持设置有效期（`account_expires_at`）。已过期账户拒绝登录，提示账户已过期并联系管理员；系统在登录/启动时惰性将过期账户自动置为禁用状态。管理员可查看用户有效期并设置/清除。

#### Scenario: 过期账户拒绝登录
- **WHEN** 用户尝试使用已过有效期的账户登录
- **THEN** 登录被拒绝（423），提示"账户已过期"，审计记录 `auth.login_expired`

#### Scenario: 过期账户自动禁用
- **WHEN** 系统执行惰性清理（登录触达或服务启动）
- **THEN** 过期且状态为 active 的账户被置为 disabled，审计记录 `user.auto_disable_expired`

#### Scenario: 管理员设置/清除有效期
- **WHEN** 管理员为用户设置或清除有效期
- **THEN** 保存成功，用户列表显示有效期；设置操作审计 `user.set_expiry`

#### Scenario: 未设有效期账户不受影响
- **WHEN** 用户账户未设置有效期
- **THEN** 按正常规则登录，不被过期逻辑拦截

### Requirement: 审计日志数据保留策略
系统支持配置审计日志留存周期 `audit_retention_days`（0=永久保留，默认 365 天）。审计写入时惰性清理超期日志。清理动作留痕。

#### Scenario: 配置留存周期
- **WHEN** 管理员在安全策略中设置留存天数
- **THEN** 保存生效，仅接受非负整数（0=永久）

#### Scenario: 超期日志自动清理
- **WHEN** 有新审计日志写入且配置了非零留存周期
- **THEN** 早于（当前时间-留存周期）的日志被删除（每次最多清理一批，避免大表一次性删除阻塞）

#### Scenario: 永久保留
- **WHEN** 留存周期为 0
- **THEN** 不执行清理
