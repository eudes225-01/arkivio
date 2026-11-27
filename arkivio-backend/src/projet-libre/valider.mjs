// Validation du projet libre : cohérence géométrique et structurelle.
// Sortie conçue pour la boucle de correction : chaque violation a un code stable, un chemin et un message
// que Claude peut relire pour corriger. Les règles réglementaires (arrêtés 169, 170, 0174, loi 2022-30) se
// branchent via l'option `regles` : chaque règle est une fonction (variante, ctx) => violations[].
import { aire, boite, estPoint, pointDansPoly, autoIntersection, recouvrement, dist, perimetre, r2 } from './geometrie.mjs'
import { modeleNiveau, paramsEffectifs } from './modele.mjs'

export const SEUILS_DEFAUT = { hsp_min_m: 2.2, hsp_max_m: 4.5, portee_poutre_max_m: 6.0, chevauchement_pieces_m2: 0.05, tol_m: 0.03, couverture_pieces_min: 0.85 }
export const TYPES_DALLE = ['aucun', 'dallePleine', 'dalleTP', 'hourdis15', 'hourdis20', 'corpsCreuxApparent', 'corpsCreuxPlan', 'nervuree']
export const TYPES_FONDATION = ['filante', 'isolees', 'radier', 'mixte']
export const TYPES_TOITURE = ['bac', 'tuiles', 'shingle', 'terrasse']
const RE_PORTE = /^P\d+$/i, RE_BAIE = /^[FB]\d+$/i, RE_POTEAU = /^P\d+$/i, RE_RESERVE = /^[EC]\d+$/i

export function validerProjet(projet, { regles = [], seuils = {} } = {}) {
  const S = { ...SEUILS_DEFAUT, ...seuils }
  const violations = []
  const add = (code, gravite, chemin, message, suggestion) => violations.push({ code, gravite, chemin, message, ...(suggestion ? { suggestion } : {}) })
  if (projet?.format !== 'arkivio-projet-libre') add('FORMAT', 'erreur', 'format', 'Le champ « format » doit valoir « arkivio-projet-libre ».')
  if (!/^1\./.test(String(projet?.version))) add('VERSION', 'erreur', 'version', 'Version de format non prise en charge (attendu : 1.x).')
  const vars = Array.isArray(projet?.variantes) ? projet.variantes : []
  if (vars.length < 1 || vars.length > 2) add('VARIANTES_NOMBRE', 'erreur', 'variantes', `Il faut 1 ou 2 variantes (reçu : ${vars.length}).`)
  if (new Set(vars.map((v) => v?.id)).size !== vars.length) add('VARIANTE_ID_DUPLIQUE', 'erreur', 'variantes', 'Deux variantes portent le même id.')
  const P = paramsEffectifs(projet)
  const contextes = []
  vars.forEach((v, vi) => contextes.push(validerVariante(v, `variantes[${v?.id ?? vi}]`, projet, P, S, add)))
  vars.forEach((v, vi) => {
    for (const regle of regles) {
      const sortie = regle(v, { projet, seuils: S, params: P, niveaux: contextes[vi] }) || []
      sortie.forEach((x) => violations.push({ gravite: 'erreur', chemin: `variantes[${v.id}]`, ...x }))
    }
  })
  const erreurs = violations.filter((x) => x.gravite === 'erreur'), avertissements = violations.filter((x) => x.gravite !== 'erreur')
  return { ok: erreurs.length === 0, erreurs, avertissements, violations }
}

