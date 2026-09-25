# Cookie-file fixtures

Inputs for the persona cookie import (#1497). Both files carry the same shape of rows: two
cookies that load, one session cookie, one expired cookie, and rows each parser rejects.

| File                 | Format                   | Accepted                                   | Rejected                                                     |
| -------------------- | ------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| `netscape.txt`       | Netscape `cookies.txt`   | `sid`, `auth` (HttpOnly), `view` (session) | line 7 expired, lines 8 and 9 malformed                      |
| `cookie-editor.json` | Cookie-Editor JSON array | `sid`, `view` (session), `strict`          | entry 4 expired, entry 5 unknown SameSite, entry 6 malformed |

The values `SENTINEL-NETSCAPE-9f3a` and `SENTINEL-JSON-7c1d` exist so a test can search the
user data directory after an import and prove the file's contents were not copied there.
