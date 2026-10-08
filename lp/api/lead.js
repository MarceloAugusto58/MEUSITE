// Recebe as respostas da aplicação (parcial e final) e o agendamento, e repassa para LEAD_WEBHOOK_URL (Apps Script).
// Toda escrita é "upsert" pelo id na planilha, então reenviar o mesmo lead é seguro (não duplica linha).
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   LEAD_WEBHOOK_URL     URL que recebe o JSON (Web App do Google Apps Script)
//   LEAD_WEBHOOK_SECRET  vai no campo "secret" para o Apps Script conferir a origem
//
// Logs (Vercel → Logs), uma linha JSON por evento: LEAD_SAVE_START, LEAD_SAVE_SUCCESS, LEAD_SAVE_ERROR.
// Só o LEAD_SAVE_ERROR leva o lead inteiro, para dar para recuperar o contato à mão se a planilha falhar.

const FIELDS = [
  'type', 'id', 'created_at', 'status', 'last_step',
  'name', 'company', 'segment', 'has_site', 'site_url', 'looking_for', 'timeline', 'budget', 'whatsapp', 'email',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
  'landing_page', 'referrer', 'page',
  'event_uri', 'invitee_uri', 'start'
];
const MAX_LEN = 500;
const ATTEMPT_TIMEOUT = 12000; // o Apps Script leva 2–4 s; acordando pode passar de 8 s
const ATTEMPTS = 2;

const log = (event, info) => console.log(JSON.stringify(Object.assign({ event, at: new Date().toISOString() }, info)));

async function forward(url, lead) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ATTEMPT_TIMEOUT);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lead, secret: process.env.LEAD_WEBHOOK_SECRET || '' }),
      redirect: 'follow',
      signal: ctl.signal
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, retry: r.status >= 500 || r.status === 429, error: 'webhook_http_' + r.status, status: r.status };
    let reply = null;
    try { reply = JSON.parse(text); } catch (e) {}
    // o Apps Script responde 200 até quando recusa (ex.: senha errada); só conta como salvo se ele disser ok
    if (reply && reply.ok === true) return { ok: true, status: r.status };
    if (reply && reply.ok === false) return { ok: false, retry: false, error: 'webhook_' + (reply.error || 'recusou'), status: r.status };
    // HTML = erro do próprio Apps Script (exceção, cota, lock ocupado) ou URL/permissão errada
    return { ok: false, retry: true, error: /<html/i.test(text) ? 'webhook_html' : 'webhook_resposta_invalida', status: r.status };
  } catch (err) {
    return { ok: false, retry: true, error: err.name === 'AbortError' ? 'webhook_timeout' : 'webhook_rede' };
  } finally {
    clearTimeout(timer);
  }
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
  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) {
    log('LEAD_SAVE_ERROR', { ...meta, error: 'webhook_nao_configurado', lead });
    return res.status(503).json({ ok: false, error: 'webhook_nao_configurado' });
  }

  const t0 = Date.now();
  log('LEAD_SAVE_START', meta);
  let result;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    result = await forward(url, lead);
    if (result.ok) {
      log('LEAD_SAVE_SUCCESS', { ...meta, attempt, ms: Date.now() - t0 });
      return res.status(200).json({ ok: true, forwarded: true });
    }
    if (!result.retry) break;
  }
  log('LEAD_SAVE_ERROR', { ...meta, error: result.error, status: result.status || null, ms: Date.now() - t0, lead });
  return res.status(502).json({ ok: false, error: result.error });
};
