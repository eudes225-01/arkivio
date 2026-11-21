// plan-engine.mjs - Arkivio : gabarit JSON (layout) -> SVG / PDF / IFC4. Aucune dépendance.
// Mise en page automatique (format A5..A0, orientation, échelle) selon l'emprise ; cartouche Arkivio.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const EPS = 1e-6, f2 = n => n.toFixed(2).replace('.', ',');

export function resolveLayout(g, variante = 'A', standing = 'standard') {
  const L = g.layout, v = L?.variantes?.[variante];
  if (!v) throw new Error('variante sans layout : ' + variante);
  if (v.indisponible_standing?.[standing]) throw new Error(`variante ${variante} indisponible en ${standing} : ${v.indisponible_standing[standing]}`);
  const sur = v.surcharges_standing?.[standing] || {};
  const emp = sur.emprise_m || (v.emprise_m || L.emprise_m)[standing];
  if (!emp) throw new Error('pas d\'emprise pour ' + standing);
  return { W: emp[0], D: emp[1], pieces: sur.pieces || v.pieces, ouvertures: sur.ouvertures || v.ouvertures };
}

// Les fractions du layout s'appliquent à l'emprise complète (comme valider_gabarits.py).
export function buildModel(g, { variante = 'A', standing = 'standard' } = {}) {
  const { W, D, pieces, ouvertures } = resolveLayout(g, variante, standing);
  const vt = g.valeurs_techniques_par_defaut || {}, tE = (vt.murs?.exterieur_cm ?? 15) / 100, tI = (vt.murs?.cloison_cm ?? 12) / 100;
  const hsp = vt.hauteur_sous_plafond_m ?? 2.8, warnings = [];
  const rooms = pieces.map(p => {
    const r = { id: p.id, libelle: g.pieces.find(q => q.id === p.id)?.libelle || p.id, x0: p.x0 * W, x1: p.x1 * W, y0: p.y0 * D, y1: p.y1 * D };
    const e = (a, b, th) => Math.abs(a - b) < EPS ? tE : th / 2;
    r.aire = (r.x1 - r.x0 - e(r.x0, 0, tI) - e(r.x1, W, tI)) * (r.y1 - r.y0 - e(r.y0, 0, tI) - e(r.y1, D, tI));
    return r;
  });
  const walls = [{ x0: 0, y0: 0, x1: W, y1: tE }, { x0: 0, y0: D - tE, x1: W, y1: D },
    { x0: 0, y0: tE, x1: tE, y1: D - tE }, { x0: W - tE, y0: tE, x1: W, y1: D - tE }];
  const seg = new Map(), add = (k, a, b) => (seg.get(k) || seg.set(k, []).get(k)).push([a, b]);
  for (const r of rooms) {
    if (r.x0 > EPS) add('v' + r.x0.toFixed(4), r.y0, r.y1);
    if (r.x1 < W - EPS) add('v' + r.x1.toFixed(4), r.y0, r.y1);
    if (r.y0 > EPS) add('h' + r.y0.toFixed(4), r.x0, r.x1);
    if (r.y1 < D - EPS) add('h' + r.y1.toFixed(4), r.x0, r.x1);
  }
  for (const [k, iv] of seg) {
    iv.sort((a, b) => a[0] - b[0]);
    const mg = []; for (const s of iv) { const l = mg[mg.length - 1]; if (l && s[0] <= l[1] + EPS) l[1] = Math.max(l[1], s[1]); else mg.push([...s]); }
    const c = parseFloat(k.slice(1));
    for (const [a, b] of mg) walls.push(k[0] === 'v' ? { x0: c - tI / 2, x1: c + tI / 2, y0: a, y1: b, int: true } : { x0: a, x1: b, y0: c - tI / 2, y1: c + tI / 2, int: true });
  }
  const R = id => { const r = rooms.find(x => x.id === id); if (!r) throw new Error('pièce inconnue : ' + id); return r; };
  const ops = []; let np = 0, nf = 0;
  for (const o of ouvertures) {
    let cx, cy, axis, tgt = [W / 2, D / 2];
    if (o.entre) {
      const a = R(o.entre[0]), b = R(o.entre[1]); tgt = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
      if (Math.abs(a.x1 - b.x0) < EPS || Math.abs(b.x1 - a.x0) < EPS) {
        axis = 'y'; cx = Math.abs(a.x1 - b.x0) < EPS ? a.x1 : a.x0;
        const lo = Math.max(a.y0, b.y0), hi = Math.min(a.y1, b.y1); cy = lo + o.t * (hi - lo);
      } else {
        axis = 'x'; cy = Math.abs(a.y1 - b.y0) < EPS ? a.y1 : a.y0;
        const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1); cx = lo + o.t * (hi - lo);
      }
    } else {
      const r = R(o.piece);
      if (o.mur === 'S' || o.mur === 'N') { axis = 'x'; cy = o.mur === 'S' ? tE / 2 : D - tE / 2; cx = r.x0 + o.t * (r.x1 - r.x0); }
      else { axis = 'y'; cx = o.mur === 'W' ? tE / 2 : W - tE / 2; cy = r.y0 + o.t * (r.y1 - r.y0); }
    }
    const lo = o.entre ? 4 : 0, hi = o.entre ? walls.length : 4;
    let wi = -1;
    for (let i = lo; i < hi; i++) { const w = walls[i], hz = (w.x1 - w.x0) >= (w.y1 - w.y0);
      if (hz === (axis === 'x') && cx >= w.x0 - EPS && cx <= w.x1 + EPS && cy >= w.y0 - EPS && cy <= w.y1 + EPS) { wi = i; break; } }
    if (wi < 0) { warnings.push(`ouverture sans mur : ${o.kind} ${o.piece || o.entre}`); continue; }
    const w = walls[wi], hz = axis === 'x', th = hz ? w.y1 - w.y0 : w.x1 - w.x0;
    const half = o.w / 2; if (hz ? (cx - half < w.x0 - 0.01 || cx + half > w.x1 + 0.01) : (cy - half < w.y0 - 0.01 || cy + half > w.y1 + 0.01)) warnings.push(`ouverture plus large que le mur : ${o.kind} ${o.piece || o.entre}`);
    const sgn = (hz ? Math.sign(tgt[1] - cy) : Math.sign(tgt[0] - cx)) || 1;
    ops.push({ kind: o.kind, tag: o.kind === 'porte' ? 'P' + (++np) : 'F' + (++nf), axis, cx, cy, w: o.w, h: o.h, sill: o.sill || 0, th, wall: wi, sgn });
  }
  return { W, D, tE, tI, hsp, rooms, walls, ops, variante, standing, warnings };
}

