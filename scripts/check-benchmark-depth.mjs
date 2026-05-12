async function checkDepth(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1mo&includeAdjustedClose=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return { symbol, status: 'Failed', error: res.status };
    const json = await res.json();
    const result = json.chart.result[0];
    const timestamps = result.timestamp || [];
    if (timestamps.length === 0) return { symbol, status: 'No Data' };
    const firstDate = new Date(timestamps[0] * 1000).toISOString().slice(0, 10);
    const lastDate = new Date(timestamps[timestamps.length - 1] * 1000).toISOString().slice(0, 10);
    return { symbol, status: 'OK', firstDate, lastDate, count: timestamps.length };
  } catch (e) {
    return { symbol, status: 'Error', error: e.message };
  }
}

const symbols = ['SPY', 'QQQ', 'NIFTYBEES.NS', 'NIFTY500.NS'];
console.log('Checking depth for ETFs (Total Return)...');

const results = await Promise.all(symbols.map(checkDepth));
console.table(results);
