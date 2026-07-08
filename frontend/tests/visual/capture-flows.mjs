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

async function shot(name) { await wait(700); await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); console.log('shot:', name) }

// login
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await page.fill('input[type="email"]', 'charlie@example.com')
await page.fill('input[type="password"]', 'password123')
await page.click('button[type="submit"]')
await page.waitForURL(`${BASE}/`, { timeout: 10000 })
await page.waitForLoadState('networkidle')
await shot('01-home')

// Kitchen grid — growth badges on cards
await page.goto(`${BASE}/my-recipes`, { waitUntil: 'networkidle' })
await shot('02-kitchen-growth-badges')

// Browse — badges across cards (varied growth)
await page.goto(`${BASE}/browse`, { waitUntil: 'networkidle' })
await shot('03-browse-badges')

// Plant flow: doorway
await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' })
await shot('04-plant-doorway')
// ancestor origin
await page.click('text=A seed passed to you')
await shot('05-plant-origin-ancestor')
// back to doorway, then mine origin
await page.goto(`${BASE}/add`, { waitUntil: 'networkidle' })
await page.click('text=A seed of your own')
await shot('06-plant-origin-mine')

// Recipe detail — actions + growth mark. Adobo is id 1 (tree, 5 cooks).
await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
await shot('07-detail-actions-adobo')
// cook it → growth beat
const cookBtn = page.getByRole('button', { name: /cooked this/i })
if (await cookBtn.count()) { await cookBtn.first().click(); await shot('08-detail-cook-beat') }

// Remix page (pre-filled + prompt)
await page.goto(`${BASE}/recipes/1/remix`, { waitUntil: 'networkidle' })
await shot('09-remix')

await browser.close()
console.log('\nCONSOLE ERRORS:', errors.length)
errors.forEach((e) => console.log('  -', e))
