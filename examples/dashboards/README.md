# Live dashboards

Three of the gallery templates built out into working reports on mock data. Each folder is a PBIP project
(`<Name>.pbip`) that opens in Lumen and in Power BI Desktop.

| Dashboard | Story | Pages | Tables |
|---|---|---|---|
| Orbital | A satellite operator: eight missions in four orbit classes | Mission Control, Fleet Health, Launches & Ground | dim_mission, dim_ground_station, fact_launch, fact_telemetry (daily), fact_anomaly, fact_ground_pass (monthly) |
| Contour | A regional park system's season in review | Trail Report, Visitors, Conservation | dim_park, dim_trail, dim_species, fact_visit (daily), fact_trail_work, fact_planting, fact_sighting |
| Aurora | A dream-pop artist's streaming numbers | Creator Pulse, Tracks & Releases, Audience | dim_track, dim_country, fact_stream (monthly), fact_audience (monthly) |

All three cover January 2025 to October 2026 and share a Power Query `dim_calendar`. The rows of every other table are
embedded in its query the way Power BI's **Enter data** stores them, so a refresh needs no source. Metrics live in
`_measures_kpi`, labels, notes and colors in `_measures_format`. A year slicer, synced across pages, opens on 2026.

Every company, person, place and number is fiction.

## Open and publish

A PBIP project opens without data until it is refreshed: in Lumen choose **Refresh** on the notice (or Home ▸
Refresh), in Power BI Desktop select **Refresh**. To publish, refresh, then **File ▸ Publish**. Orbital and Aurora use
Lumen-only effects (frosted glass); in Power BI their panels show as plain translucent boxes.

## Change them

The projects are generated: edit `scripts/dashboards/designs/<id>.mjs` and run `node scripts/dashboards/build.mjs`.
The mock data is deterministic, so a rebuild without changes writes the same files. `dashboards.test.ts` refreshes each
project and checks that every visual returns data; `LUMEN_DASHBOARDS_WBI=/abs/dir npx vitest run examples` also saves
each one as a `.wbi` bundle with its data.
