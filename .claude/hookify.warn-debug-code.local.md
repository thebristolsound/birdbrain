---
name: warn-debug-code
enabled: true
event: file
pattern: console\.log\(|console\.debug\(|console\.warn\(|console\.error\(|debugger\b|eval\(|innerHTML\s*=
action: warn
---

⚠️ **Debug or unsafe code pattern detected!**

You're adding code that may not be production-ready:

- **console.log/debug/warn/error** — Debug logging that shouldn't ship to production
- **debugger** — Breakpoint statement left in code
- **eval()** — Executes arbitrary code, security risk (OWASP top 10)
- **innerHTML =** — XSS vulnerability, use `textContent` or sanitized rendering instead

**Consider:**
- Is this intentional for development, or should it be removed before committing?
- Use a proper logging service instead of console methods
- For React, never use `innerHTML` — use JSX or `dangerouslySetInnerHTML` with sanitization
