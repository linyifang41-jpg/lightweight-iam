// 关联应用公共页面模板
// appA / appB 共用同一套页面结构，通过参数区分品牌/内容

function createAppPage({ title, icon, themeColor, background, accent, bannerText, cards, links, username }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: ${background}; margin: 0; }
    .nav { background: ${themeColor}; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
    .nav h1 { margin: 0; font-size: 20px; }
    .nav .user { font-size: 14px; opacity: 0.9; }
    .container { max-width: 900px; margin: 40px auto; padding: 0 20px; }
    .banner { background: #f8f9fa; border: 1px solid #e9ecef; color: #333; padding: 16px 20px; border-radius: 8px; margin-bottom: 30px; }
    .banner strong { display: block; margin-bottom: 4px; color: ${themeColor}; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
    .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border: 1px solid #e5e7eb; }
    .card h3 { margin: 0 0 8px; color: #333; }
    .card p { margin: 0; color: #666; font-size: 14px; }
    .links a { color: ${accent}; text-decoration: none; margin-right: 20px; }
  </style>
</head>
<body>
  <div class="nav">
    <h1>${icon} ${title}</h1>
    <div class="user">👤 ${username} <a href="/logout" style="color:white;margin-left:15px;">退出</a></div>
  </div>
  <div class="container">
    <div class="banner">
      <strong>✅ 已通过 SSO 自动登录，无需再次输入账号密码</strong>
      ${bannerText}
    </div>
    <div class="cards">
      ${cards.map(c => `<div class="card"><h3>${c.icon} ${c.title}</h3><p>${c.desc}</p></div>`).join('')}
    </div>
    <div style="margin-top:30px;" class="links">${links.map(l => `<a href="${l.url}">${l.text}</a>`).join(' ')}</div>
  </div>
</body>
</html>`;
}

module.exports = { createAppPage };