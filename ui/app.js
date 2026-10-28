'use strict';

/* ================= УТИЛИТЫ ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = (id, cls = '') => `<svg class="ic ${cls}"><use href="#i-${id}"/></svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtSize(b) {
  if (!b && b !== 0) return '';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} КБ`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(b < 100 * 1024 * 1024 ? 1 : 0)} МБ`;
  return `${(b / 1024 ** 3).toFixed(1)} ГБ`;
}
function fmtMb(mb) { return mb >= 1000 ? `${(mb / 1024).toFixed(1)} ГБ` : `${mb} МБ`; }
function fmtTs(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} сек`;
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин ${sec % 60 ? (sec % 60) + ' сек' : ''}`.trim();
}
function fmtEta(sec) {
  if (sec == null) return '';
  if (sec < 60) return 'меньше минуты';
  if (sec < 3600) return `~${Math.round(sec / 60)} мин`;
  return `~${Math.floor(sec / 3600)} ч ${Math.round(sec % 3600 / 60)} мин`;
}
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function fmtDate(iso) { try { return dateFmt.format(new Date(iso)); } catch (e) { return ''; } }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many);
}

/* ================= СОСТОЯНИЕ ================= */
const S = {
  version: '', repo: '', settings: {}, languages: [], models: [], cpu: 4,
  jobs: new Map(), busy: false,
  live: {},              // id задачи -> сегменты, пришедшие в реальном времени
  selectedJob: null,     // что показано в правой панели расшифровки
  follow: true,          // автоматически показывать текущую задачу
  history: [], historySel: null,
  update: null, updateState: 'idle',
};
let api;

const langName = code => (S.languages.find(l => l[0] === code) || [code, code ? code.toUpperCase() : '—'])[1];
const modelName = id => (S.models.find(m => m.id === id) || { name: id }).name;

/* ================= ТОСТЫ И ОКНА ================= */
function toast(text, { type = 'info', action = null, timeout = 4500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const ic = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'sparkle';
  el.innerHTML = `<div class="t-ic">${icon(ic)}</div><div class="t-text">${esc(text)}</div>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'btn btn-sm';
    b.textContent = action.label;
    b.onclick = () => { action.fn(); close(); };
    el.append(b);
  }
  $('#toasts').append(el);
  function close() { el.classList.add('out'); setTimeout(() => el.remove(), 200); }
  setTimeout(close, timeout);
}

function confirmModal(title, text, ok = 'Удалить') {
  return new Promise(resolve => {
    const m = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-text').textContent = text;
    $('#modal-ok').textContent = ok;
    m.hidden = false;
    const done = v => { m.hidden = true; $('#modal-ok').onclick = $('#modal-cancel').onclick = m.onclick = null; resolve(v); };
    $('#modal-ok').onclick = () => done(true);
    $('#modal-cancel').onclick = () => done(false);
    m.onclick = e => { if (e.target === m) done(false); };
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}

/* ================= ТЕМА ================= */
const lightQuery = matchMedia('(prefers-color-scheme: light)');
function effectiveTheme(t) { return t === 'system' ? (lightQuery.matches ? 'light' : 'dark') : t; }
function applyTheme(t) {
  try { localStorage.setItem('avestt-theme', t); } catch (e) {}
  const eff = effectiveTheme(t);
  document.documentElement.dataset.theme = eff;
  $('#theme-quick').innerHTML = icon(eff === 'dark' ? 'sun' : 'moon');
  $('#theme-quick').title = eff === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  $$('#theme-picker button').forEach(b => b.classList.toggle('active', b.dataset.value === t));
}
async function setTheme(t) {
  applyTheme(t);
  S.settings = await api.set_settings({ theme: t });
}
lightQuery.addEventListener('change', () => { if (S.settings.theme === 'system') applyTheme('system'); });

/* ================= НАВИГАЦИЯ ================= */
function go(page) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  if (page === 'history') loadHistory();
  if (page === 'models') refreshModels();
}

/* ================= ОЧЕРЕДЬ ================= */
const queueEl = () => $('#queue');

function jobSub(j) {
  switch (j.status) {
    case 'pending': return `${fmtSize(j.size)} · в очереди`;
    case 'running': {
      if (j.progress > 0) {
        const eta = j.eta != null ? ` · осталось ${fmtEta(j.eta)}` : '';
        return `${Math.round(j.progress * 100)}%${eta}`;
      }
      return j.stage || 'Подготовка…';
    }
    case 'done': return `Готово${j.language ? ' · ' + langName(j.language) : ''}`;
    case 'error': return j.error || 'Ошибка';
    case 'cancelled': return 'Отменено';
  }
  return '';
}

function renderJob(j) {
  const q = queueEl();
  let el = q.querySelector(`.job[data-id="${j.id}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.id = j.id;
    el.onclick = e => { if (!e.target.closest('button')) selectJob(j.id, true); };
    q.append(el);
  }
  el.className = `job ${j.status}${S.selectedJob === j.id ? ' selected' : ''}`;
  const ic = j.status === 'done' ? 'check' : j.status === 'error' ? 'alert' : (j.kind === 'video' ? 'film' : 'music');
  let actions = '';
  if (j.status === 'running') actions = `<button class="btn-icon danger" data-act="cancel" title="Остановить">${icon('stop')}</button>`;
  if (j.status === 'error' || j.status === 'cancelled') actions += `<button class="btn-icon" data-act="retry" title="Повторить">${icon('retry')}</button>`;
  if (j.status !== 'running') actions += `<button class="btn-icon" data-act="remove" title="Убрать из списка">${icon('x')}</button>`;
  const indeterminate = j.status === 'running' && !(j.progress > 0);
  el.innerHTML = `
    <div class="job-icon">${icon(ic)}</div>
    <div class="job-main">
      <div class="job-name" title="${esc(j.path)}">${esc(j.name)}</div>
      <div class="job-sub">${esc(jobSub(j))}</div>
      ${j.status === 'running' ? `<div class="progress${indeterminate ? ' indeterminate' : ''}"><i style="width:${(j.progress * 100).toFixed(1)}%"></i></div>` : ''}
    </div>
    <div class="job-actions">${actions}</div>`;
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => jobAction(j.id, b.dataset.act));
}

