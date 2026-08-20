const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');

// ABAC 策略决策点（PDP）：基于属性（用户/资源/上下文）做访问控制
// 决策语义：deny 优先于 allow；无命中返回 default（由调用方按 RBAC 兜底）

const LHS_RE = /^(user\.attr\.[A-Za-z0-9_-]+|user\.(username|status|realm|department)|resource\.[A-Za-z0-9._-]+|context\.(now|ip))$/;
const OPS = ['eq', 'ne', 'in', 'contains', 'exists', 'gt', 'ge', 'lt', 'le'];
const EFFECTS = ['allow', 'deny'];

function getBuiltinUserAttrs(user) {
  const db = getDb();
  let department = '';
  if (user.department_id) {
    const d = db.prepare('SELECT name FROM departments WHERE id = ?').get(user.department_id);
    department = d ? d.name : '';
  }
  return {
    username: user.username,
    status: user.status,
    realm: user.realm || 'default',
    department
  };
}

function getExtendedAttrs(userId) {
  const rows = getDb().prepare('SELECT attr_key, attr_value FROM user_attributes WHERE user_id = ?').all(userId);
  const m = {};
  for (const r of rows) m[r.attr_key] = r.attr_value;
  return m;
}

function resolveLhs(lhs, ctx) {
  const seg = lhs.split('.');
  if (seg[0] === 'user') {
    if (seg[1] === 'attr') {
      return ctx.user.attr[seg.slice(2).join('.')];
    }
    return ctx.user[seg[1]];
  }
  if (seg[0] === 'resource') {
    return seg.slice(1).reduce((o, k) => (o == null ? undefined : o[k]), ctx.resource);
  }
  if (seg[0] === 'context') {
    return ctx.context[seg[1]];
  }
  return undefined;
}

function toNum(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function evalCondition(c, ctx) {
  const value = resolveLhs(c.lhs, ctx);
  const rhs = c.rhs;
  switch (c.op) {
    case 'eq': return String(value ?? '') === String(rhs ?? '');
    case 'ne': return String(value ?? '') !== String(rhs ?? '');
    case 'in': return Array.isArray(rhs) && rhs.map(String).includes(String(value ?? ''));
    case 'contains': return typeof value === 'string' && value.includes(String(rhs ?? ''));
    case 'exists': return value !== undefined && value !== null && value !== '';
    case 'gt': {
      const a = toNum(value), b = toNum(rhs);
      return a !== null && b !== null ? a > b : String(value ?? '') > String(rhs ?? '');
    }
    case 'ge': {
      const a = toNum(value), b = toNum(rhs);
      return a !== null && b !== null ? a >= b : String(value ?? '') >= String(rhs ?? '');
    }
    case 'lt': {
      const a = toNum(value), b = toNum(rhs);
      return a !== null && b !== null ? a < b : String(value ?? '') < String(rhs ?? '');
    }
    case 'le': {
      const a = toNum(value), b = toNum(rhs);
      return a !== null && b !== null ? a <= b : String(value ?? '') <= String(rhs ?? '');
    }
    default: return false;
  }
}

function evalConditions(conditions, ctx) {
  if (!Array.isArray(conditions) || !conditions.length) return true;
  return conditions.every(c => evalCondition(c, ctx));
}

// 策略字段校验（创建/更新共用）
function validatePolicy({ name, resourceType, effect, priority, enabled, conditions }) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('策略名称不能为空');
  if (typeof resourceType !== 'string' || !resourceType.trim()) throw new Error('资源类型不能为空');
  if (!EFFECTS.includes(effect)) throw new Error('effect 只能是 allow 或 deny');
  if (priority !== undefined && priority !== null && (!Number.isInteger(Number(priority)) || Number(priority) < -100000 || Number(priority) > 100000)) {
    throw new Error('priority 必须是整数');
  }
  if (!Array.isArray(conditions)) throw new Error('conditions 必须是数组');
  for (const c of conditions) {
    if (!c || typeof c !== 'object' || typeof c.lhs !== 'string' || !LHS_RE.test(c.lhs)) {
      throw new Error(`非法条件字段 lhs：${c && c.lhs}`);
    }
    if (!OPS.includes(c.op)) throw new Error(`非法操作符 op：${c.op}`);
    if (c.op !== 'exists' && c.rhs === undefined) throw new Error(`条件 ${c.lhs} ${c.op} 缺少 rhs 值`);
    if ((c.op === 'in') && !Array.isArray(c.rhs)) throw new Error('in 操作的 rhs 必须为数组');
  }
  return true;
}

function normalizePolicy(input) {
  return {
    name: String(input.name || '').trim(),
    description: input.description ? String(input.description).trim() : null,
    resourceType: String(input.resourceType || '').trim(),
    effect: input.effect,
    priority: input.priority === undefined || input.priority === null ? 0 : Number(input.priority),
    enabled: input.enabled === undefined ? 1 : (input.enabled ? 1 : 0),
    conditions: Array.isArray(input.conditions) ? input.conditions : []
  };
}

