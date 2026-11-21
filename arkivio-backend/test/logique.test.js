// test/logique.test.js
// Tests de la logique métier SANS Express ni réseau : catalogue, validation, génération de plans,
// validation du chat et relais Anthropic (fetch simulé). Aucune dépendance de test : node:test suffit.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
process.env.ANTHROPIC_API_KEY = 'cle-test'
const { listeGabarits, trouverGabarit } = await import('../src/services/catalogue.js')
const { validerDemandePlan, normaliserProjetAssistant, nettoyerTexte, SaisieInvalide } = await import('../src/services/saisie.js')
const { genererPlan } = await import('../src/services/plans.js')
const { validerChat, ChatInvalide } = await import('../src/services/validerChat.js')
const { dialoguerAvecClaude, interpreterReponse, construirePrompt, construireOutil, ErreurAssistant } = await import('../src/services/assistant.js')

describe('catalogue (contrat GET /api/gabarits)', () => {
  test('chaque entrée a id, libelle et variantes avec standings (tableaux de chaînes)', () => {
    const cat = listeGabarits()
    assert.deepEqual(cat.map((g) => g.id), ['F2_PLAIN_PIED', 'F3_PLAIN_PIED', 'F4_PLAIN_PIED'])
    for (const g of cat) {
      assert.ok(g.libelle)
      assert.ok(g.variantes.length > 0)
      for (const v of g.variantes) {
        assert.ok(v.id)
        assert.ok(v.standings.length > 0 && v.standings.every((s) => typeof s === 'string'))
      }
    }
  })
  test('la variante D du F4 n’est pas annoncée en économique (le moteur la refuse)', () => {
    const f4 = listeGabarits().find((g) => g.id === 'F4_PLAIN_PIED')
    assert.deepEqual(f4.variantes.find((v) => v.id === 'D').standings, ['standard', 'confort'])
  })
  test('trouverGabarit tolère la casse et la forme courte', () => {
    assert.equal(trouverGabarit('f3').entree.id, 'F3_PLAIN_PIED')
    assert.equal(trouverGabarit(' F4_plain_pied ').entree.id, 'F4_PLAIN_PIED')
    assert.equal(trouverGabarit('F9'), null)
    assert.equal(trouverGabarit(undefined), null)
  })
})

