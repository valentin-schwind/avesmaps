# Instruction: Straßen-/Weg-Wiki-Zuweisung + Namenssystem reparieren & umbauen

> Selbstständige Instruction für eine **neue Claude-Code-Session** (Superpowers/SDD).
> Sie enthält den gesamten nötigen Kontext — die ausführende Session hat NICHT den
> Debug-Kontext, in dem diese Punkte gefunden wurden. Alle Anker sind live verifiziert
> (Chrome-Debug auf avesmaps.de) oder aus dem Code.

## 0. Projekt-Kurzkontext
Avesmaps (avesmaps.de) — vanilla-JS-Frontend + PHP/MySQL, Leaflet `L.CRS.Simple`
(Bildraum 0..1024), STRATO Shared Hosting, Windows/PowerShell-Dev, Deploy per Push
auf `master` (~1–2 min). Siehe `AGENTS.md`. **Wege/Straßen** sind `map_features`
mit `feature_type='path'`, in viele **Segmente** zerlegt (eine Straße = viele Segmente).

## 1. Historie der Straßennamen (Owner, WICHTIG fürs Verständnis)
Es gibt **drei übereinanderliegende, teils widersprüchliche** Namensebenen:
1. **Phase 1 — eindeutige Linien-Namen:** ursprünglich bekam jede Linie/jedes Segment
   einen **random-nummerierten** Namen, sodass **jedes Segment eindeutig** war →
   Feld **`name`** (z.B. `Reichsstrasse-2715`, `Reichsstrasse-2788` …).
2. **Phase 2 — Weg-Namenssystem:** später kam ein System dazu, das **Wegen** (Gruppen
   von Segmenten) einen Namen gab → Feld **`display_name`/`original_name`**
   (z.B. `Reichsstraße 1`). **Inkonsistent geschrieben**: dieselbe Straße erscheint als
   `Reichsstrasse-1`, `Reichsstrasse 1` UND `Reichsstraße 1`.
3. **Phase 3 — Wiki-Verlinkung:** dann sah man, dass ein paar Straßen **echte
   Wiki-Artikel** haben; diese wurden verlinkt → `properties.wiki_path.wiki_url`
   (z.B. `https://de.wiki-aventurica.de/wiki/Reichsstraße_1`). Diese Verlinkung speist
   den neuen Deep-Link `?strasse=` (siehe [[wiki-deeplink-by-pagename]] / `js/app/wiki-deeplink.js`).

## 2. Datenstruktur (live verifiziert, ~5078 Wege in `pathData`)
Attribute liegen in `feature.properties`:
- `name` — Phase-1, random-eindeutig (`Reichsstrasse-2715`).
- `display_name` / `original_name` — Phase-2 Weg-Name, **INKONSISTENT** (siehe oben).
- `feature_subtype` — z.B. `Reichsstrasse` (auch `Fluss`, `Strasse`, `Gebirgspass`, `Wüstenpfad`, `Flussweg`, `Seeweg` → `PATH_SUBTYPE_KEYS`).
- `wiki_path.wiki_url` — Phase-3 Wiki-Link. **Verlässlichste Quelle** für die Weg-Identität.
- `show_label` — ob das Label auf der Karte erscheint (nur EIN Segment pro Weg trägt es typ. `true`).
- `public_id`, `revision` — optimistic locking.

Beispiel (echte Reichsstraße-1-Segmente): 6 Segmente, alle `wiki_url=/wiki/Reichsstraße_1`,
aber `display_name` variiert (`Reichsstrasse-1` / `Reichsstrasse 1` / `Reichsstraße 1`),
`name` je random (`Reichsstrasse-2715/2788/2792/2798/…`). Reichsstraße 2 hat eigene 10 Segmente
(`/wiki/Reichsstraße_2`), darunter eines mit `display_name=Reichsstrasse-16`.

## 3. Aufgabe A — Deep-Link URL-Sprung (klein)
**Bug:** Ruft man `https://avesmaps.de/?strasse=Reichsstra%C3%9Fe_1` (analog `?siedlung=`
/`?staat=`/`?region=`/`?fluss=`) auf, wird das Objekt zwar korrekt fokussiert, aber die
**URL springt danach zurück** auf die Toggle-Parameter (`?toggleMetropolen=1&…&togglePaths=1`).
Das darf bei **keiner** der Link-Techniken passieren.
**Ursache (zu verifizieren):** `js/app/wiki-deeplink.js` liest den Param und die share-link-
Strip-Liste (`js/app/share-link.js`) entfernt ihn; danach schreibt der Planner-State-URL-Sync
(`syncPlannerStateToUrl` / `syncPlannerStateToUrl`-Aufrufe in `js/app/bootstrap.js` + dem
Routing-/Toggle-State) die Toggle-Params in die URL → sichtbarer „Sprung".
**Fix:** Nach der Deep-Link-Auflösung soll die URL **stabil** bleiben (kein sichtbarer
Sprung zu den Toggles). Entweder den Param entfernen, OHNE einen Planner-State-URL-Write
auszulösen, oder den Deep-Link-Fokus so einhängen, dass der nachfolgende State-Sync die URL
nicht überschreibt. Gilt für **alle 5 Params**. Kein Backend. `js/app/wiki-deeplink.js` +
ggf. `share-link.js`/`bootstrap.js`.

