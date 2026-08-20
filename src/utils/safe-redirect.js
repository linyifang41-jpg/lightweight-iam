// 安全重定向工具：防止 open redirect 攻击（OWASP）
// 登录/刷新后的回跳地址只允许跳转到已注册的关联系统，杜绝任意跳转
const config = require('../../config');

// 允许跳转的完整主机列表（从配置的关联系统 URL 提取）
function getAllowedHosts() {
  const hosts = new Set();
  for (const url of config.getCorsOrigin()) {
    try {
      hosts.add(new URL(url).host);
    } catch (e) {}
  }
  return hosts;
}

// 校验 redirect 目标是否安全
// 返回 true 表示可跳转，否则应回退到默认地址
function isSafeRedirect(redirect) {
  if (!redirect) return false;

  // 仅允许相对路径（站内跳转）
  if (redirect.startsWith('/') && !redirect.startsWith('//')) {
    return true;
  }

  // 绝对 URL：必须匹配白名单域名
  try {
    const parsed = new URL(redirect);
    const allowed = getAllowedHosts();
    return allowed.has(parsed.host);
  } catch (e) {
    return false;
  }
}

// 取得安全的回跳地址，非法时回退到默认值
function safeRedirect(redirect, fallback = '/') {
  return isSafeRedirect(redirect) ? redirect : fallback;
}

module.exports = { isSafeRedirect, safeRedirect, getAllowedHosts };