// src/middleware/rateLimit.js
// /api/chat est facturé par appel Anthropic : sans limite, n'importe qui pourrait consommer le crédit du projet.
// Les messages d'erreur utilisent la clé « erreur » : c'est celle que lit le frontend Arkivio.
import rateLimit from 'express-rate-limit'

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de requêtes. Réessayez dans un instant.' },
})

// Discussion avec l'assistant (appel payant).
export const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de messages envoyés depuis cette adresse. Réessayez dans quelques minutes.' },
})

// Génération de plans : le frontend envoie une requête par variante (jusqu'à 4 par validation du formulaire).
export const planLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 80,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de plans générés depuis cette adresse. Réessayez dans quelques minutes.' },
})
