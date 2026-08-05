# Befunde Agent 6 — API-Analyst

## Kern

1. **Der Umschlag steht besser als sein Ruf.** 530 kanonische Fehlerstellen gegen 12 flache —
   und die 12 liegen alle in `api/discord/` (4 Dateien). M3 ist beim Umschlag fast fertig.
2. **Die eigentliche Vertragslücke ist der Statuscode:** 36 Stellen in 18 Dateien reichen ein
   internes Ergebnis-Array wortwörtlich mit **hart verdrahtetem HTTP 200** durch. Ist darin
   `ok:false` + flacher Fehlertext, geht der als „Erfolg" hinaus. An drei Stellen nachgelesen.
3. **Zwei Informationslecks, ausgerechnet im stabilen Vertrag.** `api/locations/index.php:38`
   und `api/route/index.php:359` fangen `RuntimeException` **ohne vorheriges `PDOException`** —
   und `PDOException` IST eine `RuntimeException`. Ein DB-Fehler schickt die Treibermeldung an
   jeden anonymen Aufrufer. Alle anderen Endpunkte fangen `PDOException` zuerst.
4. **API und Oberfläche haben KEIN gemeinsames Feld.** Die Route liefert `cost` (Dijkstra-Gewicht);
   die angezeigten Stunden sind `cost × 3,57` — zwei Konstanten, die nur in `js/config.js` stehen.
   Gesamtstrecke, Reisezeit, Luftlinie: im Vertrag nicht vorhanden. Fünf dokumentierte
   Anfrageparameter (`include_air_distance`, `include_steps`, `include_rests`, …) werden geprüft,
   zurückgespiegelt und **nie gelesen**.
5. **Kreuzungsnamen sind Platznummern, keine Kennungen.** Die 15 `Kreuzung-*` der Testroute
   existieren in `map-features` **nullmal**; dasselbe Objekt heißt dort `Kreuzung`/`Kreuzung-41`.
   Betroffen: 2079 von 4854 Knoten (42,8 %). Eine eingefügte Kreuzung nummeriert alle folgenden um.
6. **Ein unauthentifizierter Schreibpfad:** `POST /api/app/adventures.php {"action":"resolve"}`.

---

### B1 Unauthentifizierter Schreibpfad mit unbegrenzter Arbeit: `POST /api/app/adventures.php`
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\app\adventures.php:94-98` (Dispatcher), `C:\GIT\avesmaps\api\_internal\app\adventure-resolve.php:398,430-439` (die Schreibschleife)
- **Beobachtung:** Der Endpunkt kennt keine Rechteprüfung (`avesmapsRequireUserWithCapability` kommt
  in der Datei nicht vor). `{"action":"resolve"}` ruft `avesmapsAdventureResolveAll()`, das über
  `adventure_place` läuft und in einer Schleife `UPDATE`s absetzt. Die Schwester-Aktion `seed` hat
  einen Leer-Riegel (`avesmapsAdventuresCount($pdo) > 0 → skipped`), `resolve` hat **keinen** —
  jeder Aufruf arbeitet erneut. Kein Rate-Limit (`grep 429` in der Datei: 0 Treffer). Der
  Dateikopf (Zeile 9-10) sagt selbst: „Phase 3 moves editing to the capability-gated editor and can
  tighten/remove these bootstrap actions" — Phase 3 ist laut AGENTS.md §11 ausgeliefert.
- **Erwartet:** Bootstrap-Aktionen entweder entfernen oder hinter `avesmapsRequireUserWithCapability('edit')`.
- **Beleg:** `Read api/app/adventures.php:1-105` gelesen; `grep "function avesmapsAdventureResolveAll" -A 45 api/_internal/app/adventure-resolve.php` zeigt `UPDATE {$table}` in `foreach ($places as $place)`. Nicht ausgeführt (keine Live-Anfragen).
- **Sicherheit:** BELEGT (Code gelesen), Missbrauchswirkung PLAUSIBEL (nicht ausgelöst)
- **Aufwand:** klein

### B2 `PDOException` leckt im stabilen Vertrag an jeden anonymen Aufrufer
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\locations\index.php:38-39` und `C:\GIT\avesmaps\api\route\index.php:359-360`
- **Beobachtung:** Beide fangen `catch (RuntimeException $exception)` und geben
  `$exception->getMessage()` an den Client (`locations` mit HTTP 500, `route` mit HTTP 500).
  **`PDOException erbt von RuntimeException`** — verifiziert:
  `php -r 'var_dump(is_subclass_of("PDOException","RuntimeException"));' → bool(true)`.
  Es gibt in beiden Dateien **kein vorgeschaltetes `catch (PDOException)`**. Eine Datenbankstörung
  liefert damit SQLSTATE, Treibertext und je nach Fehler Host/Datenbankname nach draußen.
  Genau diese zwei Dateien sind laut `api/README.md:4-9` der stabile öffentliche Vertrag.
  Alle disziplinierten Endpunkte machen es richtig und fangen `PDOException` **zuerst**:
  `app/map-features.php:212`, `app/map-search.php:113`, `app/ecosystem-areas.php:114`,
  `app/report-location.php:190`, `_internal/political/territories-endpoint.php:241`.
