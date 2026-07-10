import { chromium } from 'playwright'
const BASE = 'http://localhost:5183', OUT = process.env.SHOT_DIR
const w = (ms) => new Promise((r) => setTimeout(r, ms))
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 430, height: 1100 }, deviceScaleFactor: 2 })
const p = await ctx.newPage()
const errs = []
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message))
async function shot(n) { await w(700); await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true }); console.log('shot', n) }
async function text() { return (await p.locator('body').innerText()).replace(/\s+/g, ' ') }

// login
await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
await p.fill('input[type="email"]', 'yoko@example.com')
await p.fill('input[type="password"]', 'password123')
await p.click('button[type="submit"]')
await p.waitForURL(`${BASE}/`, { timeout: 10000 })

// ---------- ANCESTOR PATH (origin set → born a sprout) ----------
await p.goto(`${BASE}/add`, { waitUntil: 'networkidle' })
await p.click('text=A seed passed to you')
await p.fill('input[placeholder="Their name"]', 'Lola Remedios')
await p.fill('input[placeholder="Place (optional)"]', 'Cebu')
await p.click('text=Continue to the recipe')
await shot('01-ancestor-form-framing')
console.log('ANCESTOR FORM has framing:', (await text()).includes('a splash of vinegar'))
// name-only submit
await p.fill('input[placeholder="Recipe name"]', 'Lola’s Adobo')
await p.click('button:has-text("Keep this recipe")')
await p.waitForSelector('text=is planted', { timeout: 10000 })
await shot('02-ancestor-planted-beat')
const a = await text()
console.log('ANCESTOR BEAT text:', a.match(/(Seed sown|First sprout).*?watch it grow\./)?.[0] || '(not matched)')
console.log('  plant stage attr:', await p.locator('svg[data-stage]').first().getAttribute('data-stage'))
console.log('  has "Take me to it":', a.includes('Take me to it'))
console.log('  has "Pass it on":', a.includes('Pass it on'))

// ---------- MINE PATH (no soul → born a seed) ----------
await p.goto(`${BASE}/add`, { waitUntil: 'networkidle' })
await p.click('text=A seed of your own')
await p.click('text=Continue to the recipe')
await shot('03-mine-form-framing')
await p.fill('input[placeholder="Recipe name"]', 'Weeknight Fried Rice')
await p.click('button:has-text("Keep this recipe")')
await p.waitForSelector('text=is planted', { timeout: 10000 })
await shot('04-mine-planted-beat')
const m = await text()
console.log('MINE BEAT text:', m.match(/(Seed sown|First sprout).*?watch it grow\./)?.[0] || '(not matched)')
console.log('  plant stage attr:', await p.locator('svg[data-stage]').first().getAttribute('data-stage'))
console.log('  has "add a memory":', m.includes('add a memory'))

// secondary CTA lands on the recipe page
await p.click('text=Take me to it')
await p.waitForURL(/\/recipes\/\d+$/, { timeout: 10000 })
console.log('CTA landed on:', new URL(p.url()).pathname)
await shot('05-landed-on-recipe')

await b.close()
console.log('\nCONSOLE ERRORS:', errs.length)
errs.forEach((e) => console.log('  -', e))