// ===================== MISE EN PAGE, DESSIN, CARTOUCHE =====================
// Formats papier (mm, portrait), facteur de taille des textes et échelle maximale tolérée par format.
export const FORMATS = { A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
const ORDER = ['A5', 'A4', 'A3', 'A2', 'A1', 'A0'];
const KF = { A5: 0.75, A4: 0.85, A3: 1, A2: 1.25, A1: 1.55, A0: 1.9 };
const DENS = [50, 100, 200, 500, 1000];                       // échelles préférées 1/50 ... 1/1000
const MAXFMT = { 50: 'A3', 100: 'A2', 200: 'A1', 500: 'A0', 1000: 'A0' };   // plus grand format accepté par échelle
const ORANGE = '#E8590C', NOIR = '#111111', GRIS = '#6b6b6b';

// Largeurs Helvetica (1/1000 em), ASCII 32..126 : sert à mesurer les textes pour éviter tout chevauchement.
const HR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
export const textW = (s, size, bold = false) => {
  const T = bold ? HB : HR; let w = 0;
  for (const ch of String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')) { const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? T[c - 32] : ch === '²' ? 333 : ch === '±' ? 584 : ch === '°' ? 400 : 556; }
  return w * size / 1000;
};
const fitSize = (s, size, maxW, bold, min = 1.4) => { let z = size; while (z > min && textW(s, z, bold) > maxW) z -= 0.1; return z; };
const clip = (s, size, maxW, bold) => { s = String(s); if (textW(s, size, bold) <= maxW) return s; while (s.length > 1 && textW(s + '...', size, bold) > maxW) s = s.slice(0, -1); return s + '...'; };

// Choisit format, orientation et échelle selon l'emprise à dessiner (bâtiment ou, plus tard, terrain) en mètres.
export function choisirMiseEnPage(w, d, { format = 'auto', echelle = 'auto', orientation = 'auto' } = {}) {
  const dens = echelle === 'auto' ? DENS : [Number(String(echelle).replace('1/', ''))];
  const fmts = format === 'auto' ? ORDER : [String(format).toUpperCase()];
  if (fmts.some(f => !FORMATS[f])) throw new Error('format inconnu : ' + format);
  let fallback = null;
  for (const den of dens) {
    const fits = [];
    for (const f of fmts) for (const o of ['portrait', 'paysage']) {
      if (orientation !== 'auto' && o !== orientation) continue;
      const k = KF[f], [a, b] = FORMATS[f], PW = o === 'portrait' ? a : b, PH = o === 'portrait' ? b : a, fm = Math.round(8 + 2 * k);
      const needW = w * 1000 / den + 40 * k, needH = d * 1000 / den + 58 * k, Wf = PW - 2 * fm, Hf = PH - 2 * fm - 50 * k;
      const c = { f, o, den, k, PW, PH, fm, fits: needW <= Wf && needH <= Hf, slack: Math.min((Wf - needW) / Wf, (Hf - needH) / Hf) };
      if (c.fits) fits.push(c); else if (!fallback || c.slack > fallback.slack) fallback = c;
    }
    if (!fits.length) continue;
    fits.sort((x, y) => FORMATS[x.f][0] * FORMATS[x.f][1] - FORMATS[y.f][0] * FORMATS[y.f][1] || y.slack - x.slack);
    const best = fits[0];
    if (format === 'auto' && echelle === 'auto' && ORDER.indexOf(best.f) > ORDER.indexOf(MAXFMT[den]) && den !== DENS[DENS.length - 1]) continue;
    return best;
  }
  if (fallback) return fallback;                       // demande forcée qui ne tient pas : on dessine quand même
  throw new Error('aucune mise en page possible');
};

const wrap = (s, size, maxW, bold) => {
  if (textW(s, size, bold) <= maxW) return [s];
  const out = []; let cur = '';
  for (const wd of String(s).split(' ')) { const t = cur ? cur + ' ' + wd : wd;
    if (textW(t, size, bold) <= maxW || !cur) cur = t; else { out.push(cur); cur = wd; } }
  out.push(cur); return out.some(l => textW(l, size, bold) > maxW) ? null : out;
};
const ov = (a, b, g = 0) => a[0] < b[2] + g && a[2] > b[0] - g && a[1] < b[3] + g && a[3] > b[1] - g;

export function drawPlan(m, g, o = {}) {
  const v = g.cartouche?.valeurs || {}, fd = g.cartouche?.format_defaut;
  const lay = choisirMiseEnPage(m.W, m.D, { format: o.format ?? (!fd || fd === 'auto' ? 'auto' : fd), echelle: o.echelle ?? 'auto', orientation: o.orientation ?? 'auto' });
  const { PW, PH, fm, k, den } = lay, S = 1000 / den, Wf = PW - 2 * fm, hC = 50 * k, areaB = PH - fm - hC;
  const ML = 22 * k, MR = 18 * k, MT = 22 * k, MB = 36 * k, planW = m.W * S, planH = m.D * S;
  const ox = fm + ML + (Wf - ML - MR - planW) / 2, oy = fm + MT + (areaB - fm - MT - MB - planH) / 2;
  const X = x => ox + x * S, Y = y => oy + (m.D - y) * S, d = [];
  d.page = { format: lay.f, orientation: lay.o, echelle: den, PW, PH, k, tient: lay.fits };
  const T = (x, y, s, size, q = {}) => d.push({ t: 'text', x, y, s, size, ...q });
  const Ln = (x1, y1, x2, y2, sw = 0.25, q = {}) => d.push({ t: 'line', x1, y1, x2, y2, sw, ...q });
  const Rc = (x, y, w, h, sw = 0.25, q = {}) => d.push({ t: 'rect', x, y, w, h, sw, ...q });
  const obs = [], obsPts = [];
  // surface « 12,34 m² » : le 2 est un petit texte relevé (plus fiable que le glyphe ²)
  const M2 = (x, y, s, z, rot) => { const w1 = textW(s, z), w2 = textW('2', z * 0.6), tot = w1 + w2;
    if (!rot) { T(x - tot / 2, y, s, z); T(x - tot / 2 + w1, y - z * 0.38, '2', z * 0.6); }
    else { T(x, y + tot / 2, s, z, { rot: -90 }); T(x - z * 0.38, y + tot / 2 - w1, '2', z * 0.6, { rot: -90 }); } };
  // cadre
  Rc(fm - 1.6, fm - 1.6, PW - 2 * fm + 3.2, PH - 2 * fm + 3.2, 0.25); Rc(fm, fm, PW - 2 * fm, PH - 2 * fm, 0.9);
  // murs
  for (const w of m.walls) Rc(X(w.x0), Y(w.y1), (w.x1 - w.x0) * S, (w.y1 - w.y0) * S, 0, { fill: '#1a1a1a' });
  // ouvertures
  const tg = 1.7 * k;
  for (const q of m.ops) {
    const hz = q.axis === 'x', cw = (hz ? q.w : q.th + 0.04) * S, ch = (hz ? q.th + 0.04 : q.w) * S;
    Rc(X(q.cx) - cw / 2, Y(q.cy) - ch / 2, cw, ch, 0, { fill: 'white' });
    if (q.kind === 'fenetre') for (const kk of [-1, 0, 1]) { const f = kk * q.th / 2;
      hz ? Ln(X(q.cx - q.w / 2), Y(q.cy + f), X(q.cx + q.w / 2), Y(q.cy + f), 0.2) : Ln(X(q.cx + f), Y(q.cy - q.w / 2), X(q.cx + f), Y(q.cy + q.w / 2), 0.2); }
    if (q.kind === 'porte') {
      const pts = [], n = 12; let hx, hy;
      if (hz) { hx = q.cx - q.w / 2; hy = q.cy; Ln(X(hx), Y(hy), X(hx), Y(hy + q.sgn * q.w), 0.35);
        for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; pts.push([X(hx + q.w * Math.cos(a)), Y(hy + q.sgn * q.w * Math.sin(a))]); } }
      else { hx = q.cx; hy = q.cy - q.w / 2; Ln(X(hx), Y(hy), X(hx + q.sgn * q.w), Y(hy), 0.35);
        for (let i = 0; i <= n; i++) { const a = i / n * Math.PI / 2; pts.push([X(hx + q.sgn * q.w * Math.sin(a)), Y(hy + q.w * Math.cos(a))]); } }
      d.push({ t: 'poly', pts, sw: 0.15 });
      const lp = [[X(hx), Y(hy)], ...pts]; for (let i = 0; i < lp.length - 1; i++) { const a = lp[i], b = lp[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)); for (let j = 0; j <= n; j++) obsPts.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); }
      const lf = hz ? [[X(hx), Y(hy)], [X(hx), Y(hy + q.sgn * q.w)]] : [[X(hx), Y(hy)], [X(hx + q.sgn * q.w), Y(hy)]], nl = Math.ceil(q.w * S / 0.5); for (let j = 0; j <= nl; j++) obsPts.push([lf[0][0] + (lf[1][0] - lf[0][0]) * j / nl, lf[0][1] + (lf[1][1] - lf[0][1]) * j / nl]);
    }
    if (q.kind !== 'baie') {
      const off = q.th * S / 2 + 1.0 * k + textW(q.tag, tg) / 2 + (hz ? 0.35 * tg : 0);
      const tx = hz ? X(q.cx) : X(q.cx) - q.sgn * off, ty = (hz ? Y(q.cy) + q.sgn * off : Y(q.cy)) + 0.35 * tg, tw = textW(q.tag, tg);
      T(tx, ty, q.tag, tg, { anchor: 'middle', color: GRIS }); obs.push([tx - tw / 2, ty - tg * 0.75, tx + tw / 2, ty + tg * 0.1]);
    }
  }
  obs.push([X(m.W) + 9 * k - 6 * k, oy + 12 * k - 10 * k, X(m.W) + 9 * k + 6 * k, oy + 12 * k + 5 * k]);
  // libellés des pièces : taille adaptée, retour à la ligne, texte vertical si besoin, évitement des portes et repères
  const rotW = []; 
  for (const r of m.rooms) {
    const pad = 1.0 * k, ix0 = X(r.x0 + (r.x0 < EPS ? m.tE : m.tI / 2)), ix1 = X(r.x1 - (r.x1 > m.W - EPS ? m.tE : m.tI / 2));
    const iy0 = Y(r.y1 - (r.y1 > m.D - EPS ? m.tE : m.tI / 2)), iy1 = Y(r.y0 + (r.y0 < EPS ? m.tE : m.tI / 2));
    const area = f2(r.aire) + ' m', box = [ix0 + pad, iy0 + pad, ix1 - pad, iy1 - pad], cx0 = (ix0 + ix1) / 2, cy0 = (iy0 + iy1) / 2;
    let done = false;
    for (const rot of [false, true]) {
      const bw = rot ? box[3] - box[1] : box[2] - box[0], bh = rot ? box[2] - box[0] : box[3] - box[1];
      for (const sz of [2.6, 2.3, 2.0, 1.8, 1.6].map(z => z * k)) {
        if (rot && sz < 1.8 * k) continue;
        const lines = wrap(r.libelle, sz, bw, true); if (!lines || lines.length > 3) continue;
        const az = sz * 0.85, lh = 1.2 * sz, h = lines.length * lh + az * 1.25, w = Math.max(textW(area, az) + textW('2', az * 0.6), ...lines.map(l => textW(l, sz, true)));
        if (w > bw || h > bh) continue;
        const cand = []; for (let dy = -bh / 2; dy <= bh / 2; dy += 0.8) for (let dx = -bw / 2; dx <= bw / 2; dx += 0.8) cand.push([dx, dy]);
        cand.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
        for (const [dx, dy] of cand) {
          const cx = cx0 + (rot ? dy : dx), cy = cy0 + (rot ? dx : dy), rect = rot ? [cx - h / 2, cy - w / 2, cx + h / 2, cy + w / 2] : [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2];
          if (rect[0] < box[0] || rect[1] < box[1] || rect[2] > box[2] || rect[3] > box[3] || obs.some(b => ov(rect, b, 0.6)) || obsPts.some(p => p[0] > rect[0] - 0.7 && p[0] < rect[2] + 0.7 && p[1] > rect[1] - 0.7 && p[1] < rect[3] + 0.7)) continue;
          if (!rot) { const top = cy - h / 2; lines.forEach((l, i) => T(cx, top + sz * 0.9 + lh * i, l, sz, { anchor: 'middle', bold: true })); M2(cx, top + lines.length * lh + az * 0.95, area, az, false); }
          else { const left = cx - h / 2; lines.forEach((l, i) => T(left + sz * 0.9 + lh * i, cy, l, sz, { anchor: 'middle', bold: true, rot: -90 })); M2(left + lines.length * lh + az * 0.95, cy, area, az, true); }
          done = true; break;
        }
        if (done) break;
      }
      if (done) break;
    }
    if (!done && r.x1 > m.W - EPS) {       // pièce trop petite touchant le mur est : libellé à droite du plan, avec trait de rappel
      const sz = 2.2 * k, az = sz * 0.85, w = Math.max(textW(r.libelle, sz, true), textW(area, az) + textW('2', az * 0.6)), h = 1.2 * sz + az * 1.25, lx = X(m.W) + 3.2 * k;
      let ly = cy0 - h / 2;
      for (let t = 0; t < 40; t++) { const rect = [lx, ly, lx + w, ly + h]; if (!obs.some(b => ov(rect, b, 0.8))) break; ly += (t % 2 ? -1 : 1) * (t + 1) * 0.8; }
      Ln(ix1 - 0.6, cy0, lx - 0.8, ly + h / 2, 0.15); T(lx, ly + sz * 0.9, r.libelle, sz, { bold: true }); M2(lx + (textW(area, az) + textW('2', az * 0.6)) / 2, ly + 1.2 * sz + az * 0.95, area, az, false);
      obs.push([lx, ly, lx + w, ly + h]); done = true;
    }
    if (!done) { const sz = 1.5 * k; T(cx0, cy0, clip(r.libelle, sz, ix1 - ix0 - 1, true), sz, { anchor: 'middle', bold: true }); M2(cx0, cy0 + 1.3 * sz, area, sz * 0.85, false); m.warnings.push('libellé trop grand pour la pièce : ' + r.libelle); }
  }
  // chaînes de cotes (textes décalés sur 2 niveaux quand le segment est trop court)
  const dz = 2.0 * k, bp = a => [...new Set(m.rooms.flatMap(r => [r[a + '0'], r[a + '1']]).map(q => +q.toFixed(3)))].sort((p, q) => p - q);
  const tick = (x, y) => Ln(x - 0.8, y + 0.8, x + 0.8, y - 0.8, 0.35);
  const chain = (pts, vertical, lineAt, size, bold) => {
    const P = pts.map(p => vertical ? Y(p) : X(p)), rows = [[], []];
    const ext = vertical ? (a => Ln(ox - 1, a, lineAt - 1.2, a, 0.12)) : (a => Ln(a, oy - 1, a, lineAt - 1.2, 0.12));
    vertical ? Ln(lineAt, P[0], lineAt, P[P.length - 1], 0.3) : Ln(P[0], lineAt, P[P.length - 1], lineAt, 0.3);
    P.forEach(p => { ext(p); vertical ? tick(lineAt, p) : tick(p, lineAt); });
    for (let i = 0; i < P.length - 1; i++) {
      const c = (P[i] + P[i + 1]) / 2, len = pts[i + 1] - pts[i], s = f2(len), w = textW(s, size, bold) + 0.8; let row = w > Math.abs(P[i + 1] - P[i]) + 0.5 ? 1 : 0;
      if (len < 0.15) m.warnings.push(`cote très courte (${s} m) : décalage de cloisons à vérifier`);
      while (row < 1 && rows[row].some(iv => c - w / 2 < iv[1] && c + w / 2 > iv[0])) row++;
      rows[row].push([c - w / 2, c + w / 2]);
      const base = (vertical ? lineAt : lineAt) - (0.9 * k + row * 2.7 * k) * (vertical ? 1 : 1);
      if (vertical) { T(base, c, s, size, { anchor: 'middle', rot: -90, bold }); if (row) Ln(lineAt, c, base + 0.3, c, 0.1); }
      else { T(c, base, s, size, { anchor: 'middle', bold }); if (row) Ln(c, lineAt, c, base + 0.3, 0.1); }
    }
  };
  const bx = bp('x'), by = bp('y');
  chain(bx, false, oy - 7 * k, dz, false); chain([0, m.W], false, oy - 14 * k, 2.6 * k, true);
  chain(by, true, ox - 7 * k, dz, false); chain([0, m.D], true, ox - 14 * k, 2.6 * k, true);
  // entrée, échelle graphique, flèche du nord
  const pb = oy + planH, ex = X(m.W / 2);
  d.push({ t: 'poly', pts: [[ex, pb + 2 * k], [ex - 1.6 * k, pb + 4.4 * k], [ex + 1.6 * k, pb + 4.4 * k]], fill: NOIR, close: true, sw: 0.1 });
  T(ex, pb + 7.4 * k, 'ENTRÉE - CÔTÉ RUE', 2.4 * k, { anchor: 'middle', bold: true });
  const nice = [1, 2, 5, 10, 20, 50, 100].find(L => L * S >= 22) || 100, nb = nice >= 5 ? 5 : nice >= 2 ? 2 : 1, sy = pb + 11.5 * k;
  for (let i = 0; i < nb; i += 2) Rc(ox + i * nice / nb * S, sy, nice / nb * S, 1.5 * k, 0, { fill: NOIR }); Rc(ox, sy, nice * S, 1.5 * k, 0.25);
  T(ox, sy + 4.4 * k, '0', 1.8 * k, { anchor: 'middle' }); T(ox + nice * S, sy + 4.4 * k, nice + ' m', 1.8 * k, { anchor: 'middle' });
  const nx = X(m.W) + 9 * k, ny = oy + 12 * k, nr = 4.4 * k, nc = []; for (let i = 0; i < 28; i++) nc.push([nx + nr * Math.cos(i / 28 * 2 * Math.PI), ny + nr * Math.sin(i / 28 * 2 * Math.PI)]);
  d.push({ t: 'poly', pts: nc, close: true, sw: 0.3 }); d.push({ t: 'poly', pts: [[nx, ny - nr * 0.85], [nx + 1.7 * k, ny + 2.6 * k], [nx, ny + 1.3 * k], [nx - 1.7 * k, ny + 2.6 * k]], fill: NOIR, close: true, sw: 0.1 });
  T(nx, ny - nr - 1.2 * k, 'N', 3.2 * k, { anchor: 'middle', bold: true });
  // titre du dessin (plus grand que les textes des pièces) + sous-titre
  const titre = o.titre || 'PLAN RDC COTÉ', tsz = fitSize(titre, 7 * k, Wf - 10, true, 4), cxm = fm + Wf / 2, ty = areaB - 10 * k, tw = textW(titre, tsz, true);
  T(cxm, ty, titre, tsz, { anchor: 'middle', bold: true }); Ln(cxm - tw / 2, ty + 1.7 * k, cxm + tw / 2, ty + 1.7 * k, 0.7 * k); Ln(cxm - tw / 2, ty + 3.1 * k, cxm + tw / 2, ty + 3.1 * k, 0.25 * k, { color: ORANGE });
  const sub = `${g.meta.libelle} - standing ${m.standing} - variante ${m.variante} - échelle 1/${den} - cotes en mètres`;
  T(cxm, areaB - 2.6 * k, clip(sub, 3 * k, Wf - 10, false), fitSize(sub, 3 * k, Wf - 10, false, 2), { anchor: 'middle' });
  // ---------------- cartouche ----------------
  const cx = fm, cy = PH - fm - hC, hs = 2 * k, rh = [18 * k, 12 * k, 9 * k, 9 * k], sw = 0.4;
  Rc(cx, cy, Wf, hC, 0.9); Rc(cx, cy, Wf, hs, 0, { fill: ORANGE });
  let yy = cy + hs; const rowY = rh.map(h => { const a = yy; yy += h; return a; });
  for (let i = 1; i < 4; i++) Ln(cx, rowY[i], cx + Wf, rowY[i], sw);
  const cell = (x, y, w, h, label, value, vs, bold = true, color = NOIR) => {
    T(x + 1.6 * k, y + 2.6 * k, label, 1.7 * k, { color: GRIS });
    const s = clip(value, vs, w - 3.2 * k, bold), z = fitSize(s, vs, w - 3.2 * k, bold, 1.8 * k);
    T(x + 1.6 * k, y + h - 2.1 * k, s, z, { bold, color });
  };
  // ligne 1 : logo | projet | marque
  const wl = 26 * k, wr = 44 * k, wm = Wf - wl - wr; Ln(cx + wl, rowY[0], cx + wl, rowY[1], sw); Ln(cx + wl + wm, rowY[0], cx + wl + wm, rowY[1], sw);
  Rc(cx + 3 * k, rowY[0] + 2 * k, wl - 6 * k, rh[0] - 4 * k, 0, { fill: ORANGE });
  { const lx = cx + wl / 2, ly = rowY[0] + rh[0] / 2, u = Math.min(wl - 6 * k, rh[0] - 4 * k) / 2;
    d.push({ t: 'poly', pts: [[lx - 0.62 * u, ly + 0.5 * u], [lx - 0.62 * u, ly - 0.05 * u], [lx, ly - 0.62 * u], [lx + 0.62 * u, ly - 0.05 * u], [lx + 0.62 * u, ly + 0.5 * u]], sw: 0.9 * k, color: '#ffffff' });
    d.push({ t: 'poly', pts: [[lx - 0.22 * u, ly + 0.5 * u], [lx - 0.22 * u, ly + 0.12 * u], [lx + 0.22 * u, ly + 0.12 * u], [lx + 0.22 * u, ly + 0.5 * u]], sw: 0.7 * k, color: '#ffffff' }); }
  const projet = o.projet || (v.projet && !/saisi/i.test(v.projet) ? v.projet : null), l1 = projet || g.meta.libelle, l2 = projet ? g.meta.libelle : `Maison individuelle de plain-pied - standing ${m.standing}`;
  const z1 = fitSize(l1.toUpperCase(), 5 * k, wm - 6 * k, true, 2.4 * k), z2 = fitSize(l2, 3.2 * k, wm - 6 * k, false, 2 * k);
  T(cx + wl + 3 * k, rowY[0] + 8 * k, clip(l1.toUpperCase(), z1, wm - 6 * k, true), z1, { bold: true }); T(cx + wl + 3 * k, rowY[0] + 14 * k, clip(l2, z2, wm - 6 * k, false), z2);
  T(cx + wl + wm + wr / 2, rowY[0] + 9 * k, 'ARKIVIO', 5 * k, { anchor: 'middle', bold: true });
  Ln(cx + wl + wm + 6 * k, rowY[0] + 11.2 * k, cx + Wf - 6 * k, rowY[0] + 11.2 * k, 0.6 * k, { color: ORANGE });
  T(cx + wl + wm + wr / 2, rowY[0] + 15.2 * k, 'plan indicatif - à valider', 2 * k, { anchor: 'middle', color: GRIS });
  // ligne 2 : plan | standing - variante | date
  const w2 = [0.52 * Wf, 0.26 * Wf, 0.22 * Wf], xs2 = [cx, cx + w2[0], cx + w2[0] + w2[1]]; Ln(xs2[1], rowY[1], xs2[1], rowY[2], sw); Ln(xs2[2], rowY[1], xs2[2], rowY[2], sw);
  const dt = o.date ? new Date(o.date) : new Date(), ds = [dt.getDate(), dt.getMonth() + 1].map(n => String(n).padStart(2, '0')).join('/') + '/' + dt.getFullYear();
  const planFull = `${titre} - NIV ±0,00 - HSP ${f2(m.hsp)} m`;
  cell(xs2[0], rowY[1], w2[0], rh[1], 'PLAN', textW(planFull, 3.2 * k, true) <= w2[0] - 3.2 * k ? planFull : titre, 4.4 * k);
  cell(xs2[1], rowY[1], w2[1], rh[1], 'STANDING - VARIANTE', `${m.standing} - ${m.variante}`, 3.4 * k);
  cell(xs2[2], rowY[1], w2[2], rh[1], 'DATE', ds, 3.4 * k);
  // ligne 3 : phase | échelle | format | planche
  const w3 = [0.4, 0.2, 0.2, 0.2].map(p => p * Wf); let x3 = cx;
  [['PHASE', o.phase || 'Avant-projet indicatif', false], ['ÉCHELLE', '1/' + den, true], ['FORMAT', `${lay.f} ${lay.o}`, true], ['PLANCHE', o.planche || '01/01', true]].forEach((c, i) => {
    if (i) Ln(x3, rowY[2], x3, rowY[3], sw); cell(x3, rowY[2], w3[i], rh[2], c[0], c[1], 3 * k, c[2]); x3 += w3[i]; });
  // ligne 4 : maître d'ouvrage | maître d'œuvre
  const moa = o.maitre_ouvrage || v.maitre_ouvrage || '', moe = o.maitre_oeuvre || v.maitre_oeuvre || ''; Ln(cx + Wf / 2, rowY[3], cx + Wf / 2, cy + hC, sw);
  cell(cx, rowY[3], Wf / 2, rh[3], "MAÎTRE D'OUVRAGE", moa, 2.8 * k, false); cell(cx + Wf / 2, rowY[3], Wf / 2, rh[3], "MAÎTRE D'ŒUVRE", moe, 2.8 * k, false);
  return d;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rgb = c => { const q = /^#(..)(..)(..)$/.exec(c || ''); return q ? q.slice(1).map(x => (parseInt(x, 16) / 255).toFixed(3)).join(' ') : c === 'white' ? '1 1 1' : '0 0 0'; };
const svgc = c => c === 'white' ? '#ffffff' : (c || '#000000');

export function toSVG(d) {
  const { PW, PH } = d.page || { PW: 420, PH: 297 };
  const el = d.map(e => {
    if (e.t === 'rect') return `<rect x="${e.x.toFixed(2)}" y="${e.y.toFixed(2)}" width="${e.w.toFixed(2)}" height="${e.h.toFixed(2)}" fill="${e.fill ? svgc(e.fill) : 'none'}" stroke="${e.fill || !e.sw ? 'none' : '#000'}" stroke-width="${e.sw ?? 0.25}"/>`;
    if (e.t === 'line') return `<line x1="${e.x1.toFixed(2)}" y1="${e.y1.toFixed(2)}" x2="${e.x2.toFixed(2)}" y2="${e.y2.toFixed(2)}" stroke="${svgc(e.color)}" stroke-width="${e.sw || 0.25}"/>`;
    if (e.t === 'poly') return `<${e.close ? 'polygon' : 'polyline'} points="${e.pts.map(p => p.map(q => +q.toFixed(2)).join(',')).join(' ')}" fill="${e.fill ? svgc(e.fill) : 'none'}" stroke="${svgc(e.color)}" stroke-width="${e.sw || 0.2}" stroke-linejoin="round"/>`;
    const tr = e.rot ? ` transform="rotate(${e.rot} ${e.x.toFixed(2)} ${e.y.toFixed(2)})"` : '';
    return `<text x="${e.x.toFixed(2)}" y="${e.y.toFixed(2)}" font-size="${e.size.toFixed(2)}" font-family="Helvetica,Arial,sans-serif" font-weight="${e.bold ? 700 : 400}" text-anchor="${e.anchor || 'start'}" fill="${svgc(e.color)}"${tr}>${esc(e.s)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}mm" height="${PH}mm"><rect width="${PW}" height="${PH}" fill="#fff"/>\n${el}\n</svg>`;
}

export function toPDF(d) {
  const { PW, PH } = d.page || { PW: 420, PH: 297 }, k = 72 / 25.4, H = PH * k, Wp = PW * k, o = [];
  const P = (x, y) => `${(x * k).toFixed(2)} ${(H - y * k).toFixed(2)}`;
  const ps = s => String(s).replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/’/g, "'").replace(/[—–]/g, '-').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  for (const e of d) {
    if (e.t === 'rect') o.push(e.fill ? `${rgb(e.fill)} rg ${P(e.x, e.y + e.h)} ${(e.w * k).toFixed(2)} ${(e.h * k).toFixed(2)} re f` : `${((e.sw ?? 0.25) * k).toFixed(2)} w 0 0 0 RG ${P(e.x, e.y + e.h)} ${(e.w * k).toFixed(2)} ${(e.h * k).toFixed(2)} re S`);
    else if (e.t === 'line') o.push(`${((e.sw || 0.25) * k).toFixed(2)} w ${rgb(e.color)} RG ${P(e.x1, e.y1)} m ${P(e.x2, e.y2)} l S`);
    else if (e.t === 'poly') { const path = e.pts.map((p, i) => P(p[0], p[1]) + (i ? ' l' : ' m')).join(' ') + (e.close ? ' h' : '');
      o.push(`${e.fill ? rgb(e.fill) + ' rg ' : ''}${((e.sw || 0.2) * k).toFixed(2)} w ${rgb(e.color)} RG ${path} ${e.fill ? 'B' : 'S'}`); }
    else { const w = textW(e.s, e.size, e.bold), a = e.anchor === 'middle' ? 0.5 : e.anchor === 'end' ? 1 : 0, sz = (e.size * k).toFixed(2);
      if (e.rot) o.push(`BT ${rgb(e.color)} rg /F${e.bold ? 2 : 1} ${sz} Tf 0 1 -1 0 ${P(e.x, e.y + w * a)} Tm (${ps(e.s)}) Tj ET`);
      else o.push(`BT ${rgb(e.color)} rg /F${e.bold ? 2 : 1} ${sz} Tf ${P(e.x - w * a, e.y)} Td (${ps(e.s)}) Tj ET`); }
  }
  const content = Buffer.from(o.join('\n'), 'latin1');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Wp.toFixed(2)} ${H.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`, null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
  let out = Buffer.from('%PDF-1.4\n'); const off = [];
  objs.forEach((s, i) => { off.push(out.length);
    const body = i === 3 ? Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]) : Buffer.from(s);
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]); });
  const xr = out.length;
  const x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('') +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xr}\n%%EOF\n`;
  return Buffer.concat([out, Buffer.from(x)]);
}

export function toIFC(m, { projet = 'Maison Arkivio' } = {}) {
  const L = []; let n = 0; const A = s => { L.push(`#${++n}=${s};`); return `#${n}`; };
  const r = x => (Math.abs(x) < 1e-9 ? 0 : x).toFixed(4).replace(/0+$/, '');
  const q = s => "'" + String(s).replace(/'/g, "''").replace(/[^\x20-\x7e]/g, c => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`) + "'";
  const B = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  const G = () => { const b = crypto.randomBytes(22); let s = B[b[0] % 4]; for (let i = 1; i < 22; i++) s += B[b[i] % 64]; return `'${s}'`; };
  const pt = (x, y, z) => A(`IFCCARTESIANPOINT((${r(x)},${r(y)},${r(z)}))`), dir = (x, y, z) => A(`IFCDIRECTION((${r(x)},${r(y)},${r(z)}))`);
  const O = pt(0, 0, 0), DZ = dir(0, 0, 1), DX = dir(1, 0, 0), DY = dir(0, 1, 0);
  const ax = (p, z = '$', x = '$') => A(`IFCAXIS2PLACEMENT3D(${p},${z},${x})`), W0 = ax(O, DZ, DX);
  const ctx = A(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${W0},$)`);
  const sub = A(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const units = A(`IFCUNITASSIGNMENT((${A('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')},${A('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)')},${A('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)')},${A('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')}))`);
  const prj = A(`IFCPROJECT(${G()},$,${q(projet)},$,$,$,$,(${ctx}),${units})`);
  const lp = (par, p, z, x) => A(`IFCLOCALPLACEMENT(${par},${ax(p, z, x)})`);
  const sitePl = A(`IFCLOCALPLACEMENT($,${W0})`), bldPl = A(`IFCLOCALPLACEMENT(${sitePl},${W0})`), stPl = A(`IFCLOCALPLACEMENT(${bldPl},${W0})`);
  const site = A(`IFCSITE(${G()},$,'Terrain',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bld = A(`IFCBUILDING(${G()},$,${q(projet)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`);
  const st = A(`IFCBUILDINGSTOREY(${G()},$,'RDC',$,$,${stPl},$,$,.ELEMENT.,0.)`);
  const agg = (a, b) => A(`IFCRELAGGREGATES(${G()},$,$,$,${a},(${b}))`);
  agg(prj, site); agg(site, bld); agg(bld, st);
  const solid = (px, py, dx, dy, depth) => {
    const prof = A(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${A(`IFCAXIS2PLACEMENT2D(${A(`IFCCARTESIANPOINT((${r(px)},${r(py)}))`)},$)`)},${r(dx)},${r(dy)})`);
    const ext = A(`IFCEXTRUDEDAREASOLID(${prof},${ax(O)},${DZ},${r(depth)})`);
    return A(`IFCPRODUCTDEFINITIONSHAPE($,$,(${A(`IFCSHAPEREPRESENTATION(${sub},'Body','SweptSolid',(${ext}))`)}))`);
  };
  const cont = [], wp = [], wid = [];
  m.walls.forEach((w, i) => {
    const hz = (w.x1 - w.x0) >= (w.y1 - w.y0), len = hz ? w.x1 - w.x0 : w.y1 - w.y0, th = hz ? w.y1 - w.y0 : w.x1 - w.x0;
    const pl = lp(stPl, hz ? pt(w.x0, (w.y0 + w.y1) / 2, 0) : pt((w.x0 + w.x1) / 2, w.y0, 0), DZ, hz ? DX : DY);
    wp[i] = { pl, hz, w, th };
    wid[i] = A(`IFCWALL(${G()},$,${q(w.int ? 'Cloison' : 'Mur extérieur')},$,$,${pl},${solid(len / 2, 0, len, th, m.hsp)},$,.STANDARD.)`); cont.push(wid[i]);
  });
  cont.push(A(`IFCSLAB(${G()},$,'Dallage',$,$,${lp(stPl, pt(0, 0, -0.1), DZ, DX)},${solid(m.W / 2, m.D / 2, m.W, m.D, 0.1)},$,.BASESLAB.)`));
  cont.push(A(`IFCSLAB(${G()},$,'Dalle haute',$,$,${lp(stPl, pt(0, 0, m.hsp), DZ, DX)},${solid(m.W / 2, m.D / 2, m.W, m.D, 0.2)},$,.ROOF.)`));
  const sps = m.rooms.map(rm => A(`IFCSPACE(${G()},$,${q(rm.libelle)},$,$,${lp(stPl, pt(rm.x0, rm.y0, 0), DZ, DX)},${solid((rm.x1 - rm.x0) / 2, (rm.y1 - rm.y0) / 2, rm.x1 - rm.x0, rm.y1 - rm.y0, m.hsp)},${q(rm.libelle)},.ELEMENT.,.INTERNAL.,$)`));
  agg(st, sps.join(','));
  for (const o of m.ops) {
    const b = wp[o.wall], s = b.hz ? o.cx - b.w.x0 : o.cy - b.w.y0, opl = () => lp(b.pl, pt(s, 0, o.sill), '$', '$');
    const op = A(`IFCOPENINGELEMENT(${G()},$,${q('Ouverture ' + (o.tag))},$,$,${opl()},${solid(0, 0, o.w, b.th + 0.1, o.h)},$,.OPENING.)`);
    A(`IFCRELVOIDSELEMENT(${G()},$,$,$,${wid[o.wall]},${op})`);
    if (o.kind === 'baie') continue;
    const fl = A(o.kind === 'porte' ? `IFCDOOR(${G()},$,${q('Porte ' + o.tag)},$,$,${opl()},${solid(0, 0, o.w, 0.06, o.h)},$,${r(o.h)},${r(o.w)},.DOOR.,.NOTDEFINED.,$)`
      : `IFCWINDOW(${G()},$,${q('Fenêtre ' + o.tag)},$,$,${opl()},${solid(0, 0, o.w, 0.06, o.h)},$,${r(o.h)},${r(o.w)},.WINDOW.,.NOTDEFINED.,$)`);
    A(`IFCRELFILLSELEMENT(${G()},$,$,$,${op},${fl})`); cont.push(fl);
  }
  A(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${G()},$,$,$,(${cont.join(',')}),${st})`);
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('plan.ifc','${new Date().toISOString().slice(0, 19)}',('Arkivio'),('Arkivio'),'plan-engine.mjs','Arkivio','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${L.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2]) {
  // usage : node plan-engine.mjs gabarit.json [standing] [variante] [dossier] [--format=auto|A5..A0] [--echelle=auto|50|100|200|500]
  //         [--orientation=auto|portrait|paysage] [--projet=..] [--moa=..] [--moe=..] [--phase=..] [--planche=..] [--date=AAAA-MM-JJ] [--titre=..]
  const pos = [], fl = {};
  for (const a of process.argv.slice(2)) { const q = /^--([^=]+)=(.*)$/.exec(a); q ? (fl[q[1]] = q[2]) : pos.push(a); }
  const [file, standing = 'standard', variante = 'A', out = '.'] = pos;
  const g = JSON.parse(fs.readFileSync(file, 'utf8')), m = buildModel(g, { standing, variante });
  const opt = { format: fl.format, echelle: fl.echelle, orientation: fl.orientation, projet: fl.projet, maitre_ouvrage: fl.moa, maitre_oeuvre: fl.moe, phase: fl.phase, planche: fl.planche, date: fl.date, titre: fl.titre };
  const base = `${out}/plan_${g.meta.id.split('_')[0]}_${variante}_${standing}`, d = drawPlan(m, g, opt);
  fs.writeFileSync(base + '.svg', toSVG(d));
  fs.writeFileSync(base + '.pdf', toPDF(d));
  fs.writeFileSync(base + '.ifc', toIFC(m, { projet: g.meta.libelle }));
  console.log(base, '|', d.page.format, d.page.orientation, '1/' + d.page.echelle, '| pièces', m.rooms.length, '| murs', m.walls.length, '| ouvertures', m.ops.length, '| alertes', m.warnings.length);
  m.warnings.forEach(w => console.log('  !', w));
}
