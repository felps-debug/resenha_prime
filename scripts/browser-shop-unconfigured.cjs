const { spawn } = require('node:child_process');
const path = require('node:path');
const { chromium } = require(process.env.RESENHA_PLAYWRIGHT);

(async () => {
  const server = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), stdio: 'ignore',
    env: { ...process.env, PORT: '31989', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', SUPABASE_SERVICE_ROLE_KEY: '', RESENHA_APP_URL: '' } });
  let browser;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch('http://127.0.0.1:31989/health')).ok) break; } catch (_) {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: process.env.RESENHA_CHROME, headless: true });
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:31989/');
    await page.locator('#auth-email').fill(process.env.TEST_USER_EMAIL);
    await page.locator('#auth-pass').fill(process.env.TEST_USER_PASSWORD);
    await page.locator('#auth-submit').click();
    await page.locator('#rail-rooms .rail-room').first().waitFor({ timeout: 30000 });
    await page.locator('#shop-btn').click({ timeout: 5000 });
    await page.getByPlaceholder('Sua mensagem para a sala').fill('Teste visual');
    await page.getByRole('button', { name: 'Ir para o pagamento' }).click();
    await page.locator('#toast').getByText('Loja ainda não configurada.', { exact: true }).waitFor({ timeout: 10000 });
    console.log('OK: loja visível, botão funcional e pagamento indisponível sem configuração.');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
