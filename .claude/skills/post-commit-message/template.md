# Branch commit message

The header alone is a complete message. Add a body only when the diff does not explain
itself.

```
fix(signals): refresh the selector matrix on a rematched event

The rematched listener invalidated three caches but not the matrix
that backs the coverage strip, so the strip showed stale membership
beside counts that had already moved.
```

Header: `<type>(<scope>): <subject>`, 72 columns, imperative, lowercase subject.
Body: at most 6 lines at 72 columns, the why only. No closing keywords, no trailers.
