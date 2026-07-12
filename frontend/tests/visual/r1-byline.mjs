import { chromium } from 'playwright'
const BASE='http://localhost:5183'
const b=await chromium.launch()
const p=await (await b.newContext()).newPage()
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'})
await p.fill('input[type="email"]','yoko@example.com'); await p.fill('input[type="password"]','password123')
await p.locator('button[type="submit"]').click()
await p.waitForURL(`${BASE}/`,{timeout:10000})

// recipe 1 (has origin) — normalize whitespace, check byline text + plum color
await p.goto(`${BASE}/recipes/1`,{waitUntil:'networkidle'})
await new Promise(r=>setTimeout(r,600))
const norm1 = (await p.locator('body').innerText()).replace(/\s+/g,' ')
console.log('recipe1 byline present ("from Lola Remedios"):', norm1.includes('from Lola Remedios')?'✓':'✗')
// find the plum name span
const plum = p.locator('span.text-plum').first()
if (await plum.count()) {
  console.log('  plum name span text:', JSON.stringify(await plum.innerText()))
  console.log('  plum color:', await plum.evaluate(el=>getComputedStyle(el).color))
}

// recipe 3 (no origin) — fallback
await p.goto(`${BASE}/recipes/3`,{waitUntil:'networkidle'})
await new Promise(r=>setTimeout(r,600))
const norm3 = (await p.locator('body').innerText()).replace(/\s+/g,' ')
console.log('recipe3 fallback ("kept by Yoko"):', norm3.includes('kept by Yoko')?'✓':'✗')
const plum3 = p.locator('span.text-plum').first()
if (await plum3.count()) console.log('  recipe3 plum name:', JSON.stringify(await plum3.innerText()))
await b.close()
