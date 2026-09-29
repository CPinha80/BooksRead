// Cálculo e desenho das métricas de leitura.
import { esc } from './util.js';

const DAY = 86400000;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const parseDate = s => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const todayStr = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
const todayUTC = () => parseDate(todayStr());

/** Dias de leitura, contando o dia de início e o de fim. */
export const readingDays = b => {
  const s = parseDate(b.startDate), e = parseDate(b.endDate);
  if (s == null || e == null || e < s) return null;
  return Math.round((e - s) / DAY) + 1;
};

const fmt = (n, d = 0) => Number(n).toLocaleString('pt-PT', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
const fmtDate = ms => new Date(ms).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function computeStats(books) {
  const now = todayUTC();
  const year = new Date(now).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - yearStart) / DAY;
  const dayOfYear = Math.round((now - yearStart) / DAY) + 1;

  const read = books.filter(b => b.status === 'read');
  const reading = books.filter(b => b.status === 'reading');
  const abandoned = books.filter(b => b.status === 'abandoned');
  const toread = books.filter(b => b.status === 'toread');
  const endYear = b => { const e = parseDate(b.endDate); return e == null ? null : new Date(e).getUTCFullYear(); };
  const readThisYear = read.filter(b => endYear(b) === year);

  const pages = b => (Number(b.pages) > 0 ? Number(b.pages) : 0);
  const pagesRead = read.reduce((a, b) => a + pages(b), 0);
  const pagesInProgress = reading.reduce((a, b) => a + Math.min(Number(b.currentPage) || 0, pages(b) || Infinity), 0);
  const pagesThisYear = readThisYear.reduce((a, b) => a + pages(b), 0);

  const timed = read.map(b => ({ b, days: readingDays(b) })).filter(x => x.days != null);
  const avgDays = timed.length ? timed.reduce((a, x) => a + x.days, 0) / timed.length : null;
  const paced = timed.filter(x => pages(x.b) > 0);
  const pace = paced.length ? paced.reduce((a, x) => a + pages(x.b), 0) / paced.reduce((a, x) => a + x.days, 0) : null;

  const rated = read.filter(b => b.rating > 0);
  const avgRating = rated.length ? rated.reduce((a, b) => a + b.rating, 0) / rated.length : null;
  const withPages = read.filter(b => pages(b) > 0);
  const avgPages = withPages.length ? pagesRead / withPages.length : null;

  // Últimos 12 meses (por data de fim)
  const d = new Date(now);
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth(), count: 0, pages: 0, titles: [] });
  }
  for (const b of read) {
    const e = parseDate(b.endDate);
    if (e == null) continue;
    const ed = new Date(e);
    const slot = months.find(x => x.y === ed.getUTCFullYear() && x.m === ed.getUTCMonth());
    if (slot) { slot.count++; slot.pages += pages(b); slot.titles.push(b.title); }
  }

  // Por ano
  const byYear = new Map();
  for (const b of read) {
    const y = endYear(b);
    if (y != null) byYear.set(y, (byYear.get(y) || 0) + 1);
  }

  const countBy = (list, key) => {
    const m = new Map();
    for (const b of list) {
      const k = (b[key] || '').trim();
      if (!k) continue;
      const norm = k.toLocaleLowerCase('pt');
      const cur = m.get(norm) || { name: k, count: 0 };
      cur.count++;
      m.set(norm, cur);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'pt'));
  };
  const genres = countBy(read, 'genre');
  const authors = countBy(read, 'author');

  // Recordes
  const byDays = [...timed].sort((a, b) => a.days - b.days);
  const fastest = byDays[0] || null;
  const slowest = byDays.length > 1 ? byDays[byDays.length - 1] : null;
  const longest = [...withPages].sort((a, b) => pages(b) - pages(a))[0] || null;
  const best = [...rated].sort((a, b) => b.rating - a.rating || (parseDate(b.endDate) || 0) - (parseDate(a.endDate) || 0))[0] || null;
  const fastestPace = [...paced].sort((a, b) => pages(b.b) / b.days - pages(a.b) / a.days)[0] || null;

  // Dias deste ano com pelo menos um livro em mãos (união de intervalos)
  const intervals = [];
  for (const b of [...read, ...reading, ...abandoned]) {
    const s = parseDate(b.startDate);
    if (s == null) continue;
    let e = parseDate(b.endDate);
    if (e == null) e = b.status === 'reading' ? now : null;
    if (e == null || e < s) continue;
    const cs = Math.max(s, yearStart), ce = Math.min(e, now);
    if (ce >= cs) intervals.push([cs, ce]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let daysWithBook = 0, curS = null, curE = null;
  for (const [s, e] of intervals) {
    if (curS == null) { curS = s; curE = e; continue; }
    if (s <= curE + DAY) curE = Math.max(curE, e);
    else { daysWithBook += (curE - curS) / DAY + 1; curS = s; curE = e; }
  }
  if (curS != null) daysWithBook += (curE - curS) / DAY + 1;

  // Máximo de livros em simultâneo (em todo o histórico)
  const events = [];
  for (const b of [...read, ...reading, ...abandoned]) {
    const s = parseDate(b.startDate);
    const e = parseDate(b.endDate) ?? (b.status === 'reading' ? now : null);
    if (s == null || e == null || e < s) continue;
    events.push([s, 1], [e + DAY, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let concurrent = 0, maxConcurrent = 0;
  for (const [, v] of events) { concurrent += v; maxConcurrent = Math.max(maxConcurrent, concurrent); }

  // Projeções
  const projected = dayOfYear > 0 ? (readThisYear.length / dayOfYear) * daysInYear : 0;

  // Estimativa de fim para livros a ler
  const inProgress = reading.map(b => {
    const total = pages(b), cur = Math.min(Number(b.currentPage) || 0, total || Infinity);
    const pct = total ? cur / total : null;
    let eta = null;
    const s = parseDate(b.startDate);
    if (total && cur > 0 && s != null) {
      const elapsed = Math.max(1, Math.round((now - s) / DAY) + 1);
      const own = cur / elapsed;
      const rate = own > 0 ? own : pace;
      if (rate) eta = now + Math.ceil((total - cur) / rate) * DAY;
    }
    return { b, pct, eta };
  });

  const finished = read.length + abandoned.length;
  return {
    year, dayOfYear, daysInYear,
    counts: { total: books.length, read: read.length, reading: reading.length, toread: toread.length, abandoned: abandoned.length },
    readThisYear: readThisYear.length, pagesThisYear, pagesRead, pagesInProgress,
    avgDays, pace, avgRating, avgPages, ratedCount: rated.length,
    months, byYear: [...byYear.entries()].sort((a, b) => a[0] - b[0]),
    genres, authors, fastest, slowest, longest, best, fastestPace,
    daysWithBook, maxConcurrent, projected, inProgress,
    completionRate: finished ? read.length / finished : null,
    pagesPerDayThisYear: dayOfYear ? pagesThisYear / dayOfYear : 0,
  };
}

function barChart(months) {
  const W = 340, H = 150, top = 16, bottom = 22, left = 4, right = 4;
  const max = Math.max(1, ...months.map(m => m.count));
  const step = (W - left - right) / months.length;
  const bw = Math.min(18, step * 0.62);
  const ih = H - top - bottom;
  const peak = months.reduce((a, m, i) => (m.count > months[a].count ? i : a), 0);
  let bars = '';
  months.forEach((m, i) => {
    const x = left + i * step + (step - bw) / 2;
    const h = (m.count / max) * ih;
    const y = top + ih - h;
    const r = Math.min(4, h, bw / 2);
    const path = h > 0
      ? `M${x},${top + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${top + ih} Z`
      : '';
    const tip = `${MONTHS[m.m]} ${m.y}: ${plural(m.count, 'livro', 'livros')}${m.pages ? ` · ${fmt(m.pages)} pág.` : ''}`;
    bars += `<g class="col" data-tip="${esc(tip)}" data-x="${((x + bw / 2) / W) * 100}" data-y="${(y / H) * 100}">
      <rect class="hit" x="${left + i * step}" y="0" width="${step}" height="${H}"></rect>
      ${path ? `<path class="bar" d="${path}"></path>` : ''}
      ${(i === peak && m.count > 0) || (i === months.length - 1 && m.count > 0) ? `<text class="val" x="${x + bw / 2}" y="${y - 4}" text-anchor="middle">${m.count}</text>` : ''}
      <text class="axis" x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${MONTHS[m.m][0].toUpperCase()}${MONTHS[m.m].slice(1, 3)}</text>
    </g>`;
  });
  const grid = `<line class="grid" x1="0" x2="${W}" y1="${top + ih}" y2="${top + ih}"></line>`;
  return `<div class="chart" data-chart>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Livros terminados por mês nos últimos 12 meses">${grid}${bars}</svg>
    <div class="tip" hidden></div>
  </div>
  <details><summary class="hint">Ver tabela</summary>
    <ul class="records" style="margin-top:8px">${months.map(m => `<li><span>${MONTHS[m.m]} ${m.y}</span><strong>${m.count} · ${fmt(m.pages)} pág.</strong></li>`).join('')}</ul>
  </details>`;
}

function hbars(items, total, limit = 6) {
  if (!items.length) return '<p class="hint">Sem dados ainda.</p>';
  let list = items.slice(0, limit);
  const rest = items.slice(limit).reduce((a, x) => a + x.count, 0);
  if (rest) list = [...list, { name: 'Outros', count: rest }];
  const max = Math.max(...list.map(x => x.count));
  return `<div class="hbars">${list.map(x => `
    <div class="hbar"><span class="n">${esc(x.name)}</span>
      <span class="t"><i style="width:${(x.count / max) * 100}%"></i></span>
      <span class="c">${x.count}${total ? ` · ${Math.round((x.count / total) * 100)}%` : ''}</span></div>`).join('')}</div>`;
}

const rec = (label, value, sub) => `<li><span>${label}</span><strong>${value}${sub ? `<small>${sub}</small>` : ''}</strong></li>`;

export function renderStats(el, books, settings) {
  const s = computeStats(books);
  const goal = Number(settings.yearGoal) || 0;

  if (!books.length) {
    el.innerHTML = `<div class="empty"><p>📊 As métricas aparecem quando adicionares livros.</p></div>`;
    return;
  }

  const expectedNow = goal ? (goal * s.dayOfYear) / s.daysInYear : 0;
  const diff = s.readThisYear - expectedNow;
  const goalLine = goal
    ? (diff >= 0.5 ? `${plural(Math.floor(diff), 'livro', 'livros')} à frente do ritmo 🎉`
      : diff <= -0.5 ? `${plural(Math.ceil(-diff), 'livro', 'livros')} atrás do ritmo`
      : 'Exatamente no ritmo')
    : 'Define uma meta nas Definições';

  const readingCards = s.inProgress.length ? `
    <div class="card"><h3>A ler agora</h3><p class="sub">Estimativa de fim com o teu ritmo</p>
      <ul class="records">${s.inProgress.map(({ b, pct, eta }) => `
        <li><span>${esc(b.title)}${pct != null ? `<div class="progress" style="width:120px"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ''}</span>
        <strong>${pct != null ? `${Math.round(pct * 100)}%` : '—'}<small>${eta ? `fim ≈ ${fmtDate(eta)}` : 'indica a página atual'}</small></strong></li>`).join('')}
      </ul></div>` : '';

  const byYear = s.byYear.length > 1 ? `
    <div class="card"><h3>Livros por ano</h3><p class="sub">Terminados em cada ano</p>
      ${hbars(s.byYear.map(([y, c]) => ({ name: String(y), count: c })).reverse(), 0, 10)}</div>` : '';

  el.innerHTML = `
    <div class="card">
      <h3>Meta ${s.year}</h3>
      <p class="sub">${goalLine}</p>
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span class="goal-num">${s.readThisYear}</span>
        <span class="hint">${goal ? `de ${goal} livros` : ''}</span>
      </div>
      ${goal ? `<div class="goal-bar"><i style="width:${Math.min(100, (s.readThisYear / goal) * 100)}%"></i></div>` : ''}
      <p class="hint">Ao ritmo atual vais terminar o ano com ≈ ${fmt(s.projected)} ${Math.round(s.projected) === 1 ? 'livro' : 'livros'}.</p>
    </div>

    <div class="kpis">
      <div class="kpi"><div class="v">${s.counts.read}</div><div class="l">Livros lidos</div><div class="s">${s.counts.reading} a ler · ${s.counts.toread} por ler</div></div>
      <div class="kpi"><div class="v">${fmt(s.pagesRead)}</div><div class="l">Páginas lidas</div><div class="s">${fmt(s.pagesThisYear)} este ano</div></div>
      <div class="kpi"><div class="v">${s.avgDays != null ? fmt(s.avgDays, 1) : '—'}</div><div class="l">Dias por livro</div><div class="s">média do início ao fim</div></div>
      <div class="kpi"><div class="v">${s.pace != null ? fmt(s.pace, 1) : '—'}</div><div class="l">Páginas por dia</div><div class="s">enquanto tens um livro em mãos</div></div>
      <div class="kpi"><div class="v">${s.avgRating != null ? fmt(s.avgRating, 1) + '★' : '—'}</div><div class="l">Classificação média</div><div class="s">${plural(s.ratedCount, 'livro avaliado', 'livros avaliados')}</div></div>
      <div class="kpi"><div class="v">${s.completionRate != null ? Math.round(s.completionRate * 100) + '%' : '—'}</div><div class="l">Taxa de conclusão</div><div class="s">${plural(s.counts.abandoned, 'abandonado', 'abandonados')}</div></div>
    </div>

    ${readingCards}

    <div class="card">
      <h3>Livros terminados por mês</h3>
      <p class="sub">Últimos 12 meses · toca numa barra para detalhes</p>
      ${barChart(s.months)}
    </div>

    <div class="card"><h3>Géneros</h3><p class="sub">Dos livros lidos</p>${hbars(s.genres, s.counts.read)}</div>
    <div class="card"><h3>Autores mais lidos</h3><p class="sub">Top 5</p>${hbars(s.authors, 0, 5)}</div>
    ${byYear}

    <div class="card"><h3>Hábitos</h3><p class="sub">${s.year}</p>
      <ul class="records">
        ${rec('Dias com um livro em mãos', `${fmt(s.daysWithBook)} de ${s.dayOfYear}`, `${Math.round((s.daysWithBook / s.dayOfYear) * 100)}% do ano`)}
        ${rec('Páginas por dia (média do ano)', fmt(s.pagesPerDayThisYear, 1))}
        ${rec('Tamanho médio dos livros', s.avgPages != null ? `${fmt(s.avgPages)} pág.` : '—')}
        ${rec('Máx. livros em simultâneo', s.maxConcurrent || '—')}
      </ul>
    </div>

    <div class="card"><h3>Recordes</h3><p class="sub">De sempre</p>
      <ul class="records">
        ${s.fastest ? rec('Leitura mais rápida', esc(s.fastest.b.title), plural(s.fastest.days, 'dia', 'dias')) : ''}
        ${s.slowest ? rec('Leitura mais longa', esc(s.slowest.b.title), plural(s.slowest.days, 'dia', 'dias')) : ''}
        ${s.fastestPace ? rec('Maior ritmo', esc(s.fastestPace.b.title), `${fmt(s.fastestPace.b.pages / s.fastestPace.days, 1)} pág./dia`) : ''}
        ${s.longest ? rec('Livro mais extenso', esc(s.longest.title), `${fmt(s.longest.pages)} pág.`) : ''}
        ${s.best ? rec('Melhor classificado', esc(s.best.title), '★'.repeat(s.best.rating)) : ''}
        ${!s.fastest && !s.longest && !s.best ? '<li><span>Regista datas, páginas e classificações para veres recordes.</span></li>' : ''}
      </ul>
    </div>`;

  wireChart(el);
}

function wireChart(root) {
  root.querySelectorAll('[data-chart]').forEach(chart => {
    const tip = chart.querySelector('.tip');
    const show = g => {
      chart.querySelectorAll('.bar.hl').forEach(b => b.classList.remove('hl'));
      g.querySelector('.bar')?.classList.add('hl');
      tip.textContent = g.dataset.tip;
      tip.style.left = `${Math.min(80, Math.max(20, g.dataset.x))}%`;
      tip.style.top = `${Math.max(12, g.dataset.y)}%`;
      tip.hidden = false;
    };
    chart.querySelectorAll('.col').forEach(g => {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('click', () => show(g));
    });
    chart.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { tip.hidden = true; chart.querySelectorAll('.bar.hl').forEach(b => b.classList.remove('hl')); } });
  });
}
