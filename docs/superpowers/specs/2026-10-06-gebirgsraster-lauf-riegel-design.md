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

## 3. Der Riegel — gebaut am 06.10.2026

**Ort: `avesmapsTerrainHeightmapPut` (`api/_internal/app/terrain-store.php`, Aktion `heightmap_put`).**

🔴 **Serverseitig, und das ist tragend.** Der Rasterlauf läuft im Browser
(`AvesmapsEcosystemHeightRender.hochladen`, `map-features-ecosystem-height-render.js:1052`), und
`heightmap_put` hat **genau einen Aufrufer**. Ein Riegel im Browser wäre durch Neuladen umgehbar und
würde einen zweiten Lauf aus einem zweiten Tab nicht sehen. Serverseitig sieht er alle.

🪤 **Der erste Entwurf wollte an `map_feature_locks` fragen („arbeitet jemand an diesem Gebirge?")
und ist verworfen.** Er hätte eine Sperre gegen eine Sperre gesetzt und drei neue Fragen aufgeworfen
(welche Labels gehören zum Gebirge, was ist mit der eigenen Sperre, was bei verfallener Sperre) —
während die Messung zeigt, dass gar nichts gesperrt werden muss: **die Raster der anderen 68 Gebirge
ändern sich beim Bewegen eines Gipfels NICHT.** Nur ihr Stempel sagt „veraltet".

**Gebaut ist deshalb: ein unverändertes Raster wird gestempelt, nicht geschrieben.**

`heightmap_put` vergleicht vor dem Schreiben, ob das angebotene Raster Byte für Byte dem
gespeicherten gleicht (`avesmapsTerrainRasterBlobGleich`, rein und getestet). Wenn ja:

- Der 250-KB-Blob wird **nicht** geschrieben.
- 💣 **Die beiden Fingerabdrücke und `geometry_revision` werden TROTZDEM nachgezogen** — und daran
  hängt die ganze Wirkung. Ohne das bleibt das Gebirge „veraltet", der nächste Lauf lädt es wieder
  hoch, und der Riegel hätte die Schleife nicht gebrochen, sondern nur einen Schreibvorgang gespart.
- Die Antwort sagt `{written: 0, unchanged: 1}`. 🔴 `written` bleibt die Zahl der geschriebenen
  Raster, weil `gebirgsRasterHochladen` sie als „hochgeladen" liest — ein unverändertes Gebirge ist
  nicht hochgeladen, es ist aktuell. Eigenes Feld statt `written` verbiegen.

⚠️ **Der Blob-Vergleich läuft IN der Datenbank** (`CASE WHEN samples = :blob`), nicht in PHP: sonst
reisten 250 KB durch den Prozess, nur um verworfen zu werden — und genau diese Bytes sind der Grund,
aus dem der Riegel existiert.

💣 **Jedes Formfeld zählt** (Zellweite, Ursprung x/y, Breite, Höhe, Bytezahl). Dasselbe Bytemuster an
einem anderen Ursprung ist ein anderes Raster; wer ein Feld vergisst, lässt ein um eine Zelle
verschobenes Gebirge stehen — lautlos, weil die Zellzahl stimmt.

⚠️ **Verglichen wird NUMERISCH, nicht mit `===`.** PDO liefert diese Spalten als String; ein strikter
Vergleich der Rohwerte hätte jedes Raster für verändert gehalten, und der Riegel wäre wirkungslos
gewesen, **ohne dass ein Test rot wird**.

🪤 **Und die Lücke, die erst die Mutationsprobe fand:** die Anwesenheitsprüfung
(`array_key_exists`) ist nur bei einem Raster am **Kartennullpunkt** die Rettung. Sonst fällt ein
fehlendes Feld zufällig durch den Wertvergleich (`(float) null` = 0.0 gegen 100.0) — bei Ursprung 0/0
ist 0.0 aber der erwartete Wert, und ein fehlendes Feld läse sich als Gleichheit. Der Riegel hielte
dann ein **fremdes** Raster für unverändert und stempelte es nur. Zusicherung A6b.

---

## 4. Die Wurzel — gebaut am 06.10.2026 (Owner: „mach den fingerprint pro gebirge")

`avesmapsTerrainPeaksFingerprint` war **global**: alle Gipfel in einem Wert. Deshalb machte ein
bewegter Gipfel alle 69 Gebirge „veraltet". Dieselbe Falle ist beim Nachbarn `ecosystem_revision`
ausdrücklich vermieden worden — die Lehre steht wörtlich in `terrain-store-test.php`:

> „`ecosystem_revision` IS NOT IN ANY STAMP. It is ONE GLOBAL counter […] 901 jumps in one working
> day […] **After the third time nobody presses the button**, and then a raster whose stamp says
> „stale" is what the map runs on."

**Gebaut: `avesmapsTerrainPeaksFingerprintFuerKasten($kasten, $alleGipfel)`** — zwei Hälften, und
beide sind nötig:

- **(a) die Gipfel IM Kasten** des Rasters: Lage und Höhe gehen direkt ins Höhenfeld.
- **(b) je solchem Gipfel der Abstand zu seinem nächsten Nachbarn** — und der darf überall liegen.
  Daran klemmt sein Radius (`min(…, max(0,72 × separation, minRadius), 150)`).

🔴 **Damit ist er vollständig, und zwar ohne Rand um den Kasten:** Ein fremder Gipfel wirkt **nur**
über (b), ein neuer eigener über (a). Die Reichweite steckt schon in (b).

🪤 **Die Client-Liste der Gipfel-IDs war vorgeschlagen und ist verworfen.** Sie hätte den Fall „ein
NEUER Gipfel liegt jetzt in dieser Fläche" nicht erfasst — sie kennt nur die Gipfel, aus denen das
alte Raster entstand. Der Kasten kennt ihn. Und sie hätte die Zusage „THE SERVER STAMPS, NOT THE
CLIENT" angekratzt, die der Kasten vollständig wahrt (er kommt aus `origin_x/y`, `width_px`,
`height_px`, `cell_size_mapunits` der eigenen Zeile).

