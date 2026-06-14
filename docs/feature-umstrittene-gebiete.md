# Feature: Umstrittene Gebiete (hatching for multiple claimants)

**Status:** CONCEPT · Phase 0 (rendering spike)
**Last updated:** 2026-06-11

---

## Goal (what we want)
A territory has an **owner** (= existing assignment / parent chain). On top of that, **other Reiche can
raise claims** on the same territory (recorded in wiki-aventurica). Such a territory is **"umstritten"**
(contested) and should be rendered as **diagonal Schraffur** that **alternates between the colors of all
claiming Reiche**.

Operation:
- Add/remove parties to a conflict **only in the Territoriums-Editor** (dropdown/picker; any node from the
  list). With the first additional party the territory automatically becomes "umstritten", with the last one
  removed it becomes normal again.
- The **quick list** in the editor panel does **NOT** support this (it stays pure drag&drop onto a territory).
- **WikiSync & editor** of the Herrschaftsgebiete should **not be significantly affected** by this — except
  where they need to know (above all, applying the model must not delete claims; optionally a wiki import of
  the claims).

## Proposed architecture (3 cleanly separated layers)
Guiding principle: **do not touch the existing ownership model and WikiSync** — claims are purely additive.

1. **Data — its own table, ownership untouched**
   `political_territory_claim`: `territory_id`, `claimant_territory_id` *or* `claimant_wiki_key`,
   `sort_order` (stripe order), `source` (`manual`/`wiki`), `is_active`, audit fields.
   The **owner** remains the normal assignment. **"Umstritten" is derived** (has ≥1 active claim) —
   no extra status that has to be kept in sync.

2. **Rendering — its own Canvas overlay (recommended), do NOT touch the SVG fills**
   Territory fills are SVG `L.polygon` today. SVG pattern fills for Schraffur are fiddly in Leaflet
   (setStyle sets a color instead of a pattern; gone on re-render). Cleaner: a new Canvas overlay (like the
   boundary/path-label overlay) draws diagonal stripes only for the **few contested** territories, rotating
   through the claim colors (including the owner), clipped to the polygon. Full control (N colors, stripe
   width, angle), independent of the fill, performant (contested = the exception, not 577 territories).

3. **UI — "Konfliktpartei" block in the Territoriums-Editor**
   Only when the territory is assigned: an "Umstritten mit …" section with a picker (any node) + a list of the
   parties with a color swatch and "✕ remove". No separate "status first" step.

## Confirmed specification (2026-06-11, spike accepted)
- **Stripe colors = `territory.color`** of the claimants → a claimant must be a **real territory** (with a
  color).
- **Stripe width 20px, angle 45°** (values from the spike).
- **Opacity per stripe = `territory.opacity`** of the respective node (each party with its own transparency).
- **Boundary rendering stays unchanged** — the Schraffur is its **own** overlay; the boundary overlay is NOT
  touched.

## Render decision: Option A — cut out the fill (confirmed 2026-06-12)
The contested territory is **cut out of the fill** (transparent window); the Schraffur draws there over the
**base map image** (not over the Reich color → no mush). **Feasible as a pure render cut without a geometry
operation**, because the layer (`territories-layer.php:240-279`) draws every source geometry individually at
EVERY zoom level (at low zoom only **recolored** onto the ancestor; its own `geometry_public_id` → no dedup,
lines 827-829). The "solid Reich area" is therefore N same-colored neighbor polygons — we just set the polygon
of the contested territory to `fillOpacity:0`. **The boundary line stays untouched** (its own Canvas overlay,
reads derived data). The overlay detects the territory at low zoom via
`aggregate_source_territory_public_id`.
- Rejected: Option B (just layer on top) → base × Reich fill × stripes = muddy mixed colors.

## Open decisions / risks (still open)
- **Owner as a stripe?** Assumption: yes — the owner claims it too, its color is one of the stripes.
  (confirm finally)
- **Wiki import** of the claims from wiki-aventurica = **its own, later phase** (manual first, then import).

