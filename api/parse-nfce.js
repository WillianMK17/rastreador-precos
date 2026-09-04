import { parseSefazSpHtml } from './lib/parseSefazSp.js';

const ALLOWED_HOST = 'www.nfce.fazenda.sp.gov.br';
const FETCH_TIMEOUT_MS = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const url = req.body && req.body.url;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (parsedUrl.hostname !== ALLOWED_HOST) {
    return res.status(400).json({ error: 'unsupported_state' });
  }

  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(parsedUrl.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'sefaz_unreachable' });
    }
    html = await response.text();
  } catch {
    return res.status(502).json({ error: 'sefaz_unreachable' });
  }

  const result = parseSefazSpHtml(html);
  return res.status(200).json(result);
}
