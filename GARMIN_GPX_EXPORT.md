# Garmin GPX Export

The **Garmin GPX Export** workflow creates a downloadable ZIP containing every
valid GPX activity of the selected types from January 1, 2015 onward. It
uses the same Garmin filtering and GPX preparation as the Gaia sync, but does
not connect to Gaia.

## Run the export

1. Ensure the repository has the `GARMIN_TOKENS` Actions secret described in
   [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md).
2. Open **Actions → Garmin GPX Export → Run workflow**.
3. Set **activity_types** to comma-separated exact Garmin type keys:
   `hiking,mountaineering` (the default), `cycling`, `mountain_biking`, or
   `cycling,mountain_biking`. These are exact matches, not parent categories:
   `cycling` alone does not include mountain biking or indoor cycling.
4. When the run finishes, open it and download the **garmin-gpx-export**
   artifact.
5. Extract the downloaded ZIP once to access the GPX files directly.

The selection applies only to that manual export. It neither changes nightly
Gaia configurations nor requires any Gaia folder or session secret. The export
always queries from January 1, 2015 through the run date, using the next day as
the exclusive end bound.

Whitespace around type keys is allowed; empty entries and malformed keys fail
before Garmin login. Validly formatted but unknown keys can produce no matches.
The run logs the selected types and each eligible activity's result. If there
are no valid GPX files, no artifact is created and the upload step reports an
error.

The artifact is retained for 30 days. A run reports failure if any eligible
activity cannot be exported, while still uploading the ZIP containing all
successful downloads.