## Existing conflict data from WikiSync (investigation 2026-06-12)
**Finding:** the wiki crawl **already** extracts claims — no new source needed.
- Backend: `avesmapsWikiSyncMonitorParseAffiliation` (sync-monitor.php:962) pulls "claimed by …" clauses +
  competing parent clauses out of the `Staat` field as `conflicts[]`. Stored in the staging column
  `parent_conflict_json` (array `{name, wiki_key, resolved}`), delivered to the editor as `node.conflicts`
  (names only, free text) + `node.has_conflict` (filter "Konflikte (platziert)").
- **But noisy:** of 1392 nodes, 49 are marked as conflicts (47 placed), of which only **22 territories with a
  clean, resolvable claim** (claimant name matches an existing territory → has a color). The rest is template
  junk (`wid|Angbar`, `ex|1022 bis 1028 BF`), status words ("Landstadt") or time/history clauses ("last
  Königreich Albernia", "presumably …").
- **Clean examples:** Beyrounat Al'Rabat → Emirat Adamantija; Baronie Gadang/Gorbingen/Hengefeldt →
  Markgrafschaft Perricum; Bergfreischaft Ilderasch/Kibrom/Olrong → Bergkönigreich Lorgolosch;
  Emirat Korushan/Adamantija → Sultanat Khunchom. ~10 distinct claimant Reiche.

**Consequence for the data model:**
- A claimant needs a **color** → it must resolve to a **`political_territory`** (`claimant_territory_id`). The
  wiki name is only a seed/suggestion, not directly renderable.
- **No auto-import** of the 49 raw conflicts (too much junk). Instead: the wiki `conflicts` entry is shown in
  the editor picker as a **suggestion** ("Wiki says: Markgrafschaft Perricum — apply?"), the user confirms →
  clean manual claim. Fits "be careful with suggestions".

## Phases & progress
- [x] **Phase 0 — rendering spike** ACCEPTED: look confirmed (20px / 45° / fully alternating; colors +
  opacity from the territory). → `docs/spikes/umstrittene-gebiete-schraffur-spike.html`
- [x] **Phase 1b — Canvas overlay** BUILT + PROVEN LIVE: `js/map-features/map-features-contested-hatch-overlay.js`
  (included in index.html). Standalone/additive, boundaries + SVG areas untouched, HiDPI, zoom/pan redraw.
  Data source: `feature.properties.contestedParties` (Phase 1a) **or** `window.__avesmapsContestedClaims[territory_public_id]`
  (test). Verified live on Herzogtum Tobrien (red/blue/yellow, cleanly clipped, neighbors/boundaries
  untouched).
- [x] **Phase 1a — data + endpoints**: table `political_territory_claim` **CREATED** (lazy-ensure in
  `api/_internal/political/territory.php` + canonically in `sql/political-territories.sql`). Only `territory_id`
  + `claimant_territory_id` (+ sort_order/source/claimant_wiki_key/is_active/audit) — **no** FK to
  geometry/boundaries (both derived from `territory_id`), house convention: plain index + soft delete.
  **Endpoints** (module `territories-claims.php`, dispatched in the main endpoint): `list_claims` (GET, public),
  `add_claim`/`remove_claim` (POST, edit cap, idempotent). The **layer** attaches `contestedParties`
  `[{color,opacity},…]` (owner first + claimants by sort_order), low zoom via
  `aggregate_source_territory_public_id`, both read paths. Auto cache invalidation after a write.
- [x] **Overlay cut (Option A)** BUILT + VERIFIED LIVE: cut the contested territory out of the SVG fill
  (`fillOpacity:0` in `buildRegionPolygonStyle` via `isRegionContested`; `contestedParties` passed through in
  normalization). Schraffur over the base map, `fill:true` → clickable, boundaries untouched.
- [x] **Infobox row "Umstritten mit …"** (claimant names + color swatch; the layer delivers names per party;
  `createRegionContestedRow`). Live: "Umstritten mit Mark Drachenstein", swatch `#60ae75`.
- [x] **Hover leaves the Schraffur in place**: the white hover wash (pane 355 > Schraffur 300) would have
  covered it. The territory's own layer is already safe (the fallback skips `fillOpacity:0`); aggregate layer:
  contested fragments are punched out as holes (point-in-ring) from the hover polygon. Live:
  `hoverWhitePolygons:0` on Ebersberg.
- [x] **R1 / Phase 1c — editor "Konfliktpartei" block** BUILT + DEPLOYED: "Umstritten mit" block in the editor
  panel (`renderContestedBlock` in `territory-editor-embedded.js` + section in `political-territory-editor.html`,
  ASSET_VERSION 20260612a). List of claimants (swatch+name+✕) + search picker over `allRows`. Addresses the
  territory via the `wiki_key` of the node. **Bug fixed:** the resolver did not find a territory by wiki_key
  (it stripped "wiki:", the DB stores WITH the prefix) → now prefix-robust against `political_territory.wiki_key`
  + the wiki table (verified: list_claims("wiki:baronie-ebersberg") → Mark Drachenstein). **Open/behavior:**
  the block follows the ACTIVE breadcrumb node (default = root Reich, not the leaf) — user decision pending
  (leave it = consistent with color/zoom · OR always target the geometry leaf).
- [x] **"Suggest from Wiki"** BUILT + LIVE: endpoint `suggest_claims` reads the `parent_conflict_json` (WikiSync
  model `wiki_territory_model`) of the territory, resolves the conflict parties to real territories (by wiki_key,
  fallback exact name) → only what is resolvable (parse junk filters itself out); already-set claims hidden.
  The editor button lists finds with "Add" (add_claim, source=wiki). Verified: Baronie Gadang → "Markgrafschaft
  Perricum". Edge: individual territories with an incomplete wiki_key link do not resolve (e.g. Bergfreischaft
  Ilderasch).
