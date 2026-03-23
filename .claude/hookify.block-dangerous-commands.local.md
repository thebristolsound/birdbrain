---
name: block-dangerous-commands
enabled: true
event: bash
pattern: rm\s+-rf|git\s+push\s+.*--force|git\s+reset\s+--hard|git\s+clean\s+-f|git\s+checkout\s+\.\s*$|git\s+restore\s+\.\s*$
action: block
---

🚫 **Dangerous command blocked!**

This command was blocked because it is destructive and hard to reverse.

**Detected pattern:** One of:
- `rm -rf` — recursive forced deletion
- `git push --force` — overwrites remote history
- `git reset --hard` — discards all uncommitted changes
- `git clean -f` — deletes untracked files
- `git checkout .` / `git restore .` — discards all unstaged changes

**What to do:**
- If you truly need this, ask the user for explicit confirmation first
- Consider safer alternatives (e.g., `git stash` instead of `git reset --hard`)
- For `rm`, use specific file paths instead of `-rf` on directories
