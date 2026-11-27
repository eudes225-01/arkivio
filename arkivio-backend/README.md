# Arkivio — backend (v1.1)

API Express d'Arkivio : Claude cadre un projet de maison libre, le validateur contrôle sa géométrie et le moteur met en page ses plans en **PDF Chromium, SVG et IFC**. Le backend sert aussi le frontend (`public/index.html`, une seule origine).

Même architecture que le backend CivilEstimateur : `createApp()` séparé de `server.js`, `config/env.js`, helmet + CORS +
limites de débit, relais Anthropic sans exposer la clé, validation en liste blanche, tests `node:test`, déploiement Render.

---

## 1. Nouveautés de la v1.1

| Nouveauté | Où | État |
|---|---|---|
| **Dictée vocale** dans le chat (bouton micro, envoi automatique après un silence) | `public/index.html` | Prête. Testée sur une fausse reconnaissance vocale ; **à essayer sur Chrome / Safari après déploiement** |
| **Génération libre avec Claude** (géométrie personnalisée, variantes et niveaux) + boucle de correction des erreurs géométriques | `src/services/assistant.js`, `src/projet-libre/` | Reliée à `/api/chat` ; les sorties invalides sont renvoyées à Claude pour correction |
| **Dossier libre** : PDF Chromium, SVG, IFC, source JSON, métré JSON et descriptif Markdown regroupés en ZIP | `src/projet-libre/rendu.mjs`, `src/projet-libre/ifc.mjs`, `src/routes/projet-libre.js` | Généré par `/api/projet-libre/plans` pour chaque variante et niveau |
| **Rendu Chromium** (SVG/HTML → PDF vectoriel, polices Inter embarquées) | `src/services/pdf/`, `src/services/plans.js`, `.puppeteerrc.cjs`, `outils/essai_rendu.mjs` | Utilisé par `/api/plan` ; essai de rendu réussi sur Render |
| `package.json`, `.env.example`, `.gitignore`, `.node-version` | racine | Mis à jour / ajoutés |

La route de catalogue et `/api/plan` restent disponibles pour compatibilité. Le frontend utilise le flux libre Claude → validation → `/api/projet-libre/plans`.

---

## 2. Contrat avec le frontend (`public/index.html`)

| Route | Corps | Réponse |
|---|---|---|
| `GET /api/gabarits` | — | `[{ id, libelle, variantes: [{ id, standings: [...] }], … }]` — remplit « Type de maison » / « Standing » et l'indicateur « Serveur connecté » |
| `POST /api/chat` | `{ messages: [{role, content}], fichiers: [{nom, type, donnees}] }` | `{ reponse, pret, projet? }` |
| `POST /api/plan` | `{ gabarit, standing, variante, format, echelle, orientation, projet, titre, phase, planche, moa, moe, date }` | `{ svg, pdf (base64), ifc, page: { format, orientation, echelle }, alertes: [] }` |
| `POST /api/projet-libre/plans` | `{ projet: <arkivio-projet-libre v1.0>, options? }` | Toutes les planches PDF/SVG, IFC par variante, métré dérivé, projet JSON, descriptif et archive ZIP complète |
| `GET /api/health` | — | `{ ok: true }` |

Les erreurs sont toujours `{ erreur: "message lisible" }`, avec un statut HTTP cohérent :
400 saisie invalide · 413 fichiers trop gros · 422 fichier illisible · 429 trop de requêtes · 501 assistant non configuré · 503/504 Anthropic indisponible.

---

## 3. Dictée vocale (message « audio » dans le chat)

**Principe.** Claude ne lit pas l'audio : l'API Anthropic accepte du texte, des images et des PDF, pas des fichiers sonores.
Le bouton micro utilise donc la **reconnaissance vocale intégrée au navigateur** (Web Speech API, langue `fr-FR`) : gratuite,
sans clé, sans abonnement. Le navigateur transforme la voix en texte, et ce texte part vers `/api/chat` comme un message tapé.
**Le backend n'a rien à faire** : aucune route, aucun envoi de fichier audio.

