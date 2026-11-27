// Rendu de plans libres : le modèle géométrique validé reste la source de toutes les cotes.
import { boite, dist, aire, aireSignee, pointDansPoly, distPointSegment, modeleNiveau, paramsEffectifs } from './index.mjs'
import { choisirMiseEnPage, FORMATS } from '../engine/plan-engine.mjs'

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fmt = (n) => Number(n.toFixed(2)).toLocaleString('fr-FR')
const cm = (n) => `${fmt(n * 100)} cm`

function centrePiece(poly) {
  let crossSum=0,cx=0,cy=0
  for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],cross=a[0]*b[1]-b[0]*a[1];crossSum+=cross;cx+=(a[0]+b[0])*cross;cy+=(a[1]+b[1])*cross}
  if(Math.abs(crossSum)>1e-8){const c=[cx/(3*crossSum),cy/(3*crossSum)];if(pointDansPoly(c,poly,0))return c}
  const b=boite(poly);let best=null,bestClear=-1
  for(let ix=0;ix<15;ix++)for(let iy=0;iy<15;iy++){const p=[b.x0+(ix+.5)*(b.x1-b.x0)/15,b.y0+(iy+.5)*(b.y1-b.y0)/15];if(!pointDansPoly(p,poly,0))continue;const clear=Math.min(...poly.map((a,i)=>distPointSegment(p,a,poly[(i+1)%poly.length])));if(clear>bestClear){best=p;bestClear=clear}}
  return best||poly[0]
}

