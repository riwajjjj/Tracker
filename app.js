'use strict';

/* =========================================================
   Expense Tracker: app logic
   All data is saved in this browser (localStorage).
   ========================================================= */

const STORE_KEY = 'expense-tracker-v1';
// Inspired by Nepali prayer flags: cobalt, red, green, yellow, plus supporting tones
const PALETTE = ['#FF7A30', '#23A455', '#2B59C3', '#8C9BFF', '#7B4BC4', '#D63384', '#E63946',
    '#F2B705', '#12A4B5', '#5C7CFA', '#B5651D', '#94A3B8', '#00A86B', '#C2185B', '#3F8EFC'];
const OLD_PALETTE = ['#2A9D8F', '#E76F51', '#6C63FF', '#F4A261', '#264653', '#E63946', '#52B788',
    '#8E7DBE', '#E9B824', '#3A86FF', '#FF6B9A', '#8D99AE', '#00B4D8', '#B5838D', '#90BE6D'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
const MON = MONTHS.map(m => m.slice(0, 3));

/* ---------- Data ---------- */
function defaultData() {
    // Budgets start empty: the user decides if and when to set them.
    const cats = [
        ['Food & Dining', '🍽️'], ['Groceries', '🛒'], ['Transport', '🚌'], ['Rent & Bills', '🏠'],
        ['Education', '📚'], ['Shopping', '🛍️'], ['Health', '💊'], ['Entertainment', '🎬'],
        ['Personal Care', '💇'], ['Subscriptions', '📺'], ['Gifts & Donations', '🎁'], ['Other', '📦']
    ];
    return {
        version: 1,
        expenses: [],
        income: [],
        recurring: [],
        goals: [],
        debts: [],
        settings: {
            currency: 'Rs',
            numberStyle: 'en-IN',
            theme: 'auto',
            lastPay: 'Cash',
            pinHash: null,
            lastBackup: null,
            budgetsCleanV2: true,
            bsDates: false,
            reminder: {on: false, time: '21:00'},
            categories: cats.map(([name, icon], i) => ({name, icon, budget: 0, color: PALETTE[i % PALETTE.length]})),
            payments: ['Cash', 'eSewa', 'Khalti', 'Debit Card', 'Credit Card', 'Bank Transfer'],
            sources: ['Salary', 'Part-time Job', 'Allowance / Pocket Money', 'Freelance', 'Scholarship', 'Gift', 'Other']
        }
    };
}

function normalize(d) {
    const def = defaultData();
    const s = Object.assign({}, def.settings, (d && d.settings) || {});
    if (!Array.isArray(s.categories)) s.categories = def.settings.categories;
    if (!Array.isArray(s.payments)) s.payments = def.settings.payments;
    if (!Array.isArray(s.sources)) s.sources = def.settings.sources;
    if (!s.reminder || typeof s.reminder !== 'object') s.reminder = {on: false, time: '21:00'};
    const clean = arr => (Array.isArray(arr) ? arr : [])
        .filter(x => x && typeof x.date === 'string' && !isNaN(Number(x.amt)))
        .map(x => ({...x, id: x.id || uid(), amt: Number(x.amt)}));
    // One-time fix: earlier versions pre-filled example budgets (Rs 46,000 total).
    // If they were never changed, clear them so nobody starts with a budget they didn't choose.
    if (!(d && d.settings && d.settings.budgetsCleanV2)) {
        const OLD = {
            'Food & Dining': 6000, 'Groceries': 5000, 'Transport': 3000, 'Rent & Bills': 15000, 'Education': 4000,
            'Shopping': 3000, 'Health': 2000, 'Entertainment': 2500, 'Personal Care': 1500, 'Subscriptions': 1000,
            'Gifts & Donations': 1000, 'Other': 2000
        };
        const untouched = s.categories.length && s.categories.every(c => (OLD[c.name] || 0) === (Number(c.budget) || 0));
        if (untouched) s.categories = s.categories.map(c => ({...c, budget: 0}));
        s.budgetsCleanV2 = true;
    }
    // move untouched categories from the old colour set to the new one
    s.categories = s.categories.map((c, i) => (c.color && c.color.toUpperCase() === OLD_PALETTE[i % OLD_PALETTE.length]
        ? {...c, color: PALETTE[i % PALETTE.length]} : c));
    const arr = x => (Array.isArray(x) ? x : []);
    return {
        version: 1,
        expenses: clean(d && d.expenses),
        income: clean(d && d.income),
        recurring: arr(d && d.recurring).filter(r => r && r.next && r.amt > 0),
        goals: arr(d && d.goals).filter(g => g && g.name),
        debts: arr(d && d.debts).filter(x => x && x.person && x.amt > 0).map(x => ({payments: [], ...x})),
        settings: s
    };
}

function load() {
    try {
        const raw = localStorage.getItem(STORE_KEY);
        return raw ? normalize(JSON.parse(raw)) : defaultData();
    } catch (e) {
        return defaultData();
    }
}

function save() {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        if (typeof syncReminderState === 'function') syncReminderState();
        if (typeof scheduleSync === 'function') scheduleSync();
    } catch (e) {
        toast('Could not save. Storage may be full.');
    }
}

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const mKey = (y, m) => `${y}-${pad(m + 1)}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
const total = arr => arr.reduce((a, x) => a + (Number(x.amt) || 0), 0);
const parseDate = s => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
};

function money(n, {sign = false} = {}) {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    const num = abs.toLocaleString(state.settings.numberStyle || 'en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2
    });
    const cur = state.settings.currency ? state.settings.currency + ' ' : '';
    const prefix = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
    return prefix + cur + num;
}

// Short form for tight spaces: Rs 1.24 Cr, Rs 12.5 L (or M/k for 100,000-style)
function moneyShort(n) {
    const v = Number(n) || 0, a = Math.abs(v);
    const cur = state.settings.currency ? state.settings.currency + ' ' : '';
    const sign = v < 0 ? '−' : '';
    const f = x => (+x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)).toLocaleString('en');
    if (state.settings.numberStyle === 'en-IN') {
        if (a >= 1e7) return sign + cur + f(a / 1e7) + ' Cr';
        if (a >= 1e6) return sign + cur + f(a / 1e5) + ' L';
    } else {
        if (a >= 1e9) return sign + cur + f(a / 1e9) + 'B';
        if (a >= 1e6) return sign + cur + f(a / 1e6) + 'M';
    }
    return money(Math.round(v));
}

function compact(v) {
    if (v >= 1e7) return +(v / 1e7).toFixed(1) + 'Cr';
    if (v >= 1e5 && state.settings.numberStyle === 'en-IN') return +(v / 1e5).toFixed(1) + 'L';
    if (v >= 1e6) return +(v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return +(v / 1e3).toFixed(1) + 'k';
    return String(Math.round(v));
}

function dayLabel(s) {
    const t = new Date();
    const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
    if (s === ymd(t)) return 'Today';
    if (s === ymd(y)) return 'Yesterday';
    const d = parseDate(s);
    const opts = {weekday: 'short', day: 'numeric', month: 'short'};
    if (d.getFullYear() !== t.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts);
}

// Safe calculator: numbers with + - * / and brackets (no eval)
function parseAmount(str) {
    const s = String(str).replace(/,/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/\s/g, '');
    if (!s || !/^[\d.+\-*/()]+$/.test(s)) return NaN;
    let i = 0;
    const num = () => {
        if (s[i] === '(') {
            i++;
            const v = expr();
            if (s[i] !== ')') throw 0;
            i++;
            return v;
        }
        if (s[i] === '-') {
            i++;
            return -num();
        }
        const m = s.slice(i).match(/^(\d+\.?\d*|\.\d+)/);
        if (!m) throw 0;
        i += m[0].length;
        return parseFloat(m[0]);
    };
    const term = () => {
        let v = num();
        while (s[i] === '*' || s[i] === '/') {
            const op = s[i++];
            const r = num();
            v = op === '*' ? v * r : v / r;
        }
        return v;
    };
    const expr = () => {
        let v = term();
        while (s[i] === '+' || s[i] === '-') {
            const op = s[i++];
            const r = term();
            v = op === '+' ? v + r : v - r;
        }
        return v;
    };
    try {
        const v = expr();
        return i === s.length && isFinite(v) ? v : NaN;
    } catch (e) {
        return NaN;
    }
}

/* ---------- Bikram Sambat (Nepali) dates ----------
   Month lengths for BS 2070–2090, checked day-by-day against two Nepali calendar libraries.
   BS 2070/01/01 = 2013-04-14 AD. */
const BS = {
    Y0: 2070,
    anchor: Date.UTC(2013, 3, 14),
    rows: '313131323131293030293030,313132313131302930293030,313231323130302930293030,313231323130303029293031,313131323131302930293030,313132313131302930293030,313231323130303029293030,313231323130303029302931,313131323131302930293030,313132313131302930293030,313231323130303029293030,313231323130303029302931,313132313131302930293030,313132313131302930293030,313132313130303029303030,313231323031303029303030,303231323130303029303030,313132313131303029303030,303132323031303029303030,303231323130303029303030,303231323130303029303030'.split(',').map(r => r.match(/../g).map(Number))
};
const BS_MONTHS = ['Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

function toBS(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    let days = Math.round((Date.UTC(y, m - 1, d) - BS.anchor) / 864e5);
    if (days < 0) return null;
    for (let i = 0; i < BS.rows.length; i++) {
        for (let j = 0; j < 12; j++) {
            const n = BS.rows[i][j];
            if (days < n) return {y: BS.Y0 + i, m: j, d: days + 1};
            days -= n;
        }
    }
    return null;
}

const bsOn = () => !!state.settings.bsDates;

function bsShort(dateStr) {
    const b = toBS(dateStr);
    return b ? `${BS_MONTHS[b.m]} ${b.d}` : '';
}

function bsFull(dateStr) {
    const b = toBS(dateStr);
    return b ? `${b.y}/${pad(b.m + 1)}/${pad(b.d)} · ${BS_MONTHS[b.m]} ${b.d}, ${b.y}` : '';
}

function bsMonthSpan(y, m) {
    const a = toBS(ymd(new Date(y, m, 1))), b = toBS(ymd(new Date(y, m, daysIn(y, m))));
    if (!a || !b) return '';
    if (a.y === b.y && a.m === b.m) return `${BS_MONTHS[a.m]} ${a.y}`;
    return a.y === b.y ? `${BS_MONTHS[a.m]}–${BS_MONTHS[b.m]} ${b.y}` : `${BS_MONTHS[a.m]} ${a.y}–${BS_MONTHS[b.m]} ${b.y}`;
}

function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ---------- State ---------- */
let state = load();
const now = new Date();
const ui = {
    view: 'dashboard',
    y: now.getFullYear(),
    m: now.getMonth(),
    year: now.getFullYear(),
    expF: {q: '', cat: '', pay: '', scope: 'month', sort: 'new', mode: 'list', day: null},
    incF: {q: '', src: '', scope: 'month', sort: 'new'},
    formRepeat: 'none',
    split: {on: false, people: [], payer: 'me'},
    formType: 'expense',
    editing: null,
    formCat: ''
};

function catInfo(name) {
    return state.settings.categories.find(c => c.name === name)
        || {name: name || 'Uncategorized', icon: '❔', color: '#8D99AE', budget: 0};
}

const uniq = arr => [...new Set(arr.filter(Boolean))];
const allCats = () => uniq([...state.settings.categories.map(c => c.name), ...state.expenses.map(e => e.cat)]);
const allPays = () => uniq([...state.settings.payments, ...state.expenses.map(e => e.pay)]);
const allSources = () => uniq([...state.settings.sources, ...state.income.map(i => i.src)]);

function monthData(y, m) {
    const k = mKey(y, m);
    return {
        exp: state.expenses.filter(e => e.date.startsWith(k)),
        inc: state.income.filter(i => i.date.startsWith(k))
    };
}

function statusOf(spent, budget) {
    if (!budget) return spent > 0 ? {k: 'none', t: 'No budget'} : {k: 'idle', t: '—'};
    if (spent > budget) return {k: 'over', t: 'Over budget'};
    if (spent >= 0.8 * budget) return {k: 'near', t: 'Near limit'};
    return {k: 'ok', t: 'On track'};
}

function categoryRows(exp) {
    const map = new Map();
    state.settings.categories.forEach(c => map.set(c.name, {...c, budget: Number(c.budget) || 0, spent: 0}));
    exp.forEach(e => {
        const key = e.cat || 'Uncategorized';
        if (!map.has(key)) map.set(key, {...catInfo(key), budget: 0, spent: 0});
        map.get(key).spent += Number(e.amt) || 0;
    });
    return [...map.values()].map(r => ({
        ...r,
        pct: r.budget ? r.spent / r.budget : null,
        status: statusOf(r.spent, r.budget)
    }));
}

const sortTx = (a, b) => (b.date.localeCompare(a.date)) || ((b.created || 0) - (a.created || 0));

/* ---------- Rendering ---------- */
const TITLES = {
    dashboard: 'Dashboard',
    expenses: 'Expenses',
    income: 'Income',
    yearly: 'Year',
    settings: 'Settings',
    debts: 'Lent & borrowed',
    cat: 'Category',
    report: 'Report'
};

function render() {
    $$('.view').forEach(v => {
        v.hidden = v.id !== 'view-' + ui.view;
    });
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === ui.view));
    $('#viewTitle').textContent = TITLES[ui.view];
    $('#periodBar').hidden = ui.view === 'settings' || ui.view === 'debts';
    $('#periodLabel').textContent = ui.view === 'yearly' ? String(ui.year) : `${MON[ui.m]} ${ui.y}`;
    $('#fab').hidden = ui.view === 'settings' || ui.view === 'report';
    document.body.dataset.view = ui.view;
    ({
        dashboard: renderDashboard, expenses: () => renderTxView('expense'), income: () => renderTxView('income'),
        yearly: renderYearly, settings: renderSettings, debts: renderDebts, cat: renderCat, report: renderReport
    })[ui.view]();
}

function empty(icon, title, text, withButton = true) {
    return `<div class="empty"><div class="e-icon">${icon}</div><h3>${title}</h3><p>${text}</p>
    ${withButton ? '<button class="btn primary" data-act="add">+ Add entry</button>' : ''}</div>`;
}

function txItem(t, type, showDate = false) {
    const isExp = type === 'expense';
    const c = isExp ? catInfo(t.cat) : {icon: '💰', color: '#2F9E6B'};
    const title = t.desc || (isExp ? t.cat : t.src) || 'Untitled';
    let sub = isExp ? [t.cat, t.pay].filter(Boolean).join(' · ') : (t.src || '');
    if (showDate) sub = dayLabel(t.date) + ' · ' + sub;
    if (t.recId) sub = '🔁 ' + sub;
    return `<button class="tx" data-type="${type}" data-id="${esc(t.id)}">
    <span class="tx-icon" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(title)}</span>
      <span class="tx-sub">${esc(sub)}${t.notes ? ' · ' + esc(t.notes) : ''}</span>
    </span>
    <span class="tx-amt ${isExp ? 'neg' : 'pos'}">${isExp ? '−' : '+'}${money(t.amt)}</span>
  </button>`;
}

/* ----- Dashboard ----- */
function renderDashboard() {
    const {y, m} = ui;
    const {exp, inc} = monthData(y, m);
    const spent = total(exp);
    const income = total(inc);
    const net = income - spent;
    const budget = state.settings.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0);
    const left = budget - spent;

    const t = new Date();
    const isCur = t.getFullYear() === y && t.getMonth() === m;
    const isPast = new Date(y, m + 1, 0) < new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const dim = daysIn(y, m);
    const elapsed = isCur ? t.getDate() : (isPast ? dim : 0);
    const avg = elapsed ? spent / elapsed : 0;
    const projected = isCur && elapsed ? avg * dim : null;
    const daysLeft = isCur ? dim - t.getDate() + 1 : 0;
    const todaySpent = total(state.expenses.filter(e => e.date === todayStr()));

    const pm = m === 0 ? {y: y - 1, m: 11} : {y, m: m - 1};
    const prevSpent = total(monthData(pm.y, pm.m).exp);
    const change = prevSpent ? (spent - prevSpent) / prevSpent : null;

    const rows = categoryRows(exp);
    const used = rows.filter(r => r.spent > 0).sort((a, b) => b.spent - a.spent);
    const top = used[0];
    const pctUsed = budget ? spent / budget : 0;
    const overall = statusOf(spent, budget).k;

    // payment methods
    const payMap = new Map();
    exp.forEach(e => {
        const k = e.pay || 'Not set';
        payMap.set(k, (payMap.get(k) || 0) + Number(e.amt));
    });
    const pays = [...payMap.entries()].sort((a, b) => b[1] - a[1]);

    // daily
    const daily = Array.from({length: dim}, () => 0);
    exp.forEach(e => {
        daily[parseDate(e.date).getDate() - 1] += Number(e.amt);
    });

    const recent = [...exp.map(e => ({...e, _t: 'expense'})), ...inc.map(i => ({...i, _t: 'income'}))]
        .sort(sortTx).slice(0, 6);

    const stat = (label, val, cls = '', sub = '') =>
        statHtml(label, val, cls, sub);

    const prevExp = monthData(pm.y, pm.m).exp;
    const ms = moneyShort;
    const tips = insights(exp, prevExp, {y, m, isCur, elapsed, pm});
    const nEntries = state.expenses.length + state.income.length;
    const lb = state.settings.lastBackup;
    const sinceBackup = lb ? Math.floor((Date.now() - lb) / 864e5) : null;
    const showBackup = nEntries >= 10 && (sinceBackup === null || sinceBackup >= 7);
    const nudge = isCur && reminderDue();
    const cuts = nEntries ? cutTips(y, m) : [];
    const showReportBanner = isCur && t.getDate() <= 5 && monthData(pm.y, pm.m).exp.length > 0;
    const dt = debtTotals();
    const isNew = !nEntries && !state.recurring.length;

    // month strip: one bar split by category; with a budget the bar's full width is the budget
    const denom = Math.max(spent, budget) || 1;
    const strip = used.map(r => `<i style="width:${(r.spent / denom * 100).toFixed(3)}%;background:${r.color}" title="${esc(r.name)}"></i>`).join('');
    const overMark = budget && spent > budget ? `<b class="strip-mark" style="left:${(budget / spent * 100).toFixed(2)}%"></b>` : '';
    const pctLabel = (part, whole) => {
        const p = part / whole * 100;
        return p > 0 && p < 1 ? '<1%' : Math.round(p) + '%';
    };
    const stripKey = used.slice(0, 4).map(r => `<span><i style="background:${r.color}"></i>${esc(r.name)} ${pctLabel(r.spent, spent)}</span>`).join('')
        + (used.length > 4 ? `<span class="more">+${used.length - 4} more</span>` : '');
    const intro = !ui.introDone;
    ui.introDone = true;

    const hour = new Date().getHours();
    $('#viewTitle').textContent = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 17 ? 'Hey there' : 'Good evening';

    $('#view-dashboard').innerHTML = `
    <section class="hero ${intro ? 'intro' : ''}">
      <div class="flagline" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="hero-top">
        <span class="hero-label">Spent in ${MONTHS[m]}${isCur ? ' so far' : ''}</span>
        ${change !== null && spent > 0 ? `<span class="pill ${change > 0 ? 'pill-bad' : 'pill-good'}">${change >= 2 ? `${(spent / prevSpent).toFixed(1)}× ${MON[pm.m]}` : `${change > 0 ? '↑' : '↓'} ${Math.abs(Math.round(change * 100))}% vs ${MON[pm.m]}`}</span>` : ''}
      </div>
      ${bsOn() && bsMonthSpan(y, m) ? `<div class="hero-bs">${bsMonthSpan(y, m)}</div>` : ''}
      <div class="hero-value" data-target="${spent}">${money(spent)}</div>
      <div class="strip ${spent ? '' : 'empty'}" role="img" aria-label="Spending split by category">${strip}${overMark}</div>
      ${stripKey ? `<div class="strip-key">${stripKey}</div>` : ''}
      <div class="hero-foot">
        <span>${budget ? `${Math.round(pctUsed * 100)}% of your ${money(budget)} budget${spent > budget ? `, ${money(spent - budget)} over` : ''}` : 'Just tracking, no budget set'}</span>
        ${projected !== null && spent > 0 ? `<span>On pace for ${money(Math.round(projected))}</span>` : ''}
      </div>
    </section>

    ${isNew ? `
    <section class="welcome">
      <h2>Start with one expense</h2>
      <p>Tap the yellow button each time you spend. It takes five seconds, and after a week you'll see exactly where your money goes.</p>
      <ul>
        <li>Budgets are optional. Track first, and add limits later if you want them.</li>
        <li>Rent or subscriptions? Set them to repeat monthly and they add themselves.</li>
        <li>Add this page to your home screen to use it offline like an app.</li>
      </ul>
      <button class="btn primary" data-act="add">Add first expense</button>
    </section>` : ''}

    ${nudge ? `
    <div class="banner nudge">
      <span>Nothing logged today yet. Spent anything?</span>
      <button class="btn sm" data-act="add">Add it</button>
    </div>` : ''}
    ${showBackup ? `
    <div class="banner">
      <span>${sinceBackup === null ? 'You haven’t backed up yet.' : `Last backup was ${sinceBackup} days ago.`} Save a copy to Google Drive.</span>
      <button class="btn sm" data-act="backup-now">Back up</button>
    </div>` : ''}

    ${!isNew ? `
    <div class="ledger">
      ${stat('Income', ms(income), income ? 'pos' : '')}
      ${stat('Saved', ms(net), net < 0 ? 'neg' : (net > 0 ? 'pos' : ''), income ? `${Math.round(net / income * 100)}% of income` : '')}
      ${budget
        ? stat('Budget left', ms(left), left < 0 ? 'neg' : '', isCur && left > 0 && daysLeft ? `${money(Math.round(left / daysLeft))} a day for ${daysLeft} days` : (left < 0 ? 'Over your total budget' : ''))
        : stat('Budget left', '—', '', 'No budgets set')}
      ${stat('Per day', ms(avg), '', elapsed ? `average over ${elapsed} day${elapsed > 1 ? 's' : ''}` : '')}
      ${stat('Today', ms(todaySpent))}
      ${stat('Top category', top ? `${esc(top.icon)} ${esc(top.name)}` : '—', 'stat-text', top ? ms(top.spent) : '')}
    </div>` : ''}

    ${showReportBanner ? `
    <div class="banner report-ready">
      <span>Your ${MONTHS[pm.m]} report is ready.</span>
      <button class="btn sm" data-report="prev">Open</button>
    </div>` : ''}

    ${isCur && !isNew ? weekHtml() : ''}

    ${tips.length && !isNew ? `
    <section class="block">
      <h2>Worth knowing</h2>
      <ul class="insights">${tips.map(([ic, html]) => `<li><span class="ii">${ic}</span><span>${html}</span></li>`).join('')}</ul>
    </section>` : ''}

    ${exp.length ? `
    <section class="block">
      <div class="block-head"><h2>Day by day</h2><span class="muted small">Tap a bar for the amount</span></div>
      <div class="panel"><canvas class="chart" id="dailyChart"></canvas></div>
    </section>` : ''}

    ${rows.some(r => r.budget || r.spent) ? `
    <section class="block">
      <div class="block-head"><h2>Categories</h2><span class="muted small">Tap one for details</span></div>
      <div class="panel cat-rows">
        ${rows.filter(r => r.budget || r.spent).sort((a, b) => b.spent - a.spent).map(r => {
        const w = r.budget ? Math.min(100, r.pct * 100) : (spent ? r.spent / spent * 100 : 0);
        const right = r.budget
            ? (r.budget - r.spent >= 0 ? `${money(r.budget - r.spent)} left of ${money(r.budget)}` : `${money(r.spent - r.budget)} over ${money(r.budget)}`)
            : (spent ? `${Math.round(r.spent / spent * 100)}% of spending` : '');
        return `
          <button class="budget-row" data-cat="${esc(r.name)}" style="--c:${r.color}">
            <span class="b-icon">${esc(r.icon)}</span>
            <span class="b-main">
              <span class="b-top"><span class="b-name">${esc(r.name)}</span><span class="b-amt">${money(r.spent)}</span></span>
              <span class="bar"><span class="${r.budget ? r.status.k : 'share'}" style="width:${w}%"></span></span>
              <span class="b-bottom">${r.budget && r.status.k !== 'ok' ? `<span class="status ${r.status.k}">${r.status.t}</span>` : '<span></span>'}<span>${right}</span></span>
            </span>
          </button>`;
    }).join('')}
      </div>
      ${!budget ? `<p class="note">No budgets yet, and that's fine. After a few weeks, <button class="inline-link" data-goto="settings">let the app suggest budgets</button> from what you actually spend.</p>` : ''}
    </section>` : ''}

    ${cuts.length ? `
    <section class="block">
      <h2>Could you cut back?</h2>
      <ul class="insights">${cuts.map(([ic, html]) => `<li><span class="ii">${ic}</span><span>${html}</span></li>`).join('')}</ul>
    </section>` : ''}

    <section class="block">
      <div class="block-head"><h2>Saving for</h2><button class="link" data-act="goal-new">New goal</button></div>
      ${state.goals.length ? `<div class="panel goal-list">${state.goals.map(goalRow).join('')}</div>`
        : '<p class="note" style="margin-top:0">A phone, a trip, an emergency fund? Add a goal and watch it fill up.</p>'}
    </section>

    <section class="block">
      <div class="block-head"><h2>Lent &amp; borrowed</h2><button class="link" data-goto="debts">${state.debts.length ? 'See all' : 'Add'}</button></div>
      ${dt.open.length ? `
        <div class="ledger two">
          ${statHtml('Owed to you', moneyShort(dt.owedToMe), dt.owedToMe ? 'pos' : '')}
          ${statHtml('You owe', moneyShort(dt.iOwe), dt.iOwe ? 'neg' : '')}
        </div>
        <div class="panel tx-list">${dt.open.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 3).map(debtRow).join('')}</div>`
        : '<p class="note" style="margin-top:0">Lent a friend money, or borrowed some? Keep track so nobody forgets.</p>'}
    </section>

    ${pays.length ? `
    <section class="block">
      <h2>Paid with</h2>
      <div class="panel">
        <div class="pay-stack">${pays.map(([name, amt], i) => `<i style="width:${amt / spent * 100}%;background:var(--pay-${i % 5})"></i>`).join('')}</div>
        <ul class="pay-key">${pays.map(([name, amt], i) => `<li><i style="background:var(--pay-${i % 5})"></i><span>${esc(name)}</span><b>${money(amt)}</b><small>${Math.round(amt / spent * 100)}%</small></li>`).join('')}</ul>
      </div>
    </section>` : ''}

    ${exp.length ? `<button class="report-link" data-report="this">
      <span class="ii">📄</span><span><b>${MONTHS[m]} report</b><small>A one-page summary you can save as PDF or share</small></span>
      <svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>` : ''}

    ${recent.length ? `
    <section class="block">
      <div class="block-head"><h2>Latest</h2><button class="link" data-goto="expenses">See all</button></div>
      <div class="panel tx-list">${recent.map(r => txItem(r, r._t)).join('')}</div>
    </section>` : ''}
  `;

    requestAnimationFrame(() => {
        const dl = $('#dailyChart');
        if (dl) {
            const todayIdx = isCur ? t.getDate() - 1 : -1;
            drawBars(dl, daily.map((_, i) => String(i + 1)), [{
                name: 'Spent',
                data: daily,
                color: cssVar('--cobalt')
            }], {
                height: 170,
                labelIf: i => i === 0 || (i + 1) % 5 === 0,
                highlight: todayIdx,
                highlightColor: cssVar('--sun'),
                tip: i => `${i + 1} ${MON[m]}: ${money(daily[i])}`
            });
        }
        // one-time count-up on first open
        const hv = $('.hero.intro .hero-value');
        if (hv && spent > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            const target = spent, t0 = performance.now(), dur = 700;
            const step = now => {
                const p = Math.min(1, (now - t0) / dur);
                const e = 1 - Math.pow(1 - p, 3);
                hv.textContent = money(Math.round(target * e));
                if (p < 1) requestAnimationFrame(step); else hv.textContent = money(target);
            };
            requestAnimationFrame(step);
        }
    });
}

