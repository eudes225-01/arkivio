// Conformité des plans générés aux prescriptions minimales béninoises (arrêté n°0169 du 24 mai 2024).
// Ce test n'a besoin d'aucune dépendance : il appelle directement le moteur.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildModel } from '../src/engine/plan-engine.mjs'
import { controlerConformite } from '../src/engine/conformite.mjs'

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data')
const regles = JSON.parse(fs.readFileSync(path.join(racine, 'regles_benin.json'), 'utf8'))
const dossier = path.join(racine, 'gabarits')
const STANDINGS = ['economique', 'standard', 'confort']

for (const fichier of fs.readdirSync(dossier).filter((f) => f.endsWith('.json')).sort()) {
  const gabarit = JSON.parse(fs.readFileSync(path.join(dossier, fichier), 'utf8'))
  for (const variante of Object.keys(gabarit.layout.variantes)) {
    for (const standing of STANDINGS) {
      if (gabarit.layout.variantes[variante].indisponible_standing?.[standing]) continue
      test(`${fichier} · variante ${variante} · ${standing} respecte l'arrêté 169`, () => {
        const modele = buildModel(gabarit, { variante, standing })
        const ecarts = controlerConformite(modele, regles)
        assert.deepEqual(ecarts, [], 'écarts : ' + JSON.stringify(ecarts))
      })
    }
  }
}

test('le contrôle détecte une chambre unique sous 12 m² et un éclairage insuffisant', () => {
  const modele = {
    W: 4, D: 4, tE: 0.15, tI: 0.12, hsp: 2.8,
    rooms: [{ id: 'chambre', x0: 0, x1: 3, y0: 0, y1: 3, aire: 7.2 }],
    ops: [{ kind: 'fenetre', axis: 'x', cx: 1.5, cy: 0.075, w: 0.6, h: 0.6, sill: 1.0, th: 0.15 }]
  }
  const regle = controlerConformite(modele, regles).map((e) => e.regle).sort()
  assert.deepEqual(regle, ['eclairage_un_sixieme', 'surface_piece_habitable'])
})

test("la partie d'une baie située sous 0,90 m n'est pas comptée dans l'éclairage", () => {
  const modele = {
    W: 4, D: 4, tE: 0.15, tI: 0.12, hsp: 2.8,
    rooms: [{ id: 'salon', x0: 0, x1: 4, y0: 0, y1: 4, aire: 16.5 }],
    // fenêtre de 1,0 m x 1,0 m posée à 0,5 m : de 0,5 à 1,5 m, seuls 0,6 m au-dessus de 0,90 m comptent
    ops: [{ kind: 'fenetre', axis: 'x', cx: 2, cy: 0.075, w: 1, h: 1, sill: 0.5, th: 0.15 }]
  }
  const e = controlerConformite(modele, regles).find((x) => x.regle === 'eclairage_un_sixieme')
  assert.equal(e.valeur, 0.6)
})
