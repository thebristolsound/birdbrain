import { spawnSync } from 'child_process'

// The linker accepts a libvips whose own libraries have since been removed, so only loading
// the addon shows whether the tests can use it. A child process keeps a failed load out of the
// build script.
export const addonLoadError = (addon, execPath = process.execPath) => {
  const { status, stderr, error } = spawnSync(
    execPath,
    ['-e', 'process.dlopen({ exports: {} }, process.argv[1])', addon],
    { encoding: 'utf8' }
  )
  if (status === 0) return null
  if (error) return error.message
  const message = stderr.match(/^\w*Error: (.+)$/m)
  return message ? message[1] : stderr.trim() || `exit status ${status}`
}
