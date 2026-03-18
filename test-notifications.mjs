#!/usr/bin/env node
// ============================================
// 通知スケジュールの整合性テスト
// Usage: node test-notifications.mjs
// ============================================

import { readFileSync } from 'fs';

let passed = 0;
let failed = 0;

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

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ---- Parse source files ----

const scriptJs = readFileSync('script.js', 'utf-8');
const workerJs = readFileSync('worker/src/index.js', 'utf-8');
const wranglerToml = readFileSync('worker/wrangler.toml', 'utf-8');

// Extract PROD_SCHEDULE from script.js
const prodScheduleMatch = scriptJs.match(/const PROD_SCHEDULE = \[([\s\S]*?)\];/);
const scheduleEntries = [...prodScheduleMatch[1].matchAll(
  /\{\s*time:\s*\[(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\],\s*title:\s*'([^']*)',\s*body:\s*'([^']*)',\s*tag:\s*'([^']*)'\s*\}/g
)].map(m => ({
  time: [+m[1], +m[2], +m[3], +m[4]],
  title: m[5],
  body: m[6],
  tag: m[7],
}));

// Extract SCHEDULE_MAP from worker
const workerMapMatch = workerJs.match(/const SCHEDULE_MAP = \{([\s\S]*?)\};/);
const workerEntries = [...workerMapMatch[1].matchAll(
  /'(\d{2}:\d{2}-\d+-\d+)':\s*\{\s*title:\s*'([^']*)',\s*body:\s*'([^']*)'\s*\}/g
)].map(m => ({
  key: m[1],
  title: m[2],
  body: m[3],
}));

// Extract cron expressions from wrangler.toml
const cronMatches = [...wranglerToml.matchAll(/"(\d+ \d+ \d+ \d+ \*)"/g)].map(m => m[1]);

