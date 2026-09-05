# Gebirgs-Höhenfelder: Performance-Befund vom 05.09.2026

Untersucht wurde der aktuelle gemeinsame Arbeitsbaum. Bereits vorhandene Änderungen anderer
Sitzungen, insbesondere an `api/app/map-features.php` und dessen Cache-Bibliothek, wurden nicht
verändert. Keine Produktionsdaten geschrieben, kein Lasttest, kein Deploy. Die Zuordnung zum
konkreten Vorfall bleibt ohne zeitgleichen Netzwerkverlauf und Servermessung vorläufig.

## 1. Geländespeicherung entwertet indirekt die komplette Kartennutzlast

Belegte Kette:

1. `buildTerrainRaster()` in `js/map-features/map-features-ecosystem-properties.js` ruft
   `saveTerrainSettings(false)` auf.
2. Das sendet `update_area_terrain` an `api/edit/map/ecosystem.php`.
3. `avesmapsUpdateEcosystemAreaTerrain()` in `api/_internal/app/ecosystem.php` erhöht
   `ecosystem_revision`. Auch unveränderte Werte führen zum Revisionsschritt.
4. `avesmapsClimateReadStamp()` in `api/_internal/app/climate-membership.php` liest genau
   diesen allgemeinen Landschaftszähler.
5. `api/app/map-features.php` verwendet den Klima-Stempel für seinen ETag und Dateicache.

Damit verfehlt der nächste vollständige Kartenabruf den bisherigen Cache, obwohl eine
Geländehöhe weder Klimazonen noch Kartenobjekte geändert hat. Gleichzeitig eintreffende
Cache-Misses können die Nutzlast unabhängig voneinander aufbauen; der untersuchte Cache
hat keine Koordination für den Neuaufbau.

**Wichtige Grenze:** Das ist kein Push eines vollständigen Kartenabrufs in jeden offenen Tab.
`pollLiveMapUpdates()` in `js/routing/routing.js` läuft nur im sichtbaren Editormodus, alle
15 Sekunden, und prüft zunächst `map_revision`. Eine reine Geländeänderung erhöht diesen
Zähler nicht. Der Befund erklärt zusätzliche gemeinsame Serverlast bei folgenden Abrufen,
nicht allein ein sofortiges Einfrieren sämtlicher bereits geöffneter Karten.

Eine einzelne öffentliche Live-Probe am 05.09.2026, Antwortdatum 00:50:54 UTC:

| Messwert | Ergebnis |
|---|---:|
| Endpunkt | `/api/app/map-features.php` |
| HTTP | 200 |
| `X-Avesmaps-Payload-Cache` | `miss` |
| Erstes Byte | 2,529 s |
| Gesamtdauer | 2,843 s |
| Übertragene Nutzlast, gzip | 3.154.086 Bytes |

Das ist eine Einzelmessung inklusive Netzlaufzeit, keine reine PHP-Rechenzeit und kein
Beweis, dass dieser Miss durch eine Höhenfeldänderung entstand.

## 2. Landschaftsabrufe führen Schema- und Saatarbeit vor dem 304 aus

`api/app/ecosystem-areas.php` ruft `avesmapsEcosystemEnsureTables()` **vor** der
ETag-Prüfung auf. Auch `update_area_terrain`, `compute_ridge` und `list_regions` erreichen
diese Funktion. Sie besitzt keinen frühen Ausstieg für einen bereits migrierten Bestand.

Im Funktionsrumpf stehen 14 `CREATE TABLE IF NOT EXISTS`-Anweisungen, zusätzlich
Spaltenprüfungen über `information_schema`, Vorgabenergänzungen und Migrationsprüfungen.
`avesmapsEcosystemSeedRegionTypes()` führt bei jedem Durchlauf 37 `INSERT IGNORE` aus
(Anzahl durch Laden der PHP-Konstante lokal verifiziert). Das sind nicht notwendigerweise
37 tatsächlich veränderte Zeilen, aber 37 ausgeführte SQL-Anweisungen.

Die Last entsteht somit auch bei unverändertem Datenbestand und Antworten mit HTTP 304.
Gemeinsam genutzte Datenbank- und PHP-Ressourcen machen dies für andere Sitzungen relevant.
Wartezeiten auf konkrete Datenbanksperren oder eine erschöpfte PHP-Workerzahl wurden nicht
gemessen und sind nicht als bewiesen anzusehen.

## 3. Die neue Höhenberechnung blockiert den Browser synchron

`gebirgsRasterHochladen()` in `js/map-features/map-features-ecosystem-height-render.js`
ist zwar `async`, ruft aber `avesmapsGebirgsRasterBauen()` synchron auf. Der gesamte
Relief- und Erosionslauf hat dort keine Freigabe des Hauptthreads und keinen Worker.
Der Upload rechnet mit Zellweite 0,25 ohne den Seitenlängen-Deckel der Vorschau
(128 beim Regeln, sonst 256). Die alte zeilenweise asynchrone Rasterisierung ist auf
diesem aktiven Schreibweg nicht beteiligt.

