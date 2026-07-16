import puppeteer from 'puppeteer-core'

const [, , name = 'shot', query = '', pageFile = 'debug.html'] = process.argv
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--use-angle=metal'],
})
const page = await browser.newPage()
await page.setViewport({ width: 920, height: 700 })
page.on('console', (m) => console.log('[page]', m.text()))
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(`http://localhost:5173/${pageFile}?${query}`, { waitUntil: 'networkidle0' })
await page.waitForFunction('window.__done === true', { timeout: 15000 })
const out = `/private/tmp/claude-501/-Users-astrid-puppy-simulator/48a5e2b4-7379-411c-a7f0-59ef76df0e80/scratchpad/${name}.png`
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
