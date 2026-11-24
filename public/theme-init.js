// Aplica o tema e a cor de destaque antes da folha de estilos, para evitar piscar ao abrir.
(function () {
  var mode, vars;
  try { mode = localStorage.getItem('resenha:tema'); } catch (_) {}
  try { vars = JSON.parse(localStorage.getItem('resenha:destaque-vars') || 'null'); } catch (_) {}
  var light = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches;
  var resolved = mode === 'light' || mode === 'dark' ? mode : (light ? 'light' : 'dark');
  var root = document.documentElement;
  root.dataset.theme = resolved;
  if (vars && !vars.isDefault && vars[resolved]) {
    for (var k in vars[resolved]) root.style.setProperty(k, vars[resolved][k]);
  }
})();
