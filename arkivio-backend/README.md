# Arkivio — backend

API Express d'Arkivio : un assistant (Claude) qui cadre le projet, puis le moteur de plans (`plan-engine.mjs` v0.7)
qui génère les plans en **PDF, SVG et IFC**. Même architecture que le backend CivilEstimateur
(`createApp()` séparé de `server.js`, `config/env.js`, helmet + CORS + limites de débit, relais Anthropic sans
exposer la clé, validation en liste blanche, tests `node:test`, déploiement Render).

## Contrat avec le frontend (`public/index.html`)

| Route | Corps | Réponse |
|---|---|---|
| `GET /api/gabarits` | — | `[{ id, libelle, variantes: [{ id, standings: [...] }], … }]` — remplit « Type de maison » / « Standing » et l'indicateur « Serveur connecté » |
| `POST /api/chat` | `{ messages: [{role, content}], fichiers: [{nom, type, donnees}] }` | `{ reponse, pret, projet? }` — `projet` = `{ gabarit, standing, format?, echelle?, orientation?, projet?, titre?, phase?, planche?, moa?, moe?, resume? }` |
| `POST /api/plan` | `{ gabarit, standing, variante, format, echelle, orientation, projet, titre, phase, planche, moa, moe, date }` | `{ svg, pdf (base64), ifc, page: { format, orientation, echelle }, alertes: [] }` |
| `POST /api/dossier` | mêmes champs que `/api/plan` | `{ pdf (base64, dossier multi-planches), planches: [{ type, pdf, svg, descriptif_svg }], ifc, non_generees }` |
| `GET /api/health` | — | `{ ok: true }` |

Les erreurs sont toujours `{ erreur: "message lisible" }` (clé lue par le frontend), avec un statut HTTP cohérent :
400 saisie invalide · 413 fichiers trop gros · 422 fichier illisible · 429 trop de requêtes · 501 assistant non configuré · 503/504 Anthropic indisponible.

## Ce qui est repris de CivilEstimateur, et ce qui change

| Repris | Adapté pour Arkivio |
|---|---|
| `createApp()` / `server.js`, helmet, CORS par liste, `trust proxy`, limites de débit, gestionnaire d'erreur JSON | Clé d'erreur `erreur` (le frontend Arkivio lit `d.erreur`) ; CSP adaptée au frontend en un seul fichier |
| Relais `fetch` vers `api.anthropic.com`, clé jamais côté navigateur, validation du corps avant tout appel facturé | Discussion texte + PDF/images, **sortie structurée par outil** (`projet_pret`) validée contre le catalogue |
| Moteur de calcul isolé de l'API | `src/engine/plan-engine.mjs` **inchangé** ; les gabarits JSON dans `data/gabarits/` sont la source unique |

**Pas repris (volontairement)** : comptes Supabase, crédits CST, FedaPay, e-mails Resend, PDF Chromium. Le frontend
Arkivio n'a ni connexion ni paiement : ces routes n'auraient aucun appelant. Si tu veux les ajouter, le plus simple est de
copier `middleware/auth.js`, `middleware/access.js` et `services/credits.js` de CivilEstimateur et de les brancher devant
`/api/chat` (la seule route payante) comme `analyse-plan` ; dis-le-moi et je le fais.

## Structure

```
src/
  app.js  server.js
  config/env.js
  middleware/   cors.js  rateLimit.js
  routes/       health.js  gabarits.js  chat.js  plan.js
  services/
    catalogue.js     charge data/gabarits/*.json ; calcule variantes × standings réellement disponibles
    saisie.js        validation/nettoyage de /api/plan et de la sortie de l'assistant
    plans.js         gabarit → modèle → SVG + PDF + IFC
    assistant.js     prompt (dérivé du catalogue), outil projet_pret, appel Anthropic, mapping d'erreurs
    validerChat.js   validation en liste blanche de /api/chat
  engine/plan-engine.mjs
data/gabarits/       F2, F3, F4 plain-pied (v0.7)
public/              le frontend, servi tel quel (window.ARKIVIO_API_URL = "" → même origine)
outils/valider_gabarits.py   contrôle des layouts (surfaces, largeurs, accès)
test/                logique.test.js (sans Express)  ·  app.test.js (HTTP, assistant simulé)
```