function statHtml(label, val, cls = '', sub = '') {
    const plain = String(val).replace(/<[^>]+>/g, '');
    const size = plain.length > 13 ? 'xl' : plain.length > 10 ? 'lg' : '';
    return `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls} ${size}">${val}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</div>`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function relDay(dateStr) {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const n = Math.round((parseDate(dateStr) - t) / 864e5);
    return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
}

function insights(exp, prevExp, {isCur, elapsed, pm}) {
    const out = [];
    if (isCur) {
        state.debts.filter(d => !d.settled && d.due && d.due < todayStr() && debtLeft(d) > 0).slice(0, 2).forEach(d => {
            out.push(['⏰', d.dir === 'lent'
                ? `<b>${esc(d.person)}</b> was due to pay you back ${money(debtLeft(d))}`
                : `You were due to pay <b>${esc(d.person)}</b> back ${money(debtLeft(d))}`]);
        });
    }
    // upcoming recurring (next 7 days)
    if (isCur) {
        const t = new Date();
        const limit = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7));
        state.recurring.filter(r => r.active && r.next >= todayStr() && r.next <= limit)
            .sort((a, b) => a.next.localeCompare(b.next)).slice(0, 2)
            .forEach(r => out.push(['🔁', `<b>${esc(r.desc || r.cat || r.src)}</b> (${money(r.amt)}) is due ${relDay(r.next)}`]));
    }
    if (exp.length) {
        const big = exp.reduce((a, b) => (b.amt > a.amt ? b : a));
        out.push(['💸', `Biggest expense: <b>${esc(big.desc || big.cat)}</b> · ${money(big.amt)}`]);
    }
    // category changes vs last month
    if (exp.length && prevExp.length) {
        const sumBy = arr => arr.reduce((m, e) => (m[e.cat] = (m[e.cat] || 0) + e.amt, m), {});
        const a = sumBy(exp), b = sumBy(prevExp);
        const diffs = uniq([...Object.keys(a), ...Object.keys(b)]).map(c => [c, (a[c] || 0) - (b[c] || 0)]);
        const up = diffs.filter(d => d[1] > 0).sort((x, y) => y[1] - x[1])[0];
        const down = diffs.filter(d => d[1] < 0).sort((x, y) => x[1] - y[1])[0];
        if (up && isCur === false) out.push(['📈', `<b>${esc(up[0])}</b> was ${money(up[1])} more than ${MON[pm.m]}`]);
        else if (up) out.push(['📈', `<b>${esc(up[0])}</b> is already ${money(up[1])} above ${MON[pm.m]}`]);
        if (down && !isCur) out.push(['📉', `You cut <b>${esc(down[0])}</b> by ${money(-down[1])} vs ${MON[pm.m]}`]);
    }
    // weekday pattern
    if (exp.length >= 8) {
        const wd = Array(7).fill(0);
        exp.forEach(e => {
            wd[parseDate(e.date).getDay()] += e.amt;
        });
        const best = wd.indexOf(Math.max(...wd));
        out.push(['📅', `You spend the most on <b>${WEEKDAYS[best]}s</b>`]);
    }
    // no-spend days
    if (elapsed) {
        const spendDays = new Set(exp.map(e => e.date)).size;
        const free = elapsed - spendDays;
        if (free > 0) out.push(['🌱', `<b>${free}</b> no-spend day${free > 1 ? 's' : ''} ${isCur ? 'so far' : 'this month'}`]);
    }
    return out.slice(0, 5);
}

function monthsUntil(dateStr) {
    const t = new Date(), d = parseDate(dateStr);
    return (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth()) + (d.getDate() >= t.getDate() ? 0 : -1) + 1;
}

function goalRow(g) {
    const pct = g.target ? Math.min(1, g.saved / g.target) : 0;
    const rem = Math.max(0, g.target - g.saved);
    let note = '';
    if (rem <= 0) note = 'Goal reached 🎉';
    else if (g.deadline) {
        const months = monthsUntil(g.deadline);
        note = months > 0 ? `${money(Math.ceil(rem / months))}/month to hit it by ${MON[parseDate(g.deadline).getMonth()]} ${parseDate(g.deadline).getFullYear()}` : 'Deadline passed';
    } else note = `${money(rem)} to go`;
    return `<button class="goal" data-goal="${esc(g.id)}">
    <span class="b-icon" style="background:var(--accent-soft)">${esc(g.icon || '🎯')}</span>
    <span class="b-main">
      <span class="b-top"><span class="b-name">${esc(g.name)}</span><span class="b-amt">${money(g.saved)}<small> / ${money(g.target)}</small></span></span>
      <span class="progress sm"><span class="${rem <= 0 ? 'done' : ''}" style="width:${pct * 100}%"></span></span>
      <span class="b-bottom"><span>${Math.round(pct * 100)}%</span><span>${note}</span></span>
    </span>
  </button>`;
}

/* ----- Expenses / Income lists ----- */
function fillSelect(sel, options, value) {
    sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    sel.value = options.some(([v]) => v === value) ? value : '';
}

function renderTxView(type) {
    const isExp = type === 'expense';
    const f = isExp ? ui.expF : ui.incF;
    const P = isExp ? 'exp' : 'inc';

    if (isExp) {
        fillSelect($('#expCat'), [['', 'All categories'], ...allCats().map(c => [c, c])], f.cat);
        fillSelect($('#expPay'), [['', 'All payments'], ...allPays().map(p => [p, p])], f.pay);
    } else {
        fillSelect($('#incSrc'), [['', 'All sources'], ...allSources().map(s => [s, s])], f.src);
    }
    const cal = isExp && f.mode === 'cal';
    if (cal) f.scope = 'month';
    if (isExp) {
        const mb = $('#expMode');
        mb.classList.toggle('active', cal);
        mb.setAttribute('aria-label', cal ? 'Switch to list view' : 'Switch to calendar view');
        mb.title = cal ? 'List view' : 'Calendar view';
        mb.innerHTML = cal
            ? '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>'
            : '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
        $('#expScope').closest('.toolbar-row2').hidden = cal;
    }
    const scope = $('#' + P + 'Scope');
    scope.querySelector('[data-scope="month"]').textContent = ui.y === new Date().getFullYear() ? `${MON[ui.m]} only` : `${MON[ui.m]} ${ui.y}`;
    $$('button', scope).forEach(b => b.classList.toggle('active', b.dataset.scope === f.scope));
    $('#' + P + 'Search').value = f.q;
    $('#periodBar').style.visibility = f.scope === 'all' ? 'hidden' : '';

    let list = (isExp ? state.expenses : state.income).slice();
    if (f.scope === 'month') list = list.filter(x => x.date.startsWith(mKey(ui.y, ui.m)));
    if (isExp && f.cat) list = list.filter(x => x.cat === f.cat);
    if (isExp && f.pay) list = list.filter(x => x.pay === f.pay);
    if (!isExp && f.src) list = list.filter(x => x.src === f.src);
    if (f.q) {
        const q = f.q.toLowerCase();
        list = list.filter(x => [x.desc, x.notes, x.cat, x.pay, x.src].some(v => (v || '').toLowerCase().includes(q)));
    }
    if (isExp) {
        $('#expCal').innerHTML = cal ? calendarHtml(list) : '';
        if (cal && f.day) list = list.filter(x => x.date === f.day);
        else if (!cal) f.day = null;
    }
    const sorters = {
        new: sortTx,
        old: (a, b) => -sortTx(a, b),
        high: (a, b) => b.amt - a.amt,
        low: (a, b) => a.amt - b.amt
    };
    list.sort(sorters[f.sort] || sortTx);
    $('#' + P + 'Sort').value = f.sort;

    const word = isExp ? (list.length === 1 ? 'expense' : 'expenses') : (list.length === 1 ? 'entry' : 'entries');
    $('#' + P + 'Summary').innerHTML = list.length
        ? `<span>${cal && f.day ? `${dayLabel(f.day)} · ` : ''}${list.length} ${word}</span><strong class="${isExp ? '' : 'pos'}">${money(total(list))}</strong>` : '';

    if (!list.length && cal && f.day) {
        $('#expList').innerHTML = `<div class="card">${empty('🌱', 'No spending on ' + dayLabel(f.day), 'A no-spend day. Nice.', false)}</div>`;
        return;
    }
    if (!list.length) {
        const filtered = f.q || f.cat || f.pay || f.src;
        $('#' + P + 'List').innerHTML = `<div class="card">${filtered
            ? empty('🔍', 'No matches', 'Try a different search or filter.', false)
            : empty(isExp ? '🧾' : '💰', isExp ? 'No expenses yet' : 'No income yet',
                f.scope === 'month' ? `Nothing logged for ${MONTHS[ui.m]} ${ui.y}.` : 'Tap + to add your first entry.')}</div>`;
        return;
    }

    if (f.sort === 'high' || f.sort === 'low') {
        $('#' + P + 'List').innerHTML = `<div class="day-group">${list.map(x => txItem(x, type, true)).join('')}</div>`;
        return;
    }
    let html = '';
    let i = 0;
    while (i < list.length) {
        const d = list[i].date;
        const group = [];
        while (i < list.length && list[i].date === d) group.push(list[i++]);
        html += `<div class="day-head"><span>${dayLabel(d)}${bsOn() && toBS(d) ? `<small class="bs">${bsShort(d)}</small>` : ''}</span><span>${money(total(group))}</span></div>
      <div class="day-group">${group.map(x => txItem(x, type)).join('')}</div>`;
    }
    $('#' + P + 'List').innerHTML = html;
}

