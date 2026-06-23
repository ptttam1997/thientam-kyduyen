// Cloudflare Pages Function — /api/wishes
// Lưu lời chúc dùng chung qua KV namespace "WISHES" (bind trong Pages → Settings → Functions → KV namespace bindings).
// Endpoint:
//   GET  /api/wishes        → trả về danh sách (mảng JSON, mới nhất ở cuối)
//   POST /api/wishes        → thêm 1 lời chúc; body JSON: { name, message, side, attending, website? }

const KEY = 'list';
const MAX_NAME = 60;
const MAX_MESSAGE = 500;
const MAX_TOTAL = 2000;
const POST_MIN_INTERVAL_MS = 5000;     // 1 lời chúc / IP / 5s
const DUP_WINDOW_MS = 60_000;          // chống trùng tên+nội dung trong 60s
const SIDES = new Set(['groom', 'bride']);
const ATTENDING = new Set(['yes', 'no']);

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });

// Bỏ control chars (\x00-\x1F và \x7F) khỏi input
const clean = (s) => {
  const str = String(s == null ? '' : s);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 32 && code !== 127) out += str[i];
  }
  return out.trim();
};

const getIP = (request) =>
  request.headers.get('cf-connecting-ip') ||
  request.headers.get('x-forwarded-for') ||
  'unknown';

export function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestGet({ env }) {
  if (!env.WISHES) {
    return json(
      { error: 'KV chưa bind. Vào Cloudflare Pages → Settings → Functions → KV namespace bindings và thêm "WISHES".' },
      { status: 500 }
    );
  }
  try {
    const list = (await env.WISHES.get(KEY, { type: 'json' })) || [];
    return json(Array.isArray(list) ? list : []);
  } catch (err) {
    return json({ error: 'KV read failed' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.WISHES) {
    return json(
      { error: 'KV chưa bind. Vào Cloudflare Pages → Settings → Functions → KV namespace bindings và thêm "WISHES".' },
      { status: 500 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Honeypot: bot điền field 'website' → giả vờ thành công, không lưu
  if (body && body.website) {
    const list = (await env.WISHES.get(KEY, { type: 'json' })) || [];
    return json(Array.isArray(list) ? list : []);
  }

  const name = clean(body && body.name).slice(0, MAX_NAME);
  const message = clean(body && body.message).slice(0, MAX_MESSAGE);
  const side = clean(body && body.side);
  const attending = clean(body && body.attending);

  if (!name) return json({ error: 'Thiếu tên' }, { status: 400 });
  if (!message) return json({ error: 'Thiếu lời chúc' }, { status: 400 });
  if (!SIDES.has(side)) return json({ error: 'Chọn nhà trai hoặc nhà gái' }, { status: 400 });
  if (!ATTENDING.has(attending)) return json({ error: 'Xác nhận tham dự' }, { status: 400 });

  // Rate-limit theo IP: 1 request / 5s
  const ip = getIP(request);
  const rlKey = 'rl:' + ip;
  const last = await env.WISHES.get(rlKey);
  const now = Date.now();
  if (last && now - Number(last) < POST_MIN_INTERVAL_MS) {
    return json({ error: 'Gửi quá nhanh, vui lòng đợi vài giây.' }, { status: 429 });
  }
  // expirationTtl tối thiểu 60s — không quan trọng vì ta so sánh timestamp
  await env.WISHES.put(rlKey, String(now), { expirationTtl: 60 });

  const raw = await env.WISHES.get(KEY, { type: 'json' });
  const list = Array.isArray(raw) ? raw : [];

  // Chống trùng: cùng tên + cùng nội dung trong 60s
  const dup = list.find(
    (w) => w.name === name && w.message === message && now - (w.ts || 0) < DUP_WINDOW_MS
  );
  if (dup) return json(list);

  list.push({ name, message, side, attending, ts: now });
  if (list.length > MAX_TOTAL) list.splice(0, list.length - MAX_TOTAL);

  try {
    await env.WISHES.put(KEY, JSON.stringify(list));
  } catch (err) {
    return json({ error: 'KV write failed' }, { status: 500 });
  }
  return json(list);
}
