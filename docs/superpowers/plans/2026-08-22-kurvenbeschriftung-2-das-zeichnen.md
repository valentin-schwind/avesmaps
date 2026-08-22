# Kurvenbeschriftung, Plan 2: Das Zeichnen

> **Für agentische Bearbeiter:** ERFORDERLICHE UNTER-FÄHIGKEIT: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Eine Landschaftsfläche mit eingeschalteter Kurvenbeschriftung zeigt ihren Namen Glyphe für
Glyphe entlang der Kurve, die Plan 1 vom Server liefert — im selben Schriftbild wie heute, von links
nach rechts lesbar, ohne fehlenden Buchstaben, und eingereiht in die vorhandene Kollisionskaskade.

**Entwurf:** `docs/superpowers/specs/2026-08-22-kurvenbeschriftung-design.md` (§4.1, §4.2, §4.4, §5,
§7.2, §7.3). **Vorgänger:** `docs/superpowers/plans/2026-08-22-kurvenbeschriftung-1-die-kurve.md`,
live auf `master` seit 22.08.2026.

---

## Der Befund, der diesen Plan halbiert hat

⭐ **Das Projekt zeichnet seit Monaten Text entlang gebogener Linien — und beim Entwerfen wusste es
niemand.** `js/map-features/map-features-path-label-canvas-overlay.js` (1032 Zeilen) setzt die Weg-,
Fluss- und Kraftlinien-Namen Glyphe für Glyphe auf ihre Linie, tangential gedreht, mit Halo,
„identisch zur Siedlungs-/Regionen-Label-Optik" (Kopfkommentar der Datei). Es liegt dort fertig:

| vorhanden | was der Entwurf dafür vorsah |
|---|---|
| `layoutGlyphsAlong()` — „die reine RECHNUNG, ohne zu zeichnen" | §7.3: „Glyphe für Glyphe zu setzen: Position aus der Bogenlänge, Drehung aus der Tangente, Sperrung als Zuschlag je Lücke" |
| `labelSpanRunsLeftward(pts, textLen)` — vergleicht die x-Lage am Anfang mit der am Ende | §4.1, die Regel des Owners: *„kannst du nicht überprüfen ob der 1. buchstabe weiter links ist wie der letzte?"* |
| `findFreePlacement()` — schiebt das Label **entlang seiner Linie**, bis es frei steht | §7.2: *„versuch die kurven verschiebung bis zu ein paar einheiten/pixel in die kollisionsvermeidung aufzunehmen"* |
| `findCalmLabelCenter()` + `PATH_LABEL_MAX_TURN_DEG` | §5.1, „das ruhigste Stück" und die 30°-Beruhigung |
| `labelOccupancyBlocksGlyphs(avesmapsLabelOccupancy, …)` | §7.2: „Es wird kein zweites Kollisionssystem gebaut." |

🔴 **Also wird nichts davon neu gebaut.** Der Prototyp (`docs/kurvenlabel-mockup.html`) hat diese
fünf Dinge unabhängig noch einmal erfunden, weil er ein eigenständiges Dokument ist. Sie ein zweites
Mal in den Produktionscode zu schreiben wäre genau die Divergenz, vor der AGENTS.md an sechs Stellen
warnt — und die Leserichtungsprobe ist obendrein die Zusicherung, die beim Entwerfen **zweimal**
danebengegangen ist. Eine zweite Fassung davon ist eine zweite Gelegenheit, sie falsch zu bekommen.

⚠️ **Damit ist §11 des Entwurfs an einer Stelle überholt.** Die Tabelle „Bauteile (erwartet)" nennt
`js/map-features/map-features-labels.js` als Ort des Zeichnens. Das war die beste Vermutung, bevor
das Overlay gefunden war. Gezeichnet wird in `map-features-path-label-canvas-overlay.js`, gerechnet
in zwei neuen reinen Modulen. Die Korrektur gehört beim Abschluss in den Entwurf zurück.

💣 **Und der Preis dieses Geschenks: die 1032 Zeilen sind von KEINEM Test gedeckt.** Ein `grep` über
`js/*/__tests__/` nach `path-label-canvas-overlay`, `layoutGlyphsAlong` und `PATH_LABEL_MAX_TURN`
findet nichts. Alles steckt in einer IIFE (`(function initPathLabelCanvasOverlay() { … })()`) und
wird nirgends herausgereicht — **ein Test ist heute gar nicht möglich**, nicht bloss nicht
geschrieben. Deshalb beginnt dieser Plan mit einem Umzug und einem Netz, nicht mit einer Kurve.

---

## Architektur

Drei Schichten, von unten nach oben:

1. **`js/map-features/curved-label-layout.js` (neu, rein).** Die zwoelf Rechenfunktionen (plus eine
   Konstante), die heute in der IIFE des Overlays sitzen. Alle zwoelf sind nachgemessen rein: kein `ctx`, kein `map`,
   kein `document`, kein Leaflet. Vorbild und Präzedenzfall ist
   `js/map-features/label-placement.js` — dort steht seit dem **22.08.2026** der Kommentar
   *„🔴 translateLabelRect / rectanglesOverlap / expandRect stehen seit 22.08.2026 in
   js/map-features/label-placement.js -- rein, ohne DOM, und dadurch auch vom Vorschaupanel im
   Fenster „Zoombänder" nutzbar."* Das Haus hat diesen Umzug also vor drei Tagen aus genau diesem
   Grund schon einmal gemacht.
2. **`js/map-features/curve-label-fit.js` (neu, rein).** Die Passung aus §4.4 und die Verteilung aus
   §4.2: aus einer projizierten Kurve, einem Namen und den Schriftmassen werden bis zu drei
   Textfenster mit Sperrung, Verlängerung und gegebenenfalls verkleinerter Schrift.
3. **Kanal C im Overlay.** `redraw()` malt die Kurvenlabels als dritten Kanal neben Kanal A
   (Wegnamen als Ganzes) und Kanal B (je Segment).

**Die Einreihung in die Kaskade ist die tragende Entscheidung, und der Entwurf hat sie bereits
getroffen** (§7.2). Die Beschriftung der Karte läuft heute in einem festen Dreitakt, nachzulesen in
`scheduleLabelCollisionResolution()` (`js/map-features/map-features-label-collisions.js:1`):

```
1. resolveRegionLabelCollisions()           -> Gebietsnamen, liefert ihre Rechtecke
2. resolveLabelCollisions(regionLabelRects) -> Orts- und Freilabels, (1) sind feste Hindernisse
3. publishLabelOccupancy(...) + Overlay.redraw() -> Weg- und Flussnamen weichen allem aus
```

Ein Landschaftsname ist heute Teilnehmer von **Stufe 2**. Ihn ans Ende zu hängen, weil er künftig auf
Canvas gemalt wird, wäre eine **Rangänderung, getarnt als Zeichenänderung** — Dorfnamen gewännen
gegen „Schwarze Sichel". §7.2 verbietet das ausdrücklich: *„An der Prioritätenordnung wird in diesem
Vorhaben nichts geändert."* Also wird das Kurvenlabel **vor** Stufe 2 platziert und geht als
Vorbelegung neben `regionLabelRects` hinein — den Weg gibt es schon, er wird nur ein zweites Mal
benutzt.

**Technik:** Vanilla JS, kein Build, Leaflet 1.9.4 (`L.CRS.Simple`), Canvas 2D. Tests mit
`node` + `vm.runInThisContext` nach Hausmuster (`js/map-features/__tests__/zoombaender-vorgabe.test.js`).

---

## Was dieser Plan NICHT enthält, und warum

* 🔴 **§4.3 „Ohne Kurvenbeschriftung ist der Name eine ganz normale Gerade" gehört zu Plan 3.**
  Die Regel nimmt einem Flächenlabel die alte Handdrehung. Heute ist die Kurvenbeschriftung bei
  **genau einer** Region eingeschaltet (den Drachensteinen, bei der Live-Abnahme von Plan 1) — die
  Umstellung der rund **56** gedrehten Flächen kommt erst mit Plan 3. Wer §4.3 hier ausliefert,
  richtet 56 Namen gerade, die niemand eingeschaltet hat, und nimmt ihnen die Drehung, bevor sie eine
  Kurve bekommen. Die Regel und ihr Umstelllauf gehen zusammen live, oder gar nicht.
* 🔴 **§7.4 „Bearbeiten-Modus: neu ausrichten" gehört zu Plan 3**, zusammen mit den beiden Dialogen,
  die den Zug am Label überhaupt erst auslösen.
* Die Kachel „Darstellung" und ihre einstellbaren Werte (§6) gehören zu Plan 4. **Die Werte aus §6.1
  stehen in diesem Plan als Konstanten in `curve-label-fit.js`** — mit den Vorgaben aus der Tabelle,
  an einer Stelle, benannt, damit Plan 4 sie nur noch aus der Einstellung speisen muss.

⭐ **Deshalb ist dieser Plan trotz sichtbarer Wirkung gefahrlos live zu stellen:** eingeschaltet ist
eine einzige Fläche. Was schiefgehen kann, ist an einer Fläche zu sehen, nicht an 644.

---

## Globale Vorgaben

Jede Aufgabe unterliegt zusätzlich diesen Zeilen.

* **Kommentare, Commit-Betreffs und Doku auf DEUTSCH** (AGENTS.md §8). Bezeichner bleiben, wie die
  Nachbardatei sie schreibt — das Overlay ist englisch benannt (`layoutGlyphsAlong`), die neuen
  Module folgen dem, wo sie an es andocken.
* **Keine hartkodierte Farbe, kein hartkodierter Radius** (AGENTS.md §12). Halo und Füllung kommen
  aus dem vorhandenen Label-Stil, nicht aus einer neuen Zahl.
* **Nie ein `?v=` von Hand** (AGENTS.md §7). Neue Dateien bekommen in `index.html` ein nacktes
  `<script src="…">`; der Deploy stempelt.
* **`ASSET_VERSION` ist hier NICHT zu bumpen** — die gilt den dynamisch geladenen Editor-Assets
  (AGENTS.md §7.2), und dieser Plan fasst keines an.