function validerVariante(v, base, projet, P, S, add) {
  const niveaux = Array.isArray(v?.niveaux) ? v.niveaux : []
  if (!niveaux.length) { add('NIVEAUX_VIDES', 'erreur', `${base}.niveaux`, 'Aucun niveau défini.'); return [] }
  if (new Set(niveaux.map((n) => n?.id)).size !== niveaux.length) add('NIVEAU_ID_DUPLIQUE', 'erreur', `${base}.niveaux`, 'Deux niveaux portent le même id.')
  const modeles = niveaux.map((nv) => modeleNiveau(nv, P))
  niveaux.forEach((nv, i) => {
    const ch = `${base}.niveaux[${nv?.id ?? i}]`, M = modeles[i]
    if (i > 0 && !(nv.cote_m > niveaux[i - 1].cote_m)) add('COTE_NIVEAU', 'erreur', `${ch}.cote_m`, 'Les cotes des niveaux doivent croître d\'un niveau au suivant.')
    if (i === 0 && nv.cote_m !== 0) add('COTE_RDC', 'avertissement', `${ch}.cote_m`, 'Le premier niveau est normalement à la cote 0.')
    if (!(M.hsp >= S.hsp_min_m && M.hsp <= S.hsp_max_m)) add('HSP_INVRAISEMBLABLE', 'erreur', `${ch}.hsp_m`, `Hauteur sous plafond ${M.hsp} m hors de [${S.hsp_min_m} ; ${S.hsp_max_m}] m.`)
    if (nv.dalle?.type && !TYPES_DALLE.includes(nv.dalle.type)) add('DALLE_TYPE', 'erreur', `${ch}.dalle.type`, `Type de plancher inconnu « ${nv.dalle.type} » (attendu : ${TYPES_DALLE.join(', ')}).`)
    // Contour
    const c = nv.contour
    if (!Array.isArray(c) || c.length < 3 || !c.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) { add('CONTOUR_INVALIDE', 'erreur', `${ch}.contour`, 'Le contour doit contenir au moins 3 sommets {x, y} numériques.'); return }
    M.dev.erreurs.forEach((e) => add(e.code, 'erreur', `${ch}.${e.chemin}`, e.message))
    if (autoIntersection(M.dev.points)) add('CONTOUR_AUTO_INTERSECTION', 'erreur', `${ch}.contour`, 'Le contour se croise lui-même.')
    if (!(M.aire > 1)) add('CONTOUR_AIRE', 'erreur', `${ch}.contour`, 'Aire du contour nulle ou trop faible.')
    const poly = M.dev.points
    if (i === 0 && projet.projet?.terrain) {
      const t = projet.projet.terrain, b = boite(poly), r = t.retraits_m || {}
      const w = b.x1 - b.x0 + (r.gauche || 0) + (r.droite || 0), d = b.y1 - b.y0 + (r.avant || 0) + (r.arriere || 0)
      if (Number.isFinite(t.largeur_m) && w > t.largeur_m + 1e-6) add('EMPRISE_TERRAIN_LARGEUR', 'erreur', `${ch}.contour`, `Emprise + retraits : ${r2(w)} m de large pour un terrain de ${t.largeur_m} m.`)
      if (Number.isFinite(t.profondeur_m) && d > t.profondeur_m + 1e-6) add('EMPRISE_TERRAIN_PROFONDEUR', 'erreur', `${ch}.contour`, `Emprise + retraits : ${r2(d)} m de profondeur pour un terrain de ${t.profondeur_m} m.`)
    }
    // Murs intérieurs
    ;(nv.murs_int || []).forEach((m, j) => {
      const cm = `${ch}.murs_int[${m?.id ?? j}]`
      if (!m?.id || RE_RESERVE.test(m.id)) add('MUR_ID', 'erreur', cm, 'Id de mur manquant ou réservé (les ids E<n> et C<n> sont ceux du contour).')
      if (!estPoint(m?.a) || !estPoint(m?.b)) return add('MUR_POINTS', 'erreur', cm, 'Un mur intérieur a besoin de a:[x,y] et b:[x,y].')
      if (dist(m.a, m.b) < 0.3) add('MUR_TROP_COURT', 'erreur', cm, 'Mur intérieur de moins de 30 cm.')
      if (!pointDansPoly(m.a, poly, S.tol_m) || !pointDansPoly(m.b, poly, S.tol_m)) add('MUR_HORS_CONTOUR', 'erreur', cm, 'Une extrémité du mur est hors du contour.')
    })
    const idsMurs = (nv.murs_int || []).map((m) => m?.id)
    if (new Set(idsMurs).size !== idsMurs.length) add('MUR_ID_DUPLIQUE', 'erreur', `${ch}.murs_int`, 'Deux murs intérieurs portent le même id.')
    // Pièces
    const pieces = nv.pieces || []
    if (!pieces.length) add('PIECES_ABSENTES', 'erreur', `${ch}.pieces`, 'Le niveau doit contenir les pièces de la maison (polygones et noms).')
    pieces.forEach((p, j) => {
      const cp = `${ch}.pieces[${p?.id ?? j}]`
      if (!Array.isArray(p?.polygone) || p.polygone.length < 3 || !p.polygone.every(estPoint)) return add('PIECE_POLYGONE', 'erreur', cp, 'Polygone de pièce invalide (≥ 3 points [x,y]).')
      if (autoIntersection(p.polygone)) add('PIECE_AUTO_INTERSECTION', 'erreur', cp, `Le contour de la pièce « ${p.nom || p.id} » se croise.`)
      if (!p.polygone.every((q) => pointDansPoly(q, poly, S.tol_m))) add('PIECE_HORS_CONTOUR', 'erreur', cp, `La pièce « ${p.nom || p.id} » sort du contour du bâtiment.`)
    })
    const valides = pieces.filter((p) => Array.isArray(p?.polygone) && p.polygone.length >= 3 && p.polygone.every(estPoint))
    for (let a = 0; a < valides.length; a++) for (let b = a + 1; b < valides.length; b++) {
      const s = recouvrement(valides[a].polygone, valides[b].polygone)
      if (s > S.chevauchement_pieces_m2) add('PIECES_CHEVAUCHENT', 'erreur', `${ch}.pieces`, `Les pièces « ${valides[a].nom || valides[a].id} » et « ${valides[b].nom || valides[b].id} » se chevauchent (${r2(s)} m²).`)
    }
    if (valides.length) {
      const somme = valides.reduce((s, p) => s + aire(p.polygone), 0)
      if (somme < S.couverture_pieces_min * M.aire) add('PIECES_COUVERTURE', 'avertissement', `${ch}.pieces`, `Les pièces couvrent ${r2(somme)} m² sur ${r2(M.aire)} m² d'emprise : zones non affectées ?`)
    }
    // Ouvertures
    const ouv = nv.ouvertures || []
    const idsOuv = ouv.map((o) => o?.id)
    if (new Set(idsOuv).size !== idsOuv.length) add('OUVERTURE_ID_DUPLIQUE', 'erreur', `${ch}.ouvertures`, 'Deux ouvertures portent le même repère (P<n>, F<n>, B<n>).')
    ouv.forEach((o, j) => {
      const co = `${ch}.ouvertures[${o?.id ?? j}]`
      const mur = M.murs.get(o?.mur)
      if (!['porte', 'fenetre'].includes(o?.type)) return add('OUVERTURE_TYPE', 'erreur', co, 'Type d\'ouverture : « porte » ou « fenetre ».')
      if (o.type === 'porte' && !RE_PORTE.test(o.id || '')) add('OUVERTURE_CODE', 'erreur', co, 'Une porte porte un repère P<n> (P1, P2…).')
      if (o.type === 'fenetre' && !RE_BAIE.test(o.id || '')) add('OUVERTURE_CODE', 'erreur', co, 'Une fenêtre ou baie porte un repère F<n> ou B<n>.')
      if (!mur) return add('OUVERTURE_MUR_INCONNU', 'erreur', co, `Mur « ${o.mur} » inexistant à ce niveau.`)
      if (mur.kind === 'arc') return add('OUVERTURE_SUR_ARC', 'erreur', co, 'Ouverture sur un mur arrondi non prise en charge : la placer sur un côté droit.')
      if (!(o.largeur_m > 0) || !(o.hauteur_m > 0) || !Number.isFinite(o.pos_m)) return add('OUVERTURE_DIMENSIONS', 'erreur', co, 'pos_m, largeur_m et hauteur_m doivent être positifs.')
      if (o.pos_m < -1e-6 || o.pos_m + o.largeur_m > mur.longueur + 1e-6) add('OUVERTURE_HORS_MUR', 'erreur', co, `Ouverture de ${r2(o.pos_m)} à ${r2(o.pos_m + o.largeur_m)} m sur un mur de ${r2(mur.longueur)} m.`, `Réduire pos_m ou largeur_m, ou changer de mur (longueur disponible : ${r2(mur.longueur)} m).`)
      if ((o.allege_m || 0) + o.hauteur_m > M.hsp + 1e-6) add('OUVERTURE_TROP_HAUTE', 'erreur', co, `Allège + hauteur = ${r2((o.allege_m || 0) + o.hauteur_m)} m > HSP ${M.hsp} m.`)
    })
    const parMur = {}
    ouv.filter((o) => o?.mur && M.murs.has(o.mur) && Number.isFinite(o.pos_m) && o.largeur_m > 0).forEach((o) => (parMur[o.mur] ||= []).push(o))
    Object.entries(parMur).forEach(([mur, lst]) => {
      lst.sort((a, b) => a.pos_m - b.pos_m)
      for (let k = 1; k < lst.length; k++) if (lst[k].pos_m < lst[k - 1].pos_m + lst[k - 1].largeur_m - 1e-6) add('OUVERTURES_CHEVAUCHENT', 'erreur', `${ch}.ouvertures`, `Sur le mur ${mur}, ${lst[k - 1].id} et ${lst[k].id} se chevauchent.`)
    })
    // Structure
    const dansContour = (p) => estPoint(p) && pointDansPoly(p, poly, S.tol_m)
    const idsPot = (nv.poteaux || []).map((p) => p?.id)
    if (new Set(idsPot).size !== idsPot.length) add('POTEAU_ID_DUPLIQUE', 'erreur', `${ch}.poteaux`, 'Deux poteaux portent le même repère à ce niveau.')
    ;(nv.poteaux || []).forEach((p, j) => {
      const cp = `${ch}.poteaux[${p?.id ?? j}]`
      if (!RE_POTEAU.test(p?.id || '')) add('POTEAU_CODE', 'erreur', cp, 'Un poteau porte un repère P<n>.')
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y) || !(p.a_cm > 0) || !(p.b_cm > 0)) return add('POTEAU_DONNEES', 'erreur', cp, 'x, y, a_cm et b_cm sont obligatoires.')
      if (!dansContour([p.x, p.y])) add('POTEAU_HORS_CONTOUR', 'erreur', cp, 'Poteau hors du contour du bâtiment.')
    })
    ;(nv.poutres || []).forEach((p, j) => {
      const cp = `${ch}.poutres[${p?.id ?? j}]`
      if (!estPoint(p?.a) || !estPoint(p?.b) || !(p.b_cm > 0) || !(p.h_cm > 0)) return add('POUTRE_DONNEES', 'erreur', cp, 'a, b, b_cm et h_cm sont obligatoires.')
      if (!dansContour(p.a) || !dansContour(p.b)) add('POUTRE_HORS_CONTOUR', 'erreur', cp, 'Extrémité de poutre hors du contour.')
      const L = dist(p.a, p.b)
      if (L > S.portee_poutre_max_m) add('POUTRE_PORTEE', 'avertissement', cp, `Portée ${r2(L)} m > ${S.portee_poutre_max_m} m : ajouter un appui intermédiaire ou justifier.`)
      const appui = (q) => (nv.poteaux || []).some((t) => Math.hypot(t.x - q[0], t.y - q[1]) <= 0.15) || [...M.murs.values()].some((m) => m.kind !== 'arc' && Math.min(dist(q, m.a), dist(q, m.b)) <= 0.15)
      if (!appui(p.a) || !appui(p.b)) add('POUTRE_SANS_APPUI', 'avertissement', cp, 'Une extrémité de poutre ne tombe ni sur un poteau ni sur un mur.')
    })
    ;(nv.voiles || []).forEach((p, j) => { if (!estPoint(p?.a) || !estPoint(p?.b) || !(p.ep_cm > 0)) add('VOILE_DONNEES', 'erreur', `${ch}.voiles[${p?.id ?? j}]`, 'a, b et ep_cm sont obligatoires.') })
    ;(nv.tremies || []).forEach((t, j) => { if (!Array.isArray(t?.polygone) || !t.polygone.every(dansContour)) add('TREMIE_HORS_CONTOUR', 'erreur', `${ch}.tremies[${t?.id ?? j}]`, 'Trémie invalide ou hors du contour.') })
    // Équipements : dans le bâtiment
    const eq = nv.equipements || {}
    ;[...(eq.plomberie || []), ...(eq.electricite || []), ...(eq.regards || [])].forEach((e) => {
      if (Number.isFinite(e?.x) && Number.isFinite(e?.y) && !dansContour([e.x, e.y]) && !e.exterieur) add('EQUIPEMENT_HORS_CONTOUR', 'avertissement', `${ch}.equipements`, `Équipement ${e.id || e.type} hors du bâtiment (ajouter « exterieur »: true si voulu).`)
    })
  })
  // Cohérence entre niveaux : un poteau garde son repère, sa position, sa section ; il a un appui dessous.
  const vus = new Map()
  niveaux.forEach((nv, i) => {
    ;(nv.poteaux || []).forEach((p) => {
      const prec = vus.get(p.id)
      if (prec && (Math.hypot(prec.x - p.x, prec.y - p.y) > 0.05 || prec.a_cm !== p.a_cm || prec.b_cm !== p.b_cm)) add('POTEAU_INCOHERENT', 'erreur', `${base}.niveaux[${nv.id}].poteaux[${p.id}]`, `Le poteau ${p.id} change de position ou de section entre deux niveaux : un poteau garde le même repère sur toute la hauteur.`)
      if (i > 0 && !(niveaux[i - 1].poteaux || []).some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 0.05)) add('POTEAU_SANS_APPUI', 'erreur', `${base}.niveaux[${nv.id}].poteaux[${p.id}]`, `Le poteau ${p.id} n'a pas de poteau en dessous.`)
      if (!prec) vus.set(p.id, p)
    })
  })
  if (niveaux.length > 1 && !niveaux.every((nv) => nv.escalier)) add('ESCALIER_MANQUANT', 'avertissement', `${base}.niveaux`, 'Bâtiment à étages sans escalier défini à chaque niveau.')
  // Fondation
  const f = v.fondation
  if (!f) add('FONDATION_MANQUANTE', 'erreur', `${base}.fondation`, 'Fondation à définir (type, niveau de base).')
  else {
    if (!TYPES_FONDATION.includes(f.type)) add('FONDATION_TYPE', 'erreur', `${base}.fondation.type`, `Type de fondation inconnu (attendu : ${TYPES_FONDATION.join(', ')}).`)
    if (!(f.niveau_base_m < 0)) add('FONDATION_NIVEAU', 'erreur', `${base}.fondation.niveau_base_m`, 'Le niveau de base de la fondation est négatif (ex. -1.15).')
    const rdc = niveaux[0].poteaux || []
    ;(f.semelles_isolees || []).forEach((s) => { if (!rdc.some((p) => p.id === s.poteau)) add('SEMELLE_SANS_POTEAU', 'erreur', `${base}.fondation.semelles_isolees[${s.id}]`, `Semelle ${s.id} : poteau ${s.poteau} absent du premier niveau.`) })
    if (['isolees', 'mixte'].includes(f.type)) rdc.filter((p) => !(f.semelles_isolees || []).some((s) => s.poteau === p.id)).forEach((p) => add('SEMELLE_MANQUANTE', 'avertissement', `${base}.fondation`, `Poteau ${p.id} sans semelle isolée.`))
  }
  // Toiture
  const t = v.toiture
  if (t) {
    if (!TYPES_TOITURE.includes(t.type)) add('TOITURE_TYPE', 'erreur', `${base}.toiture.type`, `Type de toiture inconnu (attendu : ${TYPES_TOITURE.join(', ')}).`)
    if (t.type !== 'terrasse') {
      const pans = t.pans || []
      if (!pans.length) add('TOITURE_SANS_PAN', 'erreur', `${base}.toiture.pans`, 'Toiture inclinée sans pan défini.')
      pans.forEach((p) => { if (!(p?.pente_pct > 0) || !Array.isArray(p.polygone) || p.polygone.length < 3) add('TOITURE_PAN', 'erreur', `${base}.toiture.pans[${p?.id}]`, 'Chaque pan a un polygone et une pente_pct > 0.') })
      const dernier = modeles[modeles.length - 1], S0 = pans.reduce((s, p) => s + (Array.isArray(p.polygone) && p.polygone.length >= 3 ? aire(p.polygone) : 0), 0)
      if (pans.length && (S0 < 0.9 * dernier.aire || S0 > 1.6 * dernier.aire)) add('TOITURE_COUVERTURE', 'avertissement', `${base}.toiture.pans`, `Les pans couvrent ${r2(S0)} m² en plan pour une emprise de ${r2(dernier.aire)} m² : vérifier débords et recouvrement.`)
    }
  }
  return niveaux.map((nv, i) => ({ niveau: nv, modele: modeles[i] }))
}