/* ----- This week (Sunday to Saturday) ----- */
function weekHtml() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const start = new Date(t);
    start.setDate(t.getDate() - t.getDay());
    const day = (base, i) => ymd(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
    const lastStart = new Date(start);
    lastStart.setDate(start.getDate() - 7);
    const sumDay = d => total(state.expenses.filter(e => e.date === d));
    const thisW = Array.from({length: 7}, (_, i) => sumDay(day(start, i)));
    const lastW = Array.from({length: 7}, (_, i) => sumDay(day(lastStart, i)));
    const upto = t.getDay();
    const soFar = thisW.slice(0, upto + 1).reduce((a, b) => a + b, 0);
    const lastSoFar = lastW.slice(0, upto + 1).reduce((a, b) => a + b, 0);
    const lastTotal = lastW.reduce((a, b) => a + b, 0);
    if (!soFar && !lastTotal) return '';
    const max = Math.max(...thisW, ...lastW, 1);
    const diff = soFar - lastSoFar;
    const cmp = !lastSoFar ? (lastTotal ? `Last week you'd spent nothing by now.` : '')
        : Math.abs(diff) < 1 ? 'Same as this point last week.'
            : `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than this point last week.`;
    const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    return `
    <section class="block">
      <div class="block-head"><h2>This week</h2><span class="muted small">Last week: ${money(lastTotal)}</span></div>
      <div class="panel week">
        <div class="week-top"><strong>${money(soFar)}</strong><span class="${diff > 0 && lastSoFar ? 'neg' : diff < 0 ? 'pos' : 'muted'}">${cmp}</span></div>
        <div class="week-bars">
          ${thisW.map((v, i) => `
            <div class="wb ${i === upto ? 'today' : ''} ${i > upto ? 'future' : ''}" title="${dayLabel(day(start, i))}: ${money(v)}">
              <div class="wb-track">
                <span class="wb-last" style="height:${lastW[i] / max * 100}%"></span>
                <span class="wb-this" style="height:${v / max * 100}%"></span>
              </div>
              <span class="wb-amt">${v ? calAmt(v) : ''}</span>
              <span class="wb-day">${labels[i]}</span>
            </div>`).join('')}
        </div>
        <div class="chart-legend"><span><i style="background:var(--cobalt)"></i>This week</span><span><i style="background:var(--grid);box-shadow:inset 0 0 0 1px var(--line)"></i>Last week</span></div>
      </div>
    </section>`;
}

/* ----- Where could I cut back? ----- */
function cutTips(y, m) {
    const exp = monthData(y, m).exp;
    if (exp.length < 5) return [];
    const t = new Date();
    const isCur = t.getFullYear() === y && t.getMonth() === m;
    const dim = daysIn(y, m);
    const tips = [];
    // categories running above their usual level (vs. average of up to 3 earlier months)
    const prev = [1, 2, 3].map(k => {
        const d = new Date(y, m - k, 1);
        return monthData(d.getFullYear(), d.getMonth()).exp;
    }).filter(a => a.length);
    if (prev.length && (!isCur || t.getDate() >= 7)) {
        const scale = isCur ? dim / t.getDate() : 1;
        const sumBy = arr => arr.reduce((acc, e) => (acc[e.cat] = (acc[e.cat] || 0) + e.amt, acc), {});
        const now = sumBy(exp);
        const usual = {};
        prev.forEach(a => Object.entries(sumBy(a)).forEach(([c, v]) => {
            usual[c] = (usual[c] || 0) + v / prev.length;
        }));
        Object.entries(now).map(([c, v]) => [c, v * scale, usual[c] || 0])
            .filter(([, proj, avg]) => avg > 0 && proj - avg > Math.max(500, avg * 0.25))
            .sort((a, b) => (b[1] - b[2]) - (a[1] - a[2])).slice(0, 2)
            .forEach(([c, proj, avg]) => tips.push([catInfo(c).icon, isCur
                ? `<b>${esc(c)}</b> is heading for ${money(Math.round(proj))} this month, about ${money(Math.round(proj - avg))} more than usual`
                : `<b>${esc(c)}</b> was ${money(Math.round(proj - avg))} above your usual ${money(Math.round(avg))}`]));
    }
    // small things bought again and again
    const groups = {};
    exp.filter(e => e.desc && !e.recId).forEach(e => {
        const k = e.desc.trim().toLowerCase();
        (groups[k] = groups[k] || {name: e.desc.trim(), n: 0, sum: 0, cat: e.cat}).n++;
        groups[k].sum += e.amt;
    });
    Object.values(groups).filter(g => g.n >= 4).sort((a, b) => b.sum - a.sum).slice(0, 2).forEach(g => {
        tips.push([catInfo(g.cat).icon, `<b>${esc(g.name)}</b>: ${g.n} times = ${money(g.sum)}. Half as often would save about ${moneyShort(g.sum / 2 * 12)} a year`]);
    });
    return tips.slice(0, 3);
}

/* ----- Category detail ----- */
function renderCat() {
    const name = ui.catView;
    const c = catInfo(name);
    const {y, m} = ui;
    $('#viewTitle').textContent = name;
    const months = Array.from({length: 6}, (_, k) => {
        const d = new Date(y, m - 5 + k, 1);
        return {y: d.getFullYear(), m: d.getMonth()};
    })
        .map(o => ({...o, v: total(monthData(o.y, o.m).exp.filter(e => e.cat === name))}));
    const exp = monthData(y, m).exp.filter(e => e.cat === name);
    const spent = total(exp);
    const earlier = months.slice(0, 5).filter(o => o.v > 0);
    const avg = earlier.length ? earlier.reduce((a, o) => a + o.v, 0) / earlier.length : 0;
    const allSpent = total(monthData(y, m).exp);
    const budget = Number(c.budget) || 0;
    const st = statusOf(spent, budget);
    const groups = {};
    exp.forEach(e => {
        const k = (e.desc || '(no description)').trim().toLowerCase();
        (groups[k] = groups[k] || {name: e.desc || '(no description)', n: 0, sum: 0}).n++;
        groups[k].sum += e.amt;
    });
    const often = Object.values(groups).filter(g => g.n >= 2).sort((a, b) => b.n - a.n || b.sum - a.sum).slice(0, 4);
    const biggest = exp.slice().sort((a, b) => b.amt - a.amt).slice(0, 5);
    $('#view-cat').innerHTML = `
    <section class="cat-hero" style="--c:${c.color}">
      <span class="cat-hero-icon">${esc(c.icon)}</span>
      <div>
        <span class="cat-hero-label">${MONTHS[m]} ${y}</span>
        <div class="cat-hero-value">${money(spent)}</div>
        <span class="cat-hero-sub">${allSpent ? `${Math.round(spent / allSpent * 100)}% of everything you spent` : 'Nothing spent this month'}</span>
      </div>
    </section>
    <div class="ledger">
      ${statHtml('Usual month', avg ? moneyShort(avg) : '—', '', earlier.length ? `average of ${earlier.length} earlier month${earlier.length > 1 ? 's' : ''}` : 'Not enough history yet')}
      ${statHtml('Budget', budget ? moneyShort(budget) : '—', '', budget ? (spent > budget ? `${money(spent - budget)} over` : `${money(budget - spent)} left`) : 'No budget set')}
      ${statHtml('Expenses', String(exp.length), '', exp.length ? `average ${moneyShort(spent / exp.length)} each` : '')}
      ${statHtml('Status', budget ? st.t : 'Tracking', budget ? (st.k === 'over' ? 'neg' : st.k === 'ok' ? 'pos' : '') : '', budget ? `${Math.round(spent / budget * 100)}% used` : '')}
    </div>
    <section class="block">
      <div class="block-head"><h2>Last 6 months</h2><span class="muted small">Tap a bar</span></div>
      <div class="panel"><canvas class="chart" id="catChart"></canvas></div>
    </section>
    ${biggest.length ? `<section class="block"><h2>Biggest this month</h2><div class="panel tx-list">${biggest.map(e => txItem(e, 'expense', true)).join('')}</div></section>` : ''}
    ${often.length ? `<section class="block"><h2>Bought most often</h2><div class="panel">
      <ul class="pay-key">${often.map(g => `<li><i style="background:${c.color}"></i><span>${esc(g.name)}</span><b>${money(g.sum)}</b><small>${g.n}×</small></li>`).join('')}</ul></div></section>` : ''}
    <button class="btn full" data-act="cat-all">See every ${esc(name)} expense</button>`;
    requestAnimationFrame(() => {
        const cv = $('#catChart');
        if (cv) drawBars(cv, months.map(o => MON[o.m]), [{name, data: months.map(o => o.v), color: c.color}], {
            height: 170, highlight: 5, tip: i => `${MONTHS[months[i].m]} ${months[i].y}: ${money(months[i].v)}`
        });
    });
}