function renderQueue() {
  const q = queueEl();
  const jobs = [...S.jobs.values()];
  q.querySelectorAll('.job').forEach(el => { if (!S.jobs.has(el.dataset.id)) el.remove(); });
  let empty = q.querySelector('.queue-empty');
  if (!jobs.length) {
    if (!empty) q.innerHTML = '<div class="queue-empty">Файлы, которые вы добавите, появятся здесь</div>';
  } else if (empty) empty.remove();
  jobs.forEach(renderJob);
  $('#queue-count').textContent = jobs.length || '';
  $('#clear-finished').hidden = !jobs.some(j => ['done', 'error', 'cancelled'].includes(j.status));
  updateStartBar();
}

function updateStartBar() {
  const pending = [...S.jobs.values()].filter(j => j.status === 'pending').length;
  const hasModels = S.models.some(m => m.installed);
  const start = $('#start-btn');
  start.disabled = !pending || !hasModels || S.busy;
  start.querySelector('span').textContent = S.busy ? 'Идёт расшифровка…'
    : pending > 1 ? `Расшифровать ${pending} ${plural(pending, 'файл', 'файла', 'файлов')}` : 'Начать расшифровку';
  $('#stop-btn').hidden = !S.busy;
  $('#busy-dot').hidden = !S.busy;
}

function addJobs(list, notify = true) {
  list.forEach(j => S.jobs.set(j.id, j));
  renderQueue();
  if (notify) {
    if (list.length) toast(`Добавлено: ${list.length} ${plural(list.length, 'файл', 'файла', 'файлов')}`, { type: 'success', timeout: 2500 });
    else toast('Не нашлось подходящих аудио- или видеофайлов', { type: 'error' });
  }
  if (list.length && !S.selectedJob) selectJob(list[0].id, false);
  go('transcribe');
}

async function jobAction(id, act) {
  if (act === 'cancel') await api.cancel(id);
  if (act === 'retry') await api.retry(id);
  if (act === 'remove') {
    await api.remove_job(id);
    S.jobs.delete(id);
    delete S.live[id];
    if (S.selectedJob === id) { S.selectedJob = null; renderMainViewer(); }
    renderQueue();
  }
}

/* ================= ПРОСМОТР ================= */
function emptyView(art, title, text, extra = '') {
  return `<div class="viewer-empty"><div class="art">${icon(art)}</div><h3>${esc(title)}</h3><div>${esc(text)}</div>${extra}</div>`;
}

