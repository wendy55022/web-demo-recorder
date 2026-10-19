// node --test test/  （不開瀏覽器，只測純邏輯）
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadJob, buildSequence } = require('../record.cjs');

test('buildSequence：固定 30fps，每格放當下最新畫面，總長＝最後一格＋停止前的時間', () => {
  // 曾經的 bug：concat 會把很短的畫格撐長，15.8 秒變 19.6 秒；這裡確認總格數對得上真實時間
  const frames = [
    { file: 'a', ts: 100.0, wall: 1000.0 },
    { file: 'b', ts: 100.01, wall: 1000.01 }, // 比 1/30 秒還短的畫格
    { file: 'c', ts: 100.02, wall: 1000.02 },
    { file: 'd', ts: 102.0, wall: 1002.0 },
  ];
  const { seq, total } = buildSequence(frames, 1003.0, 30);
  assert.ok(Math.abs(total - 3.0) < 1e-6);
  assert.strictEqual(seq.length, 90);
  assert.strictEqual(seq[0], 'a');
  assert.strictEqual(seq[1], 'c'); // 1/30 秒時 b、c 都已出現，用最新的 c
  assert.strictEqual(seq[59], 'c');
  assert.strictEqual(seq[60], 'd');
  assert.strictEqual(seq[89], 'd');
});

test('buildSequence：少於 2 格要報錯', () => {
  assert.throws(() => buildSequence([{ file: 'a', ts: 1, wall: 1 }], 2, 30), /只錄到 1 格/);
});

test('loadJob：預設 phone、相對路徑的 html 轉成 file 網址、viewport 寫錯要報錯', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wdr-test-'));
  fs.writeFileSync(path.join(dir, 'p.html'), '<p>x</p>');
  const f = path.join(dir, 'job.json');
  fs.writeFileSync(f, JSON.stringify({ url: 'p.html' }));
  const job = loadJob(f);
  assert.strictEqual(job.vp.scale, 3);
  assert.match(job.url, /^file:\/\/\/.*p\.html$/);
  assert.strictEqual(job.name, 'job');
  fs.writeFileSync(f, JSON.stringify({ url: 'https://example.com', viewport: 'tablet' }));
  assert.throws(() => loadJob(f), /viewport 只能是/);
  fs.writeFileSync(f, JSON.stringify({ url: 'nope.html' }));
  assert.throws(() => loadJob(f), /找不到本機檔案/);
  fs.rmSync(dir, { recursive: true, force: true }); // 測試自己建的暫存資料夾自己清
});
