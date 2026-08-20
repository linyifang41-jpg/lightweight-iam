const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { initDatabase, seedData, migrate } = require('./models/database');
const authRoutes = require('./routes/auth');
const ssoRoutes = require('./routes/sso');
const adminRoutes = require('./routes/admin');
const oidcRoutes = require('./routes/oidc');
const scimRoutes = require('./routes/scim');
const authzRoutes = require('./routes/authz');
const oauthRoutes = require('./routes/oauth');
const userService = require('./services/user.service');

const app = express();
const PORT = config.ports.iam;

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

initDatabase();
migrate();
seedData();

// CORS 配置：只允许已知的域名
const corsOptions = {
  origin: config.getCorsOrigin(),
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// 静态文件
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', authRoutes);
app.use('/sso', ssoRoutes);
app.use('/admin', adminRoutes);
app.use(oidcRoutes);
app.use('/scim/v2', scimRoutes);
app.use(authzRoutes);
app.use('/oauth', oauthRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`IAM Server (SSO IdP): http://localhost:${PORT}`);
  // 启动时惰性清理过期账户
  const expired = userService.autoDisableExpired();
  if (expired.length) {
    console.log(`[清理] 已自动禁用 ${expired.length} 个过期账户`);
  }
});