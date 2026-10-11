# Anonymous-team sync spike: can Shared Case sync hide every member's address?

**Date:** 2026-10-10

**Status:** Partial. Questions 1, 2, and 4 are answered. Question 3 ran through n0's public relay
without Tor, because the binding has no proxy setting and the test host has no Tor; what remains
is under "What a human must still measure." The maintainer's rulings of 2026-10-10 are under
"Rulings."

Answers the four questions on #1697 for the anonymous-team mode that
[ADR-0032](../adr/0032-route-app-egress-but-do-not-disguise-the-browser.md) rule 1 names as later
work (`0032-route-app-egress-but-do-not-disguise-the-browser.md:51-56`): relay-only connections,
so teammates never learn each other's addresses, with the relay connection sent through the
Egress, so the relay does not either. Decision 2 of the
[collaborative cases design](2026-09-19-collaborative-cases-design.md) chose Iroh as the transport
(`:45`). On 2026-10-10 the maintainer ruled no-go on the mode; the ruling and its evidence are
under "Rulings." Repository citations describe `origin/main` at `df531d36`.

## Answers

1. **No.** `@number0/iroh` 1.1.0 exposes neither `clear_ip_transports` nor `proxy_url`. Its
   `EndpointBuilder` has eight methods: `applyN0`, `applyMinimal`, `applyN0DisableRelay`,
   `secretKey`, `alpns`, `relayMode`, `bindAddr`, and `bind` (`index.d.ts:135-152`). The loaded
   module's prototype has the same eight, and no export, method, or option mentions a proxy. The
   binding's main branch at `3103bf5295` adds neither (`n0-computer/iroh-ffi`,
   `iroh-js/index.d.ts`), and an issue search there for `proxy` and `clear_ip_transports`
   returned nothing on 2026-10-10. The Rust crate the binding wraps, `iroh` 1.0.2, has both
   (`endpoint.rs:501-507`, `:689-693`).
2. **HTTP `CONNECT` only, and only in Rust.** The relay client opens the proxy connection over
   plain TCP when the scheme of the proxy URL is `http` and over TLS for any other scheme, then
   sends an HTTP `CONNECT` request (`iroh-relay` 1.0.2, `client/tls.rs:143-175`). A `socks5://`
   URL therefore gets a TLS handshake and a `CONNECT` request, which a SOCKS port does not answer.
   This was read from the source, not run, because the binding cannot set the URL. Tor's HTTP
   tunnel port speaks `CONNECT`, but Tor leaves it off unless `torrc` sets `HTTPTunnelPort`
   (tor manual, `HTTPTunnelPort`: "Default: 0"). The two Tor presets in ADR-0032 rule 6
   (`:80-82`) are SOCKS ports 9150 and 9050, so neither works as an Iroh proxy.
3. **Not over Tor.** Two raw endpoints in one Node process exchanged a fixed 1 KiB synthetic
   payload through n0's public relay. Across seven runs, connecting through the relay took 62 to
   72 ms, and the first round, which started on the relay path, took 68 to 77 ms. No run stayed
   on the relay: 170 to 188 ms after connecting, the client switched to a direct path, because
   both endpoints shared one host and the binding cannot drop its IP sockets. A whole sync
   session on the 60-second timer was not timed; that moved to SC-5's smoke test.
4. **The binding has no relay-only mode to create a ticket in.** A ticket carries whatever
   addresses the app puts in the `EndpointAddr` it wraps (`EndpointTicket.fromAddr`,
   `index.d.ts:175`; `src/ticket.rs:20-25`). The default one, from `Endpoint.addr()` under the
   n0 preset, carried eight direct addresses: the host's public IPv4 address, one in the
   100.64.0.0/10 shared range, and six private ones. A ticket built from
   `new EndpointAddr(id, relayUrl, [])` carried none. Leaving the addresses out of the ticket did
   not keep them from the peer: once connected, each endpoint held eight direct addresses of the
   other.

## Method

