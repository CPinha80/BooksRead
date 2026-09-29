// Persistência local (localStorage). Tudo vive no dispositivo.
const KEY = 'booksread.v1';

const defaults = () => ({
  books: [],
  settings: { apiKey: '', model: 'claude-opus-5-5', yearGoal: 12 },
  aiHistory: [],
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const data = JSON.parse(raw);
    const d = defaults();
    return {
      books: Array.isArray(data.books) ? data.books : [],
      settings: { ...d.settings, ...(data.settings || {}) },
      aiHistory: Array.isArray(data.aiHistory) ? data.aiHistory : [],
    };
  } catch {
    return defaults();
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Falha ao guardar', e);
    return false;
  }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const store = {
  get books() { return state.books; },
  get settings() { return state.settings; },
  get aiHistory() { return state.aiHistory; },

  getBook(id) { return state.books.find(b => b.id === id); },

  upsertBook(book) {
    const now = new Date().toISOString();
    const i = state.books.findIndex(b => b.id === book.id);
    if (i >= 0) state.books[i] = { ...state.books[i], ...book, updatedAt: now };
    else state.books.unshift({ ...book, id: book.id || uid(), createdAt: now, updatedAt: now });
    return save();
  },

  deleteBook(id) {
    state.books = state.books.filter(b => b.id !== id);
    return save();
  },

  updateSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    return save();
  },

  addAi(entry) {
    state.aiHistory.unshift({ id: uid(), date: new Date().toISOString(), ...entry });
    state.aiHistory = state.aiHistory.slice(0, 30);
    return save();
  },

  deleteAi(id) {
    state.aiHistory = state.aiHistory.filter(a => a.id !== id);
    return save();
  },

  exportData() {
    // A chave da API nunca sai no backup.
    const { apiKey, ...settings } = state.settings;
    return { app: 'booksread', version: 1, exportedAt: new Date().toISOString(), books: state.books, settings, aiHistory: state.aiHistory };
  },

  importData(data) {
    if (!data || !Array.isArray(data.books)) throw new Error('Ficheiro inválido: não tem lista de livros.');
    const byId = new Map(state.books.map(b => [b.id, b]));
    for (const b of data.books) {
      if (!b || typeof b.title !== 'string') continue;
      byId.set(b.id || uid(), { ...b, id: b.id || uid() });
    }
    state.books = [...byId.values()];
    if (data.settings) {
      const { apiKey, ...rest } = data.settings;
      state.settings = { ...state.settings, ...rest };
    }
    if (Array.isArray(data.aiHistory)) {
      const ids = new Set(state.aiHistory.map(a => a.id));
      state.aiHistory = [...state.aiHistory, ...data.aiHistory.filter(a => !ids.has(a.id))].slice(0, 30);
    }
    save();
    return data.books.length;
  },

  wipe() {
    const apiKey = state.settings.apiKey;
    state = defaults();
    state.settings.apiKey = apiKey;
    save();
  },
};
