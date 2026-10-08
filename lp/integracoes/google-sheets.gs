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
 * Para ATUALIZAR este código depois, sem mudar a URL:
 *   Implantar → Gerenciar implantações → lápis (editar) → Versão: "Nova versão" → Implantar.
 *   ("Nova implantação" cria outra URL, e a da Vercel para de funcionar.)
 *
 * Cada pessoa vira uma linha na aba "Leads", criada já na 1ª etapa do formulário (nome + WhatsApp)
 * com status "incompleto" e atualizada a cada etapa. No envio final o status vira "completo".
 * Quando a pessoa agenda, a mesma linha é marcada em "agendado" com o horário.
 *   status incompleto            → começou e desistiu (ultima_etapa mostra onde parou)
 *   status completo, sem agendado → respondeu tudo e não marcou a conversa
 *
 * As colunas são encontradas pelo nome do cabeçalho; as que faltarem são criadas no fim,
 * então dá para atualizar o script numa planilha que já tem leads.
 */
var SECRET = 'troque-esta-senha';

var COLUMNS = [
  'id', 'created_at', 'status', 'ultima_etapa', 'name', 'whatsapp', 'company', 'segment', 'has_site', 'site_url',
  'looking_for', 'timeline', 'budget', 'email',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
  'landing_page', 'referrer', 'agendado', 'reuniao_inicio', 'calendly_evento', 'suspeito'
];
// coluna da planilha → campo que vem do site, quando o nome é diferente
var FROM = { ultima_etapa: 'last_step', reuniao_inicio: 'start', calendly_evento: 'event_uri' };

function doPost(e) {
  var data = JSON.parse(e.postData.contents || '{}');
  if (SECRET && data.secret !== SECRET) return json({ ok: false, error: 'forbidden' });
  data = clean(data);
  if (!data.id) return json({ ok: false, error: 'missing_id' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet(), cols = headers(sheet);
    var values = {};
    COLUMNS.forEach(function (c) { values[c] = data[FROM[c] || c]; });

    if (data.type === 'booking') {
      values.agendado = 'sim';
      values.status = undefined;       // agendamento não mexe no status
      values.ultima_etapa = undefined;
    }
    upsert(sheet, cols, data.id, values, data.type === 'partial');
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Cria ou atualiza a linha do id. Só grava campos com valor, então nada já salvo é apagado.
// Um envio parcial atrasado não volta um lead "completo" para "incompleto".
function upsert(sheet, cols, id, values, isPartial) {
  var idCol = cols.indexOf('id'), statusCol = cols.indexOf('status');
  var row = findRow(sheet, idCol, id);
  var cur = row ? sheet.getRange(row, 1, 1, cols.length).getValues()[0] : cols.map(function () { return ''; });
  if (row && isPartial && cur[statusCol] === 'completo') return;
  cols.forEach(function (c, i) {
    var v = values[c];
    if (v !== undefined && v !== null && v !== '') cur[i] = v;
  });
  if (row) sheet.getRange(row, 1, 1, cols.length).setValues([cur]);
  else sheet.appendRow(cur);
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

// Lê o cabeçalho e acrescenta no fim as colunas que ainda não existem
function headers(sheet) {
  var cols = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var missing = COLUMNS.filter(function (c) { return cols.indexOf(c) === -1; });
  if (missing.length) {
    sheet.getRange(1, cols.length + 1, 1, missing.length).setValues([missing]);
    cols = cols.concat(missing);
  }
  return cols;
}

function findRow(sheet, idCol, id) {
  if (sheet.getLastRow() < 2) return 0;
  var ids = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