describe('génération de plans (contrat POST /api/plan)', () => {
  test('TOUT ce que /api/gabarits annonce se génère (gabarit × variante × standing)', () => {
    for (const g of listeGabarits()) for (const v of g.variantes) for (const s of v.standings) {
      const r = genererPlan(validerDemandePlan({ gabarit: g.id, variante: v.id, standing: s }))
      assert.ok(r.svg.startsWith('<svg'), `${g.id} ${v.id} ${s}`)
      assert.ok(Array.isArray(r.alertes))
    }
  })
  test('sortie conforme à ce que lit le frontend', () => {
    const r = genererPlan(validerDemandePlan({ gabarit: 'F3_PLAIN_PIED', standing: 'standard', variante: 'A', projet: 'Maison Awa', moa: 'Awa Koffi', date: '2026-11-21' }))
    assert.ok(r.svg.includes('MAISON AWA') && r.svg.includes('Awa Koffi'))   // le moteur met le projet en majuscules dans le cartouche
    assert.equal(Buffer.from(r.pdf, 'base64').subarray(0, 5).toString(), '%PDF-')   // décodé par atob() côté navigateur
    assert.ok(r.ifc.startsWith('ISO-10303-21;'))
    assert.deepEqual(Object.keys(r.page).sort(), ['echelle', 'format', 'orientation'])
    assert.ok(r.svg.includes('21/11/2026'))
  })
  test('format, échelle et orientation forcés sont respectés', () => {
    const r = genererPlan(validerDemandePlan({ gabarit: 'F3_PLAIN_PIED', standing: 'standard', variante: 'A', format: 'A2', echelle: '100', orientation: 'paysage' }))
    assert.deepEqual(r.page, { format: 'A2', orientation: 'paysage', echelle: 100 })
  })
  test('un format qui ne tient pas produit une alerte au lieu d’un échec', () => {
    const r = genererPlan(validerDemandePlan({ gabarit: 'F4_PLAIN_PIED', standing: 'confort', variante: 'A', format: 'A5', echelle: '50' }))
    assert.ok(r.alertes.some((a) => /ne tient pas/.test(a)))
  })
  test('valeurs refusées avec un message clair', () => {
    const refuse = (corps, re) => assert.throws(() => validerDemandePlan(corps), (e) => e instanceof SaisieInvalide && re.test(e.message))
    refuse(null, /Corps JSON/)
    refuse({ gabarit: 'X' }, /gabarit inconnu/)
    refuse({ gabarit: 'F3', standing: 'luxe' }, /standing inconnu/)
    refuse({ gabarit: 'F3', variante: 'Z' }, /variante inconnue/)
    refuse({ gabarit: 'F4', standing: 'economique', variante: 'D' }, /n'existe pas en standing/)
    refuse({ gabarit: 'F3', format: 'A9' }, /format/)
    refuse({ gabarit: 'F3', echelle: '75' }, /échelle/)
    refuse({ gabarit: 'F3', orientation: 'diagonale' }, /orientation/)
    refuse({ gabarit: 'F3', date: '2026-02-31' }, /date/)
  })
  test('« auto », « 1/100 » et la casse sont acceptés', () => {
    const o = validerDemandePlan({ gabarit: 'f3', format: 'AUTO', echelle: '1/100', orientation: 'PAYSAGE' }).options
    assert.deepEqual([o.format, o.echelle, o.orientation], ['auto', '100', 'paysage'])
    assert.equal(validerDemandePlan({ gabarit: 'f3', format: 'a3' }).options.format, 'A3')
  })
  test('les textes libres sont nettoyés pour le PDF (WinAnsi) et bornés', () => {
    assert.equal(nettoyerTexte('Maison d’Awa “Lokossa” 😀 – lot\n 3', 80), 'Maison d\'Awa "Lokossa" - lot 3')
    assert.equal(nettoyerTexte('x'.repeat(500), 80).length, 80)
    assert.equal(nettoyerTexte(null, 10), '')
    assert.equal(nettoyerTexte('Cœur & Été', 20), 'Cœur & Été')
  })
})

describe('sortie structurée de l’assistant', () => {
  test('normalise gabarit/standing et ignore les champs facultatifs invalides', () => {
    assert.deepEqual(
      normaliserProjetAssistant({ gabarit: 'f3', standing: 'Confort', format: 'A9', echelle: '100', orientation: 'auto', moa: 'Kofi', resume: 'Famille de 4' }),
      { gabarit: 'F3_PLAIN_PIED', standing: 'confort', echelle: '100', moa: 'Kofi', resume: 'Famille de 4' },
    )
  })
  test('gabarit ou standing invalide → null (jamais « prêt »)', () => {
    assert.equal(normaliserProjetAssistant({ gabarit: 'F7', standing: 'standard' }), null)
    assert.equal(normaliserProjetAssistant({ gabarit: 'F3', standing: 'luxe' }), null)
    assert.equal(normaliserProjetAssistant(null), null)
  })
})

describe('validation de POST /api/chat', () => {
  const ok = { messages: [{ role: 'user', content: 'Une maison F3' }], fichiers: [] }
  const refuse = (corps, re) => assert.throws(() => validerChat(corps), (e) => e instanceof ChatInvalide && re.test(e.message))
  test('forme minimale acceptée ; fichiers facultatifs', () => {
    assert.deepEqual(validerChat(ok).messages, ok.messages)
    assert.deepEqual(validerChat({ messages: ok.messages }).fichiers, [])
  })
  test('refus : messages absents, rôle, dernier message, contenu non texte, trop long', () => {
    refuse({}, /Aucun message/)
    refuse({ messages: [] }, /Aucun message/)
    refuse({ messages: [{ role: 'system', content: 'x' }] }, /role/)
    refuse({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }, /dernier message/)
    refuse({ messages: [{ role: 'assistant', content: 'b' }, { role: 'user', content: 'a' }] }, /commencer/)
    refuse({ messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }, /texte non vide/)
    refuse({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, /dépasse/)
  })
  test('fichiers : PDF et images acceptés, autres formats refusés avec un message lisible', () => {
    const f = (type, donnees = 'QUJD') => ({ ...ok, fichiers: [{ nom: 'plan.pdf', type, donnees }] })
    assert.equal(validerChat(f('application/pdf')).fichiers[0].nom, 'plan.pdf')
    assert.equal(validerChat(f('image/webp')).fichiers.length, 1)
    refuse(f('image/heic'), /format non pris en charge/)
    refuse(f('image/gif'), /format non pris en charge/)
    refuse(f('application/pdf', 'pas du base64 !'), /illisible/)
    refuse(f('application/pdf', ''), /vide/)
    refuse({ ...ok, fichiers: Array.from({ length: 6 }, () => ({ nom: 'a.pdf', type: 'application/pdf', donnees: 'QUJD' })) }, /5 fichiers/)
  })
  test('le nom de fichier est assaini et seuls les champs attendus sont conservés', () => {
    const r = validerChat({ ...ok, extra: 1, fichiers: [{ nom: '../../etc/pa<ss>wd.pdf', type: 'application/pdf', donnees: 'QUJD', x: 1 }] })
    assert.deepEqual(Object.keys(r), ['messages', 'fichiers'])
    assert.deepEqual(Object.keys(r.fichiers[0]), ['nom', 'type', 'donnees'])
    assert.ok(!/[/<>]/.test(r.fichiers[0].nom))
  })
})

describe('relais Anthropic (fetch simulé)', () => {
  const donnees = { messages: [{ role: 'user', content: 'Une maison F3 de plain-pied' }], fichiers: [] }
  const faux = (status, corps, capt) => async (url, init) => {
    if (capt) { capt.url = url; capt.init = init; capt.corps = JSON.parse(init.body) }
    return { ok: status >= 200 && status < 300, status, json: async () => corps }
  }
  test('requête : clé, modèle, outil, prompt dérivé du catalogue ; réponse texte seule → pret=false', async () => {
    const c = {}
    const r = await dialoguerAvecClaude(donnees, { fetchImpl: faux(200, { content: [{ type: 'text', text: 'Quel standing ?' }] }, c) })
    assert.deepEqual(r, { reponse: 'Quel standing ?', pret: false })
    assert.equal(c.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(c.init.headers['x-api-key'], 'cle-test')
    assert.equal(c.corps.tools[0].name, 'projet_pret')
    assert.deepEqual(c.corps.tools[0].input_schema.properties.gabarit.enum, ['F2_PLAIN_PIED', 'F3_PLAIN_PIED', 'F4_PLAIN_PIED'])
    assert.ok(c.corps.system.includes('F4_PLAIN_PIED') && c.corps.system.includes('D (standard, confort)'))
    assert.deepEqual(c.corps.messages, [{ role: 'user', content: 'Une maison F3 de plain-pied' }])
  })
  test('appel de l’outil valide → pret=true + projet normalisé ; texte par défaut si le modèle n’en écrit pas', async () => {
    const data = { content: [{ type: 'tool_use', name: 'projet_pret', input: { gabarit: 'F3_PLAIN_PIED', standing: 'standard', resume: 'F3 standard' } }] }
    const r = await dialoguerAvecClaude(donnees, { fetchImpl: faux(200, data) })
    assert.equal(r.pret, true)
    assert.deepEqual(r.projet, { gabarit: 'F3_PLAIN_PIED', standing: 'standard', resume: 'F3 standard' })
    assert.match(r.reponse, /formulaire/)
  })
  test('outil avec gabarit inventé → jamais « prêt »', () => {
    const r = interpreterReponse({ content: [{ type: 'text', text: 'Parfait !' }, { type: 'tool_use', name: 'projet_pret', input: { gabarit: 'F9', standing: 'standard' } }] })
    assert.equal(r.pret, false)
    assert.equal(r.projet, undefined)
    assert.match(r.reponse, /F2, F3 ou F4/)
  })
  test('le Markdown résiduel est retiré (le frontend affiche du texte brut)', () => {
    const r = interpreterReponse({ content: [{ type: 'text', text: '**Très bien.**\n\n# Titre\n* un\n* deux' }] })
    assert.equal(r.reponse, 'Très bien.\n\nTitre\n- un\n- deux')
  })
  test('fichiers : blocs image/document placés avant le texte du dernier message', async () => {
    const c = {}
    await dialoguerAvecClaude({ messages: donnees.messages, fichiers: [{ nom: 'plan.pdf', type: 'application/pdf', donnees: 'QUJD' }, { nom: 'terrain.png', type: 'image/png', donnees: 'QUJD' }] },
      { fetchImpl: faux(200, { content: [{ type: 'text', text: 'ok' }] }, c) })
    const blocs = c.corps.messages[0].content
    assert.deepEqual(blocs.map((b) => b.type), ['document', 'image', 'text'])
    assert.equal(blocs[0].source.media_type, 'application/pdf')
    assert.match(blocs[2].text, /plan\.pdf, terrain\.png/)
  })
  test('erreurs Anthropic → statuts et messages pour le frontend, sans fuite de détails', async () => {
    const statut = async (fetchImpl, d = donnees) => dialoguerAvecClaude(d, { fetchImpl }).then(() => null, (e) => e)
    let e = await statut(faux(429, { error: { type: 'rate_limit_error', message: 'secret interne' } }))
    assert.ok(e instanceof ErreurAssistant); assert.equal(e.status, 503); assert.ok(!/secret/.test(e.message))
    e = await statut(faux(500, {}))
    assert.equal(e.status, 502)
    e = await statut(faux(400, {}), { ...donnees, fichiers: [{ nom: 'a.pdf', type: 'application/pdf', donnees: 'QUJD' }] })
    assert.equal(e.status, 422)
    e = await statut(async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }) })
    assert.equal(e.status, 504)
    e = await statut(async () => { throw new Error('réseau') })
    assert.equal(e.status, 502)
  })
  test('construirePrompt / construireOutil dépendent du catalogue fourni', () => {
    const mini = [{ id: 'X_TEST', libelle: 'Maison test', explication: '', standings: [{ id: 'standard', aide: 'courant' }], variantes: [{ id: 'A', standings: ['standard'] }] }]
    assert.ok(construirePrompt(mini).includes('X_TEST'))
    assert.deepEqual(construireOutil(mini).input_schema.properties.gabarit.enum, ['X_TEST'])
  })
})