function segHtml(seg, i, editable) {
  return `<div class="seg" data-i="${i}"><span class="ts">${fmtTs(seg.start)}</span><p${editable ? ' contenteditable="true" spellcheck="false"' : ''}>${esc(seg.text)}</p></div>`;
}

function selectJob(id, manual) {
  S.selectedJob = id;
  if (manual) S.follow = S.jobs.get(id)?.status === 'running';
  $$('.job', queueEl()).forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  renderMainViewer();
}

async function renderMainViewer() {
  const v = $('#viewer-main');
  const j = S.jobs.get(S.selectedJob);
  v.classList.toggle('no-ts', !S.settings.txt_timestamps);
  if (!j) {
    v.innerHTML = emptyView('file', 'Здесь появится текст', 'Добавьте аудио или видео и нажмите «Начать расшифровку». Текст будет появляться по мере распознавания.');
    return;
  }
  if (j.status === 'done' && j.history_id) {
    const item = await api.get_item(j.history_id);
    if (S.selectedJob !== j.id) return;
    if (item) renderItemViewer(v, item, true);
    return;
  }
  if (j.status === 'running') return renderLiveViewer(v, j);
  if (j.status === 'error') {
    v.innerHTML = emptyView('alert', 'Не получилось расшифровать', j.error || '',
      `<div style="margin-top:16px"><button class="btn" id="v-retry">${icon('retry')}<span>Попробовать снова</span></button></div>`);
    $('#v-retry').onclick = () => jobAction(j.id, 'retry');
    return;
  }
  if (j.status === 'cancelled') {
    v.innerHTML = emptyView('stop', 'Расшифровка остановлена', 'Нажмите «Повторить» рядом с файлом, чтобы начать заново.');
    return;
  }
  v.innerHTML = emptyView(j.kind === 'video' ? 'film' : 'music', j.name, S.busy ? 'Файл ждёт своей очереди.' : 'Нажмите «Начать расшифровку», чтобы получить текст.');
}

