// Busca dia, horário e local de uma reunião recém-agendada no Calendly,
// para a tela de confirmação mostrar os detalhes e oferecer "adicionar ao calendário".
//
// Variável de ambiente (opcional):
//   CALENDLY_TOKEN  Personal Access Token do Calendly (Integrations → API & Webhooks)
// Sem token, responde 204 e a página mostra a confirmação sem dia/horário.

const EVENT_URI = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]+$/;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const token = process.env.CALENDLY_TOKEN;
  if (!token) return res.status(204).end();

  const uri = String((req.query && req.query.event) || '');
  if (!EVENT_URI.test(uri)) return res.status(400).json({ ok: false, error: 'invalid_event' });

  try {
    const r = await fetch(uri, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('status ' + r.status);
    const { resource } = await r.json();
    const loc = resource.location || {};
    return res.status(200).json({
      start: resource.start_time,
      end: resource.end_time,
      name: resource.name,
      location: { type: loc.type || null, join_url: loc.join_url || null }
    });
  } catch (err) {
    console.error('[booking] falha ao consultar o Calendly:', err.message);
    return res.status(502).json({ ok: false });
  }
};
