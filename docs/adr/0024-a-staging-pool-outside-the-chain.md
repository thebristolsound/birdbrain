# A Staging Pool holds files before the operator commits them to the chain

**Status:** Accepted

**Date:** 2026-08-30

ADR-0023 anchors every Exhibit in the Manifest. Some acquisitions are deliberate one-at-a-time
acts that should anchor at once; others bring in many files the operator has not yet judged: a
bulk upload, a Google Drive pull, a scrape of every image on a page. Anchoring those on arrival
would fill the chain with material the operator never meant to present, and a deletion entry
for each unwanted file is noise, not custody.

**We decided** that each Case has a **Staging Pool**: a write-once holding area for files that
have arrived but are not yet evidence. Only an explicit **commit** ingests a pooled file as an
Exhibit and writes its Manifest Entry. Captures of every method commit directly, as they do
today, because a Capture's evidentiary value is that it was taken at a stated moment and a gap
between that moment and its entry would weaken it. An archive import restores what the archive
declares: already-anchored entries as anchored, and entries flagged `staged` to the pool. Everything new pools:
manual uploads, right-click image saves, document imports, Drive imports, and any future
scrape-all.

**Why write-once and hashed on arrival.** A pooled file is hashed when it lands and the hash is
shown with a "not anchored" label, so the operator can compare it against the source they got it
from before deciding. Editing means pooling a new file, and commit re-hashes and refuses if the
bytes changed underneath. A pool whose contents can be replaced in place is a place where bytes
can quietly change, which is the opposite of what a holding area for evidence is for.

**The trade-off accepted.** The Case directory now holds bytes the chain does not cover, and the
archive, the exports and the Data screen all have to say so unmistakably. The alternative, no
pool and anchor-on-arrival, was rejected in the preceding paragraph; the other alternative, a pool outside the Case
directory that never travels, was rejected because an investigator moving a Case between
machines expects their working material to come along.

## Consequences

- **Location.** `{caseId}/staging/`. The orphan scan and the storage-size read learn the
  directory.
- **Travel.** In the `.birdbrain` archive as declared entries flagged `staged`, so the archive
  verifier checks pooled bytes too and the importer cannot mistake them for anchored ones. Never
  in an Evidence Package. In a Working Copy only by opt-in.
- **What runs in the pool.** Derivations (text, metadata, EXIF) run on pooled files and produce
  pooled Derived Files, so the operator can search and preview before deciding; that text is
  searchable in the pool view only. Selector matches and Extracted Data are recorded at commit,
  never for pooled content, so unanchored matches never sit beside anchored ones in the same
  tables or exports.
- **Commit.** One `exhibit` entry per file (the batch-deletion precedent: N ordinary entries, not
  one batch entry), operator-attributed, with the Exhibit Number assigned, and the RFC 3161 stamp
  requested as for a Capture. Discard writes nothing, because the pool is outside the chain.
- **Surface.** A Staging group in the Data screen beside Data Sources: rows carry a "not
  anchored" chip, are excluded from Integrity Exceptions and the Manifest Ledger, and offer
  Commit and Discard inline and in the context menu. Upload lands in Staging. The inventory read
  path returns pooled and anchored rows with a discriminator, never two lists.
- **Certification and report** never mention pooled content.