/* ----- Monthly report (printable) ----- */
function renderReport() {
    const {y, m} = ui;
    const {exp, inc} = monthData(y, m);
    const spent = total(exp), income = total(inc), saved = income - spent;
    const pm = m === 0 ? {y: y - 1, m: 11} : {y, m: m - 1};
    const prev = monthData(pm.y, pm.m).exp;
    const prevSpent = total(prev);
    const rows = categoryRows(exp).filter(r => r.spent || r.budget).sort((a, b) => b.spent - a.spent);
    const budget = state.settings.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0);
    const pays = {};
    exp.forEach(e => {
        const k = e.pay || 'Not set';
        pays[k] = (pays[k] || 0) + e.amt;
    });
    const top = exp.slice().sort((a, b) => b.amt - a.amt).slice(0, 8);
    const tips = [...insights(exp, prev, {isCur: false, elapsed: daysIn(y, m), pm}), ...cutTips(y, m)].slice(0, 6);
    const dt = debtTotals();
    const bsSpan = bsOn() ? bsMonthSpan(y, m) : '';
    $('#viewTitle').textContent = 'Report';
    $('#view-report').innerHTML = `
    <article class="report" id="reportDoc">
      <header class="rep-head">
        <div class="flagline" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
        <h2>${MONTHS[m]} ${y}</h2>
        <p>${bsSpan ? bsSpan + ' · ' : ''}Expense report, made ${new Date().toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    })}</p>
      </header>
      <div class="rep-sum">
        <div><span>Spent</span><b>${money(spent)}</b><small>${prevSpent ? `${spent > prevSpent ? '↑' : '↓'} ${money(Math.abs(spent - prevSpent))} vs ${MON[pm.m]}` : ''}</small></div>
        <div><span>Income</span><b class="pos">${money(income)}</b><small>${inc.length} entr${inc.length === 1 ? 'y' : 'ies'}</small></div>
        <div><span>Saved</span><b class="${saved < 0 ? 'neg' : 'pos'}">${money(saved)}</b><small>${income ? `${Math.round(saved / income * 100)}% of income` : ''}</small></div>
        <div><span>Budget</span><b>${budget ? money(budget) : '—'}</b><small>${budget ? `${Math.round(spent / budget * 100)}% used` : 'none set'}</small></div>
      </div>
      ${rows.length ? `
      <h3>By category</h3>
      <table class="rep-table">
        <thead><tr><th>Category</th><th>Spent</th><th>Share</th><th>Budget</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.icon)} ${esc(r.name)}</td><td>${money(r.spent)}</td><td>${spent ? Math.round(r.spent / spent * 100) : 0}%</td>
          <td class="${r.status.k === 'over' ? 'neg' : ''}">${r.budget ? `${money(r.budget)}${r.status.k === 'over' ? ' (over)' : ''}` : '—'}</td></tr>`).join('')}</tbody>
      </table>` : '<p class="muted">No expenses this month.</p>'}
      ${top.length ? `
      <h3>Biggest expenses</h3>
      <table class="rep-table">
        <tbody>${top.map(e => `<tr><td>${esc(e.desc || e.cat)}<small>${dayLabel(e.date)} · ${esc(e.cat)}</small></td><td>${money(e.amt)}</td></tr>`).join('')}</tbody>
      </table>` : ''}
      ${Object.keys(pays).length ? `
      <h3>Paid with</h3>
      <table class="rep-table"><tbody>${Object.entries(pays).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${money(v)}</td><td>${Math.round(v / spent * 100)}%</td></tr>`).join('')}</tbody></table>` : ''}
      ${inc.length ? `
      <h3>Income</h3>
      <table class="rep-table"><tbody>${inc.slice().sort((a, b) => a.date.localeCompare(b.date)).map(i => `<tr><td>${esc(i.desc || i.src)}<small>${dayLabel(i.date)} · ${esc(i.src || '')}</small></td><td class="pos">${money(i.amt)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${dt.open.length ? `
      <h3>Lent &amp; borrowed (still open)</h3>
      <table class="rep-table"><tbody>${dt.open.map(d => `<tr><td>${esc(d.person)}<small>${d.dir === 'lent' ? 'owes you' : 'you owe'}</small></td><td class="${d.dir === 'lent' ? 'pos' : 'neg'}">${money(debtLeft(d))}</td></tr>`).join('')}</tbody></table>` : ''}
      ${tips.length ? `<h3>Worth knowing</h3><ul class="rep-tips">${tips.map(([ic, h]) => `<li><span>${ic}</span><span>${h}</span></li>`).join('')}</ul>` : ''}
    </article>
    <div class="btn-grid no-print">
      <button class="btn primary" data-act="report-pdf">Save as PDF</button>
      <button class="btn" data-act="report-share">Share summary</button>
    </div>
    <p class="note no-print">“Save as PDF” opens your phone's print screen: choose <b>Save as PDF</b> as the printer.</p>`;
}

function reportSummaryText() {
    const {y, m} = ui;
    const {exp, inc} = monthData(y, m);
    const spent = total(exp), income = total(inc);
    const rows = categoryRows(exp).filter(r => r.spent).sort((a, b) => b.spent - a.spent).slice(0, 5);
    return [`My spending, ${MONTHS[m]} ${y}`, `Spent: ${money(spent)}`, `Income: ${money(income)}`, `Saved: ${money(income - spent)}`, '',
        'Top categories:', ...rows.map(r => `• ${r.name}: ${money(r.spent)} (${Math.round(r.spent / spent * 100)}%)`)].join('\n');
}

/* ----- Calendar (heat map of daily spending) ----- */

// at most 4 characters so it fits a small day cell: 850, 1.2k, 12k, 1.2L
function calAmt(v) {
    if (v < 1000) return String(Math.round(v));
    if (v < 9950) return (Math.round(v / 100) / 10).toString().replace(/\.0$/, '') + 'k';
    if (v < 99500) return Math.round(v / 1000) + 'k';
    if (state.settings.numberStyle === 'en-IN') return v < 1e7 ? (v < 995000 ? (Math.round(v / 1e4) / 10).toString().replace(/\.0$/, '') : Math.round(v / 1e5)) + 'L' : Math.round(v / 1e7) + 'Cr';
    return v < 1e6 ? Math.round(v / 1000) + 'k' : Math.round(v / 1e6) + 'M';
}

function calendarHtml(monthList) {
    const y = ui.y, m = ui.m, dim = daysIn(y, m);
    const lead = new Date(y, m, 1).getDay();              // weeks start on Sunday
    const per = Array(dim).fill(0);
    monthList.forEach(e => {
        per[Number(e.date.slice(8, 10)) - 1] += Number(e.amt) || 0;
    });
    const sorted = per.filter(v => v > 0).sort((a, b) => a - b);
    // levels from quartiles so one huge day doesn't wash out the rest
    const q = p => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;
    const cuts = [q(0.25), q(0.5), q(0.75)];
    const level = v => (v <= 0 ? 0 : v <= cuts[0] ? 1 : v <= cuts[1] ? 2 : v <= cuts[2] ? 3 : 4);
    const today = todayStr();
    const t = new Date();
    const elapsed = (t.getFullYear() === y && t.getMonth() === m) ? t.getDate() : (new Date(y, m + 1, 0) < t ? dim : 0);
    const noSpend = per.slice(0, elapsed).filter(v => v === 0).length;
    const sel = ui.expF.day;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span class="cal-blank"></span>';
    for (let d = 1; d <= dim; d++) {
        const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
        const v = per[d - 1];
        const future = ds > today;
        const b = bsOn() ? toBS(ds) : null;
        cells += `<button class="cal-day lv${level(v)} ${ds === today ? 'today' : ''} ${ds === sel ? 'sel' : ''} ${future ? 'future' : ''}" data-day="${ds}"
      aria-label="${dayLabel(ds)}: ${v ? money(v) : 'nothing spent'}">
      <span class="cd">${d}</span>${b ? `<span class="cbs">${b.d}</span>` : ''}
      <span class="ca">${v ? calAmt(v) : ''}</span></button>`;
    }
    return `<div class="panel cal">
    <div class="cal-head">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-foot">
      <span>${elapsed ? `${noSpend} no-spend day${noSpend === 1 ? '' : 's'}` : ''}${bsOn() && bsMonthSpan(y, m) ? `${elapsed ? ' · ' : ''}${bsMonthSpan(y, m)}` : ''}</span>
      <span class="cal-key">Less <i class="lv1"></i><i class="lv2"></i><i class="lv3"></i><i class="lv4"></i> More</span>
    </div>
    ${sel ? '<button class="link cal-all" data-day="">Show the whole month</button>' : '<p class="cal-tip">Tap a day to see what you spent.</p>'}
  </div>`;
}

/* ----- Yearly ----- */
function renderYearly() {
    const Y = ui.year;
    const t = new Date();
    const rows = categoryRows(state.expenses.filter(e => e.date.startsWith(Y + '-')));
    const byCat = {};
    rows.forEach(r => {
        byCat[r.name] = Array(12).fill(0);
    });
    const expM = Array(12).fill(0);
    const incM = Array(12).fill(0);
    state.expenses.forEach(e => {
        if (!e.date.startsWith(Y + '-')) return;
        const mi = Number(e.date.slice(5, 7)) - 1;
        const key = e.cat || 'Uncategorized';
        byCat[key][mi] += Number(e.amt);
        expM[mi] += Number(e.amt);
    });
    state.income.forEach(i => {
        if (!i.date.startsWith(Y + '-')) return;
        incM[Number(i.date.slice(5, 7)) - 1] += Number(i.amt);
    });
    const sum = a => a.reduce((x, y) => x + y, 0);
    const totE = sum(expM), totI = sum(incM), saved = totI - totE;
    const activeMonths = expM.filter(v => v > 0).length;
    const maxIdx = expM.indexOf(Math.max(...expM));
    const curM = t.getFullYear() === Y ? t.getMonth() : -1;
    const cell = (v, cls = '') => `<td class="${cls} ${v ? '' : 'zero'}">${v ? money(v) : '–'}</td>`;

    $('#view-yearly').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Spent in ${Y}</div><div class="kpi-value">${moneyShort(totE)}</div>
        <div class="kpi-sub">${activeMonths ? `about ${moneyShort(totE / activeMonths)} a month` : 'No expenses yet'}</div></div>
      <div class="kpi"><div class="kpi-label">Income</div><div class="kpi-value pos">${moneyShort(totI)}</div></div>
      <div class="kpi"><div class="kpi-label">Saved</div><div class="kpi-value ${saved < 0 ? 'neg' : (saved > 0 ? 'pos' : '')}">${moneyShort(saved)}</div>
        <div class="kpi-sub">${totI ? `${Math.round(saved / totI * 100)}% savings rate` : ''}</div></div>
      <div class="kpi"><div class="kpi-label">Biggest month</div><div class="kpi-value">${totE ? MONTHS[maxIdx] : '—'}</div>
        <div class="kpi-sub">${totE ? moneyShort(expM[maxIdx]) : ''}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Income vs expenses</h2><span class="muted small">Tap a month</span></div>
      <canvas class="chart" id="yearChart"></canvas>
      <div class="chart-legend"><span><i style="background:${cssVar('--cobalt')}"></i>Spent</span><span><i style="background:${cssVar('--sun')}"></i>Earned</span></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>By category</h2><span class="muted small">Red = over budget</span></div>
      <div class="table-wrap">
        <table class="year">
          <thead><tr><th>Category</th>${MON.map((mn, i) => `<th class="${i === curM ? 'cur' : ''}">${mn}</th>`).join('')}<th>Total</th><th>Avg</th></tr></thead>
          <tbody>
            ${rows.filter(r => r.budget || sum(byCat[r.name])).map(r => {
        const arr = byCat[r.name];
        return `<tr><td>${esc(r.icon)} ${esc(r.name)}</td>
                ${arr.map((v, i) => cell(v, `${r.budget && v > r.budget ? 'over' : ''} ${i === curM ? 'cur' : ''}`)).join('')}
                ${cell(sum(arr), 'total-col')}${cell(Math.round(sum(arr) / 12))}</tr>`;
    }).join('')}
            <tr class="total"><td>Total expenses</td>${expM.map((v, i) => cell(v, i === curM ? 'cur' : '')).join('')}${cell(totE)}${cell(Math.round(totE / 12))}</tr>
            <tr class="inc"><td>Income</td>${incM.map((v, i) => cell(v, i === curM ? 'cur' : '')).join('')}${cell(totI)}${cell(Math.round(totI / 12))}</tr>
            <tr><td>Savings</td>${incM.map((v, i) => {
        const s = v - expM[i];
        return `<td class="${s < 0 ? 'over' : ''} ${s ? '' : 'zero'} ${i === curM ? 'cur' : ''}">${s ? money(s) : '–'}</td>`;
    }).join('')}<td class="${saved < 0 ? 'over' : ''}">${money(saved)}</td><td>${money(Math.round(saved / 12))}</td></tr>
            <tr><td>Savings rate</td>${incM.map((v, i) => `<td class="${v ? '' : 'zero'} ${i === curM ? 'cur' : ''}">${v ? Math.round((v - expM[i]) / v * 100) + '%' : '–'}</td>`).join('')}
              <td>${totI ? Math.round(saved / totI * 100) + '%' : '–'}</td><td></td></tr>
          </tbody>
        </table>
      </div>
    </div>`;

    requestAnimationFrame(() => {
        const cv = $('#yearChart');
        const narrow = cv.clientWidth < 380;
        drawBars(cv, narrow ? MON.map(x => x[0]) : MON, [
            {name: 'Expenses', data: expM, color: cssVar('--cobalt')},
            {name: 'Income', data: incM, color: cssVar('--sun')}
        ], {
            height: 200,
            tip: i => `${MONTHS[i]}: spent ${money(expM[i])} · earned ${money(incM[i])}`
        });
    });
}

/* ----- Settings ----- */
function renderSettings() {
    const s = state.settings;
    const budgetTotal = s.categories.reduce((a, c) => a + (Number(c.budget) || 0), 0);
    const tagCard = (title, key, list, placeholder) => `
    <div class="card">
      <h2>${title}</h2>
      <div class="chips">${list.map((p, i) => `<span class="tag">${esc(p)}<button data-act="del-${key}" data-i="${i}" aria-label="Remove ${esc(p)}">✕</button></span>`).join('')}</div>
      <div class="add-row"><input class="input" id="new-${key}" placeholder="${placeholder}" maxlength="30"><button class="btn" data-act="add-${key}">Add</button></div>
    </div>`;

    $('#view-settings').innerHTML = `
    <div class="card">
      <h2>Account</h2>
      <p class="sync-status" id="syncStatus"></p>
      ${syncReady() ? `
        <p class="muted small" id="syncServer"></p>
        <div class="btn-grid">
          <button class="btn primary" data-act="sync-now">🔄 Sync now</button>
          <button class="btn" data-act="sign-out">Sign out</button>
        </div>
        <div class="btn-grid" style="margin-top:8px">
          <button class="btn" data-act="pw-change">Change password</button>
          <button class="btn danger" data-act="acc-delete">Delete account</button>
        </div>`
        : `
        <p class="muted small" style="margin-top:0">Sign in to keep your data safe on the server and use it on more than one device. Only you can see your data.</p>
        <div class="segmented small" id="acMode" style="margin-bottom:12px">
          <button data-act="ac-mode" data-v="signin" class="${ui.acMode !== 'create' ? 'active' : ''}">Sign in</button>
          <button data-act="ac-mode" data-v="create" class="${ui.acMode === 'create' ? 'active' : ''}">Create account</button>
        </div>
        <form id="acForm" class="ac-form" novalidate>
          ${CONFIG_SERVER ? '' : `<div class="field"><label for="syncUrl">Server address</label>
            <input id="syncUrl" class="input" placeholder="https://your-computer.ts.net" value="${esc(sync.url)}" autocomplete="url" inputmode="url" autocapitalize="off"></div>`}
          <div class="field"><label for="acUser">Username</label>
            <input id="acUser" class="input" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32"></div>
          <div class="field"><label for="acPass">Password${ui.acMode === 'create' ? ' (8+ characters)' : ''}</label>
            <input id="acPass" class="input" type="password" autocomplete="${ui.acMode === 'create' ? 'new-password' : 'current-password'}" maxlength="200"></div>
          ${ui.acMode === 'create' ? `<div class="field"><label for="acInvite">Invite code</label>
            <input id="acInvite" class="input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="from the person who runs the server"></div>` : ''}
          <p class="form-error" id="acError"></p>
          <button type="submit" class="btn primary full" style="margin-top:4px">${ui.acMode === 'create' ? 'Create account' : 'Sign in'}</button>
        </form>`}
    </div>

    <div class="card">
      <h2>Appearance</h2>
      <div class="set-row"><span>Theme</span>
        <div class="segmented small">${['auto', 'light', 'dark'].map(t => `<button data-act="theme" data-v="${t}" class="${s.theme === t ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      </div>
      <div class="set-row"><label for="sCur">Currency symbol</label><input id="sCur" class="input sm" data-f="currency" value="${esc(s.currency)}" maxlength="5"></div>
      <div class="set-row"><span>Nepali dates (BS)</span>
        <div class="segmented small">${[['off', 'Off'], ['on', 'Show']].map(([v, l]) => `<button data-act="bs" data-v="${v}" class="${(v === 'on') === !!s.bsDates ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="set-row"><label for="sNum">Number format</label>
        <select id="sNum" class="input sm" data-f="numstyle"><option value="en-IN">1,00,000</option><option value="en-US">100,000</option></select>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><h2>Categories &amp; budgets</h2><span class="muted small">${budgetTotal ? money(budgetTotal) + ' / month' : 'No budgets (optional)'}</span></div>
      <div class="cat-head"><span></span><span>Icon</span><span>Name</span><span>Budget</span><span></span></div>
      <div class="cat-list">
        ${s.categories.map((c, i) => `
          <div class="cat-edit">
            <input type="color" value="${esc(c.color)}" data-f="cat-color" data-i="${i}" aria-label="Color for ${esc(c.name)}">
            <input class="input icon-in" value="${esc(c.icon)}" data-f="cat-icon" data-i="${i}" maxlength="4" aria-label="Icon">
            <input class="input" value="${esc(c.name)}" data-f="cat-name" data-i="${i}" maxlength="30" aria-label="Name">
            <input class="input budget-in" value="${c.budget || ''}" inputmode="decimal" placeholder="No budget" data-f="cat-budget" data-i="${i}" aria-label="Monthly budget">
            <button class="icon-btn danger" data-act="del-cat" data-i="${i}" aria-label="Delete ${esc(c.name)}">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn ghost full" data-act="add-cat">+ Add category</button>
      <div class="btn-grid" style="margin-top:10px">
        <button class="btn" data-act="suggest-budgets">💡 Suggest budgets</button>
        <button class="btn" data-act="clear-budgets">Clear all budgets</button>
      </div>
      <p class="muted small" style="margin-bottom:0">Leave a budget empty to just track that category without a limit.</p>
    </div>

    ${tagCard('Payment methods', 'pay', s.payments, 'e.g. Fonepay')}
    ${tagCard('Income sources', 'src', s.sources, 'e.g. Tuition')}

    <div class="card">
      <div class="card-head"><h2>Recurring</h2><span class="muted small">${state.recurring.length ? 'Tap to edit' : ''}</span></div>
      ${state.recurring.length ? `<div class="rec-list">${state.recurring.slice().sort((a, b) => a.next.localeCompare(b.next)).map(recRow).join('')}</div>`
        : '<p class="muted small" style="margin:0">Rent, subscriptions or allowance? When you add an entry, set <b>Repeat</b> to Weekly or Monthly and it will be added for you automatically.</p>'}
    </div>

    <div class="card">
      <h2>Daily reminder</h2>
      <div class="set-row"><span>Remind me</span>
        <div class="segmented small">${[['off', 'Off'], ['on', 'On']].map(([v, l]) => `<button data-act="rem" data-v="${v}" class="${(v === 'on') === !!s.reminder.on ? 'active' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="set-row"><label for="sRemTime">At</label><input id="sRemTime" type="time" class="input sm" data-f="rem-time" value="${esc(s.reminder.time)}"></div>
      ${s.reminder.on ? `
        <p class="muted small">You get this only on days you haven’t logged anything by ${esc(s.reminder.time)}.</p>
        <div class="rem-option">
          <b>Calendar reminder: always on time</b>
          <span class="muted small">Adds a repeating daily event, and your calendar app notifies you.</span>
          <div class="btn-grid">
            <button class="btn primary" data-act="rem-google">📅 Google Calendar</button>
            <button class="btn" data-act="rem-ics">🗓️ Other calendar</button>
          </div>
        </div>
        <div class="rem-option">
          <b>App notification: best effort</b>
          <span class="muted small">Android only. Chrome decides when to wake the app, so it can be late or skipped.</span>
          <ul class="checks" id="remChecks"><li class="muted">Checking…</li></ul>
          <div class="btn-grid">
            <button class="btn" data-act="rem-test">🔔 Send test</button>
            <button class="btn" data-act="rem-retry">Turn on again</button>
          </div>
        </div>` : '<p class="muted small" style="margin-bottom:0">A nudge to log your spending each evening, so the habit sticks.</p>'}
    </div>

    <div class="card">
      <h2>App lock</h2>
      <p class="muted small" style="margin-top:-4px">${s.pinHash ? 'A 4-digit PIN is needed to open the app (asked again after 1 minute away).' : 'Keep your spending private with a 4-digit PIN.'}</p>
      <div class="btn-grid">
        ${s.pinHash
        ? '<button class="btn" data-act="pin-set">Change PIN</button><button class="btn danger" data-act="pin-remove">Remove PIN</button>'
        : '<button class="btn" data-act="pin-set" style="grid-column:1/-1">🔒 Set a PIN</button>'}
      </div>
    </div>

    <div class="card">
      <h2>Install on your phone</h2>
      ${installCard()}
    </div>

    <div class="card">
      <h2>Your data</h2>
      <p class="muted small">${state.expenses.length} expenses · ${state.income.length} income entries · ${state.goals.length} goals · ${state.debts.length} lent/borrowed.
        Stored only on this device. ${s.lastBackup ? `Last backup: ${new Date(s.lastBackup).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    })}.` : 'No backup yet.'}</p>
      <button class="btn primary full" style="margin:0 0 8px" data-act="share-backup">☁️ Back up to Google Drive</button>
      <p class="muted small" style="margin-top:0">Opens your share menu: pick <b>Drive</b> (or any app) to save the file. To restore, tap Restore and choose the file from Drive.</p>
      <div class="btn-grid">
        <button class="btn" data-act="export-json">⬇️ Download</button>
        <button class="btn" data-act="import-json">⬆️ Restore</button>
        <button class="btn" data-act="export-csv">📄 Export CSV</button>
        <button class="btn" data-act="import-csv">📥 Import CSV</button>
      </div>
      <p class="muted small">Import CSV accepts this app's export or your Excel tracker's Expenses sheet saved as CSV. Entries are added, not replaced.</p>
      <div class="btn-grid">
        <button class="btn" data-act="sample">✨ Demo data</button>
        <button class="btn danger" data-act="erase">Erase all data</button>
      </div>
    </div>
    <p class="footnote">Expense Tracker · works offline · data never leaves your device</p>`;
    $('#sNum').value = s.numberStyle;
    renderSyncStatus();
    if (s.reminder.on && $('#remChecks')) {
        reminderChecks().then(c => {
            const el = $('#remChecks');
            if (!el) return;
            const row = (ok, good, bad) => `<li class="${ok ? 'ok' : 'bad'}"><span>${ok ? '✓' : '✗'}</span>${ok ? good : bad}</li>`;
            el.innerHTML = [
                row(c.installed, 'Installed on home screen', 'Not installed: open it from a home-screen icon, not a browser tab'),
                row(c.permission === 'granted', 'Notifications allowed', c.permission === 'denied' ? 'Notifications blocked: allow them in Chrome’s site settings' : c.permission === 'unsupported' ? 'This browser can’t show notifications' : 'Notifications not allowed yet: tap “Turn on again”'),
                row(c.bgSupported, 'Background checks supported', 'This browser can’t run reminders while closed (iPhone and most non-Chrome browsers)'),
                ...(c.bgSupported ? [row(c.bgRegistered, 'Daily check scheduled', 'Daily check not scheduled yet: install the app, then tap “Turn on again”')] : [])
            ].join('');
        });
    }
}

/* ---------- Charts (canvas, no libraries) ---------- */
function setupCanvas(cv, h) {
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 300;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return {ctx, w, h};
}

function drawDonut(cv, slices, sumV) {
    const {ctx, w, h} = setupCanvas(cv, 170);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 2, inner = r * 0.66;
    let a = -Math.PI / 2;
    const gap = slices.length > 1 ? 0.025 : 0;
    slices.forEach(s => {
        const sl = s.value / sumV * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, a + gap / 2, a + sl - gap / 2);
        ctx.arc(cx, cy, inner, a + sl - gap / 2, a + gap / 2, true);
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.fill();
        a += sl;
    });
}

function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function barPath(ctx, x, y, w, h, r) {
    if (h <= 0) return;
    r = Math.min(r, w / 2, h);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
}

function drawBars(cv, labels, series, opts = {}) {
    const {height = 200, labelIf = () => true, highlight = -1, highlightColor = null, tip} = opts;
    const {ctx, w, h} = setupCanvas(cv, height);
    const muted = cssVar('--muted'), grid = cssVar('--grid');
    const max = niceMax(Math.max(0, ...series.flatMap(s => s.data)));
    const padL = 42, padR = 4, padT = 8, padB = 22;
    const pw = w - padL - padR, ph = h - padT - padB;

    ctx.font = '11px ' + cssVar('--font');
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
        const v = max * i / 4;
        const yy = Math.round(padT + ph - (v / max) * ph) + 0.5;
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, yy);
        ctx.lineTo(w - padR, yy);
        ctx.stroke();
        ctx.fillStyle = muted;
        ctx.fillText(compact(v), padL - 8, yy);
    }

    const n = labels.length;
    const groupW = pw / n;
    const innerW = groupW * (series.length > 1 ? 0.74 : 0.66);
    const gap = series.length > 1 ? Math.min(2, innerW * 0.08) : 0;
    const bw = (innerW - gap * (series.length - 1)) / series.length;

    labels.forEach((lab, i) => {
        series.forEach((s, j) => {
            const v = s.data[i] || 0;
            const bh = (v / max) * ph;
            const x = padL + i * groupW + (groupW - innerW) / 2 + j * (bw + gap);
            ctx.fillStyle = highlightColor && i === highlight ? highlightColor : s.color;
            ctx.globalAlpha = highlight >= 0 && i !== highlight && !highlightColor ? 0.55 : 1;
            barPath(ctx, x, padT + ph - bh, bw, bh, Math.min(4, bw / 2));
            ctx.globalAlpha = 1;
        });
        if (labelIf(i)) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = i === highlight ? cssVar('--text') : muted;
            ctx.fillText(lab, padL + i * groupW + groupW / 2, h - padB + 7);
        }
    });

    cv._meta = {padL, groupW, n, tip};
}

/* ---------- Sheets (modals) + Android back button ---------- */
function showSheet(sel) {
    $(sel).hidden = false;
    document.body.style.overflow = 'hidden';
    history.pushState({sheet: sel}, '');
}

function hideSheet(sel, fromPop = false) {
    const el = $(sel);
    if (el.hidden) return;
    el.hidden = true;
    if (!$$('.modal').some(m => !m.hidden)) document.body.style.overflow = '';
    if (!fromPop && history.state && history.state.sheet === sel) history.back();
}

/* ---------- Add / edit form ---------- */
function setFormType(type) {
    ui.formType = type;
    const isExp = type === 'expense';
    $$('#typeToggle button').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    $('#catField').hidden = !isExp;
    $('#payField').hidden = !isExp;
    $('#srcField').hidden = isExp;
    $('#formTitle').textContent = `${ui.editing ? 'Edit' : 'Add'} ${isExp ? 'expense' : 'income'}`;
    $('#fDesc').placeholder = isExp ? 'e.g. Momo with friends' : 'e.g. November allowance';
    $('#splitField').hidden = !!ui.editing || !isExp;
    $('#repeatField').hidden = !!ui.editing || (isExp && ui.split.on);
    $('#deleteTx').hidden = !ui.editing;
    $('#dupTx').hidden = !ui.editing;
    // description suggestions
    const src = isExp ? state.expenses : state.income;
    $('#descList').innerHTML = uniq(src.slice().sort(sortTx).map(x => x.desc)).slice(0, 80)
        .map(d => `<option value="${esc(d)}"></option>`).join('');
    renderQuick();
}

