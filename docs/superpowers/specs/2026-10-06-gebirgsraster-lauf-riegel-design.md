# Der Gebirgsraster-Lauf wird verriegelt, nicht die Handarbeit

**Entwurf, 06.10.2026.** Anlass: Totalausfall der Live-Seite am 05.10.2026, 15:16–16:06 (50 Minuten),
danach vom Owner per Wartungsseite offline genommen.

Owner-Entscheid 06.10.2026: **„blockier den lauf"** — nicht die Bearbeitung. Und zur Ursache, vom
Owner selbst benannt, bevor die Messung sie belegte: *„meine theorie ist dass es was mit dem
gebirgsraster zu tun hat. ich glaub die bewegen die berggipfel während die simulation läuft."*

---

## 1. Zusagen dieses Entwurfs

1. **Ein Rasterlauf startet nicht, solange an seinem Gebirge gearbeitet wird** — er wartet und sagt
   es, statt gegen einen wandernden Zustand zu rechnen.
2. **Die Handarbeit wird NIE gesperrt.** Wer einen Gipfel bewegt, merkt vom Riegel nichts.
3. **Ein unverändertes Gebirge wird nicht hochgeladen.** Gleiches Raster = kein Schreibvorgang.
4. **Der Riegel sitzt serverseitig**, im einen Schreibweg, nicht im Browser.

Jede dieser vier Zusagen ist einzeln begründet. Wer eine davon aufhebt, hebt den Grund mit auf — und
der Grund ist ein 50-minütiger Totalausfall.

---

## 2. Der Befund — was gemessen ist

Gemessen am Apache-Access-Log 04.10. 00:00 bis 05.10. 16:08 (840.286 Zeilen, nur avesmaps.de) und an
der eigenen Tabelle `api_metric` (400 Tage Aufbewahrung, überlebt das Fehlen der STRATO-Logs).

**Der Ausfall:**

- 2.751 × HTTP 500, alle mit **exakt 573 Bytes** — eine generische Fehlerseite, nicht unsere.
- Wartezeiten immer wieder **exakt 363–364 s**. Das ist STRATOs FastCGI-Abbruch (AGENTS.md §10).
- Betroffen war **jeder** PHP-Endpunkt, auch `heartbeat.php` und `session.php`.
- 🔴 **In `api_metric` steht davon NICHTS.** Der Ausfalltag trägt 295 `|leer`-Fatals — weniger als
  jeder andere Tag der Woche (28.09.–04.10.: 370/417/370/384/274/389/449). **Die 500er haben PHP nie
  erreicht**; sie standen in der Warteschlange davor. Das ist der Beleg, dass die Grenze die Zahl
  gleichzeitiger PHP-Prozesse ist und nicht etwas in unserem Code.

**Die Last in den 76 Minuten davor (05.10. 14:00–15:16):**

| Client | Rasterläufe (>250 KB Antwort) | Gipfel/Label bewegen | kleine Schreibvorgänge |
|---|---|---|---|
| A | **181** | **462** | 2.191 |
| B | 21 | 295 | 518 + 334 Territorien |

Zusammen **~3.700 Schreibvorgänge in 76 Minuten = 49 pro Minute**, davon 202 mit einer Antwort über
250 KB. Beide Editoren fuhren Rasterläufe **und** bewegten dabei Gipfel.

**Das Volumen (40 Stunden, 21 GB):**

| Endpunkt | Volumen | Anfragen | Schnitt |
|---|---|---|---|
| `app/political-territories` | 9.039 MB | 16.226 | 570 KB |
| `app/map-features` | 5.539 MB | 2.459 | **2,3 MB** (Spitze **26,33 MB**) |
| `app/ecosystem-areas` | 3.842 MB | 17.180 | 229 KB |
| `edit/map/ecosystem` (Schreiben) | 1.690 MB | 20.591 | 84 KB |

Davon **8.234 Schreibvorgänge mit je ~204 KB Antwort** (1,64 GB).

**Die gebrochene Annahme** steht wörtlich in `api/_internal/app/ecosystem.php:1004`:

> „`heightmap_stamp` is the GLOBAL raster stamp, not a per-way one. **A raster run is a rare,
> owner-triggered act** […] so global granularity costs nothing here, and after a raster run the
> profiles get recomputed anyway."

