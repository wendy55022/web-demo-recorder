// 網頁操作錄影：照 steps.json 在「全新乾淨」的 Chromium 裡操作網頁，錄成 mp4（借 claude-code-video-toolkit /record-demo 的概念）
// 用法：node record.cjs <steps.json>
// - 一律開新的無痕 context，不連你平常用的 Chrome、不用登入過的 profile → 錄出來沒有你的帳號和個資
// - 錄影用 CDP Page.startScreencast 抓裝置像素畫格：Playwright 內建 recordVideo 只錄 CSS 像素（手機 360×640 補灰邊），字會糊
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// main() 開頭才找（findTool），require 這支檔案跑測試時不用裝 ffmpeg
let FFMPEG = null;
let FFPROBE = null;

/**
 * 找 ffmpeg／ffprobe：環境變數 → PATH → Windows 用 winget 裝的位置（winget 裝完要重開終端機才進 PATH）
 * @param {string} name 'ffmpeg' 或 'ffprobe'
 * @param {string} envKey 指定路徑用的環境變數名
 * @returns {string|null} 執行檔路徑（在 PATH 上就回傳指令名本身）；找不到回 null
 */
function findTool(name, envKey) {
  const fromEnv = process.env[envKey];
  if (fromEnv) return fs.existsSync(fromEnv) ? fromEnv : null;
  const probe = spawnSync(name, ['-version'], { stdio: 'ignore' });
  if (!probe.error && probe.status === 0) return name;
  const pkgs = process.platform === 'win32' && process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : null;
  if (!pkgs || !fs.existsSync(pkgs)) return null;
  for (const pkg of fs.readdirSync(pkgs).filter((d) => /^Gyan\.FFmpeg/i.test(d))) {
    for (const sub of fs.readdirSync(path.join(pkgs, pkg))) {
      const exe = path.join(pkgs, pkg, sub, 'bin', `${name}.exe`);
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}

/** 輸出尺寸：phone＝1080×1920 直式（Reels 用），desktop＝1920×1080 */
const VIEWPORTS = {
  phone: { w: 360, h: 640, scale: 3, mobile: true, cursor: 16 },
  desktop: { w: 1920, h: 1080, scale: 1, mobile: false, cursor: 24 },
};

const FPS = 30;
const JPEG_QUALITY = 92;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toLocaleTimeString('zh-TW', { hour12: false })}] ${msg}`);

class StepError extends Error {}

function loadPlaywright() {
  try { return require('playwright'); } catch (e) {
    throw new Error(`找不到 Playwright（${e.message.split('\n')[0]}）\n請在這個資料夾執行 npm install，再執行 npx playwright install chromium`);
  }
}

/** 讀 steps.json，補預設值、檢查格式 */
function loadJob(file) {
  let job;
  try { job = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { throw new Error(`讀不了 ${file}：${e.message}`); }
  if (!job.url) throw new Error('steps.json 少了 url（一開始要打開的網址）');
  if (!Array.isArray(job.steps)) job.steps = [];
  const vp = typeof job.viewport === 'object' && job.viewport
    ? { w: job.viewport.w, h: job.viewport.h, scale: job.viewport.scale || 1, mobile: !!job.viewport.mobile, cursor: job.viewport.cursor || 20 }
    : VIEWPORTS[job.viewport || 'phone'];
  if (!vp || !vp.w || !vp.h) throw new Error(`viewport 只能是 "phone"、"desktop" 或 {"w":寬,"h":高,"scale":倍數}，收到 ${JSON.stringify(job.viewport)}`);
  if (!/^(https?|file):/i.test(job.url)) {
    const local = path.resolve(path.dirname(file), job.url);
    if (!fs.existsSync(local)) throw new Error(`url 不是網址，也找不到本機檔案：${local}`);
    job.url = require('url').pathToFileURL(local).href;
  }
  const name = String(job.name || path.basename(file, path.extname(file))).replace(/[\\/:*?"<>|]/g, '_');
  const outDir = path.resolve(path.dirname(file), job.out || path.join(__dirname, 'out'));
  return { ...job, name, vp, outDir, blur: Array.isArray(job.blur) ? job.blur : [] };
}

/** 注入頁面：橘色游標圓點、點擊波紋、blur 遮罩。每次換頁都會重新注入 */
function overlayScript({ size, blur }) {
  /* eslint-disable no-undef */
  const fn = (cfg) => {
    if (window.__wdr) return;
    window.__wdr = true;
    const s = cfg.size;
    const css = `#__wdr_cursor{position:fixed;left:0;top:0;width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;border-radius:50%;
