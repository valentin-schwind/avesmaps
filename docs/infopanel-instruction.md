# Infopanel — Design & Implementierungs-Instruction

> Ziel-Feature: Die Inhalte der schwebenden Karten-Infoboxen wandern in ein
> einklappbares Panel am **rechten** Kartenrand (dort, wo im Edit-Mode der
> Editor sitzt). Erprobung hinter **`?infopanel=true`**; der bestehende
> Popup-Zustand bleibt **unangetastet**, bis das Feature vollständig steht.
> Danach (eigene, spätere Phase) werden die Popup-Inhalte auf ein Minimum
> reduziert.

Mockup abgenommen (Session 2026-07-10). Sprache: Doc + Chat Deutsch, Code /
Commits / interne API-Messages Englisch, App-UI Deutsch.

---

## 1. Festgezurrte Entscheidungen

1. **Flag:** `?infopanel=true` → neues Global `IS_INFOPANEL_MODE`, unabhängig von
   `?edit=1`. Ohne Flag ändert sich **nichts**.
2. **Panel rechts**, Einklapp-Mechanik **wie das Editor-Panel** (`#review-panel`:
   `.is-hidden` + `transform: translateX(100%)` + vertikaler Rand-Tab). Rand-Tab
   heißt **„Info"**, um 180° gedreht, runde Ecken außen. **Kein X-Symbol.**
3. **Inhalt = bestehende Info-Builder** (Siedlung/Weg/Fluss/Region/Territorium)
   **unverändert** — sie liefern bereits fertige HTML-Strings der
   `.region-info-box`/`.location-popup`-Familie. Kein Neubau der Inhalte.
4. **Persistenz:** Klick auf die **leere Karte schließt das Panel NICHT**. Nur ein
   Klick auf ein **anderes Info-Feature** tauscht den Inhalt. Eingeklappt + Klick
   auf ein Info-Feature → Panel **klappt automatisch auf**.
5. **Zoom** (`L.control.zoom`) → **unten rechts, verkleinert**; **„Hinweise"**
   (`#legal-button`, unten rechts) bleibt sichtbar. Das Panel endet **oberhalb**
   dieses Kontroll-Stapels → weder Zoom noch Hinweise werden je verdeckt.
6. **Wegpunkt-Tabs** oben im Panel (aus `getWaypointInputValues()`); aktiver Tab =
   zuletzt geklicktes Feature. **In v1** enthalten.
7. **Edit-Mode:** Infopanel **und** Editor als **zwei getrennt einklappbare
   Rand-Panels** nebeneinander rechts (Infopanel links vom Editor). Letzte Phase,
   damit die öffentliche Karte zuerst live geht.
8. **Ein durchgehender Scrollbalken** über die ganze Info-Spalte (Panel-Body
   scrollt; die kürzlich in `css/features/location-reviews.css` ergänzte
   Bewertungs-`max-height` wird im Panel-Modus **überschrieben**). Kopf +
   Wegpunkt-Tabs bleiben stehen. **„Bewertung schreiben"** sitzt **unten** bei den
   Bewertungen (nicht in der oberen Aktionszeile).
9. **„Abenteuer in Gareth"** (sortierbar, mit „mehr"-Button) = **späterer
   Daten-Schritt** (Phase 6). Im Panel-Kern zunächst nicht enthalten; im Mockup
   nur Platzhalter.

---

## 2. Architektur-Anker (Ist-Zustand)

Alle Info-Builder liefern **HTML-Strings** → direkt in den Panel-Body einspeisbar.