Gemessen sind es **202 Läufe in 76 Minuten**. Die Annahme ist ins Gegenteil gekippt, und die zweite
Hälfte des Satzes ist die Lawine: Jeder Rasterlauf macht **alle 5.655 Wegprofile** ungültig.

⚠️ **Zwei Hypothesen wurden auf diesem Weg widerlegt und sind hier festgehalten, damit sie niemand
erneut verfolgt:** (a) ein Fan-out von `lore.php` (1.057 Abrufe in einer Minute am 04.10.) — es ging
dem Ausfall um 21 Stunden voraus und hat ihn nicht ausgelöst; vor dem Kipppunkt war `lore.php`
Nummer 10 mit 41 Abrufen. (b) erschöpfte Datenbankverbindungen — die Metrikmarke `ohne_verbindung`
heißt **„brauchte keine Datenbank"**, nicht „bekam keine"; die Fatals starben, bevor sie die
Datenbank anfassten. 🪤 Beide Fehlschlüsse entstanden aus derselben Ursache: die auffälligste Spitze
für den Auslöser zu nehmen. Der Beleg war jedes Mal eine Messung AM Kipppunkt, nicht die größte Zahl
im Datensatz.

---

## 3. Was gebaut ist — zweiter Anlauf, ein Schritt

🪤 **Der erste Anlauf ist live gescheitert und wurde zurückgerollt** (`754c664f0`). Er verglich das
angebotene Raster in SQL gegen das gespeicherte — ein ~250 KB großer Binärparameter gegen eine
BLOB-Spalte. MySQL warf, `api_metric` verbuchte **7× `edit/map/ecosystem|server_error`** (kein
`|leer`, also eine sauber gefangene Ausnahme), der Browser meldete `ERR_HTTP2_PROTOCOL_ERROR`.
💣 **Kein Test hatte gewarnt:** die Fixturen laufen auf SQLite, und das kennt die
Kollations-Einschränkung nicht — dieselbe Klasse wie AGENTS.md §9 („Ein SQLite-Test kann eine
MySQL-Regression ERZWINGEN"), nur andersherum.

🔴 **Die Lehre, die den zweiten Anlauf bestimmt: der Vergleich war überflüssig.** Das Raster wird
*aus* (Gipfeln + Reglern + Geometrie) gerechnet — sind deren drei Stempel gleich **und** ist die Form
gleich, *ist* es dasselbe Raster. Kein Binärparameter, keine neue SQL-Konstruktion. Und damit
gehören Riegel und Fingerabdruck in **einen** Schritt: der Riegel ohne den Fingerabdruck je Gebirge
wäre ohnehin wirkungslos gewesen, weil sich die globalen Stempel bei jedem bewegten Gipfel ändern.

**Drei reine Funktionen, alle getestet:**

| Funktion | Aufgabe |
|---|---|
| `avesmapsTerrainRasterKasten` | der Kasten eines Rasters aus Ursprung + Pixel × Zellweite |
| `avesmapsTerrainPeaksFingerprintFuerKasten` | der Gipfel-Stempel **eines** Gebirges |
| `avesmapsTerrainRasterIstAktuell` | gibt es überhaupt etwas zu schreiben? |

**Der Fingerabdruck je Gebirge — zwei Hälften, beide nötig:**

- **(a) die Gipfel IM Kasten**: Lage und Höhe gehen direkt ins Höhenfeld.
- **(b) je solchem Gipfel der Abstand zu seinem nächsten Nachbarn**, und der darf überall liegen.
  Daran klemmt sein Radius (`min(…, max(0,72 × separation, minRadius), 150)`).

🔴 **Damit ist er vollständig, ohne Rand um den Kasten:** Ein fremder Gipfel wirkt **nur** über (b),
ein neuer eigener über (a).

🪤 **Eine Client-Liste der Gipfel-IDs war vorgeschlagen und ist verworfen.** Sie hätte den Fall „ein
NEUER Gipfel liegt jetzt in dieser Fläche" nicht erfasst — sie kennt nur die Gipfel, aus denen das
alte Raster entstand. Der Kasten kennt ihn. Und sie hätte die Zusage „THE SERVER STAMPS, NOT THE
CLIENT" angekratzt, die der Kasten vollständig wahrt (er kommt aus der eigenen Zeile).

💣 **EIN FINGERABDRUCK MIT LÜCKE IST SCHLIMMER ALS DER GLOBALE.** Der globale meldete zu oft
„veraltet" — laut, teuer, aber sicher. Einer mit Lücke meldet „aktuell" für ein Raster, das es nicht
ist, und dann rechnet die Wegfindung auf einem Gelände, das der Editor nie gesehen hat. Der Test
prüft beide Hälften **einzeln**, mit Gegenprobe (B10: ein fremder Gipfel *ohne* Nachbarschaft darf
nichts ändern — sonst misst B9 nur die Anzahl).

**Der Riegel:** Sind alle drei Stempel **und** die Form gleich, wird **gar nichts** geschrieben —
kein Blob, kein UPDATE. Die Antwort sagt `{written: 0, unchanged: 1}`. 🔴 `written` bleibt die Zahl
der geschriebenen Raster, weil `gebirgsRasterHochladen` sie als „hochgeladen" liest; ein
unverändertes Gebirge ist nicht hochgeladen, es ist aktuell.

💣 **Die Form muss mitgeprüft werden.** Die Stempel decken Gipfel, Regler und Geometrie ab — *nicht*
eine geänderte Zellweite oder Pixelzahl, die aus einer Code-Änderung kommen kann
(`ECOSYSTEM_HYDRO_ZELLWEITE` stand schon einmal anders). Ohne die Prüfung bliebe ein Raster in alter
Auflösung liegen und gälte als aktuell.

💣 **Die Naht ist die teuerste Stelle:** Schreibweg und Status müssen denselben Wert rechnen, sonst
gilt **jedes** Raster für immer als veraltet. Das Status-SELECT brauchte dafür drei zusätzliche
Spalten (`cell_size_mapunits`, `origin_x`, `origin_y`) — **genau dieselbe Falle, die dort eine Zeile
tiefer schon für die fünf V12-Regler ausgeschrieben steht.**

## 4. Der N+1 ist mit gefallen

`avesmapsTerrainReadStampInputs` fuhr **zwei** Queries je Upload; der zweite (JOIN über
`ecosystem_area` × `ecosystem_region`) las die höhentragenden Flächen — und zwar **nur** für den
globalen Stempel, in den ihre `geometry_revision` eingingen. Der Fingerabdruck je Gebirge braucht
das nicht: die eigene `geometry_revision` steht in derselben Zeile. Bei 69 Requests pro Lauf war das
69× ein JOIN für nichts. Jetzt **ein** Query.

✅ **Der verbleibende Gipfel-Scan ist billig — an der Live-Datenbank gemessen** (06.10.2026):

```
type: range   key: idx_map_features_type_active   rows: 229   Extra: Using index condition
```

Ein Index-Range-Scan über 229 Zeilen, kein `ALL` über die ~12.000 der Tabelle. 🔴 **Ein Cache wäre
Überkonstruktion** — und riskant: sein Schlüssel müsste jede Änderung an Gipfeln *und* Flächen
erfassen, und ein zu grober Schlüssel liefert veraltete Stempel, also genau den gefährlichen
Zustand.

🔴 **Der globale Erzeuger bleibt als Funktion stehen**, mit Totmarke: `terrain-store-test.php` hält
an ihm die `ecosystem_revision`-Lehre fest. Er hat keinen Aufrufer im Pfad mehr.

⚠️ **Beim ersten Lauf nach dem Deploy gelten alle 69 Gebirge als veraltet** — die gespeicherten
Stempel sind noch die globalen Werte, gegen die neue Rechnung stimmt keiner. Einmal durchrechnen,
danach greift der Riegel.

## 5. Fallen

💣 **Der Riegel lässt den Lauf nicht auf der Hälfte stehen.** Er lehnt nichts ab und bricht nichts ab
— er schreibt nur weniger. Ein Lauf über 69 Gebirge läuft durch wie vorher; das war der entscheidende
Vorzug gegenüber der zuerst erwogenen Sperre, die am 40. Gebirge ein `409` geworfen hätte.

💣 **Keine Transaktion, und bewusst keine.** Gelesen, entschieden, dann entweder nichts oder der
INSERT — alles einzeln, wie vorher. 🔴 Wer hier eine Transaktion um beides legt, muss wissen, dass
`Ensure`-Helfer in MySQL implizit committen (AGENTS.md §11) und ein `commit()` danach „There is no
active transaction" wirft, während alles geschrieben ist.

🪤 **Die Datei ist CRLF.** Mehrzeilige Edits darauf sind die Falle aus AGENTS.md §9; der Einbau lief
über ein Skript, das jede Ankerstelle **genau einmal** finden muss und sonst nichts schreibt.

🪤 **Und eine Falle beim Bau selbst, die sofort zuschlug:** Die Schutzprüfung des Einbau-Skripts
(„steht der Blob-Vergleich wirklich nicht mehr drin?") schlug an **meinem eigenen erklärenden
Kommentar** an, der die verbotene Zeichenkette zitierte. Der Kommentar ist umformuliert, statt die
Prüfung aufzuweichen. Dieselbe Lehre gilt dem Test: seine Wächter D1/D2 lesen den Quelltext
**durch den Tokenizer**, also ohne Kommentare — sonst hätte die Warnung vor dem Muster am Muster
angeschlagen.

## 6. Tests

`api/_internal/app/__tests__/gebirgsraster-stempel-test.php` — **40 Zusicherungen**, vier Teile:

- **A) der Kasten** aus Ursprung + Pixel × Zellweite, auch mit PDO-Strings, und `null` ohne Ausdehnung.
- **B) der Fingerabdruck je Gebirge**: beide Hälften einzeln, mit Gegenprobe (B10), Reihenfolge-
  Stabilität, einschließender Kastenkante, neuem Gipfel im Kasten (B8).
