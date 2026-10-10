// Armazenamento dos leads (Vercel Blob privado) e repasse para a planilha (Google Apps Script).
// Arquivos com "_" na frente não viram rota na Vercel.
//
//   leads/<id>/<data>-<tipo>-<rand>.json   cada envio, só acrescenta (nunca sobrescreve): é a cópia de segurança
//   pendentes/<id>--<tipo>.json            último envio que a planilha ainda não confirmou
//
// Variáveis: BLOB_READ_WRITE_TOKEN (store "leads-lp"), LEAD_WEBHOOK_URL, LEAD_WEBHOOK_SECRET.

const { put, list, get, del } = require('@vercel/blob');

const SHEET_TIMEOUT = 25000; // o Apps Script às vezes leva 20 s; 2 tentativas cabem no maxDuration de 60 s
const SHEET_ATTEMPTS = 2;

const log = (event, info) => console.log(JSON.stringify(Object.assign({ event, at: new Date().toISOString() }, info)));
const safeId = id => String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'sem-id';
const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + '_timeout')), ms))]);

// Grava o envio como um arquivo novo (cópia de segurança). Resolve true/false, nunca rejeita.
async function saveEvent(lead) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
  const path = `leads/${safeId(lead.id)}/${lead.received_at.replace(/[:.]/g, '-')}-${lead.type}-${Math.random().toString(36).slice(2, 7)}.json`;
  try {
    await withTimeout(put(path, JSON.stringify(lead), { access: 'private', addRandomSuffix: false, contentType: 'application/json' }), 8000, 'blob');
    return true;
  } catch (err) {
    log('LEAD_BACKUP_ERROR', { id: lead.id, type: lead.type, error: err.message });
    return false;
  }
}

async function forwardOnce(lead) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SHEET_TIMEOUT);
  try {
    const r = await fetch(process.env.LEAD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lead, secret: process.env.LEAD_WEBHOOK_SECRET || '' }),
      redirect: 'follow',
      signal: ctl.signal
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, retry: r.status >= 500 || r.status === 429, error: 'webhook_http_' + r.status };
    let reply = null;
    try { reply = JSON.parse(text); } catch (e) {}
    // o Apps Script responde 200 até quando recusa (ex.: senha errada); só conta como salvo se ele disser ok
    if (reply && reply.ok === true) return { ok: true };
    if (reply && reply.ok === false) return { ok: false, retry: false, error: 'webhook_' + (reply.error || 'recusou') };
    return { ok: false, retry: true, error: /<html/i.test(text) ? 'webhook_html' : 'webhook_resposta_invalida' };
  } catch (err) {
    return { ok: false, retry: true, error: err.name === 'AbortError' ? 'webhook_timeout' : 'webhook_rede' };
  } finally {
    clearTimeout(timer);
  }
}

// Repassa para a planilha com novas tentativas. É seguro repetir: a planilha atualiza a linha pelo id.
async function forwardToSheet(lead) {
  if (!process.env.LEAD_WEBHOOK_URL) return { ok: false, error: 'webhook_nao_configurado', attempts: 0 };
  let result, attempt = 0;
  const t0 = Date.now();
  while (attempt < SHEET_ATTEMPTS) {
    attempt++;
    result = await forwardOnce(lead);
    if (result.ok || !result.retry) break;
    if (attempt < SHEET_ATTEMPTS) await new Promise(r => setTimeout(r, 1500 * attempt));
  }
  return Object.assign(result, { attempts: attempt, ms: Date.now() - t0 });
}

const pendingPath = lead => `pendentes/${safeId(lead.id)}--${lead.type === 'booking' ? 'agendamento' : 'lead'}.json`;

async function markPending(lead, error) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await put(pendingPath(lead), JSON.stringify({ lead, error, at: new Date().toISOString() }), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  } catch (err) { log('LEAD_PENDING_ERROR', { id: lead.id, error: err.message }); }
}
async function clearPending(lead) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return;
  try { await del(pendingPath(lead)); } catch (e) {}
}

async function readJson(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false });
  return JSON.parse(await new Response(r.stream).text());
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

// Reenvia para a planilha o que ficou pendente (no máximo `limit` por vez).
async function syncPending(limit = 20, budgetMs = 40000) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { pendentes: 0, enviados: 0, falharam: 0 };
  const blobs = (await listAll('pendentes/')).slice(0, limit);
  const t0 = Date.now();
  let ok = 0, falhou = 0;
  for (const b of blobs) {
    if (Date.now() - t0 > budgetMs) break; // o resto fica para a próxima vez
    try {
      const { lead } = await readJson(b.pathname);
      const r = await forwardToSheet(lead);
      if (r.ok) { ok++; await del(b.pathname); log('LEAD_SYNC_SUCCESS', { id: lead.id, type: lead.type }); }
      else { falhou++; log('LEAD_SYNC_ERROR', { id: lead.id, type: lead.type, error: r.error }); if (!r.retry && r.error === 'webhook_forbidden') break; }
    } catch (err) { falhou++; log('LEAD_SYNC_ERROR', { path: b.pathname, error: err.message }); }
  }
  return { pendentes: blobs.length, enviados: ok, falharam: falhou };
}

module.exports = { log, saveEvent, forwardToSheet, markPending, clearPending, syncPending, listAll, readJson };
