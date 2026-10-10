// Reenvia para a planilha os leads que ficaram pendentes (quando o Google Apps Script falhou).
// Roda sozinho uma vez por dia (cron em vercel.json) e também pode ser chamado à mão:
//   https://marcelo-augusto-lp.vercel.app/api/sync?key=<LEADS_ADMIN_KEY>

const { syncPending } = require('./_store');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const auth = req.headers.authorization || '';
  const cronOk = process.env.CRON_SECRET && auth === 'Bearer ' + process.env.CRON_SECRET;
  const keyOk = process.env.LEADS_ADMIN_KEY && req.query && req.query.key === process.env.LEADS_ADMIN_KEY;
  if (!cronOk && !keyOk) return res.status(401).json({ ok: false });
  const result = await syncPending(50);
  return res.status(200).json({ ok: true, ...result });
};
