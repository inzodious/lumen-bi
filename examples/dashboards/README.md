# Live dashboards

Four of the gallery templates built out into working reports on mock data. Each folder is a PBIP project
(`<Name>.pbip`) that opens in Lumen and in Power BI Desktop.

| Dashboard | Story | Pages | Tables |
|---|---|---|---|
| Orbital | A satellite operator: eight missions in four orbit classes | Mission Control, Fleet Health, Launches & Ground | dim_mission, dim_ground_station, fact_launch, fact_telemetry (daily), fact_anomaly, fact_ground_pass (monthly) |
| Contour | A regional park system's season in review | Trail Report, Visitors, Conservation | dim_park, dim_trail, dim_species, fact_visit (daily), fact_trail_work, fact_planting, fact_sighting |
| Aurora | A dream-pop artist's streaming numbers | Creator Pulse, Tracks & Releases, Audience | dim_track, dim_country, fact_stream (monthly), fact_audience (monthly) |
| Regolith | A space mining operator: 50 sites on 13 moons and asteroids (Lumen's motion showcase) | Command, Extraction, Fleet & Reliability, Logistics, Markets, Site detail (drill-through) | dim_location, dim_material, dim_event_type, dim_customer, fact_extraction, fact_downtime, fact_shipment, fact_sales, fact_inventory (monthly) |

Orbital, Contour and Aurora cover January 2025 to October 2026; Regolith covers 2069 and 2070 and opens on 2070. All share a Power Query `dim_calendar`. The rows of every other table are
embedded in its query the way Power BI's **Enter data** stores them, so a refresh needs no source. Metrics live in
`_measures_kpi`, labels, notes and colors in `_measures_format`. A year slicer, synced across pages, opens on the latest year.

Every company, person, place and number is fiction.

## Open and publish

A PBIP project opens without data until it is refreshed: in Lumen choose **Refresh** on the notice (or Home ▸
Refresh), in Power BI Desktop select **Refresh**. To publish, refresh, then **File ▸ Publish**. Orbital and Aurora use
Lumen-only effects (frosted glass); in Power BI their panels show as plain translucent boxes.

Regolith shows off Lumen's motion: every page has its own transition (circle reveal, morph with the KPI tiles gliding
into the rail on Extraction, push, depth, wipe), a page navigator rail, two bookmarks on Extraction that swap the chart
and the site table with a morph, and a drill-through from any site (right-click a bar or row) that zooms out of the
visual into **Site detail**, with a Back button that zooms back. Power BI shows the same pages, navigator, bookmarks and
drill-through without the animation.

## Change them

The projects are generated: edit `scripts/dashboards/designs/<id>.mjs` and run `node scripts/dashboards/build.mjs`.
The mock data is deterministic, so a rebuild without changes writes the same files. `dashboards.test.ts` refreshes each
project and checks that every visual returns data; `LUMEN_DASHBOARDS_WBI=/abs/dir npx vitest run examples` also saves
each one as a `.wbi` bundle with its data.
