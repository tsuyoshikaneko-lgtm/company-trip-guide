#!/usr/bin/env node
// ============================================
// 通知UXフローテスト
// ブラウザAPIをモックしてUI状態遷移を検証
// Usage: node test-notification-ux.mjs
// ============================================

let passed = 0;
let failed = 0;
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { assert(a === b, `${msg}: "${a}" !== "${b}"`); }

// ============================================
// Mock Browser Environment
// ============================================
function createMockEnv(options = {}) {
  const {
    notificationSupported = true,
    notificationPermission = 'default',
    isIOS = false,
    isStandalone = false,
    localStorageWorks = true,
    pushSubscribeSucceeds = true,
    fetchSucceeds = true,
  } = options;

  // localStorage mock
  const store = {};
  const localStorage = localStorageWorks ? {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  } : {
    getItem: () => { throw new DOMException('access denied'); },
    setItem: () => { throw new DOMException('access denied'); },
    removeItem: () => { throw new DOMException('access denied'); },
  };

  // Permission state
  let permission = notificationPermission;

  // Notification mock
  const Notification = notificationSupported ? {
    permission,
    requestPermission: async () => {
      if (permission === 'default') permission = 'granted';
      Notification.permission = permission;
      return permission;
    },
  } : undefined;

  // Track sent notifications
  const sentNotifications = [];
  const postMessageCalls = [];

  // Service worker mock
  const swReady = Promise.resolve({
    active: {
      postMessage: (msg) => {
        postMessageCalls.push(msg);
        if (msg.type === 'SHOW_NOTIFICATION') {
          sentNotifications.push({ title: msg.title, body: msg.body, tag: msg.tag });
        }
      },
    },
    pushManager: {
      getSubscription: async () => pushSubscribeSucceeds ? { endpoint: 'https://test', toJSON: () => ({ endpoint: 'https://test' }), unsubscribe: async () => true } : null,
      subscribe: async () => pushSubscribeSucceeds
        ? { endpoint: 'https://test', toJSON: () => ({ endpoint: 'https://test' }), unsubscribe: async () => true }
        : (() => { throw new Error('push subscribe failed'); })(),
    },
  });

  // Fetch mock
  const fetchCalls = [];
  const fetch = async (url, opts) => {
    fetchCalls.push({ url, ...opts });
    if (!fetchSucceeds) throw new Error('Network error');
    return { ok: true, json: async () => ({ ok: true }) };
  };

  // Navigator mock
  const navigator = {
    serviceWorker: { ready: swReady },
    userAgent: isIOS ? 'iPhone' : 'Chrome',
    platform: isIOS ? 'iPhone' : 'Win32',
    maxTouchPoints: isIOS ? 5 : 0,
    standalone: isIOS && isStandalone,
  };

  // matchMedia mock
  const matchMedia = (query) => ({
    matches: isStandalone && query.includes('standalone'),
  });

  return {
    localStorage, Notification, navigator, fetch, matchMedia,
    store, sentNotifications, postMessageCalls, fetchCalls,
    getPermission: () => permission,
    setPermission: (p) => { permission = p; if (Notification) Notification.permission = p; },
  };
}