* 💣 **Vor dem Push läuft das GANZE Testfeld** (AGENTS.md §9), nicht nur die eigenen Tests — inklusive
  der 21 PHP-Tests unter `tools/wikidump/test-*.php`, die das übliche Muster nicht findet. Ein roter
  Test lädt **nichts** hoch und vergiftet den `?v=`-Stempel.
* 💣 **Geteilter Arbeitsbaum: niemals `git add -A`.** Nur eigene Pfade, einzeln benannt, und vor jedem
  Commit `git diff --staged` lesen — andere Sitzungen haben in diesem Checkout offene Arbeit.
* **Koordinaten:** GeoJSON und der Payload führen `[x, y]`, Leaflet `[lat, lng] = [y, x]`. Jeder
  Tausch wird bewusst gemacht und im Kommentar benannt.
* **Zoom:** die Karte geht bis 7, die Schriftskala klemmt bei `VISUAL_MAX_ZOOM_LEVEL = 5`. Wer eine
  Zoomstufe liest, sagt dazu, welche der beiden er meint.

---

## Dateien

| Datei | Rolle |
|---|---|
| `js/map-features/curved-label-layout.js` | **neu, rein.** Die zwoelf Rechenfunktionen, aus dem Overlay umgezogen |
| `js/map-features/__tests__/curved-label-layout.test.js` | **neu.** Das Netz, das es für diese Rechnung nie gab |
| `js/map-features/curve-label-fit.js` | **neu, rein.** Passung (§4.4), Sperrung (§5.2), Verteilung (§4.2) |
| `js/map-features/__tests__/curve-label-fit.test.js` | **neu.** |
| `js/map-features/map-features-path-label-canvas-overlay.js` | die zwoelf Funktionen raus, Kanal C rein |
| `js/map-features/map-features-labels.js` | `curveLine` / `curveMax` aufnehmen; Marker unterdrücken |
| `js/map-features/map-features-label-collisions.js` | Kurvenlabels vor Stufe 2 platzieren, Rechtecke als Vorbelegung |
| `js/map-features/__tests__/curve-label-normalize.test.js` | **neu.** Der Payload kommt am Label an |
| `index.html` | zwei `<script>`-Zeilen, in der richtigen Reihenfolge |

---

## Aufgabe 1: Die reine Rechnung verlässt das Overlay

Ein **reiner Umzug**. Keine Zeile Logik ändert sich. Das ist die ganze Aufgabe und zugleich ihre
einzige Zusicherung — denn es gibt noch keinen Test, der etwas anderes bemerken würde.

**Dateien:**
- Anlegen: `js/map-features/curved-label-layout.js`
- Ändern: `js/map-features/map-features-path-label-canvas-overlay.js`
- Ändern: `index.html`

**Schnittstellen:**
- Verbraucht: nichts.
- Liefert: zwölf globale Funktionen, Signaturen **unverändert** gegenüber heute —
  `labelSpanRunsLeftward(pts, textLen)`,
  `buildLabelTurningProfile(pts, stepPx)`,
  `labelSpanTurning(profile, fromDist, spanLen)`,
  `findCalmLabelCenter(profile, center, textLen, searchPx, anchorWeight)`,
  `labelWindowHalf(textLen, fontSize, relief)`,
  `layoutGlyphsAlong(pts, chars, widths, ls, perpOffset, fontSize)`,
  `labelGlyphRunTurningDegrees(glyphs)`,
  `glyphsHullBox(glyphs, fontSize)`,
  `orderDodgeOffsets(slide, step, profile, wishCenter, textLen, anchorWeight)`,
  `findFreePlacement(chainPts, cum, total, wishCenter, chars, widths, ls, fontSize, blockedByOwnKind, turningProfile)`,
  `sliceLabelWindowAt(pts, cum, total, center, half)`,
  `cumulativeLengths(pts)`,
  sowie die Konstante `LABEL_TURN_PROFILE_STEP_PX`.

⚠️ **`pathLabelBendSettings()` zieht NICHT um.** Sie liest die vier `PATH_LABEL_*`-Stellgrössen des
Wege-Kanals (`map-features-path-labels.js`, live justierbar über `?pathtune=1`) und gehört diesem
Kanal. Ein Kurvenlabel hat seine eigenen Werte (§6.1).

- [ ] **Schritt 1: Die Blöcke wörtlich herausnehmen**

Aus `map-features-path-label-canvas-overlay.js` die Zeilenbereiche (Stand `origin/master`,
22.08.2026) 71–105, 106–110 (`LABEL_TURN_PROFILE_STEP_PX`), 112–136, 137–149, 150–182, 183–187,
201–292, 293–307, 308–345, 346–375, 376–421, 422–443, 444–453 entnehmen und in die neue Datei setzen.

⚠️ **Beim Verlassen der IIFE fällt genau eine Ebene Einrückung weg** (das Haus rückt mit Tabs ein).
Das ist die **einzige** erlaubte Änderung. Kein Umbenennen, kein „während ich schon dabei bin", keine
Vereinfachung, kein zusätzlicher Riegel — auch dann nicht, wenn beim Lesen etwas auffällt. Was
auffällt, gehört als Befund in den Bericht, nicht in diesen Umzug: ein Umzug, der nebenbei etwas
verbessert, ist mit keinem mechanischen Vergleich mehr abzusichern, und mehr als einen mechanischen
Vergleich hat diese Aufgabe nicht.

Kopf der neuen Datei:

```js
// Die reine Rechnung hinter Text auf einer gebogenen Linie: Glyphenlagen aus der Bogenlaenge,
// Drehung aus der Tangente, Leserichtung, Huellbox, Ausweichreihenfolge.
//
// 🔴 Umgezogen am 22.08.2026 aus map-features-path-label-canvas-overlay.js -- WOERTLICH, nur eine
// Ebene Einrueckung weniger. Grund: die Kurvenbeschriftung der Landschaftsflaechen braucht dieselbe
// Rechnung, und in der IIFE des Overlays war sie weder erreichbar noch pruefbar. Derselbe Schnitt
// wie bei label-placement.js drei Tage zuvor: was rein ist, steht fuer sich und laesst sich testen.
//
// 💣 Rein heisst hier woertlich rein: kein ctx, kein map, kein document, kein Leaflet. Nachgemessen
// an allen zwoelf Funktionen. Wer hier etwas ergaenzt, das die Karte anfasst, nimmt der Datei ihren
// einzigen Vorzug -- dann steht der naechste Test wieder vor einer IIFE.
//
// ⚠️ findFreePlacement fragt zwei GLOBALE der Belegungskarte ab (avesmapsLabelOccupancy,
// labelOccupancyBlocksGlyphs), beide per `typeof` abgesichert. Im Test sind sie schlicht nicht da,
// und dann weicht nur niemand aus -- das ist gewollt, kein Loch.
```

- [ ] **Schritt 2: Die Stellen im Overlay entfernen und die Datei einreihen**

Die Blöcke aus dem Overlay löschen. Alle Aufrufstellen bleiben **unverändert** — die Funktionen sind
jetzt Globale statt IIFE-lokal, der Aufruf sieht gleich aus.

In `index.html` die neue Datei **vor** dem Overlay einhängen. Die Ladereihenfolge ist ein Vertrag
(AGENTS.md §3):

```html
<script src="js/map-features/curved-label-layout.js"></script>
```

⚠️ Die Zeile gehört unmittelbar **vor** `map-features-path-label-canvas-overlay.js`. Sie darf auch
vor `map-features-label-occupancy.js` stehen — die zwei Globalen werden erst zur Laufzeit gefragt,
nicht beim Laden.

- [ ] **Schritt 3: Beweisen, dass es ein Umzug war und keine Bearbeitung**

Das ist der Kern der Aufgabe. Der Vergleich läuft mechanisch, nicht mit dem Auge:

```bash
node -e '
const cp = require("child_process");
const fs = require("fs");
const alt = cp.execSync("git show origin/master:js/map-features/map-features-path-label-canvas-overlay.js", {encoding:"utf8", maxBuffer: 1<<24});
const neu = fs.readFileSync("js/map-features/curved-label-layout.js", "utf8");
const namen = ["labelSpanRunsLeftward","buildLabelTurningProfile","labelSpanTurning","findCalmLabelCenter",
  "labelWindowHalf","layoutGlyphsAlong","labelGlyphRunTurningDegrees","glyphsHullBox",
  "orderDodgeOffsets","findFreePlacement","sliceLabelWindowAt","cumulativeLengths"];
function rumpf(text, name) {
  const i = text.indexOf("function " + name + "(");
  if (i < 0) return null;
  const spalte = text.slice(0, i).split("\n").pop();   // die Tabs vor "function"
  const zu = spalte + "}";
  const raus = [];
  for (const z of text.slice(i).split("\n")) { raus.push(z); if (z === zu) break; }
  return raus.join("\n").replace(/^\t/gm, "").trimEnd();
}
let schlecht = 0;
for (const n of namen) {
  const a = rumpf(alt, n), b = rumpf(neu, n);
  if (a === null) { console.log("FEHLT ALT: " + n); schlecht++; continue; }
  if (b === null) { console.log("FEHLT NEU: " + n); schlecht++; continue; }
  if (a !== b)    { console.log("ABWEICHUNG: " + n); schlecht++; continue; }
  console.log("gleich: " + n);
}
process.exit(schlecht ? 1 : 0);'
```

Erwartet: zwölfmal `gleich:` und Rückgabewert 0. ⚠️ Meldet es `ABWEICHUNG`, ist etwas mitverändert
worden — zurücknehmen, nicht nachbessern.

- [ ] **Schritt 4: Syntax und die stille Verdopplung**

```bash
node --check js/map-features/curved-label-layout.js && node --check js/map-features/map-features-path-label-canvas-overlay.js && echo "beide syntaktisch in Ordnung"
```

💣 **Und danach der Verdopplungstest.** Ein index-basiertes Ersetzen dupliziert stumm, und **zwei
gleichnamige Funktionen sind gültiges JavaScript** — die spätere gewinnt, die Syntaxprüfung schweigt,
und die Karte ist live tot:

