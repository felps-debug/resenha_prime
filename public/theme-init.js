// Aplica o tema antes da folha de estilos, para evitar piscar ao abrir.
let theme;
try { theme = localStorage.getItem('resenha:tema'); } catch (_) {}
document.documentElement.dataset.theme = theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
