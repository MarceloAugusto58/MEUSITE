/**
 * Recebe os leads do site numa planilha do Google.
 *
 * Como usar:
 * 1. Crie uma planilha no Google Sheets.
 * 2. Extensões → Apps Script → cole este arquivo inteiro.
 * 3. Troque SECRET abaixo por uma senha qualquer (a mesma de LEAD_WEBHOOK_SECRET na Vercel).
 * 4. Implantar → Nova implantação → Tipo "App da Web"
 *      Executar como: Eu  ·  Quem pode acessar: Qualquer pessoa
 * 5. Copie a URL gerada e coloque em LEAD_WEBHOOK_URL na Vercel.
 *
 * Cada aplicação vira uma linha na aba "Leads". Quando a pessoa agenda,
 * a mesma linha é marcada em "agendado" com o horário. Quem tem "agendado"
 * vazio preencheu e não marcou: é a lista de follow-up.
 */
var SECRET = 'troque-esta-senha';

var COLUMNS = [
  'id', 'created_at', 'name', 'company', 'segment', 'has_site', 'site_url', 'looking_for',
  'timeline', 'budget', 'whatsapp', 'email',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
  'landing_page', 'referrer', 'agendado', 'reuniao_inicio', 'calendly_evento'
];

function doPost(e) {
  var data = JSON.parse(e.postData.contents || '{}');
  if (SECRET && data.secret !== SECRET) return json({ ok: false, error: 'forbidden' });
  data = clean(data);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet();
    var row = findRow(sheet, data.id);

    if (data.type === 'booking') {
      if (!row) {
        // o lead não chegou antes: cria a linha com o que veio no agendamento (nome, WhatsApp e UTMs)
        sheet.appendRow(COLUMNS.map(function (c) { return data[c] || ''; }));
        row = sheet.getLastRow();
      }
      setCell(sheet, row, 'agendado', 'sim');
      setCell(sheet, row, 'reuniao_inicio', data.start || '');
      setCell(sheet, row, 'calendly_evento', data.event_uri || '');
    } else if (!row) { // ignora reenvio do mesmo lead
      sheet.appendRow(COLUMNS.map(function (c) { return data[c] || ''; }));
    }
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// O Sheets executa como fórmula o texto que começa com = + - @. Um ' na frente faz virar texto comum.
function clean(data) {
  var out = {};
  for (var k in data) {
    var v = data[k];
    out[k] = typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
  }
  return out;
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Leads') || ss.insertSheet('Leads');
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRow(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return 0;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

function setCell(sheet, row, column, value) {
  sheet.getRange(row, COLUMNS.indexOf(column) + 1).setValue(value);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