```bash
for n in labelSpanRunsLeftward layoutGlyphsAlong findFreePlacement glyphsHullBox cumulativeLengths; do
  a=$(grep -c "function $n(" js/map-features/curved-label-layout.js)
  b=$(grep -c "function $n(" js/map-features/map-features-path-label-canvas-overlay.js)
  echo "$n: neu=$a overlay=$b"
done
```

Erwartet für jede Zeile exakt `neu=1 overlay=0`.

- [ ] **Schritt 5: Das ganze Testfeld**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done; echo "Lauf beendet"
```

Erwartet: keine `ROT:`-Zeile. ⚠️ Diese Aufgabe hat noch keinen eigenen Test — das Testfeld belegt
hier nur, dass nichts anderes gebrochen ist. Der eigene Beleg ist Schritt 3.

- [ ] **Schritt 6: Im Browser nachsehen, dass Wegnamen noch stehen**

Das ist die Abnahme dieser Aufgabe (AGENTS.md §9: „Abnahme heisst ABLAUF, nicht Maß"). Karte öffnen,
auf eine Gegend mit benannten Strassen zoomen (Zoom 5–6 um Gareth), und **wirklich hinsehen**: stehen
die Strassennamen auf ihren Strassen, gebogen, mit Halo? Fehlt einer? Steht einer auf dem Kopf? Ein
Umzug, der die Wegnamen zerstört, ist an dieser Stelle zu sehen und nirgends sonst.

Zusätzlich die Konsole auf `ReferenceError` prüfen — eine vergessene Funktion meldet sich genau so.

- [ ] **Schritt 7: Commit**

```bash
git add js/map-features/curved-label-layout.js js/map-features/map-features-path-label-canvas-overlay.js index.html
git diff --staged --stat
git commit -m "refactor(labels): die reine Rechnung hinter Text auf einer Kurve steht jetzt fuer sich"
```

---

## Aufgabe 2: Der Test, den es nie gab

Die Funktionen tragen live jeden Weg-, Fluss- und Kraftlinien-Namen der Karte und waren von **keinem**
Test gedeckt. Jetzt sind sie ladbar. Das Netz kommt vor dem ersten neuen Aufrufer — sonst gilt der
erste Fehler dem neuen Kanal, und niemand sieht nach, ob die Rechnung selbst schon so war.

**Dateien:**
- Anlegen: `js/map-features/__tests__/curved-label-layout.test.js`

**Schnittstellen:**
- Verbraucht: die Globalen aus Aufgabe 1.
- Liefert: nichts (Test).

- [ ] **Schritt 1: Den Test schreiben**

```js
// Die Rechnung hinter Text auf einer gebogenen Linie. 🔴 Diese Funktionen tragen live JEDEN Weg-,
// Fluss- und Kraftlinien-Namen der Karte und waren bis zum 22.08.2026 von keinem Test gedeckt --
// nicht aus Nachlaessigkeit, sondern weil sie in einer IIFE steckten und gar nicht ladbar waren.
// Seit dem Umzug in curved-label-layout.js geht es, also steht es hier.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

vm.runInThisContext(fs.readFileSync(path.join(__dirname, "..", "curved-label-layout.js"), "utf8"));

// Eine waagerechte Linie von links nach rechts, 400 px lang.
const rechts = [{x: 0, y: 100}, {x: 400, y: 100}];
// Dieselbe Linie rueckwaerts.
const links = [{x: 400, y: 100}, {x: 0, y: 100}];

// --- Leserichtung: die Regel des Owners (Entwurf §4.1) -------------------------------------------
// „kannst du nicht ueberpruefen ob der 1. buchstabe weiter links ist wie der letzte?"
assert.strictEqual(labelSpanRunsLeftward(rechts, 100), false, "nach rechts laufend ist NICHT leftward");
assert.strictEqual(labelSpanRunsLeftward(links, 100), true, "nach links laufend IST leftward");

// 💣 Der Fall, an dem die Regel beim Entwerfen zweimal gescheitert ist: fast senkrecht, minimal nach
// links. Ein Toleranzband um die Senkrechte laesst genau das durch -- gemessen wurde damals eine
// Sehne von -102°, die als „noch senkrecht" durchging. Entschieden wird am Vorzeichen von dx, nicht
// an einem Winkelband.
const fastSenkrechtLinks = [{x: 200, y: 0}, {x: 199, y: 300}];
assert.strictEqual(labelSpanRunsLeftward(fastSenkrechtLinks, 100), true,
  "1 px nach links ist nach links -- kein Toleranzband um die verbotene Lage");

// --- Glyphenlagen ---------------------------------------------------------------------------------
const zeichen = ["A", "B", "C"];
const breiten = [10, 10, 10];
const glyphen = layoutGlyphsAlong(rechts, zeichen, breiten, 0, 0, 12);
assert.ok(Array.isArray(glyphen), "eine passende Linie liefert Glyphen");
assert.strictEqual(glyphen.length, 3, "je Zeichen eine Glyphe");
assert.ok(glyphen[0].x < glyphen[2].x, "erste Glyphe links von der letzten");
assert.ok(Math.abs(glyphen[0].y - 100) < 0.001, "auf der Linie");
assert.ok(Math.abs(glyphen[0].angle) < 0.001, "waagerecht -> Drehung 0");

// 🔴 Zu kurz ist NULL, nicht eine gequetschte Reihe. Genau daran haengt Entwurf §4.4: ein
// abgeschnittener Buchstabe ist ein Laengenproblem und muss als solches erkennbar bleiben.
const kurz = [{x: 0, y: 0}, {x: 5, y: 0}];
assert.strictEqual(layoutGlyphsAlong(kurz, zeichen, breiten, 0, 0, 12), null,
  "passt der Text nicht, kommt null zurueck -- kein Teiltext");

// --- Bogenlaengen ---------------------------------------------------------------------------------
const knick = [{x: 0, y: 0}, {x: 30, y: 40}, {x: 30, y: 140}];
const kum = cumulativeLengths(knick);
assert.strictEqual(kum[0], 0);
assert.strictEqual(kum[1], 50, "3-4-5-Dreieck");
assert.strictEqual(kum[2], 150);

// --- Huellbox ---------------------------------------------------------------------------------
const box = glyphsHullBox(glyphen, 12);
assert.ok(box.right > box.left && box.bottom > box.top, "die Huelle hat Flaeche");
assert.ok(box.left < glyphen[0].x && box.right > glyphen[2].x, "sie umschliesst die Glyphen");

// --- Fenster schneiden ---------------------------------------------------------------------------
const gesamt = kum[kum.length - 1];
const fenster = sliceLabelWindowAt(knick, kum, gesamt, gesamt / 2, 20);
assert.ok(Array.isArray(fenster) && fenster.length >= 2, "das Fenster ist eine Linie");

// --- Drehprofil ---------------------------------------------------------------------------------
const profil = buildLabelTurningProfile(knick, LABEL_TURN_PROFILE_STEP_PX);
assert.ok(profil, "ein Profil entsteht");
const geradesProfil = buildLabelTurningProfile(rechts, LABEL_TURN_PROFILE_STEP_PX);
assert.ok(labelSpanTurning(geradesProfil, 0, 100) < 1, "eine Gerade dreht nicht");
assert.ok(labelSpanTurning(profil, 0, 150) > labelSpanTurning(geradesProfil, 0, 150),
  "der Knick dreht messbar mehr als die Gerade");

// --- Ausweichreihenfolge ---------------------------------------------------------------------------
const versatz = orderDodgeOffsets(60, 10, geradesProfil, 200, 100, 0);
assert.strictEqual(versatz[0], 0, "der Wunschplatz wird zuerst versucht");
assert.ok(versatz.length > 1, "und danach gibt es Ausweichplaetze");

// --- findFreePlacement ohne Belegungskarte ---------------------------------------------------------
// ⚠️ avesmapsLabelOccupancy und labelOccupancyBlocksGlyphs sind hier NICHT definiert. Beide werden
// per `typeof` abgefragt; ohne sie weicht niemand aus, und genau das wird hier festgehalten -- damit
// ein spaeterer Umbau, der die Abfrage in einen harten Zugriff verwandelt, hier auffliegt.
const platz = findFreePlacement(rechts, cumulativeLengths(rechts), 400, 200, zeichen, breiten, 0, 12, null, null);
assert.ok(platz && Array.isArray(platz.glyphs), "ohne Hindernisse steht der Name");

