import { store } from './store.js';
import { renderStats, todayStr, parseDate, readingDays } from './stats.js';
import { MODES, ask, buildPastePrompt, explainError } from './ai.js';
import { esc, toast, download, copyText, markdown } from './util.js';

const $ = sel => document.querySelector(sel);
const STATUS_LABEL = { read: 'Lido', reading: 'A ler', toread: 'Por ler', abandoned: 'Abandonado' };
const TITLES = { books: 'Livros', stats: 'Métricas', ai: 'IA', settings: 'Definições' };

let filter = 'all';
let currentView = 'books';

/* ---------- Navegação ---------- */
function show(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#view-title').textContent = TITLES[view];
  $('#add-btn').hidden = view !== 'books';
  if (view === 'stats') renderStats($('#view-stats'), store.books, store.settings);
  if (view === 'ai') renderAi();
  if (view === 'settings') fillSettings();
  window.scrollTo(0, 0);
  try { sessionStorage.setItem('booksread.view', view); } catch {}
}
document.querySelectorAll('.tabbar button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

/* ---------- Lista de livros ---------- */
const stars = n => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');

function renderList() {
  const q = $('#search').value.trim().toLocaleLowerCase('pt');
  const sort = $('#sort').value;
  let list = store.books.filter(b => filter === 'all' || b.status === filter);
  if (q) list = list.filter(b => [b.title, b.author, b.genre, b.notes].some(x => (x || '').toLocaleLowerCase('pt').includes(q)));
  const cmp = {
    recent: (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
    title: (a, b) => a.title.localeCompare(b.title, 'pt'),
    author: (a, b) => (a.author || '').localeCompare(b.author || '', 'pt') || a.title.localeCompare(b.title, 'pt'),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    finished: (a, b) => (b.endDate || '').localeCompare(a.endDate || ''),
  }[sort];
  list.sort(cmp);

  $('#empty-books').hidden = store.books.length > 0;
  $('#book-list').innerHTML = list.map(b => {
    const days = readingDays(b);
    const pct = b.status === 'reading' && b.pages && b.currentPage ? Math.min(100, Math.round((b.currentPage / b.pages) * 100)) : null;
    const quick = b.status === 'toread' ? `<button class="quick" data-quick="start" data-id="${b.id}">Começar</button>`
      : b.status === 'reading' ? `<button class="quick" data-quick="finish" data-id="${b.id}">Terminei ✓</button>` : '';
    return `<li class="book" data-id="${b.id}">
      ${b.cover ? `<img class="cover" src="${esc(b.cover)}" alt="" loading="lazy">` : '<div class="cover">📘</div>'}
      <div class="info">
        <div class="title">${esc(b.title)}</div>
        <div class="author">${esc(b.author || '—')}</div>
        <div class="meta">
          <span class="badge ${b.status}">${STATUS_LABEL[b.status]}</span>
          ${b.rating ? `<span aria-label="${b.rating} estrelas">${stars(b.rating)}</span>` : ''}
          ${days ? `<span>${days} dias</span>` : ''}
          ${b.notes ? '<span>📝</span>' : ''}
        </div>
        ${pct != null ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}
      </div>
      ${quick}
    </li>`;
  }).join('');
  if (store.books.length && !list.length) $('#book-list').innerHTML = '<li class="empty">Nenhum livro corresponde.</li>';
  updateDatalists();
}

function updateDatalists() {
  const uniq = key => [...new Set(store.books.map(b => (b[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  $('#genres-list').innerHTML = uniq('genre').map(g => `<option value="${esc(g)}">`).join('');
  $('#authors-list').innerHTML = uniq('author').map(g => `<option value="${esc(g)}">`).join('');
}

$('#search').addEventListener('input', renderList);
$('#sort').addEventListener('change', renderList);
$('#status-filter').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  filter = btn.dataset.status;
  document.querySelectorAll('#status-filter button').forEach(b => b.classList.toggle('on', b === btn));
  renderList();
});
$('#book-list').addEventListener('click', e => {
  const quick = e.target.closest('[data-quick]');
  if (quick) {
    const b = store.getBook(quick.dataset.id);
    if (quick.dataset.quick === 'start') {
      store.upsertBook({ ...b, status: 'reading', startDate: b.startDate || todayStr() });
      toast(`Boa leitura de «${b.title}»`);
    } else {
      openSheet(b.id, { status: 'read', endDate: b.endDate || todayStr() });
      return;
    }
    renderList();
    return;
  }
  const li = e.target.closest('.book');
  if (li) openSheet(li.dataset.id);
});

/* ---------- Folha de edição ---------- */
const sheet = $('#book-sheet');
let editingId = null;
let rating = 0;

function renderStars() {
  $('#f-rating').innerHTML = [1, 2, 3, 4, 5].map(i =>
    `<button type="button" data-v="${i}" class="${i <= rating ? 'on' : ''}" role="radio" aria-checked="${i === rating}" aria-label="${i} estrela${i > 1 ? 's' : ''}">★</button>`).join('');
}
$('#f-rating').addEventListener('click', e => {
  const v = Number(e.target.closest('button')?.dataset.v);
  if (!v) return;
  rating = rating === v ? 0 : v;
  renderStars();
});

function setCover(url) {
  $('#f-cover').value = url || '';
  const img = $('#f-cover-img');
  img.hidden = !url;
  if (url) img.src = url; else img.removeAttribute('src');
}

function syncStatusFields() {
  $('#current-page-field').hidden = $('#f-status').value !== 'reading';
}
$('#f-status').addEventListener('change', () => {
  const st = $('#f-status').value;
  if ((st === 'reading' || st === 'read') && !$('#f-start').value) $('#f-start').value = todayStr();
  if (st === 'read' && !$('#f-end').value) $('#f-end').value = todayStr();
  syncStatusFields();
});

function openSheet(id = null, overrides = {}) {
  editingId = id;
  const b = { status: 'toread', ...(id ? store.getBook(id) : {}), ...overrides };
  $('#sheet-title').textContent = id ? 'Editar livro' : 'Novo livro';
  $('#lookup').hidden = !!id;
  $('#lookup-q').value = '';
  $('#lookup-results').innerHTML = '';
  $('#f-title').value = b.title || '';
  $('#f-author').value = b.author || '';
  $('#f-genre').value = b.genre || '';
  $('#f-pages').value = b.pages || '';
  $('#f-status').value = b.status;
  $('#f-current').value = b.currentPage || '';
  $('#f-start').value = b.startDate || '';
  $('#f-end').value = b.endDate || '';
  $('#f-notes').value = b.notes || '';
  $('#f-year').value = b.year || '';
  $('#form-error').hidden = true;
  $('#delete-book').hidden = !id;
  rating = b.rating || 0;
  renderStars();
  setCover(b.cover);
  syncStatusFields();
  sheet.showModal();
  sheet.scrollTop = 0;
}

$('#add-btn').addEventListener('click', () => openSheet());
$('#sheet-cancel').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });

$('#book-form').addEventListener('submit', e => {
  e.preventDefault();
  const err = msg => { $('#form-error').textContent = msg; $('#form-error').hidden = false; };
  const title = $('#f-title').value.trim();
  const status = $('#f-status').value;
  const startDate = $('#f-start').value;
  const endDate = $('#f-end').value;
  const pages = Number($('#f-pages').value) || null;
  const currentPage = Number($('#f-current').value) || null;
  if (!title) return err('O título é obrigatório.');
  if (startDate && endDate && parseDate(endDate) < parseDate(startDate)) return err('A data de fim não pode ser anterior à de início.');
  if (endDate && parseDate(endDate) > parseDate(todayStr())) return err('A data de fim não pode ser no futuro.');
  if (pages && currentPage && currentPage > pages) return err('A página atual é maior que o número de páginas.');
  const book = {
    id: editingId || undefined,
    title,
    author: $('#f-author').value.trim(),
    genre: $('#f-genre').value.trim(),
    pages,
    status,
    currentPage: status === 'reading' ? currentPage : null,
    startDate,
    endDate: status === 'reading' || status === 'toread' ? '' : endDate,
    rating,
    notes: $('#f-notes').value.trim(),
    cover: $('#f-cover').value,
    year: $('#f-year').value || null,
  };
  if (!store.upsertBook(book)) return err('Não foi possível guardar (armazenamento cheio?).');
  sheet.close();
  toast(editingId ? 'Livro atualizado' : 'Livro adicionado');
  renderList();
});

$('#delete-book').addEventListener('click', () => {
  const b = store.getBook(editingId);
  if (!b || !confirm(`Apagar «${b.title}»?`)) return;
  store.deleteBook(editingId);
  sheet.close();
  toast('Livro apagado');
  renderList();
});

/* ---------- Pesquisa online (Open Library) ---------- */
let lookupTimer, lookupSeq = 0, lookupDocs = [];
$('#lookup-q').addEventListener('input', () => {
  clearTimeout(lookupTimer);
  const q = $('#lookup-q').value.trim();
  if (q.length < 3) { $('#lookup-results').innerHTML = ''; return; }
  lookupTimer = setTimeout(() => lookup(q), 400);
});

async function lookup(q) {
  const seq = ++lookupSeq;
  const isbn = q.replace(/[-\s]/g, '');
  const param = /^\d{10}(\d{3})?$/.test(isbn) ? `isbn=${isbn}` : `q=${encodeURIComponent(q)}`;
  $('#lookup-results').innerHTML = '<li class="hint">A procurar…</li>';
  try {
    const res = await fetch(`https://openlibrary.org/search.json?${param}&limit=6&fields=title,author_name,number_of_pages_median,cover_i,first_publish_year,subject`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    if (seq !== lookupSeq) return;
    lookupDocs = data.docs || [];
    $('#lookup-results').innerHTML = lookupDocs.length ? lookupDocs.map((d, i) => `
      <li><button type="button" data-i="${i}">
        ${d.cover_i ? `<img src="https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg" alt="">` : '<span class="ph"></span>'}
        <span><strong>${esc(d.title)}</strong><small>${esc((d.author_name || []).slice(0, 2).join(', '))}${d.first_publish_year ? ` · ${d.first_publish_year}` : ''}${d.number_of_pages_median ? ` · ${d.number_of_pages_median} pág.` : ''}</small></span>
      </button></li>`).join('') : '<li class="hint">Sem resultados. Preenche à mão.</li>';
  } catch {
    if (seq === lookupSeq) $('#lookup-results').innerHTML = '<li class="hint">Pesquisa indisponível (sem rede?). Preenche à mão.</li>';
  }
}

$('#lookup-results').addEventListener('click', e => {
  const btn = e.target.closest('button[data-i]');
  if (!btn) return;
  const d = lookupDocs[Number(btn.dataset.i)];
  $('#f-title').value = d.title || '';
  $('#f-author').value = (d.author_name || []).join(', ');
  if (d.number_of_pages_median) $('#f-pages').value = d.number_of_pages_median;
  if (d.first_publish_year) $('#f-year').value = d.first_publish_year;
  if (!$('#f-genre').value && d.subject?.length) $('#f-genre').value = guessGenre(d.subject);
  setCover(d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '');
  $('#lookup-results').innerHTML = '';
  $('#lookup-q').value = '';
});

const GENRES = [
  [/philosoph/i, 'Filosofia'], [/econom|finance|money|business|management/i, 'Economia e Negócios'],
  [/psycholog|self-help|habit|mind/i, 'Psicologia'], [/histor/i, 'História'], [/science fiction/i, 'Ficção científica'],
  [/fantasy/i, 'Fantasia'], [/biograph|memoir/i, 'Biografia'], [/scien|physics|biology|evolution|mathemat/i, 'Ciência'],
  [/politic/i, 'Política'], [/technolog|computer|programming|software/i, 'Tecnologia'], [/relig|spiritual/i, 'Religião e Espiritualidade'],
  [/poetry/i, 'Poesia'], [/mystery|detective|thriller|crime/i, 'Policial e Thriller'], [/fiction|novel/i, 'Romance'],
];
function guessGenre(subjects) {
  const s = subjects.slice(0, 15).join(' | ');
  return GENRES.find(([re]) => re.test(s))?.[1] || '';
}

/* ---------- IA ---------- */
let aiRunning = null;

function renderAi() {
  const hasKey = !!store.settings.apiKey;
  const readCount = store.books.filter(b => b.status === 'read').length;
  $('#ai-key-hint').innerHTML = hasKey
    ? `A usar ${store.settings.model.includes('sonnet') ? 'Claude Sonnet 5.5' : 'Claude Opus 5.5'} · ${readCount} livros lidos como contexto.`
    : 'Sem chave de API: ao tocar numa opção, o prompt é copiado para colares na app Claude. Adiciona a chave nas <strong>Definições</strong> para respostas aqui.';
  $('#ai-history').innerHTML = store.aiHistory.length ? store.aiHistory.map(a => `
    <li><button data-open="${a.id}"><strong>${esc(a.title)}</strong><small>${new Date(a.date).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })}</small></button>
    <button class="del" data-del="${a.id}" aria-label="Apagar">✕</button></li>`).join('') : '<li class="hint">Nenhuma ainda.</li>';
}

async function runAi(modeKey, question) {
  if (aiRunning) return;
  if (!store.books.some(b => b.status === 'read')) {
    toast('Marca pelo menos um livro como lido primeiro.');
    return;
  }
  const title = modeKey === 'free' ? question.slice(0, 60) : MODES[modeKey].title;
  if (!store.settings.apiKey) {
    const ok = await copyText(buildPastePrompt(store.books, modeKey, question));
    toast(ok ? 'Prompt copiado — cola-o na app Claude.' : 'Não foi possível copiar.', 3500);
    return;
  }
  const out = $('#ai-text');
  $('#ai-output').hidden = false;
  $('#ai-output-title').textContent = title;
  $('#ai-stop').hidden = false;
  $('#ai-copy').hidden = true;
  out.innerHTML = '<span class="cursor"></span>';
  $('#ai-output').scrollIntoView({ behavior: 'smooth', block: 'start' });

  let text = '', raf = 0;
  const paint = () => { raf = 0; out.innerHTML = markdown(text) + '<span class="cursor"></span>'; };
  const handle = {};
  aiRunning = handle;
  document.querySelectorAll('.ai-card, #ai-ask button').forEach(b => { b.disabled = true; });
  try {
    const res = await ask({
      apiKey: store.settings.apiKey,
      model: store.settings.model,
      books: store.books,
      modeKey, question, handle,
      onText: d => { text += d; if (!raf) raf = requestAnimationFrame(paint); },
    });
    cancelAnimationFrame(raf);
    if (res.stopReason === 'refusal') {
      out.innerHTML = markdown(text) + '<p class="error">O modelo recusou este pedido. Tenta reformular a pergunta.</p>';
    } else {
      text = res.text;
      out.innerHTML = markdown(text) + (res.stopReason === 'max_tokens' ? '<p class="hint">(resposta cortada por ser demasiado longa)</p>' : '');
      store.addAi({ mode: modeKey, title, content: text });
    }
  } catch (err) {
    cancelAnimationFrame(raf);
    out.innerHTML = (text ? markdown(text) : '') + `<p class="error">${esc(explainError(err))}</p>`;
  } finally {
    aiRunning = null;
    $('#ai-stop').hidden = true;
    $('#ai-copy').hidden = false;
    $('#ai-copy').dataset.text = text;
    document.querySelectorAll('.ai-card, #ai-ask button').forEach(b => { b.disabled = false; });
    renderAi();
  }
}

document.querySelectorAll('.ai-card').forEach(c => c.addEventListener('click', () => runAi(c.dataset.mode)));
$('#ai-ask').addEventListener('submit', e => {
  e.preventDefault();
  const q = $('#ai-question').value.trim();
  if (!q) return;
  runAi('free', q);
});
$('#ai-stop').addEventListener('click', () => aiRunning?.abort?.());
$('#ai-copy').addEventListener('click', async () => {
  toast((await copyText($('#ai-copy').dataset.text || '')) ? 'Copiado' : 'Não foi possível copiar');
});
$('#ai-history').addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  const del = e.target.closest('[data-del]');
  if (del) { store.deleteAi(del.dataset.del); renderAi(); return; }
  if (!open) return;
  const a = store.aiHistory.find(x => x.id === open.dataset.open);
  $('#ai-output').hidden = false;
  $('#ai-output-title').textContent = a.title;
  $('#ai-text').innerHTML = markdown(a.content);
  $('#ai-copy').dataset.text = a.content;
  $('#ai-copy').hidden = false;
  $('#ai-output').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ---------- Definições ---------- */
function fillSettings() {
  $('#set-goal').value = store.settings.yearGoal ?? '';
  $('#set-key').value = store.settings.apiKey || '';
  $('#set-model').value = store.settings.model;
}
$('#settings-form').addEventListener('submit', e => {
  e.preventDefault();
  store.updateSettings({
    yearGoal: Math.max(0, Number($('#set-goal').value) || 0),
    apiKey: $('#set-key').value.trim(),
    model: $('#set-model').value,
  });
  toast('Definições guardadas');
});

const stamp = () => todayStr();
$('#export-json').addEventListener('click', () => {
  download(`livros-${stamp()}.json`, JSON.stringify(store.exportData(), null, 2));
});
$('#export-csv').addEventListener('click', () => {
  const cols = ['title', 'author', 'genre', 'pages', 'status', 'startDate', 'endDate', 'rating', 'notes'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.join(','), ...store.books.map(b => cols.map(c => q(c === 'status' ? STATUS_LABEL[b.status] : b[c])).join(','))];
  download(`livros-${stamp()}.csv`, '﻿' + rows.join('\n'), 'text/csv');
});
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const n = store.importData(JSON.parse(await file.text()));
    toast(`${n} livros importados`);
    renderList();
    fillSettings();
  } catch (err) {
    toast(err.message || 'Ficheiro inválido');
  }
  e.target.value = '';
});
$('#copy-prompt').addEventListener('click', async () => {
  const ok = await copyText(buildPastePrompt(store.books, 'knowledge'));
  toast(ok ? 'Prompt copiado — cola-o na app Claude.' : 'Não foi possível copiar.');
});
$('#wipe').addEventListener('click', () => {
  if (!confirm('Apagar TODOS os livros e análises? Esta ação não pode ser desfeita.')) return;
  store.wipe();
  renderList();
  toast('Dados apagados');
});

/* ---------- Arranque ---------- */
renderList();
let startView = 'books';
try { startView = sessionStorage.getItem('booksread.view') || 'books'; } catch {}
show(TITLES[startView] ? startView : 'books');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
// Pede ao browser para não apagar os dados locais.
navigator.storage?.persist?.().catch(() => {});
