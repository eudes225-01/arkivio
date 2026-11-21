#!/usr/bin/env python3
"""Valide les layouts des gabarits : python3 valider_gabarits.py gabarit_*.json
Par variante et par standing (surcharges_standing prises en compte) :
surfaces vs cibles (0,85 à 1,5), largeurs minimales, couloir >= 1,0 m, recouvrement,
murs communs suffisants pour les portes, ouvertures sur murs extérieurs."""
import json, sys

def shared(a, b, W, H, e=1e-6):
    if abs(a["x1"]-b["x0"])<e or abs(b["x1"]-a["x0"])<e:
        lo=max(a["y0"],b["y0"]); hi=min(a["y1"],b["y1"])
        if hi-lo>e: return (hi-lo)*H
    if abs(a["y1"]-b["y0"])<e or abs(b["y1"]-a["y0"])<e:
        lo=max(a["x0"],b["x0"]); hi=min(a["x1"],b["x1"])
        if hi-lo>e: return (hi-lo)*W
    return None

def ext(r, e=1e-6):
    return [s for s,c in (("S",r["y0"]<e),("N",r["y1"]>1-e),("W",r["x0"]<e),("E",r["x1"]>1-e)) if c]

def check_layout(d):
    L=d["layout"]; res={}
    if "variantes" not in L: return res
    pcs={p["id"]:p for p in d["pieces"]}
    for vid,v in L["variantes"].items():
        for st in ("economique","standard","confort"):
            sur=v.get("surcharges_standing",{}).get(st,{})
            emp=sur.get("emprise_m") or v.get("emprise_m",L["emprise_m"]).get(st)
            if not emp: continue
            W,H=emp; pieces=sur.get("pieces",v["pieces"]); ouv=sur.get("ouvertures",v["ouvertures"])
            R={r["id"]:r for r in pieces}; out=[]
            tot=sum((r["x1"]-r["x0"])*(r["y1"]-r["y0"]) for r in pieces)
            if abs(tot-1)>0.002: out.append(f"pièces ne couvrent pas l'emprise ({tot:.3f})")
            for i,r in R.items():
                w=(r["x1"]-r["x0"])*W; h=(r["y1"]-r["y0"])*H; p=pcs.get(i)
                if p:
                    t=p["surface_m2"][st]
                    if t and not 0.85<=w*h/t<=1.5: out.append(f"{i} {w*h:.1f} m² vs cible {t}")
                    mn=p.get("largeur_min_m")
                    if mn and min(w,h)<mn-0.051: out.append(f"{i} largeur {min(w,h):.2f} m < min {mn}")
                if i=="couloir" and min(w,h)<1.0-1e-6: out.append(f"couloir {min(w,h):.2f} m < 1,0")
            for o in ouv:
                if "entre" in o:
                    a,b=o["entre"]; s=shared(R[a],R[b],W,H)
                    if s is None or s<o["w"]+0.35-1e-6: out.append(f"accès {a}-{b}: mur commun {0 if s is None else round(s,2)} m pour porte {o['w']}")
                elif o["mur"] not in ext(R[o["piece"]]): out.append(f"{o['piece']}: ouverture sur mur non extérieur {o['mur']}")
            res[(vid,st)]=out
    return res

if __name__=="__main__":
    for p in sys.argv[1:]:
        r=check_layout(json.load(open(p))); n=sum(len(x) for x in r.values())
        print(p.split("/")[-1], "OK" if not n else f"{n} alerte(s)")
        for (v,st),al in r.items():
            for x in al: print(f"  - {v}/{st}: {x}")
