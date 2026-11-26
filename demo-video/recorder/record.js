// Cloud screen recorder driver — drives headed Chrome under Xvfb while
// ffmpeg records the display. Usage:
//   node record.js <shot-plan.json>
// Shot plan: { "url": "...", "actions": [ {type:"wait",ms}, {type:"scrollTo",y,durationMs}, {type:"scrollBy",dy,durationMs}, {type:"clickText",text}, {type:"goto",url} ] }
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function smoothScroll(page, targetY, durationMs) {
  await page.evaluate(async (targetY, durationMs) => {
    const startY = window.scrollY;
    const start = performance.now();
    await new Promise((resolve) => {
      function step(now) {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + (targetY - startY) * eased);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, targetY, durationMs);
}

(async () => {
  const planPath = process.argv[2];
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || '';
  // Proxy credentials are parsed from the environment at runtime only;
  // never printed, never written to disk.
  const proxyUrl = new URL(proxy);
  const width = parseInt(process.env.REC_W || '1920', 10);
  const height = parseInt(process.env.REC_H || '1080', 10);
  const browser = await puppeteer.launch({
    executablePath: __dirname + '/chrome-linux64/chrome',
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--window-size=${width},${height}`,
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      '--proxy-server=' + proxy,
      '--proxy-bypass-list=localhost,127.0.0.1',
      '--user-data-dir=' + __dirname + '/chrome-profile',
    ],
    defaultViewport: { width, height },
  });
  const page = (await browser.pages())[0];
  if (proxyUrl.username) {
    await page.authenticate({
      username: decodeURIComponent(proxyUrl.username),
      password: decodeURIComponent(proxyUrl.password),
    });
  }
  await page.goto(plan.url, { waitUntil: 'networkidle2', timeout: 90000 });
  for (const a of plan.actions || []) {
    if (a.type === 'wait') await sleep(a.ms);
    else if (a.type === 'scrollTo') await smoothScroll(page, a.y, a.durationMs || 3000);
    else if (a.type === 'scrollBy') {
      const y = await page.evaluate(() => window.scrollY);
      await smoothScroll(page, y + a.dy, a.durationMs || 3000);
    } else if (a.type === 'clickText') {
      await page.evaluate((text) => {
        const els = [...document.querySelectorAll('a,button,[role="tab"]')];
        const el = els.find((e) => e.textContent.trim().toLowerCase().includes(text.toLowerCase()));
        if (el) el.click();
      }, a.text);
      await sleep(1500);
    } else if (a.type === 'goto') {
      await page.goto(a.url, { waitUntil: 'networkidle2', timeout: 90000 });
    } else if (a.type === 'type') {
      await page.type(a.selector, a.text, { delay: 60 });
      await sleep(500);
    } else if (a.type === 'submitForm') {
      await page.$eval(a.selector, (form) => form.submit());
      await sleep(2000);
    }
  }
  await sleep(500);
  await browser.close();
  console.log('SHOT DONE: ' + planPath);
})().catch((e) => {
  console.error('SHOT FAILED: ' + e.message);
  process.exit(1);
});
