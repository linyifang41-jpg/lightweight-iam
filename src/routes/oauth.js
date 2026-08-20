const express = require('express');
const serviceAccountService = require('../services/service-account.service');
const oidcService = require('../services/oidc.service');
const tokenService = require('../services/token.service');
const auditService = require('../services/audit.service');
const { safeVerify } = require('../utils/jwt');

// OAuth2 令牌端点（本批仅 client_credentials 授权模式，RFC 6749 错误格式）
const router = express.Router();

router.post('/token', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const { grant_type: grantType, client_id: clientId, client_secret: clientSecret, scope } = req.body;
    if (grantType !== 'client_credentials') {
      return res.status(400).json({ error: 'unsupported_grant_type', error_description: '本端点仅支持 client_credentials' });
    }
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'invalid_request', error_description: '缺少 client_id 或 client_secret' });
    }
    const result = await serviceAccountService.issueToken({ clientId, clientSecret, scope });
    if (result.error) {
      auditService.log({ userId: null, username: clientId || null, action: 'sa.auth_failed', ip: req.ip, detail: { clientId } });
      return res.status(result.status).json({ error: result.error, error_description: '客户端凭据无效' });
    }
    auditService.log({ userId: null, username: result.name || null, action: 'sa.token_issue', ip: req.ip, detail: { clientId, scope: scope || null, expires_in: result.expires_in } });
    res.json({ access_token: result.access_token, token_type: result.token_type, expires_in: result.expires_in });
  } catch (e) {
    res.status(500).json({ error: 'server_error', error_description: e.message });
  }
});

const urlencoded = express.urlencoded({ extended: false });

function decodeToken(token) {
  return safeVerify(token);
}

// RFC 7009 令牌吊销：按 token（可带 token_type_hint）吊销，未知/无效同样返回 200
router.post('/revoke', urlencoded, async (req, res) => {
  const { token, token_type_hint, client_id } = req.body;
  const decoded = token ? decodeToken(token) : null;
  let kind = null;
  if (decoded) {
    if (token_type_hint === 'access_token' || decoded.type === 'access' || decoded.type === 'client') kind = 'access';
    else if (token_type_hint === 'refresh_token' || decoded.type === 'refresh') kind = 'refresh';
  }
  if (decoded && decoded.jti) {
    await tokenService.revoke(decoded);
  }
  auditService.log({ userId: null, username: client_id || null, action: 'oauth.revoke', ip: req.ip, detail: { tokenType: kind || 'unknown' } });
  res.status(200).json({});
});

// RFC 7662 令牌检视：调用方须通过客户端认证（OIDC client_id+secret 或有效 Bearer 令牌）
async function introspectAuthorize(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const at = decodeToken(auth.slice(7));
    if (at && (at.type === 'access' || at.type === 'client') && !tokenService.isRevoked(at)) {
      return { via: at.type === 'client' ? 'client_token' : 'access_token', subject: at.userId || at.sub };
    }
    return null;
  }
  const { client_id, client_secret } = req.body;
  if (client_id && client_secret) {
    const c = oidcService.verifyClient(client_id, client_secret);
    if (c) return { via: 'client_credentials', clientId: c.clientId };
  }
  return null;
}

router.post('/introspect', urlencoded, async (req, res) => {
  try {
    const authz = await introspectAuthorize(req);
    if (!authz) return res.status(401).json({ error: 'invalid_client', error_description: '客户端认证失败' });

    const { token } = req.body;
    const decoded = token ? decodeToken(token) : null;
    const response = { active: false };
    if (decoded) {
      const revoked = tokenService.isRevoked(decoded);
      if (!revoked) {
        if (decoded.type === 'access') {
          Object.assign(response, {
            active: true,
            sub: decoded.userId,
            username: decoded.username || null,
            token_type: 'Bearer',
            scope: null,
            iat: decoded.iat,
            exp: decoded.exp,
          });
        } else if (decoded.type === 'client') {
          Object.assign(response, {
            active: true,
            sub: decoded.sub,
            name: decoded.name || null,
            token_type: 'Bearer',
            scope: decoded.scope || null,
            iat: decoded.iat,
            exp: decoded.exp,
          });
        } else if (decoded.type === 'refresh') {
          Object.assign(response, {
            active: true,
            sub: decoded.userId,
            token_type: 'refresh_token',
            iat: decoded.iat,
            exp: decoded.exp,
          });
        }
      }
    }
    auditService.log({ userId: null, username: authz.via === 'client_credentials' ? authz.clientId : null, action: 'oauth.introspect', ip: req.ip, detail: { via: authz.via, active: response.active } });
    res.json(response);
  } catch (e) {
    res.status(500).json({ error: 'server_error', error_description: e.message });
  }
});

module.exports = router;