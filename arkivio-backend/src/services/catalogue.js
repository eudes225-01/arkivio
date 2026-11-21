// src/services/catalogue.js
// Catalogue des gabarits de plans (data/gabarits/*.json), chargé une fois au démarrage.
// C'est la SOURCE UNIQUE de ce que le service sait dessiner : /api/gabarits, la validation de /api/plan et
// le prompt de l'assistant en dérivent. Les standings proposés par variante sont calculés avec resolveLayout()
// du moteur : on n'annonce donc jamais une combinaison que le moteur refuserait (ex. F4 variante D en économique).
import fs from 'node:fs'
import path from 'node:path'
import { env } from '../config/env.js'
import { resolveLayout } from '../engine/plan-engine.mjs'

export function chargerGabarits(dossier = path.join(env.RACINE, 'data', 'gabarits')) {
  return fs.readdirSync(dossier)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8')))
}

export function construireCatalogue(gabarits) {
  const entrees = gabarits.map((g) => {
    const standingsTous = g.standing.choix.map((c) => c.id)
    const variantes = Object.keys(g.layout?.variantes || {}).map((id) => {
      const meta = (g.variantes || []).find((v) => v.id === id) || {}
      const standings = standingsTous.filter((s) => {
        try { resolveLayout(g, id, s); return true } catch { return false }
      })
      return { id, libelle: meta.libelle || `Variante ${id}`, description: meta.description || '', standings }
    }).filter((v) => v.standings.length)
    return {
      id: g.meta.id,
      libelle: g.meta.libelle,
      version: g.meta.version,
      appellation_locale: g.meta.appellation_locale || '',
      explication: g.meta.explication_type || '',
      standing_defaut: g.standing.defaut,
      standings: g.standing.choix.map((c) => ({ id: c.id, libelle: c.libelle, aide: c.aide || '' })),
      variantes,
    }
  }).filter((e) => e.variantes.length)
  const parId = new Map(entrees.map((e) => [e.id, e]))
  const gabaritsParId = new Map(gabarits.map((g) => [g.meta.id, g]))
  return { entrees, parId, gabaritsParId }
}

let courant = null
function cat() { return (courant ??= construireCatalogue(chargerGabarits())) }

/** Tableau renvoyé par GET /api/gabarits : [{ id, libelle, variantes: [{ id, standings: [...] }], … }]. */
export const listeGabarits = () => cat().entrees

/**
 * Retrouve un gabarit à partir d'un identifiant saisi ou produit par l'assistant.
 * Tolère la casse et la forme courte (« f3 » → F3_PLAIN_PIED). Renvoie { entree, g } ou null.
 */
export function trouverGabarit(id) {
  const brut = String(id ?? '').trim().toUpperCase()
  if (!brut) return null
  const { entrees, parId, gabaritsParId } = cat()
  const e = parId.get(brut) || entrees.find((x) => x.id.split('_')[0] === brut)
  return e ? { entree: e, g: gabaritsParId.get(e.id) } : null
}
