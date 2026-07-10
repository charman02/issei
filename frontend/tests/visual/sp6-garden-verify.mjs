import { chromium } from 'playwright'
const BASE='http://localhost:5183', OUT=process.env.SHOT_DIR
const w=(ms)=>new Promise(r=>setTimeout(r,ms))
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2})
const p=await ctx.newPage(); const errs=[]
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message))
async function shot(n){await w(700);await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});console.log('shot',n)}

// login
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'})
await p.fill('input[type="email"]','yoko@example.com'); await p.fill('input[type="password"]','password123')
await p.click('button[type="submit"]'); await p.waitForURL(`${BASE}/`,{timeout:10000})

// KITCHEN — garden bands
await p.goto(`${BASE}/my-recipes`,{waitUntil:'networkidle'})
await shot('01-kitchen-garden')
const t=(await p.locator('body').innerText()).replace(/\s+/g,' ')
console.log('=== GARDEN BANDS ===')
console.log('  "Needs tending":', t.includes('Needs tending')?'✓':'✗')
console.log('  "Growing":', t.includes('Growing')?'✓':'✗')
console.log('  "Thriving":', t.includes('Thriving')?'✓':'✗')
// order check: tending index < growing index < thriving index
const it=t.indexOf('Needs tending'), ig=t.indexOf('Growing'), ith=t.indexOf('Thriving')
console.log('  order tending<growing<thriving:', (it<ig && ig<ith)?'✓':`✗ (${it},${ig},${ith})`)
console.log('  all 4 recipes present:', ['Fresh Sinigang','Weeknight Rice',"Tita's Pancit","Lola's Adobo"].every(n=>t.includes(n))?'✓':'✗')

// SEARCH — collapses to flat grid (no band headers)
await p.fill('input[placeholder="Search recipes"]','adobo')
await w(400)
await shot('02-kitchen-search-flat')
const ts=(await p.locator('body').innerText()).replace(/\s+/g,' ')
console.log('=== SEARCH (flat) ===')
console.log('  no band headers while searching:', (!ts.includes('Needs tending') && !ts.includes('Thriving'))?'✓':'✗')
console.log('  shows matching Adobo:', ts.includes("Lola's Adobo")?'✓':'✗')
console.log('  hides non-matching:', !ts.includes('Fresh Sinigang')?'✓':'✗')

// RECIPE DETAIL — no "Make it mine"
await p.fill('input[placeholder="Search recipes"]','')
await p.goto(`${BASE}/recipes/4`,{waitUntil:'networkidle'})
await w(400)
const td=(await p.locator('body').innerText())
console.log('=== RECIPE DETAIL ===')
console.log('  "I cooked this" present:', td.includes('I cooked this')?'✓':'✗')
console.log('  "Make it mine" GONE:', !td.includes('Make it mine')?'✓':'✗')

// /remix route — should NOT render the remix form (route removed)
await p.goto(`${BASE}/recipes/4/remix`,{waitUntil:'networkidle'})
await w(400)
const tr=(await p.locator('body').innerText())
console.log('=== /remix route removed ===')
console.log('  remix form NOT shown:', (!tr.includes('Make it mine') && !tr.includes('what makes yours yours'))?'✓ (route falls through)':'✗ (remix still reachable!)')

console.log('\nCONSOLE ERRORS:',errs.length); errs.forEach(e=>console.log(' -',e))
await b.close()
