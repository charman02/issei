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
async function shot(n) { await wait(700); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log('shot:', n) }

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'charlie@example.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })

// Charlie's private adobo (id 1, has a child)
await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
await shot('01-detail-private-pill')

// click Make public → descendants confirm should appear (adobo has 1 child)
const makePublic = page.getByRole('button', { name: /make public/i })
if (await makePublic.count()) {
  await makePublic.first().click()
  await shot('02-publish-confirm')
  // confirm publish
  const publish = page.getByRole('button', { name: /^publish$/i })
  if (await publish.count()) { await publish.first().click(); await wait(900); await shot('03-detail-public-pill') }
}

// now adobo should appear in Browse
await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' })
await shot('04-browse-now-has-it')

await browser.close()
console.log('CONSOLE ERRORS:', errors.length)
errors.forEach((e) => console.log('  -', e))
