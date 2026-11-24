// Génère un dossier de planches estimatives à partir des layouts disponibles.
// Les réseaux et détails structurels sont des schémas de métré, pas des plans d'exécution.
import fs from 'node:fs'
import { buildModel, drawPlan, toIFC, toPDF, toSVG } from '../engine/plan-engine.mjs'

const regles = JSON.parse(fs.readFileSync(new URL('../../data/regles_benin.json', import.meta.url), 'utf8'))
const W = 420, H = 297
const TITRES = {
  plan_ensemble: 'PLAN D’ENSEMBLE — IMPLANTATION INDICATIVE',
  vue_en_plan: 'PLAN RDC COTÉ',
  plan_amene: 'PLAN RDC AMÉNAGÉ — SCHÉMA',
  facades: 'ÉLÉVATIONS — FAÇADES SCHÉMATIQUES',
  coupe: 'COUPE A-A — SCHÉMA',
  toiture: 'PLAN DE TOITURE — SCHÉMA',
  electricite: 'PLAN ÉLECTRIQUE — PRÉMÉTRÉ',
  climatisation: 'CLIMATISATION ET PRISES — PRÉMÉTRÉ',
  plomberie: 'PLAN DE PLOMBERIE — PRÉMÉTRÉ',
  fondation: 'PLAN DE FONDATION — HYPOTHÈSE DE MÉTRÉ',
  coffrage: 'PLAN DE COFFRAGE — HYPOTHÈSE DE MÉTRÉ',
  poutraison: 'PLAN DE POUTRAISON — SCHÉMA INDICATIF',
}

function pdfMulti(pages) {
  const contents = pages.map((page) => {
    const s = toPDF(page).toString('latin1')
    const m = /<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/.exec(s)
    if (!m) throw new Error('Impossible de lire une page du dossier PDF.')
    return Buffer.from(m[1], 'latin1')
  })
  const n = contents.length, font1 = 3 + n * 2, font2 = font1 + 1
  const kids = contents.map((_, i) => `${3 + i * 2} 0 R`).join(' ')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`,
  ]
  contents.forEach((content, i) => {
    const page = pages[i].page || { PW: W, PH: H }
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${(page.PW * 72 / 25.4).toFixed(2)} ${(page.PH * 72 / 25.4).toFixed(2)}] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`)
    objs.push(null)
  })
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  let out = Buffer.from('%PDF-1.4\n'), offsets = []
  objs.forEach((obj, i) => {
    offsets.push(out.length)
    const body = obj === null
      ? Buffer.concat([Buffer.from(`<< /Length ${contents[(i - 3) / 2].length} >>\nstream\n`), contents[(i - 3) / 2], Buffer.from('\nendstream')])
      : Buffer.from(obj)
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
  })
  const xref = out.length
  const table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.concat([out, Buffer.from(table)])
}

function pageBase(planche, g, demande) {
  const d = []
  d.page = { PW: W, PH: H, format: 'A3', orientation: 'paysage', echelle: 100 }
  const line = (x1, y1, x2, y2, color = '#111', sw = 0.45) => d.push({ t: 'line', x1, y1, x2, y2, color, sw })
  const rect = (x, y, w, h, color = '#111', sw = 0.45, fill) => d.push({ t: 'rect', x, y, w, h, color, sw, fill })
  const txt = (x, y, s, size = 3.2, bold = false, color = '#111') => d.push({ t: 'text', x, y, s: String(s), size, bold, color })
  rect(8, 8, 404, 281, '#111', 0.6)
  txt(14, 18, TITRES[planche.type] || planche.cartouche || planche.type, 5.2, true)
  txt(14, 25, `${g.meta.libelle} · variante ${demande.variante} · standing ${demande.standing}`, 3.2)
  txt(14, 283, 'DOCUMENT ESTIMATIF — À VALIDER PAR UN PROFESSIONNEL AVANT TOUTE EXÉCUTION', 2.7, true, '#a33')
  txt(292, 283, 'ARKIVIO · MÉTRÉ PRÉLIMINAIRE', 2.7, true)
  return { d, line, rect, txt }
}

