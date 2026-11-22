// Teste opcional com Chrome, duas contas e uma sala de teste no Supabase.
// Requer playwright, psycopg e as variáveis TEST_* e DATABASE_URL no ambiente.
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.RESENHA_PLAYWRIGHT);

const root = path.resolve(__dirname, '..');
const fixture = { ...process.env, RESENHA_FIXTURE_ID: randomUUID(), RESENHA_FIXTURE_EMAIL: `resenha-teste-${randomUUID()}@example.com`, RESENHA_FIXTURE_PASSWORD: randomBytes(18).toString('hex') };
const fixture2 = { ...process.env, RESENHA_FIXTURE_ID: randomUUID(), RESENHA_FIXTURE_EMAIL: `resenha-teste-${randomUUID()}@example.com`, RESENHA_FIXTURE_PASSWORD: randomBytes(18).toString('hex'), RESENHA_FIXTURE_NAME: 'Teste Automático 2' };
function database(action, data) {
  const result = spawnSync('python', [path.join(__dirname, 'browser_fixture.py'), action], { env: data, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Falha na preparação/limpeza do teste (${action}): ${result.stderr}`);
}
async function login(page, email, password) {
  await page.goto('http://127.0.0.1:31988/');
  await page.locator('#auth-email').fill(email);
  await page.locator('#auth-pass').fill(password);
  await page.locator('#auth-submit').click();
  await page.locator('#dm-btn').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#rail-rooms .rail-room').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('#chat-input').disabled, { timeout: 30000 });
}

(async () => {
  let browser, server;
  const prepared = [];
  try {
    database('setup', fixture); prepared.push(fixture);
    database('setup', fixture2); prepared.push(fixture2);
    server = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: '31988', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', SUPABASE_SERVICE_ROLE_KEY: '', RESENHA_APP_URL: '' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch('http://127.0.0.1:31988/health')).ok) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.RESENHA_CHROME, headless: true,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen'] });
    const a = await browser.newPage();
    const b = await browser.newPage();
    const c = await browser.newPage();
    await a.emulateMedia({ colorScheme: 'light' });
    await Promise.all([login(a, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD), login(b, fixture.RESENHA_FIXTURE_EMAIL, fixture.RESENHA_FIXTURE_PASSWORD), login(c, fixture2.RESENHA_FIXTURE_EMAIL, fixture2.RESENHA_FIXTURE_PASSWORD)]);
    await a.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
    await a.waitForFunction(() => new Promise((resolve) => {
      const open = indexedDB.open('resenha-chat-cache-v1', 1);
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const request = open.result.transaction('rooms').objectStore('rooms').getAll();
        request.onsuccess = () => { open.result.close(); resolve(request.result.some((r) => Array.isArray(r.rooms) && r.rooms.length)); };
      };
    }), { timeout: 15000 });
    await a.route('**/rest/v1/room_members?*', async (route) => {
      if (new URL(route.request().url()).searchParams.has('user_id')) await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await a.reload({ waitUntil: 'domcontentloaded' });
    await a.locator('#rail-rooms .rail-room:disabled').first().waitFor({ timeout: 10000 });
    await a.locator('#rail-rooms .rail-room:not(:disabled)').first().waitFor({ timeout: 15000 });
    await a.unrouteAll({ behavior: 'wait' });
    console.log('OK: salas em cache aparecem enquanto o acesso é confirmado.');
    await a.locator('#dm-btn').click();
    await a.locator('#dm-new').click();
    await a.getByRole('checkbox', { name: 'Teste Automático', exact: true }).check();
    await a.getByRole('button', { name: 'Conversar', exact: true }).click();
    await a.locator('#chat-input').fill('Mensagem de teste automatizado.');
    await a.locator('#chat-input').press('Enter');
    await a.locator('#messages').getByText('Mensagem de teste automatizado.', { exact: true }).waitFor({ timeout: 15000 });
    await b.locator('#dm-btn').click();
    await b.locator('.dm-item').first().waitFor({ timeout: 20000 });
    await b.locator('.dm-item').first().click();
    await b.locator('#messages').getByText('Mensagem de teste automatizado.', { exact: true }).waitFor({ timeout: 15000 });
    await b.locator('#members-panel .mem').first().waitFor({ timeout: 10000 });
    await b.locator('#chat-input').fill('Digitando...');
    await a.locator('#typing').getByText(/digitando/).waitFor({ timeout: 10000 });
    await b.locator('#chat-input').fill('');
    console.log('OK: indicador de digitação em tempo real.');
    const original = b.locator('.msg-row').filter({ has: b.locator('.msg-text', { hasText: 'Mensagem de teste automatizado.' }) });
    await original.hover();
    await original.getByRole('button', { name: 'Reagir', exact: true }).click();
    await b.getByRole('button', { name: 'Reagir com 👍' }).click();
    await a.locator('.msg-row').filter({ hasText: 'Mensagem de teste automatizado.' }).locator('.react-chip').filter({ hasText: '👍' }).waitFor({ timeout: 15000 });
    await original.hover();
    await original.getByRole('button', { name: 'Responder', exact: true }).click();
    await b.locator('#chat-input').fill('Resposta de teste automatizado.');
    await b.locator('#chat-input').press('Enter');
    const reply = a.locator('.msg-row').filter({ hasText: 'Resposta de teste automatizado.' });
    await reply.waitFor({ timeout: 20000 });
    assert.equal(await reply.locator('.reply-ref').count(), 1);
    await a.locator('#chat-search-btn').click({ timeout: 5000 });
    await a.getByPlaceholder('Buscar nesta conversa').fill('Resposta de teste');
    await a.getByRole('dialog', { name: 'Buscar mensagens' }).getByText('Resposta de teste automatizado.', { exact: true }).click({ timeout: 15000 });
    await a.getByRole('button', { name: 'Voltar para as mensagens recentes' }).click({ timeout: 15000 });
    console.log('OK: busca de mensagens na conversa.');
    await original.hover();
    await original.getByRole('button', { name: 'Fixar mensagem', exact: true }).click({ timeout: 5000 });
    await a.locator('#pins-btn').click();
    await a.getByRole('dialog', { name: 'Mensagens fixadas' }).getByText('Mensagem de teste automatizado.', { exact: true }).waitFor({ timeout: 15000 });
    await a.getByRole('dialog', { name: 'Mensagens fixadas' }).getByRole('button', { name: 'Fechar', exact: true }).click();
    await original.hover();
    await original.getByRole('button', { name: 'Desafixar mensagem', exact: true }).click();
    console.log('OK: mensagem fixada e removida por membros da conversa.');
    const hostileText = '<img src=x onerror="window.__resenhaXss=1"> <script>window.__resenhaXss=1</script> javascript:alert(1)';
    await b.locator('#chat-input').fill(hostileText);
    await b.locator('#chat-input').press('Enter');
    await a.locator('.msg-text').getByText(hostileText, { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await a.evaluate(() => Boolean(window.__resenhaXss)), false);
    assert.equal(await a.locator('.msg-text img, .msg-text script, .msg-text a[href^="javascript:"]').count(), 0);
    console.log('OK: HTML e javascript recebidos no chat não são executados.');
    let allowFailure, markStarted;
    const failureAllowed = new Promise((resolve) => { allowFailure = resolve; });
    const requestStarted = new Promise((resolve) => { markStarted = resolve; });
    await a.route('**/rest/v1/messages?*', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      markStarted();
      await failureAllowed;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falha simulada' }) });
    });
    await a.locator('#chat-input').fill('Mensagem que falhou');
    await a.locator('#chat-input').press('Enter');
    await requestStarted;
    await a.locator('#rail-rooms .rail-room').first().click();
    await a.locator('#chat-input').fill('Rascunho da outra sala');
    allowFailure();
    await a.locator('#toast').getByText('falha simulada', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await a.locator('#chat-input').inputValue(), 'Rascunho da outra sala');
    await a.unrouteAll({ behavior: 'wait' });
    await a.locator('#chat-input').fill('');
    await a.locator('#dm-btn').click();
    await a.locator('#top-title').getByText('Teste Automático', { exact: true }).waitFor({ timeout: 10000 });
    assert.equal(await a.locator('#chat-input').inputValue(), 'Mensagem que falhou');
    await a.locator('#chat-input').fill('');
    console.log('OK: falha de envio não sobrescreve texto em outra sala.');
    await a.locator('#attach-input').setInputFiles({ name: 'teste.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64') });
    await a.locator('#attach-preview').waitFor({ state: 'visible' });
    await a.locator('#rail-rooms .rail-room').first().click();
    await a.locator('#attach-preview').waitFor({ state: 'hidden', timeout: 5000 });
    await a.locator('#dm-btn').click();
    await a.locator('#attach-preview').waitFor({ state: 'visible', timeout: 5000 });
    await a.locator('#attach-preview').getByRole('button', { name: 'Tirar imagem' }).click();
    console.log('OK: anexos ficam no rascunho da conversa correta.');
    await a.waitForFunction(() => new Promise((resolve) => {
      const open = indexedDB.open('resenha-chat-cache-v1', 1);
      open.onerror = () => resolve(false);
      open.onsuccess = () => {
        const request = open.result.transaction('rooms').objectStore('rooms').getAll();
        request.onsuccess = () => { open.result.close(); resolve(request.result.some((r) => r.messages.some((m) => m.content === 'Resposta de teste automatizado.'))); };
        request.onerror = () => { open.result.close(); resolve(false); };
      };
    }), { timeout: 15000 });
    await a.locator('#rail-rooms .rail-room').first().click();
    await a.route('**/rest/v1/messages?*', async (route) => {
      if (route.request().method() === 'GET') await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await a.locator('#dm-btn').click();
    await a.locator('.cache-notice').waitFor({ timeout: 5000 });
    await a.locator('#messages').getByText('Resposta de teste automatizado.', { exact: true }).waitFor();
    await a.locator('.cache-notice').waitFor({ state: 'detached', timeout: 10000 });
    await a.unrouteAll({ behavior: 'wait' });
    console.log('OK: mensagens em cache aparecem antes da resposta da rede.');
    await a.locator('#call-card-join').click();
    await a.locator('#vb-title').getByText('Voz conectada').waitFor({ timeout: 30000 });
    await b.locator('#call-card-join').click();
    await b.locator('#vb-title').getByText('Voz conectada').waitFor({ timeout: 30000 });
    await a.locator('.dm-item.active').click();
    await a.locator('#chat-input').fill('Mensagem recebida durante a call.');
    await a.locator('#chat-input').press('Enter');
    await b.locator('#dm-count').waitFor({ state: 'visible', timeout: 15000 });
    await b.locator('.dm-item.active').click();
    await b.locator('#dm-count').waitFor({ state: 'hidden', timeout: 10000 });
    await a.locator('#ch-call').click();
    await b.locator('#ch-call').click();
    console.log('OK: contador de DM aparece durante a call e limpa ao abrir o chat.');
    const remote = a.locator('#call-list li').filter({ hasText: 'Teste Automático' });
    await remote.waitFor({ timeout: 15000 });
    await remote.click();
    const volume = a.getByRole('slider', { name: 'Volume de Teste Automático' });
    await volume.fill('150');
    assert.equal(await volume.inputValue(), '150');
    await a.keyboard.press('Escape');
    await a.locator('#mic-btn-2').click();
    await a.locator('#mic-btn-2.off').waitFor();
    await a.locator('#cam-btn-2').click();
    await a.locator('#cam-btn-2.on').waitFor({ timeout: 15000 });
    await a.locator('#screen-btn-2').click();
    await a.locator('#screen-btn-2.on').waitFor({ timeout: 15000 });
    await a.locator('#screen-btn-2').click();
    await a.locator('.dm-item.active').click();
    await a.locator('#chat-input').waitFor({ state: 'visible', timeout: 5000 });
    await a.locator('#hangup-btn').click();
    await b.locator('#hangup-btn-2').click();
    console.log('OK: call com microfone, câmera, tela e volume individual.');
    await b.locator('#room-menu-btn').click();
    await b.getByText('Fechar conversa', { exact: true }).click();
    await b.getByRole('button', { name: 'Fechar conversa', exact: true }).click();
    await b.locator('.dm-item').first().waitFor({ state: 'detached', timeout: 10000 });
    await a.locator('#chat-input').fill('Conversa reaberta.');
    await a.locator('#chat-input').press('Enter');
    await b.locator('.dm-item').first().waitFor({ timeout: 20000 });
    await b.locator('.dm-item').first().click();
    await b.locator('#messages').getByText('Conversa reaberta.', { exact: true }).waitFor({ timeout: 20000 });
    console.log('OK: DM, reações, resposta e reabertura funcionam entre duas contas.');
    const userName = await a.locator('#me-name').textContent();
    await b.locator('#dm-new').click();
    await b.locator('label.pick-item').filter({ hasText: userName }).locator('input').check();
    await b.locator('label.pick-item').filter({ hasText: 'Teste Automático 2' }).locator('input').check();
    await b.getByPlaceholder('Ex.: Pelada de quinta').fill('Grupo teste automático');
    await b.getByRole('button', { name: 'Criar grupo (3)' }).click();
    await b.locator('#top-title').getByText('Grupo teste automático', { exact: true }).waitFor({ timeout: 20000 });
    await b.locator('#chat-input').fill('Mensagem do grupo de teste.');
    await b.locator('#chat-input').press('Enter');
    await b.locator('#messages').getByText('Mensagem do grupo de teste.', { exact: true }).waitFor({ timeout: 20000 });
    await c.locator('#dm-btn').click();
    const group = c.locator('.dm-item').filter({ hasText: 'Grupo teste automático' });
    await group.waitFor({ timeout: 20000 });
    await group.click();
    await c.locator('#messages').getByText('Mensagem do grupo de teste.', { exact: true }).waitFor({ timeout: 20000 });
    await c.locator('#room-menu-btn').click();
    await c.getByText('Sair do grupo', { exact: true }).click();
    await c.getByRole('button', { name: 'Sair do grupo', exact: true }).click();
    await group.waitFor({ state: 'detached', timeout: 15000 });
    console.log('OK: grupo de três pessoas e saída do grupo.');
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await login(mobile, process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD);
    const initialTheme = await mobile.locator('html').getAttribute('data-theme');
    await mobile.locator('#theme-btn').click();
    await mobile.waitForFunction((previous) => document.documentElement.getAttribute('data-theme') !== previous, initialTheme);
    await mobile.locator('#theme-btn').click();
    await mobile.locator('#dm-btn').click();
    await mobile.locator('.dm-item').first().click();
    await mobile.locator('#chat-input').fill('Mensagem pelo celular simulado.');
    await mobile.locator('#chat-input').press('Enter');
    await mobile.locator('#messages').getByText('Mensagem pelo celular simulado.', { exact: true }).waitFor({ timeout: 15000 });
    console.log('OK: login, temas, navegação e mensagem em viewport móvel.');
    await a.locator('#rail-rooms .rail-room').first().click();
    await a.locator('#top-title').getByText('chat', { exact: true }).waitFor({ timeout: 15000 });
    await a.locator('#room-sub').getByText(/membro/).waitFor({ timeout: 15000 });
    if (await a.locator('html').getAttribute('data-theme') !== 'light') {
      await a.locator('#theme-btn').click();
      await a.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light');
    }
    for (const label of ['Cargos', 'Banidos']) {
      await a.locator('#room-menu-btn').click();
      await a.getByRole('menuitem', { name: label, exact: true }).click();
      const dialog = a.getByRole('dialog', { name: label });
      await dialog.waitFor();
      if (label === 'Cargos') await dialog.screenshot({ path: path.join(require('node:os').tmpdir(), 'resenha-cargos-claro.png') });
      await dialog.locator('.modal-head [aria-label="Fechar"]').click();
    }
    await a.locator('#me-btn').click();
    await a.getByRole('menuitem', { name: 'Editar perfil' }).click();
    await a.getByRole('dialog', { name: 'Seu perfil' }).locator('.modal-head [aria-label="Fechar"]').click();
    await a.locator('#settings-btn').click();
    await a.getByRole('dialog', { name: 'Áudio e vídeo' }).locator('.modal-head [aria-label="Fechar"]').click();
    await a.locator('#draw-btn').click();
    await a.getByRole('dialog', { name: 'Sorteador' }).locator('.modal-head [aria-label="Fechar"]').click();
    await a.locator('#ch-updates').click();
    await a.locator('#updates-view').waitFor({ state: 'visible' });
    await a.locator('#ch-chat').click();
    console.log('OK: tema claro em cargos, banidos, perfil, sorteador, áudio e atualizações.');
  } finally {
    if (browser) await browser.close();
    if (server) server.kill();
    for (const data of prepared.reverse()) database('cleanup', data);
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
