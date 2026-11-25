// Convertit une variante du projet libre en (levels, params) pour metrerProjet() de CivilEstimator.
// La géométrie est la seule source : toutes les quantités sont recalculées ici, jamais saisies.
import { aire, dist, r2 } from './geometrie.mjs'
import { modeleNiveau, paramsEffectifs } from './modele.mjs'

const TYPE_BLOC = { 10: 'agglo10', 15: 'agglo15', 20: 'agglo20' }
const r3 = (v) => Math.round(v * 1000) / 1000

export function versCivilEstimator(projet, varianteId) {
  const variante = projet.variantes.find((v) => v.id === varianteId) || projet.variantes[0]
  const P = paramsEffectifs(projet)
  const rapport = []
  const note = (niveau, msg) => rapport.push({ niveau, msg })
  const typeBloc = (ep, ou) => {
    if (TYPE_BLOC[ep]) return TYPE_BLOC[ep]
    const k = [10, 15, 20].reduce((b, x) => (Math.abs(x - ep) < Math.abs(b - ep) ? x : b))
    note('attention', `${ou} : épaisseur ${ep} cm absente des types de blocs de CivilEstimator (10 / 15 / 20) → ${TYPE_BLOC[k]} utilisé.`)
    return TYPE_BLOC[k]
  }
  // Ouvertures d'un mur : n, hauteur moyenne et largeur équivalente (la surface totale est exacte).
  const agreger = (lst) => {
    const n = lst.length
    if (!n) return null
    const H = lst.reduce((s, o) => s + o.hauteur_m, 0) / n
    return { n, H: r3(H), L: r3(lst.reduce((s, o) => s + o.largeur_m * o.hauteur_m, 0) / (n * H)) }
  }
  const grouper = (lst, cle) => {
    const m = new Map()
    lst.forEach((x) => { const k = cle(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x) })
    return [...m.values()]
  }

  const modeles = variante.niveaux.map((nv) => modeleNiveau(nv, P))
  const levels = variante.niveaux.map((nv, i) => {
    const M = modeles[i], hsp = M.hsp
    const murs = [...M.murs.values()].map((m) => {
      const ouv = (nv.ouvertures || []).filter((o) => o.mur === m.id)
      const pt = agreger(ouv.filter((o) => o.type === 'porte')), fn = agreger(ouv.filter((o) => o.type === 'fenetre'))
      const mur = { nom: m.id, type: typeBloc(m.ep_cm, `${nv.id} ${m.id}`), categorie: m.categorie, nb: 1, L: r2(m.longueur), H: hsp, ep: m.ep_cm / 100, position: m.exterieur ? 'exterieur' : 'interieur' }
      if (pt) Object.assign(mur, { portes: pt.n, pL: pt.L, pH: pt.H })
      if (fn) Object.assign(mur, { fenetres: fn.n, fL: fn.L, fH: fn.H })
      return mur
    })
    const section = (p) => {
      if (p.forme === 'rond') { const c = r3(((p.a_cm * Math.sqrt(Math.PI)) / 2) / 100); return [c, c] }
      return [p.a_cm / 100, p.b_cm / 100]
    }
    if ((nv.poteaux || []).some((p) => p.forme === 'rond')) note('info', `${nv.id} : poteaux ronds convertis en section carrée de même aire.`)
    const poteaux = grouper(nv.poteaux || [], (p) => section(p).join('x')).map((g) => {
      const [a, b] = section(g[0])
      return { nom: g.map((p) => p.id).join(' '), nb: g.length, a, b, H: hsp }
    })
    const poutres = grouper(nv.poutres || [], (p) => `${p.b_cm}x${p.h_cm}`).map((g) => ({ nom: g.map((p) => p.id).join(' '), nb: 1, L: r2(g.reduce((s, p) => s + dist(p.a, p.b), 0)), b: g[0].b_cm / 100, h: g[0].h_cm / 100 }))
    const voiles = grouper(nv.voiles || [], (p) => p.ep_cm).map((g) => ({ nom: g.map((p) => p.id).join(' '), nb: 1, L: r2(g.reduce((s, p) => s + dist(p.a, p.b), 0)), ep: g[0].ep_cm / 100, H: hsp }))
    const chainagesV = grouper(nv.chainages_v || [], (p) => `${p.a_cm}x${p.b_cm}`).map((g) => ({ nom: g.map((p) => p.id).join(' '), nb: g.length, a: g[0].a_cm / 100, b: g[0].b_cm / 100, H: hsp }))
    const tremies = (nv.tremies || []).reduce((s, t) => s + aire(t.polygone), 0)
    const niveau = {
      nom: nv.nom, rez: i === 0, HSP: hsp, plancher: nv.dalle?.type || 'aucun',
      surfPlancher: r2(M.aire), tremies: r2(tremies), epDalle: nv.dalle?.ep_cm ? nv.dalle.ep_cm / 100 : '', perimetre: r2(M.perim),
      murs, poteaux, poutres, voiles, chainagesV,
    }
    if (variante.structure?.chainage_haut === false) niveau.chainageHaut = false
    return niveau
  })

  // ── Paramètres projet ──
  const params = {}
  const aOssature = levels.some((l) => l.poteaux.length || l.poutres.length)
  params.systeme = aOssature ? 'mixte' : 'murs'
  const f = variante.fondation || {}
  const rdc = modeles[0]
  const porteurs = [...rdc.murs.values()].filter((m) => m.categorie === 'porteur').reduce((s, m) => s + m.longueur, 0)
  const fond = { type: f.type === 'mixte' ? 'filante' : f.type }
  if (f.type === 'mixte') note('attention', 'Fondation « mixte » : CivilEstimator ne métrre qu\'un seul type — filante retenue ; les semelles isolées sont à ajouter à la main.')
  if (f.semelle_filante) Object.assign(fond, { semL: f.semelle_filante.l_cm / 100, semH: f.semelle_filante.h_cm / 100 })
  if (f.prof_fouille_m || f.niveau_base_m) {
    fond.profFouille = f.prof_fouille_m ?? Math.abs(f.niveau_base_m)
    if (!f.prof_fouille_m) note('info', `Profondeur de fouille prise égale au niveau de base (${Math.abs(f.niveau_base_m)} m) : hypothèse à confirmer.`)
  }
  if (fond.type === 'filante') fond.lineaire = r2(rdc.perim + porteurs)
  if (fond.type === 'isolees') {
    fond.semelles = (f.semelles_isolees || []).map((s) => ({ type: s.id, nb: 1, L: s.L_m, l: s.l_m, h: s.h_cm / 100, Lba: s.L_m, lba: s.l_m }))
    note('info', 'Semelles isolées : dimensions de fouille égales aux dimensions du béton (aucun surcreusement supposé).')
  }
  if (f.longrines?.length) fond.longrines = f.longrines.map((l) => ({ nom: l.id, nb: 1, L: r2(dist(l.a, l.b)), b: l.b_cm / 100, h: l.h_cm / 100 }))
  params.fondation = fond
  if (f.dallage?.ep_cm) params.formeDallage = { actif: true, surface: r2(rdc.aire), epaisseur: f.dallage.ep_cm / 100 }
  const t = variante.toiture
  if (t) {
    params.toiture = t.type
    params.toiturePresence = 'plan'
    const pans = t.pans || []
    const surf = pans.reduce((s, p) => s + aire(p.polygone), 0)
    const toit = { debord: (t.debord_cm || 0) / 100, surfaceProjetee: r2(surf || rdc.aire) }
    if (pans.length) {
      toit.pans = pans.map((p) => ({ nom: p.id, pente: p.pente_pct, surface: r2(aire(p.polygone)) }))
      toit.pente = r2(pans.reduce((s, p) => s + p.pente_pct * aire(p.polygone), 0) / surf)
    }
    params.plans = { toiture: toit }
    if (t.type === 'terrasse' && t.acrotere_cm) params.acrotereHauteur = t.acrotere_cm / 100
  } else params.toiturePresence = 'aucune'
  note('info', 'Hauteur des murs = hauteur sous plafond du niveau (sans déduction de dalle) ; fenêtres et portes d\'un même mur regroupées en surface équivalente.')
  return { variante: variante.id, levels, params, rapport }
}
