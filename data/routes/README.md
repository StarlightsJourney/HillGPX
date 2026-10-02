# Routes

One `.gpx` per hill or mountain route. Use a `.json` sidecar with the same
basename for provenance, licensing, contributor details, and venue linking.

```
bukit-timah-summit-loop.gpx
bukit-timah-summit-loop.json   (optional)
```

Run `python scripts/build_data.py` after adding one — it computes distance,
gain when elevation is available, loop detection and venue links, and writes
them into `public/data/routes.json`.

Worldwide hill and mountain coverage is the priority. A volunteer-maintained
open-source GPX and photo dataset will become the preferred bulk source once
its location and format are supplied. Its source identifiers, contributor,
licence, attribution, and original URLs must be retained during import.

See [../../docs/DEVELOPING.md](../../docs/DEVELOPING.md) for the full walkthrough,
including what not to upload.
