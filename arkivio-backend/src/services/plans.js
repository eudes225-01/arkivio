// src/services/plans.js
// Génération d'un plan : gabarit validé → modèle → dessin → SVG + PDF (base64) + IFC.
// Même chaîne que la ligne de commande du moteur (plan-engine.mjs), sans écrire sur le disque.
import fs from 'node:fs'
import { buildModel, drawPlan, toIFC, toPDF, toSVG } from '../engine/plan-engine.mjs'
import { controlerConformite } from '../engine/conformite.mjs'

const regles = JSON.parse(fs.readFileSync(new URL('../../data/regles_benin.json', import.meta.url), 'utf8'))

function decrireEcart(e) {
  const piece = e.piece ? ` (${e.piece})` : ''
  const n = (v) => Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 })
  switch (e.regle) {
    case 'hauteur_sous_plafond':
      return `Hauteur sous plafond : ${n(e.valeur)} m, minimum indiqué ${n(e.minimum)} m.`
    case 'surface_piece_habitable':
      return `Surface habitable${piece} : ${n(e.valeur)} m², minimum indiqué ${n(e.minimum)} m².`
    case 'plus_petit_cote':
      return `Plus petit côté${piece} : ${n(e.valeur)} m, minimum indiqué ${n(e.minimum)} m.`
    case 'largeur_couloir':
      return `Largeur de circulation${piece} : ${n(e.valeur)} m, minimum indiqué ${n(e.minimum)} m.`
    case 'eclairage_un_sixieme':
      return `Surface de baies comptée pour l’éclairage${piece} : ${n(e.valeur)} m², minimum indiqué ${n(e.minimum)} m².`
    default:
      return `Écart au précontrôle${piece} : ${e.regle}.`
  }
}

/** @returns {{ svg: string, pdf: string, ifc: string, page: {format, orientation, echelle}, alertes: string[] }} */
export function genererPlan({ g, standing, variante, options }) {
  const m = buildModel(g, { standing, variante })
  const d = drawPlan(m, g, options)             // le dessin complète m.warnings (cotes courtes, libellés trop grands…)
  const ecarts = controlerConformite(m, regles)
  const alertes = [...new Set([
    ...m.warnings,
    'Précontrôle limité aux surfaces, dimensions, couloirs et éclairage. Il ne vérifie pas la ventilation ni les règles du terrain et du dossier de permis ; faites valider le projet par un professionnel.',
    ...ecarts.map(decrireEcart),
  ])]
  if (d.page.tient === false) {
    alertes.push(`Le plan ne tient pas en ${d.page.format} ${d.page.orientation} à l'échelle 1/${d.page.echelle} : choisissez « Automatique » ou un format plus grand.`)
  }
  return {
    svg: toSVG(d),
    pdf: toPDF(d).toString('base64'),           // le frontend le décode avec atob()
    // Nom du modèle, pas le texte saisi : une apostrophe saisie casserait la syntaxe STEP du fichier IFC.
    ifc: toIFC(m, { projet: g.meta.libelle }),
    page: { format: d.page.format, orientation: d.page.orientation, echelle: d.page.echelle },
    alertes,
  }
}