function dessinerBase(m, ctx, { amenage = false, markers = false } = {}) {
  const { rect, line, txt } = ctx, bx = 25, by = 45, bw = 245, bh = 205
  const scale = Math.min(bw / m.W, bh / m.D), ox = bx + (bw - m.W * scale) / 2, oy = by + (bh - m.D * scale) / 2
  const X = (x) => ox + x * scale, Y = (y) => oy + (m.D - y) * scale
  for (const w of m.walls) rect(X(w.x0), Y(w.y1), Math.max(0.5, (w.x1 - w.x0) * scale), Math.max(0.5, (w.y1 - w.y0) * scale), '#111', 0.2, '#222')
  for (const r of m.rooms) {
    txt(X(r.x0 + 0.12), Y(r.y1 - 0.2), r.libelle, 2.4, false, '#333')
    if (amenage) {
      const cx = X((r.x0 + r.x1) / 2), cy = Y((r.y0 + r.y1) / 2)
      if (/salon/i.test(r.id)) rect(cx - 8, cy - 3, 16, 6, '#555', 0.3)
      else if (/chambre/i.test(r.id)) { rect(cx - 7, cy - 5, 14, 10, '#555', 0.3); line(cx - 7, cy, cx + 7, cy, '#777', 0.2) }
      else if (/cuisine/i.test(r.id)) rect(cx - 5, cy - 3, 10, 6, '#555', 0.3)
      else if (/sanit|douche|wc/i.test(r.id)) { rect(cx - 2.5, cy - 2.5, 5, 5, '#555', 0.3); }
    }
    if (markers) {
      const cx = X((r.x0 + r.x1) / 2), cy = Y((r.y0 + r.y1) / 2)
      rect(cx - 1.2, cy - 1.2, 2.4, 2.4, '#b45a00', 0.35, '#ffe3b8')
    }
  }
  if (markers) {
    for (const o of m.ops) {
      const x = X(o.cx), y = Y(o.cy)
      line(x - 1.5, y - 1.5, x + 1.5, y + 1.5, '#146b88', 0.45)
      line(x - 1.5, y + 1.5, x + 1.5, y - 1.5, '#146b88', 0.45)
    }
  }
  return { X, Y, scale, ox, oy, bw, bh }
}

function plancheSchema(planche, g, m, demande) {
  const c = pageBase(planche, g, demande), { d, line, rect, txt } = c
  txt(292, 42, 'DESCRIPTIF', 4, true)
  const lines = (planche.contenu || []).slice(0, 10)
  lines.forEach((s, i) => txt(292, 50 + i * 6, `• ${s}`, 2.8))
  const disclaimer = planche.a_confirmer
    ? 'Hypothèses de gabarit à confirmer.'
    : 'Schéma d’avant-projet pour estimation.'
  txt(292, 119, disclaimer, 2.8, true, '#a33')
  txt(292, 129, `Emprise : ${m.W.toFixed(2)} × ${m.D.toFixed(2)} m`, 2.8)
  txt(292, 136, `Surface bâtie indicative : ${(m.W * m.D).toFixed(1)} m²`, 2.8)
  const geo = dessinerBase(m, c, { amenage: planche.type === 'plan_amene' })
  const { X, Y, scale } = geo
  if (planche.type === 'plan_ensemble') {
    // Emprise parcellaire illustrative uniquement : la parcelle réelle n'est pas fournie.
    rect(X(-2), Y(m.D + 2), (m.W + 4) * scale, (m.D + 4) * scale, '#789', 0.35)
    txt(30, 40, 'PARCELLE INDICATIVE — dimensions réelles non fournies', 2.6, true, '#a33')
  } else if (planche.type === 'toiture') {
    for (const r of m.rooms.filter((x) => x.id === 'salon' || x.id === m.rooms[0]?.id)) {
      const x = X((r.x0 + r.x1) / 2), y = Y((r.y0 + r.y1) / 2)
      line(x - 4, y, x + 4, y, '#146b88', 0.7); line(x + 4, y, x + 2.3, y - 1.6, '#146b88', 0.7); line(x + 4, y, x + 2.3, y + 1.6, '#146b88', 0.7)
    }
    txt(292, 153, 'Sens d’écoulement indicatif', 2.8)
  } else if (planche.type === 'electricite') {
    dessinerBase(m, c, { markers: true })
    txt(292, 153, 'Carré : point lumineux indicatif', 2.8)
    txt(292, 160, 'Croix : ouverture (repère)', 2.8)
  } else if (planche.type === 'climatisation') {
    for (const r of m.rooms.filter((x) => /salon|chambre/i.test(x.id))) {
      const x = X((r.x0 + r.x1) / 2), y = Y((r.y0 + r.y1) / 2)
      d.push({ t: 'poly', pts: [[x, y - 2], [x + 2, y], [x, y + 2], [x - 2, y]], close: true, color: '#16809a', sw: 0.5 })
    }
    txt(292, 153, 'Équipements positionnés à titre indicatif.', 2.8)
  } else if (planche.type === 'plomberie') {
    let prev = null
    for (const r of m.rooms.filter((x) => /cuisine|sanit|douche|wc/i.test(x.id))) {
      const x = X((r.x0 + r.x1) / 2), y = Y((r.y0 + r.y1) / 2)
      d.push({ t: 'rect', x: x - 1.7, y: y - 1.7, w: 3.4, h: 3.4, color: '#167a56', sw: 0.5 })
      if (prev) line(prev[0], prev[1], x, y, '#167a56', 0.45)
      prev = [x, y]
    }
    txt(292, 153, 'Tracé EU/EV schématique, à confirmer.', 2.8)
  } else if (planche.type === 'fondation' || planche.type === 'coffrage' || planche.type === 'poutraison') {
    for (const w of m.walls) {
      const cx = X((w.x0 + w.x1) / 2), cy = Y((w.y0 + w.y1) / 2)
      if (planche.type === 'fondation') rect(X(w.x0) - 1.4, Y(w.y1) - 1.4, Math.max(1, (w.x1 - w.x0) * scale + 2.8), Math.max(1, (w.y1 - w.y0) * scale + 2.8), '#a67c52', 0.35)
      else if (planche.type === 'coffrage') rect(X(w.x0), Y(w.y1), Math.max(0.5, (w.x1 - w.x0) * scale), Math.max(0.5, (w.y1 - w.y0) * scale), '#7d4e24', 0.25)
      else { line(X(w.x0), cy, X(w.x1), cy, '#a33', 0.55); line(cx, Y(w.y0), cx, Y(w.y1), '#a33', 0.55) }
    }
    txt(292, 153, 'Dimensionnement structurel non calculé.', 2.8, true, '#a33')
  } else if (planche.type === 'facades' || planche.type === 'coupe') {
    const x = 30, y = 190, ew = 238, eh = 50, hsp = Math.min(40, m.hsp * 12)
    line(x, y, x + ew, y, '#111', 0.6); line(x + 12, y - hsp, x + ew - 12, y - hsp, '#111', 0.8)
    line(x + 12, y, x + 12, y - hsp, '#111', 0.8); line(x + ew - 12, y, x + ew - 12, y - hsp, '#111', 0.8)
    for (let i = 0; i < m.ops.length; i++) {
      const xx = x + 24 + (i % Math.max(1, m.ops.length)) * ((ew - 48) / Math.max(1, m.ops.length))
      rect(xx, y - hsp * 0.68, 8, hsp * 0.35, '#146b88', 0.4)
    }
    txt(x, y + 7, planche.type === 'coupe' ? 'Coupe schématique · niveaux à confirmer' : 'Façade schématique · matériaux non définis', 2.6)
  } else {
    dessinerBase(m, c)
  }
  // IFC reste un modèle architectural de l'emprise, pas une sortie IFC spécifique à chaque spécialité.
  return d
}

