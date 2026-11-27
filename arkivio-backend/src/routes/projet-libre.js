import { Router } from 'express'
import { planLimiter } from '../middleware/rateLimit.js'
import { validerProjet } from '../projet-libre/valider.mjs'
import { genererPlanchesLibres } from '../projet-libre/rendu.mjs'
import { versCivilEstimator } from '../projet-libre/versCivilEstimator.mjs'
import { projetLibreVersIfc } from '../projet-libre/ifc.mjs'
import { aire, boite } from '../projet-libre/geometrie.mjs'
import { svgVersPdf } from '../services/pdf/rendu.js'
import { fontFaceCss } from '../services/pdf/fonts.js'
import { creerZip } from '../services/zip.js'
import { presenterErreursProjet } from '../projet-libre/erreurs-client.mjs'

export const projetLibreRouter = Router()

projetLibreRouter.post('/projet-libre/plans', planLimiter, async (req, res) => {
  const projet = req.body?.projet
  let controle
  try { controle = validerProjet(projet) } catch { const probleme=presenterErreursProjet([{code:'FORMAT'}]);return res.status(400).json({erreur:probleme.introduction,probleme}) }
  if (!controle.ok) {const probleme=presenterErreursProjet(controle.erreurs);return res.status(422).json({erreur:probleme.introduction,probleme})}
  if (projet.variantes.reduce((n,v)=>n+v.niveaux.length,0)>12) return res.status(400).json({ erreur: 'La génération est limitée à 12 planches par dossier.' })
  try {
    const options = req.body?.options || {}
    const planches = genererPlanchesLibres(projet, options)
    const sorties = []
    for (const plan of planches) {
      const pdf = await svgVersPdf(plan.svg, { largeurMm: plan.page.PW, hauteurMm: plan.page.PH, fontFaceCss: fontFaceCss() })
      sorties.push({ ...plan, pdf: pdf.toString('base64') })
    }
    const metrage = projet.variantes.map(v => versCivilEstimator(projet, v.id))
    const ifc = projet.variantes.map(v => ({ variante: v.id, donnees: Buffer.from(projetLibreVersIfc(projet, v.id)).toString('base64') }))
    const metrageJson=JSON.stringify(metrage,null,2),projetJson=JSON.stringify(projet,null,2),fichiers=[]
    for(const s of sorties){const base=`Plans/Variante_${s.variante}/${String(s.nom).replace(/[^\p{L}\p{N}_-]+/gu,'_')}`;fichiers.push({nom:`${base}.pdf`,donnees:Buffer.from(s.pdf,'base64')},{nom:`${base}.svg`,donnees:s.svg})}
    for(const v of ifc)fichiers.push({nom:`BIM/arkivio_variante_${v.variante}.ifc`,donnees:Buffer.from(v.donnees,'base64')})
    const descriptif=[`# ${projet.projet?.titre||'Maison sur mesure'}`,'','Plans de conception générés à partir du projet géométrique Arkivio. Cotes exprimées en centimètres sur les planches.','',...(projet.projet?.hypotheses||[]).map(h=>`- Hypothèse : ${h}`),'']
    for(const v of projet.variantes){descriptif.push(`## Variante ${v.id} — ${v.libelle||''}`,'');for(const nv of v.niveaux){const bb=boite(nv.contour.map(c=>[c.x,c.y]));descriptif.push(`### ${nv.nom||nv.id} · cote ${nv.cote_m} m`,'',`- Encombrement : ${(bb.x1-bb.x0).toFixed(2)} × ${(bb.y1-bb.y0).toFixed(2)} m`,`- Emprise : ${aire(nv.contour.map(c=>[c.x,c.y])).toFixed(2)} m²`,`- Hauteur sous plafond : ${nv.hsp_m||projet.parametres?.hsp_m||2.8} m`,'- Pièces :');for(const p of nv.pieces||[]){const xs=p.polygone.map(q=>q[0]),ys=p.polygone.map(q=>q[1]);descriptif.push(`  - ${p.nom||p.id} : ${aire(p.polygone).toFixed(2)} m² ; encombrement ${(Math.max(...xs)-Math.min(...xs)).toFixed(2)} × ${(Math.max(...ys)-Math.min(...ys)).toFixed(2)} m`)}for(const o of nv.ouvertures||[])descriptif.push(`- ${o.id} (${o.type}) sur ${o.mur} : ${o.largeur_m} × ${o.hauteur_m} m`);descriptif.push('')}}
    descriptif.push('## Limites','',"Avant-projet indicatif : les règles réglementaires locales (dont l'arrêté 169) ne sont pas encore branchées à la validation du projet libre. L'IFC contient les niveaux, murs, dalles, pièces et ouvertures géométriques ; la charpente, la toiture détaillée et le ferraillage ne sont pas calculés.")
    const avertissements=[...controle.avertissements,{message:"La conformité réglementaire locale, dont l'arrêté 169, n'est pas vérifiée dans cette génération libre."},{message:'Le fichier IFC décrit les volumes des niveaux et les ouvertures, sans étude de charpente ni de ferraillage.'}]
    fichiers.push({nom:'Donnees/projet.json',donnees:projetJson},{nom:'Donnees/metrage_civilestimator.json',donnees:metrageJson},{nom:'descriptif.md',donnees:descriptif.join('\n')})
    const dossierZip=creerZip(fichiers).toString('base64')
    res.json({ sorties, ifc, projet: projetJson, metrage, dossierZip, descriptif:descriptif.join('\n'), avertissements })
  } catch (e) {
    console.error('[projet-libre]', e)
    res.status(500).json({ erreur: 'Impossible de générer les planches de ce projet libre.' })
  }
})
