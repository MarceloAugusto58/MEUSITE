// Todos os leads direto do armazenamento da Vercel, independente da planilha.
//   https://marcelo-augusto-lp.vercel.app/api/leads?key=<LEADS_ADMIN_KEY>            → CSV (abre no Excel/Sheets)
//   https://marcelo-augusto-lp.vercel.app/api/leads?key=<LEADS_ADMIN_KEY>&format=json
// Uma linha por pessoa, com o envio mais recente (as respostas são cumulativas) e o agendamento.

const { listAll, readJson } = require('./_store');

const COLS = ['created_at', 'status', 'last_step', 'name', 'whatsapp', 'email', 'company', 'segment', 'has_site', 'site_url',
  'looking_for', 'timeline', 'budget', 'agendado', 'reuniao_inicio',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'suspeito', 'received_at', 'id'];

const csvCell = v => {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // não vira fórmula no Excel/Sheets
  return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.LEADS_ADMIN_KEY || !req.query || req.query.key !== process.env.LEADS_ADMIN_KEY) return res.status(401).json({ ok: false });

  // agrupa os arquivos por lead e pega o mais recente de cada tipo
  const latest = {};
  for (const b of await listAll('leads/')) {
    const [, id, file] = b.pathname.split('/');
    if (!id || !file) continue;
    const kind = file.includes('-booking-') ? 'booking' : 'lead';
    const k = id + '|' + kind;
    if (!latest[k] || file > latest[k].file) latest[k] = { file, pathname: b.pathname };
  }
  const byId = {};
  await Promise.all(Object.entries(latest).map(async ([k, v]) => {
    const [id, kind] = k.split('|');
    try {
      const data = await readJson(v.pathname);
      byId[id] = byId[id] || {};
      if (kind === 'booking') Object.assign(byId[id], { agendado: 'sim', reuniao_inicio: data.start || '' });
      else Object.assign(byId[id], data, byId[id].agendado ? { agendado: byId[id].agendado, reuniao_inicio: byId[id].reuniao_inicio } : {});
      if (!byId[id].id) byId[id].id = id;
    } catch (e) {}
  }));
  const rows = Object.values(byId).sort((a, b) => String(b.created_at || b.received_at).localeCompare(String(a.created_at || a.received_at)));

  if (req.query.format === 'json') return res.status(200).json({ total: rows.length, leads: rows });
  const csv = '﻿' + [COLS.join(','), ...rows.map(r => COLS.map(c => csvCell(r[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.status(200).send(csv);
};
