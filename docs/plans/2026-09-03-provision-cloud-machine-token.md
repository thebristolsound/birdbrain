# Provision the machine token into the cloud environment (ADR-0012 §5)

One-time dashboard step only you can do. The dispatch routine now checks for these
variables at the top of every fire and exits in seconds until they exist.

1. Open <https://claude.ai/settings/environments> (or Claude Code web -> Environments)
   and edit the environment named "Default Full" (id `env_011CUoNBMcLVLkWUD3KQBFts`).
2. Add three environment variables. The values are in `~/.config/birdbrain-agent/env`
   on this machine (open it with `cat`, not printed here on purpose):
   - `BIRDBRAIN_AGENT_GH_TOKEN` - the PAT value from that file
   - `BIRDBRAIN_AGENT_GH_LOGIN` - `birdbrain-agent`
   - `BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES` - `2026-11-16`
3. Save. Nothing else changes; the routine's next hourly fire (at :43) picks them up,
   rebuilds the env file inside the sandbox, and runs the skill's own identity check.

What the next fire will tell us, in its report:
- whether the sandbox proxy honors an overridden `GH_TOKEN` for REST writes (it tests
  one harmless read as the machine account first and reports if the proxy blocks it);
- whether branch pushes work under that environment's git wiring (if not, cycles will
  give up cleanly rather than write under the wrong identity).

Known remaining gaps even with the token (tracked): #959 (the proxy cannot paginate
past one page, so collection reads may be truncated) and #960 (the tracking issue for
this whole path - close it once a fire passes the identity gate).
