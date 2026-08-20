const express = require('express');
const crypto = require('crypto');
const policyService = require('../services/policy.service');
const adminService = require('../services/admin.service');
const userService = require('../services/user.service');
const tokenService = require('../services/token.service');
const sessionService = require('../services/session.service');
const auditService = require('../services/audit.service');

const router = express.Router();

const SCIM_CORE = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';

function scimError(res, status, detail) {
  return res.status(status).json({
    schemas: [SCIM_ERROR],
    detail,
    status: String(status)
  });
}

function requireScimToken(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path === '/ServiceProviderConfig') {
    return next();
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const expected = policyService.getSetting('scim_token');
  if (!expected || !token || token !== expected) {
    auditService.log({ userId: null, username: null, action: 'scim.auth_failed', ip: req.ip, detail: { path: req.path } });
    return scimError(res, 401, 'SCIM 认证失败：无效或缺失 Bearer token');
  }
  next();
}

router.use(requireScimToken);

function toScimUser(u) {
  return {
    schemas: [SCIM_CORE],
    id: u.id,
    userName: u.username,
    active: u.status === 'active',
    emails: u.email ? [{ value: u.email, primary: true }] : [],
    phoneNumbers: u.phone ? [{ value: u.phone, primary: true }] : [],
    meta: {
      resourceType: 'User',
      created: u.created_at,
      lastModified: u.created_at
    }
  };
}

// ServiceProviderConfig：能力声明
router.get('/ServiceProviderConfig', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{
      name: 'OAuth Bearer Token',
      description: 'Authentication Scheme using the Bearer Token Standard',
      specUri: 'https://tools.ietf.org/html/rfc6750',
      type: 'oauthbearertoken'
    }]
  });
});

router.get('/ResourceTypes', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
    totalResults: 1,
    Resources: [{
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      schema: SCIM_CORE,
      schemaExtensions: []
    }]
  });
});

router.get('/Schemas', (req, res) => {
  res.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
    totalResults: 1,
    Resources: [{
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'],
      id: SCIM_CORE,
      name: 'User',
      attributes: [
        { name: 'userName', type: 'string', required: true, mutability: 'readWrite' },
        { name: 'emails', type: 'complex', multiValued: true },
        { name: 'phoneNumbers', type: 'complex', multiValued: true },
        { name: 'active', type: 'boolean' }
      ]
    }]
  });
});

// 查询用户（支持 filter=userName eq ... / id eq ...）
router.get('/Users', (req, res) => {
  const filter = req.query.filter || '';
  const startIndex = parseInt(req.query.startIndex, 10) || 1;
  const count = req.query.count ? parseInt(req.query.count, 10) : 100;
  let users = adminService.listUsers();
  const m = filter.match(/^userName eq "([^"]+)"$/i) || filter.match(/^userName eq '([^']+)'$/i);
  const idm = filter.match(/^id eq "([^"]+)"$/i);
  if (m) {
    users = users.filter(u => u.username === m[1]);
  } else if (idm) {
    users = users.filter(u => u.id === idm[1]);
  }
  const total = users.length;
  const page = users.slice(startIndex - 1, startIndex - 1 + count);
  res.json({
    schemas: [SCIM_LIST],
    totalResults: total,
    startIndex,
    itemsPerPage: page.length,
    Resources: page.map(toScimUser)
  });
});

router.get('/Users/:id', (req, res) => {
  const u = adminService.listUsers().find(x => x.id === req.params.id);
  if (!u) return scimError(res, 404, '用户不存在');
  res.json(toScimUser(u));
});

