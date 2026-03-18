// ============================================
// Trip Push Notification Worker
// Cloudflare Worker + KV + Cron Triggers
// ============================================

// Notification schedule: cron UTC time → notification content
// Each cron trigger time maps to a specific notification
const SCHEDULE_MAP = {
  '01:30-19-3': { title: '集合20分前！', body: '東京駅バス乗り場に10:50集合です。遅刻注意！' },
  '03:30-19-3': { title: 'まもなく昼ごはん', body: '12:40〜 ワーズワース（イタリアン）で全員ランチです' },
  '05:55-19-3': { title: 'チェックイン開始', body: '15:00〜17:15の間にホテル(KAGURA)へチェックインしてね' },
  '06:45-19-3': { title: '和菓子作り体験15分前', body: '16:00〜 岩立本店で和菓子作り体験スタート！' },
  '08:15-19-3': { title: '全員集合！夕ごはん', body: '17:30〜 ホテルで夕食＋立澤さん。絶対来てね！' },
  '22:45-19-3': { title: 'おはよう！朝ごはん', body: '8:00 / 8:30 / 9:00 から選択。会場は10:00まで' },
  '00:45-20-3': { title: '香取神宮 集合15分前', body: '10:00集合 タクシー相乗りで向かいます' },
  '02:45-20-3': { title: 'チェックアウト準備', body: '12:00チェックアウトです。荷物は預けられます' },
  '04:45-20-3': { title: 'アクティビティ準備', body: '14:00〜 酒粕入浴剤づくり / ドレッシング作り体験' },
  '05:45-20-3': { title: 'ドレッシング作り15:00の部', body: '15:00〜 醸し処 和ぎ（ホテルから徒歩2分）' },
  '06:50-20-3': { title: '中締め・振り返り', body: '16:00〜 いなえにて感想共有タイム！' },
  '08:20-20-3': { title: 'バスの時間', body: '17:42発 佐原→東京（19:31着）。乗る方はお忘れなく！' },
};

// ---- Web Push helpers (VAPID + encryption using Web Crypto API) ----

function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - base64.length % 4) % 4;
  const raw = atob(base64 + '='.repeat(pad));
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

function uint8ArrayToBase64url(arr) {
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatUint8Arrays(...arrays) {
  const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(new Uint8Array(arr instanceof ArrayBuffer ? arr : arr.buffer ? arr : arr), offset);
    offset += arr.byteLength;
  }
  return result;
}

async function createVapidAuthHeader(endpoint, vapidSubject, publicKeyBase64url, privateKeyBase64url) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapidSubject,
  };

  const headerB64 = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import VAPID private key
  const privateKeyBytes = base64urlToUint8Array(privateKeyBase64url);
  const publicKeyBytes = base64urlToUint8Array(publicKeyBase64url);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: uint8ArrayToBase64url(publicKeyBytes.slice(1, 33)),
    y: uint8ArrayToBase64url(publicKeyBytes.slice(33, 65)),
    d: uint8ArrayToBase64url(privateKeyBytes),
  };

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER-like signature to raw r||s format (already raw from Web Crypto)
  const token = `${unsignedToken}.${uint8ArrayToBase64url(new Uint8Array(signature))}`;

  return {
    authorization: `vapid t=${token}, k=${publicKeyBase64url}`,
  };
}