function renderLiveViewer(v, j) {
  const segs = S.live[j.id] || [];
  v.innerHTML = `
    <div class="viewer-head">
      <div class="vh-title">
        <div class="title-input" style="cursor:default">${esc(j.name)}</div>
        <div class="vh-meta">
          <span class="chip accent">${icon('cpu')}${esc(modelName(S.settings.model))}</span>
          ${j.language ? `<span class="chip">${icon('globe')}${esc(langName(j.language))}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="viewer-live">
      <div class="live-row"><b class="live-stage"></b><span class="live-eta"></span></div>
      <div class="progress"><i></i></div>
    </div>
    <div class="viewer-body">${segs.map((s, i) => segHtml(s, i, false)).join('')}<div class="typing"><span></span><span></span><span></span></div></div>`;
  updateLiveBar(v, j);
  const body = $('.viewer-body', v);
  body.scrollTop = body.scrollHeight;
}

function updateLiveBar(v, j) {
  const bar = $('.viewer-live .progress', v);
  if (!bar) return;
  const indeterminate = !(j.progress > 0);
  bar.classList.toggle('indeterminate', indeterminate);
  bar.firstElementChild.style.width = `${(j.progress * 100).toFixed(1)}%`;
  $('.live-stage', v).textContent = indeterminate ? (j.stage || 'Подготовка…') : `Распознано ${Math.round(j.progress * 100)}%`;
  $('.live-eta', v).textContent = j.eta != null ? `Осталось ${fmtEta(j.eta)}` : '';
}

function renderItemViewer(v, item, fromQueue) {
  const words = item.segments.reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0);
  v.classList.toggle('no-ts', !S.settings.txt_timestamps);
  v.innerHTML = `
    <div class="viewer-head">
      <div class="vh-title">
        <input class="title-input" value="${esc(item.name)}" spellcheck="false" title="Нажмите, чтобы переименовать">
        <div class="vh-meta">
          <span class="chip">${icon('clock')}${fmtTs(item.duration)}</span>
          <span class="chip">${icon('globe')}${esc(langName(item.language))}</span>
          <span class="chip">${icon('cpu')}${esc(modelName(item.model))}</span>
          ${item.task === 'translate' ? `<span class="chip accent">Перевод</span>` : ''}
        </div>
      </div>
      <div class="vh-actions">
        <button class="btn btn-sm btn-ghost ts-toggle ${S.settings.txt_timestamps ? 'on' : ''}" title="Показывать и сохранять время каждой фразы">${icon('clock')}<span>Время</span></button>
        <button class="btn btn-sm v-copy">${icon('copy')}<span>Копировать</span></button>
        <button class="btn btn-sm btn-primary v-export">${icon('download')}<span>Сохранить</span>${icon('chevron')}</button>
      </div>
    </div>
    <div class="viewer-body">${item.segments.length ? item.segments.map((s, i) => segHtml(s, i, true)).join('')
      : emptyView('mic', 'Речь не найдена', 'В файле не удалось распознать слова. Попробуйте другую модель или выключите «Пропускать тишину».')}</div>
    <div class="viewer-foot"><span>${words} ${plural(words, 'слово', 'слова', 'слов')} · ${fmtDate(item.created)}</span><span>Нажмите на текст, чтобы исправить ошибку</span></div>`;
  if (fromQueue) $('.viewer-body', v).style.animation = 'none';

  $('.title-input', v).onchange = async e => {
    const name = e.target.value.trim() || item.name;
    e.target.value = name;
    item.name = name;
    await api.rename_item(item.id, name);
    const h = S.history.find(x => x.id === item.id);
    if (h) { h.name = name; renderHistoryList(); }
  };
  $('.title-input', v).onkeydown = e => { if (e.key === 'Enter') e.target.blur(); };
  $('.ts-toggle', v).onclick = async () => {
    S.settings = await api.set_settings({ txt_timestamps: !S.settings.txt_timestamps });
    $$('.viewer').forEach(x => x.classList.toggle('no-ts', !S.settings.txt_timestamps));
    $$('.ts-toggle').forEach(x => x.classList.toggle('on', S.settings.txt_timestamps));
    $('#set-ts').checked = S.settings.txt_timestamps;
  };
  $('.v-copy', v).onclick = async () => {
    const ok = await copyText(await api.get_text(item.id, S.settings.txt_timestamps));
    toast(ok ? 'Текст скопирован' : 'Не удалось скопировать', { type: ok ? 'success' : 'error', timeout: 2000 });
  };
  $('.v-export', v).onclick = e => openExportMenu(e.currentTarget, item.id);
  $$('.seg p', v).forEach(p => {
    p.onfocus = () => { p.dataset.orig = p.textContent; };
    p.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); p.blur(); } if (e.key === 'Escape') { p.textContent = p.dataset.orig; p.blur(); } };
    p.onblur = async () => {
      const text = p.textContent.replace(/\s+/g, ' ').trim();
      if (text === p.dataset.orig) return;
      const i = +p.parentElement.dataset.i;
      item.segments[i].text = text;
      await api.update_segment(item.id, i, text);
    };
  });
}

let exportItem = null;
function openExportMenu(btn, itemId) {
  const m = $('#export-menu');
  exportItem = itemId;
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  m.style.top = `${r.bottom + 6}px`;
  m.style.left = `${Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 10)}px`;
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#export-menu') && !e.target.closest('.v-export')) $('#export-menu').hidden = true;
});
$$('#export-menu button').forEach(b => b.onclick = async () => {
  $('#export-menu').hidden = true;
  const res = await api.export(exportItem, b.dataset.fmt, S.settings.txt_timestamps);
  if (res.ok) toast('Файл сохранён', { type: 'success', action: { label: 'Показать', fn: () => api.reveal(res.path) } });
  else if (!res.cancelled) toast(res.error || 'Не удалось сохранить', { type: 'error' });
});

/* ================= ИСТОРИЯ ================= */
async function loadHistory() {
  S.history = await api.get_history();
  renderHistoryList();
  if (!S.historySel && S.history.length) openHistory(S.history[0].id);
  if (!S.history.length) $('#viewer-history').innerHTML = emptyView('history', 'История пуста', 'Здесь будут все ваши расшифровки. Они хранятся только на этом компьютере.');
}

function renderHistoryList() {
  const q = $('#history-search').value.trim().toLowerCase();
  const list = S.history.filter(h => !q || (h.name + ' ' + (h.preview || '')).toLowerCase().includes(q));
  const el = $('#history-list');
  if (!list.length) {
    el.innerHTML = `<div class="list-empty">${q ? 'Ничего не найдено' : 'Пока нет расшифровок'}</div>`;
    return;
  }
  el.innerHTML = list.map(h => `
    <div class="h-item${h.id === S.historySel ? ' selected' : ''}" data-id="${h.id}">
      <div class="h-top"><div class="h-name">${esc(h.name)}</div><div class="h-date">${fmtDate(h.created)}</div></div>
      <div class="h-preview">${esc(h.preview) || '<i>Без текста</i>'}</div>
      <div class="h-meta"><span class="chip">${icon('clock')}${fmtTs(h.duration)}</span><span class="chip">${esc(langName(h.language))}</span></div>
      <button class="btn-icon danger" title="Удалить">${icon('trash')}</button>
    </div>`).join('');
  $$('.h-item', el).forEach(it => {
    it.onclick = e => {
      if (e.target.closest('.btn-icon')) return deleteHistory(it.dataset.id);
      openHistory(it.dataset.id);
    };
  });
}

async function openHistory(id) {
  S.historySel = id;
  $$('.h-item').forEach(x => x.classList.toggle('selected', x.dataset.id === id));
  const item = await api.get_item(id);
  if (item) renderItemViewer($('#viewer-history'), item);
}

async function deleteHistory(id) {
  const h = S.history.find(x => x.id === id);
  if (!await confirmModal('Удалить расшифровку?', `«${h ? h.name : ''}» будет удалена из истории. Исходный файл не пострадает.`)) return;
  await api.delete_item(id);
  if (S.historySel === id) S.historySel = null;
  await loadHistory();
}

/* ================= МОДЕЛИ ================= */
async function refreshModels() {
  S.models = await api.get_models();
  renderModels();
  renderModelSelect();
}

function renderModelSelect() {
  const sel = $('#opt-model');
  const installed = S.models.filter(m => m.installed);
  if (installed.length && !installed.some(m => m.id === S.settings.model)) {
    S.settings.model = installed[0].id;
    api.set_settings({ model: S.settings.model });
  }
  sel.innerHTML = installed.map(m => `<option value="${m.id}">${esc(m.name)}${m.id === 'large-v3-turbo' ? ' — лучшая' : ''}</option>`).join('')
    || '<option>Нет моделей</option>';
  sel.disabled = !installed.length;
  sel.value = S.settings.model;
  $('#no-models').hidden = installed.length > 0;
  updateStartBar();
}

function renderModels() {
  const grid = $('#models-grid');
  grid.innerHTML = S.models.map(m => {
    const current = m.installed && m.id === S.settings.model;
    const dl = m.download;
    const dots = (n, cls = '') => `<div class="dots ${cls}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
    let tag = '';
    if (current) tag = '<span class="tag ok">Используется</span>';
    else if (m.id === 'large-v3-turbo') tag = '<span class="tag rec">Рекомендуем</span>';
    else if (m.installed) tag = '<span class="tag">Установлена</span>';
    let foot;
    if (dl) {
      const pct = dl.total ? dl.done / dl.total * 100 : 0;
      foot = `<div class="mc-progress">
          <div class="live-row"><b>Скачивание ${pct.toFixed(0)}%</b><span>${fmtSize(dl.done)} из ${fmtSize(dl.total)}</span></div>
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div><button class="btn btn-sm" data-act="cancel">Отмена</button></div></div>`;
    } else if (m.installed) {
      foot = `<div class="mc-foot"><span class="mc-size">${icon('folder')}${fmtMb(m.size_mb)}</span>
        ${m.bundled ? '' : `<button class="btn-icon danger" data-act="delete" title="Удалить с компьютера">${icon('trash')}</button>`}
        ${current ? `<button class="btn btn-sm" disabled>${icon('check')}<span>Выбрана</span></button>`
          : `<button class="btn btn-sm" data-act="use">Использовать</button>`}</div>`;
    } else {
      foot = `<div class="mc-foot"><span class="mc-size">${icon('download')}${fmtMb(m.size_mb)}</span>
        <button class="btn btn-sm btn-primary" data-act="download">${icon('download')}<span>Скачать</span></button></div>`;
    }
    return `<div class="card model-card${current ? ' current' : ''}" data-id="${m.id}">
      <div class="mc-head"><h3>${esc(m.name)}</h3>${tag}</div>
      <p class="mc-desc">${esc(m.desc)}</p>
      <div class="meters"><div class="meter">Качество${dots(m.quality)}</div><div class="meter">Скорость${dots(m.speed, 'speed')}</div></div>
      ${foot}</div>`;
  }).join('');
  $$('[data-act]', grid).forEach(b => b.onclick = () => modelAction(b.closest('.model-card').dataset.id, b.dataset.act));
}

