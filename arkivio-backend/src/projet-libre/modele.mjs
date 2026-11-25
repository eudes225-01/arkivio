// Modèle dérivé d'un niveau : contour développé, table des murs (extérieurs + intérieurs).
import { developperContour, aire, dist, estPoint } from './geometrie.mjs'

export const PARAMS_DEFAUT = { ep_ext_cm: 15, ep_cloison_cm: 10, hsp_m: 2.8 }
export const paramsEffectifs = (projet) => ({ ...PARAMS_DEFAUT, ...(projet?.parametres || {}) })

export function modeleNiveau(niveau, P = PARAMS_DEFAUT) {
  const contour = Array.isArray(niveau.contour) ? niveau.contour.filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y)) : []
  const dev = developperContour(contour)
  const epExt = niveau.ep_ext_cm ?? P.ep_ext_cm
  const murs = new Map()
  dev.segments.forEach((s) => murs.set(s.id, { ...s, ep_cm: epExt, categorie: 'exterieur', exterieur: true }))
  ;(niveau.murs_int || []).forEach((m) => {
    if (!m || !estPoint(m.a) || !estPoint(m.b) || !m.id) return
    murs.set(m.id, { id: m.id, kind: 'droit', a: m.a, b: m.b, longueur: dist(m.a, m.b), ep_cm: m.ep_cm ?? P.ep_cloison_cm, categorie: m.porteur ? 'porteur' : 'cloison', exterieur: false })
  })
  const perim = dev.segments.reduce((s, x) => s + x.longueur, 0)
  return { dev, murs, aire: dev.points.length >= 3 ? aire(dev.points) : 0, perim, hsp: niveau.hsp_m ?? P.hsp_m }
}