// ============================================
// Simulate TripNotifications module
// (Re-implement core logic to test in isolation)
// ============================================
function createNotifModule(env, testMode = false) {
  const STORAGE_KEY = testMode ? 'trip_notif_enabled_test' : 'trip_notif_enabled';
  const SENT_KEY = testMode ? 'trip_notif_sent_test' : 'trip_notif_sent';

  function storageGet(key) {
    try { return env.localStorage.getItem(key); } catch { return null; }
  }
  function storageSet(key, val) {
    try { env.localStorage.setItem(key, val); } catch { /* ignore */ }
  }
  function storageRemove(key) {
    try { env.localStorage.removeItem(key); } catch { /* ignore */ }
  }

  function isEnabled() { return storageGet(STORAGE_KEY) === 'true'; }
  function setEnabled(val) { storageSet(STORAGE_KEY, val ? 'true' : 'false'); }

  function getSentSet() {
    try { return new Set(JSON.parse(storageGet(SENT_KEY) || '[]')); } catch { return new Set(); }
  }
  function markSent(tag) {
    const sent = getSentSet();
    sent.add(tag);
    storageSet(SENT_KEY, JSON.stringify([...sent]));
  }

  async function requestPermission() {
    if (!env.Notification) return false;
    if (env.Notification.permission === 'granted') return true;
    if (env.Notification.permission === 'denied') return false;
    const result = await env.Notification.requestPermission();
    return result === 'granted';
  }

  async function sendNotification(item) {
    const reg = await env.navigator.serviceWorker.ready;
    reg.active.postMessage({
      type: 'SHOW_NOTIFICATION',
      title: item.title,
      body: item.body,
      tag: item.tag,
    });
  }

  async function subscribePush() {
    const reg = await env.navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true });
    await env.fetch('https://worker/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
    return sub;
  }

  async function unsubscribePush() {
    const reg = await env.navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await env.fetch('https://worker/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
  }

  async function enable() {
    const granted = await requestPermission();
    if (!granted) return false;
    try { await subscribePush(); } catch (e) { /* fallback to local */ }
    setEnabled(true);
    return true;
  }

  async function disable() {
    setEnabled(false);
    try { await unsubscribePush(); } catch (e) { /* ignore */ }
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(env.navigator.userAgent)
      || (env.navigator.platform === 'MacIntel' && env.navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return env.matchMedia('(display-mode: standalone)').matches
      || env.navigator.standalone === true;
  }

  // Simulate updateNotifUI return values
  function getUIState() {
    const enabled = isEnabled();
    const supported = !!env.Notification;
    const denied = supported && env.Notification.permission === 'denied';

    if (!supported) {
      return {
        btnText: '通知に非対応です',
        disabled: true,
        active: false,
        status: isIOS() ? 'ホーム画面に追加してから再度お試しください' : 'このブラウザでは通知を利用できません',
      };
    }
    if (denied) {
      return {
        btnText: '通知がブロックされています',
        disabled: true,
        active: false,
        status: 'ブラウザの設定から通知を許可してください',
      };
    }
    if (enabled) {
      return {
        btnText: '通知をオフにする',
        disabled: false,
        active: true,
        status: '旅行中、各イベント前にリマインダーが届きます',
      };
    }
    return {
      btnText: '通知をオンにする',
      disabled: false,
      active: false,
      status: '',
    };
  }

  return {
    enable, disable, isEnabled, isIOS, isStandalone,
    getUIState, getSentSet, markSent, sendNotification,
    storageGet, storageSet, storageRemove,
    STORAGE_KEY, SENT_KEY,
  };
}

// ============================================
// Tests
// ============================================

console.log('🔔 通知UXフローテスト\n');

// ---- 1. 初期表示 ----
group('【1】初期表示: 未設定状態');

(() => {
  const env = createMockEnv();
  const mod = createNotifModule(env);
  const ui = mod.getUIState();

  test('ボタンテキストが「通知をオンにする」', () => eq(ui.btnText, '通知をオンにする', 'btnText'));
  test('ボタンは有効', () => eq(ui.disabled, false, 'disabled'));
  test('activeクラスなし', () => eq(ui.active, false, 'active'));
  test('ステータスは空', () => eq(ui.status, '', 'status'));
})();

// ---- 2. 通知オン→オフ ----
group('【2】通知オン→オフのトグルフロー');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'default' });
  const mod = createNotifModule(env);

  // Enable
  const ok = await mod.enable();
  test('enable() が true を返す', () => assert(ok));
  test('isEnabled() が true', () => assert(mod.isEnabled()));

  const uiOn = mod.getUIState();
  test('ボタンが「通知をオフにする」に変わる', () => eq(uiOn.btnText, '通知をオフにする', 'btnText'));
  test('activeクラスがつく', () => eq(uiOn.active, true, 'active'));
  test('ステータスにリマインダー説明が出る', () => assert(uiOn.status.includes('リマインダー'), `status: "${uiOn.status}"`));

  // Worker subscribe が呼ばれた
  test('Worker /subscribe にPOSTされた', () => {
    const sub = env.fetchCalls.find(c => c.url.includes('/subscribe') && c.method === 'POST');
    assert(sub, 'subscribe POST not found');
  });

  // Disable
  await mod.disable();
  test('disable後 isEnabled() が false', () => assert(!mod.isEnabled()));

  const uiOff = mod.getUIState();
  test('ボタンが「通知をオンにする」に戻る', () => eq(uiOff.btnText, '通知をオンにする', 'btnText'));
  test('activeクラスが消える', () => eq(uiOff.active, false, 'active'));

  // Worker unsubscribe が呼ばれた
  test('Worker /subscribe にDELETEされた', () => {
    const unsub = env.fetchCalls.find(c => c.url.includes('/subscribe') && c.method === 'DELETE');
    assert(unsub, 'subscribe DELETE not found');
  });
})();

