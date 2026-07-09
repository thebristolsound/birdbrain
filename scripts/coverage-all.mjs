import { spawnSync } from 'node:child_process'

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

const run = (command, args) => {
  console.log(`\n> ${[command, ...args].join(' ')}\n`)
  return spawnSync(command, args, { stdio: 'inherit' }).status ?? 1
}

const hasXvfb = () => {
  if (process.platform !== 'linux' || process.env.DISPLAY) {
    return false
  }

  const result = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' })
  return result.status === 0 || result.status === 1
}

const statuses = []

statuses.push(run(pnpm, ['test:coverage']))

if (hasXvfb()) {
  statuses.push(run('xvfb-run', ['--auto-servernum', pnpm, 'test:e2e']))
} else {
  statuses.push(run(pnpm, ['test:e2e']))
}

statuses.push(run(pnpm, ['coverage:report']))

process.exit(statuses.some((status) => status !== 0) ? 1 : 0)