| Zweck | Datei / Anker |
|---|---|
| Flag definieren | `js/config.js:180` (`IS_EDIT_MODE`-Muster) |
| **Siedlung** Builder | `buildLocationMarkerPopupHtml()` `js/map-features/map-features-location-marker-entry.js:8` |
| Siedlung Öffnen (programmatisch) | `openLocationPopupForMarkerEntry()` `js/map-features/map-features-location-lookup.js:127` |
| Siedlung Klick-Arbiter (Canvas) | `AvesmapsLocationCanvasLayer._tryOpenAtContainerPoint()` `js/map-features/map-features-location-canvas-layer.js:202` → `openPopup()` `:244`; global `window.avesmapsTryOpenLocationAtContainerPoint` `:55` |
| **Bewertungen** nachladen | `hydrateLocationReviews(slotEl)` `js/community/location-reviews.js`; Slot `.location-reviews[data-reviews-public-id]` |
| **Weg/Fluss** Builder + Öffnen | `createPathPopupMarkup()` `js/map-features/map-features-path-rendering.js:48`; `path._popupMarkup`/`_popupOptions` (`refreshPathLayerPopup` `:188`); Klick öffnet `L.popup(...).openOn(map)` `:273` |
| **Region/Territorium** Builder + Öffnen | `createRegionCompactTooltipMarkup()` `js/map-features/map-features-region-info-markup.js:20`; `openRegionCompactTooltip()` `js/map-features/map-features-region-tooltip-lifecycle.js:50`; async Anreicherung `enrichRegionTooltipWithWikiDetail()` `:302` via `/api/app/territory-detail.php` |
| Weg-Label-Klick (öffnet auch Weg-Popup) | `js/map-features/map-features-path-label-canvas-overlay.js:531` |
| **Editor-Panel** (Vorlage) | `#review-panel`/`.review-panel` `index.html:281`; CSS `css/features/review-panel.css:6` (Body), `:23` (`.is-hidden`), `:61` (Rand-Tab); Toggle `toggleReviewPanel()`/`syncReviewPanelVisibility()` `js/review/review-panels.js:97`/`:91` |
| Routenplaner (links) | `#search` `index.html:1120`; CSS `css/layout/map-layout.css:11`; Toggle `js/ui/route-planner-toggle.js:176` |
| **Zoom-Control** | `L.control.zoom({ position: "topright" })` `js/app/bootstrap.js:45`; CSS `.leaflet-control-zoom` |
| **Hinweise** | `#legal-button` `index.html:1263`; CSS `css/components/legal-dialog.css:99` (`right:12; bottom:12`) |
| **Wegpunkte lesen** | `getWaypointInputValues()` `js/map-features/map-features-waypoints.js:396`; DOM `#waypoints` `index.html:1183` |
| z-Index | `--z-map-ui = 1000` (`tokens.css`); Editor-Panel `z-index:1100` |
| Load-Order | Neues JS **nach** `bootstrap.js` (`index.html` ~1460), wie `route-planner-toggle.js` `:1463`. Neues CSS: `@import` in `css/styles.css` (~Z.31). |

**Asset-Caching:** JS/CSS aus `index.html` werden beim Deploy automatisch mit
`?v=` gestempelt; `index.html` selbst bleibt ungestempelt → nach jedem Deploy
**einmal hart neuladen**.

---

## 3. Layout- & Verhaltens-Spezifikation

- **Panel:** `position: fixed; top: 10px; right: 0;` Breite `min(340px,
  calc(100vw - 64px))`, `z-index` unter dem Editor-Panel (z.B. 1080; Editor 1100).
  Unterkante **oberhalb** des Zoom-/Hinweise-Stapels (siehe Zoom).
  Einklappen: `.is-hidden { transform: translateX(100%) }` + Rand-Tab `.is-hidden { right: 0 }`.
- **Rand-Tab „Info":** vertikal, an der **linken** Kante des Panels, runde Ecken
  außen, ohne `rotate(180deg)` (siehe Mockup). Klick = ein-/ausklappen. Zustand in
  `localStorage` (eigener Key, analog Editor), damit die Wahl erhalten bleibt.
- **Panel-Body:** `display:flex; flex-direction:column`. **Wegpunkt-Tabs** als
  sticky Kopf; darunter **ein** scrollender Bereich (`flex:1; overflow-y:auto`).
- **Inhalts-Reihenfolge** (aus dem Builder-HTML, ggf. per Wrapper zusammengesetzt):
  Kopf (Wappen/Icon + Name + Typ) → Attribute → Quelle/Publikationen → Aktionen
  (**ohne** „Bewertung schreiben") → *(Phase 6: Abenteuer)* → Bewertungen (Schnitt
  + Liste) → **„Bewertung schreiben"** unten.
- **Zoom neu:** `L.control.zoom({ position: "bottomright" })`; per CSS verkleinern
  (Buttons ~28px). „Hinweise" bleibt `right:12; bottom:12`; Zoom **darüber**
  stapeln (`right:12; bottom:~52`). Panel-Unterkante so setzen, dass sie über
  diesem Stapel endet (`bottom` groß genug, z.B. ~`96px`; final beim Bau prüfen).
- **Klick-Routing:** In den Öffnungspunkten (Siedlung/Weg/Region) gilt:
  `if (IS_INFOPANEL_MODE) { avesmapsShowInfopanel(build…()); return; }` **vor** dem
  Öffnen des Popups/Tooltips → das schwebende Popup/Tooltip wird im Panel-Modus
  **unterdrückt**.

---

## 4. Umsetzung — Phasen mit Deploy-Checkpoints

> Prinzip: kleine, verifizierte Commits direkt auf `master`; jede Phase endet mit
> einem Deploy + Sicht-Check hinter `?infopanel=true`. Ohne Flag darf sich nie
> etwas ändern.

### Phase 0 — Gerüst & Flag (kein Verhaltenswechsel)
- `js/config.js`: `const IS_INFOPANEL_MODE = INITIAL_SEARCH_PARAMS.get("infopanel") === "true";`
- **Neu** `js/map-features/map-features-infopanel.js`: baut (nur wenn
  `IS_INFOPANEL_MODE`) das Panel-DOM + Rand-Tab, implementiert Einklappen
  (`toggleInfopanel`, `localStorage`), exportiert `window.avesmapsShowInfopanel(html, opts)`
  und `window.avesmapsInfopanelExpand()`. Panel startet leer/eingeklappt.
