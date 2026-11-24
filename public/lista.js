// Lista de testes do Resenha: valida, envia para /api/lista e mostra a confirmação.
(function () {
  const $ = (id) => document.getElementById(id);
  const form = $('form');
  const send = $('send');
  const msg = $('msg');
  const fields = ['nome', 'instagram', 'idade', 'whatsapp'];

  // Máscara do WhatsApp: (98) 99999-9999
  $('whatsapp').addEventListener('input', (e) => {
    let d = e.target.value.replace(/\D/g, '');
    if (d.startsWith('55') && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    let out = d;
    if (d.length > 2) out = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) out = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    e.target.value = out;
  });
  $('idade').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2); });
  // Aceita colar o link do perfil ou o @
  $('instagram').addEventListener('blur', (e) => { e.target.value = cleanInsta(e.target.value); });

  function cleanInsta(v) {
    return String(v || '').trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/[/?#].*$/, '')
      .replace(/^@+/, '')
      .toLowerCase();
  }

  function values() {
    return {
      nome: $('nome').value.trim().replace(/\s+/g, ' '),
      instagram: cleanInsta($('instagram').value),
      idade: $('idade').value.trim(),
      whatsapp: $('whatsapp').value.replace(/\D/g, ''),
      site: $('site').value
    };
  }

  function check(v) {
    const errors = {};
    if (v.nome.length < 2) errors.nome = 'Coloca seu nome.';
    if (!/^[a-z0-9._]{1,30}$/.test(v.instagram)) errors.instagram = 'Confere o @: só letras, números, ponto e _.';
    const idade = Number(v.idade);
    if (!Number.isInteger(idade) || idade < 12 || idade > 99) errors.row = 'Confere sua idade.';
    else if (!/^\d{10,11}$/.test(v.whatsapp)) errors.row = 'Confere o WhatsApp com DDD.';
    return errors;
  }

  function paint(errors) {
    for (const f of fields) {
      const box = document.querySelector(`.box[data-for="${f}"]`);
      const bad = errors[f] || (errors.row && ((f === 'idade' && /idade/.test(errors.row)) || (f === 'whatsapp' && /WhatsApp/.test(errors.row))));
      box.classList.toggle('bad', Boolean(bad));
    }
    $('nome-hint').textContent = errors.nome || '';
    $('instagram-hint').textContent = errors.instagram || '';
    $('row-hint').textContent = errors.row || '';
  }

  // Ripple no botão
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b || b.disabled || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'ripple';
    dot.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.append(dot);
    setTimeout(() => dot.remove(), 700);
  }, { passive: true });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const v = values();
    const errors = check(v);
    paint(errors);
    if (Object.keys(errors).length) return;
    send.disabled = true;
    send.textContent = 'Enviando…';
    try {
      const res = await fetch('/api/lista', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, idade: Number(v.idade) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não deu pra enviar agora. Tenta de novo.');
      showDone(v.nome, data);
    } catch (err) {
      msg.textContent = err.message === 'Failed to fetch' ? 'Sem internet? Tenta de novo.' : err.message;
      send.disabled = false;
      send.textContent = 'Quero entrar no teste';
    }
  });

  function showDone(nome, data) {
    form.hidden = true;
    $('intro').hidden = true;
    $('done').hidden = false;
    const first = nome.split(' ')[0];
    if (data.repetido) {
      $('done-title').textContent = `${first}, você já tava na lista!`;
      $('done-text').textContent = 'Seu número já estava inscrito. É só esperar que eu te chamo no WhatsApp.';
    } else {
      $('done-title').textContent = `${first}, você tá na lista!`;
      confetti();
    }
    if (data.posicao) {
      const p = $('done-pos');
      p.hidden = false;
      p.textContent = '';
      p.append('Você é o ', Object.assign(document.createElement('b'), { textContent: `nº ${data.posicao}` }), ' da fila.');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('share').addEventListener('click', async () => {
    const url = location.origin + '/lista';
    const text = 'Entra na lista de testes do Resenha: conversa e transmite a tela no mesmo lugar.';
    if (navigator.share) {
      try { await navigator.share({ title: 'Resenha', text, url }); return; } catch (_) { return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
  });

  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#FF6B3D', '#FFD166', '#3DD68C', '#7FB2F0', '#F28DA6', '#C9A7F5'];
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('span');
      c.className = 'cf';
      c.style.left = ((i * 37) % 100) + 'vw';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = ((i % 7) * 0.12) + 's';
      c.style.animationDuration = (2 + (i % 5) * 0.3) + 's';
      document.body.append(c);
      setTimeout(() => c.remove(), 4000);
    }
  }
})();
