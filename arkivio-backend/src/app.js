// src/app.js
// Assemblage de l'application Express — middlewares puis routes. Séparé de server.js pour permettre de tester
// `createApp()` sans ouvrir de port réseau (voir test/app.test.js).
import fs from 'node:fs'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { corsMiddleware } from './middleware/cors.js'
import { apiLimiter } from './middleware/rateLimit.js'
import { healthRouter } from './routes/health.js'
import { gabaritsRouter } from './routes/gabarits.js'
import { planRouter } from './routes/plan.js'
import { chatRouter } from './routes/chat.js'
import { dialoguerAvecClaude } from './services/assistant.js'

/** @param {{ dialoguer?: Function }} [options] `dialoguer` : remplaçable dans les tests pour ne jamais appeler Anthropic. */
export function createApp({ dialoguer = dialoguerAvecClaude } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // Render est derrière un proxy : sans cela, la limite de débit voit une seule IP pour tous

  // Le frontend est un seul fichier avec scripts et styles intégrés + polices Google : la CSP par défaut de helmet
  // le bloquerait. Celle-ci reste stricte pour le reste (pas de script externe, pas d'objet, pas d'iframe).
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],       // plans affichés via des URL blob:
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        ...(env.NODE_ENV === 'production' ? {} : { upgradeInsecureRequests: null }),
      },
    },
  }))
  app.use(corsMiddleware)

  // Seule la discussion reçoit de gros corps (PDF/images en base64) ; elle est validée champ par champ dans la route.
  // Le 1ᵉʳ parseur qui lit le corps l'emporte : celui-ci doit donc rester AVANT le parseur général.
  app.use('/api/chat', express.json({ limit: '25mb' }))
  app.use(express.json({ limit: '256kb' }))
  app.use('/api', apiLimiter)

  app.use('/api', healthRouter)
  app.use('/api', gabaritsRouter)
  app.use('/api', planRouter)
  app.use('/api', chatRouter(dialoguer))
  app.use('/api', (_req, res) => res.status(404).json({ erreur: 'Route inconnue.' }))

  // Frontend servi par le backend (index.html laisse window.ARKIVIO_API_URL vide : même origine).
  if (env.FRONTEND_DIR && fs.existsSync(env.FRONTEND_DIR)) {
    app.use(express.static(env.FRONTEND_DIR, { maxAge: env.NODE_ENV === 'production' ? '1h' : 0 }))
  }

  // Gestionnaire d'erreur générique : API strictement JSON, avec la clé « erreur » lue par le frontend.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ erreur: 'Les fichiers joints sont trop volumineux (16 Mo au total au maximum).' })
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'Requête illisible.' })
    const status = err.status || 500
    if (status >= 500) console.error(err)
    res.status(status).json({ erreur: status >= 500 ? 'Erreur du serveur. Réessayez dans un instant.' : err.message })
  })

  return app
}
