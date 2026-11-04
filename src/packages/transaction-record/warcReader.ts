// Entry point: a WARC reader that is not the writer (plan, "The `warcio` licence and the test
// readers"). It imports nothing from `warcio`, and only tests import it: the package's own and the
// Transaction Record e2e spec. lib/ is private.
export { gzipMembers, readWarc } from './lib/warcReader'
export type { WarcRecord } from './lib/warcReader'
