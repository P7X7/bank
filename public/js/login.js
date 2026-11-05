(function () {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول...';

    try {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const data = await window.BankAPI.post('/auth/login', { username, password });
      window.BankAPI.setCsrf(data.csrfToken);
      window.location.href = '/dashboard.html';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'تسجيل الدخول';
    }
  });
})();