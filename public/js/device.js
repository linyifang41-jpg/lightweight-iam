// 设备标识：首次访问在 localStorage 生成并持久化，
// 用于登录时标识"同一设备"，同一设备重复登录复用一个会话
(function () {
  const KEY = 'iam_device_id';
  window.getDeviceId = function () {
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (e) {
      return 'dev-' + Date.now().toString(36);
    }
  };
})();