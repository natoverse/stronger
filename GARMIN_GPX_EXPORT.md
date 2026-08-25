# Garmin GPX Export

The **Garmin GPX Export** workflow creates a downloadable ZIP containing every
valid hiking and mountaineering GPX activity from January 1, 2015 onward. It
uses the same Garmin filtering and GPX preparation as the Gaia sync, but does
not connect to Gaia.

## Run the export

1. Ensure the repository has the `GARMIN_TOKENS` Actions secret described in
   [GARMIN_SYNC_SETUP.md](GARMIN_SYNC_SETUP.md).
2. Open **Actions → Garmin GPX Export → Run workflow**.
3. When the run finishes, open it and download the **garmin-gpx-export**
   artifact.
4. Extract the artifact, then extract `garmin-gpx-export.zip` to access the GPX
   files.

The artifact is retained for 30 days. A run reports failure if any eligible
activity cannot be exported, while still uploading the ZIP containing all
successful downloads.
