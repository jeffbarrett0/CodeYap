// Test helper: the app starts in Simple mode; most tests need the full (Pro) layout, so make every
// page opened by a script start in Pro mode. Require this before launching the browser.
const { chromium } = require('playwright')
const init = () => { try { localStorage.setItem('scoutdesk.mode', 'pro') } catch (e) {} }
const launch = chromium.launch.bind(chromium)
chromium.launch = async (...args) => {
  const b = await launch(...args)
  const newPage = b.newPage.bind(b)
  b.newPage = async (...a) => { const p = await newPage(...a); await p.addInitScript(init); return p }
  const newContext = b.newContext.bind(b)
  b.newContext = async (...a) => { const c = await newContext(...a); await c.addInitScript(init); return c }
  return b
}
