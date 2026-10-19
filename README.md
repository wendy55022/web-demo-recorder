# 網頁操作錄影（web-demo-recorder）

中文 ｜ [English](#english)

把「打開網頁 → 捲動 → 點按鈕 → 打字」錄成 mp4，直式 1080×1920 可以直接拿去做 Reels。

**重點：它每次都開一個全新、乾淨的瀏覽器**。沒有登入任何帳號、沒有你的 cookie 和書籤，所以錄出來的畫面不會出現你的個資，不用再一格一格打馬賽克。

- 照你寫的步驟自己操作：開網址、點按鈕、打字、往下捲
- 畫面上有一個橘色圓點當滑鼠，點下去有一圈波紋，看的人知道點了哪裡
- 手機直式 1080×1920（Reels、Shorts 用），也能錄電腦橫式 1920×1080
- 手機版用手機實際的像素在錄（3 倍），字跟截圖一樣清楚

> 概念借自開源專案 [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit)（digitalsamba，MIT 授權）的 `/record-demo`。這裡的程式是重新寫的：改成手機直式、一格一格抓畫面讓字清楚、操作步驟另外寫成步驟檔。

## 安裝

需要：

- [Node.js](https://nodejs.org/) 18 以上
- ffmpeg（Windows：`winget install Gyan.FFmpeg`；Mac：`brew install ffmpeg`）

下載這個專案後，在資料夾裡打：

```
npm install
npx playwright install chromium
```

第二行會下載錄影用的 Chromium 瀏覽器（只要做一次）。

## 怎麼用

1. 寫一個步驟檔（例如 `examples/photocraft_phone.json`）
2. 在這個資料夾打：

```
node record.cjs examples/photocraft_phone.json
```

3. 做好的影片在 `out/`：
   - `out/<名字>.mp4`：影片
   - `out/<名字>_預覽.png`：平均抽 4 格排成一排，用來快速看有沒有錄對

也可以直接跟 Claude Code 說：「用 web-demo-recorder 錄 xxx 網頁，先捲到 OO，再點 XX」，它會幫你寫步驟檔再跑。

## 步驟檔怎麼寫

```json
{
  "name": "photocraft_phone",
  "viewport": "phone",
  "url": "https://wendyai.net/tools/photocraft/",
  "blur": [".email"],
  "steps": [
    { "wait": 800 },
    { "scrollTo": "怎麼開始", "ms": 3500 },
    { "wait": 2000 },
    { "click": "複製" },
    { "type": { "selector": "#q", "text": "要打的字" } },
    { "scroll": 600 }
  ]
}
```

| 欄位 | 意思 |
|---|---|
| `name` | 輸出檔名（不寫就用步驟檔的檔名） |
| `viewport` | `"phone"`＝手機直式，輸出 1080×1920（預設）；`"desktop"`＝電腦，輸出 1920×1080；也可以自訂 `{"w":寬,"h":高,"scale":倍數}` |
| `url` | 一開始打開的網址；也可以寫本機的 html 檔名（相對於步驟檔） |
| `blur` | 要模糊的區塊（CSS selector），用來遮 email、電話這類個資 |
| `out` | 輸出資料夾（不寫就是這個工具的 `out/`） |

### 每一步可以用的動作

| 動作 | 例子 | 說明 |
|---|---|---|
| `wait` | `{"wait": 1500}` | 停 1.5 秒（單位：毫秒） |
| `scroll` | `{"scroll": 600}` | 慢慢往下捲 600 像素；負數往上。`"ms"` 可指定捲多久 |
| `scrollTo` | `{"scrollTo": "怎麼開始"}` | 慢慢捲到那段字（或 selector）出現在畫面上方。`"offset"` 調離頂端多遠 |
| `click` | `{"click": "複製"}` | 游標滑過去、按下去，會出現波紋 |
| `hover` | `{"hover": "h1"}` | 游標滑過去停著，不按 |
| `type` | `{"type": {"selector": "#q", "text": "你好"}}` | 點那個輸入框，一個字一個字打 |
| `goto` | `{"goto": "https://..."}` | 換到另一個網址 |

- `click`、`hover`、`scrollTo` 可以寫**畫面上的字**（例如 `"複製"`），也可以寫 CSS selector（例如 `"figure.shot"`、`"#btn"`）。有中文就當成字來找；像 CSS 的英文會先當 selector 找，找不到再當字找
- `click`、`hover` 可加 `"after": 毫秒`，設定做完要停多久

## 錄出來的樣子

- 橘色圓點是游標，移動時會滑過去，不會瞬移；點下去會有一圈波紋
- 影片從網頁載好之後才開始錄，片頭不會有白畫面
- 30fps、H.264，IG、YouTube 都能直接上傳

## 出錯的時候

- 找不到要點的字或按鈕：會寫是**第幾步**、找不到什麼，並把當下畫面存成 `out/<名字>_第N步_錯誤.png`。這次不會輸出影片
- 要點的東西被別的東西蓋住（例如彈出視窗）：會說被什麼蓋住，不會亂點到別的地方
- `blur` 的 selector 寫錯：會印警告，其他照常錄

## 限制（這版沒做的）

- **要登入的頁面不支援**：因為每次都是乾淨的瀏覽器，沒有登入。要錄後台畫面還是要用別的方式
- **cookie 同意提示**：只會自動關掉主頁面上常見的那種（按「全部接受」「同意」「Accept」這類按鈕）。包在 iframe 裡的（有些大網站是這種）關不掉，要自己加一步 `click`
- 沒有聲音，只有畫面
- 目前只在 Windows 11 測過

## 測試

```
npm test
```

測的是不開瀏覽器的部分：影格排成 30fps 的時間對不對、步驟檔讀取和錯誤訊息。

## 技術備註

- 錄影用 CDP `Page.startScreencast` 抓畫格，再排成固定 30fps 用 ffmpeg 轉 H.264
- 沒用 Playwright 內建的 recordVideo：它只錄 CSS 像素（手機版只有 360×640，其他補灰邊），字會糊
- 沒用 ffmpeg concat 加每格秒數：畫格比 1/25 秒短時會被撐長，實測 15.8 秒的錄影會變成 19.6 秒
- ffmpeg 依序找：環境變數 `WDR_FFMPEG`、`WDR_FFPROBE` → PATH → Windows 用 winget 裝的位置
- 要除錯時設 `WDR_KEEP_TMP=1`，會保留暫存畫格

## 授權

[MIT](LICENSE)

---

<a id="english"></a>

## English

Record a web walkthrough — open a page, scroll, click, type — as an mp4. The default output is vertical 1080×1920, ready for Reels and Shorts.

**Every run starts a brand-new, clean browser.** No logged-in accounts, no cookies, no bookmarks — so your personal data never shows up in the video, and there's nothing to blur afterwards.

- Follows the steps you write: open URLs, click buttons, type, scroll
- An orange dot plays the mouse cursor, with a ripple on every click so viewers can see what was clicked
- Phone portrait 1080×1920, or desktop landscape 1920×1080
- Phone mode records at the device's real pixel ratio (3×), so text is as sharp as a screenshot

> Inspired by `/record-demo` from [claude-code-video-toolkit](https://github.com/digitalsamba/claude-code-video-toolkit) (digitalsamba, MIT). This is a fresh implementation: phone-portrait output, frame-by-frame capture for crisp text, and steps kept in a separate JSON file.

### Install

Requirements:

- [Node.js](https://nodejs.org/) 18+
- ffmpeg (Windows: `winget install Gyan.FFmpeg`; macOS: `brew install ffmpeg`)

```
npm install
npx playwright install chromium
```

### Usage

```
node record.cjs examples/photocraft_phone.json
```

Output goes to `out/`: `<name>.mp4` plus `<name>_預覽.png`, a contact sheet of 4 evenly spaced frames for a quick check.

You can also just ask Claude Code: "Use web-demo-recorder to record example.com — scroll to X, then click Y." It will write the step file and run it.

### Step file

| Field | Meaning |
|---|---|
| `name` | Output file name (defaults to the step file's name) |
| `viewport` | `"phone"` = 1080×1920 portrait (default); `"desktop"` = 1920×1080; or custom `{"w":…,"h":…,"scale":…}` |
| `url` | Starting URL, or a local html file (relative to the step file) |
| `blur` | CSS selectors to blur (emails, phone numbers, …) |
| `out` | Output folder (defaults to `out/`) |

| Action | Example | What it does |
|---|---|---|
| `wait` | `{"wait": 1500}` | Pause 1.5 s (milliseconds) |
| `scroll` | `{"scroll": 600}` | Smoothly scroll down 600 px; negative scrolls up. `"ms"` sets the duration |
| `scrollTo` | `{"scrollTo": "Get started"}` | Smoothly scroll until that text (or selector) is near the top. `"offset"` sets the distance from the top |
| `click` | `{"click": "Copy"}` | Glide the cursor over and click, with a ripple |
| `hover` | `{"hover": "h1"}` | Glide the cursor over and stay, no click |
| `type` | `{"type": {"selector": "#q", "text": "hello"}}` | Click the input and type character by character |
| `goto` | `{"goto": "https://..."}` | Navigate to another URL |

- `click`, `hover` and `scrollTo` accept either **visible text** or a CSS selector. CSS-looking strings are tried as selectors first, then as text.
- `click` and `hover` accept `"after": ms` to set the pause afterwards.

### Limitations

- Pages that require login are not supported (the browser is always clean)
- Cookie banners: common buttons on the main page ("Accept", "Agree", …) are dismissed automatically; banners inside iframes are not — add a `click` step
- Video only, no audio
- Tested on Windows 11 only so far
- Log and error messages are in Traditional Chinese

### License

[MIT](LICENSE)
