#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */

/*
 * Collect CI package artifacts into a single flat release directory.
 *
 * The macOS build is split across two runners (arm64 on macos-latest, x64 on
 * macos-13). Each runner emits its own `latest-mac.yml` auto-update manifest
 * describing only its architecture. This script copies every artifact into one
 * directory and merges the mac manifests into a single `latest-mac.yml` whose
 * `files` list covers both architectures, so electron-updater can serve the
 * correct zip to each arch.
 *
 * Usage: node scripts/collect-release-artifacts.mjs <inputDir> <outputDir>
 */

import {
  readdirSync,
  statSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { join, basename } from 'node:path'

const [, , inputDir, outputDir] = process.argv

if (!inputDir || !outputDir) {
  console.error('Usage: node scripts/collect-release-artifacts.mjs <inputDir> <outputDir>')
  process.exit(1)
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files.push(...walk(full))
    else files.push(full)
  }
  return files
}

mkdirSync(outputDir, { recursive: true })

const allFiles = walk(inputDir)
const macManifests = allFiles.filter((f) => basename(f) === 'latest-mac.yml')
const others = allFiles.filter((f) => basename(f) !== 'latest-mac.yml')

// Copy every non-manifest artifact. Each arch/platform should produce uniquely
// named files, so a same-named collision with different content signals a
// packaging misconfiguration (e.g. an arch was built on the wrong runner).
// Fail loudly rather than silently overwriting a good artifact with a bad one.
for (const file of others) {
  const dest = join(outputDir, basename(file))
  if (existsSync(dest) && !sameContent(file, dest)) {
    console.error(
      `Refusing to overwrite ${basename(file)}: two artifacts share a name but differ. ` +
        'Check that each architecture is built on its own runner.'
    )
    process.exit(1)
  }
  copyFileSync(file, dest)
}

if (macManifests.length > 0) {
  const merged = mergeMacManifests(macManifests.map((f) => readFileSync(f, 'utf8')))
  writeFileSync(join(outputDir, 'latest-mac.yml'), merged)
  console.log(`Merged ${macManifests.length} mac manifest(s) into latest-mac.yml`)
}

console.log(`Collected ${others.length} artifact file(s) into ${outputDir}`)

/**
 * Parse the `files:` blocks of one or more electron-builder mac manifests and
 * emit a single manifest. electron-builder's `latest-mac.yml` has a fixed, flat
 * shape (version, files[], path, sha512, size, releaseDate), so a targeted
 * parser avoids adding a YAML dependency.
 */
function mergeMacManifests(contents) {
  const parsed = contents.map(parseMacManifest)
  const base = parsed[0]

  const files = []
  const seen = new Set()
  for (const manifest of parsed) {
    for (const file of manifest.files) {
      if (seen.has(file.url)) continue
      seen.add(file.url)
      files.push(file)
    }
  }

  const lines = []
  lines.push(`version: ${base.version}`)
  lines.push('files:')
  for (const file of files) {
    lines.push(`  - url: ${file.url}`)
    lines.push(`    sha512: ${file.sha512}`)
    if (file.size !== undefined) lines.push(`    size: ${file.size}`)
  }
  lines.push(`path: ${base.path}`)
  lines.push(`sha512: ${base.sha512}`)
  if (base.releaseDate) lines.push(`releaseDate: ${base.releaseDate}`)
  return lines.join('\n') + '\n'
}

function parseMacManifest(text) {
  const lines = text.split(/\r?\n/)
  const result = { files: [] }
  let inFiles = false
  let current = null

  for (const raw of lines) {
    if (raw.trim() === '') continue

    const top = raw.match(/^([a-zA-Z0-9]+):\s*(.*)$/)
    if (top && !raw.startsWith(' ')) {
      if (current) {
        result.files.push(current)
        current = null
      }
      const [, key, value] = top
      if (key === 'files') {
        inFiles = true
        continue
      }
      inFiles = false
      result[key] = stripQuotes(value)
      continue
    }

    if (!inFiles) continue

    const itemStart = raw.match(/^\s*-\s*url:\s*(.*)$/)
    if (itemStart) {
      if (current) result.files.push(current)
      current = { url: stripQuotes(itemStart[1]) }
      continue
    }

    const prop = raw.match(/^\s*([a-zA-Z0-9]+):\s*(.*)$/)
    if (prop && current) {
      const [, key, value] = prop
      current[key] = key === 'size' ? Number(value) : stripQuotes(value)
    }
  }
  if (current) result.files.push(current)
  return result
}

function sameContent(a, b) {
  const statA = statSync(a)
  const statB = statSync(b)
  if (statA.size !== statB.size) return false
  return Buffer.compare(readFileSync(a), readFileSync(b)) === 0
}

function stripQuotes(value) {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
