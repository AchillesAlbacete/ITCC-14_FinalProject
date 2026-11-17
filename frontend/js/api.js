/* Freight-Flow Express — shared frontend runtime (included by every page in /frontend)
 *
 *   FF.apiFetch(endpoint, options)  -> JSON from the live Express/MongoDB API (auto toasts on 409 / 422 / network errors)
 *   FF.session                      -> active demo user + role, persisted in localStorage
 *   FF.mountShell({ page, roles })  -> sidebar + top bar + Customer|Manager|Courier|CSR role switcher
 *   FF.toast / FF.confirm / FF.badge / FF.peso / FF.date / FF.stepper / FF.esc
 */
(function () {
  'use strict';
  const FF = (window.FF = {});

  // ---------------------------------------------------------------------------
  // Tailwind Play CDN theme (loaded before this script on every page)
  // ---------------------------------------------------------------------------
  if (window.tailwind) {
    window.tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'ui-monospace', 'monospace'] },
          colors: { navy: '#0F172A', royal: '#2563EB', slatebg: '#F8FAFC', line: '#E2E8F0' },
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Storage helpers (localStorage can throw in private mode)
  // ---------------------------------------------------------------------------
  const store = {
    get(key, fallback = null) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  // ---------------------------------------------------------------------------
  // API base: relative "/api" when served by Express, absolute http://localhost:3000/api otherwise
  // (file://, Live Server on :5500, ...). Override with localStorage.ff_api_base = '"https://host/api"'.
  // ---------------------------------------------------------------------------
  FF.apiBase = (function () {
    const override = store.get('ff_api_base');
    if (override) return String(override).replace(/\/$/, '');
    const { protocol, hostname, port } = window.location;
    if (protocol === 'file:') return 'http://localhost:3000/api';
    const local = hostname === 'localhost' || hostname === '127.0.0.1';
    if (local && port && port !== '3000') return 'http://localhost:3000/api';
    return '/api';
  })();

  // ---------------------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------------------
  FF.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  FF.peso = (n) => '₱' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  FF.date = (iso, withTime = true) => {
    if (!iso) return '—';
    const opts = withTime
      ? { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: '2-digit' };
    return new Date(iso).toLocaleString('en-PH', opts);
  };
  FF.icons = () => { if (window.lucide) window.lucide.createIcons(); };
  FF.$ = (id) => document.getElementById(id);
  FF.debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // Status -> badge color (semantic palette)
  const BADGE = {
    emerald: ['Paid', 'Confirmed', 'Delivered', 'Resolved', 'Active', 'Open'],
    amber: ['Pending', 'Booked', 'In Transit', 'Out for Delivery', 'Investigating'],
    rose: ['Voided', 'Failed', 'Cancelled'],
    slate: ['Dismissed'],
  };
  FF.badgeClass = (status) => {
    for (const [color, list] of Object.entries(BADGE)) if (list.includes(status)) return 'badge-' + color;
    return 'badge-slate';
  };
  FF.badge = (status, extra = '') => `<span class="badge ${FF.badgeClass(status)} ${extra}">${FF.esc(status)}</span>`;

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------
  const TOAST_ICON = { success: ['circle-check', 'text-emerald-600'], error: ['circle-x', 'text-rose-600'], warning: ['triangle-alert', 'text-amber-600'], info: ['info', 'text-blue-600'] };
  FF.toast = function (message, kind = 'success', opts = {}) {
    let box = document.getElementById('ff-toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ff-toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const [icon, color] = TOAST_ICON[kind] || TOAST_ICON.info;
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const details = (opts.details || []).map((d) => `<li>${FF.esc(d)}</li>`).join('');
    el.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5 mt-0.5 shrink-0 ${color}"></i>
      <div class="min-w-0 flex-1"><div class="t-title">${FF.esc(opts.title || message)}</div>
      ${opts.title ? `<div class="t-body">${FF.esc(message)}</div>` : ''}${details ? `<ul class="t-body">${details}</ul>` : ''}</div>`;
    box.appendChild(el);
    FF.icons();
    setTimeout(() => el.remove(), opts.duration || (kind === 'error' || kind === 'warning' ? 7000 : 4500));
  };

  // ---------------------------------------------------------------------------
  // apiFetch — the only place pages talk to the backend
  //   options: { method, body (object -> JSON), query (object), silent (no error toast), success (toast text) }
  //   resolves JSON (null for 204); rejects with FF.ApiError { status, code, message, details }
  // ---------------------------------------------------------------------------
  class ApiError extends Error {
    constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details || []; }
  }
  FF.ApiError = ApiError;

  FF.apiFetch = async function (endpoint, options = {}) {
    const { query, body, silent, success, headers, ...rest } = options;
    const method = (rest.method || 'GET').toUpperCase();
    let url = FF.apiBase + (endpoint.startsWith('/') ? endpoint : '/' + endpoint);
    if (query) {
      const qs = new URLSearchParams();
      Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') qs.append(k, v); });
      if ([...qs].length) url += (url.includes('?') ? '&' : '?') + qs.toString();
    }
    const init = { ...rest, method, headers: { Accept: 'application/json', ...(headers || {}) } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (networkErr) {
      const err = new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the Freight-Flow API. Is the server running on http://localhost:3000?');
      if (!silent) FF.toast(err.message, 'error', { title: 'Server unreachable' });
      throw err;
    }

    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch (e) { /* non-JSON body */ } }

    if (!res.ok) {
      const err = new ApiError(res.status, data?.code || 'ERROR', data?.message || `Request failed (${res.status})`, data?.details);
      if (!silent) {
        if (res.status === 409) FF.toast(err.message, 'warning', { title: 'Action blocked (409 Conflict)' });
        else if (res.status === 422) FF.toast(err.message === 'Validation failed.' ? 'Please fix the highlighted fields.' : err.message, 'error',
          { title: 'Validation error (422)', details: err.details.map((d) => d.issue) });
        else if (res.status === 404) FF.toast(err.message, 'error', { title: 'Not found' });
        else FF.toast(err.message, 'error', { title: `Request failed (${res.status})` });
      }
      throw err;
    }
    if (success) FF.toast(success, 'success');
    return data;
  };
  FF.api = {
    get: (p, query, o) => FF.apiFetch(p, { ...o, query }),
    post: (p, body, o) => FF.apiFetch(p, { ...o, method: 'POST', body }),
    put: (p, body, o) => FF.apiFetch(p, { ...o, method: 'PUT', body }),
    patch: (p, body, o) => FF.apiFetch(p, { ...o, method: 'PATCH', body }),
    del: (p, o) => FF.apiFetch(p, { ...o, method: 'DELETE' }),
  };
  // Field-level errors from a 422 -> { field: issue }
  FF.fieldErrors = (err) => Object.fromEntries((err.details || []).map((d) => [d.field, d.issue]));

  // ---------------------------------------------------------------------------
  // Session: demo role + identity, persisted in localStorage
  // ---------------------------------------------------------------------------
  const ROLES = ['Customer', 'Manager', 'Courier', 'CSR'];
  const ROLE_HOME = { Customer: 'booking.html', Manager: 'payments.html', Courier: 'courier.html', CSR: 'complaints.html' };
  // Seeded demo identities (see backend/seed.js)
  const DEMO = { customer_id: 502, staff: { Manager: 1, Courier: 5, CSR: 8 } };
  const KEY = 'ff_session';

  FF.ROLES = ROLES;
  FF.ROLE_HOME = ROLE_HOME;
  FF.session = {
    raw() { return store.get(KEY, {}) || {}; },
    get() {
      const s = this.raw();
      const role = ROLES.includes(s.role) ? s.role : 'Customer';
      return {
        role,
        customer_id: s.customer_id || DEMO.customer_id,
        staff_id: role === 'Customer' ? null : (s.staff_ids && s.staff_ids[role]) || DEMO.staff[role],
        signedIn: !!s.signedIn,
      };
    },
    setRole(role) { if (ROLES.includes(role)) store.set(KEY, { ...this.raw(), role }); },
    // Real customer login/registration: remember who they are and make them the active Customer
    loginCustomer(customer) { store.set(KEY, { ...this.raw(), role: 'Customer', customer_id: customer.customer_id, signedIn: true }); },
    // Demo staff sign-in from the login page
    loginStaff(role, staff_id) { const s = this.raw(); store.set(KEY, { ...s, role, signedIn: true, staff_ids: { ...(s.staff_ids || {}), [role]: staff_id } }); },
    signOut() { store.remove(KEY); },
  };

  // Current user (name, branch, initials) for the top bar and page logic. Cached per page load.
  let userPromise;
  FF.currentUser = function () {
    if (userPromise) return userPromise;
    const s = FF.session.get();
    userPromise = (async () => {
      try {
        if (s.role === 'Customer') {
          const c = await FF.apiFetch('/customers/' + s.customer_id, { silent: true });
          return { ...s, kind: 'customer', name: c.name, subtitle: `${c.account_type} Account`, record: c };
        }
        const st = await FF.apiFetch('/staff/' + s.staff_id, { silent: true });
        let branch = '';
        try { branch = (await FF.apiFetch('/branches/' + st.branch_id, { silent: true })).branch_name; } catch (e) { /* optional */ }
        return { ...s, kind: 'staff', name: st.name, subtitle: [st.role === 'Customer Service Representative' ? 'CSR' : st.role, branch].filter(Boolean).join(' • '), record: st };
      } catch (e) {
        return { ...s, kind: s.role === 'Customer' ? 'customer' : 'staff', name: s.role === 'Customer' ? 'Customer' : s.role, subtitle: 'Offline', record: null };
      }
    })();
    return userPromise;
  };
  const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  // ---------------------------------------------------------------------------
  // Shell: sidebar + top bar. Pages provide <div id="ff-sidebar"> and <div id="ff-topbar">.
  // ---------------------------------------------------------------------------
  const NAV = {
    Customer: [
      ['shipments.html', 'My Shipments', 'package-search'],
      ['booking.html', 'New Booking', 'package-plus'],
      ['complaints.html', 'Complaints', 'message-square-warning'],
      ['profile.html', 'Profile', 'user-round'],
    ],
    Manager: [
      ['dashboard.html', 'Dashboard', 'layout-dashboard'],
      ['payments.html', 'Payments', 'credit-card'],
      ['admin-network.html', 'Branches & Staff', 'network'],
      ['complaints.html', 'Complaints', 'message-square-warning'],
    ],
    Courier: [['courier.html', 'My Deliveries', 'truck']],
    CSR: [['complaints.html', 'Complaint Desk', 'message-square-warning']],
  };
  FF.NAV = NAV;

  FF.mountShell = function ({ page, roles } = {}) {
    page = page || (location.pathname.split('/').pop() || 'index.html');

    // Demo-friendly guard: opening a page that the active role can't use switches to the page's primary role
    let role = FF.session.get().role;
    if (roles && roles.length && !roles.includes(role)) { role = roles[0]; FF.session.setRole(role); }

    const links = NAV[role].map(([href, label, icon]) =>
      `<a href="${href}" class="nav-link ${href === page ? 'active' : ''}" ${href === page ? 'aria-current="page"' : ''}><i data-lucide="${icon}" class="w-5 h-5"></i> ${label}</a>`).join('');

    const sidebar = FF.$('ff-sidebar');
    if (sidebar) {
      sidebar.outerHTML = `
        <aside id="ff-sidebar" class="fixed inset-y-0 left-0 z-40 w-64 -translate-x-full lg:translate-x-0 transition-transform bg-navy text-white flex flex-col">
          <div class="px-6 py-6 flex items-center gap-3">
            <div class="w-9 h-9 rounded-xl bg-royal grid place-items-center"><i data-lucide="truck" class="w-5 h-5"></i></div>
            <div class="leading-tight"><div class="font-extrabold tracking-tight">FREIGHT—FLOW</div><div class="text-[11px] tracking-[0.2em] text-slate-400">EXPRESS</div></div>
          </div>
          <nav class="px-4 mt-2 space-y-1 flex-1" aria-label="${role} navigation">${links}</nav>
          <div class="px-4 pb-6"><a href="index.html" id="ff-signout" class="nav-link"><i data-lucide="log-out" class="w-5 h-5"></i> Sign out</a></div>
        </aside>
        <div id="ff-scrim" class="fixed inset-0 z-30 bg-slate-900/50 hidden lg:hidden"></div>`;
    }

    const pills = ROLES.map((r) =>
      `<a href="${ROLE_HOME[r]}" data-role="${r}" class="${r === role ? 'active' : ''}" ${r === role ? 'aria-current="true"' : ''}>${r}</a>`).join('');
    const top = FF.$('ff-topbar');
    if (top) {
      top.outerHTML = `
        <header id="ff-topbar" class="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-line">
          <div class="px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
            <button id="ff-menu" class="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100" aria-label="Open navigation" aria-controls="ff-sidebar" aria-expanded="false"><i data-lucide="menu" class="w-5 h-5"></i></button>
            <div class="role-pill flex items-center gap-1 bg-slate-100 border border-line rounded-full p-1" role="navigation" aria-label="Demo role switcher">${pills}</div>
            <a href="${role === 'Customer' ? 'profile.html' : '#'}" id="ff-user" class="flex items-center gap-3 rounded-full pl-1 pr-3 py-1 hover:bg-slate-100">
              <span id="ff-avatar" class="w-8 h-8 rounded-full bg-royal text-white grid place-items-center text-xs font-bold">…</span>
              <span class="hidden sm:block text-sm leading-tight"><span id="ff-user-name" class="block font-semibold">Loading…</span><span id="ff-user-sub" class="block text-xs text-slate-500">&nbsp;</span></span>
            </a>
          </div>
        </header>`;
    }

    // Role switcher: remember the role, then let the link navigate to that role's home page
    document.querySelectorAll('.role-pill a').forEach((a) => a.addEventListener('click', () => FF.session.setRole(a.dataset.role)));
    const so = FF.$('ff-signout');
    if (so) so.addEventListener('click', () => FF.session.signOut());

    // Mobile menu
    const sb = FF.$('ff-sidebar'), scrim = FF.$('ff-scrim'), btn = FF.$('ff-menu');
    const toggle = (open) => { sb.classList.toggle('-translate-x-full', !open); scrim.classList.toggle('hidden', !open); btn.setAttribute('aria-expanded', String(open)); };
    if (btn && sb && scrim) {
      btn.addEventListener('click', () => toggle(sb.classList.contains('-translate-x-full')));
      scrim.addEventListener('click', () => toggle(false));
    }

    FF.icons();
    FF.currentUser().then((u) => {
      const set = (id, v) => { const el = FF.$(id); if (el) el.textContent = v; };
      set('ff-avatar', initials(u.name));
      set('ff-user-name', u.name);
      set('ff-user-sub', u.subtitle);
    });
    return FF.session.get();
  };

  // ---------------------------------------------------------------------------
  // Modal helpers (focus trap, Esc, backdrop click)
  // ---------------------------------------------------------------------------
  FF.openModal = function ({ html, position = 'center', wide = false, onClose } = {}) {
    const previous = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = `ff-overlay ${position}`;
    const panel = document.createElement('div');
    panel.className = position === 'right' ? 'ff-drawer' : `ff-modal ${wide ? 'wide' : ''}`;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    FF.icons();

    const focusables = () => [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((e) => !e.disabled);
    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      if (previous && document.contains(previous)) previous.focus();
      if (onClose) onClose(result);
    };
    function onKey(e) {
      if (e.key === 'Escape') return close(false);
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(false); });
    panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(false)));
    const first = panel.querySelector('[data-autofocus]') || focusables()[0];
    if (first) first.focus();
    return { panel, overlay, close };
  };

  // Promise-based confirmation dialog. `html` (trusted markup) or `message` (plain text).
  FF.confirm = function ({ title, message, html, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, icon } = {}) {
    return new Promise((resolve) => {
      const ic = icon || (danger ? 'octagon-alert' : 'circle-help');
      const tone = danger ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-royal';
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const m = FF.openModal({
        html: `<div class="flex items-start gap-4">
            <div class="w-11 h-11 rounded-xl ${tone} grid place-items-center shrink-0"><i data-lucide="${ic}" class="w-5 h-5"></i></div>
            <div><h2 class="text-lg font-bold">${FF.esc(title)}</h2><div class="text-sm text-slate-600 mt-2 leading-relaxed">${html || FF.esc(message)}</div></div>
          </div>
          <div class="mt-6 flex justify-end gap-3">
            <button type="button" class="btn btn-outline" data-close data-autofocus>${FF.esc(cancelLabel)}</button>
            <button type="button" id="ff-confirm-ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${FF.esc(confirmLabel)}</button>
          </div>`,
        onClose: (r) => done(r === true),
      });
      m.panel.querySelector('#ff-confirm-ok').addEventListener('click', () => { done(true); m.close(true); });
    });
  };

  // ---------------------------------------------------------------------------
  // Parcel progress stepper markup: Pending -> Booked -> In Transit -> Out for Delivery -> Delivered
  // ---------------------------------------------------------------------------
  const STEPS = [
    ['Pending', 'Awaiting payment verification'],
    ['Booked', 'Payment verified'],
    ['In Transit', 'On the road to the destination hub'],
    ['Out for Delivery', 'Courier is heading to the receiver'],
    ['Delivered', 'Handed over to the receiver'],
  ];
  FF.STEPS = STEPS.map((s) => s[0]);
  // status: parcel current_status. "Failed" is shown on the step it failed at (Out for Delivery).
  FF.stepper = function (status, notes = {}) {
    const failed = status === 'Failed';
    const idx = failed ? 3 : STEPS.findIndex((s) => s[0] === status);
    return STEPS.map(([name, sub], i) => {
      const state = i < idx ? 'done' : i === idx ? 'current' : 'upcoming';
      const cls = [state, i === idx && i === STEPS.length - 1 ? 'final' : '', i === idx && failed ? 'failed' : ''].join(' ');
      const icon = failed && i === idx ? 'x' : state === 'done' || (state === 'current' && i === STEPS.length - 1) ? 'check' : state === 'current' ? 'loader' : 'circle';
      const title = failed && i === idx ? 'Delivery Failed' : name;
      return `<li class="step ${cls}" ${state === 'current' ? 'aria-current="step"' : ''}>
        <span class="step-dot"><i data-lucide="${icon}" class="w-3.5 h-3.5"></i></span>
        <div class="step-title">${FF.esc(title)}</div><div class="step-sub">${FF.esc(notes[i] || (failed && i === idx ? 'Delivery attempt failed — will be retried' : sub))}</div></li>`;
    }).join('');
  };

  // Booking shipping fee (₱100.00 base + ₱20.20/kg), in cents to avoid float drift
  FF.shippingFeeCents = (kg) => 10000 + Math.round(Number(kg) * 2020);

  document.addEventListener('DOMContentLoaded', FF.icons);
})();