Runtime: Node 20.20.2 on Linux x64 under WSL2, with `@number0/iroh` 1.1.0 and its
`@number0/iroh-linux-x64-gnu` binary, installed from npm into an empty scratch directory outside
the repository with install scripts turned off. Version strings in the binary name `iroh` 1.0.2
and `iroh-relay` 1.0.2. Binding paths below are files in the 1.1.0 npm tarball, whose panic
messages call `src/` by its source name, `iroh-js/src/`. Rust paths are in the `iroh` 1.0.2 crate
from crates.io unless they name `iroh-relay` 1.0.2. SC-5 (#1809, Iroh transport, node key
persistence, and packaging) and SC-6 (#1810, invite, join, and roster writers) are the two issues
#1513 was split into on 2026-10-10. Their briefs are in the three-programme agent briefs plan
(`docs/plans/2026-10-10-three-programme-agent-briefs.md`, not yet on `main`).

The probe at the end of this page binds two endpoints in one process, a server and a client,
dials the server from the client, and echoes a 1 KiB synthetic payload 20 times, each round on a
fresh bidirectional stream, then once more after eight seconds. It records the selected path
before and after each round, polls `Connection.paths()` every 100 ms, and asks each endpoint
which direct addresses it holds for the other (`Endpoint.remoteAddr`). It prints address kinds
(loopback, private, the 100.64.0.0/10 shared range, public), never addresses. Each configuration
ran once with 20 rounds, and `minimal-relay-loopback` ran five more times with three rounds.

| Configuration | Preset | IP sockets bound to | Ticket the client dialed |
| --- | --- | --- | --- |
| `direct` | minimal, no relay | every interface (default) | `Endpoint.addr()` |
| `n0-default-ticket` | n0 | every interface | `Endpoint.addr()` |
| `n0-relay-ticket` | n0 | every interface | node id and relay URL only |
| `n0-loopback-bind` | n0 | `127.0.0.1:0` and `[::1]:0` | `Endpoint.addr()` |
| `minimal-relay-loopback` | minimal, plus n0's relays | `127.0.0.1:0` and `[::1]:0` | node id and relay URL only |

The n0 preset adds n0's four production relays, publishing to n0's DNS server, and DNS lookup
(`endpoint/presets.rs:115-139`). The minimal preset sets only the crypto provider (`:62-79`);
`relayMode(RelayMode.defaultMode())` adds the relays back without the publishing. Smaller probes
checked the loaded module's surface, the `watch*` methods, the node key, and whether proxy
environment variables reach the relay connection.

## Results

**The binding has no setting that keeps addresses off the network.** It also lacks the Rust
builder's `portmapper_config`, `net_report_config`, and `clear_address_lookup`
(`endpoint.rs:786-789`, `:798-801`, `:585-588`). Port mapping, which asks the local router for an
external port over Universal Plug and Play (UPnP), the Port Control Protocol (PCP), or NAT Port
Mapping Protocol (NAT-PMP), therefore always runs: it is on by default (`portmapper.rs:35-39`),
it is one of the default features of `iroh` (`Cargo.toml:68-73`), and `portmapper-0.19.1`
appears in the binary. The relay probes always run too: QUIC address discovery, plus an HTTPS
latency check against each relay.

**Proxy environment variables do not reach the relay connection.** The relay client takes only
an explicit `proxy_url` (`socket/transports/relay/actor.rs:310-311`), and no preset reads the
environment (`endpoint/presets.rs:39-182`). With `HTTP_PROXY`, `HTTPS_PROXY`, their lowercase
forms, and `ALL_PROXY` all pointing at a closed local port, an endpoint bound to every interface
still reached its home relay in 5.2 s, against 2.7 s without them. The same endpoint bound to
loopback reached none within 30 s, against 3.2 s without them. Something the variables do reach
takes part in choosing the home relay. The likely candidate is the HTTPS latency probe, which
builds its own HTTP client without `proxy_url` (`net_report/reportgen.rs:815-856`); this was not
traced.

**A default ticket carries the public address and every interface address.** Under the n0
preset, `Endpoint.addr()` after `online()` held eight direct addresses, including the public IPv4
address the relay reported back through QUIC address discovery (`socket.rs:1833-1838`). The
237-character ticket built from it carried all eight. The spec puts direct addresses in the
invite (`2026-09-19-collaborative-cases-design.md:161-163`), so anyone who reads an invite string
learns them, not only the joiner.

**A relay-only ticket did not keep the addresses from the peer.** In `n0-relay-ticket` the
122-character ticket held the node id and relay URL only, and the server saw the connection
arrive through the relay. Each side then adds its own direct addresses to the connection as
hole-punching candidates (`socket/remote_map/remote_state.rs:405-407`), and the dialer starts hole
punching (`:504-567`). 181 ms after connecting, the client selected a direct path, and each
endpoint then held eight direct addresses of the other: one in the shared range and seven
private. The public address was not among them in this run, with both endpoints on one host. The
direct-address list includes the relay-reported public address (`socket.rs:1814-1871`), so a
peer on another network is expected to receive it; that was not measured.

**Binding the IP sockets to loopback kept every other address from the peer.** A `bindAddr` call
replaces the default socket for its address family (`socket/transports.rs:201-221`), so binding
`127.0.0.1:0` and `[::1]:0` leaves no socket on any interface but loopback. In
`n0-loopback-bind` and `minimal-relay-loopback`, `Endpoint.addr()` held only the two loopback
addresses, and each peer learned only loopback addresses of the other. The endpoints still
reached the relay, because the relay connection is a TCP connection the operating system routes,
outside Iroh's UDP sockets. Two limits apply. Port mapping still runs, and a router that grants a
mapping adds its public address to the list (`socket.rs:1821-1831`); this network granted none.
The relay still receives the TCP connection from the host's own address.

**The minimal preset with n0's relays connects without publishing.** `minimal-relay-loopback` has
no `PkarrPublisher`, so it sends nothing to `https://dns.iroh.link/pkarr`
(`address_lookup/pkarr.rs:127`). The n0 preset publishes the relay URL only (`:168`, `:208-211`),
but its HTTPS request leaves from the Operator's own address. Without address lookup, a dialer
must already hold the peer's relay URL.

**One round over the relay took 68 to 77 ms.** Each endpoint reached its home relay 2.8 to 3.3 s
after binding.

| Runs | Connect through the relay | First 1 KiB round, starting on the relay | Direct path selected after connect |
| --- | --- | --- | --- |
| `minimal-relay-loopback`, six runs | 62 to 72 ms | 68.1 to 76.3 ms | 170 to 188 ms |
| `n0-relay-ticket`, one run | 64 ms | 71.8 ms | 181 ms |

Once a direct path was selected, the median 1 KiB round took 0.3 to 0.8 ms in every
configuration, the same as `direct`.

**Calling a `watch*` method aborts the process.** `Connection.watchPathEvents`, called by an
earlier version of the probe, ended Node with "there is no reactor running" at
`iroh-js/src/watch.rs:103` and exit code 134. `watchAddr`,
`watchHomeRelay`, and `watchNetworkChange` did the same at `:35`, `:50`, and `:65`.
`Connection.watchPaths` uses the same call (`:78`) and was not run. The fix,
`n0-computer/iroh-ffi` PR #281, merged on 2026-07-28 and is in no release: on 2026-10-10 the
newest version on npm was 1.1.0, published on 2026-07-16. In Electron's main process an abort
ends the app.

**The node key survives a restart if the app stores it.** Without a key, the builder generates a
new one (`endpoint.rs:516-521`). Two endpoints bound with the same 32 bytes from
`SecretKey.toBytes()` (`index.d.ts:255`), passed through `EndpointBuilder.secretKey` (`:143`),
had the same id, equal to the key's public half. An endpoint bound without a key had a different
id. This answers the binding's half of the spec's open question 1 (`:305-306`).

**The package's `main` and `types` fields name files the tarball lacks.** `package.json` names
`iroh-js/index.js` and `iroh-js/index.d.ts`, and the tarball holds `index.js` and `index.d.ts` at
its root. Node 20 loads the root file with a DEP0128 deprecation warning. TypeScript 6.0.3 under
`moduleResolution: "bundler"`, the repository's setting (`tsconfig.json:6`), falls back to the
root `index.d.ts`. Whether the main-process build resolves it was not checked.

## What this does not show

- Nothing over Tor. The binding cannot set a proxy, and the test host has no Tor.
- Nothing between two hosts. On one host every configuration ended on a direct path, so no
  connection stayed on the relay past 188 ms, and no peer received the other's public address
  through hole punching.
- Port mapping on a router that grants mappings.
- What the relay operator records. The relay receives a TCP connection from the host's own
  address in every configuration here; that follows from a direct TCP connection and was not
  observed on the relay's side.
- DNS. The endpoint resolves relay names with its own resolver, which follows the system
  configuration (`endpoint.rs:674-687`); where those queries went was not observed.
- No packet capture ran. The claims about what leaves the host come from the source and from what
  each endpoint reported.
- No sync session ran: no `hello`, `heads`, `entries`, `blobs`, or `rows` exchange.
- One host, one network, seven relay-first runs.

## What a human must still measure

After the no-go ruling, #1697 stays open for the Tor measurements (the first, second, and
last items below) and the two-network run (the third).