async function modelAction(id, act) {
  if (act === 'use') {
    S.settings = await api.set_settings({ model: id });
    renderModels(); renderModelSelect();
    toast(`Выбрана модель ${modelName(id)}`, { type: 'success', timeout: 2000 });
  }
  if (act === 'download') {
    await api.download_model(id);
    await refreshModels();
  }
  if (act === 'cancel') await api.cancel_download(id);
  if (act === 'delete') {
    if (!await confirmModal('Удалить модель?', `Модель ${modelName(id)} будет удалена с компьютера. При необходимости её можно скачать снова.`)) return;
    const r = await api.delete_model(id);
    if (!r.ok && r.error) toast(r.error, { type: 'error' });
    await refreshModels();
  }
}

/* ================= ОБНОВЛЕНИЯ ================= */
function setUpdateUI(state, data = {}) {
  S.updateState = state;
  const st = $('#upd-status'), title = $('#upd-title'), actions = $('#upd-actions');
  const prog = $('#upd-progress'), notes = $('#upd-notes'), ic = $('.update-icon');
  ic.classList.toggle('ok', state === 'latest');
  ic.innerHTML = icon(state === 'latest' ? 'check' : 'up');
  prog.hidden = state !== 'downloading';
  title.innerHTML = `Версия ${esc(S.version)}`;
  notes.hidden = true;
  const u = S.update;
  switch (state) {
    case 'checking':
      st.textContent = 'Проверяем…';
      actions.innerHTML = `<button class="btn" disabled>${icon('retry', 'spin')}<span>Проверка</span></button>`;
      return;
    case 'latest':
      st.textContent = u && u.message ? u.message : 'У вас последняя версия';
      break;
    case 'error':
      st.textContent = data.error || 'Не удалось проверить обновления';
      break;
    case 'available':
      title.innerHTML = `Доступна версия ${esc(u.latest)}`;
      st.textContent = `Сейчас установлена ${S.version}${u.size ? ' · размер обновления ' + fmtSize(u.size) : ''}`;
      if (u.notes) { notes.textContent = u.notes; notes.hidden = false; }
      actions.innerHTML = `<button class="btn btn-primary" id="upd-go">${icon('download')}<span>Скачать и установить</span></button>`;
      $('#upd-go').onclick = startUpdate;
      return;
    case 'downloading': {
      title.innerHTML = `Обновление до ${esc(u.latest)}`;
      const pct = data.total ? data.done / data.total * 100 : 0;
      st.textContent = `Скачивание… ${pct.toFixed(0)}%${data.total ? ` (${fmtSize(data.done)} из ${fmtSize(data.total)})` : ''}`;
      prog.firstElementChild.style.width = `${pct}%`;
      if (!$('#upd-cancel')) {
        actions.innerHTML = `<button class="btn" id="upd-cancel">Отмена</button>`;
        $('#upd-cancel').onclick = () => api.cancel_update();
      }
      return;
    }
    case 'ready':
      title.innerHTML = `Обновление ${esc(u.latest)} готово`;
      st.textContent = 'Программа закроется, обновится и откроется снова';
      actions.innerHTML = `<button class="btn btn-primary" id="upd-install">${icon('retry')}<span>Перезапустить и обновить</span></button>`;
      $('#upd-install').onclick = () => installUpdate(data.path);
      return;
    default:
      st.textContent = 'Нажмите «Проверить», чтобы узнать о новой версии';
  }
  actions.innerHTML = `<button class="btn" id="upd-check">${icon('retry')}<span>Проверить</span></button>`;
  $('#upd-check').onclick = checkUpdate;
}

