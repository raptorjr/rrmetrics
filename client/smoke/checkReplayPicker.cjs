const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const webpack = require('webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { chromium } = require('playwright');
const base = require('../../webpack.config');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-replay-picker-'));
const compiler = webpack({
  ...base, entry: { smoke: './client/smoke/replayPicker.jsx' },
  plugins: [new MiniCssExtractPlugin({ filename: '[name].css' })],
  output: { path: dir, filename: '[name]Bundle.js' },
});
(async () => {
  await new Promise((resolve, reject) => compiler.run((err, stats) => {
    compiler.close(() => {});
    if (err || stats.hasErrors()) reject(err || new Error(stats.toString({ errors: true })));
    else resolve();
  }));
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/smoke.css"></head><body><div id="app"></div><script src="/smokeBundle.js"></script></body></html>');
    }
    const file = path.join(dir, path.basename(req.url));
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'application/javascript');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    page.on('pageerror', err => console.error('Browser error:', err.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('.tcw-toolbar').first().waitFor({ state: 'visible' });
    const describe = () => page.evaluate(() => {
      const root = document.querySelector('.tcw-grid');
      const buttons = Array.from(document.querySelectorAll('.tcw-grid-layout-btn'));
      return {
        grid: !!root,
        sharedToolbar: !!document.querySelector('.tcw-grid-active-toolbar'),
        picker: buttons.map(b => ({ parent: b.parentElement.className, html: b.outerHTML, rect: b.getBoundingClientRect().toJSON(), display: getComputedStyle(b).display, visibility: getComputedStyle(b).visibility })),
        replay: Array.from(document.querySelectorAll('[data-role="replay"]')).map(b => ({ rect: b.getBoundingClientRect().toJSON(), display: getComputedStyle(b).display })),
      };
    });
    const check = async () => {
      const diag = await describe();
      console.log('Toolbar diagnostic:', JSON.stringify(diag));
      const picker = page.locator('.tcw-grid-active-toolbar .tcw-toolbar .tcw-grid-layout-btn');
      assert.equal(await picker.count(), 1, 'Expected one picker inside active chart toolbar');
      assert.equal(await picker.isVisible(), true, 'Picker must be visible');
      assert.equal(await page.locator('.tcw-grid-active-toolbar [data-role="replay"]:visible').count(), 0, 'Native Replay must not be visible');
      return picker;
    };
    let picker = await check();
    await picker.click();
    await page.locator('.tcw-grid-picker [data-layout="2x2"]').click();
    await page.locator('.tcw-grid-cell').nth(3).waitFor({ state: 'visible' });
    for (let i = 0; i < 4; i++) {
      await page.locator('.tcw-grid-cell').nth(i).click({ position: { x: 110, y: 60 } });
      picker = await check();
    }
    await picker.click();
    await page.locator('.tcw-grid-picker [data-layout="1x1"]').click();
    assert.equal(await page.locator('.tcw-grid-cell').count(), 1);
    await check();
    console.log('Replay picker browser smoke passed');
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
