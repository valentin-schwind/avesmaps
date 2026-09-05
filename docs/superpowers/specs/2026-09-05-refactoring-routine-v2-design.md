# Die Refactoring-Routine v2 — Arbeitspakete, Vorprüfung als Skript, Agenten, Perf — Entwurf

**Stand:** 2026-09-05 · **Status:** vom Owner am 05.09.2026 im Gespräch freigegeben (GO), wartet auf die
Durchsicht dieser Datei · Vorgänger: `2026-08-31-refactoring-routine-design.md` (bleibt gültig, wo v2
nichts anderes sagt).

Die Routine `avesmaps-refactoring` (täglich 08:00, `~/.claude/scheduled-tasks/avesmaps-refactoring/`)
bekommt ein **Arbeitspaket-Rückgrat**, ihre vier gelernten Vorprüfungen als **Skript**, eine
**Agenten-Kontrolle** vor jedem Commit, einen streng gerahmten **Perf-Riegel**, einen
**Überwachungsmodus** für die Zeit nach den Paketen und die Regel **„Lehre → SKILL.md“**.

---

## 0. Owner-Entscheide (05.09.2026, alle im Gespräch getroffen)

1. **Perf-Umbauten darf die Routine selbstständig bauen, mit Messbeleg** — nach einer **Probe von drei
   Paketen**, die noch dein GO brauchen. Erst wenn drei Perf-Pakete mit GO sauber durch sind, gilt die
   Selbstständigkeit (§7).
2. **Ein Paket ist eine Momentaufnahme.** Die Routine muss den heutigen Stand kennen und Pakete
   nachziehen oder verwerfen (§4). Owner: „wichtig ist, dass deine anweisungen commit-stabil sind.“
3. **Doppelungen gehen nie ohne das WARUM auf die Liste.** Ein Doppelungs-Paket trägt einen Agentenlauf,
   der belegt, warum sich zwei Fassungen unterscheiden, und eine Empfehlung — erst damit ist es für den
   Owner entscheidbar (§9.3). Owner: „weil ich auch nicht einschätzen kann, warum ein unterschied existiert.“
4. **IIFE-Module, CSS-Blätter und `index.html` fasst die Routine nicht an.** Dafür braucht es einen
   größeren Plan; er ist nicht Teil dieses Entwurfs (§15).
5. **Die fünf Ergänzungen** (Nachprüfung des Vorlaufs · Wächter-Test fürs Rückgrat · Sperrzeile ·
   Doppelungen mit Warum · Bilanz als Zahlenreihe) sind angenommen.

---

## 1. Der Anlass: das Verfahren hat kaum noch Ziele, und die Lehren stehen nur in Prosa

Gemessen am 05.09.2026 (Rangwert = Zeilen × Commits in 180 Tagen, Produktivdateien):

- **95 Dateien über 1000 Zeilen, nur 21 davon abgekühlt** (≥ 5 Tage), **17** davon mit globalen
  Funktionen. Das ist der gesamte Vorrat des einzigen Verfahrens von v1.
- Die größten Brocken kennt v1 gar nicht: `html/wiki-sync-settlement-editor.html` (5273 Zeilen, **185**
  globale Funktionen inline), `html/landschaften-editor.html` (137), `html/wiki-sync-monitor.html` (118);
  die PHP-Libs `api/_internal/app/ecosystem.php` (5913), `api/_internal/map/features.php` (4277),
  `api/_internal/app/feature-sources.php` (3320); die IIFE-Module `review-garetien-importer.js` (6868),
  `wege-editor.js` (3065), `territory-editor-embedded.js` (3091).
- Vier Läufe, drei Umbauten, **vier Lehren** — und alle vier stehen in `liste.md` als Prosa in
  Verworfen-Einträgen, keine in der Anweisung, keine als Werkzeug.
- Die Anweisung ist an zwei Stellen inzwischen falsch: `git rebase --autostash` (scheitert hier
  zuverlässig) und der Deploy-Riegel, der nur `in_progress` prüft (ein Push bricht den **wartenden** Lauf
  ab, AGENTS.md §9 vom 05.09.2026).