async function checkUpdate() {
  setUpdateUI('checking');
  const r = await api.check_update();
  if (!r.ok) return setUpdateUI('error', r);
  S.update = r;
  setUpdateUI(r.available ? 'available' : 'latest');
  showUpdateHint(r.available);
}

function showUpdateHint(on) {
  $('#update-pill').hidden = !on;
  $('#update-banner').hidden = !on || S.bannerClosed;
  if (on) $('#update-banner-ver').textContent = S.update.latest;
}

async function startUpdate() {
  if (!await api.download_update()) return checkUpdate();
  setUpdateUI('downloading', { done: 0, total: S.update.size });
}

async function installUpdate(path) {
  if (S.busy && !await confirmModal('Идёт расшифровка', 'Если обновить сейчас, текущая расшифровка прервётся. Продолжить?', 'Обновить')) return;
  toast('Устанавливаем обновление…', { timeout: 8000 });
  await api.install_update(path);
}

/* ================= СОБЫТИЯ ОТ PYTHON ================= */
window.AveSTT = {
  onEvent({ type, data }) {
    switch (type) {
      case 'files_added': addJobs(data); break;
      case 'job': onJob(data); break;
      case 'segment': onSegment(data); break;
      case 'engine':
        S.busy = data.busy;
        updateStartBar();
        if (!data.busy) renderQueue();
        break;
      case 'model_progress': {
        const m = S.models.find(x => x.id === data.id);
        if (m) { m.download = { done: data.done, total: data.total }; renderModels(); }
        break;
      }
      case 'model_done':
        if (data.ok) toast(`Модель ${modelName(data.id)} установлена`, { type: 'success' });
        else if (data.error !== 'cancelled') toast('Не удалось скачать модель. Проверьте подключение к интернету.', { type: 'error', timeout: 7000 });
        refreshModels();
        break;
      case 'update_available':
        S.update = data;
        showUpdateHint(true);
        setUpdateUI('available');
        break;
      case 'update_progress': setUpdateUI('downloading', data); break;
      case 'update_ready':
        setUpdateUI('ready', data);
        if (!S.busy) installUpdate(data.path);
        break;
      case 'update_error':
        if (data.error === 'cancelled') setUpdateUI('available');
        else { setUpdateUI('error', { error: 'Не удалось скачать обновление. Проверьте интернет.' }); toast('Ошибка при скачивании обновления', { type: 'error' }); }
        break;
    }
  },
};

