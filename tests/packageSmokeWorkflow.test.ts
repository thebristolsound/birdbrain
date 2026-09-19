import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

function readWorkflow(filename: string): string {
  return readFileSync(join(ROOT, '.github', 'workflows', filename), 'utf8')
}

interface MatrixLeg {
  os: string
  script: string
  smoke: string
}

function extractMatrix(content: string, jobName: string): MatrixLeg[] {
  const lines = content.split('\n')
  let inJob = false
  let inMatrix = false
  const items: MatrixLeg[] = []
  let currentItem: Partial<MatrixLeg> | null = null

  for (const line of lines) {
    const jobMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):/)
    if (jobMatch) {
      inJob = jobMatch[1] === jobName
      if (!inJob) inMatrix = false
      continue
    }
    if (!inJob) continue

    if (line.includes('matrix:')) {
      inMatrix = true
      continue
    }

    if (inMatrix) {
      if (line.match(/^\s*(runs-on|steps|timeout-minutes|needs|permissions|env):/)) {
        inMatrix = false
        if (currentItem && currentItem.os && currentItem.script && currentItem.smoke) {
          items.push(currentItem as MatrixLeg)
          currentItem = null
        }
        continue
      }
      const itemStart = line.match(/^\s*-\s+os:\s*(.+)$/)
      if (itemStart) {
        if (currentItem && currentItem.os && currentItem.script && currentItem.smoke) {
          items.push(currentItem as MatrixLeg)
        }
        currentItem = { os: itemStart[1].trim() }
        continue
      }
      if (currentItem) {
        const keyVal = line.match(/^\s*([a-zA-Z0-9_-]+):\s*(.+)$/)
        if (keyVal) {
          currentItem[keyVal[1] as keyof MatrixLeg] = keyVal[2].trim()
        }
      }
    }
  }
  if (currentItem && currentItem.os && currentItem.script && currentItem.smoke) {
    items.push(currentItem as MatrixLeg)
  }
  return items
}

function extractPullRequestPaths(content: string): string[] {
  const lines = content.split('\n')
  let inPR = false
  let inPaths = false
  const paths: string[] = []

  for (const line of lines) {
    if (line.match(/^\s*pull_request:/)) {
      inPR = true
      continue
    }
    if (inPR && line.match(/^\s*paths:/)) {
      inPaths = true
      continue
    }
    if (inPaths) {
      if (!line.match(/^\s*-\s+/)) {
        inPaths = false
        inPR = false
        continue
      }
      const pathMatch = line.match(/^\s*-\s+(.+)$/)
      if (pathMatch) {
        paths.push(pathMatch[1].trim())
      }
    }
  }
  return paths
}

function extractStepRun(content: string, jobName: string, stepName: string): string | null {
  const lines = content.split('\n')
  let inJob = false
  let inStep = false
  for (const line of lines) {
    const jobMatch = line.match(/^ {2}([a-zA-Z0-9_-]+):/)
    if (jobMatch) {
      inJob = jobMatch[1] === jobName
      continue
    }
    if (!inJob) continue

    const stepMatch = line.match(/^\s*-\s+name:\s*(.+)$/)
    if (stepMatch) {
      inStep = stepMatch[1].trim() === stepName
      continue
    }
    if (inStep) {
      const runMatch = line.match(/^\s*run:\s*(.+)$/)
      if (runMatch) return runMatch[1].trim()
    }
  }
  return null
}

describe('package smoke and release workflow consistency', () => {
  it('triggers package-smoke on edits to release.yml', () => {
    const smokeContent = readWorkflow('package-smoke.yml')
    const paths = extractPullRequestPaths(smokeContent)
    expect(paths).toContain('.github/workflows/release.yml')
    expect(paths).toContain('.github/workflows/package-smoke.yml')
    expect(paths).toContain('scripts/package-smoke.mjs')
  })

  it('keeps matrix legs aligned between package-smoke.yml and release.yml', () => {
    const smokeContent = readWorkflow('package-smoke.yml')
    const releaseContent = readWorkflow('release.yml')

    const smokeMatrix = extractMatrix(smokeContent, 'smoke')
    const releaseMatrix = extractMatrix(releaseContent, 'build-app')

    expect(smokeMatrix.length).toBeGreaterThan(0)
    expect(releaseMatrix.length).toBeGreaterThan(0)

    const normalizeLeg = (leg: MatrixLeg) => ({
      os: leg.os,
      script: leg.script,
      smoke: leg.smoke
    })

    expect(smokeMatrix.map(normalizeLeg)).toEqual(releaseMatrix.map(normalizeLeg))
  })

  it('runs identical build and smoke commands in package-smoke.yml and release.yml', () => {
    const smokeContent = readWorkflow('package-smoke.yml')
    const releaseContent = readWorkflow('release.yml')

    const smokeBuild = extractStepRun(smokeContent, 'smoke', 'Build and package')
    const releaseBuild = extractStepRun(releaseContent, 'build-app', 'Build and package')
    expect(smokeBuild).not.toBeNull()
    expect(smokeBuild).toBe(releaseBuild)

    const smokeRun = extractStepRun(smokeContent, 'smoke', 'Smoke the packaged app')
    const releaseRun = extractStepRun(releaseContent, 'build-app', 'Smoke the packaged app')
    expect(smokeRun).not.toBeNull()
    expect(smokeRun).toBe(releaseRun)
  })

  // Nothing in the repo parses release.yml as YAML, so the notes heredoc is only ever
  // checked as raw text. #1247 pinned four statements the public beta page has to carry.
  it('keeps the public-beta preamble in the release notes heredoc', () => {
    const releaseContent = readWorkflow('release.yml')

    expect(releaseContent).toMatch(/^ {10}## About this beta$/m)
    expect(releaseContent).toMatch(/silently lose, corrupt, or mis-attest evidence/)
    expect(releaseContent).toMatch(/installers are unsigned/)
    expect(releaseContent).toMatch(/click \*\*More info\*\*, then \*\*Run anyway\*\*/)
    expect(releaseContent).toMatch(/advisory is a pinned issue on/)
    expect(releaseContent).toMatch(/install updates only on \*\*Restart to update\*\*/)
    expect(releaseContent).toMatch(/Source opens when the public-readiness effort closes/)
  })

  it('points the release notes at the download page and never at a tester chat', () => {
    const releaseContent = readWorkflow('release.yml')

    expect(releaseContent).toMatch(
      /\[Download and install\]\(https:\/\/thebristolsound\.github\.io\/birdbrain\/docs\/download\/\)/
    )
    expect(releaseContent).not.toMatch(/tester chat/i)
  })
})