🔴 **Was v1 richtig gemacht hat, bleibt:** Wegwerf-Worktree, Abkühlfrist 5 Tage, Ausschlussliste,
negatives Gedächtnis, Fingerabdruck, volles Testfeld, Deploy-Riegel, Stille. Die Abkühlfrist wird
**nicht** gesenkt — 74 der 95 großen Dateien wurden in den letzten vier Tagen angefasst; an vielen
Tagen „nichts“ zu melden ist richtig, nicht schwach.

---

## 2. Das Arbeitspaket-Rückgrat

**Datei:** `docs/refactoring-arbeitspakete.md` im Repo. Nicht im Routine-Verzeichnis: die Routine liest
`origin/master` in ihrem Worktree, andere Sitzungen und der Owner sehen und ergänzen es, und ein
Abhaken ist ein Commit mit Geschichte.

**Ein Paket:**

```
### P-007 · api/_internal/app/ecosystem.php · Verfahren C
- Status: offen
- Stand: <sha> · Blob: <blob-hash der Zieldatei>
- Block: „Klimabänder“ — avesmapsClimateReadBands … avesmapsClimateAssertNotDerived (14 Funktionen, ~470 Zeilen ab Z. 2210)
- Ziel: api/_internal/app/ecosystem-klima.php, require_once an der Blockstelle
- Vorprüfung (05.09.2026): Ladezeit-Bezug 0 · Register 0 · Quelltext-Tests 2 (Namen außerhalb) · vm-Bindung n/a · Konstanten vor der Blockstelle: 3, alle definiert
- Fallen: <was der Vorprüfer NICHT sieht und ein Mensch wissen muss>
- Verlauf: 05.09. angelegt (Analyse)
```

**Zustände:** `offen` · `GO nötig` · `in Arbeit (<datum>)` · `erledigt (<sha>)` · `verworfen (<grund>)`.
Nur der Owner setzt `GO nötig` → `offen` (eine Zeile im Dokument, gepusht). Nur die Routine setzt
`in Arbeit`/`erledigt`/`verworfen`; jede Änderung bekommt eine Zeile unter `Verlauf`.

**Kopf des Dokuments:** eine optionale **Sperrzeile** `Sperre: <datum> <grund>`. Steht sie da, analysiert
die Routine nur und pusht nichts — für Tage mit sechs Deploys in einer Stunde, ohne die Aufgabe zu
löschen.

**Wer schreibt was:** die Erstfüllung kommt aus der Analyse dieses Vorhabens (§14). Danach füllt der
Überwachungsmodus nach (§9). Der Owner und andere Sitzungen dürfen Pakete anlegen; die Routine prüft
sie wie ihre eigenen (§4).

💣 **Der Fingerabdruck (Einfügungen ≈ Löschungen) rechnet NUR über Code**, nie über `docs/`:
`git diff --stat -- . ':!docs' ':!*.md'`. Sonst kippt ihn das Abhaken im selben Commit.

🔴 **Wächter-Test** `tools/refactoring/__tests__/arbeitspakete.test.js` (läuft am Deploy-Tor — 💣 nicht unter `docs/`: das Tor fährt nur `js` und `tools`): jedes Paket
trägt `Stand` und `Blob` in gültiger Form, jeder Status ist einer der fünf, jedes `erledigt` nennt einen
SHA, dessen Zieldatei-Geschwister im Baum existiert. Ohne ihn wird das Dokument in zwei Wochen zur
Lüge — das Handbuch brauchte 13 Tage dafür (AGENTS.md §9).

---

## 3. Vier Verfahren statt eines

| | Verfahren | Ziel | Sicherheitsgrund |
|---|---|---|---|
| **A** | JS-Schnitt (v1): Lauf globaler Funktionsdeklarationen → Geschwisterdatei `<name>-<thema>.js`, ein `<script>` daneben | 17 abgekühlte JS-Dateien | globale Funktionen sind gehoistet und werden zur Laufzeit gerufen |
| **B** | Inline-Script einer Editorseite auslagern: Lauf aus dem `<script>`-Block von `html/*.html` → `js/pages/<seite>-<thema>.js`, `<script src>` **direkt vor** dem Inline-Block | settlement-editor 185, landschaften-editor 137, monitor 118, citymap-editor, powerline-editor | dieselbe wie A; der Stempler läuft über `html/*.html` (AGENTS.md §7), also kein Hand-`?v=` |
| **C** | PHP-Lib teilen: Lauf reiner Funktionen → `<name>-<thema>.php`, `require_once` **an der Blockstelle** | ecosystem.php, features.php, feature-sources.php, settlements.php, citymap-sync.php … | alle Aufrufer und Tests `require`n die Lib und sehen die Geschwisterdatei transparent (Lehre 04.09.2026) |
| **D** | Perf-Umbau mit Messbeleg | Perf-Pakete | §7 |

