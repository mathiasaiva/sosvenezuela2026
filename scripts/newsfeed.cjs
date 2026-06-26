// Sección de noticias dinámica: barre Google News RSS sobre el terremoto y guarda
// los artículos en news_articles (dedup por url). Pensado para correr por cron.
// Es DISTINTO de newsweep.cjs (que geolocaliza daños al mapa): esto es un feed de prensa.
try { require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) { const k = l.slice(0, i).trim(); if (!process.env[k]) process.env[k] = l.slice(i + 1).trim(); } }); } catch { /* no .env */ }
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

const FEEDS = [
  'https://news.google.com/rss/search?q=terremoto%20Venezuela&hl=es-419&gl=VE&ceid=VE:es',
  'https://news.google.com/rss/search?q=sismo%20Venezuela%20(rescate%20OR%20damnificados%20OR%20da%C3%B1os%20OR%20v%C3%ADctimas)&hl=es-419&gl=VE&ceid=VE:es',
];
function decode(s) {
  return (s || '').replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function parseItems(xml) {
  return xml.split('<item>').slice(1).map(c => {
    const g = (re) => { const m = c.match(re); return m ? m[1] : ''; };
    let title = decode(g(/<title>([\s\S]*?)<\/title>/));
    const link = decode(g(/<link>([\s\S]*?)<\/link>/));
    const pub = g(/<pubDate>([\s\S]*?)<\/pubDate>/).trim();
    const source = decode(g(/<source[^>]*>([\s\S]*?)<\/source>/));
    const desc = decode(g(/<description>([\s\S]*?)<\/description>/));
    // Google News titula "Titular - Fuente"; quita el sufijo de la fuente.
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3)).trim();
    return { title, link, pub, source, summary: desc.slice(0, 300) };
  }).filter(x => x.title && x.link);
}

(async () => {
  const ts = new Date().toISOString();
  let items = [];
  for (const f of FEEDS) { try { items = items.concat(parseItems(await (await fetch(f)).text())); } catch { /* skip feed */ } }
  const seen = new Set(); const uniq = [];
  for (const it of items) { if (seen.has(it.link)) continue; seen.add(it.link); uniq.push(it); }

  let added = 0;
  for (const it of uniq) {
    let pubIso = null; try { const d = new Date(it.pub); if (!isNaN(d)) pubIso = d.toISOString(); } catch { /* no date */ }
    const res = await pool.query(
      `insert into news_articles (title, url, source, summary, published_at)
       values ($1,$2,$3,$4,coalesce($5::timestamptz, now())) on conflict (url) do nothing`,
      [it.title.slice(0, 300), it.link, it.source || null, it.summary || null, pubIso]
    );
    added += res.rowCount;
  }
  // poda: conserva los 300 más recientes
  await pool.query("delete from news_articles where id not in (select id from news_articles order by coalesce(published_at, created_at) desc limit 300)");
  console.log(ts, 'NEWSFEED', JSON.stringify({ feeds: items.length, nuevos: added }));
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
