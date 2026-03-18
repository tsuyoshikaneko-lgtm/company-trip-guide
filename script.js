// ============================================
// Scheduled Push Notification System
// ============================================

// Worker URL — update after deploying the Cloudflare Worker
const PUSH_WORKER_URL = 'https://trip-push-worker.YOUR_SUBDOMAIN.workers.dev';

// VAPID public key for Web Push subscription
const VAPID_PUBLIC_KEY = 'BBgq9vZBcOV_b0P44gfsU272Y0n1I9UkL6pGXifwaCDiT-0JiDUHbxYnKCeWi3oecUipfWa4ghZKqsfPZEfw4xc';

const TripNotifications = (() => {
  // Trip schedule: [month, day, hour, minute] in JST
  const SCHEDULE = [
    // === Day 1: 3/19 (Thu) ===
    { time: [3, 19, 10, 30], title: '集合20分前！', body: '東京駅バス乗り場に10:50集合です。遅刻注意！', tag: 'day1-assembly' },
    { time: [3, 19, 12, 30], title: 'まもなく昼ごはん', body: '12:40〜 ワーズワース（イタリアン）で全員ランチです', tag: 'day1-lunch' },
    { time: [3, 19, 14, 55], title: 'チェックイン開始', body: '15:00〜17:15の間にホテル(KAGURA)へチェックインしてね', tag: 'day1-checkin' },
    { time: [3, 19, 15, 45], title: '和菓子作り体験15分前', body: '16:00〜 岩立本店で和菓子作り体験スタート！', tag: 'day1-wagashi' },
    { time: [3, 19, 17, 15], title: '全員集合！夕ごはん', body: '17:30〜 ホテルで夕食＋立澤さん。絶対来てね！', tag: 'day1-dinner' },

    // === Day 2: 3/20 (Fri) ===
    { time: [3, 20, 7, 45],  title: 'おはよう！朝ごはん', body: '8:00 / 8:30 / 9:00 から選択。会場は10:00まで', tag: 'day2-breakfast' },
    { time: [3, 20, 9, 45],  title: '香取神宮 集合15分前', body: '10:00集合 タクシー相乗りで向かいます', tag: 'day2-shrine' },
    { time: [3, 20, 11, 45], title: 'チェックアウト準備', body: '12:00チェックアウトです。荷物は預けられます', tag: 'day2-checkout' },
    { time: [3, 20, 13, 45], title: 'アクティビティ準備', body: '14:00〜 酒粕入浴剤づくり / ドレッシング作り体験', tag: 'day2-activity1' },
    { time: [3, 20, 14, 45], title: 'ドレッシング作り15:00の部', body: '15:00〜 醸し処 和ぎ（ホテルから徒歩2分）', tag: 'day2-activity2' },
    { time: [3, 20, 15, 50], title: '中締め・振り返り', body: '16:00〜 いなえにて感想共有タイム！', tag: 'day2-closing' },
    { time: [3, 20, 17, 20], title: 'バスの時間', body: '17:42発 佐原→東京（19:31着）。乗る方はお忘れなく！', tag: 'day2-bus' },
  ];

  const STORAGE_KEY = 'trip_notif_enabled';
  const SENT_KEY = 'trip_notif_sent';
  let pendingTimers = [];

  function isEnabled() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  }

  function setEnabled(val) {
    localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
  }

  function getSentSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SENT_KEY) || '[]'));
    } catch {
      return new Set();
    }
  }

  function markSent(tag) {
    const sent = getSentSet();
    sent.add(tag);
    localStorage.setItem(SENT_KEY, JSON.stringify([...sent]));
  }

  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  }

  async function sendNotification(item) {
    const reg = await navigator.serviceWorker.ready;
    reg.active.postMessage({
      type: 'SHOW_NOTIFICATION',
      title: item.title,
      body: item.body,
      tag: item.tag
    });
  }

  // Schedule timers only for upcoming notifications (no polling)
  function scheduleTimers() {
    clearTimers();
    if (!isEnabled()) return;
    const now = Date.now();
    const sent = getSentSet();

    for (const item of SCHEDULE) {
      if (sent.has(item.tag)) continue;
      const [month, day, hour, minute] = item.time;
      const target = new Date(2026, month - 1, day, hour, minute, 0).getTime();
      const delay = target - now;

      if (delay < -5 * 60 * 1000) {
        // More than 5 min past — skip
        continue;
      }

      if (delay <= 0) {
        // Within the 5-min window — fire immediately
        sendNotification(item);
        markSent(item.tag);
        continue;
      }

      // Future — set a single setTimeout
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
    const granted = await requestPermission();
    if (!granted) return false;
    try {
      await subscribePush();
    } catch (e) {
      console.warn('Web Push subscription failed, falling back to local timers:', e);
    }
    setEnabled(true);
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
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || navigator.standalone === true;
  }

  return { enable, disable, isEnabled, requestPermission, isIOS, isStandalone, SCHEDULE, getSentSet };
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
        TripNotifications.disable();
      } else {
        const ok = await TripNotifications.enable();
        if (!ok && 'Notification' in window && Notification.permission === 'denied') {
          // permission denied
        }
      }
      updateNotifUI();
    });

    updateNotifUI();
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
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    // Hide mascot if scrolling up very fast, reveal when scrolling down
    // (Optional - right now just keeping it visible and wiggling)

    // Change speech bubble occasionally based on scroll amount
    if (Math.abs(scrollTop - lastScrollTop) > document.body.scrollHeight / 8) {
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      messageBubble.textContent = randomMsg;
      lastScrollTop = scrollTop;

      // Add a slight bounce to the mascot
      mascot.style.transform = "scale(1.1) rotate(5deg)";
      setTimeout(() => {
        mascot.style.transform = "scale(0.9) rotate(0deg)";
      }, 300);
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
    let lastKurokoScroll = window.pageYOffset || document.documentElement.scrollTop;
    let kurokoIsPeeking = false;
    let kurokoTimeout;
    let debounceScroll;

    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset || document.documentElement.scrollTop;
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
            const scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
            const scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;

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

});