// 策略决策
function authorize({ userId, action, resourceType, resource, ip }) {
  const db = getDb();
  const user = db.prepare('SELECT id, username, status, realm, department_id FROM users WHERE id = ?').get(userId);
  if (!user) return { decision: 'default', allowed: true, matchedRule: null };

  const ctx = {
    action: action || '',
    resourceType: resourceType || '',
    resource: resource || {},
    context: { now: new Date().toISOString(), ip: ip || '' },
    user: { ...getBuiltinUserAttrs(user), attr: getExtendedAttrs(userId) }
  };

  const policies = db.prepare("SELECT * FROM abac_policies WHERE enabled = 1 AND (resource_type = ? OR resource_type = '*')")
    .all(resourceType || '');
  const hits = [];
  for (const p of policies) {
    let conditions;
    try { conditions = JSON.parse(p.conditions || '[]'); } catch { conditions = []; }
    if (evalConditions(conditions, ctx)) hits.push(p);
  }
  const denies = hits.filter(p => p.effect === 'deny').sort((a, b) => b.priority - a.priority);
  const allows = hits.filter(p => p.effect === 'allow').sort((a, b) => b.priority - a.priority);
  if (denies.length) {
    return { decision: 'deny', allowed: false, matchedRule: { id: denies[0].id, name: denies[0].name, effect: 'deny' } };
  }
  if (allows.length) {
    return { decision: 'allow', allowed: true, matchedRule: { id: allows[0].id, name: allows[0].name, effect: 'allow' } };
  }
  return { decision: 'default', allowed: true, matchedRule: null };
}

// 策略 CRUD
function listPolicies() {
  return getDb().prepare('SELECT * FROM abac_policies ORDER BY resource_type, priority DESC, created_at').all()
    .map(p => ({ ...p, conditions: JSON.parse(p.conditions || '[]') }));
}

function getPolicy(id) {
  const p = getDb().prepare('SELECT * FROM abac_policies WHERE id = ?').get(id);
  if (!p) return null;
  return { ...p, conditions: JSON.parse(p.conditions || '[]') };
}

function createPolicy(input) {
  const p = normalizePolicy(input);
  validatePolicy(p);
  const db = getDb();
  if (db.prepare('SELECT id FROM abac_policies WHERE name = ?').get(p.name)) {
    throw new Error('策略名称已存在');
  }
  const id = uuidv4();
  db.prepare('INSERT INTO abac_policies (id, name, description, resource_type, effect, priority, enabled, conditions, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, p.name, p.description, p.resourceType, p.effect, p.priority, p.enabled, JSON.stringify(p.conditions), new Date().toISOString(), new Date().toISOString());
  return getPolicy(id);
}

function updatePolicy(id, input) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM abac_policies WHERE id = ?').get(id);
  if (!existing) throw new Error('策略不存在');
  const merged = {
    name: input.name !== undefined ? input.name : existing.name,
    description: input.description !== undefined ? input.description : existing.description,
    resourceType: input.resourceType !== undefined ? input.resourceType : existing.resource_type,
    effect: input.effect !== undefined ? input.effect : existing.effect,
    priority: input.priority !== undefined ? input.priority : existing.priority,
    enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
    conditions: input.conditions !== undefined ? input.conditions : JSON.parse(existing.conditions || '[]')
  };
  const p = normalizePolicy(merged);
  validatePolicy(p);
  const dup = db.prepare('SELECT id FROM abac_policies WHERE name = ? AND id != ?').get(p.name, id);
  if (dup) throw new Error('策略名称已存在');
  db.prepare('UPDATE abac_policies SET name = ?, description = ?, resource_type = ?, effect = ?, priority = ?, enabled = ?, conditions = ?, updated_at = ? WHERE id = ?')
    .run(p.name, p.description, p.resourceType, p.effect, p.priority, p.enabled, JSON.stringify(p.conditions), new Date().toISOString(), id);
  return getPolicy(id);
}

function deletePolicy(id) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM abac_policies WHERE id = ?').get(id)) throw new Error('策略不存在');
  db.prepare('DELETE FROM abac_policies WHERE id = ?').run(id);
  return { success: true };
}

// 用户扩展属性
function setUserAttributes(userId, attributes) {
  const db = getDb();
  if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw new Error('用户不存在');
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new Error('attributes 必须是对象');
  }
  const entries = Object.entries(attributes).filter(([k]) => /^[A-Za-z0-9_-]{1,64}$/.test(k));
  if (entries.length !== Object.keys(attributes).length) {
    throw new Error('属性键仅允许字母、数字、连字符、下划线');
  }
  db.prepare('DELETE FROM user_attributes WHERE user_id = ?').run(userId);
  const stmt = db.prepare('INSERT OR REPLACE INTO user_attributes (user_id, attr_key, attr_value) VALUES (?, ?, ?)');
  for (const [k, v] of entries) stmt.run(userId, k, String(v ?? ''));
  return { success: true, attributes: getExtendedAttrs(userId) };
}

function getUserAttributes(userId) {
  const user = getDb().prepare('SELECT id, username, status, realm, department_id FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  return { ...getBuiltinUserAttrs(user), attr: getExtendedAttrs(userId) };
}

module.exports = {
  authorize,
  listPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  setUserAttributes,
  getUserAttributes,
  evalCondition
};