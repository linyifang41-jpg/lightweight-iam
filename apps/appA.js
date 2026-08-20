// 应用 A - 内部员工门户（RP 端，端口 8081，通过标准 OIDC 接入 IAM）
const config = require('../config');
const { createOIDCApp } = require('./oidc-client');
const { createAppPage } = require('./template');

const oidc = config.oidcClients.appA;

const app = createOIDCApp({
  appName: '员工门户',
  clientId: oidc.clientId,
  clientSecret: oidc.clientSecret,
  redirectUri: oidc.redirectUri,
  localCookie: 'appA_session',
});

const PORT = config.ports.appA;

app.get('/', (req, res) => {
  res.send(createAppPage({
    title: '员工门户',
    icon: '🏢',
    themeColor: '#2563eb',
    background: '#f0f4f8',
    accent: '#2563eb',
    bannerText: `欢迎 ${req.oidcUser.username}！你通过 OIDC 标准协议（Authorization Code 流程）由 IAM 认证后进入本系统。`,
    cards: [
      { icon: '🔐', title: '认证方式', desc: 'OIDC Authorization Code + id_token 校验' },
      { icon: '💼', title: '我的任务', desc: '分配给我的工作任务' },
      { icon: '📢', title: '公司公告', desc: '最新内部通知' },
    ],
    links: [
      { url: config.urls.appB, text: '🚀 访问关联系统：项目管理系统 →' },
    ],
    username: req.oidcUser.username,
  }));
});

// 显示当前用户信息（API）
app.get('/api/me', (req, res) => {
  res.json({ user: req.oidcUser, app: '员工门户', sso: true, via: 'oidc' });
});

app.listen(PORT, () => {
  console.log(`应用A (员工门户, OIDC): http://localhost:${PORT}`);
});