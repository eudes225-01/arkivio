// Essai de rendu : node outils/essai_rendu.mjs  →  essai_rendu.pdf (A3 paysage, cartouche + texte Inter / Space Grotesk)
import { writeFileSync } from 'node:fs'
import { svgVersPdf, fermerNavigateur } from '../src/services/pdf/rendu.js'
import { fontFaceCss } from '../src/services/pdf/fonts.js'

const W = 420, H = 297
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect x="10" y="10" width="${W - 20}" height="${H - 20}" fill="none" stroke="#0c4a6e" stroke-width="0.5"/>
  <pattern id="h" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#0c4a6e" stroke-width="0.25"/></pattern>
  <rect x="40" y="120" width="200" height="12" fill="url(#h)" stroke="#0c4a6e" stroke-width="0.5"/>
  <text x="40" y="112" font-family="Space Grotesk" font-size="8" fill="#0c4a6e">COUPE A-A — essai de rendu</text>
  <text x="40" y="150" font-family="Inter" font-size="4" fill="#0f9d8f">HSP 2,80 m · NF ±0,00 · Sf(40x25ht) — accents é è ç œ ² ³ €</text>
  <rect x="${W - 130}" y="${H - 50}" width="120" height="40" fill="none" stroke="#0c4a6e" stroke-width="0.4"/>
  <text x="${W - 124}" y="${H - 36}" font-family="Space Grotesk" font-size="6" fill="#0c4a6e">Arkivio — PLAN INDICATIF</text>
</svg>`
const t0 = Date.now()
const pdf = await svgVersPdf(svg, { largeurMm: W, hauteurMm: H, fontFaceCss: fontFaceCss() })
writeFileSync('essai_rendu.pdf', pdf)
console.log(`OK : ${pdf.length} octets en ${Date.now() - t0} ms, mémoire RSS ${Math.round(process.memoryUsage().rss / 1e6)} Mo`)
await fermerNavigateur()