background:rgba(255,136,0,.88);border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 6px rgba(0,0,0,.35);
pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s;transform:translate(-200px,-200px)}
.__wdr_ripple{position:fixed;left:0;top:0;width:${s}px;height:${s}px;margin:${-s / 2}px 0 0 ${-s / 2}px;border-radius:50%;
border:3px solid rgba(255,136,0,.95);pointer-events:none;z-index:2147483646;animation:__wdr_r .6s ease-out forwards}
@keyframes __wdr_r{from{opacity:1;scale:1}to{opacity:0;scale:3.4}}`;
    let cursor = null;
    const mount = () => {
      const root = document.documentElement;
      if (!root) { requestAnimationFrame(mount); return; }
      const st = document.createElement('style');
      st.textContent = css;
      root.appendChild(st);
      // blur：無效的 selector 跳過，不讓整段 CSS 失效
      const ok = cfg.blur.filter((sel) => { try { document.querySelector(sel); return true; } catch { return false; } });
      if (ok.length) {
        const bs = document.createElement('style');
        bs.textContent = `${ok.join(',')}{filter:blur(10px)!important}`;
        root.appendChild(bs);
      }
      window.__wdrBadBlur = cfg.blur.filter((sel) => !ok.includes(sel));
      cursor = document.createElement('div');
      cursor.id = '__wdr_cursor';
      root.appendChild(cursor);
    };
    mount();
    document.addEventListener('mousemove', (e) => {
      if (!cursor) return;
      cursor.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
      cursor.style.opacity = '1';
    }, true);
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.className = '__wdr_ripple';
      r.style.transform = `translate(${e.clientX}px,${e.clientY}px)`;
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
  };
  return `(${fn.toString()})(${JSON.stringify({ size, blur })});`;
}

/** 關掉常見的 cookie 同意提示（只在主頁面，不含 iframe 裡的） */
async function dismissCookieBanner(page) {
  return page.evaluate(() => {
    const WORDS = ['全部接受', '接受全部', '接受所有', '接受所有 Cookie', '同意並繼續', '我同意', '同意', '接受', '我知道了',
      'Accept all', 'Accept All', 'Accept all cookies', 'Allow all', 'I agree', 'Agree', 'Accept', 'Got it', 'OK'];
    const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const COOKIE_RE = /cookie|consent|gdpr|cmp|隱私|個人資料/i;
    const roots = [...document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[id*=gdpr i],[class*=gdpr i],[aria-label*=cookie i],[role=dialog],[role=alertdialog]')]
      .filter((r) => visible(r) && (r.matches('[role=dialog],[role=alertdialog]') ? COOKIE_RE.test(r.innerText || '') : true));
    for (const r of roots) {
      const btns = [...r.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].filter(visible);
      for (const w of WORDS) {
        const b = btns.find((x) => (x.innerText || x.value || '').trim().toLowerCase() === w.toLowerCase());
        if (b) { b.click(); return w; }
      }
    }
    return null;
  });
}

/** CDP 錄影：只在內容有變時送畫格，每格記時間，最後排成固定 30fps 組片 */
class Screencast {
  constructor(page, ctx, tmpDir, maxW, maxH) {
    Object.assign(this, { page, ctx, tmpDir, maxW, maxH });
    this.frames = []; // { file, ts }
  }

  async start() {
    this.cdp = await this.ctx.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = path.join(this.tmpDir, `f${String(this.frames.length).padStart(6, '0')}.jpg`);
      this.frames.push({ file, ts: metadata.timestamp, wall: Date.now() / 1000 });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: JPEG_QUALITY, maxWidth: this.maxW, maxHeight: this.maxH, everyNthFrame: 1 });
  }

  async stop() {
    this.stopWall = Date.now() / 1000;
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await sleep(200);
  }

  /**
   * 排成固定 30fps：每個輸出格放「那個時間點最新的一格」。
   * 不用 ffmpeg concat＋duration：畫格比 1/25 秒短時 concat 會把它撐長（實測清單合計 15.8 秒、輸出變 19.6 秒）
   */
  timeline() {
    return buildSequence(this.frames, this.stopWall, FPS);
  }
}

/** 純函式：畫格（ts＝畫面時間、wall＝收到時間）→ 每個輸出格要用哪個檔＋總長 */
function buildSequence(frames, stopWall, fps) {
  if (frames.length < 2) throw new Error(`只錄到 ${frames.length} 格畫面，沒辦法組成影片`);
  const t0 = frames[0].ts;
  const rel = frames.map((f) => f.ts - t0);
  const total = rel[rel.length - 1] + Math.max(1 / fps, stopWall - frames[frames.length - 1].wall);
  const n = Math.max(1, Math.round(total * fps));
  const seq = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    while (j + 1 < rel.length && rel[j + 1] <= t + 1e-6) j++;
    seq.push(frames[j].file);
  }
  return { seq, total };
}

/** 把畫格依序用管線餵給 ffmpeg（image2pipe 固定 30fps），轉 H.264 */
function encode(seq, outMp4, outW, outH) {
  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-vf', `scale=${outW}:${outH}:force_original_aspect_ratio=decrease:flags=lanczos:in_range=pc:out_range=tv,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:white,format=yuv420p`,
      '-r', String(FPS), '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-movflags', '+faststart', outMp4]);
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', (e) => reject(new Error(`轉 mp4：執行 ffmpeg 失敗（${e.message}）`)));
    ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`轉 mp4 失敗：${err.slice(-800)}`))));
    ff.stdin.on('error', () => {}); // ffmpeg 先掛掉時，錯誤由 close 回報
    (async () => {
      const cache = new Map();
      for (const f of seq) {
        let buf = cache.get(f);
        if (!buf) { buf = fs.readFileSync(f); cache.clear(); cache.set(f, buf); }
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      ff.stdin.end();
    })().catch(reject);
  });
}

function runFF(bin, args, what) {
  const r = spawnSync(bin, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${what}：執行 ${path.basename(bin)} 失敗（${r.error.message}）`);
  if (r.status !== 0) throw new Error(`${what}失敗：${(r.stderr || '').slice(-800)}`);
  return r;
}