- **C) der Riegel**: jeder der drei Stempel einzeln, jedes Formfeld einzeln, PDO-Strings, und ein
  fehlendes Feld am Kartennullpunkt (C9) — dort ist die Anwesenheitsprüfung die einzige Rettung,
  weil `(float) null` genau der erwartete Wert wäre.
- **D) der Einbau**, per Tokenizer: **kein Blob-Vergleich** (D1/D2 — der Wächter gegen den
  gescheiterten ersten Anlauf), beide Leser rufen denselben Erzeuger (D3), der globale Stempel ist
  aus dem Pfad (D4), die drei SELECT-Spalten (D5), der Riegel steht vor dem INSERT (D6), ein Query
  statt zwei (D7/D8).

**Mutationsprobe (06.10.2026), mit Byte-Gegenprobe:** 8 Mutationen, 7 anwendbar, **alle 7 gefangen**.

**Ganzes Testfeld vor dem Push:** 437 PHP (rot nur das vorbestehende `linkcheck/link-url-test.php`,
echter DNS-Abruf), 592 JS, null rot.

🔧 **Nie gegen die echte Datenbank gefahren** — und genau daran ist der erste Anlauf gescheitert.
Deshalb vor diesem Push abgesprochen, dass unmittelbar danach ein Handgriff an einem einzelnen
Gebirge geprüft wird.

