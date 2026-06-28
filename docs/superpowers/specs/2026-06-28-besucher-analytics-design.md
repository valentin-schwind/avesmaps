# Visitor & editor analytics — design spec

- Date: 2026-06-28
- Status: design approved (brainstorm); ready for an implementation plan.

## 1. Goal & context

The editor "Status" panel tab (`data-editor-panel-section="presence"`) today shows
only editor presence (who is currently editing). Split it into two sub-tabs:

- **Editoren** — the existing presence list (unchanged) plus compact editor-activity
  figures (edits today / 7 d, most-active editors, latest changes / reports / reviews).
- **Besucher** (new) — a privacy-clean analytics dashboard showing how popular,
  frequented, and temporally active the public site is, and which features visitors
  actually use.

Audience: site admins / editors (the panel is edit-mode only). Purpose: an at-a-glance
overview of reach, popularity, and trends over time. No external visitor ever sees this.
The whole feature is built as a self-contained module behind a single kill-switch flag,
and surfaces its own storage footprint (see §10).

## 2. Privacy model (the binding constraint)

Fully anonymous, aggregate-only. No personal data at rest, no cookies, no fingerprinting,
no consent banner required.

- Every metric is stored as an **aggregate counter**, never a per-visitor row.
- **Unique visitors per day** are counted via an **ephemeral, daily-rotating salted
  hash** of `(IP + User-Agent + daily salt)`, used only to deduplicate within the day,
  then discarded. The rotating salt + nightly discard make a visitor un-linkable across
  days — no cross-session profile is ever built.
- Guardrails:
  - **Referrer** is reduced to a source category / domain (`google.com`, `reddit.com`,
    `direkt`) — never the full URL with path or query string.
  - **Route waypoints** are stored as place **names** (public Aventurien locations);
    unnamed map clicks become a generic `Kartenpunkt`, never coordinates.
  - **Search terms** are stored as aggregate counts of the typed string (public
    place-name searches). Per-item lists (searches, routes) are **only displayed above
    a small count threshold** so a single rare/unusual entry is never surfaced alone.
  - The **actor_type split** keeps the editors' own traffic out of the visitor figures.

## 3. UI structure

The "Status" panel tab gets a sub-tab nav `[ Editoren ] [ Besucher ]`, reusing the same
button-toggles-section mechanism as the WikiSync panel for consistency.

- **Editoren** (default): the current presence list (unchanged) + the compact
  editor-activity figures from §1.
- **Besucher**: a single **narrow, scrollable column** (the panel is a sidebar —
  narrower than the brainstorm mockup, which was deliberately a bit wider; the
  single-column layout must hold at the real, smaller width). Order, top to bottom:
  1. **Time-range switcher** (7 d / 30 d / 12 m / all) — affects every widget below.
  2. **3 KPI tiles** with trend vs. the previous period (default: Aufrufe, Eindeutige, Routen).
  3. **Activity line** — Aufrufe + Eindeutige over time (hero).
  4. **Heatmap** — hour × weekday (the day/night rhythm).
  5. **Top-Suchbegriffe** — bar list.
  6. **Herkunft** — traffic sources, bar list.
  7. **Geräte** + **Kartenansicht** — two small donuts side by side.
  8. **Beliebteste Routen** — bar list.
  9. **Letzte Aktivität** — recent reports/reviews feed, each entry tagged visitor/editor.
  10. **Speicher** — a small card showing the live size + row counts of the analytics
      tables (see §10), so the "stays tiny" claim is verifiable at a glance.

  Secondary metrics (transport modes, route options, language, display toggles) live in
  an expandable "mehr" section rather than as permanent top-level cards. When the module
  is switched off (§10), the Besucher tab shows a short "ausgeschaltet" state instead.

## 4. Data model

Two tables, created via self-healing inline DDL (project pattern). No foreign-key
constraints, `utf8mb4`.

`visitor_metric` (permanent — the long-term memory):

| column | purpose |
|---|---|
| `day` DATE, `hour` TINYINT NULL | time bucket; `hour` is filled only for the core traffic metrics (for the heatmap), dimension-heavy metrics are day-only to stay lean |
| `actor_type` ENUM('visitor','editor') | the split |
| `metric` VARCHAR | what (see §5) |
| `dimension` VARCHAR | the value (place name, mode, source, …); empty for dimensionless metrics |
| `count` INT UNSIGNED | the counter |

`UNIQUE(day, hour, actor_type, metric, dimension)` → `INSERT … ON DUPLICATE KEY UPDATE
count = count + 1`. Tiny, no PII; weeks / months / years are a `SUM … GROUP BY` on read.

`visitor_daily_seen` (ephemeral — same-day dedup only):

| column | purpose |
|---|---|
| `day` DATE, `visitor_hash` CHAR(64) | the ephemeral daily-unique hash |

`UNIQUE(day, visitor_hash)`. Purged lazily: on the first event of a new day,
`DELETE WHERE day < CURRENT_DATE`. No cron needed.

Recent reports / reviews come straight from the existing `location_reports` /
`map_reviews` tables — no new storage.

## 5. Event taxonomy (`metric` values)

