# Bericht 2 — KANN: was besser werden kann

169 Befunde (149 direkt so gemeldet, 20 aus der AKUT-Liste hierher abgestuft). Sie machen
nichts kaputt. Sie kosten Zeit, erzeugen Missverständnisse und laden zu Fehlern ein — bei
Menschen wie bei den KI-Agenten, die hier täglich mitarbeiten.

Dieser Bericht gruppiert nach Thema und nennt jeweils die aussagekräftigsten Fälle mit Zahl.
Die vollständige Einzelaufstellung mit allen Belegen steht in [`befunde/`](befunde/).

---

## 1. Die auffälligste Zahl: 4,24 MB, die jeder Besucher umsonst lädt

**Avesmaps liefert alles unkomprimiert aus.** In der `.htaccess` steht kein einziger
Kompressions-Eintrag; nur `map-features.php` gzippt selbst. Gemessen, indem die echten Antworten
lokal komprimiert wurden:

| | roh | gzip | spart |
|---|---|---|---|
| JS + CSS zusammen | 5,97 MB | 1,73 MB | **4,24 MB** |
| Politik-Layer (Zoom 3) | 2,90 MB | 756 KB | 74 % |
| Abenteuer | 1,81 MB | 237 KB | 87 % |
| Landschaften | 1,70 MB | 479 KB | 72 % |
| Orte-API | 938 KB | 210 KB | 78 % |
| Kartensammlung | 521 KB | 55 KB | 90 % |

Das ist **eine Zeile Konfiguration** gegen mehrere Megabyte pro Erstbesuch — und es entlastet
zugleich die Leitung, über die sich der PHP-Pool immer wieder aufstaut. Es ist der mit Abstand
beste Aufwand-Nutzen-Posten des ganzen Tests.

Belegt: `curl --compressed` liefert **kein** `Content-Encoding` zurück.

**Weitere Leistungsposten** (14 Befunde): tote und doppelte Felder im Kartenpayload (3,04 MB roh,
aber nur 196 KB gzip — der Gewinn liegt nicht am Draht, sondern beim `JSON.parse` und im
Speicher der Besuchergeräte); 1.079 KB Editor-JavaScript, das auch anonyme Besucher laden;
DDL in den Notaus-Schaltern; ein Delta-Abruf mit 5,87 MB Sockel; `information_schema`-Proben
Spalte für Spalte statt in einer Abfrage.

**Drei abgestufte Leistungsbefunde** stehen hier ausdrücklich als *nicht* dringend: der 5-Hz-Timer
wurde nachgebaut und gemessen (**1,8 µs je Tick, 0,0009 % CPU**), der Client-Cache fasst
während eines Ladevorgangs ohnehin zusammen, und der Dateicache wird bei jedem Schreibvorgang
vollständig geleert.

---

## 2. Die Instruktionen für KI-Agenten sind stellenweise falsch — und werden geglaubt

An diesem Projekt arbeiten regelmäßig mehrere KI-Sessions parallel. Eine falsche Instruktion
richtet mehr Schaden an als gar keine, weil ihr geglaubt wird.

**63 überprüfbare Behauptungen aus AGENTS.md wurden einzeln im Code nachgeprüft.** 51 stimmen,
**8 stimmen nicht mehr**, 2 sind unvollständig, 1 ist inhaltlich falsch.

| AGENTS.md sagt | tatsächlich |
|---|---|
| „~117 `<script>`-Tags" | **217** |
| „~50 Module in `js/map-features/`" | **103** |
| „~14 Tabellen als Inline-DDL" | **47** |
| „Zoom `0..5`, Markerstufe bis 6" | **`maxZoom: 7`** |
| „`entity_type` ∈ 6 Werte" | **8** (`powerline`, `ecosystem` fehlen) |

Die Zoom-Angabe ist die gefährlichste — Zoombänder sind ein Dauerthema, und wer „0..5" glaubt,
rechnet falsch. Die `entity_type`-Lücke steht ausgerechnet in dem 💣-Absatz, der erklärt, das
Erweitern sei „eine Zwei-Zeilen-Änderung".

Dazu: **§10 „Known fragilities" nennt zwei Fehler als offen, die behoben sind** — wer sie liest,
jagt Gespenster. Und **acht Widersprüche**, drei davon innerhalb von AGENTS.md selbst.

**Das Gedächtnis dagegen ist makellos:** 279 Indexeinträge, 279 Dateien, kein toter Verweis in
beide Richtungen, keine Doppelung, keine toten Querverweise. 16 Dateien stichprobenhaft gegen
den Code geprüft — 15 aktuell.

