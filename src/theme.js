// Tema do Resenha: modo (escuro, claro, seguir o sistema) e cor de destaque.
// A escolha fica no aparelho (localStorage) e também na conta (user_metadata do Supabase Auth),
// para valer em outro aparelho. O theme-init.js lê o que está salvo antes da folha de estilos.

export const MODE_KEY = 'resenha:tema';
export const ACCENT_KEY = 'resenha:destaque';
export const VARS_KEY = 'resenha:destaque-vars';
export const DEFAULT_ACCENT = '#FF6B3D';
export const MODES = ['dark', 'light', 'system'];
export const ACCENTS = [
  ['Laranja', '#FF6B3D'], ['Azul', '#4C8DFF'], ['Verde', '#2FBF71'], ['Roxo', '#9B6BFF'],
  ['Rosa', '#FF5C9A'], ['Amarelo', '#F2B630'], ['Vermelho', '#E5484D']
];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
};

export function isHex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); }
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function mix(rgb, to, t) { return rgb.map((c, i) => c + (to[i] - c) * t); }

// Todas as variáveis que dependem da cor de destaque, para o tema escuro e para o claro.
export function accentVars(hex, resolved) {
  const rgb = hexToRgb(hex);
  const light = resolved === 'light';
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  return {
    '--accent': hex.toUpperCase(),
    '--accent-rgb': rgb.join(', '),
    '--accent-h': toHex(mix(rgb, WHITE, 0.12)),
    '--on-accent': hex.toUpperCase() === DEFAULT_ACCENT ? '#1A0F0A' : '#14161B',
    '--accent-soft': `rgba(${rgb.join(', ')}, ${light ? 0.14 : 0.16})`,
    '--accent-ink': toHex(light ? mix(rgb, BLACK, 0.3) : mix(rgb, WHITE, 0.45)),
    '--link': toHex(light ? mix(rgb, BLACK, 0.22) : mix(rgb, WHITE, 0.2))
  };
}

let prefs = { mode: 'dark', accent: DEFAULT_ACCENT };
let account = null; // { sb }
let remoteTimer = null;
const listeners = new Set();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function getPrefs() { return { ...prefs }; }
export function resolvedTheme() {
  if (prefs.mode === 'light' || prefs.mode === 'dark') return prefs.mode;
  return media && media.matches ? 'light' : 'dark';
}
export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function cleanMode(m) { return MODES.includes(m) ? m : 'dark'; }
function cleanAccent(a) { return isHex(a) ? a.toUpperCase() : DEFAULT_ACCENT; }

export function loadLocal() {
  const m = store.get(MODE_KEY);
  prefs = { mode: m ? cleanMode(m) : 'system', accent: cleanAccent(store.get(ACCENT_KEY)) };
  return prefs;
}

export function applyPrefs() {
  const root = document.documentElement;
  const resolved = resolvedTheme();
  root.dataset.theme = resolved;
  root.dataset.themeMode = prefs.mode;
  for (const [k, v] of Object.entries(accentVars(prefs.accent, resolved))) {
    if (prefs.accent === DEFAULT_ACCENT && k !== '--accent-rgb') root.style.removeProperty(k);
    else root.style.setProperty(k, v);
  }
  if (prefs.accent === DEFAULT_ACCENT) root.style.removeProperty('--accent-rgb');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'light' ? '#F3F2EF' : '#0E0F13';
  // O theme-init.js usa isto para pintar certo no próximo carregamento.
  store.set(VARS_KEY, JSON.stringify({
    dark: accentVars(prefs.accent, 'dark'), light: accentVars(prefs.accent, 'light'), isDefault: prefs.accent === DEFAULT_ACCENT
  }));
  for (const fn of listeners) fn(getPrefs(), resolved);
}

function saveRemote() {
  if (!account) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    account.sb.auth.updateUser({ data: { resenha_tema: { mode: prefs.mode, accent: prefs.accent } } }).catch(() => {});
  }, 600);
}

export function setPrefs(patch, { remote = true } = {}) {
  const next = { ...prefs };
  if (patch.mode !== undefined) next.mode = cleanMode(patch.mode);
  if (patch.accent !== undefined) next.accent = cleanAccent(patch.accent);
  prefs = next;
  store.set(MODE_KEY, prefs.mode);
  store.set(ACCENT_KEY, prefs.accent);
  applyPrefs();
  if (remote) saveRemote();
}

// Liga o tema à conta: se a conta já tem uma escolha, ela vale neste aparelho também.
export function attachAccount(sb, user) {
  account = { sb };
  const saved = user && user.user_metadata && user.user_metadata.resenha_tema;
  if (saved && (MODES.includes(saved.mode) || isHex(saved.accent))) {
    setPrefs({ mode: saved.mode, accent: saved.accent }, { remote: false });
  } else if (store.get(MODE_KEY) || store.get(ACCENT_KEY)) {
    saveRemote(); // a escolha deste aparelho sobe para a conta
  }
}

// Alterna entre claro e escuro (botão do topo). Sai do modo "sistema".
export function toggleMode() {
  setPrefs({ mode: resolvedTheme() === 'light' ? 'dark' : 'light' });
}

export function initTheme() {
  loadLocal();
  applyPrefs();
  if (media) media.addEventListener('change', () => { if (prefs.mode === 'system') applyPrefs(); });
}