function onJob(j) {
  const prev = S.jobs.get(j.id);
  S.jobs.set(j.id, { ...prev, ...j });
  j = S.jobs.get(j.id);
  if (j.status === 'running' && !S.live[j.id]) S.live[j.id] = [];
  if (j.status === 'running' && (S.follow || !S.selectedJob) && S.selectedJob !== j.id) {
    S.selectedJob = j.id;
    renderQueue();
    return renderMainViewer();
  }
  renderJob(j);
  renderQueue();
  if (S.selectedJob !== j.id) {
    if (j.status === 'done' && prev && prev.status !== 'done') toast(`Готово: ${j.name}`, { type: 'success' });
    return;
  }
  const v = $('#viewer-main');
  if (j.status === 'running' && $('.viewer-live', v)) {
    updateLiveBar(v, j);
    const chips = $('.vh-meta', v);
    if (j.language && chips && !chips.dataset.lang) {
      chips.dataset.lang = '1';
      chips.insertAdjacentHTML('beforeend', `<span class="chip">${icon('globe')}${esc(langName(j.language))}</span>`);
    }
  } else {
    renderMainViewer();
  }
  if (j.status === 'done' && prev && prev.status !== 'done') {
    toast(`Готово: ${j.name}`, { type: 'success' });
    delete S.live[j.id];
  }
}

function onSegment({ job, segment, progress, eta }) {
  const j = S.jobs.get(job);
  if (!j) return;
  (S.live[job] = S.live[job] || []).push(segment);
  j.progress = progress; j.eta = eta;
  renderJob(j);
  if (S.selectedJob !== job) return;
  const v = $('#viewer-main');
  const body = $('.viewer-body', v);
  if (!body || !$('.viewer-live', v)) return;
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  $('.typing', body).insertAdjacentHTML('beforebegin', segHtml(segment, S.live[job].length - 1, false));
  updateLiveBar(v, j);
  if (nearBottom) body.scrollTop = body.scrollHeight;
}

