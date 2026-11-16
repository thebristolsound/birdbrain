# Export known-answer fixtures

`tests/main/services/exportKnownAnswer.test.ts` reads these files.

- `answers.json` holds the pinned answer for each export the test makes: the SHA-256 and size
  of every zip member in zip order, the SHA-256 of the zip, the Package Hash, and what Package
  Verification says of the unpacked zip. The test's header gives the command that rewrites it.
- `installation-public-key.pem` is the public signing key of the installation the test exports
  as. Every pinned package is signed under it, so replacing it changes every answer.
- `peer-public-key.pem` is the public key of the second member of the test's Shared Case.
  Replacing it changes the Shared Case answer only.
- `.gitattributes` keeps both key files byte for byte on checkout.

No private key is stored here or anywhere in the repository. The test signs with a stand-in
that needs none; its header says how.