// ---- 3. 権限拒否 ----
group('【3】通知権限が denied の場合');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'denied' });
  const mod = createNotifModule(env);

  const ok = await mod.enable();
  test('enable() が false を返す', () => assert(!ok));
  test('isEnabled() は false のまま', () => assert(!mod.isEnabled()));

  const ui = mod.getUIState();
  test('ボタンが「ブロックされています」', () => eq(ui.btnText, '通知がブロックされています', 'btnText'));
  test('ボタンは無効', () => eq(ui.disabled, true, 'disabled'));
  test('ステータスに設定案内が出る', () => assert(ui.status.includes('ブラウザの設定'), `status: "${ui.status}"`));
})();

// ---- 4. 通知API非対応 (通常ブラウザ) ----
group('【4】Notification API非対応 (非iOSブラウザ)');

(() => {
  const env = createMockEnv({ notificationSupported: false, isIOS: false });
  const mod = createNotifModule(env);
  const ui = mod.getUIState();

  test('ボタンが「非対応です」', () => eq(ui.btnText, '通知に非対応です', 'btnText'));
  test('ボタンは無効', () => eq(ui.disabled, true, 'disabled'));
  test('ステータスが「利用できません」', () => assert(ui.status.includes('利用できません'), `status: "${ui.status}"`));
})();

// ---- 5. iOS Safari (非PWA) ----
group('【5】iOS Safari (ホーム画面追加前)');

(() => {
  const env = createMockEnv({ notificationSupported: false, isIOS: true, isStandalone: false });
  const mod = createNotifModule(env);
  const ui = mod.getUIState();

  test('iOSとして検出される', () => assert(mod.isIOS()));
  test('スタンドアロンではない', () => assert(!mod.isStandalone()));
  test('ステータスが「ホーム画面に追加」案内', () => assert(ui.status.includes('ホーム画面'), `status: "${ui.status}"`));
  test('ボタンは無効', () => eq(ui.disabled, true, 'disabled'));
})();

// ---- 6. iOS PWA (ホーム画面追加済み) ----
group('【6】iOS PWA (ホーム画面追加済み + 通知対応)');

await (async () => {
  const env = createMockEnv({ notificationSupported: true, notificationPermission: 'default', isIOS: true, isStandalone: true });
  const mod = createNotifModule(env);

  test('iOSとして検出される', () => assert(mod.isIOS()));
  test('スタンドアロンとして検出される', () => assert(mod.isStandalone()));

  const ok = await mod.enable();
  test('enable() が true を返す', () => assert(ok));

  const ui = mod.getUIState();
  test('通知がオンになる', () => eq(ui.btnText, '通知をオフにする', 'btnText'));
})();

