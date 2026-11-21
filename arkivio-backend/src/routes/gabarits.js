// src/routes/gabarits.js
// GET /api/gabarits → catalogue des modèles de plans (remplit les listes « Type de maison » et « Standing »
// du formulaire, et sert d'indicateur « Serveur connecté » au frontend).
import { Router } from 'express'
import { listeGabarits } from '../services/catalogue.js'

export const gabaritsRouter = Router()

gabaritsRouter.get('/gabarits', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(listeGabarits())
})
