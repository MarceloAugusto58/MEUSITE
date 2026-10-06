// Recebe as respostas da aplicação (e depois o agendamento) e repassa para LEAD_WEBHOOK_URL.
// Sem webhook configurado, o lead fica registrado nos logs da função na Vercel.
//
// Variáveis de ambiente (Vercel → Settings → Environment Variables):
//   LEAD_WEBHOOK_URL     URL que recebe o JSON (ex.: Web App do Google Apps Script, Make, Zapier, n8n)
//   LEAD_WEBHOOK_SECRET  opcional; vai no campo "secret" para o webhook conferir a origem

const FIELDS = [
  'type', 'id', 'created_at',
  'name', 'company', 'segment', 'has_site', 'site_url', 'looking_for', 'timeline', 'budget', 'whatsapp', 'email',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid',
  'landing_page', 'referrer', 'page',
  'event_uri', 'invitee_uri', 'start'
];
const MAX_LEN = 500;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ ok: false, error: 'invalid_body' });
  // campo invisível do formulário: veio preenchido, é robô. Responde ok para ele não tentar de novo.
  if (body.ma_hp) return res.status(200).json({ ok: true });

  const lead = {};
  for (const key of FIELDS) {
    let value = body[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value = value.join(', ');
    lead[key] = String(value).slice(0, MAX_LEN);
  }
  lead.type = lead.type === 'booking' ? 'booking' : 'lead';
  if (!lead.id) return res.status(400).json({ ok: false, error: 'missing_id' });
  if (lead.type === 'lead' && (!lead.name || !lead.whatsapp)) {
    return res.status(400).json({ ok: false, error: 'missing_fields' });
  }
  lead.received_at = new Date().toISOString();

  const url = process.env.LEAD_WEBHOOK_URL;
  if (!url) {
    console.log('[lead] LEAD_WEBHOOK_URL não configurada:', JSON.stringify(lead));
    return res.status(200).json({ ok: true, forwarded: false });
  }

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lead, secret: process.env.LEAD_WEBHOOK_SECRET || '' }),
      redirect: 'follow'
    });
    if (!r.ok) { const mask = u => { try { const x = new URL(u); return x.host + x.pathname.replace(/[A-Za-z0-9_-]{20,}/g, '<id>') + (x.search ? '?…' : ''); } catch (e) { return 'url inválida'; } }; throw new Error('status ' + r.status + ' em ' + mask(url) + ' → ' + mask(r.url) + ' len=' + url.length + (url !== url.trim() ? ' (tem espaço)' : '')); }
    // o Apps Script responde 200 até quando recusa (ex.: senha errada); só conta como salvo se ele disser ok
    const text = await r.text();
    let reply = null;
    try { reply = JSON.parse(text); } catch (e) {}
    if (reply && reply.ok === false) throw new Error('webhook recusou: ' + (reply.error || 'sem motivo'));
    if (!reply && /<html/i.test(text)) throw new Error('webhook respondeu HTML (URL ou permissão do Apps Script errada)');
    return res.status(200).json({ ok: true, forwarded: true });
  } catch (err) {
    // Fica no log para não perder o lead; o navegador guarda e tenta de novo na próxima visita.
    console.error('[lead] falha no webhook:', err.message, JSON.stringify(lead));
    return res.status(502).json({ ok: false, error: err.message.slice(0, 120) });
  }
};