- **Relay-only through Tor, at the Rust level.** The binding cannot run it. Build two `iroh` 1.0.2
  endpoints with `clear_ip_transports()`, `proxy_url` set to a Tor `HTTPTunnelPort`,
  `net_report_config(NetReportConfig::minimal())`, `portmapper_config(PortmapperConfig::Disabled)`,
  and no address lookup, and exchange the same payload. Record whether each endpoint picks a home
  relay at all, the connect time, and the time per round. The relay is picked from measured
  latencies (`net_report.rs:747-816`), and `NetReportConfig` warns that turning the HTTPS probes
  off "will completely prevent finding the home relay on networks that do block QUIC"
  (`:98-99`). Needs Tor with `HTTPTunnelPort` set in `torrc` and Rust 1.91 or later
  (`iroh-relay` `Cargo.toml:14`).
- **A packet capture during that run**, showing that no UDP leaves the host and that every TCP
  connection goes to the Tor port.
- **Two machines on different networks**, running `n0-relay-ticket` as it stands, to record
  whether each peer receives the other's public address through hole punching.
- **A router that grants UPnP, PCP, or NAT-PMP mappings**, running `n0-loopback-bind`, to record
  whether a mapped public address appears in `Endpoint.addr()`.
- **Tor Browser's own tor.** ADR-0032's 9150 preset points at it; whether it accepts
  `HTTPTunnelPort` was not checked.