/* ================= НАСТРОЙКИ ================= */
function bindSettings() {
  const s = S.settings;
  $('#set-vad').checked = s.vad;
  $('#set-ts').checked = s.txt_timestamps;
  $('#set-autosave').checked = s.autosave_txt;
  $('#set-autoupdate').checked = s.auto_update_check;
  const th = $('#set-threads');
  th.max = S.cpu;
  th.value = Math.min(s.threads, S.cpu);
  $('#threads-val').textContent = th.value;

  const save = async (key, value) => { S.settings = await api.set_settings({ [key]: value }); };
  $('#set-vad').onchange = e => save('vad', e.target.checked);
  $('#set-ts').onchange = async e => {
    await save('txt_timestamps', e.target.checked);
    $$('.viewer').forEach(x => x.classList.toggle('no-ts', !e.target.checked));
    $$('.ts-toggle').forEach(x => x.classList.toggle('on', e.target.checked));
  };
  $('#set-autosave').onchange = e => save('autosave_txt', e.target.checked);
  $('#set-autoupdate').onchange = e => save('auto_update_check', e.target.checked);
  th.oninput = () => { $('#threads-val').textContent = th.value; };
  th.onchange = () => save('threads', +th.value);

  $$('#theme-picker button').forEach(b => b.onclick = () => setTheme(b.dataset.value));
  $('#theme-quick').onclick = () => setTheme(effectiveTheme(S.settings.theme) === 'dark' ? 'light' : 'dark');
  $('#cur-version').textContent = S.version;
  $('#about-version').textContent = S.version;
  $('#open-repo').onclick = () => api.open_url(`https://github.com/${S.repo}`);
  setUpdateUI('idle');
}

/* ================= ЗАПУСК ================= */
function bindUI() {
  $$('.nav-item').forEach(b => b.onclick = () => go(b.dataset.page));
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-goto]');
    if (a) { e.preventDefault(); go(a.dataset.goto); }
  });

  $('#dropzone').onclick = async () => addJobs(await api.pick_files(), false);
  $('#start-btn').onclick = async () => {
    S.follow = true;
    await api.start();
  };
  $('#stop-btn').onclick = async () => {
    if (await confirmModal('Остановить расшифровку?', 'Текущий файл и вся очередь будут остановлены. Уже готовые расшифровки сохранятся.', 'Остановить')) api.cancel(null);
  };
  $('#clear-finished').onclick = async () => {
    const left = await api.clear_finished();
    const ids = new Set(left.map(j => j.id));
    for (const id of [...S.jobs.keys()]) if (!ids.has(id)) { S.jobs.delete(id); delete S.live[id]; }
    if (S.selectedJob && !S.jobs.has(S.selectedJob)) { S.selectedJob = null; renderMainViewer(); }
    renderQueue();
  };

  const lang = $('#opt-language');
  lang.innerHTML = S.languages.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('');
  lang.value = S.settings.language;
  lang.onchange = async () => { S.settings = await api.set_settings({ language: lang.value }); };
  $('#opt-model').onchange = async e => { S.settings = await api.set_settings({ model: e.target.value }); renderModels(); };
  $$('#opt-task button').forEach(b => {
    b.classList.toggle('active', b.dataset.value === S.settings.task);
    b.onclick = async () => {
      $$('#opt-task button').forEach(x => x.classList.toggle('active', x === b));
      S.settings = await api.set_settings({ task: b.dataset.value });
    };
  });

  $('#history-search').oninput = renderHistoryList;
  $('#update-banner-go').onclick = () => { go('settings'); $('#update-card').scrollIntoView({ behavior: 'smooth' }); startUpdate(); };
  $('#update-banner-close').onclick = () => { S.bannerClosed = true; $('#update-banner').hidden = true; };

  // Перетаскивание: подсветка. Сами пути файлов получает Python
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', e => { if (hasFiles(e)) { depth++; document.body.classList.add('dragging'); } });
  document.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); });

  document.addEventListener('keydown', async e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); addJobs(await api.pick_files(), false); }
    if (e.key === 'Escape') $('#export-menu').hidden = true;
  });
  document.addEventListener('contextmenu', e => { if (!e.target.closest('input, [contenteditable], .viewer-body')) e.preventDefault(); });
}

window.addEventListener('pywebviewready', async () => {
  api = window.pywebview.api;
  const st = await api.get_state();
  Object.assign(S, { version: st.version, repo: st.repo, settings: st.settings, languages: st.languages, models: st.models, cpu: st.cpu_count, busy: st.busy });
  st.jobs.forEach(j => S.jobs.set(j.id, j));
  applyTheme(S.settings.theme);
  bindUI();
  bindSettings();
  renderModelSelect();
  renderModels();
  renderQueue();
  renderMainViewer();
  await api.ready();
});
