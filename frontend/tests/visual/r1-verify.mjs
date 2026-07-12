import { chromium } from 'playwright'
const BASE='http://localhost:5183', OUT=process.env.SHOT_DIR
const w=(ms)=>new Promise(r=>setTimeout(r,ms))
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:430,height:1500},deviceScaleFactor:2})
const p=await ctx.newPage(); const errs=[]
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message))
async function shot(n){await w(700);await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});console.log('shot',n)}

// LOGIN
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'})
await shot('01-login')
const lt=await p.locator('body').innerText()
console.log('=== LOGIN ===')
console.log('  "Plant your first seed":', lt.includes('Plant your first seed')?'✓':'✗')
console.log('  no "Join the table":', !lt.includes('Join the table')?'✓':'✗')
console.log('  kanji 一世 kept:', lt.includes('一世')?'✓':'✗')
console.log('  meaning blurb kept:', lt.includes('first of a family')?'✓':'✗')
// field reset: type email, switch to signup tab, back to sign in, assert cleared
await p.fill('input[type="email"]','stale@example.com')
await p.getByRole('button',{name:/plant your first seed/i}).click()  // signup tab (only match on Sign In tab)
await w(200)
await p.getByRole('button',{name:/^sign in$/i}).click()  // back to sign in tab
await w(200)
const emailVal = await p.locator('input[type="email"]').inputValue()
console.log('  field reset on tab switch:', emailVal===''?'✓':`✗ (got "${emailVal}")`)

// login for real
await p.fill('input[type="email"]','yoko@example.com'); await p.fill('input[type="password"]','password123')
await p.getByRole('button',{name:/^sign in$/i}).click()
await p.waitForURL(`${BASE}/`,{timeout:10000})

// GARDEN
await p.goto(`${BASE}/my-recipes`,{waitUntil:'networkidle'})
await shot('02-garden')
const gt=await p.locator('body').innerText()
console.log('=== GARDEN ===')
console.log('  title "Your Garden":', gt.includes('Your Garden')?'✓':'✗')
console.log('  no "Your Kitchen":', !gt.includes('Your Kitchen')?'✓':'✗')
console.log('  nav label "Garden":', gt.includes('Garden')?'✓':'✗')

// RECIPE with origin (Lola's Adobo, id 1) — readable ingredients + "from Lola"
await p.goto(`${BASE}/recipes/1`,{waitUntil:'networkidle'})
await shot('03-recipe-with-origin')
const rt=await p.locator('body').innerText()
console.log('=== RECIPE (with origin) ===')
console.log('  byline "from Lola Remedios":', rt.includes('from Lola Remedios')?'✓':'✗')
console.log('  no "kept by" (has source):', !rt.includes('kept by')?'✓':'✗')
console.log('  ingredient amounts visible (2 lbs):', rt.includes('2 lbs')?'✓':'✗')
console.log('  imprecise "a good splash":', rt.includes('a good splash')?'✓':'✗')
// check ingredient amount is bold Nunito (class check)
const amt = await p.locator('.ingredient-amount').first()
console.log('  .ingredient-amount rendered:', await amt.count()>0?'✓':'✗')

// RECIPE without origin (Weeknight Fried Rice, id 3) — fallback "kept by"
await p.goto(`${BASE}/recipes/3`,{waitUntil:'networkidle'})
await w(500)
const rt2=await p.locator('body').innerText()
console.log('=== RECIPE (no origin) ===')
console.log('  fallback "kept by Yoko":', /kept by Yoko/i.test(rt2)?'✓':'✗')

console.log('\nCONSOLE ERRORS:',errs.length); errs.forEach(e=>console.log(' -',e))
await b.close()