💣 **EIN FINGERABDRUCK MIT LÜCKE IST SCHLIMMER ALS DER GLOBALE.** Der globale meldete zu oft
„veraltet" — laut, teuer, aber sicher. Einer mit Lücke meldet „aktuell" für ein Raster, das es nicht
ist, und dann rechnet die Wegfindung auf einem Gelände, das der Editor nie gesehen hat. Deshalb
prüft der Test beide Hälften **einzeln**, mit Gegenprobe (C2: ein fremder Gipfel *ohne* Nachbarschaft
darf nichts ändern — sonst misst C1 nur die Anzahl).

💣 **Die Naht ist die teuerste Stelle:** Schreibweg und Status müssen denselben Wert rechnen, sonst
gilt **jedes** Raster für immer als veraltet. Das Status-SELECT brauchte dafür drei zusätzliche
Spalten (`cell_size_mapunits`, `origin_x`, `origin_y`) — **genau dieselbe Falle, die dort eine Zeile
tiefer schon für die fünf V12-Regler ausgeschrieben steht.** Festgenagelt in F1–F3.

### Der N+1 ist mit gefallen

`avesmapsTerrainReadStampInputs` fuhr **zwei** Queries je Upload; der zweite (JOIN über
`ecosystem_area` × `ecosystem_region`) las die höhentragenden Flächen — und zwar **nur** für den
globalen Stempel, in den ihre `geometry_revision` eingingen. Der Fingerabdruck je Gebirge braucht
das nicht: die eigene `geometry_revision` steht ohnehin in derselben Zeile. Bei 69 Requests pro Lauf
war das 69× ein JOIN für nichts. Jetzt **ein** Query (F4/F5).

✅ **Der verbleibende Gipfel-Scan ist billig — am 06.10.2026 an der Live-Datenbank gemessen**, und
das widerlegt die Vermutung, die diesen Absatz zuerst gefüllt hat. `EXPLAIN` auf
`WHERE feature_type = 'label' AND is_active = 1 AND feature_subtype IN ('berggipfel','vulkan')`:

```
type: range   key: idx_map_features_type_active   rows: 229   Extra: Using index condition
```

