// Importação de listas em Excel (.xlsx) ou CSV, sem dependências externas.
import { parseDate, todayStr } from './stats.js';

/* ---------- Leitura de ficheiros ---------- */

/** Devolve [{ name, rows: string[][] }] com os valores das células como texto ou número. */
export async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') {
    return [{ name: 'CSV', rows: parseCsv(await file.text()) }];
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
  if (name.endsWith('.xls') || name.endsWith('.numbers')) {
    throw new Error('Este formato não é suportado. Guarda a folha como .xlsx ou .csv e tenta de novo.');
  }
  throw new Error('Escolhe um ficheiro .xlsx ou .csv.');
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = ch => firstLine.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function unzip(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('O ficheiro não parece ser um .xlsx válido.');
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async name => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.local + 30 + view.getUint16(e.local + 26, true) + view.getUint16(e.local + 28, true);
    const data = bytes.subarray(start, start + e.size);
    if (e.method === 0) return dec.decode(data);
    if (e.method !== 8) throw new Error('Compressão do .xlsx não suportada.');
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('O teu iOS é antigo demais para ler .xlsx. Guarda a folha como .csv e importa esse ficheiro.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const colIndex = ref => {
  const letters = (ref.match(/^[A-Z]+/) || ['A'])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
};

async function readXlsx(buf) {
  const get = await unzip(buf);
  const wb = await get('xl/workbook.xml');
  if (!wb) throw new Error('O ficheiro não parece ser um .xlsx válido.');
  const relsDoc = xml((await get('xl/_rels/workbook.xml.rels')) || '<r/>');
  const rels = new Map(tags(relsDoc, 'Relationship').map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const sstText = await get('xl/sharedStrings.xml');
  const shared = sstText
    ? tags(xml(sstText), 'si').map(si => tags(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join(''))
    : [];

  const sheets = [];
  for (const s of tags(xml(wb), 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
    let target = rels.get(rid) || '';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const text = await get(target);
    if (!text) continue;
    const rows = [];
    for (const r of tags(xml(text), 'row')) {
      const row = [];
      let next = 0;
      for (const c of tags(r, 'c')) {
        const ref = c.getAttribute('r');
        const i = ref ? colIndex(ref) : next;
        next = i + 1;
        const t = c.getAttribute('t');
        const v = tags(c, 'v')[0]?.textContent ?? '';
        let val;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = tags(c, 't').map(x => x.textContent).join('');
        else if (t === 'str' || t === 'e') val = v;
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else val = v === '' ? '' : Number(v);
        row[i] = val;
      }
      const rn = Number(r.getAttribute('r')) - 1;
      rows[Number.isFinite(rn) && rn >= rows.length ? rn : rows.length] = Array.from(row, x => x ?? '');
    }
    sheets.push({ name: s.getAttribute('name') || `Folha ${sheets.length + 1}`, rows: Array.from(rows, x => x || []) });
  }
  if (!sheets.length) throw new Error('Não encontrei folhas no ficheiro.');
  return sheets;
}

/* ---------- Interpretação ---------- */

export const FIELDS = [
  ['title', 'Título'], ['author', 'Autor'], ['genre', 'Género'], ['pages', 'Páginas'], ['status', 'Estado / Lido?'],
  ['startDate', 'Data de início'], ['endDate', 'Data de fim'], ['rating', 'Classificação'], ['notes', 'Notas'],
];

const norm = s => String(s ?? '').toLocaleLowerCase('pt').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const SYNONYMS = {
  title: ['titulo', 'title', 'livro', 'nome', 'book', 'obra', 'nome do livro'],
  author: ['autor', 'author', 'autores', 'escritor', 'autor a'],
  genre: ['genero', 'genre', 'categoria', 'category', 'tema', 'tipo', 'assunto'],
  pages: ['paginas', 'pages', 'pag', 'n paginas', 'numero de paginas', 'num paginas', 'no paginas'],
  status: ['estado', 'status', 'lido', 'lido s n', 'read', 'situacao', 'ja li'],
  startDate: ['inicio', 'data inicio', 'data de inicio', 'comecei', 'start', 'started', 'data inicio leitura', 'inicio leitura', 'date started'],
  endDate: ['fim', 'data fim', 'data de fim', 'terminei', 'end', 'finished', 'data leitura', 'data de leitura', 'lido em', 'date read', 'concluido', 'data conclusao', 'fim leitura', 'data'],
  rating: ['classificacao', 'rating', 'nota', 'estrelas', 'avaliacao', 'pontuacao', 'score', 'my rating'],
  notes: ['notas', 'notes', 'comentarios', 'comentario', 'observacoes', 'obs', 'resumo', 'review', 'opiniao'],
};

/** Índice da linha de cabeçalho: a primeira com pelo menos 2 células de texto. */
export function headerRow(rows) {
  const i = rows.findIndex(r => r.filter(c => typeof c === 'string' && c.trim()).length >= 2);
  return i < 0 ? 0 : i;
}

export function guessMapping(headers) {
  // Pontua cada par (campo, coluna) e atribui do mais forte para o mais fraco.
  const cands = [];
  headers.map(norm).forEach((h, col) => {
    if (!h) return;
    for (const [field] of FIELDS) {
      for (const syn of SYNONYMS[field]) {
        const score = h === syn ? 100 : ` ${h} `.includes(` ${syn} `) ? syn.length : 0;
        if (score) cands.push({ field, col, score });
      }
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const map = {}, used = new Set();
  for (const { field, col } of cands) {
    if (map[field] != null || used.has(col)) continue;
    map[field] = col;
    used.add(col);
  }
  return map;
}

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString().slice(0, 10);

export function toDate(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') {
    if (v >= 1800 && v <= 2200 && Number.isInteger(v)) return yearOnly(v);
    if (v > 0 && v < 2958466) return iso(Date.UTC(1899, 11, 30) + Math.round(v) * DAY);
    return '';
  }
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return valid(y, +m[2], +m[1]); // dia/mês/ano (formato português)
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return valid(+m[2], +m[1], 1);
  if ((m = s.match(/^(\d{4})$/))) return yearOnly(+m[1]);
  return '';
}
function valid(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  const ms = Date.UTC(y, mo - 1, d);
  return new Date(ms).getUTCDate() === d ? iso(ms) : '';
}
function yearOnly(y) {
  // Só o ano: assume o fim desse ano (ou hoje, se for o ano atual).
  const end = Date.UTC(y, 11, 31);
  const today = parseDate(todayStr());
  return iso(Math.min(end, today));
}

function toStatus(v) {
  const s = norm(v);
  if (!s) return null;
  if (/abandon|desist|dnf/.test(s)) return 'abandoned';
  if (/nao lid|not read|unread|nao li\b/.test(s)) return 'toread';
  if (/^(a ler|lendo|reading|em curso|em leitura|a decorrer|current)/.test(s)) return 'reading';
  if (/^(por ler|quero ler|to read|want|nao|no|n|false|0|pendente|wishlist)$/.test(s) || /por ler|quero ler|to read/.test(s)) return 'toread';
  if (/^(lido|li|sim|s|yes|y|x|true|1|read|terminado|concluido|ok|v)$/.test(s) || /lido|read|termin|conclu/.test(s)) return 'read';
  if (String(v).trim() === '✓' || String(v).trim() === '✔') return 'read';
  return null;
}

function toRating(v) {
  if (v === '' || v == null) return 0;
  const stars = String(v).match(/★/g);
  if (stars) return Math.min(5, stars.length);
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(n > 5 ? n / 2 : n)));
}

const text = v => (v == null ? '' : String(v).trim());

/**
 * Converte as linhas em livros.
 * defaultStatus aplica-se a linhas sem estado nem datas.
 */
export function rowsToBooks(rows, hdr, map, defaultStatus) {
  const col = (r, f) => (map[f] == null ? '' : r[map[f]]);
  const books = [];
  for (const r of rows.slice(hdr + 1)) {
    const title = text(col(r, 'title'));
    if (!title) continue;
    let startDate = toDate(col(r, 'startDate'));
    let endDate = toDate(col(r, 'endDate'));
    if (startDate && endDate && startDate > endDate) [startDate, endDate] = [endDate, startDate];
    let status = toStatus(col(r, 'status'));
    if (!status) status = endDate ? 'read' : startDate ? 'reading' : defaultStatus;
    if (status === 'reading' || status === 'toread') endDate = '';
    const pages = parseInt(String(col(r, 'pages')).replace(/\D+/g, ''), 10);
    books.push({
      title,
      author: text(col(r, 'author')),
      genre: text(col(r, 'genre')),
      pages: pages > 0 ? pages : null,
      status,
      startDate,
      endDate,
      rating: toRating(col(r, 'rating')),
      notes: text(col(r, 'notes')),
    });
  }
  return books;
}