- [x] **R2 — WikiSync button** "⚔ in the editor" BUILT + backend verified: nodes in "Konflikte (platziert)" with
  `has_conflict && map_geometry_count>0` (green dot) get the button. Click → `editor_open_target` (new
  endpoint: wiki_key → territory + first active geometry; the editor needs the geometry_public_id to load) →
  hide the WikiSync overlay → `window.parent.AvesmapsPoliticalTerritoryEditorLink.open(...)`. Topology verified:
  the monitor is a child iframe of the map iframe (loads index.html with both). Endpoint verified (Ebersberg/Gadang
  → geometry). Open: click test in the live UI. Wiki conflicts are always visible in the list anyway (filter).
- [x] **Conflict parser A,B,C,E** BUILT + tested locally (`avesmapsWikiSyncMonitorParseAffiliation` in
  sync-monitor.php): A=parenthetical `(beansprucht von X)` claims (~31 previously swallowed), B=filter
  template/date junk (`wid|`/`ex|`/`evt|`/`22 BF` via `IsConflictJunk`), C=strip prefixes + `sowie X und Y`
  split, E=`beansprucht von` mid-clause + comma list (Taifas). Validated against the wiki category (8/9 before,
  now 9/9). **Only takes effect on the next re-crawl / "derive hierarchy".**
- [x] **Conflict row clearer** (wiki-sync-monitor.html): the territory name (`.nm`) got a minimum width + bold +
  flex-wrap → the name is no longer squeezed by parent/conflict tags; `◆ X` → `strittig: X`.
- [ ] **R3 — bulk import** of all clean wiki conflicts at once (per-territory now possible via "Suggest from Wiki").
- [ ] **Phase 2 — WikiSync protection** (applying the model must not delete claims — the claims table is separate, should be safe; verify).

## Progress log
- **2026-06-11:** concept recorded (this file). Rendering spike created as a standalone mini-HTML
  (Canvas Schraffur, N colors, stripe width/angle/opacity, neighbor context).
- **2026-06-11 (2):** spike accepted. Confirmed: stripe colors = `territory.color`, width **20px**,
  angle **45°**, opacity = `territory.opacity`, **boundaries untouched** (its own overlay). → ready for
  Phase 1.
- **2026-06-11 (3):** **Phase 1b built + proven live.** Overlay `map-features-contested-hatch-overlay.js`
  (commit 3c2d360f) + included in index.html. Verified live on Herzogtum Tobrien via a test override
  (`window.__avesmapsContestedClaims`): diagonal Schraffur (20px/45°, 3 party colors), cleanly clipped to the
  polygon, neighbors + boundaries untouched, semi-transparent. → next step: Phase 1a (data/endpoints, CREATE
  TABLE needs user OK).