Ein Index-Range-Scan über **229** Zeilen, kein `ALL` über die ~12.000 der Tabelle. 🔴 **Ein Cache
dafür wäre Überkonstruktion** — und er wäre riskant gewesen: sein Schlüssel müsste jede Änderung an
Gipfeln *und* Flächen erfassen, und ein zu grober Schlüssel liefert veraltete Fingerabdrücke, also
genau den gefährlichen Zustand („aktuell", obwohl nicht).

⭐ Der entfernte **zweite** Query bleibt trotzdem richtig entfernt: er lief 69× pro Lauf für einen
Wert, den niemand mehr liest. Billig und überflüssig ist immer noch überflüssig.

⚠️ Dass `map_features` nirgends im Repo angelegt wird (Schema in der Live-DB, AGENTS.md §10), bleibt
die Ursache dafür, dass so eine Frage nur mit DB-Zugang zu beantworten ist.

🔴 **Der globale Erzeuger bleibt als Funktion stehen**, mit Totmarke: `terrain-store-test.php` hält
an ihm die `ecosystem_revision`-Lehre fest. Er hat keinen Aufrufer im Pfad mehr (F2).

---

## 5. Fallen

💣 **Der Riegel lässt den Lauf nicht auf der Hälfte stehen.** Er lehnt nichts ab und bricht nichts
ab — er schreibt nur weniger. Ein Lauf über 69 Gebirge läuft durch wie vorher; das war der
entscheidende Vorzug gegenüber der verworfenen Sperre, die am 40. Gebirge ein `409` geworfen hätte.

💣 **Keine Transaktion, und bewusst keine.** Der Riegel liest, entscheidet und schreibt entweder ein
UPDATE oder den INSERT — alles einzeln, wie vorher. 🔴 Wer hier eine Transaktion um beides legt, muss
wissen, dass `Ensure`-Helfer in MySQL implizit committen (AGENTS.md §11, Quellen-Umbau Schritt 5) und
ein `commit()` danach „There is no active transaction" wirft, während alles geschrieben ist.

🪤 **Die Datei ist CRLF.** Mehrzeilige Edits darauf sind die Falle aus AGENTS.md §9; der Einbau lief
deshalb über ein Skript, das die Ankerstellen **genau einmal** finden muss und sonst nichts schreibt
(`preg_replace`-null-Falle). Zeilenenden nach dem Einbau gegengeprüft.

⚠️ **Der Blob-Vergleich setzt voraus, dass `gzdeflate` deterministisch ist.** Gleiche Eingabe, gleiche
Stufe (6), gleiche Ausgabe — das gilt für zlib, aber es ist eine Annahme über eine Bibliothek. Sollte
sie je brechen, ist die Folge harmlos: der Riegel greift nicht mehr und es wird geschrieben wie
vorher.

---

## 6. Tests

`api/_internal/app/__tests__/gebirgsraster-unveraendert-test.php` — **21 Zusicherungen**, drei Teile:

- **A) die Entscheidung** (rein, ohne DB): gleiche Form + gleicher Blob → nicht schreiben; jedes
  einzelne abweichende Formfeld → schreiben; fehlende Zeile → schreiben; fehlendes Feld → keine
  Gleichheit, auch am Kartennullpunkt (A6b); Zahlen als PDO-Strings → numerischer Vergleich.
- **B) der Rückgabewert** nennt das unveränderte Raster beim Namen, statt `written` zu verbiegen.
- **C) der Einbau**, am Quelltext festgenagelt **mit dem Tokenizer** (nicht `preg_replace`, siehe
  AGENTS.md §11, sync-monitor-Falle): der Blob-Vergleich steht in SQL, der Riegel steht VOR dem
  INSERT, und sein Zweig zieht **beide** Stempel nach und kehrt zurück.

**Mutationsprobe (06.10.2026), mit Byte-Gegenprobe:** 6 Mutationen, 4 sofort gefangen, 1 äquivalent
(`!=` statt `(float)`-Vergleich — bei numerischen Spalten verhaltensgleich), **1 überlebte und hat
eine echte Testlücke aufgedeckt** (die Anwesenheitsprüfung, siehe A6b oben). Nach Ergänzung gefangen.

**Ganzes Testfeld vor dem Push gefahren** (Muster aus `deploy-avesmaps-strato.yml`): 437 PHP-Dateien,
davon rot nur das vorbestehende `linkcheck/link-url-test.php` (echter DNS-Abruf, kein
Regressionssignal); 592 JS-Dateien, null rot.

---

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
