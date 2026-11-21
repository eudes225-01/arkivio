// src/services/plans.js
// Génération d'un plan : gabarit validé → modèle → dessin → SVG + PDF (base64) + IFC.
// Même chaîne que la ligne de commande du moteur (plan-engine.mjs), sans écrire sur le disque.
import { buildModel, drawPlan, toIFC, toPDF, toSVG } from '../engine/plan-engine.mjs'

/** @returns {{ svg: string, pdf: string, ifc: string, page: {format, orientation, echelle}, alertes: string[] }} */
export function genererPlan({ g, standing, variante, options }) {
  const m = buildModel(g, { standing, variante })
  const d = drawPlan(m, g, options)             // le dessin complète m.warnings (cotes courtes, libellés trop grands…)
  const alertes = [...new Set(m.warnings)]
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
