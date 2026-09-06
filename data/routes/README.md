# Routes

One `.gpx` per route. Optionally a `.json` sidecar with the same basename for
metadata and manual venue linking.

```
bukit-timah-summit-loop.gpx
bukit-timah-summit-loop.json   (optional)
```

Run `python scripts/build_data.py` after adding one — it computes distance,
gain, loop detection and venue links, and writes them into
`public/data/routes.json`.

See [../../CONTRIBUTING.md](../../CONTRIBUTING.md) for the full walkthrough,
including what not to upload.