- **Neu** `css/features/infopanel.css`: Panel, Rand-Tab, Wegpunkt-Tabs,
  Sortier-Zeile — visuell an `review-panel.css` + Mockup angelehnt. `@import` in
  `css/styles.css`.
- `index.html`: `<script src="js/map-features/map-features-infopanel.js"></script>`
  **nach** `bootstrap.js`.
- **Deploy-Check:** mit `?infopanel=true` erscheint das leere Panel-Gerüst + Tab
  „Info"; ohne Flag ist nichts verändert.

### Phase 1 — Inhalt einspeisen (Siedlung → Weg → Region/Territorium)
- **Siedlung:** im Canvas-Arbiter (`_tryOpenAtContainerPoint`) bzw.
  `openLocationPopupForMarkerEntry`: bei `IS_INFOPANEL_MODE`
  `buildLocationMarkerPopupHtml(entry)` in `avesmapsShowInfopanel` schieben, danach
  `hydrateLocationReviews` auf dem Panel-Slot `.location-reviews` aufrufen;
  `openPopup()` überspringen.
- **Weg/Fluss:** im Klick-Handler (`path-rendering.js:273`) und im
  Weg-Label-Handler (`path-label-canvas-overlay.js:531`) analog `path._popupMarkup`
  ins Panel statt `L.popup().openOn(map)`.
- **Region/Territorium:** in `openRegionCompactTooltip` analog
  `createRegionCompactTooltipMarkup` ins Panel; async Anreicherung
  (`territory-detail.php`) auf den Panel-Inhalt anwenden.
- **Deploy-Check:** Klick auf Siedlung/Weg/Region füllt das Panel; Bewertungen
  laden; **kein** schwebendes Popup/Tooltip mehr im Panel-Modus.

### Phase 2 — Persistenz & Auto-Aufklappen
- Leerer Karten-Klick lässt Panel-Inhalt **stehen** (nicht leeren/schließen).
- `avesmapsShowInfopanel` ruft `avesmapsInfopanelExpand()`, wenn eingeklappt.
- **Deploy-Check:** Panel bleibt bei Leerklick; klappt bei Feature-Klick auf.

### Phase 3 — Zoom + Hinweise-Layout
- Zoom `position: "bottomright"` + CSS-Verkleinerung; Hinweise bleibt; Stapel
  unten rechts. Panel-Unterkante über dem Stapel.
- **Deploy-Check:** keine Überlappung von Panel/Zoom/Hinweise; Zoom funktioniert.

### Phase 4 — Wegpunkt-Tabs
- Tabs aus `getWaypointInputValues()`; aktiver Tab = geklicktes Feature; Klick auf
  einen Wegpunkt-Tab öffnet dessen Info im Panel (Name → Marker-Entry → Builder).
  Nicht-Wegpunkt-Feature = transienter aktiver Inhalt (kein bleibender Tab).
  Tabs bei Wegpunkt-Änderung aktualisieren.
- **Deploy-Check:** Tabs spiegeln die Wegpunkte; Umschalten funktioniert.

### Phase 5 — Edit-Mode-Koexistenz (zwei Panels)
- Infopanel links neben dem Editor-Panel platzieren (eigener `right`-Offset), beide
  unabhängig einklappbar, Rand-Tabs gestapelt. Nur relevant bei `?edit=1 &
  ?infopanel=true`.
- **Deploy-Check:** beide Panels nebeneinander bedienbar, keine Überlappung.

### Phase 6 — „Abenteuer in Gareth" (Daten, später)
- Datenquelle je Ort (Wiki `…/Ort/Abenteuer`), analog zum Publikations-Lookup.
  Abschnitt mit Sortierung (neueste/Art/alphabetisch) + „mehr"-Button. Bis zur
  Datenanbindung Platzhalter.

### Danach (eigener Owner-Schritt, NICHT Teil dieses Plans)
- Reduktion der schwebenden Popup-Inhalte auf ein Minimum, sobald das Panel steht.

---

## 5. Reuse statt Neubau (Checkliste)
- Einklapp-Mechanik: `review-panel.css` (`.is-hidden`/Rand-Tab) + `toggleReviewPanel`-Muster.
- Inhalte: die vier bestehenden Builder + `hydrateLocationReviews` unverändert.
- Tab-Optik: `.review-panel__tabs`/`setEditorPanelTab`-Muster.
- Klick-Eintritt: der eine Arbiter `avesmapsTryOpenLocationAtContainerPoint` + die
  drei defer-Handler (Weg/Region/Weg-Label).

## 6. Nicht-Ziele / Risiken
- Keine Änderung am Popup-Verhalten **ohne** Flag.
- Keine Prod-DB-Writes; keine teuren STRATO-Endpoints in Schleifen.
- Zwei rechte Panels (Phase 5) sind auf schmalen Screens eng — bewusst letzte
  Phase, damit die öffentliche Karte zuerst sauber live ist.
