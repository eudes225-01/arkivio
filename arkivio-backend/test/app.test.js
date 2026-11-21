// test/app.test.js
// Test d'intégration : démarre l'application sur un port éphémère et vérifie le CONTRAT avec le frontend
// (public/index.html) : formes de réponse, clé d'erreur « erreur », CORS, frontend servi. L'assistant est simulé :
// aucun appel réseau vers Anthropic. Aucune dépendance de test ajoutée : node:test + fetch global.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
process.env.ANTHROPIC_API_KEY = ''      // défini (même vide) : dotenv ne le remplace pas par la valeur d'un .env local
process.env.NODE_ENV = 'test'
const { createApp } = await import('../src/app.js')

const projetPret = { gabarit: 'F3_PLAIN_PIED', standing: 'confort', resume: 'F3 confort' }

// Requête avec un en-tête Origin arbitraire (fetch d'un navigateur l'ajoute sur les POST, même vers sa propre origine).
const requete = (base, { method = 'GET', path, origin, corps }) => new Promise((resolve, reject) => {
  const u = new URL(base + path)
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers: { ...(origin ? { origin } : {}), ...(corps ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let b = ''
    res.on('data', (c) => { b += c })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corps: b ? JSON.parse(b) : null }))
  })
  r.on('error', reject)
  if (corps) r.write(JSON.stringify(corps))
  r.end()
})

describe('API Arkivio', () => {
  let server, base
  const appels = []
  before(async () => {
    const app = createApp({ dialoguer: async (d) => { appels.push(d); return { reponse: 'Très bien.', pret: true, projet: projetPret } } })
    server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${server.address().port}`
  })
  after(() => new Promise((resolve) => server.close(resolve)))

  const post = (path, corps) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) })

  test('GET /api/health', async () => {
    const r = await fetch(`${base}/api/health`)
    assert.equal(r.status, 200)
    assert.equal((await r.json()).ok, true)
  })

  test('GET /api/gabarits : tableau non vide { id, libelle, variantes: [{ id, standings }] }', async () => {
    const cat = await (await fetch(`${base}/api/gabarits`)).json()
    assert.ok(Array.isArray(cat) && cat.length === 3)
    assert.ok(cat.every((g) => g.id && g.libelle && g.variantes.every((v) => v.id && Array.isArray(v.standings))))
  })

  test('POST /api/plan : { svg, pdf, ifc, page, alertes }', async () => {
    const r = await post('/api/plan', { gabarit: 'F3_PLAIN_PIED', standing: 'standard', variante: 'A', format: 'auto', echelle: 'auto', orientation: 'auto', projet: 'Maison Awa', date: '2026-11-21' })
    assert.equal(r.status, 200)
    const d = await r.json()
    assert.ok(d.svg.startsWith('<svg'))
    assert.equal(Buffer.from(d.pdf, 'base64').subarray(0, 5).toString(), '%PDF-')
    assert.ok(d.ifc.startsWith('ISO-10303-21;'))
    assert.ok(d.page.format && d.page.orientation && d.page.echelle)
    assert.ok(Array.isArray(d.alertes))
  })

  test('POST /api/plan : entrée invalide → 400 { erreur }', async () => {
    const r = await post('/api/plan', { gabarit: 'F3_PLAIN_PIED', standing: 'luxe' })
    assert.equal(r.status, 400)
    assert.match((await r.json()).erreur, /standing/)
  })

  test('JSON illisible → 400 { erreur } (jamais la page HTML d’Express)', async () => {
    const r = await fetch(`${base}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{pas du json' })
    assert.equal(r.status, 400)
    assert.ok((await r.json()).erreur)
  })

  test('POST /api/chat : passe la discussion validée à l’assistant et renvoie sa réponse telle quelle', async () => {
    const r = await post('/api/chat', { messages: [{ role: 'user', content: 'Une maison F3' }], fichiers: [{ nom: 'terrain.png', type: 'image/png', donnees: 'QUJD' }] })
    assert.equal(r.status, 200)
    assert.deepEqual(await r.json(), { reponse: 'Très bien.', pret: true, projet: projetPret })
    assert.equal(appels.at(-1).fichiers[0].nom, 'terrain.png')
  })

  test('POST /api/chat : corps invalide → 400 { erreur } sans appeler l’assistant', async () => {
    const avant = appels.length
    const r = await post('/api/chat', { messages: [{ role: 'assistant', content: 'x' }] })
    assert.equal(r.status, 400)
    assert.ok((await r.json()).erreur)
    assert.equal(appels.length, avant)
  })

  test('POST /api/chat avec l’assistant réel mais sans clé → 501 { erreur }', async () => {
    const app = createApp()
    const s = app.listen(0)
    await new Promise((resolve) => s.once('listening', resolve))
    try {
      const r = await fetch(`http://127.0.0.1:${s.address().port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Bonjour' }] }) })
      assert.equal(r.status, 501)
      assert.match((await r.json()).erreur, /pas configuré/)
    } finally { await new Promise((resolve) => s.close(resolve)) }
  })

  test('route /api inconnue → 404 JSON', async () => {
    const r = await fetch(`${base}/api/nexistepas`)
    assert.equal(r.status, 404)
    assert.ok((await r.json()).erreur)
  })

  test('le frontend est servi à la racine, avec une CSP compatible (polices Google, scripts intégrés)', async () => {
    const r = await fetch(`${base}/`)
    assert.equal(r.status, 200)
    assert.match(await r.text(), /Arkivio/)
    const csp = r.headers.get('content-security-policy')
    assert.match(csp, /fonts\.googleapis\.com/)
    assert.match(csp, /img-src[^;]*blob:/)
    assert.match(csp, /script-src[^;]*'unsafe-inline'/)
    assert.equal((await fetch(`${base}/logo/favicon-32.png`)).status, 200)
  })

  describe('CORS', () => {
    test('même origine (Origin = Host) : autorisée — cas du frontend servi par le backend', async () => {
      const r = await requete(base, { method: 'POST', path: '/api/plan', origin: base, corps: { gabarit: 'F2_PLAIN_PIED' } })
      assert.equal(r.status, 200)
    })
    test('origine listée : autorisée, avec l’en-tête CORS', async () => {
      const r = await requete(base, { path: '/api/gabarits', origin: 'http://localhost:5173' })
      assert.equal(r.status, 200)
      assert.equal(r.headers['access-control-allow-origin'], 'http://localhost:5173')
    })
    test('origine inconnue → 403 { erreur }', async () => {
      const r = await requete(base, { path: '/api/gabarits', origin: 'https://pirate.example' })
      assert.equal(r.status, 403)
      assert.ok(r.corps.erreur)
    })
  })
})
