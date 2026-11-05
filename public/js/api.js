(function () {
  const state = { csrf: null };

  async function request(path, options) {
    const opts = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, options || {});
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (state.csrf) opts.headers['x-csrf-token'] = state.csrf;

    const res = await fetch(`/api${path}`, opts);
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      window.location.href = '/';
      throw new Error('غير مصرح');
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) throw new Error(data.error || `خطأ (${res.status})`);
    return data;
  }

  window.BankAPI = {
    setCsrf(token) {
      state.csrf = token;
    },
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body: body || {} }),
    put: (path, body) => request(path, { method: 'PUT', body: body || {} }),
    patch: (path, body) => request(path, { method: 'PATCH', body: body || {} }),
    del: (path) => request(path, { method: 'DELETE' }),
  };

  window.escapeHtml = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  window.formatMoney = function (amount, currency) {
    const v = Number(amount || 0);
    return `${v.toFixed(2)} ${currency === 'USD' ? 'دولار' : 'ريال'}`;
  };
})();