console.log("curved-label-layout: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Laufen lassen**

```bash
node js/map-features/__tests__/curved-label-layout.test.js
```

Erwartet: `curved-label-layout: alle Zusicherungen erfuellt`.

⚠️ **Schlägt eine Zusicherung fehl, ist der Test verdächtig, nicht der Code.** Die Rechnung steht
seit Monaten live und trägt jeden Wegnamen der Karte. Erst die Erwartung an der Wirklichkeit prüfen
(die Funktion lesen, die Zahl nachrechnen), dann urteilen — und wenn die Erwartung falsch war, sie
korrigieren **und im Bericht sagen, welche und warum**. Nur wenn die Rechnung wirklich falsch ist,
gehört sie repariert, und dann getrennt vom Umzug.

- [ ] **Schritt 3: Commit**

```bash
git add js/map-features/__tests__/curved-label-layout.test.js
git commit -m "test(labels): die Rechnung hinter Text auf einer Kurve ist jetzt gewacht"
```

---

## Aufgabe 3: Die Kurve kommt am Label an

Plan 1 hängt an jedes Label mit eingeschalteter Kurvenbeschriftung zwei Eigenschaften:
`properties.curve_label_line` (bis zu 32 Punkte, **`[x, y]`**, drei Nachkommastellen) und
`properties.curve_label_max` (1 … 3). `normalizeLabelFeature` ist eine **Positivliste** — was dort
nicht steht, fällt weg. Beide fehlen dort.

**Dateien:**
- Ändern: `js/map-features/map-features-labels.js` (in `normalizeLabelFeature`)
- Anlegen: `js/map-features/__tests__/curve-label-normalize.test.js`

**Schnittstellen:**
- Verbraucht: den Payload aus Plan 1.
- Liefert: am normalisierten Label `label.curveLine` (`[[lat, lng], …]` oder `null`) und
  `label.curveMax` (`1..3`, Vorgabe 1). ⚠️ Aufgaben 4–6 lesen genau diese zwei Namen.

- [ ] **Schritt 1: Den Test zuerst**

```js
// Kommt die Kurve aus dem Payload am normalisierten Label an -- und ist sie gedreht?
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ⚠️ map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an).
// Geprueft wird deshalb der Rumpf von normalizeLabelFeature, aus der Datei geschnitten und in einem
// eigenen Kontext ausgefuehrt. Das ist knauserig, aber ehrlich: der Test misst genau die Funktion,
// um die es geht, und behauptet nichts ueber den Rest der Datei.
const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
const von = quelle.indexOf("function normalizeLabelFeature(");
assert.ok(von >= 0, "normalizeLabelFeature steht in der Datei");
const bis = quelle.indexOf("\n}", von);
assert.ok(bis > von, "und hat ein Ende");
const rumpf = quelle.slice(von, bis + 2);

// Die Helfer, die der Rumpf ruft und die hier nicht interessieren.
const readFeatureOtherSource = () => null;
const readLabelHeightSchritt = () => null;
const normalizeLabelFeature = new Function(
  "readFeatureOtherSource", "readLabelHeightSchritt",
  rumpf + "; return normalizeLabelFeature;"
)(readFeatureOtherSource, readLabelHeightSchritt);

// --- Ohne Kurve -------------------------------------------------------------------------------
const ohne = normalizeLabelFeature({
  geometry: {coordinates: [10, 20]},
  properties: {public_id: "l1", text: "Meer der Sieben Winde"},
});
assert.strictEqual(ohne.curveLine, null, "kein curve_label_line -> null, nicht []");
assert.strictEqual(ohne.curveMax, 1, "die Vorgabe ist 1");

// --- Mit Kurve -------------------------------------------------------------------------------
// 💣 Der Payload fuehrt [x, y]; Leaflet will [lat, lng] = [y, x]. Der Tausch ist die einzige Aufgabe
// dieser Zeile, und er ist genau die Sorte Fehler, die man auf der Karte erst sieht, wenn das Label
// irgendwo im Meer steht.
const mit = normalizeLabelFeature({
  geometry: {coordinates: [10, 20]},
  properties: {
    public_id: "l2",
    text: "Drachensteine",
    curve_label_line: [[100, 200], [110, 210], [120, 205]],
    curve_label_max: 2,
  },
});
assert.deepStrictEqual(mit.curveLine, [[200, 100], [210, 110], [205, 120]], "x/y getauscht zu lat/lng");
assert.strictEqual(mit.curveMax, 2);

// --- Schranken -------------------------------------------------------------------------------
const einPunkt = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2]], curve_label_max: 1},
});
assert.strictEqual(einPunkt.curveLine, null, "ein einzelner Punkt ist keine Kurve");

// 🔴 Der Deckel ist 3 und die Untergrenze 1 -- serverseitig geklemmt, hier ein zweites Mal. Zwei
// Riegel sind hier KEIN Riegel zu viel: der Payload kann alt sein (der Deploy loescht nie,
// AGENTS.md §10), und eine 7 wuerde sieben Namen auf eine Kurve setzen.
const zuGross = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2], [3, 4]], curve_label_max: 7},
});
assert.strictEqual(zuGross.curveMax, 3);
const zuKlein = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2], [3, 4]], curve_label_max: 0},
});
assert.strictEqual(zuKlein.curveMax, 1);

// Eine kaputte Koordinate wirft die KURVE weg, nicht das LABEL.
const kaputt = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {text: "Koschberge", curve_label_line: [[1, 2], ["x", 4]], curve_label_max: 1},
});
assert.strictEqual(kaputt.curveLine, null, "kaputte Koordinate -> keine Kurve");
assert.strictEqual(kaputt.text, "Koschberge", "das Label selbst bleibt");

console.log("curve-label-normalize: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Laufen lassen und scheitern sehen**

```bash
node js/map-features/__tests__/curve-label-normalize.test.js
```

Erwartet: rot, `curveLine` ist `undefined`.

- [ ] **Schritt 3: Die zwei Felder aufnehmen**

In `normalizeLabelFeature`, hinter `climateZones`:

```js
		// 🔴 DIE KURVE, auf der dieser Name steht -- gerechnet vom SERVER (Entwurf §7.1), weil die
		// Flaechengeometrie beim normalen Besucher gar nicht im Browser liegt (1,6 MB Vegetation,
		// 1,4 MB Topographie, nachgeladen erst beim Betreten der Landschaftsebene).
		// 💣 Der Payload fuehrt [x, y], Leaflet will [lat, lng] = [y, x]. Hier wird getauscht, und
		// zwar EINMAL -- alles dahinter rechnet in Leaflet-Ordnung.
		// ⚠️ `null` heisst „diese Flaeche hat die Kurvenbeschriftung aus" und ist der Normalfall;
		// eine leere Liste waere dasselbe in unklar.
		curveLine: readLabelCurveLine(properties),
		// Hoechstens so viele Namen auf dieser Kurve (Entwurf §4.2: ein HOECHSTwert, kein Sollwert).
		curveMax: readLabelCurveMax(properties),
```

Und darüber, neben den anderen Lesern der Datei:

```js
// Die Grundlinie eines Kurvenlabels aus dem Payload, gedreht in Leaflet-Ordnung.
// 🔴 Eine einzige unbrauchbare Koordinate nimmt die KURVE, nicht das LABEL -- der Name muss auch
// dann noch erscheinen, notfalls gerade. Dieselbe Regel wie serverseitig in
// avesmapsCurveBaselinesFromCache: pro Objekt aussteigen, nie den ganzen Bestand.
function readLabelCurveLine(properties) {
	const roh = properties && properties.curve_label_line;
	if (!Array.isArray(roh) || roh.length < 2) {
		return null;
	}
	const punkte = [];
	for (const paar of roh) {
		if (!Array.isArray(paar) || paar.length < 2) {
			return null;
		}
		const x = Number(paar[0]);
		const y = Number(paar[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return null;
		}
		punkte.push([y, x]);
	}
	return punkte;
}

// 1 … 3. Alles andere faellt auf 1 zurueck. Der Server klemmt schon; hier ein zweites Mal, weil ein
// gecachter alter Payload jede Zahl tragen kann und der Deploy nie loescht (AGENTS.md §10).
function readLabelCurveMax(properties) {
	const roh = Number(properties && properties.curve_label_max);
	if (!Number.isFinite(roh)) {
		return 1;
	}
	return Math.min(3, Math.max(1, Math.round(roh)));
}
```

- [ ] **Schritt 4: Grün, dann das Testfeld**

```bash
node js/map-features/__tests__/curve-label-normalize.test.js && for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done; echo "Lauf beendet"
```

- [ ] **Schritt 5: Commit**

```bash
git add js/map-features/map-features-labels.js js/map-features/__tests__/curve-label-normalize.test.js
git commit -m "feat(kurvenlabel): die Kurve vom Server kommt am Label an -- und wird dabei gedreht"
```

---

## Aufgabe 4: Die Passung

Aus einer projizierten Kurve, einem Namen und den Schriftmassen werden bis zu drei Textfenster. Rein,
ohne DOM, ohne Canvas — die Schriftbreiten kommen als Zahlen herein, gemessen hat sie der Aufrufer.

**Dateien:**
- Anlegen: `js/map-features/curve-label-fit.js`
- Anlegen: `js/map-features/__tests__/curve-label-fit.test.js`
- Ändern: `index.html`

**Schnittstellen:**
- Verbraucht: `cumulativeLengths`, `sliceLabelWindowAt`, `layoutGlyphsAlong`, `labelSpanRunsLeftward`
  aus Aufgabe 1.
- Liefert: `avesmapsCurveLabelFit(punkte, zeichen, breiten, schriftgroesse, anzahl)` →
  `{ fenster: [{ pts, ls, fontSize, chars, widths }], hinweise: [...] }` oder `null`.
  `punkte` sind Bildschirmpunkte `{x, y}`, `breiten` die gemessenen Zeichenbreiten bei
  `schriftgroesse`. Aufgabe 5 und 6 rufen genau das.
- Liefert ausserdem die Konstantentafel `AVESMAPS_CURVE_LABEL_DEFAULTS` (Entwurf §6.1).

- [ ] **Schritt 1: Den Test zuerst**

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const hier = (n) => path.join(__dirname, "..", n);
vm.runInThisContext(fs.readFileSync(hier("curved-label-layout.js"), "utf8"));
vm.runInThisContext(fs.readFileSync(hier("curve-label-fit.js"), "utf8"));

// Eine waagerechte Kurve, 1000 px lang.
const lang = [{x: 0, y: 100}, {x: 1000, y: 100}];
const name = "DRACHENSTEINE";
const zeichen = name.split("");
const breiten = zeichen.map(() => 10);   // 10 px je Zeichen -> 130 px roh

// --- Ein Name ---------------------------------------------------------------------------------
const eins = avesmapsCurveLabelFit(lang, zeichen, breiten, 12, 1);
assert.ok(eins && eins.fenster.length === 1, "ein Name, ein Fenster");
// 🔴 Die Sperrung zieht den Namen ueber die Flaeche (Entwurf §5.2) -- 20 % der Kurve als Vorgabe.
assert.ok(eins.fenster[0].ls > 0, "gesperrt wird");

// 💣 Zwei Deckel, und der zweite ist der, den man am Schirm sieht: hoechstens 50 % der Kurve UND
// hoechstens 0,6 Schriftgroessen Zusatz je Luecke. Bei Zoom 7 ist die Drachenstein-Kurve 11 246 px
// lang und der Name 197 px -- 20 % davon waeren Buchstaben mit 50 px Abstand, die als Wort nicht
// mehr lesbar sind. Der Anteil allein genuegt also nicht.
const riesig = [{x: 0, y: 0}, {x: 11246, y: 0}];
const gross = avesmapsCurveLabelFit(riesig, zeichen, breiten, 12, 1);
assert.ok(gross.fenster[0].ls <= 0.6 * 12 + 1e-9,
  "der Zusatz je Luecke ist auf 0,6 Schriftgroessen gedeckelt -- nicht nur der Anteil");

// --- Mehrere Namen ---------------------------------------------------------------------------
const drei = avesmapsCurveLabelFit(lang, zeichen, breiten, 12, 3);
assert.strictEqual(drei.fenster.length, 3, "drei Namen, drei Fenster");
const mitten = drei.fenster.map((f) => f.pts[Math.floor(f.pts.length / 2)].x);
assert.ok(mitten[0] < mitten[1] && mitten[1] < mitten[2], "der Reihe nach");

// 🔴 Ein HOECHSTwert, kein Sollwert (Entwurf §4.2): passen drei nicht, kommen weniger -- aber die
// verbleibenden verteilen sich NEU ueber die ganze Kurve, statt auf ihrem Drittel sitzen zu bleiben.
const kurz = [{x: 0, y: 0}, {x: 300, y: 0}];
const gedraengt = avesmapsCurveLabelFit(kurz, zeichen, breiten, 12, 3);
assert.ok(gedraengt.fenster.length < 3, "auf 300 px passen keine drei Namen von 130 px");
assert.ok(gedraengt.fenster.length >= 1, "einer geht");
const eineMitte = gedraengt.fenster[0].pts[Math.floor(gedraengt.fenster[0].pts.length / 2)].x;
assert.ok(Math.abs(eineMitte - 150) < 40, "neu verteilt, nicht auf dem alten Drittel stehengeblieben");

// --- Passung: nie ein abgeschnittener Buchstabe (Entwurf §4.4) --------------------------------
const knapp = [{x: 0, y: 0}, {x: 120, y: 0}];
const gepasst = avesmapsCurveLabelFit(knapp, zeichen, breiten, 12, 1);
assert.ok(gepasst && gepasst.fenster.length === 1, "auch knapp kommt ein Fenster heraus");
const f = gepasst.fenster[0];
const gebraucht = f.widths.reduce((a, b) => a + b, 0) + f.ls * (f.chars.length - 1);
const vorhanden = cumulativeLengths(f.pts)[f.pts.length - 1];
assert.ok(gebraucht <= vorhanden + 1e-6,
  "der Text passt in sein Fenster -- sonst faellt live der erste Buchstabe weg ('CHWARZE SICHE')");
assert.ok(f.fontSize >= 8, "verkleinert wird hoechstens bis 8 px");

// --- Leserichtung (Entwurf §4.1) --------------------------------------------------------------
// 💣 Die Probe gehoert HIER und nicht erst ans Zeichnen: wer sie erst beim Malen macht, hat die
// Fenster schon verteilt und muss sie alle noch einmal drehen.
const nachLinks = [{x: 1000, y: 100}, {x: 0, y: 100}];
const gedreht = avesmapsCurveLabelFit(nachLinks, zeichen, breiten, 12, 1);
const g = gedreht.fenster[0];
assert.ok(g.pts[0].x < g.pts[g.pts.length - 1].x, "das ausgegebene Fenster laeuft IMMER nach rechts");

// --- Beruhigung (Entwurf §5.1) ------------------------------------------------------------------
// Ein scharfer Knick darf den Namen nicht verdrehen: nach der Beruhigung weicht kein Stueck des
// Fensters mehr als maxTurnDeg von seiner Sehne ab. 💣 Ohne diese Zusicherung steht die Regel zwar
// im Plan, aber nichts haelt sie fest -- und sie ist der Grund, warum der Name an der Spitze der
// Sichel verdreht begann.
const scharferKnick = [{x: 0, y: 0}, {x: 200, y: 0}, {x: 200, y: 200}, {x: 400, y: 200}];
const beruhigt = avesmapsCurveLabelFit(scharferKnick, zeichen, breiten, 12, 1);
assert.ok(beruhigt, "auch ein Knick traegt einen Namen");
const bp = beruhigt.fenster[0].pts;
const sehne = Math.atan2(bp[bp.length - 1].y - bp[0].y, bp[bp.length - 1].x - bp[0].x);
let schlimmster = 0;
for (let i = 1; i < bp.length; i += 1) {
  const w = Math.atan2(bp[i].y - bp[i - 1].y, bp[i].x - bp[i - 1].x);
  let d = Math.abs((w - sehne) * 180 / Math.PI) % 360;
  if (d > 180) { d = 360 - d; }
  if (d > schlimmster) { schlimmster = d; }
}
assert.ok(schlimmster <= AVESMAPS_CURVE_LABEL_DEFAULTS.maxTurnDeg + 1e-6,
  "kein Stueck weicht mehr als 30° von der Sehne ab, gemessen " + schlimmster.toFixed(1) + "°");

// --- Nichts geht ---------------------------------------------------------------------------------
assert.strictEqual(avesmapsCurveLabelFit([{x: 0, y: 0}], zeichen, breiten, 12, 1), null,
  "ein einzelner Punkt ist keine Kurve");
assert.strictEqual(avesmapsCurveLabelFit(lang, [], [], 12, 1), null, "ohne Text kein Fenster");

console.log("curve-label-fit: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Laufen lassen und scheitern sehen**

```bash
node js/map-features/__tests__/curve-label-fit.test.js
```

Erwartet: `ReferenceError: avesmapsCurveLabelFit is not defined`.

- [ ] **Schritt 3: Das Modul bauen**

Kopf und Konstantentafel:

```js
// Die Passung eines Namens auf seine Kurve: Sperrung, Verlaengerung, Verkleinerung, Verteilung
// mehrerer Namen. Rein -- Bildschirmpunkte und gemessene Zeichenbreiten herein, Fenster heraus.
// Wer misst, ist der Aufrufer; wer zeichnet, ist das Overlay.
//
// 🔴 Die Werte unten sind die Tafel aus Entwurf §6.1. Sie stehen HIER, an einer Stelle, mit ihren
// Vorgaben -- Plan 4 haengt die Kachel „Darstellung" daran, ohne eine Zahl zu suchen.
// ⚠️ Zwei davon sind an SECHS Flaechen geraten, nicht an 644 gemessen: der Mindestabstand zweier
// Namen und der Ausweichweg. Der Owner sieht sie nach dem Bau an allen Flaechen gemeinsam durch
// (Entwurf §6.1, §9.14). Deshalb stehen sie in einer Tafel und nicht verstreut im Code.
const AVESMAPS_CURVE_LABEL_DEFAULTS = {
	maxTurnDeg: 30,           // §5.1 Beruhigung gegen die Sehne
	extendMaxPct: 30,         // §4.4 Mittel 1: Kurve verlaengern
	trackingPct: 20,          // §5.2 Sperrung ueber die Flaeche
	trackingMaxPct: 50,       // §5.2 🔴 Deckel, nie darueber
	trackingMaxPerGapEm: 0.6, // §5.2 💣 der Deckel, den man am Schirm sieht
	minFontPx: 8,             // §4.4 Mittel 2: Untergrenze
	headroomPct: 15,          // §4.4 Vorhalt, damit nicht jedes Label ins Verlaengern laeuft
	safetyPct: 4,             // §4.4 Sicherheitsrand der Passung
	minGapEm: 2.0,            // §4.2 Mindestabstand zweier Namen -- GERATEN
	dodgePx: 6,               // §7.2 Ausweichweg -- GERATEN
};
```

🔴 **Diese Funktion wird PORTIERT, nicht erfunden.** Der Ablauf steht fertig und vom Owner abgenommen
im Prototyp `docs/kurvenlabel-mockup.html` — in `zeichneOverlay()` (Zeilen 1217–1490) und sechs
Helfern, die genau die Regeln des Entwurfs tragen:

| im Prototyp | Regel |
|---|---|
| `richtungWaehlen(line)` | §4.1 Leserichtung |
| `ruhigstesFenster(line, ziel)` | §5.1 das ruhigste Stück |
| `beruhigen(line, maxDreh)` | §5.1 Beruhigung zur Sehne, 30° |
| `verlaengern(line, ziel)` | §4.4 Mittel 1 |
| `teilStueck(line, von, bis)` / `dVon(line)` | Fenster schneiden, Bogenlänge |
| `habenKollision(liste)` | §4.2 Abbau von `anzahl` abwärts |

⚠️ **Der Prototyp rechnet in `[x, y]`-Paaren, dieses Modul in `{x, y}`-Punkten** (so liefert Leaflet
sie, und so erwartet `layoutGlyphsAlong` sie). Das ist die einzige systematische Umschreibung, und
sie ist der wahrscheinlichste Portierfehler — sie wird an **einer** Stelle gemacht, nicht in jeder
Funktion. ⭐ Wo `curved-label-layout.js` dasselbe schon kann (`cumulativeLengths` für `dVon`,
`sliceLabelWindowAt` für `teilStueck`, `labelSpanRunsLeftward` für `richtungWaehlen`), gilt die
Hausfassung — der Prototyp liefert die **Regel**, nicht den Code.

Der Ablauf, in dieser Reihenfolge:

1. **Prüfen und drehen.** Weniger als zwei Punkte oder kein Zeichen → `null`. Läuft die Kurve nach
   links (`labelSpanRunsLeftward` über die ganze Linie), die Punktliste **umkehren** — ab hier läuft
   alles nach rechts. 💣 Das ist die Stelle für §4.1, und es ist genau **eine** Stelle.
2. **Fenster verteilen.** Für `n` von `anzahl` abwärts bis 1: die Bogenlänge in `n` gleiche
   Abschnitte teilen, jeden Abschnitt an den Rändern um den Mindestabstand (`minGapEm × fontSize`)
   einziehen, und prüfen, ob der Name mit Vorhalt (`headroomPct`) hineinpasst. Die erste Zahl `n`,
   bei der alle `n` passen, gewinnt. ⚠️ Weil bei jedem `n` neu geteilt wird, verteilt sich der
   verbleibende Name über die **ganze** Kurve — genau die Forderung aus §4.2.
3. **Je Fenster das ruhigste Stück suchen und beruhigen (§5.1).** Innerhalb *seines* Abschnitts sucht
   jedes Fenster die Stelle mit der geringsten Summe der Richtungsänderungen
   (`findCalmLabelCenter` / `labelSpanTurning`) und wird danach zu seiner Sehne hin beruhigt, bis
   kein Stück mehr als `maxTurnDeg` (30°) abweicht. Im Extremfall wird daraus eine Gerade — was ein
   Kartograf bei einem stark geknickten Objekt auch tut.
   💣 **Gesucht wird NUR innerhalb des eigenen Abschnitts, und der Zuschlag für den Abstand zur Mitte
   ist auf die freie Strecke normiert.** Ohne beides wandern bei einer gebogenen Fläche alle Namen an
   dieselbe Stelle: bei der Schwarzen Sichel liegt die ruhigste Stelle **beider** Hälften an der
   gemeinsamen Naht, und die zwei Grundlinien standen gemessen **4 px** auseinander, wo 566 px Platz
   waren. Mit normiertem Zuschlag: 172 px.
   🪤 Das sah wie eine Kollision aus und war die Fenstersuche. Wer es dafür hält und die
   Kollisionsschwelle nachzieht, zementiert den Fehler und schluckt künftig stumm Labels.
4. **Je Fenster die Sperrung setzen (§5.2).** Zielbreite = Rohbreite + `trackingPct` der
   Fensterlänge, gedeckelt auf `trackingMaxPct` der Fensterlänge **und** auf
   `trackingMaxPerGapEm × fontSize` je Lücke. Der kleinere der beiden Deckel gewinnt.
5. **Passt es immer noch nicht** (Rohbreite > Fensterlänge − Sicherheitsrand): erst das Fenster
   tangential verlängern, höchstens `extendMaxPct`; dann die Schrift verkleinern, mindestens
   `minFontPx`; reicht beides nicht, **doch weiter verlängern**. 🔴 Abgeschnitten wird nie.
6. **Zurückgeben** mit `hinweise` — je Fenster ein Wort, wenn verlängert oder verkleinert wurde. Das
   ist der Befund, den Aufgabe 7 misst.

💣 **Schritt 5 ist die Stelle, an der „CHWARZE SICHE" entstand — und zwar als Folge von Schritt 3.** Die Beruhigung kürzt den Bogen zur
Sehne hin, und der Text war danach ein paar Pixel zu lang; ein `textPath` bricht dann nicht um und
staucht nicht — er lässt Buchstaben weg. Deshalb ist die letzte Handlung dieser Funktion eine
Nachprüfung: `Summe(breiten) + ls × (n−1) ≤ Fensterlänge`. Hält sie nicht, wird verlängert, bis sie
hält. Diese Nachprüfung steht auch im Test.

⚠️ **Und sie muss NACH der Beruhigung stehen, nicht davor.** Genau das war der Fehler: Schritt 3
kürzt den Bogen (eine Sehne ist kürzer als ihr Bogen), und eine Passung, die vorher gerechnet hat,
gilt danach nicht mehr.

⚠️ **Verkleinerte Schrift ändert die Zeichenbreiten.** `breiten` sind bei `schriftgroesse` gemessen;
bei `fontSize < schriftgroesse` skalieren sie linear mit — Canvas-Schriften skalieren metrisch
linear, das ist zulässig und muss im Kommentar stehen, damit niemand später neu misst.

- [ ] **Schritt 4: In `index.html` einreihen**

```html
<script src="js/map-features/curve-label-fit.js"></script>
```

Unmittelbar nach `curved-label-layout.js` — es ruft daraus.

- [ ] **Schritt 5: Grün, dann das Testfeld**

```bash
node js/map-features/__tests__/curve-label-fit.test.js && for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done; echo "Lauf beendet"
```

- [ ] **Schritt 6: Commit**

```bash
git add js/map-features/curve-label-fit.js js/map-features/__tests__/curve-label-fit.test.js index.html
git commit -m "feat(kurvenlabel): die Passung -- Sperrung, Verlaengerung, Verkleinerung, nie ein abgeschnittener Buchstabe"
```

---

## Aufgabe 5: Kanal C — der Name steht auf seiner Kurve

Ab hier ist etwas zu sehen. Am Ende dieser Aufgabe zeichnen die Drachensteine ihren Namen
**zweimal**: einmal als altes Marker-Label, einmal auf der Kurve. Das ist gewollt und der Beweis,
dass der neue Weg trägt; Aufgabe 6 nimmt das alte weg. Ein Zwischenstand, in dem man etwas sieht, ist
mehr wert als einer, in dem man nichts sieht.

**Dateien:**
- Ändern: `js/map-features/map-features-path-label-canvas-overlay.js`
- Ändern: `js/map-features/map-features-labels.js` (der Kandidatenleser)

**Schnittstellen:**
- Verbraucht: `avesmapsCurveLabelFit` (Aufgabe 4), `layoutGlyphsAlong` (Aufgabe 1),
  `label.curveLine`/`label.curveMax` (Aufgabe 3).
- Liefert: `avesmapsKurvenlabelKandidaten()` in `map-features-labels.js` und
  `zeichneKurvenlabels()` in der IIFE des Overlays. Aufgabe 6 hängt beide um.

- [ ] **Schritt 1: An die Labelliste kommen**

Das Overlay kennt heute `pathData`. Die Labels liegen in `labelMarkers` (`map-features-labels.js`).
Vor dem Bauen **nachsehen**, wie diese Liste heisst und ob sie global erreichbar ist:

```bash
grep -n "labelMarkers" js/map-features/map-features-labels.js | head -20
```

🔴 **Auch wenn sie global ist, greift das Overlay NICHT direkt hinein.** `map-features-labels.js`
gibt einen schmalen Leser heraus:

```js
// Welche Labels wuerden JETZT als Kurve gezeichnet? Die Sichtbarkeitsregel bleibt damit an ihrer
// einen Stelle (shouldShowLabelMarker) -- das Overlay bekommt eine fertige Liste und kein zweites
// Regelwerk.
// 💣 Wer die Zoom- und Ebenenpruefung im Overlay nachbaut, hat zwei Regeln, die beim ersten neuen
// Filter auseinanderlaufen. Genau diese Falle hat am 14.08.2026 die Verkehrsmittel-Sperre gekostet:
// eine Regel, die einen von vier Erzeugern bindet, ist keine Regel.
function avesmapsKurvenlabelKandidaten() { /* … */ }
```

Er liefert genau die Labels, die eine `curveLine` haben **und** nach `shouldShowLabelMarker` sichtbar
wären.

⚠️ **Eine Einschränkung, die benannt gehört:** `shouldShowLabelMarker` prüft den Bildausschnitt gegen
`entry.marker.getLatLng()` — die **Ankerlage** des Labels. Eine Kurve ist bis zu 88 Karteneinheiten
lang; ihr Anker kann ausserhalb liegen, während ein Stück Kurve noch im Bild ist. Das ergibt an den
Bildrändern ein spät erscheinendes Kurvenlabel. Für Plan 2 wird das **hingenommen und gemessen**
(Aufgabe 7), nicht behoben — die Ankerprüfung gilt heute allen Labels, und sie hier allein für
Kurven zu ändern wäre eine zweite Sichtbarkeitsregel.

- [ ] **Schritt 2: Kanal C schreiben**

In `redraw()`, **nach** den beiden Wege-Kanälen (die Kurvenlabels werden in Aufgabe 6 in der Kaskade
vorgezogen; hier zählt zunächst nur, dass sie erscheinen):

```js
		// KANAL C: die Namen der Landschaftsflaechen auf ihrer Kurve (Entwurf §7.3).
		// 🔴 Die Kurve kommt vom SERVER und liegt fertig am Label (label.curveLine, Leaflet-Ordnung).
		// Hier wird nur projiziert, gepasst und gemalt -- gerechnet hat api/_internal/app/curve-labels.php.
		zeichneKurvenlabels();
```

Und die Funktion selbst, neben den anderen im Overlay:

```js
	// Ein Landschaftsname auf seiner Kurve. Der Ablauf ist kurz, weil die Arbeit woanders liegt:
	// curve-label-fit.js passt, curved-label-layout.js setzt die Glyphen, paintGlyphs malt.
	function zeichneKurvenlabels() {
		if (typeof avesmapsKurvenlabelKandidaten !== "function" || typeof avesmapsCurveLabelFit !== "function") {
			return;
		}
		const kandidaten = avesmapsKurvenlabelKandidaten();
		if (!Array.isArray(kandidaten) || kandidaten.length === 0) {
			return;
		}
		for (const label of kandidaten) {
			// 1. Die Kurve in Bildschirmpunkte. label.curveLine ist [lat, lng] -- der Tausch ist
			//    schon in normalizeLabelFeature passiert und passiert hier NICHT noch einmal.
			const pts = label.curveLine.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));

			// 2. Schrift und Zeichenbreiten messen. ⚠️ ctx.font MUSS vor dem Messen stehen --
			//    measureText misst gegen die zuletzt gesetzte Schrift, nicht gegen die gewuenschte.
			const fontSize = getScaledLabelSize(label);
			ctx.font = kurvenlabelFont(label, fontSize);
			const chars = Array.from(label.text);
			const widths = chars.map((c) => ctx.measureText(c).width);

			// 3. Passen lassen.
			const passung = avesmapsCurveLabelFit(pts, chars, widths, fontSize, label.curveMax);
			if (!passung) {
				continue;
			}

			// 4. Malen. Je Fenster einmal.
			for (const fenster of passung.fenster) {
				// ⚠️ Wurde verkleinert, muss ctx.font NACHGEZOGEN werden -- sonst malt der Canvas in
				// der alten Groesse an Positionen, die fuer die neue gerechnet wurden.
				if (fenster.fontSize !== fontSize) {
					ctx.font = kurvenlabelFont(label, fenster.fontSize);
				}
				const glyphs = layoutGlyphsAlong(fenster.pts, fenster.chars, fenster.widths, fenster.ls, 0, fenster.fontSize);
				if (!glyphs) {
					continue;
				}
				// 💣 DIE PROBE DES OWNERS, am fertig gesetzten Text (Entwurf §4.1, §7.3): steht die
				// erste Glyphe weiter links als die letzte? Im Prototyp beantwortete der Browser das
				// (getStartPositionOfChar); auf dem Canvas fragt niemand, also wird gerechnet.
				// Sie steht HIER und nicht nur in der Passung, weil zwischen beidem noch geglaettet
				// und verlaengert wird -- und weil genau diese Zusicherung beim Entwerfen zweimal
				// danebengegangen ist. Ein Toleranzband gibt es nicht: -1 px ist die Grenze, und
				// ein Band um die verbotene Lage LAESST DIE VERBOTENE LAGE ZU.
				if (glyphs[glyphs.length - 1].x - glyphs[0].x < -1) {
					continue;
				}
				paintGlyphs(glyphs, fenster.chars, kurvenlabelHalo(label), kurvenlabelFarbe(label));
			}
		}
	}