function niveauSvg(projet, variante, niveau, options = {}) {
  const P = paramsEffectifs(projet), M = modeleNiveau(niveau, P), contour = niveau.contour.map(c => [c.x, c.y])
  const b = boite(contour), W = b.x1 - b.x0, H = b.y1 - b.y0
  const page = choisirMiseEnPage(W, H, { format: options.format || 'auto', echelle: options.echelle || 'auto', orientation: options.orientation || 'auto' })
  const [pw, ph] = FORMATS[page.f], PW = page.o === 'portrait' ? pw : ph, PH = page.o === 'portrait' ? ph : pw
  const ouvertures = niveau.ouvertures || []
  const lignesPieces = []
  let lignePieces = 'PIÈCES :'
  for (const p of niveau.pieces || []) {
    const entree = `${p.nom || p.id} ${fmt(aire(p.polygone))} m²`
    if (lignePieces.length > 8 && lignePieces.length + entree.length + 3 > 112) {
      lignesPieces.push(lignePieces)
      lignePieces = '  '
    }
    lignePieces += `${lignePieces === 'PIÈCES :' ? ' ' : lignePieces.trim() ? ' · ' : ''}${entree}`
  }
  lignesPieces.push(lignePieces)
  const lignesOuvertures = []
  for (const [type, titre] of [['porte', 'PORTES'], ['fenetre', 'BAIES']]) {
    const elements = ouvertures.filter(o => o.type === type)
    if (!elements.length) continue
    const prefix = `${titre} :`
    let ligne = prefix
    for (const o of elements) {
      const taille = `${o.id} ${fmt(o.largeur_m * 100)} × ${fmt(o.hauteur_m * 100)} cm${type === 'fenetre' && o.allege_m ? ` (allège ${fmt(o.allege_m * 100)} cm)` : ''}`
      if (ligne.length > titre.length + 2 && ligne.length + taille.length + 3 > 118) {
        lignesOuvertures.push(ligne)
        ligne = '  '
      }
      ligne += `${ligne === prefix ? ' ' : ligne.trim() ? ' · ' : ''}${taille}`
    }
    lignesOuvertures.push(ligne)
  }
  const lignesCartouche = [...lignesPieces, ...lignesOuvertures]
  const margin = 22, cartH = 24 + lignesCartouche.length * 3.2, dimPad = 48, availW = PW - 2 * margin - dimPad, availH = PH - 2 * margin - cartH - dimPad
  const scale = Math.min(availW / W, availH / H, 1000 / page.den), den = Math.round(1000 / scale), planW = W * scale, planH = H * scale
  const ox = margin + dimPad + (availW - planW) / 2, oy = margin + dimPad + (availH - planH) / 2
  const X = x => ox + (x - b.x0) * scale, Y = y => oy + (b.y1 - y) * scale
  const lines = [], texts = [], polys = [], paths = []
  const ln = (x1,y1,x2,y2,w=.25,color='#111') => lines.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`)
  const txt = (x,y,s,size=2.4,anchor='middle',rot=0,bold=false) => texts.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-family="Inter,Arial,sans-serif" font-weight="${bold?700:400}"${rot?` transform="rotate(${rot} ${x} ${y})"`:''}>${esc(s)}</text>`)
  const polygon = pts => `<polygon points="${pts.map(([x,y])=>`${X(x)},${Y(y)}`).join(' ')}" fill="white" stroke="#111" stroke-width="0.55"/>`
  const wallStroke = (a,c,t,color='#222') => ln(X(a[0]),Y(a[1]),X(c[0]),Y(c[1]),Math.max(.45,t*scale),color)

  // Pièces en teinte claire, contours aux axes ; murs et cloisons par-dessus.
  for (const p of niveau.pieces || []) {
    polys.push(`<polygon points="${p.polygone.map(([x,y])=>`${X(x)},${Y(y)}`).join(' ')}" fill="#fafafa" stroke="none"/>`)
    const pts=p.polygone, xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]), rw=Math.max(...xs)-Math.min(...xs),rh=Math.max(...ys)-Math.min(...ys)
    const [cx,cy]=centrePiece(pts)
    txt(X(cx),Y(cy)-1,p.nom||p.id,Math.max(1.8,Math.min(3.2,Math.min(rw,rh)*scale*.11)),'middle',0,true)
    txt(X(cx),Y(cy)+3,`${fmt(aire(pts))} m²`,2.1)
    // Chaque local affiche ses dimensions hors tout (boîte englobante, indiquée comme telle).
    txt(X(cx),Y(cy)+6,`${fmt(rw)} × ${fmt(rh)} m (encombrement)`,1.8)
  }
  const polyPts = M.dev.points
  polys.push(`<polygon points="${polyPts.map(([x,y])=>`${X(x)},${Y(y)}`).join(' ')}" fill="none" stroke="#111" stroke-width=".55"/>`)
  for (const s of M.dev.segments) {
    const ep=(niveau.ep_ext_cm||P.ep_ext_cm)/100
    if(s.kind==='arc'){
      const [cx,cy]=s.centre,a0=Math.atan2(s.a[1]-cy,s.a[0]-cx),a1=Math.atan2(s.b[1]-cy,s.b[0]-cx)
      let delta=a1-a0;while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI
      const pts=Array.from({length:13},(_,i)=>{const a=a0+delta*i/12;return `${X(cx+s.rayon*Math.cos(a))},${Y(cy+s.rayon*Math.sin(a))}`}).join(' ')
      polys.push(`<polyline points="${pts}" fill="none" stroke="#222" stroke-width="${Math.max(.45,ep*scale)}"/>`)
    } else wallStroke(s.a,s.b,ep)
  }
  for (const m of niveau.murs_int||[]) wallStroke(m.a,m.b,(m.ep_cm||P.ep_cloison_cm)/100)

  // Ouvertures : on retire toute l'épaisseur du mur, puis on dessine les cadres.
  const sensContour = aireSignee(contour) >= 0 ? 1 : -1
  for (const o of ouvertures) {
    const mur=M.murs.get(o.mur); if(!mur||mur.kind==='arc') continue
    const L=mur.longueur, t=o.largeur_m/L, p=o.pos_m/L, q=Math.min(1,p+t), a=[mur.a[0]+(mur.b[0]-mur.a[0])*p,mur.a[1]+(mur.b[1]-mur.a[1])*p], c=[mur.a[0]+(mur.b[0]-mur.a[0])*q,mur.a[1]+(mur.b[1]-mur.a[1])*q]
    const ux=(mur.b[0]-mur.a[0])/L,uy=(mur.b[1]-mur.a[1])/L
    const epMur=(mur.ep_cm||((mur.exterieur?P.ep_ext_cm:P.ep_cloison_cm)))/100
    const eraseWidth=epMur*scale+.55
    lines.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(c[0])}" y2="${Y(c[1])}" stroke="white" stroke-width="${eraseWidth}" stroke-linecap="square"/>`)
    const nx=-uy,ny=ux,coteEtiquette=mur.exterieur?sensContour:1
    if(o.type==='fenetre'){
      const demi=epMur/2
      for(const s of [-1,1])ln(X(a[0]+nx*demi*s),Y(a[1]+ny*demi*s),X(c[0]+nx*demi*s),Y(c[1]+ny*demi*s),.28,'#175a73')
      for(const e of [a,c])ln(X(e[0]-nx*demi),Y(e[1]-ny*demi),X(e[0]+nx*demi),Y(e[1]+ny*demi),.25,'#175a73')
    } else {
      const px=X(a[0]),py=Y(a[1]),ex=X(a[0]+nx*o.largeur_m*coteEtiquette),ey=Y(a[1]+ny*o.largeur_m*coteEtiquette),cx=X(c[0]),cy=Y(c[1]),rad=o.largeur_m*scale
      ln(px,py,ex,ey,.28,'#175a73')
      const cross=(ex-px)*(cy-py)-(ey-py)*(cx-px),sweep=cross>=0?1:0
      paths.push(`<path d="M ${ex} ${ey} A ${rad} ${rad} 0 0 ${sweep} ${cx} ${cy}" fill="none" stroke="#175a73" stroke-width=".22"/>`)
    }
    const mx=(a[0]+c[0])/2,my=(a[1]+c[1])/2
    const decal=epMur/2+.18,tx=X(mx+nx*coteEtiquette*decal),ty=Y(my+ny*coteEtiquette*decal)
    texts.push(`<text x="${tx}" y="${ty}" text-anchor="middle" font-size="1.9" font-family="Inter,Arial,sans-serif" font-weight="700" fill="#12485b" paint-order="stroke" stroke="white" stroke-width="1.2" stroke-linejoin="round">${esc(o.id)}</text>`)
  }

  // Cotes exhaustives du contour, cotes intérieures des pièces et cotes des ouvertures.
  const offset=6, tick=(x,y)=>ln(x-1,y+1,x+1,y-1,.22), sens=sensContour
  for(const side of M.dev.segments){
    const a=side.a,c=side.b,dx=c[0]-a[0],dy=c[1]-a[1],L=side.longueur||dist(a,c)
    const nx=sens*dy/L,ny=-sens*dx/L
    const ax=X(a[0])+nx*offset,ay=Y(a[1])-ny*offset,cx=X(c[0])+nx*offset,cy=Y(c[1])-ny*offset
    ln(X(a[0]),Y(a[1]),ax,ay,.12,'#555');ln(X(c[0]),Y(c[1]),cx,cy,.12,'#555');ln(ax,ay,cx,cy,.18,'#333');tick(ax,ay);tick(cx,cy)
    const angle=Math.atan2(cy-ay,cx-ax)*180/Math.PI
    txt((ax+cx)/2,(ay+cy)/2-1.2,`${side.id} ${cm(L)}`,2,'middle',Math.abs(angle)>90?angle+180:angle,true)
  }
  for(const m of niveau.murs_int||[]){const L=dist(m.a,m.b),mx=(m.a[0]+m.b[0])/2,my=(m.a[1]+m.b[1])/2;txt(X(mx),Y(my)-1.5,`${m.id} ${cm(L)}`,1.8,'middle',0,true)}
  // Les dimensions intérieures sont explicitement marquées « hors tout » : aucune cote n'est implicite.
  for(const p of niveau.pieces||[]){const xs=p.polygone.map(v=>v[0]),ys=p.polygone.map(v=>v[1]),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys)
    txt(X((x0+x1)/2),Y(y0)-1.5,`L ${cm(x1-x0)} (hors tout)`,1.65)
    txt(X(x0)-1.5,Y((y0+y1)/2),`l ${cm(y1-y0)}` ,1.65,'middle',-90)
  }
  // Deux cotes générales encadrent aussi la chaîne des côtés, y compris pour un contour irrégulier.
  ln(ox,oy-13,ox+planW,oy-13,.22);ln(ox,oy-15,ox,oy-11,.22);ln(ox+planW,oy-15,ox+planW,oy-11,.22);txt(ox+planW/2,oy-14,`Hors tout ${cm(W)}`,2.3,'middle',0,true)
  ln(ox-13,oy,ox-13,oy+planH,.22);ln(ox-15,oy,ox-11,oy,.22);ln(ox-15,oy+planH,ox-11,oy+planH,.22);txt(ox-14,oy+planH/2,`Hors tout ${cm(H)}`,2.3,'middle',-90,true)
  const title=options.titre||`PLAN ${niveau.nom||niveau.id} COTÉ`, project=options.projet||projet.projet?.titre||'Maison sur mesure'
  const date=options.date||new Date().toISOString().slice(0,10),phase=options.phase||'Avant-projet indicatif',planche=options.planche||`${variante.id}-${niveau.id}`
  const moa=options.maitre_ouvrage||options.moa||'—',moe=options.maitre_oeuvre||options.moe||'—'
  const cartY=PH-margin-cartH
  const lignesCartoucheSvg=lignesCartouche.map((ligne,i)=>`<text x="${margin+4}" y="${cartY+21+i*3.2}" font-family="Inter,Arial,sans-serif" font-size="1.9">${esc(ligne)}</text>`).join('')
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PW}mm" height="${PH}mm" viewBox="0 0 ${PW} ${PH}"><rect width="${PW}" height="${PH}" fill="white"/><rect x="${margin}" y="${margin}" width="${PW-2*margin}" height="${PH-2*margin}" fill="none" stroke="#222" stroke-width=".5"/><text x="${margin+4}" y="${margin+7}" font-family="Inter,Arial,sans-serif" font-size="4" font-weight="700">${esc(title)}</text><text x="${PW-margin-4}" y="${margin+7}" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="2.5">${esc(project)} · Variante ${esc(variante.id)} · Échelle 1/${den}</text>${polys.join('')}${lines.join('')}${paths.join('')}<rect x="${margin}" y="${cartY}" width="${PW-2*margin}" height="${cartH}" fill="white" stroke="#222" stroke-width=".45"/><text x="${margin+4}" y="${cartY+6}" font-family="Inter,Arial,sans-serif" font-size="3" font-weight="700">${esc(project)} — ${esc(variante.libelle||variante.id)} — ${esc(niveau.nom||niveau.id)}</text><text x="${margin+4}" y="${cartY+11}" font-family="Inter,Arial,sans-serif" font-size="2">Emprise ${fmt(M.aire)} m² · Murs ext. ${P.ep_ext_cm} cm · Cloisons ${P.ep_cloison_cm} cm · HSP ${niveau.hsp_m||P.hsp_m} m · Cotes en cm</text><text x="${margin+4}" y="${cartY+16}" font-family="Inter,Arial,sans-serif" font-size="1.8">Phase ${esc(phase)} · Planche ${esc(planche)} · ${esc(date)} · MOA ${esc(String(moa).slice(0,40))} · MOE ${esc(String(moe).slice(0,40))}</text>${lignesCartoucheSvg}<text x="${PW-margin-4}" y="${cartY+cartH-1.5}" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="1.6">Plan indicatif — validation professionnelle requise</text>${texts.join('')}</svg>`
  return { svg, page:{format:page.f,orientation:page.o,echelle:den,PW,PH,tient:true}, surface_m2:M.aire, nom:niveau.nom||niveau.id, variante:variante.id }
}

export function genererPlanchesLibres(projet, options={}) {
  return projet.variantes.flatMap(v=>v.niveaux.map(n=>niveauSvg(projet,v,n,options)))
}