## 4. Aufgabe B — Straßen-Editor: Zuweisung + Namenssystem (Kern-Umbau)
Der Owner bereinigt die Weg-Daten, indem er Segmente den Wiki-Wegen **zuweist**. Dabei
treten mehrere Bugs auf, und das Namenssystem muss umgebaut werden.

### B1 — Zuweisen wirft 409 Conflict
Zuweisen eines Wiki-Wegs zu einem (oft noch nicht zugewiesenen) Segment scheitert häufig mit
**409 Conflict** → „Dieses Kartenobjekt wurde inzwischen geändert. Bitte neu laden."
Pfad: `js/review/review-editor-submit.js` `handlePathEditFormSubmit` (~:91) →
`js/app/api-client.js` `submitMapFeatureEdit` (~:100–115) → **PATCH** `api/edit/map/features.php`
(optimistic locking über `revision`; bumpt `map_revision`).
Begleitend sah man `net::ERR_CONNECTION_CLOSED` beim `sendEditorPresenceHeartbeat`
(`review-panels.js`) — Verdacht: der erste PATCH **geht durch** (Revision +1), aber die Antwort
geht im Verbindungsabbruch verloren; der Retry/zweite Klick sendet die alte `expected_revision`
→ 409. ABER: der Owner meldet **„jede menge" Fehler**, also nicht nur Einzelfall.
**Untersuchen:** Woher kommt die veraltete Revision? Kandidaten: (a) der Editor-State hält
nach dem Speichern die alte Revision (kein Refresh der `revision` aus der PATCH-Antwort);
(b) `avesmapsWikiPathAssign` (`api/_internal/wiki/paths.php` ~:747) stempelt beim Zuweisen
`wiki_path` auf **alle gleichnamigen Segmente** und bumpt so deren Revision, während der
Editor nur eines kennt; (c) ein paralleler Prozess/Heartbeat. **Ziel:** Zuweisen muss
zuverlässig speichern — optimistic-locking-Race schließen (Revision aus der Antwort
übernehmen, ggf. betroffene Nachbar-Segmente mit-aktualisieren, oder das Zuweisen so
gestalten, dass es nicht die eigene Revision unter sich wegzieht).

### B2 — Entfernen wirft dieselben Fehler
Entfernen der Wiki-Zuweisung eines Segments scheitert analog. Muss ebenfalls zuverlässig
speichern.