```

⚠️ `kurvenlabelFont`, `kurvenlabelHalo` und `kurvenlabelFarbe` sind **keine neuen Werte**. Sie holen
Schriftfamilie, Halo-Stärke und Füllfarbe aus dem vorhandenen Label-Stil
(`getMapLabelTypeStyle(label.labelType)`, wie `renderMapLabelToImage` es tut). 💣 **Keine hartkodierte
Farbe** (AGENTS.md §12) — und keine zweite Optik: zwei Schriftbilder nebeneinander würden auffallen,
das ist der Grund, warum §7.3 überhaupt auf Canvas entschieden hat. Vor dem Bauen
`renderMapLabelToImage` lesen und die drei Werte von dort beziehen.

- [ ] **Schritt 3: Syntaxprüfung und Testfeld**

```bash
node --check js/map-features/map-features-path-label-canvas-overlay.js && for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done; echo "Lauf beendet"
```

- [ ] **Schritt 4: Im Browser ansehen — die Drachensteine**

🔴 **Das ist die Abnahme dieser Aufgabe, und sie ist ein Handgriff, keine Zahl.** Bei der
Live-Abnahme von Plan 1 wurde die Kurvenbeschriftung an **genau einer** Region eingeschaltet: den
Drachensteinen. Also:

1. Die Karte öffnen, eine Ansicht mit Topographie wählen.
2. Zu den Drachensteinen navigieren.
3. **Hinsehen:** steht der Name auf der Bergkette, gebogen, gesperrt? Steht er doppelt (Kurve + altes
   Marker-Label)? Das Doppel ist an dieser Stelle **richtig**.
4. Zoom 2, 4 und 7 durchfahren. Bei jedem: kein fehlender Buchstabe, kein kopfstehender Name.

Fehlt die Kurve ganz, **zuerst prüfen, ob der Payload sie überhaupt liefert** — nicht den Code lesen:

```js
fetch("/api/app/map-features.php?cb=" + Date.now())
  .then((r) => r.json())
  .then((d) => {
    const mit = (d.features || []).filter((f) => f.properties && f.properties.curve_label_line);
    console.log("Labels mit Kurve:", mit.length, mit.map((f) => f.properties.text));
  });
