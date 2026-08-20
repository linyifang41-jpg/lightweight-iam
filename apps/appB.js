// 应用 B - 项目管理系统（RP 端，端口 8082，通过标准 OIDC 接入 IAM）
const config = require('../config');
const { createOIDCApp } = require('./oidc-client');
const { createAppPage } = require('./template');

const oidc = config.oidcClients.appB;

const app = createOIDCApp({
  appName: '项目管理系统',
  clientId: oidc.clientId,
  clientSecret: oidc.clientSecret,
  redirectUri: oidc.redirectUri,
  localCookie: 'appB_session',
});

const PORT = config.ports.appB;

app.get('/', (req, res) => {
  res.send(createAppPage({
    title: '项目管理系统',
    icon: '📊',
    themeColor: '#16a34a',
    background: '#f0fdf4',
    accent: '#16a34a',
    bannerText: `欢迎 ${req.oidcUser.username}！本系统同样通过 OIDC 标准协议接入 IAM，登录一次即可访问。`,
    cards: [
      { icon: '🔐', title: '认证方式', desc: 'OIDC Authorization Code + id_token 校验' },
      { icon: '✅', title: '我的任务', desc: '项目任务分配' },
      { icon: '📈', title: '项目进度', desc: '里程碑与进度报告' },
    ],
    links: [
      { url: config.urls.appA, text: '🚀 返回员工门户 →' },
    ],
    username: req.oidcUser.username,
  }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.oidcUser, app: '项目管理系统', sso: true, via: 'oidc' });
});

app.listen(PORT, () => {
  console.log(`应用B (项目管理系统, OIDC): http://localhost:${PORT}`);
});