// Encrypt push message payload using aes128gcm (RFC 8291)
async function encryptPayload(subscription, payload) {
  const clientPublicKeyBytes = base64urlToUint8Array(subscription.keys.p256dh);
  const authSecret = base64urlToUint8Array(subscription.keys.auth);

  // Generate local ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicKeyRaw = await crypto.subtle.exportKey('raw', localKeyPair.publicKey);
  const localPublicKeyBytes = new Uint8Array(localPublicKeyRaw);

  // Import client public key
  const clientPublicKey = await crypto.subtle.importKey(
    'raw', clientPublicKeyBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );

  // ECDH shared secret
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey }, localKeyPair.privateKey, 256
  );
  const sharedSecret = new Uint8Array(sharedSecretBits);

  // HKDF: auth_info = "WebPush: info\0" + client_public_key + local_public_key
  const encoder = new TextEncoder();
  const authInfo = concatUint8Arrays(
    encoder.encode('WebPush: info\0'),
    clientPublicKeyBytes,
    localPublicKeyBytes
  );

  // IKM via HKDF-Extract(auth_secret, shared_secret), then HKDF-Expand(PRK, auth_info, 32)
  const prkKey = await crypto.subtle.importKey('raw', authSecret, { name: 'HKDF' }, false, ['deriveBits']);
  // Actually we need: PRK = HKDF-Extract(salt=authSecret, IKM=sharedSecret)
  // Then: IKM_final = HKDF-Expand(PRK, authInfo, 32)
  // Web Crypto HKDF does extract+expand in one step, but with IKM as the key.
  // We need a two-step approach.

  // Step 1: PRK = HMAC-SHA256(authSecret, sharedSecret)
  const hmacKey = await crypto.subtle.importKey('raw', authSecret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, sharedSecret));

  // Step 2: IKM = HKDF-Expand(PRK, auth_info, 32)
  const ikm = await hkdfExpand(prk, authInfo, 32);

  // Generate random 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive CEK and nonce using salt
  const cekInfo = encoder.encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = encoder.encode('Content-Encoding: nonce\0');

  // PRK2 = HMAC-SHA256(salt, ikm)
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk2 = new Uint8Array(await crypto.subtle.sign('HMAC', saltKey, ikm));

  const cek = await hkdfExpand(prk2, cekInfo, 16);
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);

  // Encrypt payload with AES-128-GCM
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  // Add padding delimiter (0x02 for final record)
  const paddedPayload = concatUint8Arrays(payloadBytes, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, paddedPayload);

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + encrypted_content
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const idlen = new Uint8Array([65]); // uncompressed P-256 key is 65 bytes

  return concatUint8Arrays(salt, rs, idlen, localPublicKeyBytes, new Uint8Array(encrypted));
}

async function hkdfExpand(prk, info, length) {
  const hmacKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const infoWithCounter = concatUint8Arrays(info, new Uint8Array([1]));
  const result = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, infoWithCounter));
  return result.slice(0, length);
}

// Send push notification to a single subscription
async function sendPush(subscription, payload, env) {
  const body = await encryptPayload(subscription, payload);
  const headers = await createVapidAuthHeader(
    subscription.endpoint,
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length': body.byteLength.toString(),
      TTL: '86400',
      Urgency: 'high',
    },
    body: body,
  });

  return response;
}

// ---- Worker entry point ----

export default {
  // HTTP handler for subscription management
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // POST /subscribe — store a push subscription
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      const subscription = await request.json();
      const key = `sub:${btoa(subscription.endpoint)}`;
      await env.SUBSCRIPTIONS.put(key, JSON.stringify(subscription));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // DELETE /subscribe — remove a push subscription
    if (url.pathname === '/subscribe' && request.method === 'DELETE') {
      const { endpoint } = await request.json();
      const key = `sub:${btoa(endpoint)}`;
      await env.SUBSCRIPTIONS.delete(key);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // GET /health
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },

  // Cron trigger handler — send push notifications at scheduled times
  async scheduled(event, env, ctx) {
    const dt = new Date(event.scheduledTime);
    const hour = String(dt.getUTCHours()).padStart(2, '0');
    const minute = String(dt.getUTCMinutes()).padStart(2, '0');
    const day = dt.getUTCDate();
    const month = dt.getUTCMonth() + 1;
    const key = `${hour}:${minute}-${day}-${month}`;

    const notification = SCHEDULE_MAP[key];
    if (!notification) {
      console.log(`No notification mapped for ${key}`);
      return;
    }

    // Get all subscriptions from KV
    const list = await env.SUBSCRIPTIONS.list({ prefix: 'sub:' });
    console.log(`Sending "${notification.title}" to ${list.keys.length} subscribers`);

    const results = await Promise.allSettled(
      list.keys.map(async ({ name }) => {
        const raw = await env.SUBSCRIPTIONS.get(name);
        if (!raw) return;
        const subscription = JSON.parse(raw);
        const response = await sendPush(subscription, notification, env);
        // Remove expired/invalid subscriptions
        if (response.status === 404 || response.status === 410) {
          await env.SUBSCRIPTIONS.delete(name);
          console.log(`Removed expired subscription: ${name}`);
        }
      })
    );

    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.log(`${failed.length} push(es) failed:`, failed.map(r => r.reason));
    }
  },
};