Lokaler Node-Benchmark, synthetisches Quadrat, zwei Gipfel mit 3.000/5.000 Schritt,
Maximalhöhe 2.000, ohne Flüsse, Seen und komplexe Polygonränder; je Fall ein Lauf:

| Seitenlänge | Erosionsstufe | Deckel | Rasterzellen | Schritte | Laufzeit |
|---|---:|---:|---:|---:|---:|
| 20 | 1 | 128 | 6.561 | 40 | 99 ms |
| 70 | 1 | 128 | 16.384 | 40 | 196 ms |
| 70 | 1 | keiner | 78.961 | 40 | 965 ms |
| 70 | 5 | keiner | 78.961 | 360 | 7.894 ms |

Das ist ein reproduzierbarer Mechanismus für einen eingefrorenen ausführenden Editor,
keine Messung eines echten Gebirges oder eines anderen Nutzergeräts. Zusätzliche Geometrie
kann den Aufwand erhöhen. Der Server prüft die maximale Rastergröße erst nach dieser
Browserrechnung; `baueRaster()` begrenzt die Gesamtzellzahl für den Upload nicht vorab.

Außerdem entwertet und zeichnet `saveTerrainSettings()` die Vorschau, und der aufrufende
`buildTerrainRaster()` entwertet sie nach dem Upload erneut. Dadurch kann neben der
Speicherrechnung nochmals Vorschauarbeit entstehen. Die Erfolgsmeldung des äußeren
Aufrufs behauptet noch, es sei nur eine Vorschau entstanden, obwohl der innere Aufruf
inzwischen hochlädt und Uploadfehler selbst abfängt. Die Meldung ist kein verlässlicher
Beleg für erfolgreichen Upload.

## 4. Eingrenzung und Reihenfolge der Behebung

1. Den Cache-Stempel der Kartennutzlast von reinen Geländeänderungen entkoppeln. Dabei
   echte Klima-, Zuordnungs- und Beschriftungsänderungen weiterhin vollständig abdecken;
   den bisherigen Stempel nicht ersatzlos entfernen.
2. Schema-Migration und Saat aus dem häufigen Lese-/Speicherweg entfernen oder über einen
   belastbaren Schema-Versionsnachweis auf einmalige Arbeit begrenzen. Neue Installationen
   und bestehende Datenbanken müssen weiterhin korrekt migriert werden.
3. Die unveränderte Höhenberechnung in einen Worker verlagern, mit Abbruch und Größenprüfung
   vor der Speicherbelegung. Nicht still die Speicherauflösung oder Geländeform ändern.
4. Doppelte Vorschauinvalidierung entfernen und den tatsächlichen Speicher-/Uploadausgang
   bis zur Meldung des Erzeugen-Knopfs weiterreichen.
5. Bei einem echten Vorfall Netzwerkzeiten einer zweiten Sitzung mit dem Speichervorgang
   korrelieren: `update_area_terrain`, `heightmap_put`, `ecosystem-areas.php`,
   `map-features.php`, `map-revision.php`; besonders TTFB, Antwortgröße und Cache-Herkunft.
   PHP-Auslastung und Datenbankwartezeiten würden den Serververdacht bestätigen oder widerlegen.

Kein Hinweis auf einen vom Höhenfeld ausgelösten parallelen Upload-Sturm im untersuchten
Einzelflächenweg. `heightmap_put` erhöht selbst keine Karten-/Landschaftsrevision und startet
keinen Wegprofil-Gesamtlauf. Die Authentifizierung gibt die PHP-Session-Sperre direkt nach dem
Lesen des Nutzers frei; eine über die Berechnung gehaltene Session-Sperre ist hier nicht belegt.

Ausgeführte bestehende Tests, alle grün: `gebirgsraster-hochladen.test.js`,
`ecosystem-loader-height-invalidation.test.js`, `hoehenfeld-ein-erzeuger.test.js`.
Sie prüfen Funktion und Verdrahtung, keine Mehrnutzerlast. Das vollständige Deploy-Testfeld
wurde nicht ausgeführt, da keine Laufzeitdatei geändert und nichts gepusht wurde.

## 5. Nachprüfung der Änderungen der letzten 24 Stunden

95 Commits im mit `git log --since='24 hours ago'` ermittelten Fenster am frühen
05.09.2026 gesichtet; verdächtige Laufzeitänderungen anschließend als Diff geprüft.
Zeitangaben unten sind Commitzeiten in Europe/Berlin, keine bestätigten Deployzeiten.

### Neuer gemeinsamer Sperrpunkt im API-Zähler — hohe Prüfpriorität