## Verdict for SC-5

SC-5 (#1809) can proceed as briefed. The binding connects two endpoints through n0's relay and
carries payloads, and nothing here changes the transport design. Five findings change how SC-5
builds it:

- **Call no `watch*` method on 1.1.0.** Poll `paths()` and `addr()` instead, or wait for a release
  that carries `iroh-ffi` PR #281.
- **Store the 32-byte secret key and pass it to `secretKey` at every start.** The spec records the
  node id in `member-add` (`2026-09-19-collaborative-cases-design.md:84-86`); with the key stored,
  the binding gives no reason for a rotation path.
- **Treat ADR-0032's notice as understating what teammates learn.** Rule 1 says teammates and the
  relay see the Operator's IP (`:49-51`). Through hole-punching candidates a teammate learns every
  interface address on the Operator's machine, which here meant seven private addresses besides
  one in the 100.64.0.0/10 range. A system VPN on the machine leaves its interface addresses in
  that list. The notice copy waits on the designer's revision of the members mock; this is
  evidence for it.
- **Check that the main-process build resolves the binding**, since `main` and `types` name
  missing files.
- **Dial from a ticket that holds the node id and relay URL only.** The invite carries no direct
  addresses (ruling 74 under "Rulings"), so the first connection starts on the relay. SC-6
  (#1810) owns the invite format.

The platform gate stands as the spec describes it (`:242-248`): the 1.1.0 registry metadata lists
no `darwin-x64` package among its optional dependencies.

## Rulings

The maintainer ruled on 2026-10-10. The numbers are those of that day's decision walkthrough.
Rulings 4 and 74 settle the two open questions this note raised; ruling 16 settles relay hosting
for testers (#1508).

- **Ruling 4, anonymous-team mode (ADR-0032 rule 1, #1697): no-go on `@number0/iroh` 1.1.0.**
  The ruling is posted on #1697, which stays open for the human Tor and two-network
  measurements. The posted ruling says to revisit it when the binding gains a proxy setting. The
  no-go matches this note's recommendation, whose evidence bar for reopening was a binding that
  exposes `proxy_url`, `clear_ip_transports`, `net_report_config`, and `portmapper_config`, and
  the Rust-level Tor run above showing an endpoint with no IP sockets picking a home relay.
  Evidence: answers 1 and 2, the relay probes and port mapping that the binding cannot turn off,
  and the SOCKS-only Tor presets. The recommendation put the partial mode the binding runs today
  under the same ruling: loopback-bound sockets plus relay-only tickets kept every address but
  loopback from the peer in this test, though not from the relay or n0. The no-go covers it: the
  app offers no partial mode on 1.1.0. Ruling 74 makes every invite's ticket relay-only regardless.
- **Ruling 74, invite ticket: the Iroh ticket in a `bbinvite1` invite carries only the node id
  and relay URL, never direct addresses.** The spec puts direct addresses in the invite
  (`:161-163`). Evidence: the default ticket gives the Owner's public address and every
  interface address to anyone who reads the invite string. Dropping them costs a relay
  connection on first contact (62 to 72 ms against 1 to 2 ms direct), and on one host hole
  punching moved every run to a direct path within 188 ms. The joiner still learns the addresses
  after connecting; nobody else who reads the string does. SC-6 (#1810) owns the invite format.
- **Ruling 16, relay hosting: the first testers use n0's public relays.** Before the handoff to
  testers, someone records one real sync between two machines through the relay; the ruling
  names no owner. Birdbrain hosts its own relay only if a tester cannot reach n0's. This note
  reached n0's relays from one host on one network only.

## The probe

```js
// Spike for issue 1697: two raw Iroh endpoints exchange a fixed synthetic payload.
// Usage: node exchange.js <package dir> <mode> [rounds]
// Modes: direct | n0-default-ticket | n0-relay-ticket | n0-loopback-bind | minimal-relay-loopback
// Prints address kinds only, never raw IP addresses.
const iroh = require(process.argv[2])
const { Endpoint, EndpointAddr, EndpointTicket, RelayMode, presetMinimal } = iroh
const MODE = process.argv[3]
const ROUNDS = Number(process.argv[4] || 20)
const ALPN = Array.from(Buffer.from('birdbrain-spike/0'))
const PAYLOAD = Array.from(Buffer.alloc(1024, 'synthetic-spike-payload-'))
const BIG = Array.from(Buffer.alloc(256 * 1024, 'synthetic-spike-payload-'))
const now = () => Number(process.hrtime.bigint()) / 1e6

function kind(addr) {
  if (!addr) return 'none'
  if (/^https?:\/\//.test(addr)) return 'relay:' + new URL(addr).hostname
  const host = addr.startsWith('[') ? addr.slice(1, addr.indexOf(']')) : addr.slice(0, addr.lastIndexOf(':'))
  if (host.includes(':')) {
    const h = host.toLowerCase()
    if (h === '::1') return 'ipv6-loopback'
    if (h.startsWith('fe80')) return 'ipv6-link-local'
    if (/^f[cd]/.test(h)) return 'ipv6-ula'
    return 'ipv6-public'
  }
  const [a, b] = host.split('.').map(Number)
  if (a === 127) return 'ipv4-loopback'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'ipv4-private'
  if (a === 100 && b >= 64 && b <= 127) return 'ipv4-cgnat'
  if (a === 169 && b === 254) return 'ipv4-link-local'
  return 'ipv4-public'
}
const kinds = (list) => list.map(kind).sort()
const pathView = (conn) =>
  conn.paths().map((p) => ({ selected: p.isSelected, relay: p.isRelay, ip: p.isIp, remote: kind(p.remoteAddr), rttMs: p.rttMs }))

async function bind(server) {
  const b = Endpoint.builder()
  if (MODE === 'direct') presetMinimal(b)
  else if (MODE === 'minimal-relay-loopback') {
    // Crypto provider and n0 relays, but no address lookup (no pkarr publishing).
    presetMinimal(b)
    b.relayMode(RelayMode.defaultMode())
  } else b.applyN0()
  if (MODE === 'n0-loopback-bind' || MODE === 'minimal-relay-loopback') {
    b.bindAddr('127.0.0.1:0')
    b.bindAddr('[::1]:0')
  }
  if (server) b.alpns([ALPN])
  const t0 = now()
  const ep = await b.bind()
  let onlineMs = null
  if (MODE !== 'direct') {
    await ep.online()
    onlineMs = Math.round(now() - t0)
  }
  return { ep, onlineMs }
}

async function serve(ep, report) {
  const incoming = await ep.acceptNext()
  report.serverSawIncomingFrom = (await incoming.remoteAddr()).kind
  const conn = await (await incoming.accept()).connect()
  report.serverConn = conn
  for (;;) {
    let bi
    try {
      bi = await conn.acceptBi()
    } catch {
      return
    }
    const msg = await bi.recv.readToEnd(BIG.length)
    await bi.send.writeAll(msg)
    await bi.send.finish()
  }
}

const selectedKind = (conn) => {
  const p = conn.paths().find((x) => x.isSelected)
  return p ? (p.isRelay ? 'relay' : kind(p.remoteAddr)) : 'unknown'
}

async function round(conn, payload) {
  const startPath = selectedKind(conn)
  const t = now()
  const bi = await conn.openBi()
  await bi.send.writeAll(payload)
  await bi.send.finish()
  const back = await bi.recv.readToEnd(payload.length)
  if (back.length !== payload.length) throw new Error('echo length mismatch')
  return { ms: Math.round((now() - t) * 10) / 10, startPath, path: selectedKind(conn) }
}

async function main() {
  const report = { mode: MODE, node: process.version }
  const server = await bind(true)
  report.serverOnlineMs = server.onlineMs
  const full = server.ep.addr()
  report.serverAddrDirectKinds = kinds(full.directAddresses())
  report.serverAddrRelay = full.relayUrl()

  let dialAddr = full
  if (MODE === 'n0-relay-ticket' || MODE === 'minimal-relay-loopback') dialAddr = new EndpointAddr(server.ep.id(), full.relayUrl(), [])
  const ticketString = EndpointTicket.fromAddr(dialAddr).toString()
  const parsed = EndpointTicket.fromString(ticketString).endpointAddr()
  report.ticketLength = ticketString.length
  report.ticketDirectKinds = kinds(parsed.directAddresses())
  report.ticketRelay = parsed.relayUrl()

  const serving = serve(server.ep, report)
  const client = await bind(false)
  report.clientOnlineMs = client.onlineMs
  const events = []
  const tc = now()
  const conn = await client.ep.connect(parsed, ALPN)
  report.connectMs = Math.round(now() - tc)
  // watchPathEvents aborts the process (watch.rs:103), so poll paths() instead.
  let last = ''
  const poll = setInterval(() => {
    const v = JSON.stringify(pathView(conn).map(({ rttMs, ...rest }) => rest))
    if (v !== last) events.push({ atMs: Math.round(now() - tc), paths: JSON.parse(v) })
    last = v
  }, 100)
  report.pathsAtConnect = pathView(conn)

  const rounds = []
  for (let i = 0; i < ROUNDS; i++) rounds.push(await round(conn, PAYLOAD))
  report.rounds1KiB = rounds
  report.round256KiB = await round(conn, BIG)

  await new Promise((r) => setTimeout(r, 8000))
  clearInterval(poll)
  report.pathsAfter8s = pathView(conn)
  report.roundAfter8s = await round(conn, PAYLOAD)
  const remote = await client.ep.remoteAddr(server.ep.id())
  report.clientLearnedServerDirectKinds = remote ? kinds(remote.directAddresses()) : null
  report.serverPathsAfter8s = report.serverConn ? pathView(report.serverConn) : null
  delete report.serverConn
  const serverRemote = await server.ep.remoteAddr(client.ep.id())
  report.serverLearnedClientDirectKinds = serverRemote ? kinds(serverRemote.directAddresses()) : null
  report.pathChanges = events
  conn.close(0n, Array.from(Buffer.from('bye')))
  await client.ep.close()
  await server.ep.close()
  await Promise.race([serving, new Promise((r) => setTimeout(r, 2000))])
  console.log(JSON.stringify(report, null, 1))
}

setTimeout(() => {
  console.error('timeout')
  process.exit(2)
}, 120000).unref()
main().then(
  () => process.exit(0),
  (err) => {
    console.error('FATAL', err && err.stack ? err.stack : err)
    process.exit(1)
  }
)
```

The smaller probes, each in its own file:

```js
// online.js: how long until an endpoint has a home relay?
// Usage: node online.js <package dir> <n0|minimal> <default|loopback>
const { Endpoint, RelayMode, presetMinimal } = require(process.argv[2])
;(async () => {
  const b = Endpoint.builder()
  if (process.argv[3] === 'minimal') {
    presetMinimal(b)
    b.relayMode(RelayMode.defaultMode())
  } else b.applyN0()
  if (process.argv[4] === 'loopback') {
    b.bindAddr('127.0.0.1:0')
    b.bindAddr('[::1]:0')
  }
  const t = Date.now()
  const ep = await b.bind()
  const r = await Promise.race([ep.online().then(() => Date.now() - t), new Promise((res) => setTimeout(() => res('not online after 30 s'), 30000))])
  console.log(JSON.stringify({ preset: process.argv[3], bind: process.argv[4], envProxy: !!process.env.HTTPS_PROXY, online: r }))
  process.exit(0)
})()

// watch-crash.js: does calling a watch method abort the process?
// Usage: node watch-crash.js <package dir> <method>
const { Endpoint, presetMinimal } = require(process.argv[2])
const method = process.argv[3]
;(async () => {
  const b = Endpoint.builder()
  presetMinimal(b)
  const ep = await b.bind()
  const h = ep[method](() => {})
  await new Promise((r) => setTimeout(r, 200))
  await h.stop()
  await ep.close()
  console.log(method, 'returned normally')
})()

// key.js: does a supplied 32-byte secret key give the same endpoint id across binds?
// Usage: node key.js <package dir>
const { Endpoint, SecretKey, presetMinimal } = require(process.argv[2])
;(async () => {
  const sk = SecretKey.generate()
  const ids = []
  for (let i = 0; i < 2; i++) {
    const b = Endpoint.builder()
    presetMinimal(b)
    b.secretKey(sk.toBytes())
    const ep = await b.bind()
    ids.push(ep.id().toString())
    await ep.close()
  }
  const b = Endpoint.builder()
  presetMinimal(b)
  const fresh = await b.bind()
  console.log(JSON.stringify({ sameIdWithKey: ids[0] === ids[1] && ids[0] === sk.public().toString(), keyBytes: sk.toBytes().length, freshDiffers: fresh.id().toString() !== ids[0] }))
  await fresh.close()
})()

// surface.js: list the loaded module's exports and builder methods.
// Usage: node surface.js <package dir>
const iroh = require(process.argv[2])
const out = { node: process.version, exports: Object.keys(iroh).sort(), protos: {} }
for (const name of ['Endpoint', 'EndpointBuilder', 'EndpointAddr', 'EndpointTicket', 'RelayMode', 'RelayMap']) {
  const C = iroh[name]
  out.protos[name] = {
    static: Object.getOwnPropertyNames(C).filter((k) => !['length', 'name', 'prototype'].includes(k)).sort(),
    instance: Object.getOwnPropertyNames(C.prototype).filter((k) => k !== 'constructor').sort()
  }
}
const all = JSON.stringify(out)
out.mentionsProxy = /proxy/i.test(all)
out.mentionsClearIp = /clear|ipTransport|transport/i.test(all)
out.defaultRelays = iroh.RelayMode.defaultMode().relayMap().urls()
console.log(JSON.stringify(out, null, 1))
```

Install the package into an empty directory, run the scripts from another, and pass the package
path as the first argument:

```shell
(mkdir /tmp/iroh-spike-pkg && cd /tmp/iroh-spike-pkg && npm init -y && npm install --ignore-scripts @number0/iroh@1.1.0)
P=/tmp/iroh-spike-pkg/node_modules/@number0/iroh
node surface.js "$P"
for m in direct n0-default-ticket n0-relay-ticket n0-loopback-bind minimal-relay-loopback; do node exchange.js "$P" "$m" 20 > "out-$m.json"; done
for i in 1 2 3 4 5; do node exchange.js "$P" minimal-relay-loopback 3 > "trial-$i.json"; done
for m in watchAddr watchHomeRelay watchNetworkChange; do node watch-crash.js "$P" "$m"; echo "exit=$?"; done
node key.js "$P"
node online.js "$P" minimal default; node online.js "$P" minimal loopback
export HTTP_PROXY=http://127.0.0.1:9 HTTPS_PROXY=http://127.0.0.1:9 http_proxy=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 ALL_PROXY=socks5://127.0.0.1:9
node online.js "$P" minimal default; node online.js "$P" minimal loopback
```
