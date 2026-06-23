// Cloudflare Pages Function — /api/wishes
// Lưu lời chúc dùng chung qua KV namespace "WISHES" (bind trong dashboard).

const KEY = 'list';
const MAX_NAME = 60;
const MAX_MESSAGE = 500;
const MAX_TOTAL = 2000;
const SIDES = new Set(['groom', 'bride']);
const ATTENDING = new Set(['yes', 'no']);

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers || {}),
    },
  });

// Loại bỏ control chars (\x00-\x1F và \x7F) khỏi input
const clean = (s) => {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 32 && code !== 127) out += str[i];
  }
  return out.trim();
};

export async function onRequestGet({ env }) {
  if (!env.WISHES) return json({ error: 'KV not bound' }, { status: 500 });
  const list = (await env.WISHES.get(KEY, { type: 'json' })) || [];
  return json(list);
}

export async function onRequestPost({ request, env }) {
  if (!env.WISHES) return json({ error: 'KV not bound' }, { status: 500 });

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Honeypot: bot điền field 'website' → giả vờ thành công, không lưu
  if (body && body.website) return json([]);

  const name = clean(body && body.name).slice(0, MAX_NAME);
  const message = clean(body && body.message).slice(0, MAX_MESSAGE);
  const side = clean(body && body.side);
  const attending = clean(body && body.attending);
  if (!name || !message) return json({ error: 'Thiếu nội dung' }, { status: 400 });
  if (!SIDES.has(side)) return json({ error: 'Chọn nhà trai hoặc nhà gái' }, { status: 400 });
  if (!ATTENDING.has(attending)) return json({ error: 'Xác nhận tham dự' }, { status: 400 });

  const list = (await env.WISHES.get(KEY, { type: 'json' })) || [];

  // Chống trùng: cùng tên + cùng nội dung trong 60s
  const now = Date.now();
  const dup = list.find(w => w.name === name && w.message === message && (now - w.ts) < 60000);
  if (dup) return json(list);

  list.push({ name, message, side, attending, ts: now });
  if (list.length > MAX_TOTAL) list.splice(0, list.length - MAX_TOTAL);

  await env.WISHES.put(KEY, JSON.stringify(list));
  return json(list);
}
