// IFC4 simplifié construit depuis le même projet libre que les planches et le métré.
import { modeleNiveau, paramsEffectifs } from './modele.mjs'
import { dist, boite } from './geometrie.mjs'

export function projetLibreVersIfc(projet, varianteId) {
  const variante=projet.variantes.find(v=>v.id===varianteId)
  if(!variante) throw new Error(`Variante IFC inconnue: ${varianteId}`)
  const entities=[];let seq=0
  const add=s=>{entities.push(`#${++seq}=${s};`);return `#${seq}`}
  const guid=()=>{const chars='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';let s='';for(let i=0;i<22;i++)s+=chars[Math.floor(Math.random()*64)];return `'${s}'`}
  const q=s=>`'${String(s??'').replace(/'/g,"''").replace(/[^\x20-\x7e]/g,c=>`\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0')}\\X0\\`)}'`
  const n=v=>Number((Math.abs(v)<1e-9?0:v).toFixed(5)).toString()
  const point=(x,y,z)=>add(`IFCCARTESIANPOINT((${n(x)},${n(y)},${n(z)}))`)
  const direction=(x,y,z)=>add(`IFCDIRECTION((${n(x)},${n(y)},${n(z)}))`)
  const axis=(p,z='$',x='$')=>add(`IFCAXIS2PLACEMENT3D(${p},${z},${x})`)
  const origin=point(0,0,0),DZ=direction(0,0,1),DX=direction(1,0,0)
  const world=axis(origin,DZ,DX)
  const context=add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`)
  const body=add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`)
  const units=add(`IFCUNITASSIGNMENT((${add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')},${add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)')},${add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)')},${add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')}))`)
  const root=projet.projet?.titre||'Arkivio - maison sur mesure'
  const project=add(`IFCPROJECT(${guid()},$ ,${q(root)},$,$,$,$,(${context}),${units})`)
  const local=(parent,x,y,z,dx=1,dy=0)=>{
    const p=point(x,y,z),ref=direction(dx,dy,0),pl=axis(p,DZ,ref)
    return add(`IFCLOCALPLACEMENT(${parent},${pl})`)
  }
  const shape=(profile,height)=>{
    const origin3=point(0,0,0),pl3=axis(origin3,DZ,DX),vec=direction(0,0,1)
    const ext=add(`IFCEXTRUDEDAREASOLID(${profile},${pl3},${vec},${n(height)})`)
    const rep=add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${ext}))`)
    return add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`)
  }
  const polygonProfile=pts=>{
    const ids=pts.map(p=>point(p[0],p[1],0));ids.push(ids[0])
    const line=add(`IFCPOLYLINE((${ids.join(',')}))`)
    return add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${line})`)
  }
  const aggregates=(parent,children)=>{if(children.length)add(`IFCRELAGGREGATES(${guid()},$,$,$,${parent},(${children.join(',')}))`)}
  const sitePl=local('$',0,0,0),site=add(`IFCSITE(${guid()},$,'Site',$,$,${sitePl},$,$,.ELEMENT.,$,$,$,$,$)`)
  const bldPl=local(sitePl,0,0,0),building=add(`IFCBUILDING(${guid()},$,${q(root)},$,$,${bldPl},$,$,.ELEMENT.,$,$,$)`)
  aggregates(project,[site]);aggregates(site,[building])
  const P=paramsEffectifs(projet)
  for(const [li,niveau] of variante.niveaux.entries()){
    const M=modeleNiveau(niveau,P),levelPl=local(bldPl,0,0,niveau.cote_m||0)
    const storey=add(`IFCBUILDINGSTOREY(${guid()},$,${q(niveau.nom||niveau.id)},$,$,${levelPl},$,$,.ELEMENT.,${n(niveau.cote_m||0)})`)
    aggregates(building,[storey])
    const products=[]
    const sources=[...M.dev.segments.map(s=>({...s,ep_cm:niveau.ep_ext_cm||P.ep_ext_cm})),...(niveau.murs_int||[]).map(w=>({...w,kind:'droit',ep_cm:w.ep_cm||P.ep_cloison_cm,longueur:dist(w.a,w.b)}))]
    for(const w of sources){
      let pieces=[]
      if(w.kind==='arc'){
        const [cx,cy]=w.centre,a0=Math.atan2(w.a[1]-cy,w.a[0]-cx),a1=Math.atan2(w.b[1]-cy,w.b[0]-cx);let da=a1-a0;while(da>Math.PI)da-=Math.PI*2;while(da< -Math.PI)da+=Math.PI*2
        const steps=12
        for(let j=0;j<steps;j++){const u=a0+da*j/steps,v=a0+da*(j+1)/steps;pieces.push({a:[cx+w.rayon*Math.cos(u),cy+w.rayon*Math.sin(u)],b:[cx+w.rayon*Math.cos(v),cy+w.rayon*Math.sin(v)],id:`${w.id}.${j+1}`})}
      } else pieces=[{a:w.a,b:w.b,id:w.id}]
      for(const seg of pieces){
        const dx=seg.b[0]-seg.a[0],dy=seg.b[1]-seg.a[1],L=Math.hypot(dx,dy),ux=dx/L,uy=dy/L,th=w.ep_cm/100
        const ops=(niveau.ouvertures||[]).filter(o=>o.mur===w.id)
        const breaks=[0,L,...ops.flatMap(o=>[Math.max(0,o.pos_m),Math.min(L,o.pos_m+o.largeur_m)])].sort((a,b)=>a-b).filter((x,i,a)=>!i||Math.abs(x-a[i-1])>1e-5)
        const blocks=[]
        for(let k=0;k<breaks.length-1;k++){
          const a=breaks[k],b=breaks[k+1];if(b-a<.01)continue
          const op=ops.find(o=>a>=o.pos_m-1e-5&&b<=o.pos_m+o.largeur_m+1e-5)
          const intervals=op?[[0,op.allege_m||0],[(op.allege_m||0)+op.hauteur_m,M.hsp]]:[[0,M.hsp]]
          for(const [z0,z1] of intervals){if(z1-z0<.01)continue
            const half=th/2,profile=polygonProfile([[-(b-a)/2,-half],[(b-a)/2,-half],[(b-a)/2,half],[-(b-a)/2,half]])
            const mid=(a+b)/2,x=seg.a[0]+ux*mid,y=seg.a[1]+uy*mid,pl=local(levelPl,x,y,z0,ux,uy),sh=shape(profile,z1-z0)
            const wall=add(`IFCWALL(${guid()},$ ,${q(`Mur ${seg.id}`)},$,$,${pl},${sh},$,.STANDARD.)`);products.push(wall)
          }
        }
      }
    }
    // Plancher et locaux en volumes IFC (polygones réels, y compris les pièces irrégulières).
    const bounds=boite(niveau.contour.map(c=>[c.x,c.y]))
    const floorProfile=polygonProfile([[0,0],[bounds.x1-bounds.x0,0],[bounds.x1-bounds.x0,bounds.y1-bounds.y0],[0,bounds.y1-bounds.y0]])
    const floorPl=local(levelPl,bounds.x0,bounds.y0,-.1),floorShape=shape(floorProfile,.1)
    products.push(add(`IFCSLAB(${guid()},$,'Dallage',$,$,${floorPl},${floorShape},$,.BASESLAB.)`))
    for(const p of niveau.pieces||[]){
      const pts=p.polygone.map(([x,y])=>[x-bounds.x0,y-bounds.y0]),profile=polygonProfile(pts)
      const pl=local(levelPl,bounds.x0,bounds.y0,0),sh=shape(profile,M.hsp)
      products.push(add(`IFCSPACE(${guid()},$,${q(p.nom||p.id)},$,$,${pl},${sh},${q(p.nom||p.id)},.ELEMENT.,.INTERNAL.,$)`))
    }
    // Portes et fenêtres restent des objets repérés dans l'IFC; leurs emplacements sont découpés dans les murs ci-dessus.
    for(const o of niveau.ouvertures||[]){
      const w=M.murs.get(o.mur);if(!w||w.kind==='arc')continue
      const L=w.longueur,ux=(w.b[0]-w.a[0])/L,uy=(w.b[1]-w.a[1])/L,mid=o.pos_m+o.largeur_m/2
      const x=w.a[0]+ux*mid,y=w.a[1]+uy*mid,z=o.allege_m||0,th=(w.ep_cm||P.ep_cloison_cm)/100
      const profile=polygonProfile([[-o.largeur_m/2,-th/2],[o.largeur_m/2,-th/2],[o.largeur_m/2,th/2],[-o.largeur_m/2,th/2]])
      const pl=local(levelPl,x,y,z,ux,uy),sh=shape(profile,o.hauteur_m)
      const name=q(`${o.type==='porte'?'Porte':'Fenêtre'} ${o.id}`)
      const opening=o.type==='porte'
        ? `IFCDOOR(${guid()},$,${name},$,$,${pl},${sh},$,${n(o.hauteur_m)},${n(o.largeur_m)},.DOOR.,.NOTDEFINED.,$)`
        : `IFCWINDOW(${guid()},$,${name},$,$,${pl},${sh},$,${n(o.hauteur_m)},${n(o.largeur_m)},.WINDOW.,.NOTDEFINED.,$)`
      products.push(add(opening))
    }
    if(products.length)add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,(${products.join(',')}),${storey})`)
  }
  return `ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');\nFILE_NAME('arkivio-projet-libre.ifc','${new Date().toISOString().slice(0,19)}',('Arkivio'),('Arkivio'),'Arkivio','Arkivio','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n${entities.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`
}
