import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

function argValue(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  }
  catch {
    return false
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function flatten(value, prefix = '$') {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) {
    return [{ path: prefix, value }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${prefix}[${index}]`))
  }
  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => flatten(child, `${prefix}.${key}`))
  }
  return []
}

function isEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function scoreCase(name, expected, actual, evidence) {
  const expectedFields = flatten(expected).filter(item => item.path !== '$')
  const actualByPath = new Map(flatten(actual).map(item => [item.path, item.value]))
  const evidenceFields = Array.isArray(evidence?.fields) ? evidence.fields : []
  const evidenceByPath = new Map(evidenceFields.map(item => [item.fieldPath, item]))

  let exactMatches = 0
  let missingMatches = 0
  let expectedMissing = 0
  let evidenceCovered = 0

  for (const field of expectedFields) {
    const actualValue = actualByPath.get(field.path)
    if (isEqual(actualValue, field.value))
      exactMatches += 1
    if (field.value === null) {
      expectedMissing += 1
      if (actualValue === null)
        missingMatches += 1
    }
    if (field.value !== null) {
      const item = evidenceByPath.get(field.path)
      if (item?.status === 'found' && item.snippet)
        evidenceCovered += 1
    }
  }

  const actualPaths = new Set(flatten(actual).filter(item => item.path !== '$').map(item => item.path))
  const expectedPaths = new Set(expectedFields.map(item => item.path))
  const unexpectedFieldCount = Array.from(actualPaths).filter(fieldPath => !expectedPaths.has(fieldPath)).length
  const nonNullExpected = expectedFields.filter(item => item.value !== null).length

  return {
    name,
    fieldCount: expectedFields.length,
    exactMatches,
    exactFieldAccuracy: expectedFields.length ? exactMatches / expectedFields.length : 1,
    expectedMissing,
    missingMatches,
    missingAccuracy: expectedMissing ? missingMatches / expectedMissing : 1,
    unexpectedFieldCount,
    evidenceCovered,
    evidenceCoverage: nonNullExpected ? evidenceCovered / nonNullExpected : 1,
    evidenceIssueCount: Number(evidence?.coverage?.issueCount) || 0,
  }
}

async function main() {
  const fixturesDir = path.resolve(argValue('--fixtures', 'test/fixtures/agent-eval'))
  if (!await pathExists(fixturesDir)) {
    console.log(`No agent eval fixtures found at ${fixturesDir}`)
    return
  }

  const entries = await fs.readdir(fixturesDir, { withFileTypes: true })
  const cases = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  const results = []

  for (const name of cases) {
    const caseDir = path.join(fixturesDir, name)
    const expectedPath = path.join(caseDir, 'expected.json')
    const actualPath = path.join(caseDir, 'actual.json')
    const evidencePath = path.join(caseDir, 'actual-evidence.json')
    if (!await pathExists(expectedPath) || !await pathExists(actualPath)) {
      results.push({ name, skipped: true, reason: 'expected.json or actual.json missing' })
      continue
    }

    const expected = await readJson(expectedPath)
    const actual = await readJson(actualPath)
    const evidence = await pathExists(evidencePath) ? await readJson(evidencePath) : undefined
    results.push(scoreCase(name, expected, actual, evidence))
  }

  console.log(JSON.stringify({ fixturesDir, results }, null, 2))
  const failed = results.some(result => !result.skipped && (result.exactFieldAccuracy < 1 || result.evidenceIssueCount > 0))
  if (failed)
    process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