```

⚠️ Der Cache-Brecher gehört dazu: der ETag kommt live nur manchmal an, und ohne ihn misst man den
Proxy statt den Server.

- [ ] **Schritt 5: Commit**

```bash
git add js/map-features/map-features-path-label-canvas-overlay.js js/map-features/map-features-labels.js
git diff --staged --stat
git commit -m "feat(kurvenlabel): der Name einer Landschaftsflaeche steht auf ihrer Kurve"
```

---

## Aufgabe 6: Die Einreihung in die Kaskade

Jetzt bekommt das Kurvenlabel seinen Platz in der Beschriftungsordnung — und das alte Marker-Label
verschwindet.

**Dateien:**
- Ändern: `js/map-features/map-features-label-collisions.js`
- Ändern: `js/map-features/map-features-labels.js`
- Ändern: `js/map-features/map-features-path-label-canvas-overlay.js`

**Schnittstellen:**
- Verbraucht: alles aus 3–5.
- Liefert: `avesmapsKurvenlabelPlatzierungen(containerOrigin)` — rechnet die Platzierungen, gibt die
  Rechtecke zurück und legt die Glyphenreihen für das Overlay ab; sowie
  `avesmapsLabelWirdAlsKurveGemalt(label)`.

- [ ] **Schritt 1: Die Rechnung eine Stufe vorziehen**

Aus `zeichneKurvenlabels()` wird eine **Rechnung** und ein **Maler**. Die Rechnung läuft in
`scheduleLabelCollisionResolution()` zwischen Stufe 1 und Stufe 2:

```js
		const regionLabelRects = resolveRegionLabelCollisions();
		// 🔴 Die Kurvenlabels werden HIER platziert, VOR den Orts- und Freilabels -- nicht am Ende
		// beim Zeichnen. Ein Landschaftsname ist heute Teilnehmer dieser Stufe; ihn ans Ende zu
		// haengen, weil er kuenftig auf Canvas gemalt wird, waere eine RANGaenderung, getarnt als
		// Zeichenaenderung: Dorfnamen gewaennen gegen „Schwarze Sichel". Entwurf §7.2 verbietet das
		// ausdruecklich („An der Prioritaetenordnung wird in diesem Vorhaben nichts geaendert").
		// ⚠️ Es geht als MEHRERE kleine Rechtecke entlang der Grundlinie ein, nicht als eine
		// Huellbox -- ein um 297° gedrehtes <img> liefert heute eine stark aufgeblaehte
		// achsenparallele Huelle, die kleinen Kaesten sind die genauere Aussage (Entwurf §7.2).
		const kurvenRects = typeof avesmapsKurvenlabelPlatzierungen === "function"
			? avesmapsKurvenlabelPlatzierungen(containerOrigin)
			: [];
		const occupiedRects = resolveLabelCollisions(regionLabelRects.concat(kurvenRects));
