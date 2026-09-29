// Modo IA: constrói o contexto a partir da biblioteca e fala com a API da Anthropic.
import { computeStats, readingDays } from './stats.js';

const STATUS = { read: 'Lido', reading: 'A ler', toread: 'Por ler', abandoned: 'Abandonado' };

export const MODES = {
  knowledge: {
    title: 'Mapa de conhecimento',
    prompt: `Com base nos livros que li (e nas minhas notas), constrói o meu **mapa de conhecimento**.

1. Agrupa o conhecimento por grandes áreas/domínios.
2. Em cada área, lista os conceitos, ideias, modelos mentais e factos-chave que eu **deveria dominar** por ter lido esses livros, indicando entre parênteses de que livro(s) vem cada um.
3. Para cada área, estima o meu nível (introdutório / intermédio / avançado) e justifica numa frase.
4. Termina com as **ligações entre livros**: ideias que se reforçam ou se contradizem entre autores.

Onde as minhas notas mostram o que retive, dá-lhes prioridade; onde não há notas, baseia-te no conteúdo conhecido do livro e assinala-o.`,
  },
  gaps: {
    title: 'Lacunas e próximas leituras',
    prompt: `Analisa a minha biblioteca e identifica **lacunas de conhecimento**: áreas adjacentes aos meus interesses que ainda não explorei, perspetivas contrárias que me faltam e fundamentos que os livros que li pressupõem mas não cobrem.

Depois recomenda **6 a 8 livros** (que não estejam já na minha lista), por ordem sugerida de leitura. Para cada um: título, autor, porque preenche uma lacuna concreta e a que livro meu se liga. Se tiver livros "Por ler" que já cobrem uma lacuna, destaca-os primeiro.`,
  },
  quiz: {
    title: 'Testa-te',
    prompt: `Cria um **quiz de 8 perguntas** para eu testar se retive as ideias principais dos livros que li (dá prioridade aos mais recentes e aos que têm notas). Mistura perguntas de compreensão, de aplicação prática e de ligação entre livros. Numera as perguntas e indica o livro de cada uma.

No fim, numa secção separada chamada "Respostas", dá respostas curtas.`,
  },
  profile: {
    title: 'Perfil de leitor',
    prompt: `Descreve o meu **perfil de leitor**: temas recorrentes, como os meus interesses evoluíram ao longo do tempo (usa as datas), padrões nas classificações que dou, hábitos de leitura revelados pelas métricas, e possíveis enviesamentos (autores, épocas, perspetivas). Termina com 3 sugestões práticas para tornar a minha leitura mais proveitosa.`,
  },
};

const SYSTEM = `És um mentor de leitura e um tutor exigente mas caloroso. Respondes sempre em português de Portugal, tratando o utilizador por "tu".
Recebes a biblioteca pessoal do utilizador (livros com estado, datas, classificação e notas pessoais) e algumas métricas.
Sê concreto e específico aos livros indicados — nada de generalidades. Usa Markdown simples (títulos com ##, listas, **negrito**). Não uses tabelas.
Se não conheces bem um livro, di-lo em vez de inventar o seu conteúdo.`;

export function libraryContext(books) {
  const s = computeStats(books);
  const order = { read: 0, reading: 1, abandoned: 2, toread: 3 };
  const sorted = [...books].sort((a, b) => order[a.status] - order[b.status] || (b.endDate || '').localeCompare(a.endDate || ''));
  const lines = sorted.map(b => {
    const parts = [`- «${b.title}»${b.author ? ` — ${b.author}` : ''}`];
    const meta = [STATUS[b.status] || b.status];
    if (b.genre) meta.push(`género: ${b.genre}`);
    if (b.pages) meta.push(`${b.pages} pág.`);
    if (b.startDate) meta.push(`início: ${b.startDate}`);
    if (b.endDate) meta.push(`fim: ${b.endDate}`);
    const d = readingDays(b);
    if (d) meta.push(`${d} dias`);
    if (b.rating) meta.push(`classificação: ${b.rating}/5`);
    parts.push(` (${meta.join('; ')})`);
    if (b.notes?.trim()) parts.push(`\n  Notas: ${b.notes.trim().replace(/\n+/g, ' / ')}`);
    return parts.join('');
  });
  const metrics = [
    `Livros lidos: ${s.counts.read}; a ler: ${s.counts.reading}; por ler: ${s.counts.toread}; abandonados: ${s.counts.abandoned}`,
    `Lidos em ${s.year}: ${s.readThisYear}; páginas lidas no total: ${s.pagesRead}`,
    s.avgDays != null ? `Média de dias por livro: ${s.avgDays.toFixed(1)}` : null,
    s.pace != null ? `Ritmo médio: ${s.pace.toFixed(1)} páginas/dia` : null,
    s.avgRating != null ? `Classificação média: ${s.avgRating.toFixed(1)}/5` : null,
    s.genres.length ? `Géneros: ${s.genres.map(g => `${g.name} (${g.count})`).join(', ')}` : null,
  ].filter(Boolean).join('\n');
  return `<biblioteca>\n${lines.join('\n')}\n</biblioteca>\n\n<metricas>\n${metrics}\n</metricas>`;
}

export function buildPrompt(books, modeKey, question) {
  const task = modeKey === 'free' ? question : MODES[modeKey].prompt;
  return `${libraryContext(books)}\n\n${task}`;
}

/** Texto completo para colar na app Claude quando não há chave de API. */
export function buildPastePrompt(books, modeKey, question) {
  return `${SYSTEM}\n\n${buildPrompt(books, modeKey, question)}`;
}

let clientCache = null;
async function getClient(apiKey) {
  if (clientCache?.key === apiKey) return clientCache.client;
  const { default: Anthropic } = await import('../vendor/anthropic-sdk.mjs');
  // A chave pertence ao próprio utilizador e fica só neste dispositivo.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  clientCache = { key: apiKey, client };
  return client;
}

/**
 * Faz streaming da resposta. onText recebe cada fragmento.
 * Devolve { text, stopReason } e expõe abort() através de handle.
 */
export async function ask({ apiKey, model, books, modeKey, question, onText, handle }) {
  const client = await getClient(apiKey);
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(books, modeKey, question) }],
  });
  if (handle) handle.abort = () => stream.abort();
  stream.on('text', delta => onText(delta));
  const msg = await stream.finalMessage();
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return { text, stopReason: msg.stop_reason };
}

export function explainError(err) {
  const status = err?.status;
  if (status === 401) return 'Chave da API inválida. Verifica-a nas Definições.';
  if (status === 403) return 'A chave não tem permissão para este modelo.';
  if (status === 429) return 'Limite de pedidos atingido. Tenta daqui a pouco.';
  if (status === 400 && /credit|billing/i.test(err?.message || '')) return 'Sem créditos na conta Anthropic.';
  if (status >= 500) return 'O serviço está com problemas. Tenta mais tarde.';
  if (err?.name === 'APIUserAbortError') return 'Pedido cancelado.';
  if (!navigator.onLine) return 'Sem ligação à internet.';
  return `Erro: ${err?.message || err}`;
}
