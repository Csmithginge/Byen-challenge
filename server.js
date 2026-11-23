// Ingen afhængigheder. Start med: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const TZ = 'Europe/Copenhagen';
const GYLDIGE_DAGE = ['lor', 'son', 'ons'];
const UGEDAGE = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

let db = {};
try { db = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { db = {}; }

function nu() {
  const d = new Date();
  return {
    dato: new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d),
    ugedag: UGEDAGE[new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d)]
  };
}

function rens() {
  const { dato } = nu();
  for (const k of Object.keys(db)) {
    const alder = (Date.parse(dato) - Date.parse(db[k].opdateret)) / 864e5;
    if (!(alder <= 6)) delete db[k];
  }
}

function gem() {
  const tmp = DATA + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), (err) => {
    if (!err) fs.rename(tmp, DATA, () => {});
  });
}

// Meget simpel begrænsning: 30 skrivninger i minuttet pr. IP
const hits = new Map();
function for_mange(ip) {
  const m = Math.floor(Date.now() / 60000);
  const h = hits.get(ip);
  if (!h || h.m !== m) { hits.set(ip, { m, n: 1 }); return false; }
  h.n++;
  return h.n > 30;
}
setInterval(() => hits.clear(), 10 * 60000).unref();

function json(res, kode, obj) {
  res.writeHead(kode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/svar') {
    rens();
    return json(res, 200, { ...nu(), svar: Object.values(db) });
  }

  if (req.method === 'POST' && url === '/api/svar') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (for_mange(ip)) return json(res, 429, { fejl: 'For mange forsøg. Vent lidt.' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      let b;
      try { b = JSON.parse(body); } catch (e) { return json(res, 400, { fejl: 'Ugyldigt svar.' }); }
      const navn = String(b.navn || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (!navn) return json(res, 400, { fejl: 'Skriv dit navn.' });
      const idag = b.idag === 'ja' || b.idag === 'nej' ? b.idag : null;
      const dage = Array.isArray(b.dage) ? [...new Set(b.dage)].filter((d) => GYLDIGE_DAGE.includes(d)) : [];
      const { dato } = nu();
      if (Object.keys(db).length > 500 && !db[navn.toLowerCase()]) return json(res, 507, { fejl: 'Fuldt.' });
      db[navn.toLowerCase()] = { navn, idag, idagDato: idag ? dato : null, dage, opdateret: dato };
      gem();
      json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
    return fs.readFile(path.join(__dirname, 'index.html'), (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Fejl'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
  }

  res.writeHead(404); res.end('Ikke fundet');
});

server.listen(PORT, () => console.log('Kører på port ' + PORT));
