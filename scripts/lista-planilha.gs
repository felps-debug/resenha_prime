/**
 * Resenha · Lista de testes → Planilha do Google
 *
 * Como instalar (uma vez só):
 * 1. Crie uma planilha nova no Google Sheets (ex.: "Lista de testes Resenha").
 * 2. Menu Extensões → Apps Script. Apague o que tiver e cole este arquivo inteiro.
 * 3. Troque o valor de TOKEN abaixo por uma senha longa qualquer (a mesma vai no LISTA_SHEETS_TOKEN da Vercel).
 * 4. Clique em Implantar → Nova implantação → tipo "App da Web".
 *      Executar como: Eu
 *      Quem pode acessar: Qualquer pessoa
 *    Autorize com sua conta do Google quando pedir.
 * 5. Copie a URL que termina em /exec e cole no LISTA_SHEETS_URL da Vercel.
 *
 * A aba "Inscritos" é criada sozinha, com cabeçalho, na primeira inscrição.
 * O mesmo WhatsApp não entra duas vezes. A coluna "Chamar" já abre a conversa no WhatsApp.
 */

const TOKEN = 'TROQUE-POR-UMA-SENHA-LONGA';
const ABA = 'Inscritos';

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (d.token !== TOKEN) return resposta({ ok: false, error: 'token inválido' });

    const zap = String(d.whatsapp || '').replace(/\D/g, '');
    if (!/^55\d{10,11}$/.test(zap)) return resposta({ ok: false, error: 'whatsapp inválido' });

    const sh = aba();
    const ultima = sh.getLastRow();
    if (ultima > 1) {
      const ja = sh.getRange(2, 5, ultima - 1, 1).getValues().map((l) => String(l[0]).replace(/\D/g, ''));
      const i = ja.indexOf(zap);
      if (i >= 0) return resposta({ ok: true, repetido: true, posicao: i + 1 });
    }

    sh.appendRow([
      new Date(),
      texto(d.nome),
      texto(d.instagram),
      Number(d.idade) || '',
      "'" + zap,
      '=HYPERLINK("https://wa.me/' + zap + '";"Chamar")',
      'Novo'
    ]);
    return resposta({ ok: true, posicao: sh.getLastRow() - 1 });
  } catch (err) {
    return resposta({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Abrir a URL /exec no navegador mostra se está no ar.
function doGet() {
  return resposta({ ok: true, lista: 'Resenha' });
}

function aba() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA);
  if (!sh) {
    sh = ss.insertSheet(ABA);
    sh.appendRow(['Data', 'Nome', 'Instagram', 'Idade', 'WhatsApp', 'Chamar', 'Status']);
    sh.setFrozenRows(1);
    sh.getRange('A1:G1').setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm');
  }
  return sh;
}

// Evita que um nome começando com = vire fórmula na planilha.
function texto(v) {
  const s = String(v || '').slice(0, 80);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
