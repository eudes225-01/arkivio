// src/services/saisie.js
// Validation et nettoyage des entrées de /api/plan et de la sortie structurée de l'assistant.
// Les textes libres finissent dans le cartouche du PDF (Helvetica / WinAnsi, écrit à la main par le moteur) :
// on retire donc tout ce que ce jeu de caractères ne sait pas afficher, plutôt que de produire un PDF illisible.
import { trouverGabarit } from './catalogue.js'

export class SaisieInvalide extends Error {}
const refus = (m) => { throw new SaisieInvalide(m) }

export const FORMATS = ['A5', 'A4', 'A3', 'A2', 'A1', 'A0']
export const ECHELLES = ['50', '100', '200', '500', '1000']
export const ORIENTATIONS = ['portrait', 'paysage']

/** Nettoie un texte libre : espaces normalisés, typographie ramenée au latin, longueur bornée. */
export function nettoyerTexte(valeur, max) {
  if (valeur == null) return ''
  const s = String(valeur).normalize('NFC')
    .replace(/[\u2018\u2019\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\u0020-\u007E\u00A0-\u00FF\u0152\u0153]/g, ' ')   // contrôles, emoji, alphabets hors WinAnsi
    .replace(/\s+/g, ' ').trim()
  return s.slice(0, max).trim()
}

const CHAMPS_TEXTE = { projet: 80, titre: 60, phase: 40, planche: 20, moa: 80, moe: 80 }

function choisir(valeur, autorises, nom, normaliser = (x) => x) {
  if (valeur == null || valeur === '') return 'auto'
  const brut = String(valeur).trim()
  if (brut.toLowerCase() === 'auto') return 'auto'
  const v = normaliser(brut)
  if (!autorises.includes(v)) refus(`${nom} : valeur inconnue (« ${nettoyerTexte(valeur, 20)} »). Valeurs possibles : auto, ${autorises.join(', ')}.`)
  return v
}

const formatOptions = (v) => choisir(v, FORMATS, 'format', (x) => x.toUpperCase())
const echelleOptions = (v) => choisir(v, ECHELLES, 'échelle', (x) => x.replace(/^1\s*[/:]\s*/, ''))
const orientationOptions = (v) => choisir(v, ORIENTATIONS, 'orientation', (x) => x.toLowerCase())

function dateValide(valeur) {
  if (valeur == null || valeur === '') return ''
  const s = String(valeur).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  if (!m || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 2000 || +m[1] > 2100) {
    refus('date : format AAAA-MM-JJ attendu (entre 2000 et 2100).')
  }
  return s
}

/**
 * Valide le corps de POST /api/plan. Lève SaisieInvalide ; sinon renvoie tout ce qu'il faut pour dessiner.
 * @returns {{ g, entree, standing, variante, options }}
 */
export function validerDemandePlan(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) refus('Corps JSON attendu.')
  const t = trouverGabarit(corps.gabarit)
  if (!t) refus(`gabarit inconnu : « ${nettoyerTexte(corps.gabarit, 40)} ».`)
  const { g, entree } = t

  const standing = String(corps.standing || entree.standing_defaut).trim().toLowerCase()
  if (!entree.standings.some((s) => s.id === standing)) {
    refus(`standing inconnu : « ${nettoyerTexte(standing, 20)} ». Valeurs possibles : ${entree.standings.map((s) => s.id).join(', ')}.`)
  }
  const variante = String(corps.variante || entree.variantes[0].id).trim().toUpperCase()
  const v = entree.variantes.find((x) => x.id === variante)
  if (!v) refus(`variante inconnue : « ${nettoyerTexte(variante, 10)} ». Variantes de ${entree.libelle} : ${entree.variantes.map((x) => x.id).join(', ')}.`)
  if (!v.standings.includes(standing)) refus(`la variante ${variante} n'existe pas en standing ${standing}.`)

  const txt = {}
  for (const [k, max] of Object.entries(CHAMPS_TEXTE)) txt[k] = nettoyerTexte(corps[k], max) || undefined
  const date = dateValide(corps.date)
  const options = {
    format: formatOptions(corps.format),
    echelle: echelleOptions(corps.echelle),
    orientation: orientationOptions(corps.orientation),
    projet: txt.projet, titre: txt.titre, phase: txt.phase, planche: txt.planche,
    maitre_ouvrage: txt.moa, maitre_oeuvre: txt.moe,
    // Midi local : évite qu'un décalage de fuseau fasse afficher la veille dans le cartouche.
    date: date ? `${date}T12:00:00` : undefined,
  }
  return { g, entree, standing, variante, options }
}

/**
 * Nettoie le projet proposé par l'assistant (sortie d'outil). gabarit et standing doivent être valides, sinon null ;
 * les champs facultatifs invalides sont simplement ignorés (le formulaire garde alors sa valeur par défaut).
 */
export function normaliserProjetAssistant(brut) {
  if (!brut || typeof brut !== 'object') return null
  const t = trouverGabarit(brut.gabarit)
  if (!t) return null
  const standing = String(brut.standing || '').trim().toLowerCase()
  if (!t.entree.variantes.some((v) => v.standings.includes(standing))) return null
  const p = { gabarit: t.entree.id, standing }
  const essayer = (cle, f) => { try { const v = f(brut[cle]); if (v && v !== 'auto') p[cle] = v } catch (e) { if (!(e instanceof SaisieInvalide)) throw e } }
  essayer('format', formatOptions)
  essayer('echelle', echelleOptions)
  essayer('orientation', orientationOptions)
  for (const [k, max] of Object.entries(CHAMPS_TEXTE)) { const v = nettoyerTexte(brut[k], max); if (v) p[k] = v }
  const resume = nettoyerTexte(brut.resume, 400)
  if (resume) p.resume = resume
  return p
}
