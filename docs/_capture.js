/* Capture every screen of the running app -> docs/screenshots/*.jpg, docs/walkthrough.mp4, docs/walkthrough.gif
 * Run it through `python docs/capture.py`, which starts a sandboxed API + web app with demo data first.
 * Env: APP_URL (web app), CAPTURE_USER / CAPTURE_PASS (an administrator), CHROME_PATH (optional).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");
const ffmpeg = require("ffmpeg-static");

const BASE = process.env.APP_URL || "http://localhost:5199";
const USER = process.env.CAPTURE_USER || "demo_admin";
const PASS = process.env.CAPTURE_PASS || "Ledger-Demo-2026!";
const DOCS = __dirname;
const OUT = path.join(DOCS, "screenshots");
const W = 1440, H = 900;
const DWELL = 3.0; // seconds per screen in the video

// [file name, route] - the order is the order of the video and the README gallery.
const SCREENS = [
  ["03-dashboard", "/dashboard"],
  ["04-workflow", "/workflow"],
  ["05-bank-accounts", "/bank-accounts"],
  ["06-bank-statements", "/bank-statements"],
  ["07-statement-continuity", "/bank-statements/continuity"],
  ["08-transactions", "/transactions"],
  ["09-journal-entries", "/journal-entries"],
  ["10-bank-reconciliation", "/bank-reconciliation"],
  ["11-categories", "/categories"],
  ["12-category-keywords", "/category-keywords"],
  ["13-clients", "/clients"],
  ["14-suppliers", "/suppliers"],
  ["15-products", "/products"],
  ["16-sales-invoices", "/sales-invoices"],
  ["17-purchase-bills", "/purchase-bills"],
  ["18-payments", "/payments"],
  ["19-recurring-invoices", "/recurring-invoices"],
  ["20-inventory", "/inventory"],
  ["21-receivables-payables", "/receivables-payables"],
  ["22-gst-summary", "/gst-summary"],
  ["23-tds-summary", "/tds-summary"],
  ["24-profit-and-loss", "/profit-and-loss"],
  ["25-balance-sheet", "/balance-sheet"],
  ["26-trial-balance", "/trial-balance"],
  ["27-cash-flow", "/cash-flow"],
  ["28-account-ledger", "/account-ledger"],
  ["29-reports-comparison", "/reports/comparison"],
  ["30-period-close", "/period-close"],
  ["31-ai-assistant", "/ai-assistant"],
  ["32-users", "/users"],
  ["33-audit-log", "/audit-log"],
  ["34-menu-guide", "/menu-guide"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const guesses = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const g of guesses) if (fs.existsSync(g)) return g;
  throw new Error("Chrome/Edge not found - set CHROME_PATH");
}

async function settle(page) {
  try { await page.waitForNetworkIdle({ idleTime: 600, timeout: 15000 }); } catch { /* keep going */ }
  await sleep(900);
}

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "ld-frames-"));
  let n = 0;
  const frame = async (page) => {
    n += 1;
    await page.screenshot({ path: path.join(frames, String(n).padStart(3, "0") + ".png") });
  };
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
    await frame(page);
    console.log("  ", name);
  };

  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: true,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
    args: ["--hide-scrollbars", "--force-device-scale-factor=2"],
  });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);

  // Sign-up and sign-in pages, then a real sign-in through the form.
  await page.goto(BASE + "/signup", { waitUntil: "networkidle2" });
  await settle(page);
  await page.screenshot({ path: path.join(OUT, "02-signup.png"), fullPage: true });
  console.log("   02-signup");

  await page.goto(BASE + "/login", { waitUntil: "networkidle2" });
  await settle(page);
  await shot(page, "01-login");
  await page.type("#auth-username", USER, { delay: 30 });
  await page.type("#auth-password", PASS, { delay: 20 });
  await frame(page);
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30000 }),
    page.click('button[type="submit"]'),
  ]);
  await settle(page);

  for (const [name, route] of SCREENS) {
    await page.goto(BASE + route, { waitUntil: "networkidle2" });
    await settle(page);
    await shot(page, name);
  }
  await browser.close();

  // Full-page PNGs -> JPG
  for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".png"))) {
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", path.join(OUT, f),
      "-qscale:v", "3", path.join(OUT, f.replace(/\.png$/, ".jpg"))]);
    fs.unlinkSync(path.join(OUT, f));
  }

  // Viewport frames -> MP4 (1080p) and a small GIF that plays inline on GitHub
  const ordered = fs.readdirSync(frames).filter((f) => f.endsWith(".png")).sort();
  const concat = (dwell) => {
    const list = path.join(frames, `list-${dwell}.txt`);
    fs.writeFileSync(list, ordered.map((f) => `file '${path.join(frames, f).replace(/\\/g, "/")}'\nduration ${dwell}`).join("\n")
      + `\nfile '${path.join(frames, ordered[ordered.length - 1]).replace(/\\/g, "/")}'\n`);
    return list;
  };
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat(DWELL),
    "-vf", "scale=1920:1200:force_original_aspect_ratio=decrease,pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,setsar=1,format=yuv420p",
    "-r", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart",
    path.join(DOCS, "walkthrough.mp4")]);
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concat(1.6),
    "-vf", "fps=5,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop", "0", path.join(DOCS, "walkthrough.gif")]);
  fs.rmSync(frames, { recursive: true, force: true });

  console.log(`\nDone: ${fs.readdirSync(OUT).length} screenshots -> docs/screenshots/, docs/walkthrough.mp4, docs/walkthrough.gif`);
})().catch((e) => { console.error(e); process.exit(1); });
