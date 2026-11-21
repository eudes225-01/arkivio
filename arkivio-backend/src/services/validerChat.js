// src/services/validerChat.js
// Validation stricte du corps de POST /api/chat : { messages: [{role, content}], fichiers: [{nom, type, donnees}] }.
// Chaque requête valide est facturée par Anthropic : on n'accepte que la forme réellement émise par le frontend
// et on RECONSTRUIT les objets (liste blanche) pour qu'aucun champ inattendu ne traverse le relais.
export const LIMITES = Object.freeze({
  MESSAGES: 40,             // messages de la discussion (aller-retour compris)
  TEXTE: 4_000,             // caractères par message
  TEXTE_TOTAL: 40_000,      // caractères sur toute la discussion
  FICHIERS: 5,              // le frontend en autorise 5
  NOM: 100,
  FICHIER_B64: 14_000_000,  // base64 par fichier (~10 Mo, la limite du frontend)
  TOTAL_B64: 22_000_000,    // base64 cumulé (~16 Mo) : reste sous le plafond de 32 Mo d'une requête Anthropic
})

// type MIME accepté → type de bloc Anthropic
export const TYPES_FICHIERS = new Map([
  ['application/pdf', 'document'],
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
])
const B64 = /^[A-Za-z0-9+/]+={0,2}$/

export class ChatInvalide extends Error {}
const refus = (m) => { throw new ChatInvalide(m) }

const nomSur = (s) => String(s ?? '').replace(/[^\p{L}\p{N} ._()\-]/gu, '_').slice(0, LIMITES.NOM) || 'fichier'

/** @returns {{ messages: Array<{role:'user'|'assistant', content:string}>, fichiers: Array<{nom:string, type:string, donnees:string}> }} */
export function validerChat(corps) {
  if (!corps || typeof corps !== 'object' || Array.isArray(corps)) refus('Corps JSON attendu.')
  const { messages, fichiers = [] } = corps

  if (!Array.isArray(messages) || messages.length === 0) refus('Aucun message à traiter.')
  if (messages.length > LIMITES.MESSAGES) refus('La discussion est trop longue : recommencez une nouvelle discussion.')
  let total = 0
  const propres = messages.map((m, i) => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) refus(`messages[${i}] : objet attendu.`)
    if (m.role !== 'user' && m.role !== 'assistant') refus(`messages[${i}].role : « user » ou « assistant » attendu.`)
    if (typeof m.content !== 'string' || !m.content.trim()) refus(`messages[${i}].content : texte non vide attendu.`)
    if (m.content.length > LIMITES.TEXTE) refus(`Un message dépasse ${LIMITES.TEXTE} caractères : raccourcissez-le.`)
    total += m.content.length
    return { role: m.role, content: m.content }
  })
  if (total > LIMITES.TEXTE_TOTAL) refus('La discussion est trop longue : recommencez une nouvelle discussion.')
  if (propres[0].role !== 'user') refus('La discussion doit commencer par un message de l’utilisateur.')
  if (propres[propres.length - 1].role !== 'user') refus('Le dernier message doit venir de l’utilisateur.')

  if (!Array.isArray(fichiers)) refus('fichiers : tableau attendu.')
  if (fichiers.length > LIMITES.FICHIERS) refus(`${LIMITES.FICHIERS} fichiers au maximum.`)
  let totalB64 = 0
  const joints = fichiers.map((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) refus(`fichiers[${i}] : objet attendu.`)
    const nom = nomSur(f.nom)
    if (!TYPES_FICHIERS.has(f.type)) refus(`« ${nom} » : format non pris en charge (PDF, JPEG, PNG ou WebP uniquement).`)
    if (typeof f.donnees !== 'string' || !f.donnees) refus(`« ${nom} » : fichier vide.`)
    if (f.donnees.length > LIMITES.FICHIER_B64) refus(`« ${nom} » : fichier trop volumineux (10 Mo au maximum).`)
    totalB64 += f.donnees.length
    if (totalB64 > LIMITES.TOTAL_B64) refus('Les fichiers joints dépassent 16 Mo au total : envoyez-en moins à la fois.')
    if (!B64.test(f.donnees)) refus(`« ${nom} » : contenu illisible.`)
    return { nom, type: f.type, donnees: f.donnees }
  })
  return { messages: propres, fichiers: joints }
}
