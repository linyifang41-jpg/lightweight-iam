const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'iam.db');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const db = getDb();
  
  // 使用 IF NOT EXISTS，重启不会丢失数据
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      phone TEXT,
      password_hash TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email),
      UNIQUE(phone)
    );
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS permissions (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT,
      role_id TEXT,
      PRIMARY KEY (user_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id TEXT,
      permission_id TEXT,
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TABLE IF NOT EXISTS sod_rules (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('role', 'permission')),
      left_id TEXT NOT NULL,
      right_id TEXT NOT NULL,
      description TEXT,
      UNIQUE (type, left_id, right_id)
    );
    CREATE TABLE IF NOT EXISTS token_blacklist (
      jti TEXT PRIMARY KEY,
      exp INTEGER NOT NULL,
      user_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at DATETIME,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at DATETIME,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 安全策略配置（key-value）
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    -- 密码历史（防重用）
    CREATE TABLE IF NOT EXISTS password_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 登录会话（设备/IP/UA 记录、强制下线、并发控制）
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      jti TEXT,
      refresh_jti TEXT,
      device TEXT,
      device_id TEXT,
      ip TEXT,
      user_agent TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      revoked_at DATETIME,
      revoked_by TEXT
    );
    -- 组织架构/部门
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      parent_id TEXT
    );
    -- 用户组
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT,
      user_id TEXT,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS group_roles (
      group_id TEXT,
      role_id TEXT,
      PRIMARY KEY (group_id, role_id)
    );
    -- 凭据保险库（密码保险库雏形：加密存储特权账号凭据）
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system TEXT,
      username TEXT,
      encrypted_password TEXT NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- OIDC 客户端注册
    CREATE TABLE IF NOT EXISTS oidc_clients (
      id TEXT PRIMARY KEY,
      client_id TEXT UNIQUE NOT NULL,
      client_secret_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- OIDC 授权码（一次性、短有效期）
    CREATE TABLE IF NOT EXISTS oidc_auth_codes (
      code TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      nonce TEXT,
      expires_at DATETIME NOT NULL,
      used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- ABAC 用户扩展属性（key-value）
    CREATE TABLE IF NOT EXISTS user_attributes (
      user_id TEXT NOT NULL,
      attr_key TEXT NOT NULL,
      attr_value TEXT,
      PRIMARY KEY (user_id, attr_key)
    );
    -- ABAC 策略规则（属性授权）
    CREATE TABLE IF NOT EXISTS abac_policies (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      resource_type TEXT NOT NULL,
      effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      conditions TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 访问请求与审批流（IGA：自助申请→多级审批→自动赋权）
    CREATE TABLE IF NOT EXISTS access_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_ids TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      approval_levels INTEGER NOT NULL DEFAULT 1,
      approvals_count INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      decided_at DATETIME,
      decided_by TEXT
    );
    -- 服务账号（非人类身份：client_id/secret + 短期令牌）
    CREATE TABLE IF NOT EXISTS service_accounts (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      client_id TEXT UNIQUE NOT NULL,
      client_secret_hash TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      permissions TEXT NOT NULL,
      ver INTEGER DEFAULT 1,
      token_ttl_minutes INTEGER DEFAULT 15,
      owner_id TEXT,
      expires_at TEXT,
      last_used_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 访问复审活动（Access Certification）
    CREATE TABLE IF NOT EXISTS certifications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      scope_type TEXT NOT NULL,
      scope_value TEXT NOT NULL,
      due_date TEXT,
      auto_action TEXT NOT NULL DEFAULT 'revoke',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS certification_items (
      id TEXT PRIMARY KEY,
      certification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      role_id TEXT NOT NULL,
      role_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at DATETIME,
      note TEXT
    );
    -- 工作流引擎：定义 / 实例 / 待办
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      definition TEXT NOT NULL,
      active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS workflow_instances (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      current_index INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'running',
      data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    );
    CREATE TABLE IF NOT EXISTS workflow_tasks (
      id TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      node_index INTEGER NOT NULL,
      node_name TEXT,
      assignee_type TEXT NOT NULL,
      assignee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decided_by TEXT,
      decided_at DATETIME,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 即时访问（JIT）：限时临时提权
    CREATE TABLE IF NOT EXISTS temporary_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      reason TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT,
      granted_by TEXT,
      granted_at DATETIME,
      expires_at TEXT,
      decided_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 应急访问（Break-glass）：免审批 + 强认证 + 事后审查
    CREATE TABLE IF NOT EXISTS breakglass_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      reason TEXT,
      duration_minutes INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'started',
      role_id TEXT,
      role_name TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      ended_by TEXT,
      reviewed_by TEXT,
      review_note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- 特权账号发现与登记
    CREATE TABLE IF NOT EXISTS privileged_accounts (
      id TEXT PRIMARY KEY,
      account_type TEXT NOT NULL,
      ref_user_id TEXT,
      ref_sa_id TEXT,
      display_name TEXT,
      owner TEXT,
      risk_level TEXT DEFAULT 'medium',
      reason TEXT,
      status TEXT DEFAULT 'active',
      source TEXT DEFAULT 'manual',
      credential_id TEXT,
      last_review_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME
    );
    -- Webhook 事件流订阅
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '*',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      last_sent_at DATETIME,
      last_status TEXT,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

// 迁移：为已存在的表补充新字段（幂等，检查列是否存在）
function migrate() {
  const db = getDb();
  const addColumnIfMissing = (table, name, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    }
  };
  addColumnIfMissing('users', 'email_verified', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'phone_verified', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'totp_secret', 'TEXT');
  addColumnIfMissing('users', 'totp_enabled', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'failed_attempts', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'locked_until', 'DATETIME');
  addColumnIfMissing('users', 'must_change_password', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'password_changed_at', 'DATETIME');
  addColumnIfMissing('users', 'department_id', 'TEXT');
  addColumnIfMissing('token_blacklist', 'user_id', 'TEXT');
  addColumnIfMissing('sessions', 'device_id', 'TEXT');
  addColumnIfMissing('users', 'recovery_codes', 'TEXT');
  addColumnIfMissing('users', 'recovery_generated_at', 'DATETIME');
  addColumnIfMissing('users', 'realm', "TEXT DEFAULT 'default'");
  addColumnIfMissing('users', 'account_expires_at', 'TEXT');
  addColumnIfMissing('users', 'is_seed', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'password_login_allowed', 'INTEGER DEFAULT 1');
  // 多租户：内联 UNIQUE(username) 无法 DROP；或历史重建丢失 DEFAULT 时，用完整 schema 重建 users 表
  const indexList = db.prepare("PRAGMA index_list('users')").all();
  const legacyUsernameIdx = indexList.filter(i => i.unique).find(i => {
    const cols = db.prepare(`PRAGMA index_info('${i.name}')`).all();
    return cols.length === 1 && cols[0].name === 'username';
  });
  const statusCol = db.prepare("PRAGMA table_info('users')").all().find(c => c.name === 'status');
  if (legacyUsernameIdx || (statusCol && statusCol.dflt_value === null)) {
    db.pragma('foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        password_hash TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_verified INTEGER DEFAULT 0,
        phone_verified INTEGER DEFAULT 0,
        totp_secret TEXT,
        totp_enabled INTEGER DEFAULT 0,
        failed_attempts INTEGER DEFAULT 0,
        locked_until DATETIME,
        must_change_password INTEGER DEFAULT 0,
        password_changed_at DATETIME,
        department_id TEXT,
        recovery_codes TEXT,
        recovery_generated_at DATETIME,
        realm TEXT DEFAULT 'default',
        UNIQUE (username, realm),
        UNIQUE (email),
        UNIQUE (phone)
      )`);
      db.exec('INSERT INTO users_new (id, username, email, phone, password_hash, status, created_at, email_verified, phone_verified, totp_secret, totp_enabled, failed_attempts, locked_until, must_change_password, password_changed_at, department_id, recovery_codes, recovery_generated_at, realm) SELECT id, username, email, phone, password_hash, COALESCE(status, \'active\'), created_at, email_verified, phone_verified, totp_secret, totp_enabled, failed_attempts, locked_until, must_change_password, password_changed_at, department_id, recovery_codes, recovery_generated_at, COALESCE(realm, \'default\') FROM users');
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_new RENAME TO users');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_realm ON users (username, realm)");
}

// 种子数据：默认角色、权限、管理员账号、安全策略（幂等，不覆盖已有数据）
function seedData() {
  const db = getDb();
  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');

  // 默认权限
  const permissions = ['user:manage', 'role:manage', 'audit:view', 'group:manage', 'dept:manage', 'session:manage', 'policy:manage', 'credential:manage', 'ledger:view', 'oidc:manage', 'abac:manage', 'approval:manage', 'sa:manage', 'gov:manage', 'cert:manage', 'cert:review', 'workflow:manage', 'analytics:view', 'breakglass:use', 'breakglass:manage', 'pam:manage', 'webhook:manage'];
  for (const name of permissions) {
    db.prepare('INSERT OR IGNORE INTO permissions (id, name) VALUES (?, ?)').run(uuidv4(), name);
  }

  // 管理员角色（拥有所有权限）
  db.prepare('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)')
    .run(uuidv4(), 'admin', '系统管理员');
  const adminRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('admin');
  const allPerms = db.prepare('SELECT id FROM permissions').all();
  for (const perm of allPerms) {
    db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)')
      .run(adminRole.id, perm.id);
  }

  // 普通用户角色（默认角色）
  db.prepare('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)')
    .run(uuidv4(), 'user', '普通用户');

  // 默认安全策略
  const defaultSettings = {
    min_password_length: '8',
    require_letter: '1',
    require_number: '1',
    require_special: '0',
    password_history_count: '3',
    password_max_age_days: '0',
    max_sessions_per_user: '0',
    session_idle_timeout_minutes: '15',
    login_fail_lock_count: '5',
    login_fail_lock_minutes: '15',
    approval_levels: '1',
    default_account_policy: '0',
    certification_due_action: 'revoke',
    workflow_engine_enabled: '0',
    jit_max_minutes: '480',
    jit_enabled: '1',
    analytics_inactive_days: '90',
    analytics_sensitive_perms: 'cert:manage,credential:manage,oidc:manage,sa:manage,gov:manage,policy:manage,role:manage,approval:manage,dept:manage,group:manage,session:manage,abac:manage,workflow:manage,analytics:view',
    analytics_perm_threshold: '15',
    analytics_min_support: '2',
    breakglass_enabled: '1',
    breakglass_duration: '30',
    breakglass_role_id: ''
  };
  const upsertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaultSettings)) {
    upsertSetting.run(k, v);
  }

  // 默认管理员账号 admin / Admin123
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!existingAdmin) {
    const passwordHash = bcrypt.hashSync('Admin123', 10);
    const adminUserId = uuidv4();
    db.prepare('INSERT INTO users (id, username, password_hash, status, password_changed_at) VALUES (?, ?, ?, ?, ?)')
      .run(adminUserId, 'admin', passwordHash, 'active', new Date().toISOString());
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
      .run(adminUserId, adminRole.id);
    // 记录初始密码历史
    db.prepare('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)')
      .run(adminUserId, passwordHash);
  } else {
    // 保证已有 admin 账号拥有管理员角色
    const hasRole = db.prepare('SELECT * FROM user_roles WHERE user_id = ? AND role_id = ?')
      .get(existingAdmin.id, adminRole.id);
    if (!hasRole) {
      db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(existingAdmin.id, adminRole.id);
    }
  }
  // 标记内置种子账户（默认账户治理）
  db.prepare("UPDATE users SET is_seed = 1 WHERE username = 'admin'").run();

  // 预置关联应用 OIDC 客户端（与 config.oidcClients 保持一致，幂等）
  const { hashSecret } = require('../services/oidc.service');
  const demoClients = [
    { clientId: 'appA', secret: 'appA-dev-secret', name: '员工门户（OIDC）', redirectUri: 'http://localhost:8081/oidc/callback' },
    { clientId: 'appB', secret: 'appB-dev-secret', name: '项目管理系统（OIDC）', redirectUri: 'http://localhost:8082/oidc/callback' },
  ];
  for (const c of demoClients) {
    db.prepare('INSERT OR IGNORE INTO oidc_clients (id, client_id, client_secret_hash, name, redirect_uris) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), c.clientId, hashSecret(c.secret), c.name, JSON.stringify([c.redirectUri]));
  }
}

module.exports = { getDb, initDatabase, seedData, migrate };