- **Erwartet:** `catch (PDOException) { avesmapsErrorResponse(500,'server_error','Internal server error.'); }`
  vor dem `RuntimeException`-Zweig — so wie in den fünf genannten Dateien.
- **Beleg:** `grep -nE "catch \(|getMessage" api/locations/index.php api/route/index.php` +
  Vererbungsprüfung mit `php -r` (Ausgabe oben). Nicht live ausgelöst.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B3 Kreuzungsnamen der Routen-API sind laufende Nummern und stehen in keiner anderen Antwort
- **Kategorie:** AKUT
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\routing\network-data.php:127-132`
- **Beobachtung:** `if (strncmp($name,'Kreuzung',8) === 0) { $name = 'Kreuzung-' . $clientCrossingIndex; }`
  — jeder Knoten, dessen gespeicherter Name mit `Kreuzung` beginnt, wird zur Anfragezeit auf eine
  **Positionsnummer** umbenannt (Zähler über `ORDER BY sort_order ASC, id ASC`, `map-data.php:47`).
  Gegen die Schnappschüsse gemessen:
  * Beide Endpunkte beschreiben **dieselben 4854 Objekte** (Schnittmenge über `public_id`: 4854,
    keins nur auf einer Seite) mit **identischen Koordinaten** (max. Abweichung 0,000000).
  * Aber **2079 davon (42,8 %) tragen zwei verschiedene Namen.**
  * Alle 15 `Kreuzung-*` aus `route.debug.node_ids` der Testroute kommen in `map-features.json`
    **nullmal** vor. Beispiele (gleiche `public_id`, gleiche Koordinate):
    `Kreuzung-793` ↔ `"Kreuzung"` (junction), `Kreuzung-78` ↔ `"Kreuzung-8"`,
    `Kreuzung-421` ↔ `"Kreuzung-41"`, `Kreuzung-764` ↔ `"Kreuzung-auto-217"`.
  * In `map-features` sind diese Namen zudem nicht eindeutig: 782 `crossing`-Features haben nur
    308 verschiedene Namen, und alle 1296 `junction`-Features heißen schlicht `"Kreuzung"`.
  Da `POST /api/route/` Orte als **Namen** annimmt und zurückgibt, ist ein `Kreuzung-793` weder
  nachschlagbar noch haltbar: eine eingefügte oder gelöschte Kreuzung verschiebt alle folgenden.
- **Erwartet:** Entweder `public_id` als Knotenschlüssel im Vertrag führen, oder die
  Kreuzungsnamen in beiden Antworten aus derselben Quelle bilden.
- **Beleg:** `work/xcheck.php` (Vergleich beider Schnappschüsse über `public_id`) sowie eine
  Einzelauflösung der 15 Routen-Kreuzungen — Ausgaben im Sitzungsprotokoll; Code an der
  genannten Zeile gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B4 36 Stellen antworten mit hart verdrahtetem HTTP 200 — auch wenn der Rumpf `ok:false` sagt
- **Kategorie:** AKUT
- **Fundstelle:** u. a. `C:\GIT\avesmaps\api\edit\wiki\sync-monitor.php:199` und `:268`;
  `C:\GIT\avesmaps\api\edit\wiki\settlements.php:115,145`; `C:\GIT\avesmaps\api\edit\wiki\regions.php:73,111`;
  `C:\GIT\avesmaps\api\edit\wiki\paths.php:198,235`; `C:\GIT\avesmaps\api\_internal\political\territories-endpoint.php:70,76,82,104,145,172,238`;
  `C:\GIT\avesmaps\api\_internal\wiki\endpoint.php:74,140`
- **Beobachtung:** Diese Dateien reichen das Ergebnis-Array ihres Dispatchers wortwörtlich weiter:
  `avesmapsJsonResponse(200, $response);`. Der Statuscode ist eine Literalzahl, unabhängig vom Inhalt.
  Konkret nachgelesen: `POST .../sync-monitor.php {"action":"save_coat_local"}` landet bei
  `avesmapsWikiSyncMonitorSaveCoatLocal` (`_internal/wiki/sync-monitor-identity.php:155`), das bei
  fehlendem Schlüssel `return ['ok' => false, 'error' => 'wiki_key fehlt.'];` (Zeile 159) liefert —
  das geht als **HTTP 200** mit **flachem** `error` hinaus. Dieselbe Datei hat 23 solcher Rückgaben
  (erreichbar über `save_coat_local`, `upload_coat`, `revert_identity`, `revert_coats`).
  Genauso `?action=geometry_inventory` → `_internal/political/territories-geometry-inventory.php:221`.
  Ein Client kann so nicht am Statuscode erkennen, ob etwas schiefging.
- **Erwartet:** Der Durchreicher prüft `$response['ok']` und wählt Status + kanonischen
  `error.code`/`error.message` — oder die Bibliotheksfunktionen werfen statt zurückzugeben.
- **Beleg:** Grep über `avesmapsJsonResponse\(\s*\d+\s*,\s*(\$\w+|avesmaps\w+\()` → **36 Treffer in
  18 Dateien**; die drei genannten Pfade Zeile für Zeile nachgelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B5 Fünf dokumentierte Anfrageparameter von `POST /api/route/` sind wirkungslos
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\routing\request.php:37-41,58-62`; dokumentiert in `C:\GIT\avesmaps\api\README.md:34-53`
- **Beobachtung:** `include_air_distance`, `include_geometry`, `include_steps`, `include_rests`
  und `rest_hours_per_day` werden geprüft (falscher Typ → 400) und in `debug.context.request`
  zurückgespiegelt — aber **nirgends gelesen**. Ein Grep über ganz `api/` findet für jedes dieser
  Felder ausschließlich die Zeilen in `request.php` selbst (Vorgabe, Normalisierung, Rückgabe).
  Der Schnappschuss bestätigt es: die Anfrage setzte alle fünf, die Antwort hat weder
  `air_distance` noch `steps` noch `rests`, und die Geometrie kommt in jedem Fall mit.
  `README.md:32` stellt sie als „Typical full request" vor, was das Gegenteil nahelegt.
- **Erwartet:** Entweder umsetzen oder aus README und `AVESMAPS_ROUTE_DEFAULT_REQUEST` streichen.
  (`minimize_transfers` und `terrain` wirken dagegen wirklich — `client-graph.php:1332`, `response.php:195`.)
- **Beleg:** `grep -rn "<feld>" api --include=*.php | grep -v __tests__` je Feld;
  Schlüsselprüfung auf `snapshots/route-gareth-havena.json` (`array_key_exists` → alle NO).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B6 Die einzige Gesamtzahl der Routen-API ist ein Dijkstra-Gewicht — die Oberfläche zeigt `cost × 3,57`
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\_internal\routing\response.php:397` (`cost`);
  `C:\GIT\avesmaps\js\config.js:11-13` (`DISTANCE_SCALING_FACTOR = 3`, `TIME_SCALE_FACTOR = 1.19`);
  `C:\GIT\avesmaps\js\routing\route-plan.js:750` (angezeigte Zeit), `:734-739` (angezeigte Strecke)
- **Beobachtung:** Die Antwort hat **keine** Gesamtstrecke, **keine** Gesamtdauer und **keine**
  Luftlinie (geprüft: `distance`, `duration`, `air_distance`, `steps`, `rests` fehlen alle im
  `route`-Objekt). Nachgerechnet auf dem Schnappschuss — die inneren Zahlen sind stimmig:
  * `Σ distance_units = 332,687390` = geometrische Länge aller Segmente = `debug…detour.travelled_units` (Δ = 0)
  * `Σ cost_units = 63,771645` = `route.cost` (Δ = 0,000000000)
  * `distance_units / cost_units` je Wegart = **exakt** die Tabellenwerte 3,45 (Reichsstrasse/groupFoot)
    und 6,0 (Flussweg/riverSailer) aus `client-graph.php:43,49`
  Was der Nutzer sieht, steht in keiner dieser Zahlen: die angezeigten Stunden sind
  `(distance_units × 3) / Tempo × 1,19` — nachgerechnet **genau das 3,570000-fache von `cost`**
  (63,7716 → 227,66 h ≈ 9,5 Tage), die angezeigte Strecke `Σ distance_units × 3` = 998,06 Meilen.
  Beide Faktoren stehen nur in `js/config.js`, weder in der Antwort noch in `README.md`.
  Der Wert von `cost_factor` (×25) ist in dieser Route durchgehend 1 — der Aufschlag war also
  **nicht** im Spiel; die AGENTS.md-Regel („aus jeder gemeldeten Zahl herausgerechnet") ließ sich
  hier nur am Code prüfen: `distance_units` wird aus den Koordinaten gemessen und trägt ihn nicht
  (`client-graph.php:1435-1437`), `cost_units` behält ihn absichtlich (`:1450-1454`) — das ist die
  bekannte, dokumentierte Entscheidung und kein Befund.
- **Erwartet:** Entweder `distance_units`-Summe, Dauer in Stunden und Luftlinie in die Antwort
  aufnehmen, oder in README schreiben, dass `cost` ein Gewicht ist und mit welchen Faktoren man
  daraus die Reisezahlen bekommt.
- **Beleg:** eigene Nachrechnung über `snapshots/route-gareth-havena.json` (Skript in `work/`,
  Ausgaben im Sitzungsprotokoll); Frontend-Kette in `route-plan.js` / `route-result.js` gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** mittel

### B7 README beziffert die Geschwindigkeitstabelle falsch — falsche Einheit und falsche Werte
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\README.md:137` gegen `C:\GIT\avesmaps\api\_internal\routing\client-graph.php:43-49` und `C:\GIT\avesmaps\js\config.js:73,115-127`
- **Beobachtung:** README: „The speed table (`Gebirgspass` 1,5 km/h, `Strasse` 4,0 …)".
  Die Tabelle steht in beiden Spiegeln als **Meilen pro Stunde** (`js/config.js:73`:
  „Miles per hour per transport x path subtype"), und **keine** Transportart hat für diese zwei
  Wegarten die genannten Zahlen: `Gebirgspass` ist 1,15 / 1,64 / 1,38 / 1,92 / 1,32 / 0,93,
  `Strasse` ist 3,07 / 4,09 / 3,58 / 5,12 / 3,07 / 5,12. Für die Standardart (`groupFoot`) also
  1,15 und 3,07 — nicht 1,5 und 4,0.
- **Erwartet:** Einheit und Werte aus `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` zitieren, oder den
  Klammerzusatz streichen.
- **Beleg:** beide Tabellen gelesen; das gemessene Verhältnis `distance_units/cost_units` im
  Schnappschuss ist exakt 3,4500 bzw. 6,0000 und bestätigt die Codewerte.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B8 `GET /api/locations/` ignoriert jeden Parameter und liefert immer 960 KB
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\locations\index.php:26-35` (die ganze Datei liest `$_GET` nie)
- **Beobachtung:** Der Schnappschuss wurde mit `?limit=25` geholt und enthält
  `location_count: 4854` und 4854 Einträge — `limit` wird nicht abgelehnt, sondern **stillschweigend
  ignoriert**. Es gibt überhaupt keinen Parameter: keine Seitenzahl, kein Filter, keine Suche.
  Dabei sind **2079 der 4854 Einträge (42,8 %) interne Graphknoten** (`subtype: "crossing"`,
  Namen `Kreuzung-1 … Kreuzung-2079`) — der Endpunkt ist laut `README.md:143` dafür gedacht,
  „valid location names" anzubieten oder zu prüfen; wer eine Ortsliste zeigen will, muss 960 KB
  laden und 43 % davon selbst wegwerfen. Das README-Beispiel nennt `location_count: 3949`
  (real 4854) und erwähnt den `crossing`-Subtyp nicht.
- **Erwartet:** `?limit`/`?offset`/`?q`/`?include_crossings=0` unterstützen — oder unbekannte
  Parameter mit 400 `invalid_request` beantworten, statt sie zu schlucken.
- **Beleg:** `Read api/locations/index.php` (vollständig, 93 Zeilen); Auswertung von
  `snapshots/locations-api.json` (Zählung nach `subtype`).
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B9 `api/README.md` verschweigt 10 von 29 App-Endpunkten und den ganzen `api/discord/`-Bereich
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\README.md:179-199` (App-Liste) und `:207-214` (Bereichsliste)
- **Beobachtung:** Nicht gelistet, aber vorhanden: `app/changelog.php`, `app/citymaps.php`,
  `app/heartbeat.php`, `app/lore.php`, `app/map-revision.php`, `app/path-landscapes.php`,
  `app/place-kinds.php`, `app/session.php`, `app/source-coverage.php`, `app/source-search.php`.
  Umgekehrt fehlt kein gelisteter Endpunkt (alle 19 existieren). Die Bereichsliste kennt
  `api/app|edit|import|diagnostics|_internal|_schema` — **`api/discord/` mit 5 web-erreichbaren
  Dateien fehlt darin ganz**. Nachrangig: `api/_schema/` enthält heute nur eine `.htaccess`,
  die in `README.md:264-270` genannten `mysql.sql`/`pgsql.sql`/`future.mysql.sql` gibt es nicht
  (dort steht „intended", also weich formuliert). Die Schutzzusage aus `README.md:216` hält
  dagegen: `_internal`, `_schema` und `diagnostics` haben je eine `Require all denied`-`.htaccess`.
- **Erwartet:** Beide Listen nachziehen; `api/discord/` als eigenen Bereich aufnehmen.
- **Beleg:** Abgleich `ls api/app/*.php` gegen `grep "api/app/…" api/README.md` (Skript im
  Sitzungsprotokoll), `find api -name .htaccess` + Inhalte gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B10 Die 12 verbliebenen flachen `error`-Strings liegen alle in `api/discord/`
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\discord\report-post.php:13,21,29,48,59,65`;
  `C:\GIT\avesmaps\api\discord\cases-export.php:15,23,33`; `C:\GIT\avesmaps\api\discord\reports-export.php:19,27`;
  `C:\GIT\avesmaps\api\discord\interactions.php:20`
- **Beobachtung:** Bestandsaufnahme über alle 229 PHP-Dateien unter `api/` (ohne `__tests__`;
  davon 85 web-erreichbar, 144 Bibliotheken unter `_internal/`):
  * **530 kanonische Fehlerstellen** — 509 Aufrufe von
    `avesmaps{Error,ServerError,RouteError,LocationsError}Response(` plus 21 inline
    `'error' => ['code' => …]`.
  * **12 flache Fehlerstellen**, ausnahmslos `echo json_encode([... 'error' => '<string>'])`
    in den vier genannten Discord-Dateien. Kein einziger flacher Fehler mehr über
    `avesmapsJsonResponse()`.
  * 71 der 85 web-erreichbaren Endpunktdateien enthalten mindestens eine kanonische Fehlerstelle;
    4 enthalten eigene flache (dieselben vier); die übrigen delegieren an `_internal/`
    (darunter die zwei Wurzel-Shims `api/auth.php` und `api/bootstrap.php`, die selbst nicht antworten).
  `interactions.php:20` hat zusätzlich **gar kein `ok`-Feld** — als einzige Antwort im ganzen `api/`.
  Nachvollziehbar ist der Sonderweg: die Discord-Endpunkte bedienen Discords Webhook-Protokoll,
  nicht Avesmaps-Clients. Die Signaturprüfung sitzt korrekt (`_internal/discord/endpoint.php:16`,
  401 bei ungültiger Ed25519-Signatur), und `register-commands.php:27-30` ist CLI-only (404 im Web).
- **Erwartet:** Entweder auf `avesmapsErrorResponse` umstellen oder in `README.md` festhalten,
  dass `api/discord/` bewusst außerhalb des Umschlags steht. M3 wäre damit beim Umschlag fertig.
- **Beleg:** `work/count-sites.php` (Zählskript) und `work/scan-envelope.php`; die vier Dateien
  einzeln gelesen. Alle acht Schnappschüsse tragen im Erfolgsfall korrekt `"ok": true`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B11 Von 24 Segmentfeldern der Routen-Antwort sind 4 dokumentiert
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\README.md:114-119` gegen `C:\GIT\avesmaps\api\_internal\routing\client-graph.php:1438-1480`
- **Beobachtung:** Der Schnappschuss liefert je Segment: `index, edge_id, found, path_id,
  feature_id, public_id, from_node, to_node, subtype, transport_type, distance_units, cost_units,
  cost_factor, coordinate_count, geometry, synthetic, offroad, flow_time_factor, flow_state,
  terrain_time_factor, ascent_schritt, descent_schritt, max_ascent_gradient, max_descent_gradient`.
  README beschreibt davon `terrain_time_factor`, `ascent_schritt`, `descent_schritt` (Tabelle
  Zeile 114-119) und erwähnt `subtype` in einer Randnotiz. Nicht dokumentiert sind unter anderem
  `distance_units`, `cost_units`, `cost_factor`, `max_ascent_gradient`, `max_descent_gradient` —
  also gerade die Felder, an denen ein Fremdclient rechnen müsste. Das dokumentierte
  Erfolgsbeispiel (`README.md:57-74`) zeigt `"segments": []` und `"debug": {}`.
  Was README *behauptet*, stimmt allerdings: `found/from/to/cost/summary.node_count/summary.edge_count`
  existieren genau so, Wasserwege haben ausnahmslos `terrain_time_factor: 1.0` und
  `ascent_schritt: null` (30 von 30 geprüft), und kein Segment liegt unter Faktor 1,0.
- **Erwartet:** Die Segmenttabelle vervollständigen oder das Segment als „nicht stabil" markieren.
- **Beleg:** Schlüsselauszug aus `snapshots/route-gareth-havena.json`, Gegenlesen von `README.md` und
  `client-graph.php:1438-1480`.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B12 Ein Endpunkt liest den Rumpf vor der Rechteprüfung
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\edit\map\source-merge.php:45` (`avesmapsReadJsonRequest`) gegen `:52` (`avesmapsRequireUserWithCapability`)
- **Beobachtung:** Der geforderte statische Test (`readJsonRequest`-Zeile < `RequireUserWithCapability`-Zeile)
  liefert über alle 315 Dateien **genau einen** Treffer. Er ist begründet: welche Fähigkeit nötig
  ist, hängt von `action` ab (`apply` → `admin`, `report` → `edit`, Kommentar Zeile 51). Folge: ein
  Unangemeldeter kann den Parser laufen lassen und bekommt die gültigen Aktionsnamen als
  400-Meldung zurück („action muss report oder apply sein."). 29 Dateien machen es andersherum
  richtig. Die drei Import-Endpunkte prüfen das Token **vor** dem Rumpf
  (`import/location-reports/delete.php:15` gegen `:24`) — vorbildlich.
- **Erwartet:** Erst `avesmapsRequireUserWithCapability('edit')` (die schwächere der beiden), dann
  Rumpf lesen, dann bei `apply` auf `admin` nachziehen.
- **Beleg:** `work/scan-auth-order.php` über alle Dateien; die Fundstelle gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein

### B13 Die zwei stabilen öffentlichen Endpunkte haben keinerlei Drossel
- **Kategorie:** KANN
- **Fundstelle:** `C:\GIT\avesmaps\api\route\index.php` und `C:\GIT\avesmaps\api\locations\index.php` (beide: 0 Treffer für `429`/`rate`)
- **Beobachtung:** Jede anonyme `POST /api/route/` lädt über `avesmapsLoadRouteMapData` die
  vollständige Feature-Tabelle und baut den Graphen neu (4854 Knoten, 5785 Wege laut
  `debug.context.network_statistics`). Der Dateikopf beziffert denselben Ladevorgang für die
  Diagnosen mit „62 MB resident, peak 152 MB per call" (`route/index.php:26-27`).
  Eine Drossel gibt es nur bei `app/share-link.php:121-124` (40/h) und
  `app/location-reviews.php:87-91` (5/h) — nicht bei den beiden Endpunkten, die README als
  öffentlichen Entwicklervertrag ausschreibt. AGENTS.md §9/§10 und die Projektnotizen halten
  fest, dass genau solche Lasten die PHP-Worker schon einmal lahmgelegt haben; ein fremder
  Aufrufer kennt diese Warnung nicht.
- **Erwartet:** Eine schlichte IP-Drossel wie bei `share-link.php`, oder ein Cache über
  `map_revision` für den Graphaufbau.
- **Beleg:** `grep -c "429\|rate"` in beiden Dateien → 0; Kommentar und Ladepfad gelesen.
  **Nicht gemessen** — es wurde bewusst keine einzige Anfrage an avesmaps.de gestellt.
- **Sicherheit:** BELEGT (fehlende Drossel), Lastwirkung PLAUSIBEL
- **Aufwand:** mittel

### B14 Geprüft und in Ordnung (kein Befund, der Vollständigkeit halber)
- **Kategorie:** KANN
- **Fundstelle:** —
- **Beobachtung:** Damit die Zahlen oben einzuordnen sind, hier was **nicht** kaputt ist:
  * **Keine SQL-Injektion gefunden.** Kein `$_GET`/`$_POST`/`$_REQUEST` erscheint in einem
    SQL-String; alle interpolierten `LIMIT`s sind vorher geklemmt
    (`_internal/app/lore.php:255` `max(1,min(500,…))`, `_internal/reviews.php:124` `min(50,…)`,
    `_internal/app/feature-sources.php:995` `min(10,…)`, `wiki-browser-endpoint.php:123` `min(…,2000)`).
    LIKE-Wildcards werden escaped (`feature-sources.php:994`).
  * **Die Routen-Diagnosen sind bewacht:** `route/index.php:30-32` verlangt `edit` für jedes
    `?diagnostic=`.
  * **Alle acht Schnappschüsse tragen `"ok": true`.** Beide `map_revision` (56665) stimmen überein.
  * **`report-location.php` leckt nicht:** die PDO-Meldung wird über
    `avesmapsBuildDatabaseErrorMessage()` (`:591-612`) auf feste Sätze abgebildet, der Rohtext geht
    nur ins Serverlog.
  * Von 75 `getMessage()`-Stellen sind die allermeisten `catch (InvalidArgumentException)` und
    damit Absicht (Validierungstexte). Nur die zwei aus **B2** sind echte Lecks.
- **Erwartet:** —
- **Beleg:** die genannten Greps und Dateistellen, alle selbst gelesen.
- **Sicherheit:** BELEGT
- **Aufwand:** klein
