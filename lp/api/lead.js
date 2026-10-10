// Recebe as respostas da aplicação (parcial e final) e o agendamento.
//
// 1. Grava o envio no armazenamento privado da Vercel (Blob) e confirma ao navegador na hora (< 1 s).
//    O Google Apps Script às vezes leva 10–25 s ou falha; o visitante não espera mais por ele.
// 2. Em segundo plano (waitUntil) repassa para a planilha, com novas tentativas. Se não der,
//    fica em "pendentes/" e é reenviado no próximo envio bem-sucedido ou pelo cron diário (api/sync).
// 3. Se o Blob falhar, faz como antes: espera a planilha confirmar.
//
// Logs (Vercel → Logs): LEAD_SAVE_START/SUCCESS/ERROR, LEAD_SHEET_SUCCESS/ERROR.

const { waitUntil } = require('@vercel/functions');
const { log, saveEvent, forwardToSheet, markPending, clearPending, syncPending } = require('./_store');

const FIELDS = [
  'type', 'id', 'created_at', 'status', 'last_step',
  'name', 'company', 'segment', 'has_site', 'site_url', 'looking_for', 'timeline', 'budget', 'whatsapp', 'email',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
  'landing_page', 'referrer', 'page',
  'event_uri', 'invitee_uri', 'start'
];
const MAX_LEN = 500;

async function toSheet(lead, meta) {
  const r = await forwardToSheet(lead);
  if (r.ok) {
    log('LEAD_SHEET_SUCCESS', { ...meta, attempts: r.attempts, ms: r.ms });
    await clearPending(lead);
    await syncPending(3, 15000); // aproveita que a planilha respondeu para mandar o que estava pendente
  } else {
    log('LEAD_SHEET_ERROR', { ...meta, error: r.error, attempts: r.attempts, ms: r.ms });
    await markPending(lead, r.error);
  }
  return r;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });

  const lead = {};
  for (const key of FIELDS) {
    let value = body[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value = value.join(', ');
    lead[key] = String(value).slice(0, MAX_LEN);
  }
  // partial = etapa intermediária do formulário (atualiza a mesma linha na planilha)
  lead.type = ['booking', 'partial'].includes(lead.type) ? lead.type : 'lead';
  // Campo invisível preenchido: provável robô. Não descarta (um preenchimento automático pode ter
  // caído ali): salva marcado, para não perder uma pessoa de verdade.
  if (body.ma_hp) lead.suspeito = 'campo invisível preenchido';
  if (!lead.id) return res.status(400).json({ ok: false, error: 'missing_id' });
  if (lead.type !== 'booking' && (!lead.name || !lead.whatsapp)) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  lead.received_at = new Date().toISOString();

  const meta = { id: lead.id, type: lead.type, step: lead.last_step || '', via: body.via || 'fetch' };
  const t0 = Date.now();
  log('LEAD_SAVE_START', meta);

  // 1. cópia de segurança na Vercel: se gravou, o lead está salvo
  if (await saveEvent(lead)) {
    log('LEAD_SAVE_SUCCESS', { ...meta, store: 'blob', ms: Date.now() - t0 });
    waitUntil(toSheet(lead, meta).catch(err => log('LEAD_SHEET_ERROR', { ...meta, error: err.message })));
    return res.status(200).json({ ok: true, forwarded: true, stored: 'blob' });
  }

  // 2. sem Blob: espera a planilha (comportamento anterior)
  const r = await forwardToSheet(lead);
  if (r.ok) {
    log('LEAD_SAVE_SUCCESS', { ...meta, store: 'planilha', attempts: r.attempts, ms: Date.now() - t0 });
    return res.status(200).json({ ok: true, forwarded: true, stored: 'planilha' });
  }
  log('LEAD_SAVE_ERROR', { ...meta, error: r.error, attempts: r.attempts, ms: Date.now() - t0, lead });
  return res.status(502).json({ ok: false, error: r.error });
};