**Grenzen aller Schnitte (A/B/C), scharf wie in v1:** kein Zustand auf oberster Ebene im Block, kein
Ladezeit-Code, thematisch zusammenhängend, Dateiname nach Bestand, geteilter Zustand bleibt drüben.

💣 **B: der neue `<script src>` steht VOR dem Inline-Block, nie dahinter.** Ein Inline-Block darf beim
Laden auf einen verschobenen Namen zeigen (Ladezeit-Bezug), nur wenn die Datei davor geladen ist —
und selbst dann gilt die Vorprüfung (§5): ein Ladezeit-Bezug auf einen Blocknamen blockt, weil ein
Test die Seite allein laden kann.

💣 **C: die Konstanten, die der Block liest, müssen VOR der `require_once`-Stelle definiert sein.** Die
Vorprüfung zählt sie; der Block wandert nur, wenn alle davor stehen. Am Dateikopf ginge es auch (PHP
hoistet Funktionen), aber die Blockstelle ist gegen jede künftige Auswertung auf Dateiebene immun.

⚠️ **C: der Kopfkommentar der Geschwisterdatei folgt der SPRACHE der Zieldatei** (AGENTS.md §8, „match
the file you are editing“) — `citymaps.php` ist englisch, `ecosystem.php` deutsch.

**Nicht-Ziele der Routine** (unverändert plus Owner-Entscheid 4): IIFE-Module, CSS-Blätter, `index.html`
(nur additiv), Build-Produkte (`political-territory-editor-inline.css`), `i18n-en.js`, `third-party/`,
`editor-handbuch.html`. Die IIFE-Brocken kommen als **Befund** auf die Liste (§9), nie als Paket.

---

## 4. Commit-Stabilität: ein Paket gilt, weil es HEUTE nachgeprüft wurde

🔴 **Die Regel:** ein Paket gilt nicht, weil es in der Liste steht, sondern weil es gegen den heutigen
Stand nachgeprüft wurde.

- Jedes Paket trägt **`Stand: <sha>`** und **`Blob: <hash>`** der Zieldatei (`git rev-parse <sha>:<pfad>`).
  Zeilennummern sind Orientierung; **die Identität eines Blocks sind seine Funktionsnamen** (erster,
  letzter, Menge).
- **Frischelauf bei JEDEM Lauf über ALLE offenen Pakete** (nicht nur das, das dran ist):
  `git rev-parse origin/master:<pfad>` gegen `Blob`. Gleich → gilt. Verschieden → **überholt**: die
  Vorprüfung (§5) läuft für die Datei neu, der Block wird an seinen Namen wiedergefunden, und das Paket
  wird **nachgezogen** (neuer `Stand`/`Blob`, Verlaufszeile „nachgezogen: <was sich bewegt hat>“) oder
  **verworfen** (`verworfen (überholt: <grund>)`) — Block nicht mehr zusammenhängend, Namen weg, neue
  Ladezeit-Bezüge oder Testbindungen, Datei weg.
- Bei **Perf-Paketen** ist die Vorher-Messung im Paket nur ein Hinweis; der ausführende Lauf misst seine
  **eigene Basis gegen HEAD**, bevor er etwas ändert (§7).
- **`erledigt` wird nie aus der Liste geglaubt**, sondern an der Zieldatei gelesen: die Geschwisterdatei
  steht, der Block ist weg. Steht das nicht so, meldet der Frischelauf einen Widerspruch (kein
  Selbstheilen — eine Rückverschiebung durch eine andere Sitzung ist eine Entscheidung, keine Panne).
- **Die Anweisung selbst hält dieselbe Disziplin:** keine Zeilennummern, keine festen Zahlen („397
  Tests“), nur Namen und **selbstprüfende Zählungen** (die Dateizahl des Testlaufs gegen das Muster des
  Workflows, wie in v1).