const even = (n) => Math.round(n / 2) * 2;

/** 定位元素：字串開頭是 # . [ / 或 css= xpath= text= 就當 selector，否則當畫面上的字（先找完全相同，再找包含） */
async function locate(page, target, stepNo, label) {
  let loc;
  let desc;
  if (target && typeof target === 'object') {
    if (target.selector) { loc = page.locator(target.selector); desc = `selector ${target.selector}`; }
    else if (target.text) { loc = page.getByText(target.text, { exact: !!target.exact }); desc = `字「${target.text}」`; }
  } else if (typeof target === 'string') {
    const forced = /^(#|\.|\[|\/|css=|xpath=|text=)/.test(target);
    // 像 CSS 的英文（figure.shot、h1、a[href*=x]）先當 selector 找，找不到再當文字；有中文的直接當文字
    const cssLike = forced || /^[a-z][a-z0-9-]*([.#[:\s>][^　-鿿]*)?$/i.test(target);
    if (cssLike) {
      loc = page.locator(target);
      desc = `selector ${target}`;
      const n = await loc.count().catch(() => 0);
      if (n === 0 && !forced) loc = null;
    }
    if (!loc) {
      loc = page.getByText(target, { exact: true });
      desc = cssLike ? `selector 或字「${target}」` : `字「${target}」`;
      if (await loc.count() === 0) loc = page.getByText(target);
    }
  }
  if (!loc) throw new StepError(`第 ${stepNo} 步（${label}）：要指定文字或 selector`);
  const n = await loc.count();
  if (n === 0) throw new StepError(`第 ${stepNo} 步（${label}）：頁面上找不到${desc}`);
  // 有好幾個就挑第一個看得到的
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible()) return { el, desc };
  }
  throw new StepError(`第 ${stepNo} 步（${label}）：找到 ${n} 個${desc}，但都看不到（被隱藏）`);
}

async function main() {
  const file = process.argv[2];
  if (!file) { console.log('用法：node record.cjs <steps.json>'); process.exit(2); }
  const job = loadJob(path.resolve(file));
  FFMPEG = findTool('ffmpeg', 'WDR_FFMPEG');
  FFPROBE = findTool('ffprobe', 'WDR_FFPROBE');
  if (!FFMPEG || !FFPROBE) {
    throw new Error('找不到 ffmpeg／ffprobe。請先安裝 ffmpeg（Windows：winget install Gyan.FFmpeg；Mac：brew install ffmpeg），或用環境變數 WDR_FFMPEG／WDR_FFPROBE 指定路徑');
  }
  fs.mkdirSync(job.outDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const { vp } = job;
  const outW = even(vp.w * vp.scale);
  const outH = even(vp.h * vp.scale);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `wdr-${job.name}-`));
  const outMp4 = path.join(job.outDir, `${job.name}.mp4`);
  log(`開始：${job.name}（${outW}×${outH}）→ ${outMp4}`);

  const browser = await chromium.launch({ headless: true });
  let ok = false;
  try {
    // 全新無痕 context：沒有任何 cookie、登入、擴充功能
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: vp.scale,
      isMobile: vp.mobile,
      hasTouch: false, // 要用滑鼠事件畫游標
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      userAgent: vp.mobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    await ctx.addInitScript(overlayScript({ size: vp.cursor, blur: job.blur }));
    const page = await ctx.newPage();

    let mouse = { x: Math.round(vp.w * 0.62), y: Math.round(vp.h * 0.72) };
    const showCursor = () => page.mouse.move(mouse.x, mouse.y);
    /** 滑鼠分多步滑過去（看得到移動），easeInOut */
    const glide = async (x, y) => {
      const dist = Math.hypot(x - mouse.x, y - mouse.y);
      const ms = Math.min(900, Math.max(350, dist * 1.6));
      const n = Math.max(8, Math.round(ms / 16));
      const sx = mouse.x; const sy = mouse.y;
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
        await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
        await sleep(16);
      }
      mouse = { x, y };
    };
    /** 平滑捲動 dy（CSS px） */
    const smoothScroll = (dy, ms) => page.evaluate(([d, t]) => new Promise((res) => {
      const y0 = window.scrollY; const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / t);
        const e = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
        window.scrollTo(0, y0 + d * e);
        if (k < 1) requestAnimationFrame(step); else res(window.scrollY);
      };
      requestAnimationFrame(step);
    }), [dy, ms]);
    const scrollMs = (dy, given) => given || Math.min(6000, Math.max(600, Math.abs(dy) * 2)); // 預設每秒約 500 CSS px
    const gotoUrl = async (url) => {
      await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); // 有些站一直有連線，等不到就算了
      const hit = await dismissCookieBanner(page).catch(() => null);
      if (hit) { log(`關掉 cookie 提示（按了「${hit}」）`); await sleep(600); }
      const bad = await page.evaluate(() => window.__wdrBadBlur || []);
      if (bad.length) log(`⚠️ blur 有寫錯的 selector，沒套用：${bad.join('、')}`);
      await showCursor();
    };

    // 先把第一頁載好、cookie 關掉才開始錄 → 片頭不會有白畫面
    await gotoUrl(job.url);
    await sleep(job.startHold ?? 300);
    const rec = new Screencast(page, ctx, tmpDir, outW, outH);
    await rec.start();
    await showCursor();
    await sleep(job.firstHold ?? 1200);

    let curStep = 0;
    try {
      for (let i = 0; i < job.steps.length; i++) {
        const st = job.steps[i];
        const no = i + 1;
        curStep = no;
        const label = JSON.stringify(st);
        log(`第 ${no} 步：${label}`);
        if (st.goto) {
          await gotoUrl(st.goto);
        } else if (st.click !== undefined || st.hover !== undefined) {
          const isClick = st.click !== undefined;
          const { el, desc } = await locate(page, isClick ? st.click : st.hover, no, label);
          await el.scrollIntoViewIfNeeded();
          const box = await el.boundingBox();
          if (!box) throw new StepError(`第 ${no} 步（${label}）：${desc}量不到位置`);
          const x = Math.round(box.x + box.width / 2);
          const y = Math.round(box.y + box.height / 2);
          await glide(x, y);
          if (isClick) {
            // 點下去之前確認最上層是不是它（被別的東西蓋住的話，點到的會是蓋在上面那個）
            const blocker = await el.evaluate((node, [px, py]) => {
              const h = document.elementFromPoint(px, py);
              if (!h || node.contains(h) || h.contains(node)) return null;
              return `${h.tagName.toLowerCase()}${h.id ? `#${h.id}` : ''}${h.className && typeof h.className === 'string' ? `.${h.className.trim().split(/\s+/).join('.')}` : ''}`;
            }, [x, y]);
            if (blocker) throw new StepError(`第 ${no} 步（${label}）：${desc}被 ${blocker} 蓋住，點不到`);
            await sleep(st.before ?? 250);
            await page.mouse.down();
            await sleep(90);
            await page.mouse.up();
          }
          await sleep(st.after ?? (isClick ? 900 : 600));
        } else if (st.type) {
          const t = st.type;
          if (!t.selector || typeof t.text !== 'string') throw new StepError(`第 ${no} 步（${label}）：type 要寫 {"selector": "...", "text": "..."}`);
          const { el } = await locate(page, { selector: t.selector }, no, label);
          await el.scrollIntoViewIfNeeded();
          const box = await el.boundingBox();
          if (box) await glide(Math.round(box.x + Math.min(box.width / 2, 40)), Math.round(box.y + box.height / 2));
          await page.mouse.down(); await sleep(60); await page.mouse.up();
          await page.keyboard.type(t.text, { delay: t.delay ?? 90 });
          await sleep(st.after ?? 600);
        } else if (st.scroll !== undefined) {
          const dy = Number(st.scroll);
          if (!Number.isFinite(dy)) throw new StepError(`第 ${no} 步（${label}）：scroll 要是數字（往下正、往上負，CSS 像素）`);
          await smoothScroll(dy, scrollMs(dy, st.ms));
          await sleep(st.after ?? 300);
        } else if (st.scrollTo !== undefined) {
          const { el, desc } = await locate(page, st.scrollTo, no, label);
          const top = await el.evaluate((n) => n.getBoundingClientRect().top);
          const offset = st.offset ?? Math.round(vp.h * 0.15);
          const dy = Math.round(top - offset);
          log(`  捲到${desc}（${dy > 0 ? '往下' : '往上'} ${Math.abs(dy)}px）`);
          await smoothScroll(dy, scrollMs(dy, st.ms));
          await sleep(st.after ?? 300);
        } else if (st.wait !== undefined) {
          await sleep(Number(st.wait) || 0);
        } else {
          throw new StepError(`第 ${no} 步：看不懂 ${label}（可用 goto、click、hover、type、scroll、scrollTo、wait）`);
        }
      }
      await sleep(job.endHold ?? 1000);
    } catch (e) {
      const shot = path.join(job.outDir, `${job.name}_第${curStep}步_錯誤.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      await rec.stop();
      throw new Error(`${e.message}\n當下畫面存在：${shot}\n（這次沒有輸出影片）`);
    }
    await rec.stop();
    await ctx.close();

    // 組片：依每格實際時間排成 30fps → H.264、yuv420p
    const { seq, total } = rec.timeline();
    log(`錄到 ${rec.frames.length} 格、約 ${total.toFixed(1)} 秒，轉 mp4…`);
    await encode(seq, outMp4, outW, outH);

    // 預覽圖：平均抽 4 格排一排，方便快速檢查
    const dur = parseFloat(runFF(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outMp4], 'ffprobe').stdout) || total;
    const sheet = path.join(job.outDir, `${job.name}_預覽.png`);
    const tileW = vp.w >= vp.h ? 640 : 360;
    const picks = [0.08, 0.36, 0.64, 0.92].map((k) => (dur * k).toFixed(2));
    const inputs = picks.flatMap((t) => ['-ss', t, '-i', outMp4]);
    const fc = picks.map((_, i) => `[${i}:v]scale=${tileW}:-2,trim=end_frame=1[s${i}]`).join(';') + `;${picks.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${picks.length}`;
    runFF(FFMPEG, ['-v', 'error', '-y', ...inputs, '-filter_complex', fc, '-frames:v', '1', sheet], '做預覽圖');
    log(`完成：${outMp4}（${dur.toFixed(1)} 秒）\n預覽圖：${sheet}`);
    ok = true;
  } finally {
    await browser.close().catch(() => {});
    // 暫存畫格是這支程式自己產生的，用完就清（失敗也清，畫格留著沒用）
    if (process.env.WDR_KEEP_TMP) log(`暫存畫格留著（WDR_KEEP_TMP）：${tmpDir}`);
    else try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { log(`⚠️ 暫存資料夾沒清掉：${tmpDir}（${e.message}）`); }
  }
  return ok;
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(`❌ ${e.message}`); process.exit(1); });
}

module.exports = { loadJob, buildSequence, VIEWPORTS };
