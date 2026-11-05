(function () {
  const api = window.BankAPI;
  const esc = window.escapeHtml;
  const money = window.formatMoney;

  const state = {
    user: null,
    tab: 'overview',
    transfers: { page: 1, search: '', status: '', currency: '' },
    receipts: { page: 1, search: '', status: '' },
    audit: { page: 1 },
  };

  const STATUS_LABELS = {
    accepted: 'مقبول',
    rejected: 'مرفوض',
    review: 'يحتاج مراجعة',
    processing: 'قيد المعالجة',
    error: 'خطأ',
    available: 'متاحة',
    linked: 'مرتبطة',
    flagged: 'معلّمة',
  };

  function badge(status) {
    const label = STATUS_LABELS[status] || status;
    return `<span class="badge ${esc(status)}">${esc(label)}</span>`;
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return esc(value);
    return d.toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' });
  }

  function setTable(table, headers, rows) {
    if (!rows.length) {
      table.innerHTML = `<tbody><tr><td class="empty">لا توجد بيانات</td></tr></tbody>`;
      return;
    }
    table.innerHTML = `
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
    `;
  }

  function renderPagination(container, data, onGo) {
    if (data.pages <= 1) {
      container.innerHTML = '';
      return;
    }
    const buttons = [];
    for (let i = 1; i <= data.pages; i++) {
      if (data.pages > 9 && Math.abs(i - data.page) > 2 && i !== 1 && i !== data.pages) continue;
      buttons.push(`<button data-page="${i}" class="${i === data.page ? 'active' : ''}">${i}</button>`);
    }
    container.innerHTML = buttons.join('');
    container.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => onGo(Number(b.dataset.page)));
    });
  }

  function showError(message) {
    const modal = document.getElementById('modal');
    document.getElementById('modal-body').innerHTML = `<p class="form-error">${esc(message)}</p>`;
    modal.hidden = false;
  }

  // ===== Overview =====
  async function loadOverview() {
    const data = await api.get('/stats/overview');
    document.getElementById('usd-rate-pill').textContent = `سعر الدولار: ${Number(data.usdRate).toFixed(2)} ريال`;

    const cards = [
      { label: 'إجمالي الحوالات', value: data.transfers.total, cls: 'info' },
      { label: 'حوالات متاحة', value: data.transfers.available, cls: '' },
      { label: 'حوالات مرتبطة', value: data.transfers.linked, cls: 'ok' },
      { label: 'إجمالي الإيصالات', value: data.receipts.total, cls: 'info' },
      { label: 'مقبولة', value: data.receipts.accepted, cls: 'ok' },
      { label: 'مرفوضة', value: data.receipts.rejected, cls: 'danger' },
      { label: 'تحتاج مراجعة', value: data.receipts.review, cls: 'warn' },
      { label: 'محاولات مكررة', value: data.attempts.total, cls: 'warn' },
      { label: 'إجمالي المقبول (ريال)', value: Number(data.receipts.sums.accepted || 0).toFixed(2), cls: 'ok' },
      { label: 'أحداث Webhook', value: data.webhookCount, cls: '' },
    ];

    document.getElementById('overview-cards').innerHTML = cards
      .map(
        (c) =>
          `<div class="card ${c.cls}"><span>${esc(c.label)}</span><strong>${esc(c.value)}</strong></div>`,
      )
      .join('');

    setTable(
      document.getElementById('recent-receipts'),
      ['#', 'المبلغ', 'المرسل', 'الحالة', 'التاريخ'],
      data.recentReceipts.map((r) => [
        esc(r.id),
        esc(money(r.amount, r.currency || 'SAR')),
        esc(r.sender_name || '—'),
        badge(r.status),
        formatDate(r.created_at),
      ]),
    );

    setTable(
      document.getElementById('recent-transfers'),
      ['#', 'المبلغ', 'المرسل', 'الحالة', 'التاريخ'],
      data.recentTransfers.map((t) => [
        esc(t.id),
        esc(money(t.amount, t.currency)),
        esc(t.sender_name || '—'),
        badge(t.status),
        formatDate(t.created_at),
      ]),
    );
  }

  // ===== Transfers =====
  async function loadTransfers(page) {
    state.transfers.page = page || state.transfers.page;
    const params = new URLSearchParams({
      page: state.transfers.page,
      limit: 20,
      search: state.transfers.search,
      status: state.transfers.status,
      currency: state.transfers.currency,
    });
    const data = await api.get(`/transfers?${params.toString()}`);

    setTable(
      document.getElementById('transfers-table'),
      ['#', 'المبلغ', 'بالريال', 'المرسل', 'المستفيد', 'رقم العملية', 'الحالة', 'التاريخ'],
      data.items.map((t) => [
        esc(t.id),
        esc(money(t.amount, t.currency)),
        esc(money(t.amount_sar, 'SAR')),
        esc(t.sender_name || '—'),
        esc(t.beneficiary_name || '—'),
        esc(t.operation_number || '—'),
        badge(t.status),
        formatDate(t.occurred_at || t.created_at),
      ]),
    );

    renderPagination(document.getElementById('transfers-pagination'), data, loadTransfers);
  }

  // ===== Receipts =====
  async function openReceipt(id) {
    const data = await api.get(`/receipts/${id}`);
    const r = data.receipt;
    const criteria = data.criteria;

    let criteriaHtml = '<p class="hint">لا تتوفر تفاصيل مطابقة.</p>';
    if (criteria && criteria.criteria) {
      criteriaHtml = criteria.criteria
        .map((c) => {
          const icon = c.status === 'match' ? '✅' : c.status === 'mismatch' ? '❌' : '⚠️';
          return `<div class="criteria-line">${icon} <strong>${esc(c.label)}</strong> — ${esc(c.detail)}</div>`;
        })
        .join('');
      if (criteria.reasons && criteria.reasons.length) {
        criteriaHtml += `<p class="hint">${criteria.reasons.map((x) => `• ${esc(x)}`).join('<br>')}</p>`;
      }
    }

    const actions =
      r.status === 'review'
        ? `<div style="display:flex;gap:8px;margin-top:16px">
             <button class="btn btn-ok" data-decision="accepted">قبول الإيصال</button>
             <button class="btn btn-danger" data-decision="rejected">رفض الإيصال</button>
           </div>`
        : '';

    document.getElementById('modal-body').innerHTML = `
      <h2>الإيصال #${esc(r.id)}</h2>
      <div class="detail-row"><span>الحالة</span><span>${badge(r.status)}</span></div>
      <div class="detail-row"><span>المبلغ</span><span>${esc(money(r.amount, r.currency || 'SAR'))}</span></div>
      <div class="detail-row"><span>بالريال</span><span>${esc(money(r.amount_sar, 'SAR'))}</span></div>
      <div class="detail-row"><span>المرسل</span><span>${esc(r.sender_name || '—')}</span></div>
      <div class="detail-row"><span>المستفيد</span><span>${esc(r.beneficiary_name || '—')}</span></div>
      <div class="detail-row"><span>رقم العملية</span><span>${esc(r.operation_number || '—')}</span></div>
      <div class="detail-row"><span>تاريخ الإيصال</span><span>${formatDate(r.occurred_at)}</span></div>
      <div class="detail-row"><span>المستخدم</span><span>${esc(r.discord_user_name || r.discord_user_id || '—')}</span></div>
      <div class="detail-row"><span>الحوالة المرتبطة</span><span>${r.transfer_id ? `#${esc(r.transfer_id)}` : '—'}</span></div>
      <div class="detail-row"><span>سبب القرار</span><span>${esc(r.reason || '—')}</span></div>
      <h3 style="margin-top:18px">تفاصيل المطابقة</h3>
      ${criteriaHtml}
      ${actions}
    `;

    const modal = document.getElementById('modal');
    modal.hidden = false;

    modal.querySelectorAll('[data-decision]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await api.post(`/receipts/${id}/review`, { decision: btn.dataset.decision });
          modal.hidden = true;
          await loadReceipts();
          await loadOverview();
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });
  }

  async function loadReceipts(page) {
    state.receipts.page = page || state.receipts.page;
    const params = new URLSearchParams({
      page: state.receipts.page,
      limit: 20,
      search: state.receipts.search,
      status: state.receipts.status,
    });
    const data = await api.get(`/receipts?${params.toString()}`);

    setTable(
      document.getElementById('receipts-table'),
      ['#', 'المبلغ', 'بالريال', 'المرسل', 'رقم العملية', 'الحالة', 'التاريخ', ''],
      data.items.map((r) => [
        esc(r.id),
        esc(money(r.amount, r.currency || 'SAR')),
        esc(money(r.amount_sar, 'SAR')),
        esc(r.sender_name || '—'),
        esc(r.operation_number || '—'),
        badge(r.status),
        formatDate(r.created_at),
        `<button class="btn btn-ghost btn-sm" data-receipt="${esc(r.id)}">تفاصيل</button>`,
      ]),
    );

    document.querySelectorAll('#receipts-table [data-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => openReceipt(btn.dataset.receipt).catch((e) => showError(e.message)));
    });

    renderPagination(document.getElementById('receipts-pagination'), data, loadReceipts);
  }

  // ===== Staff =====
  async function loadStaff() {
    const data = await api.get('/staff');
    setTable(
      document.getElementById('staff-table'),
      ['#', 'المستخدم', 'الصلاحية', 'الحالة', 'آخر دخول', 'إجراءات'],
      data.items.map((s) => [
        esc(s.id),
        esc(s.username),
        `<span class="badge ${esc(s.role)}">${s.role === 'admin' ? 'مدير' : 'موظف'}</span>`,
        `<span class="badge ${s.active ? 'active' : 'inactive'}">${s.active ? 'نشط' : 'معطّل'}</span>`,
        formatDate(s.last_login_at),
        `<button class="btn btn-ghost btn-sm" data-toggle="${esc(s.id)}" data-active="${s.active}">${s.active ? 'تعطيل' : 'تنشيط'}</button>
         <button class="btn btn-danger btn-sm" data-delete="${esc(s.id)}">حذف</button>`,
      ]),
    );

    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api.patch(`/staff/${btn.dataset.toggle}`, { active: btn.dataset.active === '1' ? false : true });
          await loadStaff();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    document.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('تأكيد حذف هذا الموظف؟')) return;
        try {
          await api.del(`/staff/${btn.dataset.delete}`);
          await loadStaff();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  // ===== Settings =====
  async function loadSettings() {
    const data = await api.get('/settings');
    const s = data.settings;
    document.getElementById('usd_rate').value = s.usd_rate ?? 3.75;
    document.getElementById('match_time_window_hours').value = s.match_time_window_hours ?? 48;
    document.getElementById('match_name_min_similarity').value = s.match_name_min_similarity ?? 0.6;
    document.getElementById('match_amount_tolerance_sar').value = s.match_amount_tolerance_sar ?? 0.01;

    const i = data.integrations;
    const rows = [
      ['Discord Bot', i.discord.configured ? 'مهيأ ✅' : 'غير مهيأ ❌'],
      ['Anthropic API', i.anthropic.configured ? `مهيأ ✅ (${i.anthropic.model})` : 'غير مهيأ ❌'],
      ['Webhook التوقيع', i.webhook.configured ? 'مهيأ ✅' : 'غير مهيأ ❌'],
      ['قناة الإيصالات', i.receiptChannel ? 'مهيأة ✅' : 'غير مهيأة ❌'],
      ['قناة المراجعة', i.reviewChannel ? 'مهيأة ✅' : 'غير مهيأة ❌'],
      ['رابط الـ Webhook', i.webhookUrl],
    ];

    setTable(
      document.getElementById('integrations-table'),
      ['البند', 'الحالة'],
      rows.map((r) => [esc(r[0]), esc(r[1])]),
    );
  }

  // ===== Audit =====
  async function loadAudit(page) {
    state.audit.page = page || state.audit.page;
    try {
      const data = await api.get(`/audit?page=${state.audit.page}&limit=30`);
      setTable(
        document.getElementById('audit-table'),
        ['#', 'المنفّذ', 'الإجراء', 'الهدف', 'التاريخ'],
        data.items.map((a) => [
          esc(a.id),
          esc(a.actor_name || a.actor_type),
          esc(a.action),
          esc(a.target_type ? `${a.target_type} #${a.target_id}` : '—'),
          formatDate(a.created_at),
        ]),
      );
      renderPagination(document.getElementById('audit-pagination'), data, loadAudit);
    } catch (err) {
      document.getElementById('audit-table').innerHTML =
        `<tbody><tr><td class="empty">${esc(err.message)}</td></tr></tbody>`;
    }
  }

  // ===== Tabs =====
  const loaders = {
    overview: loadOverview,
    transfers: () => loadTransfers(1),
    receipts: () => loadReceipts(1),
    staff: loadStaff,
    settings: loadSettings,
    audit: () => loadAudit(1),
  };

  const titles = {
    overview: 'نظرة عامة',
    transfers: 'الحوالات',
    receipts: 'الإيصالات',
    staff: 'الموظفون',
    settings: 'الإعدادات',
    audit: 'سجل العمليات',
  };

  async function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
    document.getElementById('page-title').textContent = titles[tab] || '';
    try {
      await loaders[tab]();
    } catch (err) {
      showError(err.message);
    }
  }

  // ===== Init =====
  async function init() {
    try {
      const me = await api.get('/auth/me');
      state.user = me.user;
      api.setCsrf(me.csrfToken);
      document.getElementById('current-user').textContent = me.user.username;

      if (me.user.role !== 'admin') {
        document.querySelector('[data-tab="staff"]').style.display = 'none';
        document.querySelector('[data-tab="audit"]').style.display = 'none';
      }
    } catch {
      window.location.href = '/';
      return;
    }

    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        /* ignore */
      }
      window.location.href = '/';
    });

    const closeModal = () => {
      document.getElementById('modal').hidden = true;
    };
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target.id === 'modal') closeModal();
    });

    document.getElementById('transfer-search').addEventListener('input', (e) => {
      state.transfers.search = e.target.value.trim();
    });
    document.getElementById('transfer-status').addEventListener('change', (e) => {
      state.transfers.status = e.target.value;
    });
    document.getElementById('transfer-currency').addEventListener('change', (e) => {
      state.transfers.currency = e.target.value;
    });
    document.getElementById('transfer-refresh').addEventListener('click', () => loadTransfers(1));

    document.getElementById('receipt-search').addEventListener('input', (e) => {
      state.receipts.search = e.target.value.trim();
    });
    document.getElementById('receipt-status').addEventListener('change', (e) => {
      state.receipts.status = e.target.value;
    });
    document.getElementById('receipt-refresh').addEventListener('click', () => loadReceipts(1));

    document.getElementById('staff-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('staff-error');
      errorEl.hidden = true;
      try {
        await api.post('/staff', {
          username: document.getElementById('staff-username').value.trim(),
          password: document.getElementById('staff-password').value,
          role: document.getElementById('staff-role').value,
          discordId: document.getElementById('staff-discord').value.trim() || null,
        });
        e.target.reset();
        await loadStaff();
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    });

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = document.getElementById('settings-error');
      errorEl.hidden = true;
      try {
        await api.put('/settings', {
          usd_rate: Number(document.getElementById('usd_rate').value),
          match_time_window_hours: Number(document.getElementById('match_time_window_hours').value),
          match_name_min_similarity: Number(document.getElementById('match_name_min_similarity').value),
          match_amount_tolerance_sar: Number(document.getElementById('match_amount_tolerance_sar').value),
        });
        await loadSettings();
        alert('تم حفظ الإعدادات');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      }
    });

    await switchTab('overview');
  }

  init();
})();