function renderQuick() {
    const show = !ui.editing && ui.formType === 'expense';
    const counts = new Map();
    if (show) {
        state.expenses.slice().sort(sortTx).slice(0, 400).forEach(e => {
            if (!e.desc) return;
            const k = `${e.desc}|${e.cat}|${e.amt}`;
            const c = counts.get(k) || {e, n: 0};
            c.n++;
            counts.set(k, c);
        });
    }
    const picks = [...counts.values()].filter(c => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
    $('#quickField').hidden = !picks.length;
    $('#fQuick').innerHTML = picks.map((c, i) =>
        `<button type="button" data-q="${i}">${esc(catInfo(c.e.cat).icon)} ${esc(c.e.desc)} <small>${money(c.e.amt)}</small></button>`).join('');
    ui.quickPicks = picks.map(c => c.e);
}

function renderCatChips() {
    const cats = [...state.settings.categories];
    if (ui.formCat && !cats.some(c => c.name === ui.formCat)) cats.push(catInfo(ui.formCat));
    $('#fCatChips').innerHTML = cats.map(c => `
    <button type="button" class="chip ${c.name === ui.formCat ? 'active' : ''}" data-cat="${esc(c.name)}" style="--c:${c.color}">
      <span class="ci">${esc(c.icon)}</span><span>${esc(c.name)}</span>
    </button>`).join('');
}

function setRepeat(r) {
    ui.formRepeat = r;
    $$('#fRepeat button').forEach(b => b.classList.toggle('active', b.dataset.r === r));
}

function updateDateBS() {
    const v = $('#fDate').value;
    $('#fDateBS').textContent = bsOn() && v ? bsFull(v) : '';
}

function updateAmtHint() {
    const inp = $('#fAmt');
    const raw = inp.value;
    const hint = $('#amtHint');
    if (/[+\-*/×÷x()]/.test(raw)) {
        const v = parseAmount(raw);
        hint.textContent = isNaN(v) ? '…' : '= ' + money(Math.round(v * 100) / 100);
        hint.classList.add('calc');
    } else {
        hint.textContent = 'Adding up a bill? Use + − × ÷';
        hint.classList.remove('calc');
    }
}

/* ----- Split a bill ----- */
function knownPeople() {
    return uniq([...state.debts.slice().reverse().map(d => d.person)]).slice(0, 40);
}

function renderSplit() {
    const sp = ui.split;
    $('#splitToggle').setAttribute('aria-expanded', String(sp.on));
    $('#splitToggle').classList.toggle('on', sp.on);
    $('#splitToggle span').textContent = sp.on ? 'Splitting this bill' : 'Split this bill with friends';
    $('#splitBox').hidden = !sp.on;
    if (!sp.on) return;
    $('#splitPeople').innerHTML = sp.people.map((p, i) =>
            `<span class="tag">${esc(p)}<button type="button" data-sdel="${i}" aria-label="Remove ${esc(p)}">✕</button></span>`).join('')
        || '<span class="muted small">Add the people you shared it with.</span>';
    $('#peopleList').innerHTML = knownPeople().filter(p => !sp.people.includes(p)).map(p => `<option value="${esc(p)}"></option>`).join('');
    if (!sp.people.includes(sp.payer)) sp.payer = 'me';
    fillSelect($('#splitPayer'), [['me', 'I paid'], ...sp.people.map(p => [p, `${p} paid`])], sp.payer);
    $('#splitPayer').value = sp.payer;
    updateSplitSum();
}

function updateSplitSum() {
    const sp = ui.split;
    if (!sp.on) return;
    const totalAmt = parseAmount($('#fAmt').value);
    const n = sp.people.length + 1;
    const el = $('#splitSum');
    if (!sp.people.length || !(totalAmt > 0)) {
        el.textContent = sp.people.length ? 'Enter the full bill amount above.' : '';
        return;
    }
    const share = Math.round(totalAmt / n * 100) / 100;
    const names = sp.people.length === 1 ? sp.people[0] : sp.people.slice(0, -1).join(', ') + ' and ' + sp.people[sp.people.length - 1];
    el.innerHTML = sp.payer === 'me'
        ? `Your share <b>${money(share)}</b> is saved as the expense. ${esc(names)} ${sp.people.length === 1 ? 'owes' : 'each owe'} you <b>${money(share)}</b>.`
        : `Your share <b>${money(share)}</b> is saved as the expense. You owe ${esc(sp.payer)} <b>${money(share)}</b>.`;
}

function addSplitPerson() {
    const inp = $('#splitName');
    const v = inp.value.trim();
    if (!v) return;
    if (ui.split.people.some(p => p.toLowerCase() === v.toLowerCase())) {
        toast(`${v} is already added`);
        return;
    }
    ui.split.people.push(v);
    inp.value = '';
    renderSplit();
    inp.focus();
}

function openForm(type = 'expense', id = null) {
    ui.editing = id;
    const rec = id ? (type === 'expense' ? state.expenses : state.income).find(x => x.id === id) : null;
    if (id && !rec) return;

    $('#typeToggle').hidden = !!rec;
    $('#curSym').textContent = state.settings.currency || '';
    $('#fAmt').value = rec ? rec.amt : '';
    $('#fDate').value = rec ? rec.date : todayStr();
    $('#fDesc').value = rec ? (rec.desc || '') : '';
    $('#fNotes').value = rec ? (rec.notes || '') : '';
    $('#formError').textContent = '';
    ui.formCat = rec && type === 'expense' ? rec.cat : (ui.presetCat || '');
    ui.presetCat = '';
    setRepeat('none');
    ui.split = {on: false, people: [], payer: 'me'};
    renderSplit();

    fillSelect($('#fPay'), allPays().map(p => [p, p]), rec && type === 'expense' ? rec.pay : state.settings.lastPay);
    if (!$('#fPay').value && $('#fPay').options.length) $('#fPay').selectedIndex = 0;
    fillSelect($('#fSrc'), allSources().map(s => [s, s]), rec && type === 'income' ? rec.src : '');
    if (!$('#fSrc').value && $('#fSrc').options.length) $('#fSrc').selectedIndex = 0;

    setFormType(type);
    renderCatChips();
    updateAmtHint();
    updateDateBS();
    showSheet('#modal');
    if (!rec) setTimeout(() => $('#fAmt').focus(), 150);
}

function closeForm() {
    hideSheet('#modal');
    ui.editing = null;
}

function duplicateForm() {
    ui.editing = null;
    $('#typeToggle').hidden = true;
    $('#fDate').value = todayStr();
    updateDateBS();
    setRepeat('none');
    setFormType(ui.formType);
    toast('Copy ready. Change anything and tap Save.');
}

function catMonthSpent(cat, date) {
    const k = date.slice(0, 7);
    return total(state.expenses.filter(e => e.cat === cat && e.date.startsWith(k)));
}

function budgetAlert(cat, date, before) {
    const c = state.settings.categories.find(x => x.name === cat);
    if (!c || !c.budget) return null;
    const after = catMonthSpent(cat, date);
    const d = parseDate(date), t = new Date();
    const when = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() ? '' : ` in ${MON[d.getMonth()]}`;
    if (after > c.budget && before <= c.budget) return `⚠️ ${cat} is over budget${when} by ${money(after - c.budget)}`;
    if (after >= 0.8 * c.budget && before < 0.8 * c.budget && after <= c.budget) return `Heads up: ${cat} is at ${Math.round(after / c.budget * 100)}% of its budget${when}`;
    return null;
}

function submitForm(e) {
    e.preventDefault();
    const type = ui.formType;
    const isExp = type === 'expense';
    const amt = parseAmount($('#fAmt').value);
    const date = $('#fDate').value;
    const err = msg => {
        $('#formError').textContent = msg;
    };

    if (!(amt > 0)) return err('Enter an amount greater than 0.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Pick a date.');
    if (isExp && !ui.formCat) return err('Pick a category.');

    const arr = isExp ? state.expenses : state.income;
    const existing = ui.editing ? arr.find(x => x.id === ui.editing) : null;
    const before = isExp ? catMonthSpent(ui.formCat, date) : 0;
    const rec = {
        id: existing ? existing.id : uid(),
        date,
        amt: Math.round(amt * 100) / 100,
        desc: $('#fDesc').value.trim(),
        notes: $('#fNotes').value.trim(),
        created: existing ? existing.created : Date.now()
    };
    if (isExp) {
        rec.cat = ui.formCat;
        rec.pay = $('#fPay').value;
        state.settings.lastPay = rec.pay;
    } else {
        rec.src = $('#fSrc').value;
    }

    let ruleMsg = '';
    if (!existing && ui.formRepeat !== 'none') {
        const rule = {
            id: uid(), type, amt: rec.amt, desc: rec.desc, notes: rec.notes,
            cat: rec.cat, pay: rec.pay, src: rec.src,
            freq: ui.formRepeat, day: parseDate(date).getDate(), start: date, active: true
        };
        rule.next = advance(rule, date);
        rec.recId = rule.id;
        state.recurring.push(rule);
        ruleMsg = ` · repeats ${rule.freq}`;
    }

    // split bill: only your share is the expense; the rest goes to Lent & borrowed
    let splitMsg = '';
    if (!existing && isExp && ui.split.on) {
        const sp = ui.split;
        if (!sp.people.length) return err('Add at least one person to split with, or turn splitting off.');
        const n = sp.people.length + 1;
        const share = Math.round(rec.amt / n * 100) / 100;
        const what = rec.desc || rec.cat;
        rec.notes = [rec.notes, `Split ${n} ways, bill ${money(rec.amt)}`].filter(Boolean).join(' · ');
        rec.amt = share;
        if (sp.payer === 'me') {
            sp.people.forEach(p => state.debts.push({
                id: uid(),
                dir: 'lent',
                person: p,
                amt: share,
                date,
                due: '',
                note: `Split: ${what}`,
                payments: [],
                settled: false,
                created: Date.now()
            }));
            splitMsg = `Your share ${money(share)} saved. ${sp.people.length === 1 ? `${sp.people[0]} owes` : `${sp.people.length} people each owe`} you ${money(share)}`;
        } else {
            state.debts.push({
                id: uid(),
                dir: 'borrowed',
                person: sp.payer,
                amt: share,
                date,
                due: '',
                note: `Split: ${what}`,
                payments: [],
                settled: false,
                created: Date.now()
            });
            splitMsg = `Your share ${money(share)} saved. You owe ${sp.payer} ${money(share)}`;
        }
    }

    const prevCopy = existing ? {...existing} : null;
    if (existing) Object.assign(existing, rec);
    else arr.push(rec);
    const added = runRecurring(true);
    save();
    closeForm();
    if (navigator.vibrate) navigator.vibrate(12);

    const d = parseDate(date);
    const elsewhere = !existing && (d.getFullYear() !== ui.y || d.getMonth() !== ui.m) && ui.view !== 'yearly';
    const alert = isExp ? budgetAlert(rec.cat, date, before) : null;
    if (existing && !alert) {
        toast(`${isExp ? 'Expense' : 'Income'} updated`, 'Undo', () => {
            Object.assign(existing, prevCopy);
            save();
            render();
        });
    } else {
        toast(alert || splitMsg || `${isExp ? 'Expense' : 'Income'} ${existing ? 'updated' : 'saved'}${elsewhere ? ` in ${MON[d.getMonth()]} ${d.getFullYear()}` : ''}${ruleMsg}${added ? ` (+${added} past repeats)` : ''}`);
    }
    render();
}

function deleteTx(type, id) {
    const arr = type === 'expense' ? state.expenses : state.income;
    const idx = arr.findIndex(x => x.id === id);
    if (idx < 0) return;
    const [removed] = arr.splice(idx, 1);
    save();
    render();
    toast('Deleted', 'Undo', () => {
        (type === 'expense' ? state.expenses : state.income).splice(idx, 0, removed);
        save();
        render();
    });
}

/* ---------- Recurring ---------- */
function advance(r, d) {
    const dt = parseDate(d);
    if (r.freq === 'weekly') {
        dt.setDate(dt.getDate() + 7);
        return ymd(dt);
    }
    const y = dt.getFullYear() + Math.floor((dt.getMonth() + 1) / 12);
    const m = (dt.getMonth() + 1) % 12;
    return ymd(new Date(y, m, Math.min(r.day, daysIn(y, m))));
}

// Adds any repeats that are due (up to today). Returns how many were added.
function runRecurring(silent = false) {
    const today = todayStr();
    let added = 0;
    state.recurring.forEach(r => {
        if (!r.active) return;
        let guard = 0;
        while (r.next <= today && guard++ < 500) {
            const base = {
                id: uid(),
                date: r.next,
                amt: r.amt,
                desc: r.desc,
                notes: r.notes || '',
                recId: r.id,
                created: Date.now() + added
            };
            if (r.type === 'income') state.income.push({...base, src: r.src});
            else state.expenses.push({...base, cat: r.cat, pay: r.pay});
            added++;
            r.next = advance(r, r.next);
        }
    });
    if (added && !silent) {
        save();
        toast(`${added} recurring entr${added > 1 ? 'ies' : 'y'} added`);
    }
    return added;
}

function recRow(r) {
    const isExp = r.type !== 'income';
    const c = isExp ? catInfo(r.cat) : {icon: '💰', color: '#2F9E6B'};
    const when = r.freq === 'weekly' ? `Every ${WEEKDAYS[parseDate(r.start).getDay()]}` : `Monthly on day ${r.day}`;
    return `<div class="rec-row ${r.active ? '' : 'paused'}">
    <span class="tx-icon" style="background:${c.color}22;color:${c.color}">${esc(c.icon)}</span>
    <button class="tx-main" data-act="rec-edit" data-id="${esc(r.id)}" style="text-align:left">
      <span class="tx-title">${esc(r.desc || r.cat || r.src)}</span>
      <span class="tx-sub">${when} · ${r.active ? 'next ' + dayLabel(r.next) : 'paused'}</span>
    </button>
    <span class="rec-side">
      <span class="tx-amt ${isExp ? '' : 'pos'}">${isExp ? '−' : '+'}${money(r.amt)}</span>
      <span class="rec-btns">
        <button class="icon-btn" data-act="rec-toggle" data-id="${esc(r.id)}" aria-label="${r.active ? 'Pause' : 'Resume'}">
          ${r.active ? '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>'}
        </button>
        <button class="icon-btn danger" data-act="rec-del" data-id="${esc(r.id)}" aria-label="Delete">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </span>
    </span>
  </div>`;
}

function editRecurring(id) {
    const r = state.recurring.find(x => x.id === id);
    if (!r) return;
    openDialog({
        title: 'Edit recurring',
        fields: [
            {key: 'amt', label: 'Amount', value: r.amt, inputmode: 'decimal'},
            {key: 'desc', label: 'Description', value: r.desc},
            {key: 'next', label: 'Next date', value: r.next, type: 'date'}
        ],
        note: 'Changes apply to future entries only.',
        onSubmit: v => {
            const amt = parseAmount(v.amt);
            if (!(amt > 0)) return 'Enter an amount greater than 0.';
            if (!v.next) return 'Pick the next date.';
            r.amt = Math.round(amt * 100) / 100;
            r.desc = v.desc.trim();
            r.next = v.next;
            r.day = parseDate(v.next).getDate();
            if (r.freq === 'weekly') r.start = v.next;
            runRecurring();
            save();
            renderSettings();
        },
        onDelete: () => {
            state.recurring = state.recurring.filter(x => x.id !== id);
            save();
            renderSettings();
            toast('Recurring entry removed');
        }
    });
}

/* ---------- Generic dialog ---------- */
let dlg = null;

function openDialog({title, fields, note = '', top = '', submitLabel = 'Save', onSubmit, onDelete, extra = []}) {
    dlg = {fields, onSubmit, onDelete, extra};
    $('#dTitle').textContent = title;
    $('#dBody').innerHTML = top + fields.map(f => `
    <div class="field">
      <label for="d_${f.key}">${f.label}</label>
      ${f.type === 'select'
        ? `<select id="d_${f.key}" class="input">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : `<input id="d_${f.key}" class="input" type="${f.type || 'text'}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}
        value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}" maxlength="${f.max || 60}" autocomplete="off">`}
    </div>`).join('') + (note ? `<p class="muted small" style="margin:0">${note}</p>` : '');
    $('#dActions').innerHTML = `${onDelete ? '<button type="button" class="btn danger" data-dact="delete">Delete</button>' : ''}
    ${extra.map((x, i) => `<button type="button" class="btn ${x.cls || ''}" data-dact="x${i}">${x.label}</button>`).join('')}
    <button type="submit" class="btn primary">${submitLabel}</button>`;
    $('#dError').textContent = '';
    showSheet('#dialog');
}

function submitDialog(e) {
    e.preventDefault();
    if (!dlg) return;
    const v = {};
    dlg.fields.forEach(f => {
        v[f.key] = $('#d_' + f.key).value;
    });
    const errMsg = dlg.onSubmit(v);
    if (errMsg) {
        $('#dError').textContent = errMsg;
        return;
    }
    hideSheet('#dialog');
    dlg = null;
}

/* ---------- Savings goals ---------- */
function openGoal(id = null) {
    const g = id ? state.goals.find(x => x.id === id) : null;
    const fields = [
        {key: 'icon', label: 'Icon', value: g ? g.icon : '🎯', max: 4},
        {key: 'name', label: 'Goal name', value: g ? g.name : '', placeholder: 'e.g. New phone', max: 40},
        {key: 'target', label: 'Target amount', value: g ? g.target : '', inputmode: 'decimal', placeholder: '60000'}
    ];
    if (g) fields.push({
        key: 'add',
        label: `Add money (saved so far: ${money(g.saved)})`,
        value: '',
        inputmode: 'decimal',
        placeholder: 'e.g. 2000, or -500 to take out'
    });
    else fields.push({key: 'saved', label: 'Already saved', value: '', inputmode: 'decimal', placeholder: '0'});
    fields.push({key: 'deadline', label: 'Target date (optional)', value: g ? (g.deadline || '') : '', type: 'date'});

    openDialog({
        title: g ? 'Update goal' : 'New savings goal',
        fields,
        onSubmit: v => {
            const target = parseAmount(v.target);
            if (!v.name.trim()) return 'Give your goal a name.';
            if (!(target > 0)) return 'Enter a target amount.';
            const goal = g || {id: uid(), saved: 0};
            goal.icon = v.icon.trim() || '🎯';
            goal.name = v.name.trim();
            goal.target = Math.round(target * 100) / 100;
            goal.deadline = v.deadline || '';
            if (g) {
                const add = v.add ? parseAmount(v.add) : 0;
                if (isNaN(add)) return 'The amount to add isn’t a number.';
                goal.saved = Math.max(0, Math.round((goal.saved + add) * 100) / 100);
            } else {
                const sv = v.saved ? parseAmount(v.saved) : 0;
                if (isNaN(sv) || sv < 0) return 'Already saved must be a number.';
                goal.saved = Math.round(sv * 100) / 100;
                state.goals.push(goal);
            }
            save();
            render();
            if (goal.saved >= goal.target) toast(`🎉 You reached "${goal.name}"!`);
            else toast(g ? 'Goal updated' : 'Goal added');
        },
        onDelete: g ? () => {
            if (!confirm(`Delete the goal "${g.name}"?`)) return;
            state.goals = state.goals.filter(x => x.id !== g.id);
            save();
            render();
        } : null
    });
}

/* ---------- Lent & borrowed ---------- */
const debtLeft = d => Math.max(0, Math.round((d.amt - (d.payments || []).reduce((a, p) => a + p.amt, 0)) * 100) / 100);

function debtTotals() {
    const open = state.debts.filter(d => !d.settled && debtLeft(d) > 0);
    return {
        open,
        owedToMe: open.filter(d => d.dir === 'lent').reduce((a, d) => a + debtLeft(d), 0),
        iOwe: open.filter(d => d.dir === 'borrowed').reduce((a, d) => a + debtLeft(d), 0)
    };
}

function dueText(d) {
    if (!d.due || d.settled) return '';
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    const n = Math.round((parseDate(d.due) - t) / 864e5);
    if (n < 0) return `<span class="overdue">${-n} day${n === -1 ? '' : 's'} overdue</span>`;
    if (n === 0) return '<span class="overdue">due today</span>';
    return `due ${n === 1 ? 'tomorrow' : `in ${n} days`}`;
}

function debtRow(d) {
    const left = debtLeft(d);
    const paid = d.amt - left;
    const lent = d.dir === 'lent';
    const sub = [lent ? 'owes you' : 'you owe', dueText(d), paid > 0 && left > 0 ? `${money(paid)} paid back` : '', d.note ? esc(d.note) : '']
        .filter(Boolean).join(' · ');
    return `<button class="tx debt ${d.settled || !left ? 'settled' : ''}" data-debt="${esc(d.id)}">
    <span class="tx-icon" style="background:${lent ? 'color-mix(in srgb, var(--flag-green) 18%, var(--paper))' : 'color-mix(in srgb, var(--flag-red) 15%, var(--paper))'}">${lent ? '🤝' : '🙏'}</span>
    <span class="tx-main"><span class="tx-title">${esc(d.person)}</span><span class="tx-sub">${d.settled || !left ? 'settled' : sub}</span></span>
    <span class="tx-amt ${lent ? 'pos' : 'neg'}">${money(d.settled ? d.amt : left)}</span>
  </button>`;
}

function renderDebts() {
    const {open, owedToMe, iOwe} = debtTotals();
    const done = state.debts.filter(d => d.settled || debtLeft(d) <= 0);
    const sortOpen = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || b.date.localeCompare(a.date);
    const lent = open.filter(d => d.dir === 'lent').sort(sortOpen);
    const borrowed = open.filter(d => d.dir === 'borrowed').sort(sortOpen);
    $('#view-debts').innerHTML = `
    <div class="ledger two">
      ${statHtml('Owed to you', moneyShort(owedToMe), owedToMe ? 'pos' : '', `${lent.length} ${lent.length === 1 ? 'person' : 'people'}`)}
      ${statHtml('You owe', moneyShort(iOwe), iOwe ? 'neg' : '', `${borrowed.length} ${borrowed.length === 1 ? 'person' : 'people'}`)}
    </div>
    ${!state.debts.length ? `<div class="card">${empty('🤝', 'Nobody owes anybody', 'Lent a friend money or borrowed some? Add it here so you don’t forget. It isn’t counted as spending.', false)}
      <button class="btn primary full" data-act="debt-new">Add lent or borrowed money</button></div>` : ''}
    ${lent.length ? `<section class="block"><h2>They owe you</h2><div class="panel tx-list">${lent.map(debtRow).join('')}</div></section>` : ''}
    ${borrowed.length ? `<section class="block"><h2>You owe</h2><div class="panel tx-list">${borrowed.map(debtRow).join('')}</div></section>` : ''}
    ${done.length ? `<section class="block"><h2>Settled</h2><div class="panel tx-list">${done.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map(debtRow).join('')}</div></section>` : ''}
    <p class="note">Lending and borrowing are kept separate from your expenses and income, so they don’t change your spending totals.</p>`;
}

function openDebt(id = null) {
    const d = id ? state.debts.find(x => x.id === id) : null;
    if (!d) {
        return openDialog({
            title: 'Lent or borrowed',
            fields: [
                {
                    key: 'dir',
                    label: 'What happened?',
                    type: 'select',
                    value: 'lent',
                    options: [['lent', 'I lent money to someone'], ['borrowed', 'I borrowed money from someone']]
                },
                {key: 'person', label: 'Who?', placeholder: 'e.g. Rajesh', max: 40},
                {key: 'amt', label: 'Amount', inputmode: 'decimal', placeholder: '500'},
                {key: 'date', label: 'Date', type: 'date', value: todayStr()},
                {key: 'due', label: 'Pay back by (optional)', type: 'date'},
                {key: 'note', label: 'Note (optional)', placeholder: 'e.g. Concert tickets', max: 80}
            ],
            submitLabel: 'Add',
            onSubmit: v => {
                const amt = parseAmount(v.amt);
                if (!v.person.trim()) return 'Who was it?';
                if (!(amt > 0)) return 'Enter an amount greater than 0.';
                state.debts.push({
                    id: uid(),
                    dir: v.dir,
                    person: v.person.trim(),
                    amt: Math.round(amt * 100) / 100,
                    date: v.date || todayStr(),
                    due: v.due || '',
                    note: v.note.trim(),
                    payments: [],
                    settled: false,
                    created: Date.now()
                });
                save();
                render();
                toast(v.dir === 'lent' ? `Noted: ${v.person.trim()} owes you ${money(amt)}` : `Noted: you owe ${v.person.trim()} ${money(amt)}`);
            }
        });
    }
    const left = debtLeft(d);
    const lent = d.dir === 'lent';
    const history = (d.payments || []).map(p => `<li><span>${dayLabel(p.date)}</span><b>${money(p.amt)}</b></li>`).join('');
    openDialog({
        title: d.person,
        top: `<div class="debt-sum">
        <span>${lent ? 'Lent' : 'Borrowed'} ${money(d.amt)} on ${dayLabel(d.date)}</span>
        <strong class="${lent ? 'pos' : 'neg'}">${d.settled || !left ? 'Settled' : `${money(left)} ${lent ? 'still owed to you' : 'still to pay'}`}</strong>
        ${history ? `<ul class="pay-hist">${history}</ul>` : ''}
      </div>`,
        fields: [
            ...(!d.settled && left ? [{
                key: 'pay',
                label: lent ? 'They paid back (optional)' : 'I paid back (optional)',
                inputmode: 'decimal',
                placeholder: `up to ${money(left)}`
            }] : []),
            {key: 'person', label: 'Who?', value: d.person, max: 40},
            {key: 'amt', label: 'Original amount', value: d.amt, inputmode: 'decimal'},
            {key: 'due', label: 'Pay back by', type: 'date', value: d.due || ''},
            {key: 'note', label: 'Note', value: d.note || '', max: 80}
        ],
        extra: !d.settled && left ? [{
            label: 'Settled', fn: () => {
                const rest = debtLeft(d);
                if (rest > 0) d.payments.push({date: todayStr(), amt: rest});
                d.settled = true;
                save();
                render();
                toast(`${d.person}: all settled 🎉`);
            }
        }] : [],
        onSubmit: v => {
            const amt = parseAmount(v.amt);
            if (!v.person.trim()) return 'Who was it?';
            if (!(amt > 0)) return 'Enter an amount greater than 0.';
            d.person = v.person.trim();
            d.amt = Math.round(amt * 100) / 100;
            d.due = v.due || '';
            d.note = v.note.trim();
            if (v.pay) {
                const p = parseAmount(v.pay);
                if (!(p > 0)) return 'Paid back must be a number greater than 0.';
                d.payments.push({date: todayStr(), amt: Math.round(Math.min(p, debtLeft(d)) * 100) / 100});
            }
            if (debtLeft(d) <= 0) d.settled = true;
            save();
            render();
            toast(d.settled ? `${d.person}: all settled 🎉` : v.pay ? `Recorded. ${money(debtLeft(d))} left` : 'Saved');
        },
        onDelete: () => {
            if (!confirm(`Delete this record for ${d.person}?`)) return;
            state.debts = state.debts.filter(x => x.id !== d.id);
            save();
            render();
        }
    });
}

/* ---------- Daily reminder ---------- */

// Tiny key-value store the service worker can also read (it can't read localStorage)
function idb(mode, fn) {
    return new Promise(resolve => {
        try {
            const r = indexedDB.open('expense-tracker-sw', 1);
            r.onupgradeneeded = () => r.result.createObjectStore('kv');
            r.onsuccess = () => {
                const tx = r.result.transaction('kv', mode);
                const out = fn(tx.objectStore('kv'));
                tx.oncomplete = () => resolve(out && out.result);
                tx.onerror = () => resolve(null);
            };
            r.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

function loggedToday() {
    const t = todayStr();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return [...state.expenses, ...state.income].some(x => x.date === t || (x.created || 0) >= start.getTime());
}

function syncReminderState() {
    const r = state.settings.reminder;
    idb('readwrite', s => s.put({on: !!r.on, time: r.time, lastLog: loggedToday() ? todayStr() : null}, 'reminder'));
}

function reminderDue() {
    const r = state.settings.reminder;
    if (!r.on || loggedToday()) return false;
    const [hh, mm] = r.time.split(':').map(Number);
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes() >= hh * 60 + mm;
}

async function enableBackgroundReminder() {
    try {
        if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'unsupported';
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return 'denied';
        const reg = await navigator.serviceWorker.ready;
        if (!('periodicSync' in reg)) return 'no-bg';
        const st = await navigator.permissions.query({name: 'periodic-background-sync'}).catch(() => ({state: 'denied'}));
        if (st.state !== 'granted') return 'no-bg';
        await reg.periodicSync.register('daily-reminder', {minInterval: 4 * 3600 * 1000});
        return 'ok';
    } catch (e) {
        return 'no-bg';
    }
}

function reminderCalendarLinks() {
    const [hh, mm] = state.settings.reminder.time.split(':').map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    const end = new Date(d.getTime() + 5 * 60000);
    const fmt = x => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    const app = location.protocol.startsWith('http') ? location.origin + location.pathname : '';
    const details = `Open Expense Tracker and add what you spent today.${app ? ' ' + app : ''}`;
    const google = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
        + `&text=${encodeURIComponent("Log today's expenses")}&dates=${fmt(d)}/${fmt(end)}`
        + `&recur=${encodeURIComponent('RRULE:FREQ=DAILY')}&details=${encodeURIComponent(details)}`;
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Expense Tracker//EN', 'BEGIN:VEVENT',
        `UID:expense-reminder-${Date.now()}@expense-tracker`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
        `DTSTART:${fmt(d)}`, 'DURATION:PT5M', 'RRULE:FREQ=DAILY', "SUMMARY:Log today's expenses", `DESCRIPTION:${details}`,
        'BEGIN:VALARM', 'ACTION:DISPLAY', "DESCRIPTION:Log today's expenses", 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    return {google, ics};
}

// What's working and what isn't, so the user can see why a notification didn't arrive
async function reminderChecks() {
    const out = {
        installed: window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone,
        permission: 'Notification' in window ? Notification.permission : 'unsupported',
        bgSupported: false,
        bgRegistered: false
    };
    try {
        const reg = await navigator.serviceWorker.ready;
        out.bgSupported = 'periodicSync' in reg;
        if (out.bgSupported) out.bgRegistered = (await reg.periodicSync.getTags()).includes('daily-reminder');
    } catch (e) { /* ignore */
    }
    return out;
}

async function testNotification() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return toast('This browser can’t show notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return toast('Notifications are blocked. Allow them in your browser’s site settings.');
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Test from Expense Tracker', {
        body: 'Notifications work on this phone.',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: 'test',
        data: {url: './'}
    });
    toast('Test sent. Check your notification shade.');
}

/* ---------- Backup to Google Drive (via the share menu) ---------- */
function backupText() {
    const copy = JSON.parse(JSON.stringify(state));
    copy.settings.pinHash = null; // never put the PIN in a backup
    return JSON.stringify(copy, null, 2);
}

async function shareBackup() {
    // Phones only allow sharing certain file types, so the backup goes out as .txt (Restore reads it fine)
    const file = new File([backupText()], `expense-backup-${todayStr()}.txt`, {type: 'text/plain'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
        try {
            await navigator.share({files: [file], title: 'Expense Tracker backup'});
            state.settings.lastBackup = Date.now();
            save();
            render();
            toast('Backup sent. Pick Drive to keep it safe.');
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    exportJSON();
    toast('Sharing isn’t available here, so the backup was downloaded instead.');
}

/* ---------- Account & sync with the server ----------
   The app keeps working offline from its own copy. When it can reach the
   server it sends what changed since the last sync (found by comparing each
   record with a fingerprint taken at that sync) and pulls changes made on the
   user's other devices. Each account only ever sees its own data. */
const SYNC_STORE = 'expense-tracker-sync';
const SYNC_COLLS = ['expenses', 'income', 'recurring', 'goals', 'debts'];
const DEVICE_ONLY = ['pinHash', 'theme', 'reminder', 'lastPay', 'lastBackup', 'budgetsCleanV2'];
const CONFIG_SERVER = ((window.EXPENSE_CONFIG && window.EXPENSE_CONFIG.serverUrl) || '').trim().replace(/\/+$/, '');
let sync = loadSync();
let syncBusy = false, syncAgain = false, syncTimer = null;

function loadSync() {
    const base = {url: '', token: '', user: '', owner: '', rev: 0, snap: {}, last: 0, error: ''};
    try {
        const s = {...base, ...JSON.parse(localStorage.getItem(SYNC_STORE) || '{}')};
        if (s.key && !s.token) {
            s.key = undefined;
            s.rev = 0;
            s.snap = {};
        } // from the old one-key version
        return s;
    } catch (e) {
        return base;
    }
}

function saveSync() {
    try {
        localStorage.setItem(SYNC_STORE, JSON.stringify(sync));
    } catch (e) { /* ignore */
    }
}

const serverUrl = () => (sync.url || CONFIG_SERVER || '').replace(/\/+$/, '');
const syncReady = () => !!(serverUrl() && sync.token);

function fingerprint(obj) {
    const str = JSON.stringify(obj);
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + '.' + str.length.toString(36);
}

function sharedSettings() {
    const o = {...state.settings};
    DEVICE_ONLY.forEach(k => delete o[k]);
    return o;
}

function currentRecords() {
    const r = {};
    SYNC_COLLS.forEach(c => {
        r[c] = {};
        state[c].forEach(x => {
            r[c][x.id] = x;
        });
    });
    r.settings = {main: sharedSettings()};
    return r;
}

function deviceName() {
    const ua = navigator.userAgent;
    return /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows computer'
        : /Mac/.test(ua) ? 'Mac' : 'Browser';
}

function scheduleSync(delay = 2500) {
    if (!syncReady()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), delay);
}

async function api(pathName, {method = 'GET', body, auth = true, timeout = 20000} = {}) {
    const headers = {'Content-Type': 'application/json'};
    if (auth) headers.Authorization = 'Bearer ' + sync.token;
    let res;
    try {
        res = await fetch(serverUrl() + pathName, {
            method, headers, body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout ? AbortSignal.timeout(timeout) : undefined
        });
    } catch (e) {
        const err = new Error('Can’t reach the server right now');
        err.offline = true;
        throw err;
    }
    let data = {};
    try {
        data = await res.json();
    } catch (e) { /* not JSON */
    }
    if (!res.ok) {
        const err = new Error(data.error || `The server replied with an error (${res.status})`);
        err.status = res.status;
        err.signedOut = !!data.signedOut;
        throw err;
    }
    return data;
}

function hasLocalData() {
    return SYNC_COLLS.some(c => state[c].length);
}

function wipeLocalData() {
    SYNC_COLLS.forEach(c => {
        state[c] = [];
    });
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) { /* ignore */
    }
}

async function syncNow({manual = false} = {}) {
    if (!syncReady()) return false;
    if (syncBusy) {
        syncAgain = true;
        return false;
    }
    syncBusy = true;
    let ok = false;
    try {
        const recs = currentRecords();
        const now = Date.now();
        const changes = {}, sent = {};
        for (const c of [...SYNC_COLLS, 'settings']) {
            const snap = sync.snap[c] || {};
            const ups = [], dels = [];
            sent[c] = {};
            for (const [id, rec] of Object.entries(recs[c])) {
                const fp = fingerprint(rec);
                sent[c][id] = fp;
                if (snap[id] !== fp) ups.push({id, record: rec, at: now});
            }
            for (const id of Object.keys(snap)) if (!(id in recs[c])) dels.push({id, at: now});
            if (ups.length || dels.length) changes[c] = {upserts: ups, deletes: dels};
        }
        const data = await api('/api/sync', {method: 'POST', body: {since: sync.rev, changes, device: deviceName()}});
        const changed = applyServerChanges(data.changes || {}, sent);
        sync.rev = data.rev;
        sync.last = Date.now();
        sync.error = '';
        saveSync();
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* ignore */
        }
        if (changed && $('#modal').hidden && $('#dialog').hidden) render();
        else if (ui.view === 'settings') renderSyncStatus();
        if (manual) toast(changed ? `Synced. ${changed} update${changed === 1 ? '' : 's'} from your other devices` : 'Synced. Everything is up to date');
        ok = true;
    } catch (e) {
        if (e.signedOut) {
            sync.token = '';
            sync.error = 'You were signed out. Please sign in again.';
        } else sync.error = e.message;
        saveSync();
        if (ui.view === 'settings') {
            if (e.signedOut) renderSettings(); else renderSyncStatus();
        }
        if (manual || e.signedOut) toast(sync.error);
    } finally {
        syncBusy = false;
        if (syncAgain) {
            syncAgain = false;
            scheduleSync(500);
        }
    }
    return ok;
}

function applyServerChanges(changes, sent) {
    let changed = 0;
    for (const c of [...SYNC_COLLS, 'settings']) {
        const snap = sync.snap[c] = sync.snap[c] || {};
        for (const item of changes[c] || []) {
            if (c === 'settings') {
                if (item.deleted || !item.record) continue;
                if (fingerprint(sharedSettings()) !== sent.settings.main) {
                    syncAgain = true;
                    continue;
                } // edited meanwhile
                const before = fingerprint(sharedSettings());
                const keep = {};
                DEVICE_ONLY.forEach(k => {
                    keep[k] = state.settings[k];
                });
                state.settings = {...state.settings, ...item.record, ...keep};
                snap.main = fingerprint(sharedSettings());
                if (snap.main !== before) {
                    changed++;
                    applyTheme();
                }
                continue;
            }
            const arr = state[c];
            const idx = arr.findIndex(x => x.id === item.id);
            if (idx >= 0 && fingerprint(arr[idx]) !== sent[c][item.id]) {
                syncAgain = true;
                continue;
            } // edited while syncing
            if (item.deleted) {
                if (idx >= 0) {
                    arr.splice(idx, 1);
                    changed++;
                }
                delete snap[item.id];
            } else {
                const fp = fingerprint(item.record);
                if (idx >= 0) {
                    if (fingerprint(arr[idx]) !== fp) changed++;
                    arr[idx] = item.record;
                } else {
                    arr.push(item.record);
                    changed++;
                }
                snap[item.id] = fp;
            }
        }
    }
    return changed;
}

function syncAgo() {
    if (!sync.last) return 'not yet';
    const s = Math.round((Date.now() - sync.last) / 1000);
    return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}

function renderSyncStatus() {
    const el = $('#syncStatus');
    if (!el) return;
    if (!syncReady()) {
        el.innerHTML = sync.error ? `<span class="dot bad"></span> ${esc(sync.error)}` : '<span class="dot off"></span> Not signed in. Data is only on this device';
        return;
    }
    el.innerHTML = sync.error
        ? `<span class="dot bad"></span> ${esc(sync.error)}${sync.last ? `. Last synced ${syncAgo()}` : ''}`
        : `<span class="dot good"></span> Signed in as <b>${esc(sync.user)}</b> · synced ${syncAgo()}`;
    if (!sync.error) {
        api('/api/me').then(me => {
            const box = $('#syncServer');
            if (!box) return;
            box.textContent = `Saved on the server: ${me.counts.expenses} expenses, ${me.counts.income} income entries, ${me.counts.debts} lent/borrowed.`
                + (me.lastBackup ? ` Latest server backup: ${me.lastBackup}.` : '');
        }).catch(() => {
        });
    }
}

async function signIn(mode) {
    const url = (CONFIG_SERVER || ($('#syncUrl') && $('#syncUrl').value) || '').trim().replace(/\/+$/, '');
    const username = $('#acUser').value.trim();
    const password = $('#acPass').value;
    const invite = $('#acInvite') ? $('#acInvite').value.trim() : '';
    const err = $('#acError');
    err.textContent = '';
    if (!url) {
        err.textContent = 'Enter the server address.';
        return;
    }
    if (!/^https?:\/\//i.test(url)) {
        err.textContent = 'The address should start with https://';
        return;
    }
    if (location.protocol === 'https:' && url.startsWith('http:') && !/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) {
        err.textContent = 'This app is opened over https, so it can only use an https server address.';
        return;
    }
    if (!username || !password) {
        err.textContent = 'Enter your username and password.';
        return;
    }
    // Entries made before accounts existed (or while signed out): never throw them away silently
    const owner = (sync.owner || '').toLowerCase();
    if (owner && owner !== username.toLowerCase() && sync.ownerSaved === false && hasLocalData()) {
        err.textContent = `This phone still has ${sync.owner}'s latest changes, which aren't saved on the server yet. ${sync.owner} needs to sign in once while online first.`;
        return;
    }
    const unowned = !owner && hasLocalData();
    if (unowned) {
        const n = state.expenses.length + state.income.length + state.debts.length + state.goals.length;
        if (!confirm(`This phone already has ${n} entries.\n\nThey'll be added to ${mode === 'create' ? 'your new account' : `the account "${username}"`} and saved on the server, so you keep everything.\n\nOK: continue\nCancel: stop (nothing changes)`)) return;
    }
    const prevUrl = sync.url;
    sync.url = CONFIG_SERVER ? '' : url;
    let res;
    try {
        res = await api(mode === 'create' ? '/api/register' : '/api/login', {
            method: 'POST', auth: false, body: {username, password, invite, device: deviceName()}
        });
    } catch (e) {
        sync.url = prevUrl;
        err.textContent = e.offline ? 'Can’t reach the server. Check the address, and that it’s running.' : e.message;
        return;
    }
    // Data left on this phone by a *different* signed-out account is that person's:
    // it was already saved on the server under their name, so it is cleared here, never mixed in.
    if (owner && owner !== res.username.toLowerCase()) wipeLocalData();
    sync = {
        ...sync,
        token: res.token,
        user: res.username,
        owner: res.username,
        ownerSaved: true,
        rev: 0,
        snap: {},
        last: 0,
        error: ''
    };
    saveSync();
    await syncNow();
    render();
    toast(mode === 'create' ? `Welcome, ${res.username}! Your account is ready` : `Signed in as ${res.username}`);
}

