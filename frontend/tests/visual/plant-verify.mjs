import { chromium } from 'playwright'
const BASE = 'http://localhost:5183'
const OUT = process.env.SHOT_DIR
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 430, height: 1400 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
async function shot(n) { await wait(700); await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log('shot:', n) }

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'chef@example.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })

// Kitchen = the garden of mixed growth stages (the key screen)
await page.goto(`${BASE}/my-recipes`, { waitUntil: 'networkidle' })
await shot('01-kitchen-garden')

// Fruiting tree detail
await page.goto(`${BASE}/recipes/5`, { waitUntil: 'networkidle' })
await shot('02-tree-detail')

// The edge-case fruiting sapling (Weeknight Adobo, id 4)
await page.goto(`${BASE}/recipes/4`, { waitUntil: 'networkidle' })
await shot('03-fruiting-sapling-detail')

await browser.close()
console.log('CONSOLE ERRORS:', errors.length)
errors.forEach((e) => console.log('  -', e))
