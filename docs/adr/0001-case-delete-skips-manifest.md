# Case delete does not write per-capture manifest entries

When a single MHTML **Capture** is deleted, the Capture Lifecycle writes a manifest deletion entry (hash-chained, operator-attributed) before removing the row and the on-disk files. Deleting a whole **Case** does not — it cascades captures via SQLite foreign keys and removes the case directory wholesale, with no per-capture manifest writes.

This is deliberate. The manifest is a forensic audit trail for in-investigation capture mutations. Case deletion is an administrative wholesale operation: there is no surviving case directory or manifest for the entries to live in, and the audit story for "the entire case was destroyed" is the case-row deletion itself, not a per-capture trail. Callers that need the per-capture audit chain must delete captures individually before deleting the case.

Recorded so that future architecture passes don't "fix" the asymmetry between `captureLifecycle.deleteCapture` and `db.deleteCase`.
