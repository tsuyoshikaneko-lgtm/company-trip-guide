// ============================================
// Scheduled Push Notification System
// ============================================

// Worker URL — update after deploying the Cloudflare Worker
const PUSH_WORKER_URL = 'https://trip-push-worker.tsuyoshi-kaneko.workers.dev';

// VAPID public key for Web Push subscription
const VAPID_PUBLIC_KEY = 'BBgq9vZBcOV_b0P44gfsU272Y0n1I9UkL6pGXifwaCDiT-0JiDUHbxYnKCeWi3oecUipfWa4ghZKqsfPZEfw4xc';

// Test mode: ?test-push in URL OR sessionStorage flag (set by hidden gesture, session-only)
let TEST_MODE = new URLSearchParams(window.location.search).has('test-push');
try { if (sessionStorage.getItem('trip_test_mode') === 'true') TEST_MODE = true; } catch {}

const TripNotifications = (() => {
  // Production schedule: [month, day, hour, minute] in JST
  const PROD_SCHEDULE = [
    // === Day 1: 3/19 (Thu) ===
    { time: [3, 19, 10, 30], title: 'おーい！あと20分だよ！', body: 'くまさんだよ！バス組は東京駅に10:50集合！現地組は12:40にワーズワースで待ってるよ！遅刻だけはダメだからね！', tag: 'day1-assembly' },
    { time: [3, 19, 12, 30], title: 'お腹すいたー！ごはん！', body: 'もうすぐイタリアンだよ！12:40〜ワーズワースに全員集合！くまさんの分も食べてきてね…', tag: 'day1-lunch' },
    { time: [3, 19, 14, 55], title: 'そろそろホテルだよ〜！', body: '15:00からチェックインできるよ！17:15までにKAGURAへGO！荷物おろしてゆっくりしてね〜', tag: 'day1-checkin' },
    { time: [3, 19, 15, 45], title: 'そろそろ自由行動の時間！', body: '申し込んだ人は和菓子作り体験が16:00〜岩立本店ではじまるよ！それ以外の人はまったり過ごしてね', tag: 'day1-wagashi' },
    { time: [3, 19, 17, 15], title: 'ぜったい来てね！夕ごはん！', body: '17:30〜ホテルで夕食だよ！立澤さんも一緒！みんなで楽しく食べよう！くまさんは山でどんぐり食べてるよ…', tag: 'day1-dinner' },

    // === Day 2: 3/20 (Fri) ===
    { time: [3, 20, 7, 45],  title: 'おはよう！朝だよ！', body: 'ぐっすり眠れた？朝ごはんは8:00/8:30/9:00から選べるよ！10:00までだから寝すぎ注意だよ！', tag: 'day2-breakfast' },
    { time: [3, 20, 9, 45],  title: 'そろそろ午前の時間だよ！', body: '香取神宮に行く人は10:00集合でタクシー相乗り！お部屋でゆっくり派もいい朝を過ごしてね', tag: 'day2-shrine' },
    { time: [3, 20, 11, 45], title: 'そろそろお片付け！', body: '12:00チェックアウトだよ！忘れ物ないかな？荷物はホテルに預けられるから安心してね', tag: 'day2-checkout' },
    { time: [3, 20, 13, 45], title: '午後の時間だよ！', body: '申し込んだ人はアクティビティが14:00〜はじまるよ！自由に過ごす人も佐原を楽しんでね', tag: 'day2-activity1' },
    { time: [3, 20, 15, 50], title: 'みんなで振り返り！', body: '16:00〜いなえで中締めだよ！参加できる人はぜひ！楽しかった思い出をみんなで語ろう', tag: 'day2-closing' },
    { time: [3, 20, 17, 20], title: 'おつかれさま！楽しかったね！', body: 'くまさんからありがとう！みんなと過ごせて最高だったよ！バス組は17:42発だから気をつけて帰ってね！', tag: 'day2-bus' },
  ];

  // Test schedule: built lazily when enable() is called so offsets are fresh
  const TEST_ITEMS = [
    { delaySeconds: 5,  title: '[TEST] 集合20分前！', body: 'テスト通知 (5秒後)', tag: 'test-1' },
    { delaySeconds: 15, title: '[TEST] まもなく昼ごはん', body: 'テスト通知 (15秒後)', tag: 'test-2' },
    { delaySeconds: 30, title: '[TEST] 全員集合！夕ごはん', body: 'テスト通知 (30秒後)', tag: 'test-3' },
  ];

  const SCHEDULE = TEST_MODE ? [] : PROD_SCHEDULE;

  const STORAGE_KEY = TEST_MODE ? 'trip_notif_enabled_test' : 'trip_notif_enabled';
  const SENT_KEY = TEST_MODE ? 'trip_notif_sent_test' : 'trip_notif_sent';
  let pendingTimers = [];

  // In test mode, always clear previous test state
  if (TEST_MODE) {
    storageRemove(SENT_KEY);
    storageRemove(STORAGE_KEY);
  }

  // Safe localStorage wrapper (iOS private browsing may throw)
  function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function storageSet(key, val) {
    try { localStorage.setItem(key, val); } catch { /* ignore */ }
  }
  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }

  function isEnabled() {
    return storageGet(STORAGE_KEY) === 'true';
  }

  function setEnabled(val) {
    storageSet(STORAGE_KEY, val ? 'true' : 'false');
  }

  function getSentSet() {
    try {
      return new Set(JSON.parse(storageGet(SENT_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function markSent(tag) {
    const sent = getSentSet();
    sent.add(tag);
    storageSet(SENT_KEY, JSON.stringify([...sent]));
  }

  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  // Debug log to test panel
  function debugLog(msg) {
    if (!TEST_MODE) return;
    console.log('[TripNotif]', msg);
    const el = document.getElementById('test-debug-log');
    if (el) {
      const ts = new Date().toLocaleTimeString('ja-JP');
      el.textContent += `[${ts}] ${msg}\n`;
      el.scrollTop = el.scrollHeight;
    }
  }

  async function sendNotification(item) {
    try {
      debugLog(`sendNotification: "${item.title}"`);
      const reg = await navigator.serviceWorker.ready;
      debugLog(`SW ready, active=${!!reg.active}`);
      if (!reg.active) {
        debugLog('ERROR: SW not active');
        return;
      }
      reg.active.postMessage({
        type: 'SHOW_NOTIFICATION',
        title: item.title,
        body: item.body,
        tag: item.tag
      });
      debugLog('postMessage sent OK');
    } catch (e) {
      debugLog(`ERROR sendNotification: ${e.message}`);
    }
  }

  // Schedule timers only for upcoming notifications (no polling)
  function scheduleTimers() {
    clearTimers();
    if (!isEnabled()) return;

    if (TEST_MODE) {
      // Test mode: use direct second-based delays (no minute rounding)
      const sent = getSentSet();
      debugLog(`scheduleTimers: ${TEST_ITEMS.length} items, sent=${[...sent].join(',')}`);
      for (const item of TEST_ITEMS) {
        if (sent.has(item.tag)) {
          debugLog(`skip ${item.tag} (already sent)`);
          continue;
        }
        debugLog(`timer set: ${item.tag} in ${item.delaySeconds}s`);
        const timer = setTimeout(() => {
          if (!isEnabled()) { debugLog('timer fired but disabled'); return; }
          debugLog(`timer FIRED: ${item.tag}`);
          sendNotification(item);
          markSent(item.tag);
          updateTestPanel();
        }, item.delaySeconds * 1000);
        pendingTimers.push(timer);
      }
      return;
    }

    const now = Date.now();
    const sent = getSentSet();
    const year = 2026;
    const graceWindow = 5 * 60 * 1000;

    for (const item of SCHEDULE) {
      if (sent.has(item.tag)) continue;
      const [month, day, hour, minute] = item.time;
      const target = new Date(year, month - 1, day, hour, minute, 0).getTime();
      const delay = target - now;

      if (delay < -graceWindow) continue;

      if (delay <= 0) {
        sendNotification(item);
        markSent(item.tag);
        continue;
      }

      const timer = setTimeout(() => {
        if (!isEnabled()) return;
        sendNotification(item);
        markSent(item.tag);
      }, delay);
      pendingTimers.push(timer);
    }
  }

  function clearTimers() {
    for (const t of pendingTimers) clearTimeout(t);
    pendingTimers = [];
  }

  function start() {
    scheduleTimers();
  }

  function stop() {
    clearTimers();
  }

  // Convert VAPID public key for PushManager.subscribe()
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
  }

  // Subscribe to Web Push via the Cloudflare Worker
  async function subscribePush() {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) {
      debugLog('pushManager not available (not PWA or unsupported browser)');
      return null;
    }
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // Send subscription to Worker for server-side push
    await fetch(`${PUSH_WORKER_URL}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    });
    return subscription;
  }

  // Unsubscribe from Web Push
  async function unsubscribePush() {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.pushManager) return;
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      // Remove from Worker
      await fetch(`${PUSH_WORKER_URL}/subscribe`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe();
    }
  }

  async function enable() {
    debugLog('enable() called');
    debugLog(`Notification API: ${'Notification' in window}`);
    debugLog(`Permission: ${typeof Notification !== 'undefined' ? Notification.permission : 'N/A'}`);
    debugLog(`SW support: ${'serviceWorker' in navigator}`);
    const granted = await requestPermission();
    debugLog(`Permission granted: ${granted}`);
    if (!granted) return false;
    try {
      await subscribePush();
      debugLog('subscribePush OK');
    } catch (e) {
      debugLog(`subscribePush FAILED: ${e.message}`);
    }
    setEnabled(true);
    debugLog('enabled=true, calling start()');
    start(); // Local timers as fallback
    return true;
  }

  async function disable() {
    setEnabled(false);
    stop();
    try {
      await unsubscribePush();
    } catch (e) {
      console.warn('Web Push unsubscribe failed:', e);
    }
  }

  // Re-schedule local timers when the app returns to foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isEnabled()) {
      scheduleTimers();
    }
  });

  // Auto-start if previously enabled
  if (isEnabled() && 'Notification' in window && Notification.permission === 'granted') {
    start();
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true;
  }

  // Update test panel status (called from timer callbacks)
  function updateTestPanel() {
    const panel = document.getElementById('test-panel-log');
    if (!panel) return;
    const sent = getSentSet();
    const items = TEST_MODE ? TEST_ITEMS : SCHEDULE;
    const lines = items.map(item => {
      const done = sent.has(item.tag);
      return `${done ? '[DONE]' : '[WAIT]'} ${item.title}`;
    });
    panel.textContent = lines.join('\n');
  }

  return { enable, disable, isEnabled, requestPermission, isIOS, isStandalone, isTestMode: () => TEST_MODE, SCHEDULE, TEST_ITEMS, getSentSet, updateTestPanel };
})();

document.addEventListener('DOMContentLoaded', () => {

  // Notification Toggle UI
  const notifBtn = document.getElementById('notif-toggle');
  const notifStatus = document.getElementById('notif-status');
  const notifIOSHint = document.getElementById('notif-ios-hint');
  if (notifBtn) {
    // Show iOS "Add to Home Screen" hint if needed
    if (notifIOSHint && TripNotifications.isIOS() && !TripNotifications.isStandalone()) {
      notifIOSHint.style.display = 'block';
    }

    function updateNotifUI() {
      const enabled = TripNotifications.isEnabled();
      const supported = 'Notification' in window;
      const denied = supported && Notification.permission === 'denied';

      if (!supported) {
        notifBtn.textContent = '通知に非対応です';
        notifBtn.disabled = true;
        notifBtn.classList.remove('active');
        if (notifStatus) notifStatus.textContent = TripNotifications.isIOS()
          ? 'ホーム画面に追加してから再度お試しください'
          : 'このブラウザでは通知を利用できません';
      } else if (denied) {
        notifBtn.textContent = '通知がブロックされています';
        notifBtn.disabled = true;
        notifBtn.classList.remove('active');
        if (notifStatus) notifStatus.textContent = 'ブラウザの設定から通知を許可してください';
      } else if (enabled) {
        notifBtn.textContent = '通知をオフにする';
        notifBtn.classList.add('active');
        if (notifStatus) notifStatus.textContent = '旅行中、各イベント前にリマインダーが届きます';
      } else {
        notifBtn.textContent = '通知をオンにする';
        notifBtn.classList.remove('active');
        if (notifStatus) notifStatus.textContent = '';
      }
    }

    notifBtn.addEventListener('click', async () => {
      if (TripNotifications.isEnabled()) {
        await TripNotifications.disable();
        // Re-show card
        notifBtn.closest('.notif-card').classList.remove('notif-collapsed');
      } else {
        const ok = await TripNotifications.enable();
        if (ok) {
          // Collapse the card after a brief delay so user sees the confirmation
          setTimeout(() => {
            notifBtn.closest('.notif-card').classList.add('notif-collapsed');
          }, 1200);
        }
        if (!ok && 'Notification' in window && Notification.permission === 'denied') {
          // permission denied
        }
      }
      updateNotifUI();
      if (TEST_MODE) TripNotifications.updateTestPanel();
    });

    updateNotifUI();

    // If already enabled on load, collapse the card immediately (no animation)
    if (TripNotifications.isEnabled()) {
      const card = notifBtn.closest('.notif-card');
      card.style.transition = 'none';
      card.classList.add('notif-collapsed');
      // Re-enable transition after layout
      requestAnimationFrame(() => { card.style.transition = ''; });
    }
  }

  // Test Mode Panel
  const testPanel = document.getElementById('test-panel');
  if (TEST_MODE && testPanel) {
    testPanel.style.display = 'block';

    // Worker Push test button
    const testWorkerBtn = document.getElementById('test-worker-push');
    const testWorkerStatus = document.getElementById('test-worker-status');
    if (testWorkerBtn) {
      testWorkerBtn.addEventListener('click', async () => {
        testWorkerStatus.textContent = '送信中...';
        testWorkerStatus.style.color = 'var(--text-light)';
        try {
          const reg = await navigator.serviceWorker.ready;
          if (!reg.pushManager) {
            testWorkerStatus.textContent = 'PWAモード（ホーム画面追加）でのみ利用可能です';
            testWorkerStatus.style.color = 'var(--accent-red)';
            return;
          }
          const subscription = await reg.pushManager.getSubscription();
          if (!subscription) {
            testWorkerStatus.textContent = '先に「通知をオンにする」を押してください';
            testWorkerStatus.style.color = 'var(--accent-red)';
            return;
          }
          const res = await fetch(`${PUSH_WORKER_URL}/test-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscription: subscription.toJSON(),
              title: '[TEST] Worker Push',
              body: 'Cloudflare Worker経由の通知テスト成功！',
            }),
          });
          const data = await res.json();
          if (data.ok) {
            testWorkerStatus.textContent = 'Push送信成功！通知が届くはずです';
            testWorkerStatus.style.color = 'var(--accent-green)';
          } else {
            testWorkerStatus.textContent = `Push送信失敗 (status: ${data.status})`;
            testWorkerStatus.style.color = 'var(--accent-red)';
          }
        } catch (e) {
          testWorkerStatus.textContent = `エラー: ${e.message}`;
          testWorkerStatus.style.color = 'var(--accent-red)';
        }
      });
    }
  }

  // Tab Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const timelines = document.querySelectorAll('.timeline');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active from all tabs
      tabBtns.forEach(t => t.classList.remove('active'));
      // Hide all timelines
      timelines.forEach(t => t.classList.add('hidden'));

      // Add active to clicked tab
      btn.classList.add('active');

      // Show target timeline
      const targetId = btn.getAttribute('data-target');
      document.getElementById(targetId).classList.remove('hidden');
    });
  });

  // Floating Bear Scrolling Logic
  const mascot = document.getElementById('mascot');
  const messageBubble = document.getElementById('bear-message');

  const messages = [
    "おおっ！山がたくさん！🐻",
    "お弁当はまだかな？🍱",
    "遅刻しちゃダメだよ！⏰",
    "発酵ってなんだろう？🍶",
    "スクロール楽しいね！🎢",
    "一緒に歩こう！🐾",
  ];

  let lastScrollTop = 0;

  window.addEventListener('scroll', () => {
    const scrollTop = (window.scrollY ?? window.pageYOffset ?? 0);

    // Hide mascot if scrolling up very fast, reveal when scrolling down
    // (Optional - right now just keeping it visible and wiggling)

    // Change speech bubble occasionally based on scroll amount
    if (Math.abs(scrollTop - lastScrollTop) > document.body.scrollHeight / 8) {
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      messageBubble.textContent = randomMsg;
      lastScrollTop = scrollTop;

      // Add a slight bounce to the mascot (use class to avoid breaking CSS animation)
      mascot.classList.add('bear-bounce');
      setTimeout(() => {
        mascot.classList.remove('bear-bounce');
      }, 400);
    }

    // Hide bear near the bottom so it doesn't overlap the footer bear
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 150) {
      mascot.classList.add('hide');
    } else {
      mascot.classList.remove('hide');
    }
  });

  // Kuroko Animation
  const kuroko = document.getElementById('kuroko');
  const sections = document.querySelectorAll('.section');
  if (kuroko && sections.length > 0) {
    let kurokoScrollAccumulator = 0;
    let lastKurokoScroll = (window.scrollY ?? window.pageYOffset ?? 0);
    let kurokoIsPeeking = false;
    let kurokoTimeout;
    let debounceScroll;

    window.addEventListener('scroll', () => {
      const currentScroll = (window.scrollY ?? window.pageYOffset ?? 0);
      const delta = Math.abs(currentScroll - lastKurokoScroll);
      kurokoScrollAccumulator += delta;
      lastKurokoScroll = currentScroll;

      // When we've scrolled enough, wait for the scroll to slow down/stop before popping
      if (kurokoScrollAccumulator > 350 && !kurokoIsPeeking) {
        clearTimeout(debounceScroll);

        debounceScroll = setTimeout(() => {
          if (kurokoIsPeeking) return;
          kurokoScrollAccumulator = 0;

          // Find visible sections focused in the middle of the screen
          const visibleSections = Array.from(sections).filter(sec => {
            const rect = sec.getBoundingClientRect();
            // Ensure section is well within the viewport so the user can easily see it
            return rect.top < window.innerHeight * 0.8 && rect.bottom > window.innerHeight * 0.2;
          });

          if (visibleSections.length > 0) {
            const targetSection = visibleSections[Math.floor(Math.random() * visibleSections.length)];
            const rect = targetSection.getBoundingClientRect();

            // Absolute document coordinates calculation
            const scrollX = window.scrollX ?? window.pageXOffset ?? 0;
            const scrollY = (window.scrollY ?? window.pageYOffset ?? 0) || 0;

            // Pick random direction: 0(left), 1(right), 2(top), 3(bottom)
            // Weight left and right slightly higher for better aesthetics
            const rand = Math.random();
            let direction = 0; // left
            if (rand > 0.35 && rand <= 0.7) direction = 1; // right
            else if (rand > 0.7 && rand <= 0.85) direction = 2; // top
            else if (rand > 0.85) direction = 3; // bottom

            kuroko.className = 'kuroko-link'; // reset classes

            if (direction === 0) { // left
              const randomY = Math.max(0, rect.height - 100);
              kuroko.style.top = (scrollY + rect.top + Math.random() * randomY) + 'px';
              kuroko.style.left = (scrollX + rect.left + 5) + 'px';
              kuroko.classList.add('k-left');
            } else if (direction === 1) { // right
              const randomY = Math.max(0, rect.height - 100);
              kuroko.style.top = (scrollY + rect.top + Math.random() * randomY) + 'px';
              kuroko.style.left = (scrollX + rect.right - 90 - 5) + 'px';
              kuroko.classList.add('k-right');
            } else if (direction === 2) { // top
              const randomX = Math.max(0, rect.width - 90);
              kuroko.style.left = (scrollX + rect.left + Math.random() * randomX) + 'px';
              kuroko.style.top = (scrollY + rect.top + 5) + 'px';
              kuroko.classList.add('k-top');
            } else { // bottom
              const randomX = Math.max(0, rect.width - 90);
              kuroko.style.left = (scrollX + rect.left + Math.random() * randomX) + 'px';
              kuroko.style.top = (scrollY + rect.bottom - 100 - 5) + 'px';
              kuroko.classList.add('k-bottom');
            }

            // Force layout recalculation
            void kuroko.offsetWidth;

            // Peek
            kuroko.classList.add('peek');
            kurokoIsPeeking = true;

            // Keep it out a bit longer so it's easier to hit
            clearTimeout(kurokoTimeout);
            kurokoTimeout = setTimeout(() => {
              kuroko.classList.remove('peek');
              setTimeout(() => {
                kurokoIsPeeking = false;
              }, 400); // Wait for CSS transition
            }, 2500); // Increased visibility time to 2.5 seconds
          }
        }, 150); // wait 150ms after scrolling stops/slows before showing
      }
    });
  }

  // Clean up old localStorage test flag (migrated to sessionStorage)
  try { localStorage.removeItem('trip_test_mode'); } catch {}

  // Hidden gesture: tap footer bear 5 times to toggle test mode (session-only)
  const footerBear = document.querySelector('.site-footer img');
  if (footerBear) {
    let tapCount = 0;
    let tapTimer;
    footerBear.addEventListener('click', (e) => {
      e.preventDefault();
      tapCount++;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapCount = 0; }, 2000);
      if (tapCount >= 5) {
        tapCount = 0;
        try {
          const current = sessionStorage.getItem('trip_test_mode') === 'true';
          sessionStorage.setItem('trip_test_mode', current ? 'false' : 'true');
          alert(current ? 'テストモード OFF — リロードします' : 'テストモード ON — リロードします');
          location.reload();
        } catch {}
      }
    });
  }

});
