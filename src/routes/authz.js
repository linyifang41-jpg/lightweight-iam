const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const authzService = require('../services/authz.service');
const auditService = require('../services/audit.service');

const router = express.Router();

// ABAC 决策点：登录态可调用，返回 allow/deny/default
router.post('/authz/check', authMiddleware, (req, res) => {
  try {
    const { action, resourceType, resource } = req.body || {};
    if (!resourceType) return res.status(400).json({ error: '缺少 resourceType' });
    const result = authzService.authorize({
      userId: req.user.id,
      action,
      resourceType,
      resource: resource || {},
      ip: req.ip
    });
    auditService.log({ userId: req.user.id, username: req.user.username, action: 'abac.check', ip: req.ip, detail: { action, resourceType, decision: result.decision } });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;