**Struktur:** 47 % von AGENTS.md stecken im Dokumentenverzeichnis, 39 % in sieben deutschen
Absätzen, davon einer mit 4.168 Zeichen. Ein englischer Rahmen mit deutschem Kern. Ein frischer
Agent nimmt daraus weniger mit, als die Länge vermuten lässt.

---

## 3. Der Code ist für Agenten an drei Stellen systematisch irreführend

**13 globale Namen werden von je zwei Dateien definiert**, die beide in `index.html` stehen — im
ganzen `js/`-Baum sind es 24. Neun tragen einen Warnhinweis, **vier nicht**. Im schlimmsten Fall
ist der Gewinner kommentarlos und der Verlierer trägt einen Kommentar, der einen **dritten,
falschen** Gewinner nennt: wer ihm folgt, pflegt toten Code.

**Fünf Dateien werden dynamisch nachgeladen und tauchen in keiner Ladereihenfolge auf.** Das
schönste Beispiel steht in [`js/routing/route-priority-queue.js`](../../js/routing/route-priority-queue.js):
77 Zeilen, davon 63 ein Min-Heap für Dijkstra — und am Ende eine anonyme Funktion, die per
`setTimeout` einen **Regionen-Polygon-Editor** ins Dokument hängt. Wer die Ladereihenfolge liest,
um zu verstehen, welche Definition gewinnt, sieht diese Datei nie.

**Zwölf verschiedene Feldnamen für „Art des Dings".** `type` bedeutet in *einer* Datei fünf
verschiedene Sachen; `kind` deckt fünf Domänen ab. Das Paar `art` (Anzeige-Label) / `art_key`
(Schlüssel) ist vorbildlich gelöst — mit 💣 und eigenem Test — aber es ist das einzige.

**22 `datei:zeile`-Verweise in Kommentaren zeigen daneben**, einer um 344 Zeilen. Die Verweise
auf `docs/` stimmen dagegen alle 51.

**Ausdrücklich gut** und beim Aufräumen zu erhalten: **null TODO/FIXME/HACK** im ganzen Projekt,
und die 27 Reihenfolge-Kommentare in `index.html` nennen jeweils Grund, Folge und Datum.

**Testbarkeit:** 36 % aller Zeilen werden von keinem Test auch nur erwähnt; bei `js/territory/`
sind es **92 %**. Die größte Datei dort hat 3.106 Zeilen, 112 Funktionen — und *eine*
Abschnittsüberschrift.

---

## 4. Der API-Vertrag ist fast fertig — und die API spricht eine andere Sprache als die Seite

**Der Umschlag steht besser als sein Ruf:** 530 kanonische Fehlerstellen gegen **12** flache,
und alle 12 liegen in `api/discord/` (4 Dateien). Milestone M3 ist beim Umschlag praktisch am
Ziel.

Die verbleibende Lücke ist der **Statuscode**: 36 Stellen in 18 Dateien reichen ein internes
Ergebnis-Array mit hart verdrahtetem **HTTP 200** durch. Steht darin `ok:false`, geht ein
Fehler als Erfolg hinaus. (Abgestuft, weil keine dieser Dateien zum stabilen Vertrag gehört
und alle eigenen Clients `data.ok` auswerten — aber Fremdnutzer tun das nicht.)

**API und Oberfläche teilen kein einziges Feld.** Die Route liefert `cost`, ein Dijkstra-Gewicht;
die angezeigten Stunden sind `cost × 3,57`, mit zwei Konstanten, die **nur in `js/config.js`**
stehen. Gesamtstrecke, Reisezeit und Luftlinie kommen im Vertrag gar nicht vor. Wer die API
benutzt, kann die Zahlen der Seite nicht nachbauen. Fünf dokumentierte Anfrageparameter
(`include_air_distance`, `include_steps`, `include_rests`, …) werden geprüft, zurückgespiegelt —
und **nie gelesen**.

**Was ausdrücklich stimmt** und nachgerechnet wurde: die Routen-Arithmetik ist exakt (Summe der
Etappen = geometrische Länge = gefahrene Strecke, Abweichung 0; Summe der Kosten = Gesamtkosten,
Abweichung 0), und der ×25-Aufschlag für Querfeldein wird korrekt aus allen gemeldeten Strecken
herausgerechnet.

---

## 5. Deutsch, Englisch und die Umlaute

**78 Stellen in `api/`** schreiben Meldungen, die Redakteure zu lesen bekommen, mit ae/oe/ue
statt mit Umlauten: „Bitte eine gueltige Lizenz waehlen", „Der Name des Herrschaftsgebiets ist
ungueltig", „Bitte einen Titel fuer die Karte angeben."

