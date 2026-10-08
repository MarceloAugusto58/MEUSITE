// Recebe do navegador erros de JavaScript e falhas de salvamento (sem dados pessoais) e escreve no log da Vercel.
// Vercel → projeto marcelo-augusto-lp → Logs, filtrando por "CLIENT_".
// Instrumentação temporária de debug: pode ser removida quando o funil estiver estável.

const ALLOWED = ['JS_ERROR', 'LEAD_SAVE_ERROR', 'LEAD_SAVE_RECOVERED'];
const clip = (v, n) => (v === undefined || v === null ? undefined : String(v).slice(0, n));

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !ALLOWED.includes(b.event)) return res.status(204).end();
  console.log(JSON.stringify({
    event: 'CLIENT_' + b.event,
    at: new Date().toISOString(),
    lead_id: clip(b.lead_id, 60),
    kind: clip(b.kind, 20),
    step_number: clip(b.step_number, 4),
    step_name: clip(b.step_name, 30),
    message: clip(b.message, 300),
    source: clip(b.source, 120),
    line: clip(b.line, 8),
    status: clip(b.status, 8),
    error: clip(b.error, 60),
    attempt: clip(b.attempt, 4),
    online: clip(b.online, 6),
    browser: clip(b.browser, 40),
    user_agent: clip(req.headers['user-agent'], 300),
    screen_width: clip(b.screen_width, 6),
    page: clip(b.page, 200)
  }));
  res.status(204).end();
};
