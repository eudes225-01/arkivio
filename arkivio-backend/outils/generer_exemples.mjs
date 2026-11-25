// Génère data/exemples/F3_pan_coupe.json : une F3 plain-pied, variante A (pan coupé) et B (rectangle).
import { writeFileSync } from 'node:fs'
const pt = (x, y) => [x, y]
function variante(id, pan) {
  const H = 9.0
  const contour = [{ x: 0, y: 0 }, { x: 10, y: 0 }, pan ? { x: 10, y: H, coin: { type: 'chanfrein', taille_m: 1.5 } } : { x: 10, y: H }, { x: 0, y: H }]
  const ch2 = pan ? [pt(6.4, 5.2), pt(10, 5.2), pt(10, 7.5), pt(8.5, 9), pt(6.4, 9)] : [pt(6.4, 5.2), pt(10, 5.2), pt(10, 9), pt(6.4, 9)]
  const pieces = [
    { id: 'salon', nom: 'Salon-séjour', usage: 'sejour', polygone: [pt(0, 0), pt(5.5, 0), pt(5.5, 4), pt(0, 4)] },
    { id: 'cuisine', nom: 'Cuisine', usage: 'cuisine', polygone: [pt(5.5, 0), pt(10, 0), pt(10, 4), pt(5.5, 4)] },
    { id: 'couloir', nom: 'Couloir', usage: 'circulation', polygone: [pt(0, 4), pt(10, 4), pt(10, 5.2), pt(0, 5.2)] },
    { id: 'ch1', nom: 'Chambre 1', usage: 'chambre', polygone: [pt(0, 5.2), pt(4, 5.2), pt(4, 9), pt(0, 9)] },
    { id: 'douche', nom: 'Douche', usage: 'salle_eau', polygone: [pt(4, 5.2), pt(5.4, 5.2), pt(5.4, 7.4), pt(4, 7.4)] },
    { id: 'wc', nom: 'WC', usage: 'wc', polygone: [pt(5.4, 5.2), pt(6.4, 5.2), pt(6.4, 7.4), pt(5.4, 7.4)] },
    { id: 'rangement', nom: 'Rangement', usage: 'rangement', polygone: [pt(4, 7.4), pt(6.4, 7.4), pt(6.4, 9), pt(4, 9)] },
    { id: 'ch2', nom: 'Chambre 2', usage: 'chambre', polygone: ch2 },
  ]
  const murs_int = [
    { id: 'M1', a: pt(0, 4), b: pt(10, 4) }, { id: 'M2', a: pt(5.5, 0), b: pt(5.5, 4) }, { id: 'M3', a: pt(0, 5.2), b: pt(10, 5.2) },
    { id: 'M4', a: pt(4, 5.2), b: pt(4, 9) }, { id: 'M5', a: pt(5.4, 5.2), b: pt(5.4, 7.4) }, { id: 'M6', a: pt(6.4, 5.2), b: pt(6.4, 9) }, { id: 'M7', a: pt(4, 7.4), b: pt(6.4, 7.4) },
  ].map((m) => ({ ...m, ep_cm: 10, porteur: false }))
  const porte = (id, mur, pos, l = 0.9) => ({ id, type: 'porte', mur, pos_m: pos, largeur_m: l, hauteur_m: 2.1, allege_m: 0 })
  const fen = (id, mur, pos) => ({ id, type: 'fenetre', mur, pos_m: pos, largeur_m: 1.2, hauteur_m: 1.2, allege_m: 1.0 })
  const ouvertures = [
    porte('P1', 'E1', 1.5), porte('P2', 'M2', 1.5), porte('P3', 'M1', 2.0), porte('P4', 'M1', 7.0), porte('P5', 'M3', 1.5),
    porte('P6', 'M3', 4.3, 0.7), porte('P7', 'M3', 5.55, 0.7), porte('P8', 'M3', 7.0),
    fen('F1', 'E1', 3.5), fen('F2', 'E4', 6.0), fen('F3', 'E1', 7.0), fen('F4', 'E4', 1.5), fen('F5', 'E2', 5.5),
  ]
  const poteaux = pan
    ? [[0, 0], [5.5, 0], [10, 0], [10, 4], [10, 7.5], [8.5, 9], [4, 9], [0, 9], [0, 4.5]]
    : [[0, 0], [5.5, 0], [10, 0], [10, 4.5], [10, 9], [4, 9], [0, 9], [0, 4.5]]
  const pots = poteaux.map(([x, y], i) => ({ id: `P${i + 1}`, x, y, a_cm: 20, b_cm: 20, forme: 'carre' }))
  const poutres = pots.map((p, i) => ({ p, q: pots[(i + 1) % pots.length] })).map(({ p, q }, i) => ({ id: `${i + 1}`, a: pt(p.x, p.y), b: pt(q.x, q.y), b_cm: 20, h_cm: 30 }))
  return {
    id, libelle: pan ? 'Compact à pan coupé' : 'Compact rectangulaire', description: pan ? 'Rectangle 10 × 9 m, pan coupé de 1,5 m au nord-est, couloir transversal.' : 'Rectangle 10 × 9 m, couloir transversal.',
    niveaux: [{
      id: 'RDC', nom: 'RDC', cote_m: 0, hsp_m: 2.8, contour, murs_int, pieces, ouvertures, poteaux: pots, poutres,
      dalle: { type: 'aucun' },
      equipements: {
        plomberie: [{ id: 'WC1', type: 'wc', x: 5.9, y: 6.3 }, { id: 'DO1', type: 'douche', x: 4.7, y: 6.3 }, { id: 'EV1', type: 'evier', x: 9.4, y: 1.5 }],
        electricite: [{ id: 'L1', type: 'point_lumineux', x: 2.7, y: 2 }, { id: 'L2', type: 'point_lumineux', x: 7.7, y: 2 }, { id: 'T1', type: 'tableau', x: 0.3, y: 3.5 }],
      },
    }],
    fondation: { type: 'filante', niveau_base_m: -1.15, semelle_filante: { l_cm: 40, h_cm: 25 }, dallage: { ep_cm: 10 } },
    toiture: { type: 'bac', debord_cm: 50, pans: [
      { id: 'T1', polygone: [pt(-0.5, -0.5), pt(10.5, -0.5), pt(10.5, 4.5), pt(-0.5, 4.5)], pente_pct: 20 },
      { id: 'T2', polygone: [pt(-0.5, 4.5), pt(10.5, 4.5), pt(10.5, 9.5), pt(-0.5, 9.5)], pente_pct: 20 },
    ] },
  }
}
const projet = {
  format: 'arkivio-projet-libre', version: '1.0',
  projet: { titre: 'Maison F3 — exemple', standing: 'standard', terrain: { largeur_m: 15, profondeur_m: 20 }, hypotheses: ['Niveau de base -1,15 m repris du gabarit v0.7 (à confirmer)', 'Plan indicatif : à valider par un ingénieur'] },
  parametres: { ep_ext_cm: 15, ep_cloison_cm: 10, hsp_m: 2.8 },
  variantes: [variante('A', true), variante('B', false)],
}
writeFileSync(new URL('../data/exemples/F3_pan_coupe.json', import.meta.url), JSON.stringify(projet, null, 1))
console.log('exemple écrit')