Die Regel dagegen steht im eigenen Haus: AGENTS.md sagt beim Änderungsverlauf ausdrücklich, die
ae/oe/ue-Umschreibung des Hausstils gelte „für Kommentare, nicht für das, was im Fenster steht".

**Dahinter steckt eine Entscheidung, die dem Owner gehört:** **654 von 916** Fehlermeldungen der
API sind deutsch und werden über `apiErrorMessage()` direkt in der Oberfläche angezeigt —
während §8 vorgibt, interne API-Fehlermeldungen künftig auf Englisch zu schreiben. Beides
gleichzeitig geht nicht. Entweder sind diese Meldungen Oberfläche (dann gehören sie ins
i18n-System, mit echten Umlauten), oder sie sind intern (dann brauchen sie eine deutsche
Entsprechung im Client). Der Ist-Zustand ist die schlechteste der drei Möglichkeiten.

Die englische Oberfläche selbst ist übrigens **vollständig und sauber** — geprüft über alle
Ansichten, ohne abgeschnittene Beschriftungen. Nur das **Meldeformular bricht mitten drin ab**
(6 fehlende Schlüssel plus ein nicht übersetzbares Auswahlfeld).

---

## 6. Die Designsprache wird an zwei Stellen systematisch unterlaufen

**Der ↗-Pfeil für externe Links fehlt millionenfach** — 15 von 15 im Hinweise-Fenster, 120 von
296 im Ortsinfofenster. `docs/design-language.md` schreibt ausdrücklich vor, ihn **einmal
zentral** zu setzen und „never hand-typed per link". Genau das passiert: von Hand, inkonsistent,
in derselben Datei mal so und mal so.

**Die auffälligste Farbe der Anwendung steht außerhalb des Token-Systems.** `ROUTE_STYLE.color`
in [`js/config.js:47`](../../js/config.js:47) ist der Literalwert `#1452F7`. Das ist *kein*
Verstoß gegen „kein Blau" — diese Regel meint die Oberfläche, nicht die Kartendarstellung, und
Blau ist für eine Routenlinie weltweit Konvention. Es ist ein Verstoß gegen **die eine Regel**
der Designsprache: „Never hardcode a colour — always use a token."

Dazu: **besuchte interne Links werden browser-lavendel**, weil die Hausfarbe nur
`a[target="_blank"]` trifft.

---

## 7. Die Editoren: die Spalten stimmen, alles drumherum nicht

Gemessen bei fest 1045 × 496 CSS-px: **sechs von sieben Editoren haben exakt 336 / 336 / 336** —
die Owner-Regel trägt. Nur „Vorkommen" schert aus (320 / 310,3 / 310,3).

Auseinander läuft der Rahmen:

| Merkmal | Streuung |
|---|---|
| Fensterhüllen | 3 verschiedene |
| Klassenpräfixe | 5 verschiedene |
| Kacheln im Menüband | 3 / 4 / 5 / 5 / 5 / 7 / 9 (104 bis 323 px breit) |
| Position von „Löschen" | 4 verschiedene Stellen |
| Wort für „zuletzt gesynct" | 4 verschiedene |
| Verhalten bei fehlendem Pflichtfeld | 3 verschiedene (2× Meldung, 1× Schweigen) |
| Zahl für dieselbe Menge Wege | 3 verschiedene |

Dazu: die **Kartensammlung hat keinen Quellen-Editor**, obwohl 347 von 457 Karten eine Quelle in
`feature_sources` führen. Und der **Duplikat-Vermerk** wird sauber gespeichert und **nirgends
angezeigt** (`grep review_note js/` = 0).

**Ausdrücklich gut** und erhaltenswert: die Erklärtexte im Karteneditor und die Gesten-Bündelung
im Landschaften-Protokoll — die bessere Protokollfassung existiert also bereits im Haus und
könnte Vorbild für die anderen sein.

---

## 8. Sackgassen: was niemand mehr anfasst

**Der abgeschaltete Online-Kategorien-Crawler** ist der größte Posten: `start_run`/`crawl_step`
sind durch den Dump ersetzt — **~864 Zeilen PHP** in drei Dateien, fünf Aktionen und **drei
Tabellen** (`wiki_crawl_queue`, `wiki_path_queue`, `wiki_region_queue`) ohne einen einzigen
Aufrufer.

Weitere Schreibgräber: **`source_merge_log`** (die zugesagte „Umkehrbarkeit" der
Quellen-Zusammenführung hat keinen Leser) und **`contact_message`** (Name, E-Mail, Text — der
einzige SELECT ist ein COUNT fürs Rate-Limit).

Im Payload reisen **`data-source` (129 KB)** und **`data-place-name` (55 KB)** ohne einen
einzigen Leser mit.