// ---- 7. iPad検出 (iPadOS 13+) ----
group('【7】iPad検出 (iPadOS 13+ = MacIntel + touchpoints)');

(() => {
  const env = createMockEnv({ isIOS: false });
  // Override to simulate iPad
  env.navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
  env.navigator.platform = 'MacIntel';
  env.navigator.maxTouchPoints = 5;

  const mod = createNotifModule(env);
  test('iPadがiOSとして検出される', () => assert(mod.isIOS()));
})();

// ---- 8. localStorage壊れ (プライベートブラウズ) ----
group('【8】localStorage例外 (プライベートブラウズ)');

await (async () => {
  const env = createMockEnv({ localStorageWorks: false, notificationPermission: 'granted' });
  const mod = createNotifModule(env);

  test('isEnabled() が例外を投げない', () => {
    const result = mod.isEnabled();
    eq(result, false, 'isEnabled');
  });

  test('enable() が例外を投げない', async () => {
    const ok = await mod.enable();
    assert(ok, 'enable should succeed even if localStorage fails');
  });

  test('getSentSet() が空Setを返す', () => {
    const set = mod.getSentSet();
    assert(set instanceof Set && set.size === 0, 'should be empty set');
  });

  test('markSent() が例外を投げない', () => {
    mod.markSent('test-tag'); // should not throw
  });
})();

// ---- 9. Push購読失敗時のフォールバック ----
group('【9】Web Push購読失敗 → ローカルタイマーにフォールバック');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'default', pushSubscribeSucceeds: false });
  const mod = createNotifModule(env);

  const ok = await mod.enable();
  test('Push失敗でもenable()はtrueを返す', () => assert(ok, 'should succeed with local fallback'));
  test('isEnabled()がtrue', () => assert(mod.isEnabled()));
})();

// ---- 10. ネットワーク失敗時 ----
group('【10】fetch失敗 (オフライン環境)');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'default', fetchSucceeds: false });
  const mod = createNotifModule(env);

  const ok = await mod.enable();
  test('fetch失敗でもenable()はtrueを返す', () => assert(ok));
  test('ローカル通知は有効', () => assert(mod.isEnabled()));
})();

// ---- 11. 再訪問時の自動復帰 ----
group('【11】再訪問時のauto-start条件');

(() => {
  // Simulating: localStorage has 'true', permission is 'granted'
  const env = createMockEnv({ notificationPermission: 'granted' });
  env.localStorage.setItem('trip_notif_enabled', 'true');

  const mod = createNotifModule(env);
  test('前回ONのまま → isEnabled() が true', () => assert(mod.isEnabled()));

  const ui = mod.getUIState();
  test('UIが「オフにする」で表示される', () => eq(ui.btnText, '通知をオフにする', 'btnText'));
})();

(() => {
  // Simulating: localStorage has 'true' BUT permission got revoked
  const env = createMockEnv({ notificationPermission: 'denied' });
  env.localStorage.setItem('trip_notif_enabled', 'true');

  const mod = createNotifModule(env);
  test('前回ONだが権限revoked → UIは「ブロック」表示', () => {
    const ui = mod.getUIState();
    eq(ui.btnText, '通知がブロックされています', 'btnText');
  });
})();

// ---- 12. 送信済みタグの重複防止 ----
group('【12】通知の重複送信防止');

(() => {
  const env = createMockEnv({ notificationPermission: 'granted' });
  const mod = createNotifModule(env);

  mod.markSent('day1-assembly');
  mod.markSent('day1-lunch');
  const sent = mod.getSentSet();

  test('markSentで2件追加される', () => eq(sent.size, 2, 'sent size'));
  test('day1-assemblyが送信済み', () => assert(sent.has('day1-assembly')));
  test('day1-lunchが送信済み', () => assert(sent.has('day1-lunch')));
  test('day1-dinnerは未送信', () => assert(!sent.has('day1-dinner')));

  // Re-read from storage (simulate page reload)
  const sent2 = mod.getSentSet();
  test('リロード後も送信済みが残る', () => eq(sent2.size, 2, 'sent size after reload'));
})();

