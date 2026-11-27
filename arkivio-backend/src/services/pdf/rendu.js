// src/services/pdf/rendu.js (Arkivio)
// HTML/SVG → PDF avec Chromium (Puppeteer). Repris du service CivilEstimator : navigateur lancé à la
// première demande, réutilisé, fermé après inactivité ; file d'attente ; aucune requête sortante
// (seules les data-URI passent : polices, logo, images embarquées).
const IDLE_MS = 2 * 60 * 1000
const MAX_PARALLELE = 1   // planches lourdes : une à la fois (instance Render à mémoire limitée)
const MAX_ATTENTE = 6

let navigateur = null, lancement = null, minuteur = null, actifs = 0
const attente = []

export class ServeurOccupe extends Error {}

async function obtenirNavigateur() {
  if (navigateur?.connected) return navigateur
  if (!lancement) {
    lancement = import('puppeteer').then(({ default: puppeteer }) => puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
    })).then((b) => {
      navigateur = b
      b.on('disconnected', () => { if (navigateur === b) navigateur = null })
      return b
    }).finally(() => { lancement = null })
  }
  return lancement
}

function armerInactivite() {
  clearTimeout(minuteur)
  minuteur = setTimeout(async () => {
    if (actifs > 0) return armerInactivite()
    const b = navigateur; navigateur = null
    await b?.close().catch(() => {})
  }, IDLE_MS)
  minuteur.unref?.()
}

async function avecPlace(fn) {
  if (actifs >= MAX_PARALLELE) {
    if (attente.length >= MAX_ATTENTE) throw new ServeurOccupe('file_pleine')
    await new Promise((ok) => attente.push(ok))
  } else actifs++
  try { return await fn() } finally {
    const suivant = attente.shift()
    if (suivant) suivant()
    else actifs--
  }
}

async function htmlVersPdf(browser, html, options) {
  const page = await browser.newPage()
  try {
    page.setDefaultTimeout(60_000)
    await page.setRequestInterception(true)
    page.on('request', (req) => (/^(data|about):/i.test(req.url()) ? req.continue() : req.abort()))
    await page.emulateMediaType('print')
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    return await page.pdf({ printBackground: true, ...options })
  } finally {
    await page.close().catch(() => {})
  }
}

/** HTML → PDF. Pour une planche : { width:'420mm', height:'297mm' } ou { format:'A3', landscape:true }, preferCSSPageSize possible. */
export async function genererPdfDepuisHtml(html, options = {}) {
  return avecPlace(async () => {
    clearTimeout(minuteur)
    try {
      const browser = await obtenirNavigateur()
      return Buffer.from(await htmlVersPdf(browser, html, options))
    } finally { armerInactivite() }
  })
}

/** SVG (chaîne) → PDF vectoriel, une page au format de la planche. Polices Inter / Space Grotesk embarquées. */
export async function svgVersPdf(svg, { largeurMm, hauteurMm, fontFaceCss = '' }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fontFaceCss}
    svg text{font-family:Inter,Arial,sans-serif!important}
    @page{size:${largeurMm}mm ${hauteurMm}mm;margin:0}
    html,body{margin:0;padding:0}
    svg{display:block;width:${largeurMm}mm;height:${hauteurMm}mm}
  </style></head><body>${svg}</body></html>`
  return genererPdfDepuisHtml(html, { preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } })
}

export async function fermerNavigateur() {
  clearTimeout(minuteur)
  const b = navigateur; navigateur = null
  await b?.close().catch(() => {})
}
