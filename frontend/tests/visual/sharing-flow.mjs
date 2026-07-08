import { chromium } from 'playwright'
const BASE = 'http://localhost:5183'
const API = 'http://127.0.0.1:8010'
const OUT = process.env.SHOT_DIR
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()

const errors = []

async function ctxFor() {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 880 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  return { ctx, page }
}

async function login(page, email) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await page.waitForURL(`${BASE}/`, { timeout: 10000 })
}

async function shot(page, n) {
  await wait(700)
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: true })
  console.log('shot:', n)
}

// ---- AS OWNER (Yoko): private recipe detail → Pass it on ----
{
  const { page } = await ctxFor()
  await login(page, 'yoko@example.com')
  await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
  await shot(page, '01-owner-private-detail')

  // Open the "Pass it on" / handoff surface. Look for a button that opens HandoffInvite.
  const passBtn = page.getByRole('button', { name: /pass|hand|share|seed/i })
  if (await passBtn.count()) {
    await passBtn.first().click()
    await shot(page, '02-handoff-invite-copy')
  } else {
    console.log('NOTE: no pass/handoff trigger button found on detail — capturing detail only')
  }
}

// ---- AS GRANTEE (Charlie): Kitchen link → Shared with you → open shared recipe ----
{
  const { page } = await ctxFor()
  await login(page, 'charlie@example.com')
  await page.goto(`${BASE}/my-recipes`, { waitUntil: 'networkidle' })
  await shot(page, '03-kitchen-with-shared-link')

  const sharedLink = page.getByRole('button', { name: /shared with you/i })
  if (await sharedLink.count()) {
    await sharedLink.first().click()
    await page.waitForURL(`${BASE}/shared`, { timeout: 8000 }).catch(() => {})
  } else {
    await page.goto(`${BASE}/shared`, { waitUntil: 'networkidle' })
  }
  await shot(page, '04-shared-with-me')

  // open the shared recipe from /shared
  await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
  await shot(page, '05-grantee-opens-shared-recipe')

  // open the child (root-binds)
  await page.goto(`${BASE}/recipes/2`, { waitUntil: 'networkidle' })
  await shot(page, '06-grantee-opens-child-rootbinds')
}

// ---- AS STRANGER (Priya): shared page empty, recipe 404 ----
{
  const { page } = await ctxFor()
  await login(page, 'priya@example.com')
  await page.goto(`${BASE}/shared`, { waitUntil: 'networkidle' })
  await shot(page, '07-stranger-empty-shared')
  await page.goto(`${BASE}/recipes/1`, { waitUntil: 'networkidle' })
  await shot(page, '08-stranger-recipe-blocked')
}

await browser.close()
console.log('CONSOLE ERRORS:', errors.length)
errors.forEach((e) => console.log('  -', e))