// ---- Helper: JST [month, day, hour, minute] → UTC key "HH:MM-DD-M" ----
function jstToUtcKey(time) {
  const [month, day, hour, minute] = time;
  // Create JST date and convert to UTC
  const jst = new Date(2026, month - 1, day, hour, minute, 0);
  const utcMs = jst.getTime() - 9 * 60 * 60 * 1000; // JST = UTC+9
  const utc = new Date(utcMs);
  const hh = String(utc.getUTCHours()).padStart(2, '0');
  const mm = String(utc.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}-${utc.getUTCDate()}-${utc.getUTCMonth() + 1}`;
}

// Helper: JST time → cron expression "MM HH DD M *"
function jstToCron(time) {
  const [month, day, hour, minute] = time;
  const jst = new Date(2026, month - 1, day, hour, minute, 0);
  const utcMs = jst.getTime() - 9 * 60 * 60 * 1000;
  const utc = new Date(utcMs);
  return `${utc.getUTCMinutes()} ${utc.getUTCHours()} ${utc.getUTCDate()} ${utc.getUTCMonth() + 1} *`;
}

// ============================================
console.log('\n🔔 通知スケジュール整合性テスト\n');

// ---- 1. 基本構造 ----
console.log('【1】基本構造');

test('script.js: PROD_SCHEDULE が11件ある', () => {
  assert(scheduleEntries.length === 11, `${scheduleEntries.length}件 (期待: 11)`);
});

test('worker: SCHEDULE_MAP が11件ある', () => {
  assert(workerEntries.length === 11, `${workerEntries.length}件 (期待: 11)`);
});

test('wrangler.toml: cron が11件ある', () => {
  assert(cronMatches.length === 11, `${cronMatches.length}件 (期待: 11)`);
});

// ---- 2. JST→UTC変換の一致 ----
console.log('\n【2】JST→UTC変換: script.js ↔ worker SCHEDULE_MAP キー');

for (const entry of scheduleEntries) {
  const utcKey = jstToUtcKey(entry.time);
  test(`${entry.tag}: JST ${entry.time.join(':')} → UTC key ${utcKey}`, () => {
    const found = workerEntries.find(w => w.key === utcKey);
    assert(found, `Worker に UTC key "${utcKey}" が見つからない`);
  });
}

// ---- 3. title/body の一致 ----
console.log('\n【3】通知内容の一致: script.js ↔ worker');

for (const entry of scheduleEntries) {
  const utcKey = jstToUtcKey(entry.time);
  const workerEntry = workerEntries.find(w => w.key === utcKey);
  if (!workerEntry) continue;

  test(`${entry.tag}: title が一致`, () => {
    assert(entry.title === workerEntry.title,
      `client="${entry.title}" vs worker="${workerEntry.title}"`);
  });

  test(`${entry.tag}: body が一致`, () => {
    assert(entry.body === workerEntry.body,
      `\n     client: "${entry.body.slice(0, 40)}..."\n     worker: "${workerEntry.body.slice(0, 40)}..."`);
  });
}

// ---- 4. cron式との一致 ----
console.log('\n【4】Cron式の一致: script.js JST時刻 → wrangler.toml cron');

for (const entry of scheduleEntries) {
  const expectedCron = jstToCron(entry.time);
  test(`${entry.tag}: ${entry.time.join(':')} JST → cron "${expectedCron}"`, () => {
    assert(cronMatches.includes(expectedCron),
      `wrangler.toml に cron "${expectedCron}" が見つからない`);
  });
}

// ---- 5. スケジュール時系列順 ----
console.log('\n【5】時系列順の確認');

test('PROD_SCHEDULE が時系列順に並んでいる', () => {
  for (let i = 1; i < scheduleEntries.length; i++) {
    const prev = scheduleEntries[i - 1].time;
    const curr = scheduleEntries[i].time;
    const prevDate = new Date(2026, prev[0] - 1, prev[1], prev[2], prev[3]);
    const currDate = new Date(2026, curr[0] - 1, curr[1], curr[2], curr[3]);
    assert(currDate > prevDate,
      `${scheduleEntries[i - 1].tag}(${prevDate.toLocaleString()}) >= ${scheduleEntries[i].tag}(${currDate.toLocaleString()})`);
  }
});

// ---- 6. tag の一意性 ----
console.log('\n【6】Tag の一意性');

test('全 tag がユニーク', () => {
  const tags = scheduleEntries.map(e => e.tag);
  const dupes = tags.filter((t, i) => tags.indexOf(t) !== i);
  assert(dupes.length === 0, `重複: ${dupes.join(', ')}`);
});

// ---- 7. 通知時刻の妥当性 ----
console.log('\n【7】通知時刻の妥当性（深夜に鳴らない）');

for (const entry of scheduleEntries) {
  const [, , hour] = entry.time;
  test(`${entry.tag}: ${hour}時 (JST) は常識的な時間帯`, () => {
    assert(hour >= 7 && hour <= 22,
      `${hour}時は深夜/早朝。ユーザーの迷惑になる可能性`);
  });
}

// ---- 8. 通知間隔 ----
console.log('\n【8】通知間隔（連続通知の確認）');

test('同じ日の通知間隔が30分以上ある', () => {
  for (let i = 1; i < scheduleEntries.length; i++) {
    const prev = scheduleEntries[i - 1].time;
    const curr = scheduleEntries[i].time;
    const prevDate = new Date(2026, prev[0] - 1, prev[1], prev[2], prev[3]);
    const currDate = new Date(2026, curr[0] - 1, curr[1], curr[2], curr[3]);
    const diffMin = (currDate - prevDate) / 60000;
    // 同じ日のみチェック
    if (prev[1] === curr[1]) {
      assert(diffMin >= 30,
        `${scheduleEntries[i - 1].tag} → ${scheduleEntries[i].tag}: ${diffMin}分間隔（30分未満）`);
    }
  }
});

// ---- 9. 文面チェック ----
console.log('\n【9】通知文面の品質チェック');

for (const entry of scheduleEntries) {
  test(`${entry.tag}: title が30文字以内 (${entry.title.length}文字)`, () => {
    assert(entry.title.length <= 30,
      `"${entry.title}" は${entry.title.length}文字。通知バナーで切れる可能性`);
  });
}

for (const entry of scheduleEntries) {
  test(`${entry.tag}: body が100文字以内 (${entry.body.length}文字)`, () => {
    assert(entry.body.length <= 100,
      `body ${entry.body.length}文字。Android通知で途切れる可能性`);
  });
}

// ---- 10. Day 1 / Day 2 の日付チェック ----
console.log('\n【10】日付整合性');

test('Day 1 の通知は全て 3/19', () => {
  const day1 = scheduleEntries.filter(e => e.tag.startsWith('day1'));
  for (const e of day1) {
    assert(e.time[1] === 19, `${e.tag} の日付が ${e.time[1]} (期待: 19)`);
  }
});

test('Day 2 の通知は全て 3/20', () => {
  const day2 = scheduleEntries.filter(e => e.tag.startsWith('day2'));
  for (const e of day2) {
    assert(e.time[1] === 20, `${e.tag} の日付が ${e.time[1]} (期待: 20)`);
  }
});

// ---- Summary ----
console.log(`\n${'='.repeat(45)}`);
console.log(`  結果: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(45)}\n`);

process.exit(failed > 0 ? 1 : 0);
