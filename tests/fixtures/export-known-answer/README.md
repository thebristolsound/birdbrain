# Export known-answer fixtures

`tests/main/services/exportKnownAnswer.test.ts` reads these files.

- `answers.json` holds the pinned answer for each export the test makes: the SHA-256 and size
  of every zip member in zip order, the SHA-256 of the zip, the Package Hash, and the checks
  Package Verification fails. The test's header gives the command that rewrites it.
- `installation-public-key.pem` is the public signing key of the installation the test exports
  as, and `peer-public-key.pem` is that of the second member of its Shared Case. Both are
  enclosed in the packages the test pins, so replacing either changes every answer.

No private key is stored here or anywhere in the repository. The test signs with a stand-in
that needs none; its header says how.