| metric | dimension | covers |
|---|---|---|
| `pageview` / `map_load` | – | reach (hourly) |
| `unique` | – | unique visitors per day (via the dedup hash) |
| `search` | search term | spotlight searches |
| `route` | "Start → Ziel" | popular routes (endpoints only for multi-stop) |
| `route_waypoint` | place name | popular origins / destinations |
| `transport` | travel mode | which transport modes are used |
| `route_option` | fastest / shortest / allowed surfaces | route options |
| `map_mode` | Derographie / Politisch / Kraftlinien / Nur Karte | which map view (`mapLayerModeSelect`) |
| `display_toggle` | toggle name + on/off | settlement / label / marker toggles (`display-options__row`) |
| `referrer` | source domain / category | how visitors arrived |
| `device` | mobil / desktop / tablet | device class (from User-Agent, server-side) |
| `language` | de / en / … | `Accept-Language`, server-side |

Adding a metric later = a new `metric` value, no schema change.

## 6. Collection

A single lightweight, **batched tracking beacon**.

- The frontend collects anonymous events into a small in-memory queue and flushes them
  via `navigator.sendBeacon` to `POST /api/app/track.php` (a) periodically and (b) on
  page-hide. Typically ~1 request per session → minimal STRATO load.
- The endpoint derives `actor_type` (authenticated editor session / edit mode → editor,
  else visitor), computes the ephemeral daily-unique hash, reduces the referrer to a
  source, derives device + language from the request, and UPSERTs the counters.
- Client capture points: page / map load; spotlight search (term); route planned
  (waypoint names, from→to, transport, route options); `map_mode` change;
  `display_toggle` change.
- The `map-features.php` read is the de-facto "visit" signal, but the beacon is the
  primary path: it captures client-only context and fires whether routing ran client- or
  server-side.

## 7. Read API & aggregation

A read action (new, e.g. `GET /api/app/visitor-metrics.php` or an action on an existing
app endpoint) returns the aggregated series for a requested range + actor_type, computed
by `SUM … GROUP BY` over `visitor_metric`. The recent-activity feed reads
`location_reports` / `map_reviews`. Auth: consistent with the panel being edit-only.

## 8. Visualisation

Forms follow the data's job: line (trend), heatmap (hour×weekday grid), horizontal bars
(searches / sources / routes), donuts (device / map-view part-to-whole), KPI tiles
(headline numbers + trend), feed (recent activity). Per-item bar lists apply the §2
display threshold.

## 9. STRATO / performance

- Beacon is batched (`sendBeacon`, ~1 request per session) — never a per-event request,
  never a loop on a heavy endpoint.
- UPSERTs are tiny and indexed; read aggregations run over a small table.
- `visitor_metric` stays small (only counts). Far-future option: down-sample old hourly
  rows to daily — not needed for years.

## 10. Module boundary, kill switch & storage visibility

**Treat it as a module.** All analytics code is isolated: its own collection endpoint
(`track.php`), its own tables (`visitor_metric`, `visitor_daily_seen`), its own read
endpoint, its own JS module, and the Besucher panel section — so it can be reasoned about,
disabled, or removed as one unit.

**Kill switch.** The whole feature is gated by a single server config flag (e.g.
`AVESMAPS_VISITOR_ANALYTICS_ENABLED` in `config.local.php` / the API config). When off:

- `track.php` no-ops immediately — no writes, no work.
- The flag is exposed to the client via the existing bootstrap/config, so the frontend
  stops sending beacons entirely.
- The read endpoint returns a "disabled" status; the **Besucher** sub-tab shows a short
  "ausgeschaltet" state instead of charts.
- The **Editoren** sub-tab (presence) is unaffected.

Flipping it is a single config edit — no code change, no deploy. This is the STRATO /
privacy escape hatch: one switch takes the feature fully dark (no collection, nothing
shown).

**Storage visibility.** The Besucher tab's "Speicher" card reads, on panel load, the live
size and row counts of the analytics tables from `information_schema.TABLES`
(`data_length + index_length` for `visitor_metric` + `visitor_daily_seen`), plus the total
database size for context. A cheap metadata query that makes growth visible and surfaces
anything unexpected early — the verifiable counterpart to the "stays tiny" claim in §9.

## 11. Non-goals (YAGNI)

- No raw event log, no per-visitor rows, no cookies, no cross-day identity.
- No external analytics tool (Plausible/Matomo).
- No real-time live counter (the panel loads on demand).
- No geographic / country breakdown (needs geo-IP → outside the chosen privacy model).
- No funnels or A/B testing.

## 12. Open items for the implementation plan

- Enumerate the exact `display-options` toggles to track (markers, labels, settlement
  toggles, …) by reading the controls in `index.html`.
- Decide the read endpoint URL + auth (edit-only vs public read).
- Pick the display-threshold value (e.g. count ≥ 3) for the per-item lists.
- Confirm the "route planned" hook point in the route engine and the `display_toggle` /
  `map_mode` change hooks.
- Confirm the daily-salt source + rotation for the unique hash.
- Decide the kill-switch flag name + home (`config.local.php` constant vs a DB setting),
  and how it reaches the client (bootstrap/config payload).
- Decide whether the "Speicher" card shows only the two analytics tables or also the whole
  database size, and the unit/precision (KB/MB, thousands separator).