⚠️ Der Frischelauf kostet Sekunden (ein `git rev-parse` je Paket); die Vorprüfung läuft nur für die
überholten Dateien.

---

## 5. Die Vorprüfung wird ein Skript

**`tools/refactoring/vorpruefung.mjs`** — reines Node, ohne Abhängigkeiten, lesend. Drei Nutzer, ein
Werkzeug: die Analyse jetzt, die Routine täglich, die Agenten beim Prüfen. Die vier Lehren der Läufe
vom 01.–04.09.2026 werden damit von Prosa zu Prüfung.

**Eingabe:** eine Zieldatei (JS, HTML mit Inline-Script, PHP), optional ein Blockvorschlag (erster und
letzter Funktionsname). **Ausgabe:** JSON — `datei`, `blob`, je globaler Funktion `name`, `von`, `bis`,
`gebunden: [gründe]`; dazu `freieBloecke` (zusammenhängende Läufe ungebundener Funktionen ohne
Zustand dazwischen, mit Zeilenzahl).

**Die vier Prüfungen (plus eine nullte):**

0. **Kein Zustand, kein Ladezeit-Code im Block.** Oberste Ebene ohne Funktionsrümpfe: `var`/`let`/`const`,
   Aufrufe, IIFEs, `window.x = …`. Ein Block, der so etwas enthält, ist keiner.
1. **Ladezeit-Bezug** (Dump-Bericht, 01.09.): irgendein Token auf oberster Ebene der Datei (außerhalb
   aller Funktionsrümpfe) nennt einen Blocknamen — z. B. `window.avesmapsOpenDumpReport = …`. Blockt.
2. **Handgepflegtes Dateiregister** (`loadLoreList`, 02.09.): Treffer von `"<zielpfad>"` in `js/` und
   `tools/` (`.js`/`.mjs`). Das Skript listet sie; ob ein Treffer ein Register ist, das nachgezogen werden
   muss, entscheidet der Lauf (eine Zeile, wie das `<script>`-Tag) — der Agent (§8) prüft, ob er es getan hat.
3. **Quelltext-lesende Tests** (`route-plan.js`, 03.09.): Tests, die die Zieldatei als Text lesen und
   Funktionen **beim Namen** herausschneiden (`extract(`, `extractFunction(`, `indexOf("function N")`,
   Regex auf `function N`). Die herausgeschnittenen Namen sind gebunden.
4. **vm-Testbindung, transitiv** (`review-path-sync.js`, 04.09.): Tests, die die Zieldatei allein in
   einen `vm`-Kontext laden und Funktionen rufen. Aufrufgraph innerhalb der Datei → **Fixpunkt** über
   testgerufene und ladezeitreferenzierte Namen. Alles im Abschluss ist gebunden.

Für **PHP** entfallen 1 und 4 (transparente `require`-Kette), dazu kommt: **Konstanten** (`define`/`const`),
die der Block liest, und ob sie vor der Blockstelle definiert sind. Für **HTML** läuft alles auf dem
Text des Inline-Blocks; Prüfung 3 sucht auch Tests, die `html/*.html` lesen.

💣 **Drei Werkzeugfallen, die das Skript per Test festhält** (alle aus `liste.md`):
`\b` überlebt den Weg in ein Skript nicht → Wort-Token per `split(/[^A-Za-z0-9_$]+/)` und `Set`, nie
RegExp mit `\b` · `powerline-topology.js` trägt NUL-Bytes → jede Datei einzeln lesen, kein `grep`-Strom ·
`^function ` verfehlt `^async function ` → `^(async +)?function +`. Und: **Kommentare werden nicht
gestrippt** (`sed 's://.*::'` frisst `https://`).

🔴 **Test `tools/refactoring/__tests__/vorpruefung.test.js`** mit vier Fixtures, die die vier
historischen Fälle **nachbauen** und die erwartete Bindung behaupten — plus je Fixture eine
**Mutationsprobe** (die Bindung entfernen → der Befund muss verschwinden; dieselbe Bindung woanders
einbauen → er muss erscheinen). Ein Prüfer, der nur grün kann, ist keiner (AGENTS.md §11, mehrfach).

