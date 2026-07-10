import { chromium } from 'playwright'
const BASE = 'http://localhost:5183'
const OUT = process.env.SHOT_DIR
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
async function shot(n) { await wait(800); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log('shot:', n) }

// login as the recipe owner
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'yoko@example.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })
await shot('01-home')

// the recipe detail (their private adobo)
await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
await shot('02-detail')

// kitchen
await page.goto(`${BASE}/my-recipes`, { waitUntil: 'networkidle' })
await shot('03-kitchen')

// report the computed fonts actually in use (proof the re-skin took)
const fonts = await page.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : null }
  return {
    h1: pick('h1'),
    body: getComputedStyle(document.body).fontFamily,
  }
})
console.log('COMPUTED FONTS:', JSON.stringify(fonts))
await browser.close()
console.log('CONSOLE ERRORS:', errors.length)
errors.forEach((e) => console.log('  -', e))