`c05689922`, 04.09., 19:39: `avesmapsApiMetricsSpoolAnhaengen()` schreibt mit
`FILE_APPEND | LOCK_EX` in eine gemeinsame Datei im PHP-Temp-Verzeichnis. Aufgerufen
wird es in der Abschlussroutine für Anfragen ohne vorhandene Datenbankverbindung,
insbesondere den Cache-Schnellpfad der politischen Ebene. Die Schreibstelle hat
keinen nichtblockierenden Sperrversuch und keinen eigenen Wartezeitdeckel.

Lokale Gegenprobe mit zwei PHP-Prozessen in einem isolierten Temp-Verzeichnis:
Ein Prozess hält die Dateisperre 1,5 Sekunden; die unveränderte Produktionsfunktion
benötigt im zweiten Prozess **1.451 ms** zum Anhängen einer einzigen Metrikzeile.
Damit ist das Warten auf den Sperrhalter belegt, nicht eine Störung von STRATOs
Dateisystem. Ob `sys_get_temp_dir()` dort lokal oder netzgebunden liegt, ist offen.
Auch nach einer schon ausgelieferten Antwort bleibt während der Abschlussarbeit ein
PHP-Prozess belegt. Diese neue gemeinsame Wartekante sollte vor weiteren kosmetischen
Browseroptimierungen untersucht werden. Einfaches `try/catch` begrenzt ihre Wartezeit nicht.

### Neue Import-Aufräumung — bedingter Kandidat für Datenbanklast

`b60b4422a`, 04.09., 19:04; Reparaturstempel `7160cdafb`, 05.09., 01:25:
Nach dem Planbau von „Holen & Rechnen“ läuft jetzt `avesmapsGaretienStagingAufraeumen()`.
Der Deckel begrenzt drei alte **Läufe**, nicht drei kleine Zeilenpakete. Zuerst erfolgt
sogar ein davon unabhängiges `DELETE ... WHERE run_id NOT IN (...)` über die
Staging-Tabelle; anschließend je ausgewähltem Lauf ein vollständiges DELETE.
Bei großen Altbeständen kann das zusätzliche I/O und längere Anfragen verursachen.
Es läuft nicht beim bloßen Kartenbesuch und erklärt einen Vorfall nur, wenn zugleich
ein Import-Plan gebaut wurde. Die tatsächliche Laufzeit wurde nicht live gemessen.

### Gebirge wurden innerhalb des Tages zusätzlich teurer

`ce7a943e5`, 04.09., 08:01 führt den synchronen V12-Rechner samt Upload beim Speichern ein.
`07eb62fc5`, 14:34 ergänzt Polygonprüfungen gegen Nachbargebirge und deren Gipfel in
Vorschau und Upload. Die eigene Raster-Boundingbox bleibt dabei gleich; teurer werden
Geometrieprüfungen und die Rechnung innerhalb des Rasters, nicht pauschal dessen Abmessungen.
`016bc95bd`, 18:37 erweitert/ändert die Vorlagen, darunter mehrere mit Erosionsstufe 5
(360 Schritte). Diese Änderungen verstärken den lokalen Rechenengpass aus Abschnitt 3.
Sie lassen fremde Browser nicht automatisch dieselbe Rechnung ausführen.

### Pinsel: bereits dokumentierte historische Last, inzwischen reduziert

`71d9d2f4e`, 04.09., 21:20 beschreibt als damalige Messung 15 Speicherungen eines Waldes
in 30 Sekunden, jeweils etwa 47 KB Upload plus 470 KB Sichtfeldabruf. Diese Zahlen stammen
aus dem Commitbericht und wurden hier nicht erneut live erhoben. Der Diff bestätigt die
Abhilfe: Striche sammeln, 2,5 Sekunden Ruhefrist, statt nach jedem Strich speichern.
`d04dff97f`, 05.09., 02:50 ergänzt die sofortige lokale Geometrieanzeige.
Alte bereits geöffnete Tabs können den vorherigen JavaScript-Code weiterhin ausführen.

### Einordnung

Die Cache-Kopplung aus Abschnitt 1 besteht laut `git blame` seit **03.08.2026**;
die Schema-Selbstheilung beim Geländespeichern seit **29.07.2026**. Beides ist alter
Ballast, der durch neue Nutzung häufiger ins Gewicht fallen kann, keine erst gestern
eingeführte Regression. In den geprüften Änderungen an `js/ui`, `js/review`, `js/app`
und `js/routing` fand sich außerhalb der Tests kein zusätzlicher `fetch`-, Timer-,
Observer- oder Animationsaufruf als Hinweis auf eine neue allgemeine Abrufschleife.
Das schließt indirekte Effekte nicht aus. Die politischen Reparaturen von 05.09., 02:00
ergänzen Schreib-/Reparaturwege, keinen automatisch pro Kartenabruf laufenden Gesamtscan.