**Ajouter un gabarit** : déposer le JSON dans `data/gabarits/`, redémarrer. Il apparaît tout seul dans `/api/gabarits`,
dans la validation et dans le prompt de l'assistant. Une variante ou un standing que le moteur refuse n'est jamais annoncé.

## Lancer en local (Git Bash)

```bash
cd arkivio-backend
npm install
cp .env.example .env        # renseigner ANTHROPIC_API_KEY
npm run dev                 # http://localhost:8080 (API + frontend)
npm test
```

Sans `ANTHROPIC_API_KEY`, la génération de plans fonctionne ; seul `/api/chat` répond 501.

## Déployer sur Render

- Service Web, *Root Directory* = `arkivio-backend` (ou la racine du dépôt si tu y mets ce dossier seul), Node ≥ 20.
- Build : `npm install` · Start : `npm start`.
- Variables : `ANTHROPIC_API_KEY` (obligatoire pour le chat), `ALLOWED_ORIGINS` **seulement si** le frontend est hébergé
  ailleurs (ex. Vercel) — dans ce cas, mettre l'URL du backend dans `window.ARKIVIO_API_URL` de `index.html`.
- Si le frontend est servi par le backend, rien d'autre à régler : même origine, pas de CORS.

## Points à connaître

- **Modèle** : `ANTHROPIC_MODEL` vaut `claude-sonnet-4-6` par défaut, comme dans CivilEstimateur ; modifiable sans toucher au code.
  Les réponses sont courtes : `ANTHROPIC_MAX_TOKENS=1024` (CivilEstimateur utilise 16000 pour lire des plans).
- **Alerte connue** : F4 variante D (standard et confort) signale « cote très courte (0,10 m) » — décalage de cloisons dans
  le gabarit, déjà noté dans le README du moteur. Elle remonte dans `alertes` et s'affiche sous le plan.
- **CSP** : le frontend est un fichier unique avec scripts et styles intégrés, d'où `'unsafe-inline'`. Si tu le sépares
  en fichiers `.js`/`.css`, retire-le dans `src/app.js`.
- **Limites** : `/api/chat` 40 messages / 15 min / IP ; `/api/plan` 80 / 15 min / IP (une requête par variante).
  Fichiers joints : PDF, JPEG, PNG, WebP (les photos HEIC d'iPhone sont refusées avec un message clair), 16 Mo au total.
- **Texte du cartouche** : les caractères que le PDF (Helvetica / WinAnsi) ne sait pas écrire sont retirés (emoji, alphabets
  non latins). Le moteur met le nom du projet en majuscules.
- **Fichier IFC** : il porte le libellé du modèle, pas le texte saisi (une apostrophe casserait la syntaxe du fichier).
- **Précontrôle réglementaire** : chaque plan généré est vérifié pour les surfaces habitables, les dimensions minimales,
  la largeur des couloirs et l'éclairage. Les écarts remontent dans `alertes`. Ce contrôle ne vérifie pas la ventilation,
  l'implantation, la densité, l'assainissement, le stationnement ni la complétude du dossier de permis ; il ne certifie
  donc pas la conformité à l'arrêté 0169. Faire valider les plans par un professionnel.
- **Dossier de métré** : `POST /api/dossier` produit un PDF multi-planches, un PDF et un SVG par planche, les descriptifs
  en SVG et un IFC architectural. Les réseaux et planches de structure sont schématiques, avec des hypothèses non
  calculées ; le ferraillage reste explicitement non généré. Ces sorties servent à préparer un métré préliminaire,
  pas à exécuter les travaux ni à établir un devis définitif sans validation.