```

⚠️ **Vor dem Bauen prüfen, was `resolveLabelCollisions` mit seinem Argument tut** — ob es Rechtecke
in Viewport- oder in Containerkoordinaten erwartet, und in welcher Form
(`{left, top, right, bottom}`). Die Antwort steht in `resolveRegionLabelCollisions`; abgeschrieben
wird von dort, nicht geraten. 💣 Zwei Koordinatensysteme, die gleich aussehen, sind der
wahrscheinlichste Fehler dieser Aufgabe: das Ergebnis wäre kein Absturz, sondern Kurvenlabels, die an
der falschen Stelle blockieren — sichtbar nur als „hier fehlt komisch oft ein Ortsname".

- [ ] **Schritt 2: Der Ausweichweg**

`findFreePlacement` kann das bereits: es schiebt entlang der Linie. Es bekommt als Gleitweite
`AVESMAPS_CURVE_LABEL_DEFAULTS.dodgePx` (6 px) und die Belegungskarte über die vorhandenen Globalen.

🔴 **Bringt das nichts, weicht das Kurvenlabel NICHT weiter aus** (§7.2 Punkt 3). Es sitzt auf seiner
Fläche; das fremde Label muss ausweichen oder verschwinden — wie heute bei den Gebietsnamen. ⚠️ Also
kein „dann eben ausblenden": ein Landschaftsname, der wegen eines Dorfnamens verschwindet, ist genau
die Rangänderung, die dieser Plan vermeidet.

- [ ] **Schritt 3: Das alte Marker-Label unterdrücken**

In `shouldShowLabelMarker` (`map-features-labels.js`), **als letzter** der `return false`-Riegel, vor
dem abschliessenden `return`:

```js
	// 🔴 Ein Kurvenlabel wird auf CANVAS gemalt (Entwurf §7.3), nicht als gedrehtes <img> im
	// divIcon. Der Marker bleibt bestehen -- er traegt Klick und Bearbeiten-Modus --, aber er wird
	// nicht gezeigt. Wieder ein `return false` und keine wahrheitswertige Bedingung, aus demselben
	// Grund wie die vier Riegel darueber: er darf nur verbergen, nie zeigen.
	// ⚠️ Der Riegel steht ZULETZT. Weiter oben stuende er ueber dem Ebenen- und dem Zoomfilter --
	// dann waere „Kurvenbeschriftung an" ein Weg, ein Label an der Ebenenwahl vorbeizuschmuggeln.
	if (avesmapsLabelWirdAlsKurveGemalt(entry.label)) {
		return false;
	}
```

💣 **`avesmapsLabelWirdAlsKurveGemalt` darf NICHT einfach `Boolean(label.curveLine)` sein.** Eine
Kurve am Label heisst „der Server hat eine geliefert", nicht „sie wurde auch gezeichnet". Findet die
Passung kein Fenster oder scheitert die Leserichtungsprobe, wird nichts gemalt — und dann muss der
Marker stehenbleiben, sonst verschwindet der Name **ganz**. Das ist derselbe Fehler wie eine
`catch`-Absage, die stumm als Erfolg durchgeht: aus „ich konnte nicht" wird „es gibt nichts". Die
Funktion fragt deshalb das **Ergebnis** der Platzierung ab, nicht die Eingabe.

⚠️ **Damit hängt der Riegel an einem Zustand, den erst der Kollisionsdurchgang setzt.** Beim
allerersten Bild ist er noch leer, also steht der Marker einen Frame lang. Das ist richtig herum
(lieber ein Bild zu viel Marker als ein fehlender Name) und gehört als Kommentar an die Stelle.

- [ ] **Schritt 4: Das Overlay malt nur noch**

`zeichneKurvenlabels()` rechnet nicht mehr, sondern malt die abgelegten Glyphenreihen.

💣 Die Ablage trägt einen **Stempel der Ansicht** (Zoomstufe + die linke obere Ecke als LatLng);
malt `redraw()` mit einem veralteten Stempel, wird neu gerechnet statt falsch gemalt. Der Grund:
`redraw()` wird nicht nur vom Kollisionsdurchgang gerufen, sondern auch aus
`map-features-path-rendering.js`, `map-features-powerlines.js` und `map-features-display-mode.js` —
und eine Glyphenreihe in Containerkoordinaten ist nach einem Schwenk nicht bloss alt, sondern falsch.

- [ ] **Schritt 5: Testfeld und Browser**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done; echo "Lauf beendet"
```

Im Browser, an den Drachensteinen:

1. Der Name steht **einmal**, auf der Kurve. Das alte waagerechte Marker-Label ist weg.
2. Ortsnamen in der Nähe stehen **nicht** auf dem Kurvennamen. Das ist die Wirkung der Vorbelegung
   und der eigentliche Beleg dieser Aufgabe.
