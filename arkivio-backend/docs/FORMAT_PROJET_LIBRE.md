# Arkivio — format de projet libre v1.0

**Principe.** Claude propose la géométrie (coordonnées) ; le serveur en déduit toutes les quantités. CivilEstimator, lui, raisonne en quantités (nb, L, H, ep…) sans coordonnées : `versCivilEstimator()` fait la traduction, donc plans et métré viennent de la même source.

## Repères
- Mètres ; x vers l'est, y vers le nord, entrée au sud, origine au coin sud-ouest.
- `contour` : sommets aux **axes** des murs extérieurs. Côté `E<i>` = sommet i → i+1. Un `coin` (`chanfrein` + `taille_m`, ou `arrondi` + `rayon_m`) crée un segment `C<i>`. Les ids suivent l'ordre saisi.
- `murs_int` : segments `a`→`b` (ids libres sauf `E<n>`/`C<n>`), `porteur` vrai ou faux.
- `ouvertures` : `mur` (id d'un côté ou d'un mur intérieur), `pos_m` mesuré depuis le point `a` du mur. Repères `P<n>` (portes), `F<n>`/`B<n>` (baies).
- `poteaux` : repère `P<n>` identique à tous les niveaux, même position et même section ; semelle de même numéro (S<n>).
- `variantes` : 1 ou 2 (`A`, `B`), chacune avec ses niveaux, sa fondation, sa toiture.

## Ce que le serveur calcule (jamais saisi)
Longueurs de murs (arcs compris), aire et périmètre par niveau, surfaces de pièces, linéaire de fondation, surfaces de pans.

## Validation (boucle de correction)
`validerProjet(projet, { regles })` renvoie `{ ok, erreurs, avertissements }`. Chaque violation : `code`, `gravite`, `chemin`, `message`, `suggestion?`. Claude relit les erreurs et corrige le projet. Les arrêtés se branchent comme fonctions `regles` (même format de sortie) ; aucune valeur réglementaire n'est codée en dur pour l'instant.

Contrôles actuels : contour (fermé, sans croisement, coins valides), emprise vs terrain et retraits, pièces dans le contour et sans chevauchement, ouvertures (mur, bornes, hauteur, chevauchements, pas sur arc), poteaux/poutres/voiles, cohérence des poteaux entre niveaux, appuis, fondation, toiture. Seuils de bon sens (HSP 2,2–4,5 m, portée de poutre 6 m) réglables, **ce ne sont pas des valeurs d'arrêté**.

## Passage vers CivilEstimator
`versCivilEstimator(projet, 'A')` → `{ levels, params, rapport }`, directement utilisable par `metrerProjet(levels, params)`.
- Ouvertures d'un même mur : nombre, hauteur moyenne et largeur équivalente (surface exacte).
- Poteaux groupés par section ; poutres et voiles groupés par section avec longueurs cumulées.
- Épaisseurs de murs : types de blocs 10/15/20 uniquement (autre valeur → plus proche + note).
- Fondation « mixte » non gérée par le moteur → filante + note. Profondeur de fouille = niveau de base si non précisée (note).
- Hauteur de mur = HSP, sans déduction de dalle.

## Fichiers
`src/projet-libre/` (géométrie, modèle, validateur, convertisseur), `projet-libre.schema.json` (entrée de l'outil Claude), `exemples/F3_pan_coupe.json` (variantes A pan coupé et B rectangle), `test/` (11 tests ; `CIVILESTIMATOR_ENGINE=…/src/index.js` active le test sur le vrai moteur).
