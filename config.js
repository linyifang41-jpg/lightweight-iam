// 统一配置模块
require('dotenv').config();

const config = {
  // 服务端口
  ports: {
    iam: parseInt(process.env.IAM_PORT) || 8080,
    appA: parseInt(process.env.APP_A_PORT) || 8081,
    appB: parseInt(process.env.APP_B_PORT) || 8082,
  },

  // 服务地址
  urls: {
    iam: process.env.IAM_URL || 'http://localhost:8080',
    appA: process.env.APP_A_URL || 'http://localhost:8081',
    appB: process.env.APP_B_URL || 'http://localhost:8082',
  },

  // JWT 配置
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret-change-me',
    // access token 短有效期，通过 refresh token 续期
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '30m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // 数据库
  db: {
    path: process.env.DB_PATH || './data/iam.db',
  },

  // SSO
  sso: {
    cookieName: 'sso_token',
    refreshCookieName: 'refresh_token',
    csrfCookieName: 'csrf_token',
    cookieMaxAge: 30 * 60 * 1000, // access token 30分钟
    refreshCookieMaxAge: 7 * 24 * 60 * 60 * 1000, // refresh token 7天
    // 所有关联应用的本地会话 cookie，登出时统一清除（实现单点登出）
    appSessions: ['appA_session', 'appB_session'],
  },

  // 关联应用的 OIDC 客户端配置（与 database.js 中预置的客户端保持一致）
  oidcClients: {
    appA: {
      clientId: process.env.APP_A_OIDC_CLIENT_ID || 'appA',
      clientSecret: process.env.APP_A_OIDC_SECRET || 'appA-dev-secret',
      redirectUri: `${process.env.APP_A_URL || 'http://localhost:8081'}/oidc/callback`,
    },
    appB: {
      clientId: process.env.APP_B_OIDC_CLIENT_ID || 'appB',
      clientSecret: process.env.APP_B_OIDC_SECRET || 'appB-dev-secret',
      redirectUri: `${process.env.APP_B_URL || 'http://localhost:8082'}/oidc/callback`,
    },
  },

  // CORS 允许的域名
  corsOrigin: null, // 在 getCorsOrigin 中计算

  // 限流阈值（可通过环境变量覆盖，便于测试/调优）
  rateLimit: {
    loginMax: parseInt(process.env.IAM_LOGIN_RATE_MAX) || 5,
    registerMax: parseInt(process.env.IAM_REGISTER_RATE_MAX) || 3,
  },
};

// 根据 URL 自动计算 CORS 允许的域名列表
function getCorsOrigin() {
  if (config.corsOrigin) return config.corsOrigin;
  const { urls } = config;
  const originSet = new Set([urls.iam, urls.appA, urls.appB]);
  config.corsOrigin = [...originSet];
  return config.corsOrigin;
}

config.getCorsOrigin = getCorsOrigin;

module.exports = config;