⚠️ **Was das Skript NICHT sieht, steht in seiner Ausgabe als Satz**, nicht als Schweigen: Closures in
IIFEs, dynamisch zusammengesetzte Namen (`window["avesmaps" + x]`), Aufrufe aus `.php`-Seiten, die JS
inline erzeugen. Dafür gibt es die Agenten (§8) und das Feld `Fallen` im Paket.

---

## 6. Der Lauf in v2 (Schrittfolge, ersetzt §3–§7 der Anweisung)

0. Gedächtnis lesen (`state.md`, `liste.md`), Sperrzeile im Rückgrat prüfen.
1. **Nachprüfung des Vorlaufs:** die Dateien von `last_commit` per Hash gegen die Live-Seite
   (`fetch(url + '?cb=…')` bzw. `curl`, je Datei EINE Anfrage; `api/_internal/` ist nicht abrufbar → dort
   zählt der grüne Folgelauf eines fremden Commits als Beleg, wie am 04.09.). Abweichung → Meldung, kein
   Selbstheilen (heilt nur eine Inhaltsänderung, AGENTS.md §9).
2. Wegwerf-Worktree auf `origin/master` (wie v1).
3. **Frischelauf** über alle offenen Pakete (§4).
4. **Kandidat:** oberstes `offen`-Paket nach Rangwert, dessen Datei abgekühlt (≥ 5 Tage) und im
   geteilten Baum unberührt ist (`git status --porcelain -- <ziel>` leer). Keins → **Überwachungsmodus**
   (§9), still enden.
5. Bauen nach Verfahren A/B/C/D.
6. **Riegel:** Fingerabdruck (nur Code) · Vorprüfung noch einmal gegen das Diff · volles Testfeld
   (Muster des Workflows, selbstprüfende Zählung, parallel) · **Agenten** (§8) · im Zweifel nichts.
7. **Deploy-Riegel v2** (§12), Commit (Code + Paketzeile), Push, Remote-SHA, eigenen Lauf beobachten,
   Live-Gegenprobe (eine Anfrage).
8. Gedächtnis fortschreiben: `state.md` (`last_run`, `last_commit`, `runs`, **`zeilen_ueber_1000`**),
   `liste.md` nur negativ, **Lehren → SKILL.md** (§10). Worktree entfernen — auch bei Abbruch.
9. Rückmeldung (§13).

---

## 7. Der Perf-Riegel (Verfahren D)

🔴 **Definition:** ein Perf-Umbau ist **gleiche Ausgabe, weniger Arbeit**. Ändert sich, was ein Aufrufer
zurückbekommt (Bytes, Reihenfolge, Felder), oder eine **Frische** (Cache-Frist, Abgleichtakt,
Revalidierung), ist es keine Perf-Änderung, sondern eine Verhaltensänderung → `GO nötig`, immer.

**Messbeleg = gezählte Arbeit vor Millisekunden.** `api_metric` zählt nur Aufrufe, keine Dauer, und
STRATO-Millisekunden rauschen um Faktor zwei (AGENTS.md §10, Cache-Miss 2.143 → 1.993 ms „Rauschen“).
Gezählt werden: Datenbankabfragen (zählender PDO-Wrapper über der SQLite-Fixture), Durchläufe
(Schleifenzähler), Bytes, DOM-Knoten, `JSON.parse`-Aufrufe. Millisekunden nur ergänzend, **Median aus
drei Läufen**, und sie dürfen nicht schlechter werden.

- Jedes Perf-Paket trägt sein **Messskript** `tools/perf/<paket>.mjs` bzw. `.php` (kein Test — es
  läuft nicht am Tor; die Werte hängen am Rechner — deshalb heißt es nie `test-*.mjs`, das Muster des Tors würde es sonst mitfahren). Ausgabe: JSON `{ gezaehlt: {…}, ms_median,
  ausgabe_sha256 }`. Das Skript nennt seine **Fixture** (vorhandene SQLite-Fixtures der Tests, echte
  Nutzlast-Stichproben unter `tools/perf/fixtures/`).
- **Ausführung:** Basis gegen HEAD messen → Umbau → dieselbe Messung. **Ausgabe byteweise gleich**
  (`ausgabe_sha256`), gezählte Größe gesunken um den im Paket genannten Schwellwert, Millisekunden nicht
  schlechter. Sonst verwerfen.
