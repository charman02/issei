import { chromium } from 'playwright'
const BASE='http://localhost:5183', OUT=process.env.SHOT_DIR
const w=(ms)=>new Promise(r=>setTimeout(r,ms))
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:430,height:1500},deviceScaleFactor:2})
const p=await ctx.newPage(); const errs=[]
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message))
async function shot(n){await w(700);await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});console.log('shot',n)}

// login via the SUBMIT button (type=submit), unambiguous
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'})
await p.fill('input[type="email"]','yoko@example.com'); await p.fill('input[type="password"]','password123')
await p.locator('button[type="submit"]').click()
await p.waitForURL(`${BASE}/`,{timeout:10000})

// GARDEN
await p.goto(`${BASE}/my-recipes`,{waitUntil:'networkidle'})
await shot('02-garden')
const gt=await p.locator('body').innerText()
console.log('=== GARDEN ===')
console.log('  title "Your Garden":', gt.includes('Your Garden')?'✓':'✗')
console.log('  no "Your Kitchen":', !gt.includes('Your Kitchen')?'✓':'✗')
console.log('  nav label "Garden":', /\bGarden\b/.test(gt)?'✓':'✗')

// RECIPE with origin (id 1)
await p.goto(`${BASE}/recipes/1`,{waitUntil:'networkidle'})
await shot('03-recipe-with-origin')
const rt=await p.locator('body').innerText()
console.log('=== RECIPE (with origin) ===')
console.log('  byline "from Lola Remedios":', rt.includes('from Lola Remedios')?'✓':'✗')
console.log('  no "kept by" (has source):', !rt.includes('kept by')?'✓':'✗')
console.log('  ingredient amount 2 lbs:', rt.includes('2 lbs')?'✓':'✗')
console.log('  imprecise "a good splash":', rt.includes('a good splash')?'✓':'✗')
console.log('  .ingredient-amount rendered:', (await p.locator('.ingredient-amount').count())>0?'✓':'✗')
// verify byline color is plum
const byline = p.locator('text=from Lola Remedios').first()
const color = await byline.evaluate(el=>getComputedStyle(el).color).catch(()=>'n/a')
console.log('  byline color (plum #8A3D5A = rgb(138,61,90)):', color)

// RECIPE without origin (id 3)
await p.goto(`${BASE}/recipes/3`,{waitUntil:'networkidle'})
await w(500)
const rt2=await p.locator('body').innerText()
console.log('=== RECIPE (no origin) ===')
console.log('  fallback "kept by Yoko":', /kept by Yoko/i.test(rt2)?'✓':'✗')

console.log('\nCONSOLE ERRORS:',errs.length); errs.forEach(e=>console.log(' -',e))
await b.close()
