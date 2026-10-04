// Checks the watched Amazon products' public pages and wakes the agent when a
// price falls by 10% or more, or when a product comes back in stock.
//
// Storage (shared with app/index.html):
//   items: [{asin, title, price, display, state, ref, checked, history: [[time, price]]}]
//   state is "in", "out" or "unknown"; ref is the price a drop is measured from.

const AMAZON = 'https://www.amazon.com/dp/';
const DROP = 0.9;            // wake at 10% below the reference price
const PER_TICK = 8;          // pages read per tick, oldest first
const BUDGET_MS = 18000;     // stop starting new reads well before the 25 s cap
const HISTORY = 48;          // price points kept per product
const MAX_ITEMS = 25;

export async function tick({ signal, storage, fetch }) {
  const started = Date.now();
  const items = (Array.isArray(storage.items) ? storage.items : [])
    .filter(item => item && /^[A-Z0-9]{10}$/.test(item.asin))
    .slice(0, MAX_ITEMS);
  storage.items = items;
  const due = [...items].sort((a, b) => (a.checked || 0) - (b.checked || 0)).slice(0, PER_TICK);
  const news = [];

  for (const item of due) {
    if (signal.aborted || Date.now() - started > BUDGET_MS) break;
    let reading;
    try {
      const response = await fetch(AMAZON + item.asin);
      if (!response.ok) { item.error = 'HTTP ' + response.status; continue; }
      reading = readProduct(await response.text());
    } catch (error) {
      item.error = String(error && error.message || error).slice(0, 120);
      continue;
    }
    if (!reading) { item.error = 'Amazon showed no product page (bot check or sign-in).'; continue; }
    delete item.error;
    const now = Date.now();
    const before = { state: item.state, price: item.price };
    item.title = reading.title || item.title || item.asin;
    item.checked = now;
    item.state = reading.state;
    if (reading.price != null) {
      item.price = reading.price;
      item.display = reading.display;
      item.history = [...(item.history || []), [now, reading.price]].slice(-HISTORY);
      if (!(item.ref > 0) || reading.price > item.ref) item.ref = reading.price;
    }
    const link = AMAZON + item.asin;
    if (before.state === 'out' && reading.state === 'in') {
      news.push(`Back in stock: ${item.title} (${item.asin})${reading.display ? ' at ' + reading.display : ''}. ${link}`);
      item.ref = reading.price ?? item.ref;
    } else if (reading.state === 'in' && reading.price != null && item.ref > 0 && reading.price <= item.ref * DROP) {
      const percent = Math.round((1 - reading.price / item.ref) * 100);
      news.push(`Price drop: ${item.title} (${item.asin}) is now ${reading.display}, down ${percent}% from ${money(item.ref, reading.display)}. ${link}`);
      item.ref = reading.price;
    }
  }
  trim(storage);
  if (news.length) return { wake: news.join('\n').slice(0, 8000) };
  return {};
}

// Reads title, price and availability from a product page's HTML. Returns
// null when the page is not a product page, so a bot check never reads as
// "out of stock".
function readProduct(html) {
  const titleMatch = /id="productTitle"[^>]*>([\s\S]*?)<\/span>/.exec(html);
  if (!titleMatch) return null;
  const title = clean(titleMatch[1]).slice(0, 120);

  let price = null, display = null;
  const data = /twister-plus-buying-options-price-data">\s*(\{[\s\S]*?\})\s*<\/div>/.exec(html);
  if (data) {
    try {
      const groups = JSON.parse(data[1]);
      const first = (groups.desktop_buybox_group_1 || [])[0];
      if (first && typeof first.priceAmount === 'number') { price = first.priceAmount; display = first.displayPrice; }
    } catch { /* fall through to the visible price */ }
  }
  if (price == null) {
    const visible = /apex-pricetopay-value[\s\S]{0,300}?class="a-offscreen">\s*([^<]+?)\s*</.exec(html)
      || /id="corePrice[\s\S]{0,3000}?class="a-offscreen">\s*([^<]*\d[^<]*?)\s*</.exec(html);
    if (visible) { display = clean(visible[1]); price = amount(display); }
  }

  const availability = /<div id="availability"[^>]*>([\s\S]{0,4000}?)<\/div>\s*<\/div>/.exec(html);
  const words = availability ? clean(availability[1].replace(/<script[\s\S]*?<\/script>/g, '')) : '';
  const unavailable = /currently unavailable|out of stock|temporarily out|no featured offers/i.test(words);
  const state = unavailable ? 'out' : price != null ? 'in' : 'out';
  return { title, price: state === 'in' ? price : null, display: state === 'in' ? display : null, state };
}

function clean(text) {
  return text.replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ').trim();
}

function amount(text) {
  const match = /(\d[\d,]*(?:\.\d{1,2})?)/.exec(text || '');
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

function money(value, sample) {
  const symbol = (/^[^\d\s]+/.exec(sample || '') || ['$'])[0];
  return symbol + value.toFixed(2);
}

// Keeps the whole storage well under Yab's 64 KB by shortening histories.
function trim(state) {
  let size = JSON.stringify(state).length;
  while (size > 48000 && state.items.some(item => (item.history || []).length > 8)) {
    for (const item of state.items) if ((item.history || []).length > 8) item.history.shift();
    size = JSON.stringify(state).length;
  }
}