- **Nach dem Deploy genau EINE Live-Anfrage** als Gegenprobe (`X-Avesmaps-ETag`/Status/Bytes gegen
  vorher). Fällt sie durch → die Routine **revertiert ihren eigenen Commit** (mit Deploy-Riegel) und
  meldet. 💣 Nie in einer Schleife nachmessen — das saturiert PHP-Worker und sieht aus wie ein
  Datenbankausfall (CLAUDE.md).
- 🔴 **Probe:** die ersten **drei** Perf-Pakete stehen auf `GO nötig`. Erst wenn drei mit GO ohne
  Zwischenfall durch sind (Owner-Blick auf Messbeleg und Live-Gegenprobe), setzt der Owner in der
  SKILL.md die Zeile `perf_probe: bestanden` — ab dann `offen`.
- ⚠️ **Der Behauptungsprüfer (§8) hat bei Perf zwei Zusatzfragen:** ist die Fixture repräsentativ (die
  Live-Nutzlast hat 12.216 Features, 1.438 Katalogzeilen — eine Fixture mit 12 Zeilen misst nichts), und
  verschiebt der Umbau Arbeit nur (etwa aus der Anfrage in einen Cache, der bei jedem Schreiben fällt)?

---

## 8. Agenten-Kontrolle vor jedem Commit

**Bauteil:** `.claude/agents/refactoring-widerleger.md` (getrackt, Vorlage `usability-konsistenz.md`,
`tools: Read, Grep, Glob, Bash`, `model: sonnet`). Er baut nichts, ändert nichts, fragt den Live-Server
nie. Der Aufrufer nennt ihm **Rolle**, Diff, Paket und die Ausgabe der Vorprüfung.

**Drei Rollen, drei Aufrufe, nach dem Owner-Muster** (Rolle mit Interesse, nicht Prüfauftrag;
Memory `multi-agent-adversarial-review`):

1. **Der Widerleger:** „Finde den Aufrufpfad, der nach diesem Schnitt anders läuft. Es gibt einen —
   such ihn in `.php`-Seiten, die JS inline erzeugen, in dynamischen Namen, in Tests, die die Seite
   allein laden.“ Antwort: Fundstelle oder „widerlegt: <warum es keinen gibt>“.
2. **Der Testbindungs-Prüfer:** „Fahre `tools/refactoring/vorpruefung.mjs` gegen HEAD und gegen das
   Diff. Suche, was das Skript laut seiner eigenen Liste nicht sieht. Wurde jedes Register nachgezogen?“
3. **Der Behauptungsprüfer:** „Prüfe **jeden Satz** der Commit-Nachricht und des Paket-Eintrags gegen
   den Diff. Welche Zusicherung bricht eine Rücknahme NICHT? Bei Perf: Fixture repräsentativ, Ausgabe
   wirklich gleich, Arbeit verschwunden oder nur verschoben?“

🔴 **Ein nicht widerlegter Fund blockt den Commit.** Die Routine darf einen Fund entkräften (mit
Beleg im Bericht), nie übergehen. Zwei Funde in Folge an derselben Datei → `verworfen (Agentenfund)`.

⚠️ **Rückfall:** kann die Routine-Sitzung keine Agenten starten (unbekannt bis zum ersten Lauf — keine
Routine im Haus tut es heute), läuft die Vorprüfung ohnehin, und der Bericht sagt **ausdrücklich** „ohne
Agenten geprüft“. Ein Perf-Paket wird ohne Agenten **nicht** gebaut.

💣 **Die Agenten lesen einen Baum, der sich nicht bewegt:** sie laufen NACH dem Bauen und VOR dem
Commit, und die Routine fasst währenddessen nichts an. Und sie dürfen kein `git checkout/stash/restore`
(Memory `pruefagent-setzt-arbeitsbaum-zurueck`).

Kosten: drei Aufrufe mit Sonnet je Schritt — Minuten, nicht Stunden; an Tagen ohne Schritt null.

---

## 9. Der Überwachungsmodus

**Auslöser:** kein ausführbares Paket (Liste leer, alles heiß, alles `GO nötig`, Sperre). Dann rechnet der
Lauf die Analyse neu und füllt das Rückgrat — er baut nichts.

