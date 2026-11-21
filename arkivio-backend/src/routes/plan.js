// src/routes/plan.js
// POST /api/plan → génère UN plan (une variante) : { svg, pdf (base64), ifc, page, alertes }.
// Le frontend envoie une requête par variante du modèle choisi.
import { Router } from 'express'
import { planLimiter } from '../middleware/rateLimit.js'
import { genererPlan } from '../services/plans.js'
import { SaisieInvalide, validerDemandePlan } from '../services/saisie.js'

export const planRouter = Router()

planRouter.post('/plan', planLimiter, (req, res) => {
  let demande
  try {
    demande = validerDemandePlan(req.body)
  } catch (e) {
    if (e instanceof SaisieInvalide) return res.status(400).json({ erreur: e.message })
    throw e
  }
  try {
    res.json(genererPlan(demande))
  } catch (e) {
    console.error('[plan]', demande.entree.id, demande.variante, demande.standing, e)
    res.status(500).json({ erreur: 'Impossible de générer ce plan. Essayez avec « Automatique » pour le format et l’échelle.' })
  }
})