3. Schwenken und zoomen: der Name bleibt auf der Kette, springt nicht, verschwindet nicht.
4. 🪤 **Die Messung, die der Entwurf verlangt** (§7.2, §12.3): wie oft verdrängt ein Kurvenlabel
   einen Ortsnamen, der heute gewönne? An den Drachensteinen zählen und die Zahl in den Bericht
   schreiben. Sie wird **nicht** zum Anlass genommen, an der Ordnung zu drehen — die globale
   Prioritäten-Entscheidung gehört zur vollständigen Überarbeitung der Kollisionen.

- [ ] **Schritt 6: Commit**

```bash
git add js/map-features/map-features-label-collisions.js js/map-features/map-features-labels.js js/map-features/map-features-path-label-canvas-overlay.js
git diff --staged --stat
git commit -m "feat(kurvenlabel): das Kurvenlabel belegt seinen Platz -- Ortsnamen weichen aus, der alte Marker geht"
```

---

## Aufgabe 7: Abnahme an den Referenzflächen

Bis hierher ist **eine** Fläche eingeschaltet. Der Entwurf nimmt an sechsen ab (§9.1) und verlangt
ausdrücklich eine **derographische** darunter (§9.8) — unter den sechs Referenzflächen ist keine.

**Dateien:** keine. Diese Aufgabe misst und berichtet.

- [ ] **Schritt 1: Die Referenzflächen einschalten**

🔧 **DU (Owner):** das ist ein Schreibvorgang auf der Live-Datenbank. Über phpMyAdmin — die
Bedienelemente kommen erst mit Plan 3:

```sql
-- Erst SEHEN, was getroffen wird. Ein UPDATE, das nichts trifft, meldet Erfolg.
SELECT public_id, name FROM ecosystem_region
 WHERE name LIKE '%Hangwald%' OR name IN ('Drachensteine','Koschberge','Schwarze Sichel','Albernia');
```

```sql
-- Dann einschalten. Die Namen tragen Umlaute -- den Wortlaut aus dem SELECT oben uebernehmen.
UPDATE ecosystem_region
   SET properties_json = JSON_SET(COALESCE(properties_json, '{}'), '$.curve_label', true, '$.curve_label_max', 1)
 WHERE public_id IN (/* die public_id aus dem SELECT */);
```

„Schwarze Sichel" bekommt zum Prüfen von §4.2 `curve_label_max = 2`. Danach den Sammellauf aus Plan 1
anstossen (`POST /api/edit/map/curve-labels-run.php`), sonst liegt keine Kurve bereit.

- [ ] **Schritt 2: Die Handgriffe des Entwurfs — §9.1, §9.2, §9.8, §9.13**

An jeder Fläche, bei Zoom 2, 4 und 7:

* Steht der Name auf der Fläche, gebogen, lesbar?
* Fehlt ein Buchstabe? Steht einer auf dem Kopf?
* Bei der Schwarzen Sichel mit zwei Namen: **herauszoomen**, bis einer verschwindet — sitzt der
  verbleibende dann auf der **ganzen** Kurve oder auf seiner Hälfte? (§4.2, §9.2. Auf der Hälfte
  wäre ein Fehler in Aufgabe 4 Schritt 2.)
* Albernia (derographisch) ausdrücklich mit ansehen: *„Eine Ebene, die im Entwurf nur als Zahl
  vorkommt, ist nicht abgenommen."*

- [ ] **Schritt 3: Die zwei geratenen Werte melden**

🔧 **DU (Owner):** Mindestabstand (2,0 Schriftgrössen) und Ausweichweg (6 px) sind an sechs Flächen
geraten. Der Entwurf sieht vor, sie **nach** dem Bau an allen Flächen gemeinsam durchzusehen (§6.1,
§9.14) — einstellbar werden sie mit der Kachel „Darstellung" in Plan 4. Was hier zu tun ist:
Bildschirmfotos der Flächen und eine kurze Aussage, ob die zwei Werte tragen.

- [ ] **Schritt 4: Der Bericht**

In den Bericht gehören, jede als Zahl oder als Satz:

1. Wie viele Labels tragen eine Kurve (aus dem Payload gemessen)?
2. Wie oft hat die Passung verlängert, wie oft verkleinert (`hinweise` aus Aufgabe 4)?
3. Wie oft ist ein Ortsname einem Kurvenlabel gewichen (Aufgabe 6 Schritt 5.4)?
4. Erscheint ein Kurvenlabel am Bildrand spürbar spät (die Ankerprüfung aus Aufgabe 5 Schritt 1)?
5. Was der Emulator **nicht** beantworten kann — und das wird als offene Frage gemeldet, nicht als
   bestanden (AGENTS.md §9).

---

## Vor dem Push

- [ ] **Das GANZE Testfeld, JavaScript und PHP** (AGENTS.md §9). Ein roter Test lädt nichts hoch und
      vergiftet den `?v=`-Stempel:

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null || echo "ROT: $t"; done
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" >/dev/null || echo "ROT: $t"; done
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
echo "Lauf beendet"
```

⚠️ Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf), kein
Regressionssignal.

- [ ] **Die zwei Sub-Agenten** (AGENTS.md §9): `usability-konsistenz` vor dem Commit (Entwurf gegen
      Diff, gekoppelte Werte), `usability-design` vor dem Push (Mockup `docs/kurvenlabel-mockup.html`
      gegen den gebauten Zustand, hell **und** dunkel).

- [ ] **Den eigenen Entwurf als Abnahmeliste abhaken** (AGENTS.md §9): jede Zeile mit 💣 / ⚠️ / 🔴 in
      Entwurf und in diesem Plan — erfüllt, oder ausdrücklich verworfen mit Begründung.

- [ ] **Die Korrektur an §11 des Entwurfs nachtragen:** gezeichnet wird in
      `map-features-path-label-canvas-overlay.js`, nicht in `map-features-labels.js`; dazu die zwei
      neuen reinen Module. Ebenso der Vermerk, dass §4.3 und §7.4 bewusst zu Plan 3 gehören.

- [ ] 💣 **Sichtbare Änderung: EIN Commit, EIN Push, der Blick des Owners** (AGENTS.md §9). Der
      Blast-Radius ist klein — eingeschaltet ist eine einzige Fläche, bis Aufgabe 7 mehr einschaltet.
      🔧 **DU (Owner):** ob Plan 2 als Bündel oder in Etappen live geht, ist deine Entscheidung; die
      Regel sagt einzeln, und die Wiki-Zuweisung hat gezeigt, dass du davon abweichen kannst, wenn
      der Umbau zusammenhängt.

- [ ] 💣 **Und wenn es Etappen werden: den Deploy-Lauf ABWARTEN, bevor der nächste Push geht.**
      Diese Falle steht erst seit dem **22.08.2026** in AGENTS.md §9 und trifft genau den Ablauf, den
      der Punkt darüber vorschreibt: ein zweiter Push bricht den laufenden Lauf ab, ein abgebrochener
      Lauf lädt **nichts** hoch, und der nächste rechnet seine geänderten Dateien ab
      `github.event.before` — also ab dem abgebrochenen Commit. Die Dateien, die **nur** dieser eine
      Commit angefasst hat, lädt danach **nie jemand**. ⚠️ Es fällt nicht auf: der Stempel in
      `index.html` ist der neue, die Datei dahinter die alte — die Funktion fehlt einfach.
      Für diesen Plan sind das mit hoher Wahrscheinlichkeit `curved-label-layout.js` und
      `curve-label-fit.js`: **neue Dateien, die je genau eine Aufgabe anfasst.** Nach dem letzten
      Push deshalb jede der neuen und geänderten Dateien einzeln gegen die Live-Seite prüfen:

```js
["js/map-features/curved-label-layout.js",
 "js/map-features/curve-label-fit.js",
 "js/map-features/map-features-path-label-canvas-overlay.js",
 "js/map-features/map-features-labels.js",
 "js/map-features/map-features-label-collisions.js"].forEach((f) => {
  fetch("/" + f + "?cb=" + Date.now())
    .then((r) => (r.ok ? r.text() : Promise.reject("HTTP " + r.status)))
    // Die LAENGE ist das Signal: eine nie hochgeladene neue Datei gibt 404, eine alte
    // Fassung einer geaenderten Datei hat eine andere Groesse als die im Arbeitsbaum.
    .then((t) => console.log("da   ", f, t.length + " Zeichen"))
    .catch((e) => console.log("FEHLT", f, e));
});
```

      Eine Datei, die HTTP 404 liefert oder deren Kopf noch der alte ist, wurde nie hochgeladen.
      🔴 Geheilt wird das **nur durch eine Inhaltsänderung** — ein leerer Commit reicht nicht.

---

## Was nach Plan 2 offen bleibt

| offen | wohin |
|---|---|
| Die zwei Bedienelemente in beiden Dialogen, Region-Synchronität, Umstelllauf über die 56 gedrehten Flächen | Plan 3 |
| §4.3 — ohne Kurvenbeschriftung eine Gerade statt der Handdrehung | Plan 3, **zusammen** mit dem Umstelllauf |
| §7.4 — Neuausrichtung nach Zug am Label und nach Geometrieänderung | Plan 3 |
| Die Kachel „Darstellung", `app_setting`, Rechte, Umbenennung des Knopfs „Zoombänder" | Plan 4 |
| Die Werte aus §6.1 einstellbar machen (sie stehen ab Plan 2 an einer Stelle) | Plan 4 |
| Die Ordnung der Kollision am ganzen Livebestand messen | Plan 5, nach der globalen Prioritäten-Entscheidung |
| Die Ankerprüfung am Bildrand (eine lange Kurve mit Anker ausserhalb erscheint spät) | offen, gemessen in Aufgabe 7 |
| Parkposten aus Plan 1: `api/edit/map/curve-labels-run.php:85` ruft `avesmapsNextEcosystemRevision` ohne vorheriges `avesmapsEcosystemEnsureTables` — anders als die rund 15 übrigen Aufrufstellen | ein Einzeiler, beim nächsten Anfassen der Datei |
