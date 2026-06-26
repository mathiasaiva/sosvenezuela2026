// Sincroniza desde ReportaVNZLA (reportavnzla.com/api/v1) con dedup estricto:
//  A) ENCONTRADOS -> cruza con nuestra data (nombre ordenado+edad / cédula) y marca found_alive;
//     inserta los encontrados que no tengamos (ext_id rvnzla:).
//  B) CENTROS DE ACOPIO -> inserta nuevos (ext_id rvnzla_a:, dedup por proximidad).
//  C) ESTRUCTURAS -> inserta edificios dañados nuevos (ext_id rvnzla_e:, dedup por proximidad).
// Pensado para correr por cron. Idempotente.
try { require('fs').readFileSync(__dirname + '/.env', 'utf8').split('\n').forEach(l => { const i = l.indexOf('='); if (i > 0 && !l.startsWith('#')) { const k = l.slice(0, i).trim(); if (!process.env[k]) process.env[k] = l.slice(i + 1).trim(); } }); } catch { /* no .env */ }
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const ADMIN = 'a0000000-0000-0000-0000-000000000001';
const API = 'https://reportavnzla.com/api/v1';

const pnorm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const ptok = s => pnorm(s).split(' ')[0] || '';
const nameKey = s => { const t = pnorm(s).split(' ').filter(x => x.length >= 2); return t.length >= 2 ? t.slice().sort().join(' ') : null; };
const pAge = note => { const m = /edad:\s*(\d{1,3})/i.exec(note || ''); return m ? parseInt(m[1]) : null; };
const psig = (name, ced, age, loc) => { const nk = pnorm(name); if (!nk || nk === 'sin nombre') return null; if (ced) return nk + '#c' + ced; if (age != null) return nk + '#a' + age; if (ptok(loc)) return nk + '#l' + ptok(loc); return null; };
const norm = c => { const x = (c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); return x && x.length >= 6 ? x : null; };
const t3 = n => Math.trunc(n * 1000) / 1000;
const get = async (path) => (await (await fetch(API + path, { signal: AbortSignal.timeout(25000) })).json());

async function personas() {
  const exExt = new Set((await pool.query("select ext_id from person_reports where ext_id like 'rvnzla:%'")).rows.map(r => r.ext_id));
  const exSig = new Set();
  const ex = (await pool.query("select id, given_name, cedula_norm, note_text, parroquia, status from person_reports where deleted_at is null")).rows;
  const cedMap = new Map(), nameAgeMap = new Map();
  for (const x of ex) {
    const s = psig(x.given_name, x.cedula_norm, pAge(x.note_text), x.parroquia); if (s) exSig.add(s);
    if (x.cedula_norm && !cedMap.has(x.cedula_norm)) cedMap.set(x.cedula_norm, x);
    const nk = nameKey(x.given_name), age = pAge(x.note_text);
    if (nk && age != null) { const k = nk + '#' + age; if (!nameAgeMap.has(k)) nameAgeMap.set(k, x); }
  }
  let marked = 0, ins = 0;
  // El cron solo necesita el delta reciente (ordenado por updated_at desc): los
  // recién marcados como encontrados aparecen primero. La carga histórica ya se hizo.
  for (let page = 0; page <= 6; page++) {
    let j; try { j = await get(`/personas?estado=encontrado&limit=200&page=${page}&sort=updated_at&order=desc`); } catch { break; }
    const arr = (j && j.data) || []; if (!arr.length) break;
    for (const p of arr) {
      const name = ((p.nombre || '') + ' ' + (p.apellido || '')).trim() || 'Sin nombre';
      const ced = norm(p.cedula), age = Number.isFinite(p.edad) ? p.edad : null, nk = nameKey(name);
      let hit = ced ? cedMap.get(ced) : null;
      if (!hit && nk && age != null) hit = nameAgeMap.get(nk + '#' + age);
      if (hit) { if (hit.status !== 'found_alive') { await pool.query("update person_reports set status='found_alive' where id=$1", [hit.id]); marked++; hit.status = 'found_alive'; } continue; }
      const ext = 'rvnzla:' + p.id; if (exExt.has(ext)) continue; exExt.add(ext);
      const sg = psig(name, ced, age, p.ultimaUbicacion); if (sg) { if (exSig.has(sg)) continue; exSig.add(sg); }
      const note = [p.descripcion, age ? 'Edad: ' + age : '', '(registro de reportavnzla.com)'].filter(Boolean).join(' · ').slice(0, 500);
      const foto = (p.fotoUrl || '').startsWith('http') ? p.fotoUrl : null;
      await pool.query(
        `insert into person_reports (status,given_name,full_name,cedula,cedula_type,is_minor,sex,parroquia,note_text,photo_path,reporter_id,ext_id,source_date)
         values ('found_alive',$1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) on conflict (ext_id) do nothing`,
        [name, p.cedula || null, ced ? 'V' : null, age != null && age > 0 && age < 18, p.genero || null, (p.ultimaUbicacion || '').slice(0, 120) || null, note, foto, ADMIN, ext]);
      ins++;
    }
    if (arr.length < 200) break;
  }
  return { encontrados_marcados: marked, nuevos_insertados: ins };
}