async function signOut() {
    if (syncReady()) await syncNow(); // send anything not yet saved
    const unsaved = !!sync.error;
    const wipe = confirm(`Sign out of ${sync.user}?\n\nOK: sign out and remove your data from this device (recommended on a shared phone; it stays safe on the server)\nCancel: sign out but keep a copy on this device`
        + (unsaved ? '\n\n⚠️ The last changes couldn’t be sent to the server. Keep the copy if you’re not sure.' : ''));
    api('/api/logout', {method: 'POST'}).catch(() => {
    });
    if (wipe) {
        wipeLocalData();
        sync.owner = '';
    }
    sync.ownerSaved = !unsaved;
    sync = {...sync, token: '', user: '', rev: 0, snap: {}, last: 0, error: ''};
    saveSync();
    render();
    toast('Signed out');
}

function changePassword() {
    openDialog({
        title: 'Change password',
        fields: [
            {key: 'current', label: 'Current password', type: 'password', max: 200},
            {key: 'password', label: 'New password (8+ characters)', type: 'password', max: 200}
        ],
        note: 'You’ll stay signed in here; other devices will need to sign in again.',
        onSubmit: v => {
            if (v.password.length < 8) return 'New password must be at least 8 characters.';
            api('/api/password', {method: 'POST', body: {current: v.current, password: v.password}})
                .then(() => toast('Password changed')).catch(e => toast(e.message));
        }
    });
}

