// src/routes/chat.js
// POST /api/chat → { reponse, pret, projet? } (voir services/assistant.js).
// Corps : { messages: [{role, content}], fichiers: [{nom, type, donnees}] } — historique complet à chaque appel.
import { Router } from 'express'
import { chatLimiter } from '../middleware/rateLimit.js'
import { ErreurAssistant } from '../services/assistant.js'
import { ChatInvalide, validerChat } from '../services/validerChat.js'

export function chatRouter(dialoguer) {
  const router = Router()
  router.post('/chat', chatLimiter, async (req, res) => {
    try {
      const donnees = validerChat(req.body)            // validé AVANT tout appel facturé
      res.json(await dialoguer(donnees))
    } catch (e) {
      if (e instanceof ChatInvalide) return res.status(400).json({ erreur: e.message })
      if (e instanceof ErreurAssistant) return res.status(e.status).json({ erreur: e.message })
      console.error('[chat]', e)
      res.status(500).json({ erreur: 'L’assistant est indisponible. Réessayez dans un instant.' })
    }
  })
  return router
}
