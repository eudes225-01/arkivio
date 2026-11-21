// src/server.js
// Point d'entrée : démarre le serveur HTTP.
//   npm install && npm start
// Variables d'environnement : voir .env.example
import { createApp } from './app.js'
import { env, warnMissingConfig } from './config/env.js'

warnMissingConfig()
const app = createApp()
const serveur = app.listen(env.PORT, () => console.log(`Arkivio API → http://localhost:${env.PORT}`))

// Render envoie SIGTERM à chaque déploiement : on ferme proprement.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    serveur.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  })
}