### B3 — Namensregel (der eigentliche Umbau)
Aktuell nimmt das Speichern beim Zuweisen den **eingetippten nativen Namen**, nicht den
zugewiesenen Wiki-Namen. Gewünschtes Verhalten (Owner-Regeln):
- **R1:** Hat ein Segment einen zugewiesenen Wiki-Weg (`wiki_path.wiki_url`), ist der
  **Wegname IMMER der Wiki-Weg-Name** (aus dem `/wiki/<Page>`-Segment, z.B. „Reichsstraße 1").
  Der **Auto-Name ist dann deaktiviert** — weder der Phase-1-Random-`name` noch ein manuell
  eingetippter Name überschreiben ihn, solange die Wiki-Zuweisung besteht.
- **R2:** Beim **Entfernen** der Wiki-Zuweisung verliert der Weg den Wiki-Namen und bekommt
  einen **generischen** Namen zurück — d.h. das ursprüngliche **Phase-1-Schema**
  (random-eindeutig, `<Subtype>-<n>`), NICHT weiter den Wiki-Straßennamen. (Owner: „darf nicht
  weiter den straßennamen [tragen], sondern einen der generischen".)
- **R3 (Constraint):** **„Weg anzeigen"** (`show_label`) bleibt **unabhängig** vom Namen
  weiter **im Editor steuerbar**. Der Namens-Umbau darf `show_label` nicht ankoppeln/brechen.

**Wichtige Namens-Falle (aus Deep-Link-Bug bestätigt):**
`getPathDisplayName` (`js/map-features/map-features-path-domain.js` ~:22) hat einen Fallback
`name.replace(/-\d+$/,"")`, der die **Endziffer strippt** → „Reichsstrasse-1" und „…-2"
kollabieren zu „reichsstrasse". Beim Umbau auf „Wiki-Name als Quelle" muss die Weg-Identität
an der `wiki_url` (bzw. dem exakten, nummern-sensitiven Namen) hängen, nicht am ziffern-
strippenden Anzeigenamen. (Der Deep-Link nutzt bereits `exactPathNameKey` in
`js/app/wiki-deeplink.js` — als Referenz für nummern-sensitives Matching.)

## 5. Technische Anker (Datei:Zeile, Startpunkte)
- Editor-Submit: `js/review/review-editor-submit.js` (`handlePathEditFormSubmit` ~:91).
- API-Client: `js/app/api-client.js` (`submitMapFeatureEdit` ~:100–115, die 409-Fehlermeldung).
- Backend PATCH: `api/edit/map/features.php` (optimistic locking, `revision`/`map_revision`).
- Weg-Wiki-Zuweisung Backend: `api/_internal/wiki/paths.php` (`avesmapsWikiPathAssign` ~:747 —
  stempelt `wiki_path` auf gleichnamige Segmente).
- Weg-Namens-Logik Frontend: `js/map-features/map-features-path-domain.js`
  (`getPathDisplayName` ~:22 — die Ziffer-Strip-Falle).
- Weg-Edit-UI / Wiki-Zuweisungs-Formular: im Review-Editor (grep `wiki_path`, `assign`,
  `pathEdit`, `handlePathEditFormSubmit`, das Segment-Zuweisungs-UI).
- Deep-Link: `js/app/wiki-deeplink.js` (`applyWikiDeeplinkFromUrl`, `focusWholeWikiDeeplinkPath`,
  `exactPathNameKey`), `js/app/share-link.js` (Strip-Liste), Planner-State-URL-Sync in
  `js/app/bootstrap.js`.
- Spotlight-Fokus (Weg-Highlight, fitBounds): `js/ui/spotlight-search-focus.js`
  (`focusSpotlightPath`, `focusSpotlightBounds`), `js/ui/spotlight-search.js`
  (`buildSpotlightPathEntries`, `getSpotlightPathGroupKey`).

## 6. Constraints
- **Datenintegrität zuerst.** Namens-Umbau + Zuweisung/Entfernen dürfen keine Segmente
  korrumpieren. Wo möglich: Backup/Revert-Pfad wie bei anderen Edit-Aktionen.
- **Keine Regression:** normale Weg-Anzeige, Labels, Routing (Dijkstra-Graph!), Suche,
  Deep-Link müssen weiter funktionieren. Der Routing-Graph darf NICHT brechen (Wege sind
  Graph-Kanten) — Namensänderungen dürfen die Graph-Identität (public_id) nicht antasten.
- Windows/PowerShell, CRLF/LF-Einzeiler-Anker (`git ls-files --eol` prüfen).
- **STRATO:** schwere Endpoints nicht loopen. **Betreiber-Regel Wiki-Aventurica:** Dump
  bevorzugen, Wiki-API nur wenn nötig, **kein HTML-Crawl** (siehe [[wiki-aventurica-dump-policy]]).
- Kleine, verifizierte Commits direkt auf `master`; **Owner pusht bzw. „push selber"**;
  nach Push Remote-SHA prüfen. Subagenten pushen nicht.
- Tests: für die Namensregel (R1/R2), für Zuweisen/Entfernen (kein 409 im Normalfall), für
  den nummern-sensitiven Namens-/Wiki-Match.

## 7. Verifikation (Definition of Done)
1. Ein bisher **nicht zugewiesenes** Segment „Reichsstraße 1" zuweisen → **speichert ohne 409**;
   der Wegname wird „Reichsstraße 1" (nicht der eingetippte/Random-Name).
2. **Mehrere** Zuweisungen hintereinander → keine 409-Häufung.
3. **Entfernen** der Zuweisung → Weg trägt wieder einen **generischen** (`<Subtype>-<n>`) Namen,
   NICHT den Wiki-Namen.
4. **`show_label`** bleibt vor/nach Zuweisung/Entfernen unabhängig steuerbar.
5. `?strasse=Reichsstraße_1` → **URL springt nicht** zurück auf die Toggles; Fokus korrekt.
   Gleiches für `?siedlung/staat/region/fluss`.
6. Nach sauberer Zuweisung **aller** geografischen R1-Segmente → der Deep-Link zoomt **eng**
   auf die echte Straße (nicht mehr auf einen weiten Ausschnitt mit Reichsstraße 2 im Bild).
   (Hintergrund: der Deep-Link ist technisch korrekt — er zoomt auf die Bounding-Box aller als
   „Reichsstraße 1" markierten Segmente; das weite Bild kam von der inkonsistenten/lückenhaften
   Zuordnung. Der Umbau macht die Zuordnung sauber, dann stimmt auch der Zoom.)

## 8. Empfohlenes Vorgehen
1. **Erst A** (kleiner URL-Fix) — schnell, isoliert, sofort testbar.
2. **Dann B** mit SDD: (a) Recon des Zuweisungs-/Revisions-Pfads + der Namens-Ableitung;
   (b) B1/B2 (Locking/Revision) fixen, damit Speichern zuverlässig ist; (c) B3 (Namensregel)
   als Kern-Umbau + Tests; (d) End-to-End-Verifikation am echten Datensatz (Reichsstraße 1).
   B3 ist der heikelste Teil (Datenintegrität + Routing-Graph) — dort adversarial verifizieren.
