# compliance/audit-retention Specification

## Purpose
TBD - created by archiving change account-lifecycle-and-retention. Update Purpose after archive.

## Requirements

### Requirement: 数据保留策略配置
系统安全策略新增 `audit_retention_days`（审计日志留存天数，0=永久保留，默认 365）。管理端安全策略页可配置，非法值（负数/非数字）拒绝。

#### Scenario: 配置留存周期
- **WHEN** 管理员在安全策略中设置留存天数
- **THEN** 保存生效，仅接受非负整数（0=永久）

#### Scenario: 超期日志自动清理
- **WHEN** 有新审计日志写入且配置了非零留存周期
- **THEN** 早于（当前时间-留存周期）的日志被删除（每次最多清理 5000 条，避免大表一次性删除阻塞）

#### Scenario: 永久保留
- **WHEN** 留存周期为 0
- **THEN** 不执行清理