**9.1 Was er rechnet** (Sekunden, alles lesend):
- Rangliste (wie v1) · Vorprüfung über alle abgekühlten Dateien mit globalen Funktionen → freie Blöcke
  ≥ 150 Zeilen werden Pakete (A/B/C).
- **Totfund** (wie v1, melden, nie löschen).
- **Doppelungs-Scan:** normalisierte Funktionsrümpfe (Whitespace, Kommentare, Bezeichner-Umbenennung
  auf Positionsnummern) über alle Produktivdateien; gleiche oder zu ≥ 90 % gleiche Rümpfe in
  verschiedenen Dateien sind Kandidaten.
- **Perf-Gerüche:** Abfragen in Schleifen (`foreach`/`for` mit `->query(`/`->prepare(`/`->execute(` im
  Rumpf), DDL/`SHOW COLUMNS` in Funktionen, die Lese-Endpunkte rufen, `querySelectorAll`/`getComputedStyle`
  in Schleifen, `JSON.parse(JSON.stringify(` auf großen Objekten.

**9.2 Was daraus Pakete werden:** freie Blöcke → `offen` (A/B/C). Perf-Gerüche → `offen` nach der Probe,
davor `GO nötig` (§7). IIFE-/CSS-/index.html-Funde → **Befund** in `liste.md` unter `## Für den Owner`,
kein Paket (Owner-Entscheid 4).

**9.3 Doppelungen: nur mit dem WARUM.** 🔴 Ein Doppelungs-Paket entsteht erst nach einem Agentenlauf
(Rolle **„Der Historiker“**: `git blame` je abweichender Zeile, Commit-Betreff und Entwurf dazu, Aufrufer
beider Fassungen, Tests, die die Abweichung festhalten) mit einer **Empfehlung**: zusammenlegen mit der
Vereinigung des Verhaltens · beide behalten, weil der Unterschied gewollt ist (mit Beleg) · eine ist
tot. Das Paket trägt Befund, Warum und Empfehlung und steht auf `GO nötig`. Ohne Warum kein Paket —
der Owner kann sonst nicht entscheiden.

**9.4 Bilanz:** `state.md` bekommt je Lauf `zeilen_ueber_1000: <summe>`; am 1. des Monats meldet die
Routine die Reihe (wie v1, aber gemessen statt geschätzt). Bleibt sie zwei Monate steigend, sagt sie
dem Owner, dass es wieder eine Kampagne braucht.

---

## 10. Lehren → SKILL.md

🔴 **Regel:** was den nächsten Lauf **anders handeln** lässt, steht in `SKILL.md` unter `## Lehren`,
datiert, höchstens fünf Zeilen, mit dem Satz, was der Lauf jetzt anders tut. `liste.md` bleibt reines
negatives Gedächtnis (was verworfen wurde und warum). Eine Lehre, die in der Liste steht und nicht in
der Anweisung, ist keine — sie wird beim nächsten Lauf überlesen (so standen vier Läufe lang vier
Lehren neben der Anweisung).

**Sofort einziehende Lehren (aus `liste.md`, 01.–04.09.2026):** die vier Vorprüfungen (jetzt §5) · Rebase
scheitert hier (`reset --hard origin/master` + `cherry-pick`, Gegenprobe `git merge-base --is-ancestor`;
**kein `git stash drop`**, der Stash-Stack ist geteilt) · Kopfkommentar bei Blöcken unter ~250 Zeilen auf
8 Zeilen anlegen, sonst kippt der Fingerabdruck am eigenen Kopf · ein roter Smoke-Test ist kein
Codebefund, bevor ein unbeteiligter Endpunkt gegengemessen ist · `\b`, NUL-Bytes, `async function`.

⚠️ **Größendeckel:** überschreitet `SKILL.md` 300 Zeilen, verdichtet der Lauf den Abschnitt `## Lehren`
(zusammenlegen, was dieselbe Regel sagt) — nie streichen, was eine Regel trägt.

---

## 11. Nachprüfung des Vorlaufs

Am Anfang jedes Laufs (§6 Schritt 1). Grund: der Deploy des Routine-Commits vom 04.09. stand auf
`failure` (Smoke-Test), und ein vergifteter Stempel fällt sonst niemandem auf. Verglichen wird der
Hash der gestempelten Datei ohne `?v=` (Memory `roter-deploy-welcher-schritt`).