**`tools/smoke_test.py`** — der Stabilisierungs-Check aus AGENTS.md §11 — prüft eine gelöschte
Datei und einen Pfad von vor dem M1-Umbau. Er kann nicht mehr grün werden. Drei weitere in §11
als maßgeblich geführte Dokumente beschreiben die Struktur von vor demselben Umbau.

Jeder dieser Befunde trägt in [`befunde/3-sackgassen.md`](befunde/3-sackgassen.md) die konkrete
Grep-Abfrage samt Trefferzahl — und der Agent nennt ausdrücklich, was er **nicht** gemeldet hat,
weil es absichtlich so ist (`api/wiki-sync.php` als Fallback, die drei 410-Stubs, `api/discord/*`
mit externen Aufrufern).

---

## 9. Zwei Hausaufgaben in der Werkzeugkiste

**Sechs PHP-Tests melden mit dem dokumentierten Befehl fälschlich rot.** Sie brauchen zusätzlich
`pdo_sqlite`, `sqlite3` und `gd`. Ein Testlauf sieht dadurch aus wie „7 kaputte Tests", während
tatsächlich genau einer echt rot ist. Ein Startbefehl im Repo würde das beenden:

```
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
    -d extension=php_curl.dll -d extension=php_pdo_sqlite.dll \
    -d extension=php_sqlite3.dll -d extension=php_gd.dll <test>
```

**`.claude/` ist 2,2 GB groß und steht nicht in `.gitignore`.** Darin liegen 57
Worktree-Kopien. Ein einziges `git add -A` würde versuchen, sie einzuchecken — AGENTS.md §9
verbietet das ausdrücklich, aber diese Regel trägt damit gerade 2,2 GB Last. Zwei Agenten sind
außerdem beim Greppen darauf hereingefallen und haben vervielfachte Trefferzahlen gemessen.
Ein Eintrag in `.gitignore` löst beides.

---

## 10. Rechtliches, das keine Gefahr, aber eine Lücke ist

Die Grundausstattung ist für ein Fanprojekt **überdurchschnittlich**: keine Fremdschriften, kein
CDN, kein Drittanbieter-Tracking, Wappen über einen Proxy statt hotverlinkt, echte im Code
durchgesetzte Lizenzriegel — und **keine Geheimnisse im Repo**, auch nicht in der Historie.

Die Lücken sind Formfehler und fehlende gute Praxis:

- **`NOTICE.md` erwähnt Wiki Aventurica überhaupt nicht**, obwohl je Kartenaufruf **1,11 Mio.
  Zeichen** wörtlicher Wiki-Fließtext mitreisen. Die Quellzeile ist da, die Lizenz des Wikis
  wird nirgends benannt.
- **Ein neu hochgeladenes Siedlungsbild gilt ungefragt als „Von uns KI-generiert"** und ist
  sofort öffentlich. Für den Altbestand ist dieser Standardwert eine dokumentierte
  Owner-Entscheidung; für **neue** Uploads ist er eine potenziell **falsche Herkunftsangabe**.
- **Kein Löschkonzept** für Nutzerbeiträge, **kein Melde-Weg** für Bewertungen, **kein
  Datenschutzhinweis** am Meldeformular, **Melder-Pseudonyme** im öffentlichen Payload.
- Ein **PHPSESSID-Cookie** für jeden anonymen Besucher, das die Datenschutzerklärung nicht
  erwähnt (technisch notwendig, also unbedenklich — aber unvollständig beschrieben).
- **Platzhalter-Cover werden hotverlinkt**, und Cover haben kein Herkunftsfeld.

---

## Die vollständige Aufstellung

| Bericht | KANN-Befunde |
|---|---|
| [Sackgassen](befunde/3-sackgassen.md) | 22 |
| [KI-Lesbarkeit](befunde/4-ki-lesbarkeit.md) | 22 |
| [Tiefendurchlauf](befunde/9-tiefendurchlauf.md) | 15 |
| [Performance](befunde/1-performance.md) | 14 |
| [Recht](befunde/7-recht.md) | 12 |
| [Instruktionen & Gedächtnis](befunde/5-instruktionen.md) | 11 |
| [API](befunde/6-api.md) | 10 |
| [Tagespflege & Editoren](befunde/12-tagespflege.md) | 10 |
| [Melder](befunde/10-melder.md) | 9 |
| [Schnelldurchlauf](befunde/8-schnelldurchlauf.md) | 8 |
| [Integrität](befunde/2-integritaet.md) | 7 |
| [Meldungs-Empfang](befunde/11-empfang.md) | 7 |
| [Koordination](befunde/0-koordination.md) | 2 |
| aus AKUT abgestuft | 20 |
| **gesamt** | **169** |