// 创建用户
router.post('/Users', async (req, res) => {
  try {
    const body = req.body || {};
    const userName = body.userName;
    if (!userName) return scimError(res, 400, 'userName 必填');
    const email = (body.emails && body.emails[0] && body.emails[0].value) || null;
    const phone = (body.phoneNumbers && body.phoneNumbers[0] && body.phoneNumbers[0].value) || null;
    const active = body.active !== false;
    const existing = await userService.findByUsername(userName);
    if (existing) return scimError(res, 409, 'userName 已存在');
    let password;
    if (body.password) {
      const pwdCheck = policyService.validatePassword(body.password);
      if (!pwdCheck.valid) return scimError(res, 400, `密码不符合策略：${pwdCheck.reason}`);
      password = body.password;
    } else {
      password = crypto.randomBytes(12).toString('base64url');
      while (!policyService.validatePassword(password).valid) {
        password = crypto.randomBytes(12).toString('base64url');
      }
    }
    const user = adminService.createUserByAdmin({ username: userName, email, phone, password });
    if (!active) {
      adminService.setUserStatus(user.id, 'disabled');
    }
    if (!body.password) {
      userService.setMustChangePassword(user.id, 1);
    }
    auditService.log({ userId: null, username: null, action: 'scim.user.create', ip: req.ip, detail: { target: userName } });
    res.status(201).json(toScimUser({ ...user, status: active ? 'active' : 'disabled' }));
  } catch (e) {
    scimError(res, 400, e.message);
  }
});

// 全量替换
router.put('/Users/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const u = adminService.listUsers().find(x => x.id === req.params.id);
    if (!u) return scimError(res, 404, '用户不存在');
    const email = (body.emails && body.emails[0] && body.emails[0].value) || null;
    const phone = (body.phoneNumbers && body.phoneNumbers[0] && body.phoneNumbers[0].value) || null;
    if (body.userName && body.userName !== u.username) {
      const dup = await userService.findByUsername(body.userName);
      if (dup && dup.id !== u.id) return scimError(res, 409, 'userName 已存在');
      userService.renameUser(u.id, body.userName);
    }
    userService.updateProfile(u.id, { email, phone });
    if (body.active !== undefined) {
      adminService.setUserStatus(u.id, body.active ? 'active' : 'disabled');
    }
    auditService.log({ userId: null, username: null, action: 'scim.user.update', ip: req.ip, detail: { target: u.username } });
    res.json(toScimUser({ ...u, username: body.userName || u.username, email, phone, status: body.active !== false ? 'active' : 'disabled' }));
  } catch (e) {
    scimError(res, 400, e.message);
  }
});

// 增量更新
router.patch('/Users/:id', async (req, res) => {
  try {
    const body = req.body || {};
    const u = adminService.listUsers().find(x => x.id === req.params.id);
    if (!u) return scimError(res, 404, '用户不存在');
    let status = u.status;
    if (body.active !== undefined) {
      adminService.setUserStatus(u.id, body.active ? 'active' : 'disabled');
      status = body.active ? 'active' : 'disabled';
    }
    if (body.userName && body.userName !== u.username) {
      const dup = await userService.findByUsername(body.userName);
      if (dup && dup.id !== u.id) return scimError(res, 409, 'userName 已存在');
      userService.renameUser(u.id, body.userName);
      u.username = body.userName;
    }
    if (body.emails && body.emails[0] && body.emails[0].value) {
      userService.updateProfile(u.id, { email: body.emails[0].value });
      u.email = body.emails[0].value;
    }
    if (body.phoneNumbers && body.phoneNumbers[0] && body.phoneNumbers[0].value) {
      userService.updateProfile(u.id, { phone: body.phoneNumbers[0].value });
      u.phone = body.phoneNumbers[0].value;
    }
    auditService.log({ userId: null, username: null, action: 'scim.user.update', ip: req.ip, detail: { target: u.username } });
    res.json(toScimUser({ ...u, status }));
  } catch (e) {
    scimError(res, 400, e.message);
  }
});

// 删除用户
router.delete('/Users/:id', (req, res) => {
  try {
    const u = adminService.listUsers().find(x => x.id === req.params.id);
    if (!u) return scimError(res, 404, '用户不存在');
    adminService.deleteUser(u.id);
    auditService.log({ userId: null, username: null, action: 'scim.user.delete', ip: req.ip, detail: { target: u.username } });
    res.status(204).end();
  } catch (e) {
    scimError(res, 400, e.message);
  }
});

module.exports = router;