// Géométrie plane du projet libre. Unités : mètres. x = est, y = nord (entrée au sud).
export const EPS = 1e-6
export const r2 = (v) => Math.round(v * 100) / 100
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const estPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)

export function aireSignee(poly) {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}
export const aire = (poly) => Math.abs(aireSignee(poly))
export function perimetre(poly) {
  let s = 0
  for (let i = 0; i < poly.length; i++) s += dist(poly[i], poly[(i + 1) % poly.length])
  return s
}
export function distPointSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}
/** Point dans le polygone (bord compris à `tol` près). */
export function pointDansPoly(p, poly, tol = 0.03) {
  const n = poly.length
  if (tol > 0) for (let i = 0; i < n; i++) if (distPointSegment(p, poly[i], poly[(i + 1) % n]) <= tol) return true
  let dedans = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dedans = !dedans
  }
  return dedans
}
export function segmentsSecants(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b)
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
}
export function autoIntersection(poly) {
  const n = poly.length
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue
    if (segmentsSecants(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true
  }
  return false
}
export function boite(poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}
/** Aire de recouvrement de deux polygones (échantillonnage au pas donné). */
export function recouvrement(p1, p2, pas = 0.1) {
  const b1 = boite(p1), b2 = boite(p2)
  const x0 = Math.max(b1.x0, b2.x0), x1 = Math.min(b1.x1, b2.x1), y0 = Math.max(b1.y0, b2.y0), y1 = Math.min(b1.y1, b2.y1)
  if (x1 <= x0 || y1 <= y0) return 0
  let n = 0
  for (let x = x0 + pas / 2; x < x1; x += pas) for (let y = y0 + pas / 2; y < y1; y += pas) {
    if (pointDansPoly([x, y], p1, 0) && pointDansPoly([x, y], p2, 0)) n++
  }
  return n * pas * pas
}

/**
 * Développe le contour : chaque sommet peut porter un coin
 *   { type:'chanfrein', taille_m }  ou  { type:'arrondi', rayon_m }.
 * Segments produits (ordre du contour) :
 *   E<i> = côté i (du sommet i au sommet i+1, raccourci par les coins),
 *   C<i> = pan coupé ou arrondi au sommet i. Numérotation à partir de 1, dans l'ordre saisi.
 */
export function developperContour(contour) {
  const n = contour.length, erreurs = []
  const V = contour.map((c) => [c.x, c.y])
  const cuts = V.map((v, i) => {
    const coin = contour[i].coin
    if (!coin) return { in: v, out: v }
    const P = V[(i - 1 + n) % n], N = V[(i + 1) % n]
    const lu = dist(v, P), lw = dist(v, N)
    const u = [(P[0] - v[0]) / lu, (P[1] - v[1]) / lu], w = [(N[0] - v[0]) / lw, (N[1] - v[1]) / lw]
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * w[0] + u[1] * w[1])))
    if (theta < 0.05 || theta > Math.PI - 0.05) { erreurs.push({ code: 'COIN_SUR_ANGLE_PLAT', chemin: `contour[${i}]`, message: `Sommet ${i + 1} : coin impossible sur un angle plat.` }); return { in: v, out: v } }
    const arrondi = coin.type === 'arrondi'
    const t = arrondi ? Number(coin.rayon_m) / Math.tan(theta / 2) : Number(coin.taille_m)
    if (!(t > 0) || t > lu / 2 + EPS || t > lw / 2 + EPS) { erreurs.push({ code: 'COIN_TROP_GRAND', chemin: `contour[${i}].coin`, message: `Sommet ${i + 1} : coin invalide ou plus grand que la moitié d'un côté adjacent.` }); return { in: v, out: v } }
    const cut = { in: [v[0] + u[0] * t, v[1] + u[1] * t], out: [v[0] + w[0] * t, v[1] + w[1] * t], theta }
    if (arrondi) {
      const bx = u[0] + w[0], by = u[1] + w[1], bl = Math.hypot(bx, by)
      const r = Number(coin.rayon_m)
      cut.arc = { rayon: r, centre: [v[0] + (bx / bl) * (r / Math.sin(theta / 2)), v[1] + (by / bl) * (r / Math.sin(theta / 2))] }
    }
    return cut
  })
  const points = [], segments = []
  for (let i = 0; i < n; i++) {
    const cut = cuts[i]
    if (contour[i].coin && cut.theta) {
      if (cut.arc) {
        const { centre, rayon } = cut.arc
        const a0 = Math.atan2(cut.in[1] - centre[1], cut.in[0] - centre[0])
        let d = Math.atan2(cut.out[1] - centre[1], cut.out[0] - centre[0]) - a0
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        for (let k = 0; k <= 8; k++) points.push([centre[0] + rayon * Math.cos(a0 + (d * k) / 8), centre[1] + rayon * Math.sin(a0 + (d * k) / 8)])
        segments.push({ id: `C${i + 1}`, kind: 'arc', a: cut.in, b: cut.out, longueur: rayon * (Math.PI - cut.theta), rayon, centre })
      } else {
        points.push(cut.in, cut.out)
        segments.push({ id: `C${i + 1}`, kind: 'chanfrein', a: cut.in, b: cut.out, longueur: dist(cut.in, cut.out) })
      }
    } else points.push(V[i])
    const suivant = cuts[(i + 1) % n]
    segments.push({ id: `E${i + 1}`, kind: 'droit', a: cut.out, b: suivant.in, longueur: dist(cut.out, suivant.in) })
  }
  return { points, segments, erreurs }
}
