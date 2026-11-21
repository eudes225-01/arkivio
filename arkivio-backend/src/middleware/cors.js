// src/middleware/cors.js
// Limite les origines autorisées à consommer l'API : même origine (frontend servi par ce backend),
// liste explicite (ALLOWED_ORIGINS) et, si renseignée, ORIGINES_REGEX (prévisualisations).
//
// Même origine : un navigateur envoie l'en-tête Origin sur un POST, y compris vers sa propre origine.
// Sans cette règle, le frontend servi par le backend serait refusé.
import cors from 'cors'
import { env } from '../config/env.js'

function autorise(origin, req) {
  if (!origin) return true // curl, health checks, requêtes serveur-à-serveur
  try { if (new URL(origin).host === req.get('host')) return true } catch { return false }
  if (env.ALLOWED_ORIGINS.includes(origin)) return true
  if (env.ORIGINES_REGEX?.test(origin)) return true
  // index.html ouvert directement depuis le disque (file://) envoie « Origin: null » : toléré hors production.
  return env.NODE_ENV !== 'production' && origin === 'null'
}

export const corsMiddleware = cors((req, cb) => {
  if (autorise(req.header('Origin'), req)) return cb(null, { origin: true })
  const e = new Error('Origine non autorisée.')
  e.status = 403
  cb(e)
})