function deleteAccount() {
    openDialog({
        title: 'Delete account',
        top: '<p class="muted small" style="margin:0">This permanently deletes your account and <b>all your data on the server</b>. It can’t be undone. Download a backup first if you want to keep anything.</p>',
        fields: [{key: 'password', label: 'Type your password to confirm', type: 'password', max: 200}],
        submitLabel: 'Delete forever',
        onSubmit: v => {
            api('/api/delete-account', {method: 'POST', body: {password: v.password}}).then(() => {
                wipeLocalData();
                sync = {url: sync.url, token: '', user: '', owner: '', rev: 0, snap: {}, last: 0, error: ''};
                saveSync();
                render();
                toast('Account deleted');
            }).catch(e => toast(e.message));
        }
    });
}

/* ---------- PIN lock ---------- */
const lock = {mode: 'unlock', entry: '', first: ''};
let hiddenAt = 0;

function hashPin(p) {
    let h = 2166136261;
    const str = 'expense-tracker:' + p;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

function showLock(mode) {
    lock.mode = mode;
    lock.entry = '';
    lock.first = '';
    updateLock();
    $('#lock').hidden = false;
}

function updateLock(msg = '') {
    const titles = {unlock: 'Enter your PIN', set1: 'Create a 4-digit PIN', set2: 'Type it again to confirm'};
    $('#lockTitle').textContent = titles[lock.mode];
    $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < lock.entry.length));
    $('#lockMsg').textContent = msg;
    $('#lockAlt').textContent = lock.mode === 'unlock' ? 'Forgot?' : 'Cancel';
}

function pinKey(k) {
    if (k === 'alt') {
        if (lock.mode !== 'unlock') {
            $('#lock').hidden = true;
            return;
        }
        if (confirm('Forgot your PIN?\n\nThe only way back in is to erase everything stored by this app on this device (restore a backup afterwards).\n\nErase and start over?')) {
            localStorage.removeItem(STORE_KEY);
            location.reload();
        }
        return;
    }
    if (k === 'del') lock.entry = lock.entry.slice(0, -1);
    else if (lock.entry.length < 4) lock.entry += k;
    updateLock();
    if (lock.entry.length === 4) setTimeout(checkPin, 120);
}

function checkPin() {
    const dots = $('#pinDots');
    const fail = msg => {
        lock.entry = '';
        dots.classList.remove('shake');
        void dots.offsetWidth;
        dots.classList.add('shake');
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
        updateLock(msg);
    };
    if (lock.mode === 'unlock') {
        if (hashPin(lock.entry) === state.settings.pinHash) {
            $('#lock').hidden = true;
            lock.entry = '';
        } else fail('Wrong PIN. Try again.');
    } else if (lock.mode === 'set1') {
        lock.first = lock.entry;
        lock.entry = '';
        lock.mode = 'set2';
        updateLock();
    } else {
        if (lock.entry === lock.first) {
            state.settings.pinHash = hashPin(lock.entry);
            save();
            $('#lock').hidden = true;
            toast('PIN set 🔒');
            renderSettings();
        } else {
            lock.mode = 'set1';
            lock.first = '';
            fail('PINs didn’t match. Start again.');
        }
    }
}

/* ---------- Install ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvt = e;
    if (ui.view === 'settings') renderSettings();
});

function installCard() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone) return '<p class="muted small" style="margin:0">✅ Installed. It opens from your home screen and works offline.</p>';
    if (installEvt) return '<button class="btn primary full" style="margin:0" data-act="install">📲 Install app</button>';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (location.protocol === 'file:') return '<p class="muted small" style="margin:0">You opened this as a local file. To install it and use it offline, put the folder on a free host (GitHub Pages or Netlify Drop) and open that link on your phone.</p>';
    return `<p class="muted small" style="margin:0">${ios
        ? 'In <b>Safari</b>, tap the Share button, then <b>Add to Home Screen</b>.'
        : 'In <b>Chrome</b>, open the ⋮ menu and tap <b>Add to Home screen</b> or <b>Install app</b>.'} After that it works without internet.</p>`;
}

/* ---------- CSV import ---------- */
function parseCSV(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    f += '"';
                    i++;
                } else q = false;
            } else f += c;
        } else if (c === '"') q = true;
        else if (c === ',') {
            row.push(f);
            f = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(f);
            rows.push(row);
            row = [];
            f = '';
        } else f += c;
    }
    if (f || row.length) {
        row.push(f);
        rows.push(row);
    }
    return rows.filter(r => r.some(x => x.trim()));
}

function toISO(str) {
    const s = String(str || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return ymd(new Date(+m[1], m[2] - 1, +m[3]));
    if ((m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ,]+(\d{2,4})$/))) {
        const mi = MON.findIndex(x => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
        if (mi >= 0) {
            let y = +m[3];
            if (y < 100) y += 2000;
            return ymd(new Date(y, mi, +m[1]));
        }
    }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) {
        let y = +m[3];
        if (y < 100) y += 2000;
        let mo = +m[1], d = +m[2];
        if (mo > 12) [mo, d] = [d, mo]; // looks like D/M/Y
        return ymd(new Date(y, mo - 1, d));
    }
    return null;
}

function importCSV(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const rows = parseCSV(String(reader.result).replace(/^﻿/, ''));
        const hi = rows.findIndex(r => r.some(c => /^date$/i.test(c.trim())) && r.some(c => /^amount/i.test(c.trim())));
        if (hi < 0) return toast('Couldn’t find "Date" and "Amount" columns in that file.');
        const head = rows[hi].map(h => h.trim().toLowerCase());
        const col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n)));
        const iType = col('type'), iDate = col('date'), iCat = col('category'), iSrc = col('source'),
            iDesc = col('description'), iAmt = col('amount'), iPay = col('payment'), iNotes = col('notes');
        const E = [], I = [];
        let skipped = 0;
        rows.slice(hi + 1).forEach(r => {
            const date = toISO(r[iDate]);
            const amt = parseFloat(String(r[iAmt] || '').replace(/[^\d.\-]/g, ''));
            if (!date || !(amt > 0)) {
                skipped++;
                return;
            }
            const get = i => (i >= 0 ? String(r[i] || '').trim() : '');
            const base = {
                id: uid(),
                date,
                amt: Math.round(amt * 100) / 100,
                desc: get(iDesc).replace(/\s*\(example, delete me\)$/i, ''),
                notes: get(iNotes),
                created: Date.now()
            };
            if (iType >= 0 && /income/i.test(get(iType))) I.push({...base, src: get(iCat) || get(iSrc) || 'Other'});
            else E.push({...base, cat: get(iCat) || 'Other', pay: get(iPay)});
        });
        if (!E.length && !I.length) return toast('No valid rows found in that file.');
        if (!confirm(`Import ${E.length} expense${E.length === 1 ? '' : 's'} and ${I.length} income entr${I.length === 1 ? 'y' : 'ies'}?${skipped ? `\n(${skipped} rows skipped: missing date or amount)` : ''}\n\nThey will be added to your current data.`)) return;
        const s = state.settings;
        uniq(E.map(e => e.cat)).forEach(c => {
            if (!s.categories.some(x => x.name === c)) s.categories.push({
                name: c,
                icon: '🏷️',
                budget: 0,
                color: PALETTE[s.categories.length % PALETTE.length]
            });
        });
        uniq(E.map(e => e.pay)).forEach(p => {
            if (!s.payments.includes(p)) s.payments.push(p);
        });
        uniq(I.map(i => i.src)).forEach(p => {
            if (!s.sources.includes(p)) s.sources.push(p);
        });
        state.expenses.push(...E);
        state.income.push(...I);
        save();
        render();
        toast(`Imported ${E.length + I.length} entries`);
    };
    reader.readAsText(file);
}

/* ---------- Toast ---------- */
let toastTimer;

function toast(msg, actionLabel, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
    if (actionLabel) el.querySelector('button').onclick = () => {
        action();
        el.classList.remove('show');
    };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), actionLabel ? 5000 : 2200);
}

/* ---------- Theme ---------- */
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
    const t = state.settings.theme;
    const dark = t === 'dark' || (t === 'auto' && darkQuery.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0B1230' : '#EAF0FB';
}

/* ---------- Import / export ---------- */
function download(filename, content, mime) {
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportJSON() {
    state.settings.lastBackup = Date.now();
    save();
    download(`expense-backup-${todayStr()}.json`, backupText(), 'application/json');
    toast('Backup downloaded. Keep it somewhere safe.');
    if (ui.view === 'dashboard' || ui.view === 'settings') render();
}

function exportCSV() {
    const q = v => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['Type', 'Date', 'Category / Source', 'Description', 'Amount', 'Payment Method', 'Notes']];
    state.expenses.slice().sort((a, b) => a.date.localeCompare(b.date))
        .forEach(e => rows.push(['Expense', e.date, e.cat, e.desc, e.amt, e.pay, e.notes]));
    state.income.slice().sort((a, b) => a.date.localeCompare(b.date))
        .forEach(i => rows.push(['Income', i.date, i.src, i.desc, i.amt, '', i.notes]));
    download(`expenses-${todayStr()}.csv`, '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n'), 'text/csv');
    toast('CSV downloaded. Opens in Excel or Sheets.');
}

function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            if (!data || !Array.isArray(data.expenses)) throw new Error('bad');
            // (backups shared to Drive are .txt files with the same JSON inside)
            const next = normalize(data);
            next.settings.pinHash = state.settings.pinHash;
            if (!confirm(`Restore this backup?\n\n${next.expenses.length} expenses and ${next.income.length} income entries.\nThis replaces what is on this device now.`)) return;
            state = next;
            save();
            applyTheme();
            render();
            toast('Backup restored');
        } catch (e) {
            toast("That file isn't a valid backup.");
        }
    };
    reader.readAsText(file);
}

function loadDemo() {
    if (state.expenses.length || state.income.length) {
        toast('Demo data only loads into an empty tracker.');
        return;
    }
    const ideas = {
        'Food & Dining': [['Momo', 250, 450], ['Lunch at canteen', 150, 300], ['Coffee', 120, 250], ['Dinner out', 600, 1500]],
        'Groceries': [['Vegetables', 300, 800], ['Weekly groceries', 1200, 2500], ['Milk & bread', 120, 250]],
        'Transport': [['Bus fare', 30, 60], ['Pathao ride', 150, 400], ['Fuel', 500, 1000]],
        'Education': [['Photocopy & notes', 50, 200], ['Lab manual', 300, 600]],
        'Shopping': [['T-shirt', 800, 1800], ['Stationery', 100, 400]],
        'Entertainment': [['Movie', 400, 700], ['Game top-up', 300, 1000]],
        'Personal Care': [['Haircut', 300, 500]],
        'Health': [['Pharmacy', 150, 600]]
    };
    const keys = Object.keys(ideas);
    const pays = state.settings.payments;
    const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) / 10) * 10;
    const t = new Date();
    for (let back = 2; back >= 0; back--) {
        const y = new Date(t.getFullYear(), t.getMonth() - back, 1).getFullYear();
        const m = new Date(t.getFullYear(), t.getMonth() - back, 1).getMonth();
        const last = back === 0 ? t.getDate() : daysIn(y, m);
        const d1 = ymd(new Date(y, m, 1));
        state.income.push({
            id: uid(),
            date: d1,
            src: 'Allowance / Pocket Money',
            desc: 'Monthly allowance',
            amt: 40000,
            notes: '',
            created: Date.now()
        });
        state.expenses.push({
            id: uid(),
            date: d1,
            cat: 'Rent & Bills',
            desc: 'Room rent',
            amt: 12000,
            pay: 'Bank Transfer',
            notes: '',
            created: Date.now()
        });
        state.expenses.push({
            id: uid(),
            date: ymd(new Date(y, m, Math.min(5, last))),
            cat: 'Subscriptions',
            desc: 'Spotify + Netflix',
            amt: 800,
            pay: 'eSewa',
            notes: '',
            created: Date.now()
        });
        for (let d = 1; d <= last; d++) {
            const count = Math.floor(Math.random() * 3) + (Math.random() < 0.2 ? 0 : 1);
            for (let k = 0; k < count; k++) {
                const cat = keys[Math.floor(Math.random() * keys.length)];
                const [desc, lo, hi] = ideas[cat][Math.floor(Math.random() * ideas[cat].length)];
                state.expenses.push({
                    id: uid(),
                    date: ymd(new Date(y, m, d)),
                    cat,
                    desc,
                    amt: rnd(lo, hi),
                    pay: pays[Math.floor(Math.random() * Math.min(3, pays.length))] || 'Cash',
                    notes: '',
                    created: Date.now() + k
                });
            }
        }
    }
    const nm = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    state.recurring.push(
        {
            id: uid(),
            type: 'expense',
            amt: 12000,
            desc: 'Room rent',
            notes: '',
            cat: 'Rent & Bills',
            pay: 'Bank Transfer',
            freq: 'monthly',
            day: 1,
            start: ymd(nm),
            next: ymd(nm),
            active: true
        },
        {
            id: uid(),
            type: 'income',
            amt: 40000,
            desc: 'Monthly allowance',
            notes: '',
            src: 'Allowance / Pocket Money',
            freq: 'monthly',
            day: 1,
            start: ymd(nm),
            next: ymd(nm),
            active: true
        }
    );
    if (!state.debts.length) {
        const ago = n => ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - n));
        const ahead = n => ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
        state.debts.push(
            {
                id: uid(),
                dir: 'lent',
                person: 'Rajesh',
                amt: 1500,
                date: ago(12),
                due: ago(2),
                note: 'Concert tickets',
                payments: [{date: ago(5), amt: 500}],
                settled: false
            },
            {
                id: uid(),
                dir: 'borrowed',
                person: 'Sita',
                amt: 800,
                date: ago(4),
                due: ahead(6),
                note: 'Lunch + taxi',
                payments: [],
                settled: false
            }
        );
    }
    if (!state.goals.length) {
        state.goals.push({
            id: uid(),
            icon: '📱',
            name: 'New phone',
            target: 60000,
            saved: 18500,
            deadline: ymd(new Date(t.getFullYear(), t.getMonth() + 5, 1))
        });
    }
    save();
    render();
    toast('Demo data loaded. Use "Erase all data" to clear it.');
}

/* ---------- Settings handlers ---------- */
function onSettingsChange(e) {
    const el = e.target;
    const f = el.dataset.f;
    if (!f) return;
    const s = state.settings;
    const i = Number(el.dataset.i);

    if (f === 'currency') s.currency = el.value.trim();
    else if (f === 'rem-time') {
        if (el.value) s.reminder.time = el.value;
    } else if (f === 'numstyle') s.numberStyle = el.value;
    else if (f === 'cat-color') s.categories[i].color = el.value;
    else if (f === 'cat-icon') s.categories[i].icon = el.value.trim() || '🏷️';
    else if (f === 'cat-budget') {
        const v = parseAmount(el.value || '0');
        s.categories[i].budget = v >= 0 ? Math.round(v * 100) / 100 : 0;
    } else if (f === 'cat-name') {
        const old = s.categories[i].name;
        const name = el.value.trim();
        if (!name) {
            el.value = old;
            return toast('Category name can’t be empty.');
        }
        if (name !== old && s.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            el.value = old;
            return toast('That category already exists.');
        }
        s.categories[i].name = name;
        state.expenses.forEach(x => {
            if (x.cat === old) x.cat = name;
        });
    }
    save();
    renderSettings();
}

function onSettingsClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = state.settings;
    const i = Number(b.dataset.i);
    const act = b.dataset.act;

    if (act === 'theme') {
        s.theme = b.dataset.v;
        applyTheme();
    } else if (act === 'add-cat') {
        let n = 1, name = 'New category';
        while (s.categories.some(c => c.name === name)) name = `New category ${++n}`;
        s.categories.push({name, icon: '🏷️', budget: 0, color: PALETTE[s.categories.length % PALETTE.length]});
        save();
        renderSettings();
        const inputs = $$('[data-f="cat-name"]');
        const last = inputs[inputs.length - 1];
        last.focus();
        last.select();
        return;
    } else if (act === 'del-cat') {
        const c = s.categories[i];
        const used = state.expenses.filter(x => x.cat === c.name).length;
        if (!confirm(`Delete "${c.name}"?${used ? `\n\n${used} expense(s) will keep this label but have no budget.` : ''}`)) return;
        s.categories.splice(i, 1);
    } else if (act === 'add-pay' || act === 'add-src') {
        const key = act.slice(4);
        const input = $('#new-' + key);
        const v = input.value.trim();
        const list = key === 'pay' ? s.payments : s.sources;
        if (!v) return;
        if (list.some(x => x.toLowerCase() === v.toLowerCase())) return toast('Already in the list.');
        list.push(v);
    } else if (act === 'del-pay') {
        s.payments.splice(i, 1);
    } else if (act === 'del-src') {
        s.sources.splice(i, 1);
    } else if (act === 'bs') {
        s.bsDates = b.dataset.v === 'on';
        toast(s.bsDates ? `Today is ${bsFull(todayStr()) || 'outside the supported years'}` : 'Nepali dates hidden');
    } else if (act === 'rem') {
        s.reminder.on = b.dataset.v === 'on';
        save();
        if (s.reminder.on) {
            enableBackgroundReminder().then(r => {
                ui.bgReminder = r;
                renderSettings();
            });
            toast(`Reminder set for ${s.reminder.time}`);
        }
    } else if (act === 'ac-mode') {
        ui.acMode = b.dataset.v;
        renderSettings();
        return;
    } else if (act === 'sync-now') {
        syncNow({manual: true});
        return;
    } else if (act === 'sign-out') {
        signOut();
        return;
    } else if (act === 'pw-change') {
        return changePassword();
    } else if (act === 'acc-delete') {
        return deleteAccount();
    } else if (act === 'rem-test') {
        testNotification();
        return;
    } else if (act === 'rem-retry') {
        enableBackgroundReminder().then(r => {
            ui.bgReminder = r;
            renderSettings();
            toast(r === 'ok' ? 'Daily check scheduled' : r === 'denied' ? 'Notifications are blocked for this site' : 'Background checks aren’t available here. Use the calendar reminder.');
        });
        return;
    } else if (act === 'rem-google') {
        window.open(reminderCalendarLinks().google, '_blank');
        return;
    } else if (act === 'rem-ics') {
        download('expense-reminder.ics', reminderCalendarLinks().ics, 'text/calendar');
        toast('Open the downloaded file to add it to your calendar');
        return;
    } else if (act === 'clear-budgets') {
        if (!s.categories.some(c => c.budget)) return toast('No budgets to clear.');
        if (!confirm('Remove every category budget?\n\nYour spending stays tracked, just without limits.')) return;
        s.categories.forEach(c => {
            c.budget = 0;
        });
        toast('Budgets cleared. Now just tracking.');
    } else if (act === 'suggest-budgets') {
        const t = new Date();
        const months = [];
        for (let k = 1; k <= 3; k++) {
            const d = new Date(t.getFullYear(), t.getMonth() - k, 1);
            months.push(mKey(d.getFullYear(), d.getMonth()));
        }
        let used = months.filter(k => state.expenses.some(e => e.date.startsWith(k)));
        let basis = `the average of your last ${used.length} full month${used.length === 1 ? '' : 's'}`;
        if (!used.length) {
            const cur = mKey(t.getFullYear(), t.getMonth());
            if (!state.expenses.some(e => e.date.startsWith(cur))) return toast('Log expenses for a few weeks first, then try this.');
            used = [cur];
            basis = 'this month so far (projected to a full month)';
        }
        const scale = used[0] === mKey(t.getFullYear(), t.getMonth()) ? daysIn(t.getFullYear(), t.getMonth()) / t.getDate() : 1;
        const sug = s.categories.map(c => {
            const sum = total(state.expenses.filter(e => e.cat === c.name && used.some(k => e.date.startsWith(k))));
            return Math.ceil((sum / used.length) * scale / 100) * 100;
        });
        const lines = s.categories.map((c, j) => sug[j] ? `${c.name}: ${money(sug[j])}` : null).filter(Boolean);
        if (!lines.length) return toast('Not enough spending yet to suggest budgets.');
        if (!confirm(`Suggested monthly budgets, based on ${basis}:\n\n${lines.join('\n')}\n\nTotal: ${money(sug.reduce((a, b) => a + b, 0))}\n\nApply these? Categories with no spending keep their current budget.`)) return;
        s.categories.forEach((c, j) => {
            if (sug[j]) c.budget = sug[j];
        });
        toast('Budgets updated. Tweak any of them below.');
    } else if (act === 'rec-toggle') {
        const r = state.recurring.find(x => x.id === b.dataset.id);
        if (!r) return;
        r.active = !r.active;
        if (r.active) {
            while (r.next < todayStr()) r.next = advance(r, r.next);
        }
        toast(r.active ? `Resumed. Next on ${dayLabel(r.next)}` : 'Paused');
    } else if (act === 'rec-del') {
        const r = state.recurring.find(x => x.id === b.dataset.id);
        if (!r || !confirm(`Stop repeating "${r.desc || r.cat || r.src}"?\n\nEntries already added stay in your list.`)) return;
        state.recurring = state.recurring.filter(x => x.id !== r.id);
    } else if (act === 'rec-edit') {
        return editRecurring(b.dataset.id);
    } else if (act === 'pin-set') {
        return showLock('set1');
    } else if (act === 'pin-remove') {
        if (!confirm('Remove the PIN lock?')) return;
        s.pinHash = null;
        toast('PIN removed');
    } else if (act === 'install') {
        if (installEvt) {
            installEvt.prompt();
            installEvt.userChoice.finally(() => {
                installEvt = null;
                renderSettings();
            });
        }
        return;
    } else if (act === 'import-csv') return $('#importCsv').click();
    else if (act === 'export-json') return exportJSON();
    else if (act === 'import-json') return $('#importFile').click();
    else if (act === 'export-csv') return exportCSV();
    else if (act === 'sample') return loadDemo();
    else if (act === 'erase') {
        if (!confirm('Erase ALL expenses, income, recurring entries and goals on this device?\n\nYour categories and settings are kept. This cannot be undone. Make a backup first if unsure.')) return;
        state.expenses = [];
        state.income = [];
        state.recurring = [];
        state.goals = [];
        state.debts = [];
        toast('All entries erased');
    }
    save();
    renderSettings();
}

/* ---------- Events ---------- */
function shiftPeriod(dir) {
    ui.expF.day = null;
    if (ui.view === 'yearly') ui.year += dir;
    else {
        ui.m += dir;
        if (ui.m < 0) {
            ui.m = 11;
            ui.y--;
        }
        if (ui.m > 11) {
            ui.m = 0;
            ui.y++;
        }
    }
    render();
}

function go(view) {
    ui.view = view;
    if (view === 'yearly') ui.year = ui.y;
    $('#periodBar').style.visibility = '';
    render();
    window.scrollTo({top: 0});
}

function bindEvents() {
    $$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.view)));
    $('#prevPeriod').addEventListener('click', () => shiftPeriod(-1));
    $('#nextPeriod').addEventListener('click', () => shiftPeriod(1));
    $('#periodLabel').addEventListener('click', () => {
        const t = new Date();
        ui.y = t.getFullYear();
        ui.m = t.getMonth();
        ui.year = t.getFullYear();
        render();
    });
    $('#fab').addEventListener('click', () => {
        if (ui.view === 'debts') return openDebt();
        if (ui.view === 'cat') ui.presetCat = ui.catView;
        openForm(ui.view === 'income' ? 'income' : 'expense');
    });

    // global clicks (transactions, empty-state buttons, budget rows, chart tips)
    document.addEventListener('click', e => {
        const debtRowEl = e.target.closest('[data-debt]');
        if (debtRowEl) return openDebt(debtRowEl.dataset.debt);
        const tx = e.target.closest('.tx[data-type]');
        if (tx) return openForm(tx.dataset.type, tx.dataset.id);
        const add = e.target.closest('[data-act="add"]');
        if (add) return openForm(ui.view === 'income' ? 'income' : 'expense');
        if (e.target.closest('[data-act="goal-new"]')) return openGoal();
        if (e.target.closest('[data-act="debt-new"]')) return openDebt();
        const debt = e.target.closest('[data-debt]');
        if (debt) return openDebt(debt.dataset.debt);
        if (e.target.closest('[data-act="share-backup"]')) return shareBackup();
        const goal = e.target.closest('[data-goal]');
        if (goal) return openGoal(goal.dataset.goal);
        if (e.target.closest('[data-act="backup-now"]')) return shareBackup();
        const br = e.target.closest('.budget-row');
        if (br) {
            ui.catView = br.dataset.cat;
            return go('cat');
        }
        if (e.target.closest('[data-act="cat-all"]')) {
            ui.expF = {...ui.expF, q: '', cat: ui.catView, pay: '', scope: 'all', sort: 'new', mode: 'list', day: null};
            return go('expenses');
        }
        const rep = e.target.closest('[data-report]');
        if (rep) {
            if (rep.dataset.report === 'prev') {
                ui.m--;
                if (ui.m < 0) {
                    ui.m = 11;
                    ui.y--;
                }
            }
            return go('report');
        }
        if (e.target.closest('[data-act="report-pdf"]')) return window.print();
        if (e.target.closest('[data-act="report-share"]')) {
            const text = reportSummaryText();
            if (navigator.share) return navigator.share({title: 'My spending', text}).catch(() => {
            });
            return navigator.clipboard.writeText(text).then(() => toast('Summary copied')).catch(() => toast('Couldn’t share on this device'));
        }
        const gt = e.target.closest('[data-goto]');
        if (gt) return go(gt.dataset.goto);
        if (e.target.tagName === 'CANVAS' && e.target._meta && e.target._meta.tip) {
            const m = e.target._meta;
            const rect = e.target.getBoundingClientRect();
            const idx = Math.floor((e.clientX - rect.left - m.padL) / m.groupW);
            if (idx >= 0 && idx < m.n) toast(m.tip(idx));
        }
    });

    // expense filters
    $('#expSearch').addEventListener('input', e => {
        ui.expF.q = e.target.value;
        renderTxView('expense');
    });
    $('#expCat').addEventListener('change', e => {
        ui.expF.cat = e.target.value;
        renderTxView('expense');
    });
    $('#expPay').addEventListener('change', e => {
        ui.expF.pay = e.target.value;
        renderTxView('expense');
    });
    $('#expMode').addEventListener('click', () => {
        ui.expF.mode = ui.expF.mode === 'cal' ? 'list' : 'cal';
        ui.expF.day = null;
        renderTxView('expense');
    });
    $('#expCal').addEventListener('click', e => {
        const b = e.target.closest('[data-day]');
        if (!b) return;
        const d = b.dataset.day;
        ui.expF.day = !d || ui.expF.day === d ? null : d;
        renderTxView('expense');
    });
    $('#expSort').addEventListener('change', e => {
        ui.expF.sort = e.target.value;
        renderTxView('expense');
    });
    $('#incSort').addEventListener('change', e => {
        ui.incF.sort = e.target.value;
        renderTxView('income');
    });
    $('#expScope').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        ui.expF.scope = b.dataset.scope;
        renderTxView('expense');
    });
    // income filters
    $('#incSearch').addEventListener('input', e => {
        ui.incF.q = e.target.value;
        renderTxView('income');
    });
    $('#incSrc').addEventListener('change', e => {
        ui.incF.src = e.target.value;
        renderTxView('income');
    });
    $('#incScope').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        ui.incF.scope = b.dataset.scope;
        renderTxView('income');
    });

    // form
    $('#txForm').addEventListener('submit', submitForm);
    $$('[data-close]').forEach(el => el.addEventListener('click', closeForm));
    $('#typeToggle').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) setFormType(b.dataset.type);
    });
    $('#fCatChips').addEventListener('click', e => {
        const c = e.target.closest('.chip');
        if (!c) return;
        ui.formCat = c.dataset.cat;
        $$('.chip', $('#fCatChips')).forEach(x => x.classList.toggle('active', x === c));
        $('#formError').textContent = '';
    });
    $('#fRepeat').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (b) setRepeat(b.dataset.r);
    });
    $('#fAmt').addEventListener('input', updateAmtHint);
    $('#fDate').addEventListener('input', updateDateBS);
    $('#splitToggle').addEventListener('click', () => {
        ui.split.on = !ui.split.on;
        if (ui.split.on) setRepeat('none');
        $('#repeatField').hidden = ui.split.on;
        renderSplit();
        if (ui.split.on) setTimeout(() => $('#splitName').focus(), 50);
    });
    $('#splitAdd').addEventListener('click', addSplitPerson);
    $('#splitName').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addSplitPerson();
        }
    });
    $('#splitPeople').addEventListener('click', e => {
        const b = e.target.closest('[data-sdel]');
        if (!b) return;
        ui.split.people.splice(Number(b.dataset.sdel), 1);
        renderSplit();
    });
    $('#splitPayer').addEventListener('change', e => {
        ui.split.payer = e.target.value;
        updateSplitSum();
    });
    $('#fAmt').addEventListener('input', updateSplitSum);
    // + − × ÷ buttons (phone number keypads don't have them)
    const calcBar = $('#calcBar');
    calcBar.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) e.preventDefault();
    }); // keep keyboard open
    calcBar.addEventListener('click', e => {
        const b = e.target.closest('[data-op]');
        if (!b) return;
        const inp = $('#fAmt');
        let v = inp.value;
        if (b.dataset.op === '=') {
            const r = parseAmount(v);
            if (!isNaN(r)) inp.value = String(Math.round(r * 100) / 100);
        } else {
            const start = inp.selectionStart ?? v.length, end = inp.selectionEnd ?? v.length;
            let before = v.slice(0, start), after = v.slice(end);
            if (/[+\-*/]$/.test(before)) before = before.slice(0, -1);   // swap a trailing operator
            if (!before && b.dataset.op !== '-') {
                inp.focus();
                return;
            }  // nothing to add to yet
            inp.value = before + b.dataset.op + after;
            const pos = before.length + 1;
            inp.focus();
            try {
                inp.setSelectionRange(pos, pos);
            } catch (err) {
            }
        }
        updateAmtHint();
        if (navigator.vibrate) navigator.vibrate(6);
    });
    $('#fQuick').addEventListener('click', e => {
        const b = e.target.closest('[data-q]');
        if (!b) return;
        const p = ui.quickPicks[Number(b.dataset.q)];
        $('#fAmt').value = p.amt;
        $('#fDesc').value = p.desc;
        ui.formCat = p.cat;
        if (p.pay && allPays().includes(p.pay)) $('#fPay').value = p.pay;
        renderCatChips();
        updateAmtHint();
        $('#formError').textContent = '';
    });
    $('#fDesc').addEventListener('change', e => {
        const v = e.target.value.trim().toLowerCase();
        if (!v || ui.editing) return;
        const src = ui.formType === 'expense' ? state.expenses : state.income;
        const match = src.slice().sort(sortTx).find(x => (x.desc || '').toLowerCase() === v);
        if (!match) return;
        if (ui.formType === 'expense') {
            if (!ui.formCat) {
                ui.formCat = match.cat;
                renderCatChips();
            }
            if (match.pay && allPays().includes(match.pay)) $('#fPay').value = match.pay;
        } else if (match.src) $('#fSrc').value = match.src;
        if (!$('#fAmt').value) {
            $('#fAmt').value = match.amt;
            updateAmtHint();
        }
    });
    $('#dupTx').addEventListener('click', duplicateForm);
    $('#dForm').addEventListener('submit', submitDialog);
    $$('[data-dclose]').forEach(el => el.addEventListener('click', () => hideSheet('#dialog')));
    $('#dActions').addEventListener('click', e => {
        const xb = e.target.closest('[data-dact^="x"]');
        if (xb && dlg && dlg.extra) {
            const x = dlg.extra[Number(xb.dataset.dact.slice(1))];
            hideSheet('#dialog');
            dlg = null;
            x.fn();
            return;
        }
        if (e.target.closest('[data-dact="delete"]') && dlg && dlg.onDelete) {
            const fn = dlg.onDelete;
            hideSheet('#dialog');
            dlg = null;
            fn();
        }
    });
    window.addEventListener('popstate', () => {
        $$('.modal').filter(m => !m.hidden).forEach(m => hideSheet('#' + m.id, true));
    });

    // PIN keypad
    $('#keypad').addEventListener('click', e => {
        const b = e.target.closest('[data-k]');
        if (b) pinKey(b.dataset.k);
    });
    document.addEventListener('keydown', e => {
        if ($('#lock').hidden) return;
        if (/^\d$/.test(e.key)) pinKey(e.key);
        else if (e.key === 'Backspace') pinKey('del');
    });

    // swipe left/right to change month
    let sx = null, sy = 0, st = 0;
    $('#app').addEventListener('touchstart', e => {
        if (e.touches.length !== 1 || e.target.closest('.table-wrap, input, select, .quick')) {
            sx = null;
            return;
        }
        sx = e.touches[0].clientX;
        sy = e.touches[0].clientY;
        st = Date.now();
    }, {passive: true});
    $('#app').addEventListener('touchend', e => {
        if (sx === null) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - sx, dy = t.clientY - sy;
        sx = null;
        const scopeAll = (ui.view === 'expenses' && ui.expF.scope === 'all') || (ui.view === 'income' && ui.incF.scope === 'all');
        if (ui.view === 'settings' || scopeAll) return;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - st < 600) shiftPeriod(dx < 0 ? 1 : -1);
    }, {passive: true});

    $('#deleteTx').addEventListener('click', () => {
        const {formType, editing} = ui;
        if (!editing) return;
        closeForm();
        deleteTx(formType, editing);
    });
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (!$('#dialog').hidden) hideSheet('#dialog');
        else if (!$('#modal').hidden) closeForm();
    });

    // settings
    $('#view-settings').addEventListener('change', onSettingsChange);
    $('#view-settings').addEventListener('submit', e => {
        if (e.target.id === 'acForm') {
            e.preventDefault();
            signIn(ui.acMode === 'create' ? 'create' : 'signin');
        }
    });
    $('#view-settings').addEventListener('click', onSettingsClick);
    $('#view-settings').addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.target.id && e.target.id.startsWith('new-')) {
            $(`[data-act="add-${e.target.id.slice(4)}"]`).click();
        }
    });
    $('#importCsv').addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) importCSV(f);
        e.target.value = '';
    });
    $('#importFile').addEventListener('change', e => {
        const f = e.target.files[0];
        if (f) importJSON(f);
        e.target.value = '';
    });

    // theme & resize
    darkQuery.addEventListener && darkQuery.addEventListener('change', () => {
        applyTheme();
        render();
    });
    let rt;
    window.addEventListener('resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
            if (ui.view === 'dashboard' || ui.view === 'yearly') render();
        }, 150);
    });
    // keep "today" fresh if the app stays open overnight
    window.addEventListener('online', () => scheduleSync(500));
    setInterval(() => {
        if (!document.hidden) syncNow();
    }, 120000);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            return;
        }
        scheduleSync(300);
        if (state.settings.pinHash && hiddenAt && Date.now() - hiddenAt > 60000 && $('#lock').hidden) showLock('unlock');
        runRecurring();
        render();
    });
}

/* ---------- Start ---------- */
applyTheme();
bindEvents();
if (state.settings.pinHash) showLock('unlock');
runRecurring();
render();
syncReminderState();
syncNow();
{
    const add = new URLSearchParams(location.search).get('add');
    if (add === 'expense' || add === 'income') {
        history.replaceState(null, '', location.pathname);
        setTimeout(() => openForm(add), 50);
    }
}

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && !reloaded) {
            reloaded = true;
            location.reload();
        }
    });
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {
    }));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {
});