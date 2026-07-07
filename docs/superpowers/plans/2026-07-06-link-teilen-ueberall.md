# „Link teilen" überall: Wege, Fluss-/Weg-Namen, Herrschaftsgebiete — Plan

> Owner-Auftrag 2026-07-06: Straßen-Popups haben keinen Link-teilen; Flüsse sind bewusst
> nicht als Vektoren gerendert (Basiskarte zeigt sie) und brauchen Klick über ihre
> NAMENS-Labels; die politische Infobox hat keinen Link-teilen. Alles nutzt die
> Task-13-Bausteine (`buildPlaceShareLink`/`buildShareLinkPath` + Share-Button-Markup)
> und die dokumentierten Deep-Link-Params.

## Teil A — Wege-Popup (Task 15a)

- `createPathPopupMarkup(path)` (js/map-features/map-features-path-rendering.js, beim
  Popup-Markup): wenn `pathHasWiki(path)` → Teilen-Leiste ergänzen (Muster der
  Location-Popups aus Task 13), `wikiUrl = path.properties.wiki_path.wiki_url`,
  `wikiParam` nach Subtyp: `Flussweg`/`Seeweg` → `fluss`, sonst `strasse`.
- KEIN `?place=`-Fallback (applyPlaceFocusFromUrl löst keine Wege auf) → Button nur bei
  Wiki-Link. Unverlinkte Wege bleiben wie bisher (Community-TODO deckt das).
- Klick-Schiedsrichter/Popup-Öffnung NICHT anfassen (docs/click-arbiter-coordination.md).

## Teil C — Politische/Regions-Infobox (Task 15b, gleicher Task wie A)

- js/map-features/map-features-region-info-markup.js: `wikiUrl` existiert dort bereits
  (Zeilen ~60/83). Teilen-Leiste ergänzen; `wikiParam`-Wahl über den Entry-Typ:
  politisches Territorium → `staat`, Landschafts-Region → `region` (Diskriminator im
  Entry prüfen, z. B. feature_subtype/kind; Implementer verifiziert am Code).
- Nur bei vorhandener wikiUrl; kein UUID-Fallback nötig (?place= löst Regionen via
  focusRegionPlace — optionaler Fallback ERLAUBT, wenn public_id vorhanden und der
  Implementer die Auflösung verifiziert; sonst weglassen).

## Teil B — Klickbare Way-Labels (Task 16)

- Canvas-Overlay (js/map-features/map-features-path-label-canvas-overlay.js, Kanal A):
  je redraw ein Placement-Register aufbauen: `{rect (container-px, leicht gepolstert),
  wikiKey, name, wikiUrl, anchorLatLng}` pro gezeichnetem Way-Label (Daten stammen aus
  der Gruppierung; wiki_url vom ersten Segment).
- Map-Klick-Handler (im Overlay registriert, NICHT top-level — map entsteht zuletzt):
  Containerpunkt gegen das Register testen (letztes Placement zuerst = oben gezeichnet).
  Treffer → kleines Leaflet-Popup am anchorLatLng: Wegname, „Wiki ↗" (wiki_url,
  target=_blank rel=noopener), Teilen-Leiste (`?strasse=`/`?fluss=` nach kind/Subtyp).
- Koordination mit dem Klick-Schiedsrichter: NUR auslösen, wenn kein anderes Feature den
  Klick beansprucht (Verhalten des bestehenden Arbiters lesen und respektieren; im
  Zweifel: Label-Hit nur, wenn der Klick sonst ins Leere ginge).
- Cursor-Feedback optional (mousemove-Hit → pointer) — nur wenn billig (throttled),
  sonst weglassen (Perf-Grundsatz: nichts pro Frame).
- Escape: `?waylabels=0` deaktiviert damit auch die Klickfläche (Register leer).
- Tests: Hit-Test-Helfer pure (`wayLabelHitTest(register, point)`) via extractFunction.

## Invarianten

- Keine neuen Vektor-Layer für Flüsse (Owner: bewusst nicht gerendert).
- Teilen-Links: RAW /wiki/-Segment verbatim (nie doppelt encoden) — Task-13-Builder nutzen.
- Deutsch im UI („🔗 Link teilen", „Wiki ↗"); TABS; classic scripts; keine Perf-Arbeit
  pro Frame; Commit auf master, Subagenten pushen nie.
- Adresszeile bleibt unangetastet (URL-Policy 2026-07-06).

## Verifikation

- A: Klick auf wiki-verlinkte Straße → Popup mit Teilen-Leiste; Kopie = `?strasse=<Page>`.
- B: Klick auf Fluss-NAMEN (z. B. „Letta") → Popup mit Name/Wiki/Teilen (`?fluss=Letta`);
  Klick auf Straßen-Label ebenso; `?waylabels=0` → keine Label-Klicks.
- C: Politische Infobox (z. B. Fürstentum Kosch) → Teilen kopiert `?staat=<Page>`;
  Landschaft → `?region=<Page>`.
- Suites grün (`tools/paths/*.mjs`), node --check, Live-Check nach Deploy.
