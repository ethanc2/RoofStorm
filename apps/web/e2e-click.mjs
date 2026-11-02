// Throwaway smoke test: load the app, zoom to house level, click the map centre, expect the owner card.
// node e2e-click.mjs   (stub API on :4000 and vite on :5173 must be running)
import { chromium } from 'playwright';
const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`)); page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', r => logs.push(`[reqfail] ${r.url()}`));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('.panel h2', { timeout: 15000 });
console.log('panel:', await page.textContent('.panel h2'));
const map = page.locator('main.map'); const box = await map.boundingBox();
await page.waitForTimeout(2500); // let the first idle → load pass finish
const parcelsN = await page.evaluate(async () => { const r = await fetch('http://localhost:4000/v1/parcels?bbox=-86.62,33.61,-86.60,33.63'); return (await r.json()).features.length; });
console.log('stub parcels available:', parcelsN);
// click a bit below centre (chips sit in the top band; the default view is z17 so this lands on a house)
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.6;
const atReq = page.waitForResponse(r => /\/v1\/parcels\/(at|[0-9a-f-]{36})(\?|$)/.test(r.url()), { timeout: 8000 }).catch(() => null);
await page.mouse.click(cx, cy);
const resp = await atReq; console.log('card request:', resp ? `${resp.status()} ${resp.url().replace('http://localhost:4000', '')}` : 'NONE — click did not reach handler');
const card = await page.waitForSelector('.panel h3:has-text("Roof")', { timeout: 8000 }).catch(() => null);
console.log('owner card opened:', !!card, '| title:', (await page.textContent('.panel h2'))?.trim());
if (card) console.log('photo:', await page.locator('.panel img.photo').count() ? 'yes' : 'no/loading');
await page.screenshot({ path: 'e2e-click.png' });
console.log(logs.filter(l => !l.includes('[log]')).slice(0, 15).join('\n'));
await b.close();
