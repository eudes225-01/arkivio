// Contrôle d'un modèle de plan contre les prescriptions minimales béninoises
// (arrêté n°0169 du 24 mai 2024, art. 4 à 7). Retourne la liste des écarts ; liste vide = conforme.
// Les règles sont lues dans data/regles_benin.json ; ce module ne modifie jamais le plan.

const EST_HABITABLE = (id) => /^(chambre|ch\d|sejour|salon|parents?)/i.test(id)
const EST_SEJOUR = (id) => /^(sejour|salon)/i.test(id)
const EST_CHAMBRE = (id) => /^(chambre|ch\d|parents?)/i.test(id)
const EST_CIRCULATION = (id) => /^(couloir|hall|degagement|circulation)/i.test(id)
// Pièces éclairées obligatoirement : habitables, cuisines, salles d'eau, toilettes (art. 5)
const DOIT_ETRE_ECLAIREE = (id) => EST_HABITABLE(id) || /^(cuisine|sanitaires|sdb|douche|wc|toilette|salle)/i.test(id)

const TOL = 0.2

/** Dimensions utiles d'une pièce (hors murs) : on retranche l'épaisseur d'un mur extérieur ou la moitié d'une cloison. */
export function dimensionsUtiles(m, r) {
  const eps = 1e-3
  const ret = (ext) => (ext ? m.tE : m.tI / 2)
  const w = r.x1 - r.x0 - ret(r.x0 < eps) - ret(r.x1 > m.W - eps)
  const d = r.y1 - r.y0 - ret(r.y0 < eps) - ret(r.y1 > m.D - eps)
  return { w, d }
}

function estExterieure(m, o) {
  const marge = Math.max(m.tE, o.th || 0) + 1e-3
  return o.axis === 'x' ? (o.cy < marge || o.cy > m.D - marge) : (o.cx < marge || o.cx > m.W - marge)
}

/** Surface d'ouverture comptée pour l'éclairage : la partie sous 0,90 m du sol fini n'est pas comptée (art. 5). */
function surfaceComptee(o, regles) {
  const seuil = regles.eclairage.hauteur_non_comptee_sous_m
  const bas = o.sill || 0
  const haut = bas + o.h
  return o.w * Math.max(0, haut - Math.max(bas, seuil))
}

export function surfaceEclairante(m, r, regles) {
  let a = 0
  for (const o of m.ops) {
    if (!['fenetre', 'baie', 'porte'].includes(o.kind) || !estExterieure(m, o)) continue
    const dedans = o.cx >= r.x0 - TOL && o.cx <= r.x1 + TOL && o.cy >= r.y0 - TOL && o.cy <= r.y1 + TOL
    if (dedans) a += surfaceComptee(o, regles)
  }
  return a
}

export function controlerConformite(m, regles) {
  const ecarts = []
  const ph = regles.pieces_habitables
  const nbChambres = m.rooms.filter((r) => EST_CHAMBRE(r.id)).length
  if (m.hsp < ph.hauteur_sous_plafond_min_m) ecarts.push({ regle: 'hauteur_sous_plafond', piece: null, valeur: m.hsp, minimum: ph.hauteur_sous_plafond_min_m })
  for (const r of m.rooms) {
    const { w, d } = dimensionsUtiles(m, r)
    if (EST_HABITABLE(r.id)) {
      const min = EST_SEJOUR(r.id) ? ph.surface_min_sejour_m2 : EST_CHAMBRE(r.id) && nbChambres === 1 ? ph.surface_min_chambre_unique_m2 : ph.surface_min_m2
      if (r.aire < min) ecarts.push({ regle: 'surface_piece_habitable', piece: r.id, valeur: +r.aire.toFixed(2), minimum: min })
      if (Math.min(w, d) < ph.plus_petit_cote_min_m_si_rectangulaire) ecarts.push({ regle: 'plus_petit_cote', piece: r.id, valeur: +Math.min(w, d).toFixed(2), minimum: ph.plus_petit_cote_min_m_si_rectangulaire })
    }
    if (EST_CIRCULATION(r.id) && Math.min(w, d) < regles.circulations.couloir_largeur_min_m) {
      ecarts.push({ regle: 'largeur_couloir', piece: r.id, valeur: +Math.min(w, d).toFixed(2), minimum: regles.circulations.couloir_largeur_min_m })
    }
    if (DOIT_ETRE_ECLAIREE(r.id)) {
      const a = surfaceEclairante(m, r, regles), min = r.aire / 6
      if (a < min) ecarts.push({ regle: 'eclairage_un_sixieme', piece: r.id, valeur: +a.toFixed(2), minimum: +min.toFixed(2) })
    }
  }
  return ecarts
}