// ---- 13. sendNotification のメッセージ形式 ----
group('【13】SW への postMessage 形式');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'granted' });
  const mod = createNotifModule(env);

  await mod.sendNotification({ title: 'テスト', body: '本文だよ', tag: 'test-tag' });

  test('postMessage が1回呼ばれた', () => eq(env.postMessageCalls.length, 1, 'call count'));

  const msg = env.postMessageCalls[0];
  test('type が SHOW_NOTIFICATION', () => eq(msg.type, 'SHOW_NOTIFICATION', 'type'));
  test('title が渡される', () => eq(msg.title, 'テスト', 'title'));
  test('body が渡される', () => eq(msg.body, '本文だよ', 'body'));
  test('tag が渡される', () => eq(msg.tag, 'test-tag', 'tag'));
})();

// ---- 14. テストモード分離 ----
group('【14】テストモードと本番モードのストレージ分離');

(() => {
  const env = createMockEnv({ notificationPermission: 'granted' });
  const prodMod = createNotifModule(env, false);
  const testMod = createNotifModule(env, true);

  test('本番キーは trip_notif_enabled', () => eq(prodMod.STORAGE_KEY, 'trip_notif_enabled', 'key'));
  test('テストキーは trip_notif_enabled_test', () => eq(testMod.STORAGE_KEY, 'trip_notif_enabled_test', 'key'));

  prodMod.storageSet(prodMod.STORAGE_KEY, 'true');
  test('本番ON → テストはOFFのまま', () => {
    assert(prodMod.isEnabled(), 'prod should be enabled');
    assert(!testMod.isEnabled(), 'test should not be enabled');
  });
})();

// ---- 15. 状態遷移の完全性 ----
group('【15】状態遷移マトリクス');

const stateMatrix = [
  { desc: '通知対応 + default + 未有効',   opts: { notificationSupported: true,  notificationPermission: 'default' }, expectBtn: '通知をオンにする' },
  { desc: '通知対応 + granted + 有効',     opts: { notificationSupported: true,  notificationPermission: 'granted' }, preEnable: true, expectBtn: '通知をオフにする' },
  { desc: '通知対応 + denied',             opts: { notificationSupported: true,  notificationPermission: 'denied' },  expectBtn: '通知がブロックされています' },
  { desc: '通知非対応',                    opts: { notificationSupported: false },                                     expectBtn: '通知に非対応です' },
];

for (const { desc, opts, preEnable, expectBtn } of stateMatrix) {
  await (async () => {
    const env = createMockEnv(opts);
    const mod = createNotifModule(env);
    if (preEnable) await mod.enable();

    const ui = mod.getUIState();
    test(`${desc} → 「${expectBtn}」`, () => eq(ui.btnText, expectBtn, 'btnText'));
  })();
}

// ---- 16. enable → disable → enable (再有効化) ----
group('【16】再有効化フロー');

await (async () => {
  const env = createMockEnv({ notificationPermission: 'default' });
  const mod = createNotifModule(env);

  await mod.enable();
  test('1回目: enabled', () => assert(mod.isEnabled()));

  await mod.disable();
  test('disable: disabled', () => assert(!mod.isEnabled()));

  await mod.enable();
  test('2回目: re-enabled', () => assert(mod.isEnabled()));

  test('subscribe が2回呼ばれた', () => {
    const subs = env.fetchCalls.filter(c => c.method === 'POST');
    eq(subs.length, 2, 'POST count');
  });
})();

// ============================================
// Summary
// ============================================
console.log(`\n${'='.repeat(45)}`);
console.log(`  結果: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(45)}\n`);

process.exit(failed > 0 ? 1 : 0);
