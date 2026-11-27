// Traduit les violations internes du validateur en explications compréhensibles pour l'utilisateur.
export function presenterErreursProjet(erreurs = [], { correctionEchouee = false } = {}) {
  const categories = new Set()
  for (const e of erreurs) {
    const code = String(e?.code || '').toUpperCase()
    if (/^(FORMAT|VERSION|VARIANTE|NIVEAUX_|SORTIE_INCOMPLETE)/.test(code)) categories.add('La description générale du projet est incomplète.')
    else if (/^(CONTOUR|MUR_|PIECE|PIECES_)/.test(code)) categories.add('Le tracé de la maison ou la disposition de certaines pièces doit être repris.')
    else if (/^OUVERTURE/.test(code)) categories.add('La position ou les dimensions de certaines portes ou fenêtres sont à revoir.')
    else if (/^(COTE_|ESCALIER_)/.test(code)) categories.add('La cohérence entre les niveaux doit être vérifiée.')
    else if (/^(FONDATION|SEMELLE)/.test(code)) categories.add('Les informations sur les fondations sont à compléter.')
    else if (/^TOITURE/.test(code)) categories.add('La description de la toiture doit être complétée.')
    else if (/^(POTEAU|POUTRE|VOILE|TREMIE)/.test(code)) categories.add('Certains éléments de structure doivent être revus.')
    else categories.add('Une incohérence dans la géométrie empêche de finaliser le plan.')
  }
  if (!categories.size) categories.add('La description du plan doit être complétée avant de pouvoir le dessiner.')
  const introduction = correctionEchouee
    ? 'J’ai essayé de corriger automatiquement le plan, mais il reste des points à reprendre.'
    : 'La vérification a repéré des points à reprendre avant de dessiner le plan.'
  const action = 'Vous pouvez demander une nouvelle proposition ou préciser les dimensions du terrain, les pièces souhaitées et le nombre de niveaux.'
  return { titre: 'Le plan n’a pas pu être finalisé', introduction, points: [...categories], action }
}

export function texteErreurProjet(probleme) {
  return [probleme.titre, probleme.introduction, ...probleme.points.map(p => `• ${p}`), probleme.action].join('\n')
}