## 7. Was dieser Entwurf NICHT löst

🔧 **Die großen Antworten bleiben.** `map-features.php` mit 26,33 MB (2.459 Abrufe, 5,5 GB) und die
204-KB-Antwort auf ein Speichern sind eigene Posten. AGENTS.md hat für `map-features` einen
IndexedDB-Cache, der **im Bearbeiten-Modus ausdrücklich abgeschaltet** ist — mit guter Begründung
(„ein zurückgehaltener Editor-Stand ist genau die Störung…"). Das ist ein eigener Entwurf.

🔧 **Das Zoom-Fan-out des politischen Layers** (8 Zoomstufen je Seitenaufbau, 9 GB Gesamtvolumen).

🔧 **Der Editor-Seitenaufbau feuert bis zu 43 PHP-Anfragen in 12 Sekunden** (gemessen an drei Starts:
43, 25, 8) — gegen **eine** beim Besucher. Das ist der Posten, der den Pool am Kipppunkt endgültig
füllte.

🔧 **Die ~400 täglichen `|leer`-Fatals** (political-territories 148–217, zoom-bands 47–56,
ecosystem-display 43–50, map-features 35–36) laufen seit mindestens dem 28.09. und sind **nicht** die
Ursache des Ausfalls. Verdacht: Client-Abbrüche beim Seitenaufbau, von der Metrik als „fatal"
verbucht — also eher eine Fehlklassifizierung als ein Bug. Ungemessen.

🔧 **Der Ablauf wurde nie gegen die echte Datenbank gefahren** — die Seite war während dieses Entwurfs
offline.