**Utilisation.**
1. Toucher le micro (à gauche du bouton Envoyer) et parler. Le texte s'écrit en direct dans la zone de message, à la suite de ce qui est déjà tapé. Le bouton devient rouge et pulse.
2. Après **2,5 s de silence**, ou en retouchant le micro, la dictée s'arrête et **le message part tout seul**.
3. Rien ne part si rien n'a été reconnu, si une erreur survient (micro refusé, pas de connexion) ou si l'assistant est déjà en train de répondre.
4. Sur ordinateur, **Échap** annule la dictée et restaure la zone de saisie. Sur téléphone, tout ce qui est dit est envoyé.
5. Un envoi manuel (Entrée ou bouton Envoyer) pendant la dictée coupe la dictée avant l'envoi : pas de double envoi.

**Réglages** (début du dernier `<script>` de `index.html`) :
```js
var ENVOI_AUTO=true, SILENCE_MS=2500;   // ENVOI_AUTO=false : le texte reste dans la zone pour relecture
```

**Compatibilité et limites.**
- Chrome, Edge, Safari (ordinateur et téléphone) : oui. Il faut internet (la transcription est faite par le service du navigateur). **Firefox** : pas de dictée, le bouton reste caché.
- Le micro demande l'autorisation du navigateur, et le site doit être en **HTTPS** (c'est le cas sur Render).
- La reconnaissance est moins sûre sur les termes très techniques et sur les mots en fon ou en yoruba : en mode envoi automatique, on ne relit pas.
- Aucune règle de sécurité du backend ne gêne le micro (helmet 7 ne pose pas de Permissions-Policy ; la CSP ne s'applique pas à la reconnaissance vocale lancée par le navigateur).

**Évolution possible : transcription sur le serveur.** Plus fiable et indépendante du navigateur, mais elle demande un service externe
(OpenAI ou Groq, par exemple), une clé, un coût à la minute, une route `POST /api/transcrire` et un enregistrement audio côté navigateur.
La dictée actuelle resterait comme solution de repli.

---

## 4. Format de projet libre v1.0

Détail complet : `docs/FORMAT_PROJET_LIBRE.md`. Schéma JSON (à donner à l'outil Claude) : `data/schemas/projet-libre.schema.json`.
Exemple : `data/exemples/F3_pan_coupe.json` (variante A : pan coupé de 1,5 m ; variante B : rectangle).

**Pourquoi.** Le schéma de CivilEstimator ne contient que des **quantités** (nombre, longueur, hauteur, épaisseur), pas de coordonnées.
Arkivio doit dessiner des plans : le format libre porte donc la **géométrie**, et toutes les quantités en sont déduites.
Plans et métré viennent de la même source.

**Repères.** Mètres ; x vers l'est, y vers le nord, entrée au sud, origine au coin sud-ouest. Le `contour` suit les axes des murs extérieurs ;
côté `E<i>` = sommet i → i+1 ; un `coin` (`chanfrein` ou `arrondi`) crée un segment `C<i>`. Les ouvertures se placent sur un mur (`mur`, `pos_m`).

**Modules** (`src/projet-libre/`) :

| Fichier | Rôle |
|---|---|
| `geometrie.mjs` | aire, périmètre, point dans polygone, intersections, recouvrement, développement du contour (chanfreins, arcs) |
| `modele.mjs` | contour développé + table des murs (extérieurs et intérieurs) d'un niveau |
| `valider.mjs` | `validerProjet(projet, { regles, seuils })` → `{ ok, erreurs, avertissements }` ; chaque violation : `code`, `gravite`, `chemin`, `message`, `suggestion?` |
| `versCivilEstimator.mjs` | `versCivilEstimator(projet, 'A')` → `{ levels, params, rapport }`, directement utilisable par `metrerProjet(levels, params)` |
| `index.mjs` | point d'entrée |

```js
import { validerProjet, versCivilEstimator } from './src/projet-libre/index.mjs'
const r = validerProjet(projet)                 // r.ok, r.erreurs, r.avertissements
const { levels, params, rapport } = versCivilEstimator(projet, 'A')
```

**Boucle de correction (prévue).** Le serveur valide le projet proposé par Claude ; s'il y a des erreurs, il les renvoie à Claude
(`code`, `chemin`, `message`) pour correction, jusqu'à validité. Les **arrêtés 169, 170, 0174 (2024) et la loi 2022-30** s'ajouteront
comme fonctions dans l'option `regles` (même format de sortie). **Aucune valeur réglementaire n'est codée en dur** : les seuils actuels
(HSP 2,2 à 4,5 m, portée de poutre 6 m, etc.) sont du bon sens et se règlent via `seuils`.

**Conversion vers CivilEstimator — hypothèses à connaître** (reprises dans `rapport`) :
- ouvertures d'un même mur regroupées en surface équivalente (la surface totale est exacte) ;
- poteaux groupés par section ; poutres et voiles groupés par section, longueurs cumulées ;
- épaisseurs de murs limitées aux types de blocs de CivilEstimator (10 / 15 / 20 cm) ; autre valeur → plus proche + note ;
- fondation « mixte » non gérée par le moteur → filante + note ; profondeur de fouille = niveau de base si non précisée ;
- hauteur des murs = hauteur sous plafond, sans déduction de dalle ; poteaux ronds convertis en section carrée de même aire.

**Contrôle réalisé.** L'exemple (variantes A et B), converti puis passé dans le vrai moteur `metrerProjet` de CivilEstimator (civilestimateurB),
ne donne aucune erreur de schéma ni alerte bloquante (≈ 848 kg d'acier et ≈ 186 sacs de ciment pour la variante A).

---

## 5. Structure

```
.node-version  .puppeteerrc.cjs  .env.example  .gitignore  package.json
src/
  app.js  server.js
  config/env.js
  middleware/   cors.js  rateLimit.js
  routes/       health.js  gabarits.js  chat.js  plan.js
  services/
    catalogue.js     charge data/gabarits/*.json ; calcule variantes × standings réellement disponibles
    saisie.js        validation/nettoyage de /api/plan et de la sortie de l'assistant
    plans.js         gabarit → modèle → SVG + PDF + IFC (ancienne route)
    assistant.js     Claude → projet libre → validation et correction géométrique
    validerChat.js   validation en liste blanche de /api/chat
    pdf/             rendu.js (Chromium)  fonts.js (Inter, Space Grotesk en data-URI)        ← nouveau
  projet-libre/      géométrie, modèle, validation, cotation, IFC et conversion métré (.mjs)
  engine/plan-engine.mjs
data/
  gabarits/          F2, F3, F4 plain-pied (v0.7)
  exemples/          F3_pan_coupe.json (projet libre, variantes A et B)                      ← nouveau
  schemas/           projet-libre.schema.json                                                ← nouveau
docs/FORMAT_PROJET_LIBRE.md                                                                  ← nouveau
public/              le frontend, servi tel quel (window.ARKIVIO_API_URL = "" → même origine) ; micro ajouté
outils/
  valider_gabarits.py     contrôle des layouts (surfaces, largeurs, accès)
  essai_rendu.mjs         essai de rendu Chromium (planche A3 → essai_rendu.pdf)               ← nouveau
  generer_exemples.mjs    régénère data/exemples/F3_pan_coupe.json                             ← nouveau
test/
  logique.test.js  app.test.js        (existants)
  projet-libre.test.mjs               (11 tests)                                              ← nouveau
```

**Ajouter un gabarit** : déposer le JSON dans `data/gabarits/`, redémarrer. Il apparaît tout seul dans `/api/gabarits`, dans la
validation et dans le prompt de l'assistant.

---

## 6. Rendu Chromium (planches PDF vectorielles)

Le PDF de chaque plan envoyé par `/api/plan` est rendu depuis son SVG par Chromium (`puppeteer` 25.17.0). Le même moteur peut aussi servir aux planches de devis et de présentation.

- `src/services/pdf/rendu.js` : navigateur lancé à la première demande, réutilisé, fermé après 2 min d'inactivité ; **une planche à la fois** (file de 6 au maximum, erreur `ServeurOccupe` au-delà) ; **aucune requête sortante** (seules les data-URI passent : polices, logo, images embarquées).
  - `svgVersPdf(svg, { largeurMm, hauteurMm, fontFaceCss })` : SVG → PDF vectoriel, une page au format de la planche.
  - `genererPdfDepuisHtml(html, options)` : HTML → PDF (planche de présentation en HTML/CSS).
  - `fermerNavigateur()` : fermeture propre (arrêt du serveur, tests).
- `src/services/pdf/fonts.js` : Inter et Space Grotesk embarquées (paquets `@fontsource-variable/*`).
- `.puppeteerrc.cjs` : place Chrome dans `.cache/puppeteer`, seul dossier conservé par Render entre le build et le démarrage.

**Essai** (réussi sur Render ; à relancer après changement de dépendances ou de configuration) :
```bash
npm install && npx puppeteer browsers install chrome
npm run essai:rendu        # écrit essai_rendu.pdf, affiche durée et mémoire RSS
```
Si la mémoire dépasse environ 450 Mo sur ton instance Render, il faudra une offre plus grande avant les grandes planches (A1/A0).

> **Statut** : `npm run essai:rendu` a produit un PDF sur Render. Le premier rendu d'une requête `/api/plan` utilise aussi Chromium et peut prendre quelques secondes pendant le démarrage du navigateur.

---

## 7. Lancer en local (Git Bash)

```bash
cd arkivio-backend
npm install
npx puppeteer browsers install chrome   # seulement pour le rendu Chromium (npm run essai:rendu)
cp .env.example .env                     # renseigner ANTHROPIC_API_KEY
npm run dev                              # http://localhost:8080 (API + frontend)
npm test
```

Sans `ANTHROPIC_API_KEY`, la génération de plans fonctionne ; seul `/api/chat` répond 501.
Node ≥ 22.12 est requis (comme CivilEstimator) ; `.node-version` vaut 24.22.1.

**Tests.**
- `npm test` lance tous les tests de `test/` (`node --test`).
- `projet-libre.test.mjs` : 11 tests (développement du contour, validations, détection d'erreurs, conversion). Le **test sur le vrai moteur** est ignoré sauf si tu fournis son chemin :
  ```bash
  CIVILESTIMATOR_ENGINE=/chemin/civilestimateurB-main/src/index.js npm test
  ```
- `logique.test.js` et `app.test.js` sont les tests d'origine, **non modifiés**. Ils n'ont pas pu être relancés dans l'environnement où cette version a été préparée (pas d'`npm install`) : lance `npm test` chez toi avant de déployer.

---

## 8. Déployer sur Render

**Mise à jour d'un service existant** (le cas le plus probable) :
1. Remplacer le dossier du dépôt par celui de cette version (ou copier les fichiers nouveaux et modifiés listés au § 1). Au minimum pour le micro : **`public/index.html`**.
2. Dans Render → *Build Command* : `npm install && npx puppeteer browsers install chrome`
   (ou seulement `npm install` si tu n'utilises pas encore le rendu Chromium ; l'application démarre quand même, Chromium n'est chargé qu'à la première planche).
3. *Start Command* : `npm start` — Node ≥ 22.12 (`.node-version` est pris en compte).
4. Variables : `ANTHROPIC_API_KEY` (obligatoire pour le chat) ; `ANTHROPIC_MODEL` (recommandé : `claude-sonnet-5-5` ou `claude-opus-5-5`) ;
   `ALLOWED_ORIGINS` **seulement si** le frontend est hébergé ailleurs (ex. Vercel) — dans ce cas, mettre l'URL du backend dans `window.ARKIVIO_API_URL` de `index.html`.
5. Redéployer, puis vérifier : `GET /api/health` → `{ "ok": true }`, ouvrir le site, taper un message, tester le micro (Chrome ou Safari, en HTTPS).

*Root Directory* = `arkivio-backend` (ou la racine du dépôt si ce dossier y est seul).

**Mémoire.** Chromium demande environ 300 à 400 Mo. L'offre gratuite (512 Mo) est limite ; le rendu se fait une planche à la fois pour la ménager.

---

## 9. Points à connaître

- **Modèle** : `ANTHROPIC_MODEL` vaut `claude-sonnet-4-6` par défaut ; modifiable sans toucher au code. Le budget de sortie est au minimum de 8192 tokens pour laisser la place au JSON géométrique complet.
- **Alerte connue** : F4 variante D (standard et confort) signale « cote très courte (0,10 m) » — décalage de cloisons dans le gabarit, déjà noté dans le README du moteur. Elle remonte dans `alertes`.
- **CSP** : le frontend est un fichier unique avec scripts et styles intégrés, d'où `'unsafe-inline'`. Si tu le sépares en fichiers `.js`/`.css`, retire-le dans `src/app.js`.
- **Limites** : `/api/chat` 40 messages / 15 min / IP ; `/api/plan` 80 / 15 min / IP. Fichiers joints : PDF, JPEG, PNG, WebP (HEIC refusé avec un message clair), 16 Mo au total.
- **Texte du cartouche** : les caractères que le PDF (Helvetica / WinAnsi) ne sait pas écrire sont retirés (emoji, alphabets non latins).
- **Fichier IFC** : il porte le libellé du modèle, pas le texte saisi (une apostrophe casserait la syntaxe).
- **Pas repris de CivilEstimateur (volontairement)** : comptes Supabase, crédits, FedaPay, e-mails. Ils viendront avec le transfert vers CivilEstimator (étape « plus tard »).
- **Nom** : « Arkivio » est conservé pour l'instant (homonymes : logiciel de stockage de Rocket Software, marque de miroirs sud-africaine). Le domaine contient encore « archinova ».

---

## 10. Feuille de route

| # | Tâche | État |
|---|---|---|
| 1 | Format de projet libre aligné sur CivilEstimator | **Fait** (v1.0, § 4) |
| 2 | Service Claude qui propose le projet libre, sans limite F2/F3/F4, avec boucle de correction | **Implémenté** ; vérifier après déploiement avec des demandes variées |
| 3 | Fichier de règles : arrêtés 169, 170, 0174 (2024), loi 2022-30 ; valeurs « à confirmer » des gabarits | À faire : **il faut les PDF** |
| 4 | Plans de niveaux libres avec cotes extérieures, dimensions des pièces et ouvertures | **Implémenté en première version** ; les 9 planches techniques restent à faire |
| 5 | Ferraillage par ratios avec nomenclature (« à valider par un ingénieur ») | À faire |
| 6 | ZIP du dossier libre (plans, IFC, source, métré et descriptif) | **Implémenté** ; pas encore les 9 planches techniques |
| 7 | Transfert vers CivilEstimator (étape 1 : ZIP nommé + redirection ; étape 2 : lien temporaire) | À faire |
| 8 | Authentification, crédits, paiement, relecture juridique des conditions, planche de présentation client, rendus réalistes | Plus tard |
| — | Dictée vocale dans le chat | **Fait** (§ 3) |

**Neuf planches du devis** : fondation et implantation · vue en plan par étage · coupe · plomberie · électricité · poutraison et nervures · toiture · coffrage · ferraillage.
Codes de reconnaissance à respecter (CivilEstimator, `codification_plans_btp.pdf`) : SF/SI/S<n>/BP/TN ; P<n> (portes), F<n>/B<n> ; HSP/NF/NGF ; EF/EC/EU/EV/EP ; P<n>(LxH), N<n>, (16+4) ; V<n>, D<n>, L<n>, CV<n> et trame lettres/chiffres.
