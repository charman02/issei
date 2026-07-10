import { chromium } from 'playwright'
const BASE='http://localhost:5183', OUT=process.env.SHOT_DIR
const w=(ms)=>new Promise(r=>setTimeout(r,ms))
const b=await chromium.launch()
const ctx=await b.newContext({viewport:{width:430,height:1500},deviceScaleFactor:2})
const p=await ctx.newPage(); const errs=[]
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
p.on('pageerror',e=>errs.push('PAGEERR: '+e.message))
async function shot(n){await w(800);await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});console.log('shot',n)}
await p.goto(`${BASE}/login`,{waitUntil:'networkidle'})
await p.fill('input[type="email"]','yoko@example.com'); await p.fill('input[type="password"]','password123')
await p.click('button[type="submit"]'); await p.waitForURL(`${BASE}/`,{timeout:10000})
await p.goto(`${BASE}/recipes/1`,{waitUntil:'networkidle'}); await shot('01-rich-recipe')
await p.goto(`${BASE}/recipes/2`,{waitUntil:'networkidle'}); await shot('02-bare-recipe')
await b.close(); console.log('ERRORS:',errs.length); errs.forEach(e=>console.log(' -',e))