---

## 12. Deploy-Riegel v2 und Push

- `gh run list --workflow=deploy-avesmaps-strato.yml --limit 3` lesen: ein **`in_progress` UND ein
  `queued`/`pending`** heißen warten (AGENTS.md §9, präzisiert 05.09.2026 — `cancel-in-progress: false`
  schützt den laufenden, der wartende wird ersetzt). Nach zwei Versuchen belegt → heute nicht pushen.
- **Kein `git rebase --autostash`** (scheitert an der Zeilenenden-Normalisierung, bleibt still ungetan).
  Bei Reject: `git fetch`, `git reset --hard origin/master`, `git cherry-pick <eigener commit>`,
  Gegenprobe `git merge-base --is-ancestor origin/master HEAD`. Hat sich die **Zieldatei** bewegt →
  verwerfen statt cherry-picken.
- Alles Übrige wie v1: nur eigene Pfade stagen, `git add` und `git commit` in EINEM Zug (AGENTS.md
  §11, Prüfhaken-Commit-Falle), Remote-SHA, eigenen Lauf beobachten.

---

## 13. Rückmeldung

Wie v1 (still außer bei einem Schritt; kein Discord), plus: Ergebnis der Nachprüfung des Vorlaufs nur
bei Abweichung · „ohne Agenten geprüft“, wenn es so war · Zahl der nachgezogenen/verworfenen Pakete
im Frischelauf in **einer** Zeile · neue `GO nötig`-Pakete namentlich (die brauchen den Owner).

---

## 14. Bauteile und Reihenfolge

| Schritt | Bauteil | Test |
|---|---|---|
| 1 | `tools/refactoring/vorpruefung.mjs` | `tools/refactoring/__tests__/vorpruefung.test.js` (vier historische Fixtures + Mutationsproben) |
| 2 | **Die große Analyse** (Rangliste, Vorprüfung über alle abgekühlten Dateien, Inline-Scripts, PHP-Libs, Totfund, Doppelungen, Perf-Gerüche) — mechanisch per Skript; danach **drei Rollen-Agenten**, die die Paketliste **widerlegen** sollen (Backend/STRATO: „wo bricht das unter Last?“ · Skeptiker mit den 💣-Narben aus AGENTS.md · Behauptungsprüfer je Paket) | — (Ergebnis wird Schritt 3) |
| 3 | `docs/refactoring-arbeitspakete.md` (Erstfüllung, jedes Paket mit `Stand`/`Blob`/Vorprüfung/Fallen; Doppelungen erst nach dem Historiker-Lauf) | `tools/refactoring/__tests__/arbeitspakete.test.js` |
| 4 | `.claude/agents/refactoring-widerleger.md` | — (Prosa; die Rollen werden im ersten Lauf gefahren) |
| 5 | `SKILL.md` v2 (Schrittfolge §6, Verfahren §3, Riegel §7/§8/§12, `## Lehren` §10) und `state.md` (`zeilen_ueber_1000`) | — |
| 6 | Memory-Notiz (Routinen-Ort, v2-Stand) | — |

Repo-Anteile (1, 3, 4) gehen als Tool-/Doku-Commits live; nichts davon ist für Besucher sichtbar. Jeder
Push mit Deploy-Riegel v2 und ausschließlich eigenen Pfaden — der geteilte Baum trägt gerade 23
fremde geänderte Dateien.

---

## 15. Außerhalb dieses Entwurfs

- **IIFE-Module, CSS-Blätter, `index.html`** — brauchen ein Muster, das es im Haus nicht gibt (Namensraum
  für Closure-Module, `@import`-Teilung mit Hand-Stempeln in `.php`-Seiten, die Inline-Glue in
  `index.html`). Eigener Entwurf, eigene Sitzung mit dem Owner.
- **Ob die Routine-Sitzung Agenten starten kann** — Antwort nach dem ersten Lauf; Rückfall gebaut.
- **Der 404-Zweig des Smoke-Tests** im Deploy-Workflow empfiehlt weiter den Revert; Owner-Befund vom
  04.09., nicht Teil der Routine.
