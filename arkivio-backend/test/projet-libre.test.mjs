import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { validerProjet, versCivilEstimator, developperContour, modeleNiveau } from '../src/projet-libre/index.mjs'

const charger = () => JSON.parse(readFileSync(new URL('../data/exemples/F3_pan_coupe.json', import.meta.url)))
const codes = (r) => r.violations.map((v) => v.code)
const niveauA = (p) => p.variantes[0].niveaux[0]

test('les deux variantes de l\'exemple sont valides, sans avertissement', () => {
  const r = validerProjet(charger())
  assert.equal(r.ok, true, JSON.stringify(r.violations))
  assert.equal(r.violations.length, 0)
})

test('le pan coupé est développé en 5 segments : E1 E2 C3 E3 E4', () => {
  const dev = developperContour(niveauA(charger()).contour)
  assert.deepEqual(dev.segments.map((s) => s.id), ['E1', 'E2', 'C3', 'E3', 'E4'])
  assert.ok(Math.abs(dev.segments[2].longueur - 1.5 * Math.SQRT2) < 1e-9)
})

test('un coin arrondi a une longueur d\'arc de rayon × (π − angle)', () => {
  const dev = developperContour([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 6, coin: { type: 'arrondi', rayon_m: 1 } }, { x: 0, y: 6 }])
  const arc = dev.segments.find((s) => s.id === 'C3')
  assert.equal(arc.kind, 'arc')
  assert.ok(Math.abs(arc.longueur - Math.PI / 2) < 1e-9)
})

test('aire et périmètre du modèle : 10×9 moins le pan coupé', () => {
  const M = modeleNiveau(niveauA(charger()))
  assert.ok(Math.abs(M.aire - (90 - 1.125)) < 1e-6)
  assert.ok(Math.abs(M.perim - (10 + 7.5 + 1.5 * Math.SQRT2 + 8.5 + 9)) < 1e-9)
})

test('détection : ouverture hors du mur, mur inconnu, ouverture sur arc', () => {
  const p = charger()
  const o = niveauA(p).ouvertures
  o.find((x) => x.id === 'P1').pos_m = 9.5
  o.find((x) => x.id === 'F5').mur = 'E9'
  niveauA(p).contour[2].coin = { type: 'arrondi', rayon_m: 1 }
  o.push({ id: 'F9', type: 'fenetre', mur: 'C3', pos_m: 0.2, largeur_m: 1, hauteur_m: 1.2, allege_m: 1 })
  const c = codes(validerProjet(p))
  for (const k of ['OUVERTURE_HORS_MUR', 'OUVERTURE_MUR_INCONNU', 'OUVERTURE_SUR_ARC']) assert.ok(c.includes(k), k)
})

test('détection : pièces qui se chevauchent et pièce hors contour', () => {
  const p = charger()
  const pieces = niveauA(p).pieces
  pieces.find((x) => x.id === 'cuisine').polygone = [[5, 0], [10, 0], [10, 4], [5, 4]]
  pieces.find((x) => x.id === 'rangement').polygone = [[4, 7.4], [6.4, 7.4], [6.4, 9], [4, 11]]
  const c = codes(validerProjet(p))
  assert.ok(c.includes('PIECES_CHEVAUCHENT'))
  assert.ok(c.includes('PIECE_HORS_CONTOUR'))
})

test('détection : emprise trop grande pour le terrain', () => {
  const p = charger()
  p.projet.terrain = { largeur_m: 9, profondeur_m: 20 }
  assert.ok(codes(validerProjet(p)).includes('EMPRISE_TERRAIN_LARGEUR'))
})

test('un poteau d\'étage sans poteau en dessous est refusé', () => {
  const p = charger()
  const rdc = niveauA(p)
  rdc.poteaux = rdc.poteaux.filter((x) => x.id !== 'P1')
  p.variantes[0].niveaux.push({ ...structuredClone(rdc), id: 'R+1', nom: 'R+1', cote_m: 3, poteaux: [{ id: 'P1', x: 0, y: 0, a_cm: 20, b_cm: 20 }] })
  const c = codes(validerProjet(p))
  assert.ok(c.includes('POTEAU_SANS_APPUI'))
  assert.ok(c.includes('ESCALIER_MANQUANT'))
})

test('une règle branchée (ex. arrêté) alimente la même liste de violations', () => {
  const regle = (variante) => variante.niveaux.flatMap((n) => (n.pieces || []).filter((x) => x.usage === 'chambre' && x.polygone.length < 3).map(() => ({ code: 'X' })))
  const r = validerProjet(charger(), { regles: [(v, ctx) => [{ code: 'REGLE_TEST', message: 'test', chemin: 'x' }], regle] })
  assert.ok(codes(r).includes('REGLE_TEST'))
  assert.equal(r.ok, false)
})

test('conversion CivilEstimator : surfaces d\'ouvertures exactes et lineaire de fondation', () => {
  const p = charger()
  const { levels, params } = versCivilEstimator(p, 'A')
  const e1 = levels[0].murs.find((m) => m.nom === 'E1')
  assert.equal(e1.fenetres, 2)
  assert.ok(Math.abs(e1.fenetres * e1.fL * e1.fH - 2 * 1.2 * 1.2) < 1e-6)
  assert.equal(levels[0].poteaux[0].nb, 9)
  assert.ok(Math.abs(params.fondation.lineaire - 37.12) < 0.01)
  assert.equal(params.plans.toiture.surfaceProjetee, 110)
})

// Intégration : exécute le vrai moteur CivilEstimator si son chemin est fourni
//   CIVILESTIMATOR_ENGINE=/chemin/civilestimateurB-main/src/index.js node --test
const moteur = process.env.CIVILESTIMATOR_ENGINE
test('le moteur CivilEstimator accepte la sortie sans erreur de schéma', { skip: !moteur || !existsSync(moteur) }, async () => {
  const { metrerProjet, validerEntrees } = await import(moteur)
  for (const id of ['A', 'B']) {
    const { levels, params } = versCivilEstimator(charger(), id)
    assert.deepEqual(validerEntrees(levels, params).erreurs, [], `schéma ${id}`)
    const r = metrerProjet(levels, params)
    assert.ok(r.totaux.acierKg > 0, `acier ${id}`)
    assert.ok(r.totaux.materiaux.lignes.length > 0)
    assert.equal(r.alertes.filter((a) => a.niveau === 'bloquante').length, 0, JSON.stringify(r.alertes.filter((a) => a.niveau === 'bloquante')))
  }
})