async function acopios() {
  const exExt = new Set((await pool.query("select ext_id from hazard_reports where ext_id like 'rvnzla_a:%'")).rows.map(r => r.ext_id));
  const ex = (await pool.query("select lat_pub,lng_pub from hazard_reports where category='aid_point' and deleted_at is null")).rows;
  const near = (la, ln) => ex.some(e => Math.abs(e.lat_pub - la) < 0.0015 && Math.abs(e.lng_pub - ln) < 0.0015);
  let ins = 0; const j = await get('/recursos?tipo=centro_acopio&pageSize=500');
  for (const a of (j.data || [])) {
    const ext = 'rvnzla_a:' + a.id; if (exExt.has(ext)) continue;
    if (typeof a.lat !== 'number' || typeof a.lng !== 'number') continue;
    const lat = t3(a.lat), lng = t3(a.lng); if (lat < 0.6 || lat > 12.5 || near(lat, lng)) continue;
    const desc = [a.recibe ? 'Recibe: ' + a.recibe : '', a.direccion ? 'Dirección: ' + a.direccion : '', a.contacto ? 'Contacto: ' + a.contacto : '', '(vía reportavnzla.com)'].filter(Boolean).join(' · ').slice(0, 500);
    await pool.query(
      `insert into hazard_reports (category,resource_status,verification,title,description,lat_pub,lng_pub,municipio,source_url,reporter_id,ext_id)
       values ('aid_point','open','community_confirmed',$1,$2,$3,$4,$5,'https://reportavnzla.com',$6,$7) on conflict (ext_id) do nothing`,
      [('Centro de acopio — ' + (a.nombre || 'Punto de ayuda')).slice(0, 90), desc, lat, lng, (a.direccion || '').slice(0, 80) || null, ADMIN, ext]);
    ins++; ex.push({ lat_pub: lat, lng_pub: lng });
  }
  return { nuevos: ins };
}

async function estructuras() {
  const exExt = new Set((await pool.query("select ext_id from hazard_reports where ext_id like 'rvnzla_e:%'")).rows.map(r => r.ext_id));
  const ex = (await pool.query("select lat_pub,lng_pub from hazard_reports where category in ('collapsed_building','damaged_building') and deleted_at is null")).rows;
  const near = (la, ln) => ex.some(e => Math.abs(e.lat_pub - la) < 0.0015 && Math.abs(e.lng_pub - ln) < 0.0015);
  const mapLv = l => l === 'total' ? ['collapsed_building', 'rojo'] : l === 'severo' ? ['damaged_building', 'naranja'] : ['damaged_building', 'amarillo'];
  let ins = 0; const j = await get('/recursos?tipo=estructura&pageSize=1000');
  for (const b of (j.data || [])) {
    const ext = 'rvnzla_e:' + b.id; if (exExt.has(ext)) continue;
    if (typeof b.lat !== 'number' || typeof b.lng !== 'number') continue;
    const lat = t3(b.lat), lng = t3(b.lng); if (lat < 0.6 || lat > 12.5 || near(lat, lng)) continue;
    const [cat, sev] = mapLv(b.nivelDanio);
    const desc = ((b.notas || b.descripcion || '').trim() + ' — Fuente: reportavnzla.com (comunitario). Sin verificación oficial en sitio.').trim().slice(0, 500);
    await pool.query(
      `insert into hazard_reports (category,severity,verification,title,description,lat_pub,lng_pub,municipio,source_url,reporter_id,ext_id)
       values ($1,$2,'community_confirmed',$3,$4,$5,$6,$7,'https://reportavnzla.com',$8,$9) on conflict (ext_id) do nothing`,
      [cat, sev, (b.nombre || 'Edificio afectado').slice(0, 90), desc, lat, lng, (b.ciudad || '').slice(0, 80) || null, ADMIN, ext]);
    ins++; ex.push({ lat_pub: lat, lng_pub: lng });
  }
  return { nuevos: ins };
}

(async () => {
  const ts = new Date().toISOString();
  try { console.log(ts, 'RV_PERSONAS', JSON.stringify(await personas())); } catch (e) { console.error(ts, 'RV_PERSONAS_ERR', e.message); }
  try { console.log(ts, 'RV_ACOPIOS', JSON.stringify(await acopios())); } catch (e) { console.error(ts, 'RV_ACOPIOS_ERR', e.message); }
  try { console.log(ts, 'RV_ESTRUCTURAS', JSON.stringify(await estructuras())); } catch (e) { console.error(ts, 'RV_ESTRUCTURAS_ERR', e.message); }
  await pool.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