function pageDescriptif(planche, g, m, demande) {
  const c = pageBase(planche, g, demande), { d, txt } = c
  txt(20, 48, 'DESCRIPTION DE LA PLANCHE', 5, true)
  txt(20, 62, `Type : ${planche.type}`, 3.5, true)
  txt(20, 72, `Échelle indicative : ${planche.echelle || 'à définir'}`, 3.2)
  txt(20, 81, `Emprise modèle : ${m.W.toFixed(2)} × ${m.D.toFixed(2)} m (${(m.W * m.D).toFixed(1)} m²)`, 3.2)
  txt(20, 95, 'Éléments prévus', 4, true)
  ;(planche.contenu || []).forEach((s, i) => txt(25, 105 + i * 8, `• ${s}`, 3.2))
  if (planche.raison) txt(20, 150, planche.raison, 3.2, true, '#a33')
  txt(20, 220, 'Limite : document estimatif issu du gabarit. Les dimensions, équipements, réseaux et détails techniques', 3)
  txt(20, 228, 'doivent être vérifiés et complétés par les professionnels concernés avant chiffrage définitif ou travaux.', 3)
  return d
}

export function genererDossier({ g, standing, variante, options }) {
  const m = buildModel(g, { standing, variante })
  const definition = (g.planches || []).filter((p) => p.generee && TITRES[p.type])
  const pages = [], planches = []
  const cover = pageBase({ type: 'index', cartouche: 'DOSSIER DE PLANS' }, g, { standing, variante })
  cover.txt(20, 55, 'DOSSIER DE PLANS POUR MÉTRÉ ET DEVIS PRÉLIMINAIRE', 7, true)
  cover.txt(20, 70, `${g.meta.libelle} · variante ${variante} · standing ${standing}`, 4)
  cover.txt(20, 84, `Emprise du gabarit : ${m.W.toFixed(2)} × ${m.D.toFixed(2)} m`, 3.5)
  cover.txt(20, 100, 'Planches incluses', 4, true)
  definition.forEach((p, i) => cover.txt(24, 109 + i * 6, `${String(i + 1).padStart(2, '0')} · ${TITRES[p.type]}`, 3))
  cover.txt(20, 270, 'Les réseaux et ouvrages structurels sont schématiques et estimatifs. Validation professionnelle requise.', 3.2, true, '#a33')
  pages.push(cover.d)
  for (const p of definition) {
    const sheet = p.type === 'vue_en_plan' ? drawPlan(m, g, options) : plancheSchema(p, g, m, { standing, variante })
    if (!sheet.page) sheet.page = { PW: W, PH: H, format: 'A3', orientation: 'paysage', echelle: 100 }
    pages.push(sheet)
    const descriptive = pageDescriptif(p, g, m, { standing, variante })
    pages.push(descriptive)
    planches.push({ type: p.type, titre: TITRES[p.type], svg: toSVG(sheet), pdf: toPDF(sheet).toString('base64'), descriptif_svg: toSVG(descriptive), echelle: p.echelle || 'schématique', descriptif: p.contenu || [], a_confirmer: Boolean(p.a_confirmer) })
  }
  return {
    pdf: pdfMulti(pages).toString('base64'),
    planches,
    ifc: toIFC(m, { projet: g.meta.libelle }),
    non_generees: (g.planches || []).filter((p) => !p.generee).map((p) => ({ type: p.type, raison: p.raison || 'Non disponible dans le gabarit.' })),
  }
}
