// src/config/env.js
// Lecture centralisée des variables d'environnement (même principe que CivilEstimateur) : un seul endroit
// à modifier pour ajouter/renommer une variable ; les valeurs par défaut sont documentées ici.
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function parseOrigins(raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    // Un slash final ne matchera jamais l'en-tête `Origin` du navigateur (qui n'en porte jamais).
    .map((s) => s.replace(/\/+$/, ''))
}

function parseRegex(raw) {
  const t = String(raw || '').trim()
  if (!t) return null
  try { return new RegExp(t) } catch { console.warn('[config] ORIGINES_REGEX invalide — ignorée.'); return null }
}

const DEFAULT_ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:8080,http://127.0.0.1:8080'

function dossierFrontend(raw) {
  const t = String(raw || '').trim()
  if (/^(none|non|false|0)$/i.test(t)) return ''
  return t ? path.resolve(t) : path.join(RACINE, 'public')
}

export const env = {
  PORT: Number(process.env.PORT) || 8080,
  NODE_ENV: process.env.NODE_ENV || 'development',
  RACINE,
  ALLOWED_ORIGINS: parseOrigins(process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS),
  ORIGINES_REGEX: parseRegex(process.env.ORIGINES_REGEX),
  // Assistant de cadrage (/api/chat) : relais vers l'API Anthropic sans jamais exposer la clé au navigateur.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  ANTHROPIC_MAX_TOKENS: Number(process.env.ANTHROPIC_MAX_TOKENS) || 1024,
  ANTHROPIC_TIMEOUT_MS: Number(process.env.ANTHROPIC_TIMEOUT_MS) || 60_000,
  // Le backend peut servir lui-même le frontend (window.ARKIVIO_API_URL = "" dans index.html).
  FRONTEND_DIR: dossierFrontend(process.env.FRONTEND_DIR),
}

/** Avertit au démarrage des fonctionnalités désactivées faute de configuration. */
export function warnMissingConfig() {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn("[config] ANTHROPIC_API_KEY absent — /api/chat répondra 501 (la génération de plans /api/plan reste disponible).")
  }
}
