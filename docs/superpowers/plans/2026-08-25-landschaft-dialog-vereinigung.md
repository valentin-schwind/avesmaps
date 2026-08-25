# Landschaft-Dialog-Vereinigung, Stufe 1 — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:executing-plans`
> (Inline-Ausführung). Die Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Landschaftsfläche und Beschriftung werden in EINEM Fenster bearbeitet — Kopf mit Name und
Art, drei Reiter, der Einstieg bestimmt den offenen Reiter.

**Architektur:** Das Markup der zwei vorhandenen Fenster **zieht um**, es wird nicht neu geschrieben.
Alle Element-IDs (`label-edit-*`, `ecosystem-properties-*`) wandern unverändert mit — damit bleiben
`review-labels.js` (950 Zeilen) und `map-features-ecosystem-properties.js` (2075 Zeilen)
funktionsfähig, ohne angefasst zu werden. Neu ist allein eine **Hülle**
(`js/map-features/landschaft-dialog.js`): sie besitzt Öffnen, Schließen, die Reiter, den
gemeinsamen Kopf und den einen Speichern-Knopf, und ruft die zwei vorhandenen Steuerungen als
Unterprogramme.

**Tech-Stack:** Vanilla JS ohne Build · Node-`assert`-Tests · CSS-Token · PHP unangetastet.

**Entwurf:** `docs/superpowers/specs/2026-08-25-landschaft-dialog-vereinigung-design.md`

---

## ✅ STAND 26.08.2026: ALLE DREI STUFEN SIND LIVE

Alle neun Aufgaben sind gebaut, im Browser durchgeklickt und gepusht. Was beim Bauen ANDERS kam
als hier geplant — jeweils mit Grund, damit der nächste Leser nicht Plan gegen Code liest:

| Stelle | Plan | Gebaut |
|---|---|---|
| **Aufgabe 6** | jeder der fünf Aufrufer NENNT seinen Reiter | der **Trichter** setzt ihn; nur der eine abweichende Weg nennt ihn. Fünf Stellen sind fünf Gelegenheiten, eine zu vergessen |
| **Aufgabe 3** | Name/Art bleiben zunächst im Flächenreiter | sie zogen direkt in den Kopf (Aufgabe 4) — ein zweiter Umzug wäre Arbeit für nichts gewesen |
| **Stufe 2** | Datenmigration über zwei `entity_type` | **nichts zu migrieren**: der zweite Kasten war live LEER (0 von 30 Flächen). Nur wegnehmen |

**Drei Fehler, die nur der ABLAUF gefunden hat — das Testfeld war jedes Mal grün:**

1. Die Verdrahtung der gemeinsamen Knopfleiste hing im Öffner der Hülle; die zwei Module gehen
   daran vorbei. „Abbrechen" und „×" taten nichts. *Eine Regel, die einen von mehreren Erzeugern
   bindet, ist keine Regel.*
2. **Falle 10 des Entwurfs ist eingetreten:** die 19 EIGENEN Feldregeln des Fensters zeigten nach
   dem Umzug auf `#label-edit-dialog` und passten auf nichts — Felder von 29 auf 35 px, Radius von
   6 auf 8. Ein Selektor, der ins Leere zeigt, ist still.
3. Eine Tiefenzählung, die Kommentare nur ZEILENWEISE strich, legte zwei Markup-Blöcke außerhalb
   jedes Reiters ab (ein mehrzeiliger Kommentar trägt `<div class=…>` als Text).

🔧 **Offen und ausdrücklich nicht behauptet:** kein Handgriff lief gegen die echte Datenbank.
Speichern, Löschen und „Beschriftung anlegen" sind verdrahtet und im Browser durchgeklickt, aber
ohne angemeldete Sitzung. Der erste echte Speichervorgang ist die Abnahme, die noch aussteht.

## Globale Zusicherungen

Sie gelten für **jede** Aufgabe:

- **Deutsch.** Kommentare, Commit-Betreffs, Meldungen (AGENTS.md §8).
- **Kein hartkodierter Farbwert, kein Radius, keine Schrift unter 11 px** (AGENTS.md §12).
- **Geteilter Arbeitsbaum: NIE `git add -A`.** Gearbeitet wird im Worktree
  `C:/GIT/avesmaps/.claude/worktrees/label-kompakt` auf `origin/master`.
- **Vor jedem Push läuft das GANZE Testfeld** (AGENTS.md §9): JS, PHP mit den drei Erweiterungen,
  und `tools/test-*.php`. Vorbestehend rot ist genau `linkcheck/link-url-test.php` (echter DNS-Abruf).
- 🔴 **EIN ZWEIG, EIN PUSH.** Anders als die Einzeln-live-Regel aus §9 — dieselbe Ausnahme, die der
  Owner am 16.08.2026 für die Wiki-Zuweisungs-Vereinigung entschieden hat: ein halb vereinigtes
  Fenster ist kein sinnvoller Zwischenstand für einen Editor. Zwischenschritte werden **committet,
  aber nicht gepusht**, bis Aufgabe 8 grün ist.
- **`.location-report-form__field` bleibt an jedem Feld** — die Zeilenform ist ein Modifier
  (`--zeile` / `--hakenzeile`).
- **Die Abnahme ist ein ABLAUF**, kein Maß: jeder sichtbare Schritt wird im Browser aufgemacht und
  angefasst, nicht nur gemessen.

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `js/map-features/landschaft-dialog.js` | **neu** — Hülle: Öffnen/Schließen, Reiter, Kopf, Speichern, Datenlagen |
| `js/map-features/__tests__/landschaft-dialog-reiter.test.js` | **neu** — Reiterwechsel + Einstieg |
| `js/map-features/__tests__/landschaft-dialog-lagen.test.js` | **neu** — die vier Datenlagen |
| `js/map-features/__tests__/landschaft-dialog-einstieg.test.js` | **neu** — alle Aufrufer nennen ihren Reiter |
| `css/components/landschaft-dialog.css` | **neu** — Kopf, Reiter, leere Zustände, Label-Wahl |
| `index.html` | ändern — neues Overlay, die zwei alten Formulare ziehen hinein |
| `js/app/bootstrap.js` | ändern — Overlay in die Klick-Ausnahmeliste |
| `js/review/review-core.js` | ändern — Overlay in die zwei „ist ein Fenster offen"-Listen |
| `css/components/dialog-overlays.css` | ändern — Overlay in die drei Selektorlisten |
| `js/review/review-labels.js` | ändern — Öffnen/Schließen an die Hülle abgeben |
| `js/map-features/map-features-ecosystem-properties.js` | ändern — dasselbe |
| `js/map-features/map-features-ecosystem-context-action.js` | ändern — Einstieg nennen |
| `js/map-features/map-features-labels.js` | ändern — Einstieg nennen |
| `js/review/review-panels-change-log.js` | ändern — Einstieg nennen |

---

## Aufgabe 1: Die Hülle — Fenster, Reiter, Einstieg

**Dateien:**
- Neu: `js/map-features/landschaft-dialog.js`
- Neu: `js/map-features/__tests__/landschaft-dialog-reiter.test.js`
- Neu: `css/components/landschaft-dialog.css`
- Ändern: `index.html` (neues Overlay, leere Reiterfelder), `css/styles.css` (Import),
  `js/app/bootstrap.js`, `js/review/review-core.js`, `css/components/dialog-overlays.css`

**Schnittstellen:**
- Liefert: `avesmapsLandschaftDialogOeffnen({ reiter, labelEntry, area, latlng })`,
  `avesmapsLandschaftDialogSchliessen()`, `avesmapsLandschaftDialogReiter(name)`,
  `avesmapsLandschaftDialogReiterName()` — und die reine Regel
  `avesmapsLandschaftDialogStartReiter(einstieg)` → `"flaeche" | "beschriftung"`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

```js
// js/map-features/__tests__/landschaft-dialog-reiter.test.js
const { avesmapsLandschaftDialogStartReiter } = require("../landschaft-dialog.js");
assert.strictEqual(avesmapsLandschaftDialogStartReiter("label"), "beschriftung");
assert.strictEqual(avesmapsLandschaftDialogStartReiter("flaeche"), "flaeche");
// 🔴 Kein Raten: ein unbekannter Einstieg faellt auf „flaeche" -- das ist der Reiter, der bei
// JEDER Datenlage etwas zeigt (334 Flaechen haben keine Beschriftung, aber jede Beschriftung
// laesst sich einer Flaeche zuordnen).
assert.strictEqual(avesmapsLandschaftDialogStartReiter("quatsch"), "flaeche");
assert.strictEqual(avesmapsLandschaftDialogStartReiter(undefined), "flaeche");
```

- [ ] **Schritt 2: Lauf, der fehlschlägt**

`node js/map-features/__tests__/landschaft-dialog-reiter.test.js`
Erwartet: `Cannot find module '../landschaft-dialog.js'`

- [ ] **Schritt 3: Die reine Regel bauen**

```js
// 🔴 REIN: kein DOM, kein Zustand. Der Einstieg ist ein PARAMETER des Oeffners, nie ein
// Modulzustand „welcher Reiter war zuletzt offen" -- der liefe beim zweiten Oeffnen auseinander
// (dieselbe Falle wie beim Anzeige-Menue und den Ansichts-Kacheln).
const AVESMAPS_LANDSCHAFT_DIALOG_REITER = ["flaeche", "beschriftung", "wiki"];

function avesmapsLandschaftDialogStartReiter(einstieg) {
	return einstieg === "label" ? "beschriftung" : "flaeche";
}
```

- [ ] **Schritt 4: Lauf, der besteht**

- [ ] **Schritt 5: Das Markup**

Neues Overlay in `index.html`, unmittelbar VOR `#label-edit-overlay`:

```html
<div id="landschaft-dialog-overlay" hidden>
  <div id="landschaft-dialog" class="location-report-dialog" role="dialog" aria-modal="true"
       aria-labelledby="landschaft-dialog-title" tabindex="-1">
    <div class="location-report-dialog__header">
      <h2 id="landschaft-dialog-title">Landschaft bearbeiten</h2>
      <button id="landschaft-dialog-close" class="location-report-dialog__close" type="button"
              aria-label="Fenster schließen">×</button>
    </div>
    <!-- 🔴 DER KOPF GEHOERT BEIDEN HAELFTEN. Name und Art stehen einmal da und schreiben ueber die
         VORHANDENEN Propagationswege in beide Zeilen (renameLinkedEcosystemLabel abwaerts,
         ecosystemRegionWriteBackPayload aufwaerts). Live tragen 679 von 679 Paaren denselben
         Namen -- heute in zwei Feldern in zwei Fenstern. -->
    <div class="label-edit-section landschaft-dialog__kopf" id="landschaft-dialog-kopf"></div>
    <div class="ecosystem-layer-switch landschaft-dialog__reiter" id="landschaft-dialog-reiter"
         role="tablist" aria-label="Bereich">
      <button class="ecosystem-layer-switch__tab" type="button" role="tab"
              data-landschaft-reiter="flaeche" aria-selected="true">Fläche</button>
      <button class="ecosystem-layer-switch__tab" type="button" role="tab"
              data-landschaft-reiter="beschriftung" aria-selected="false">Beschriftung</button>
      <button class="ecosystem-layer-switch__tab" type="button" role="tab"
              data-landschaft-reiter="wiki" aria-selected="false">Wiki &amp; Quellen</button>
    </div>
    <div data-landschaft-bereich="flaeche"></div>
    <div data-landschaft-bereich="beschriftung" hidden></div>
    <div data-landschaft-bereich="wiki" hidden></div>
    <p id="landschaft-dialog-status" class="location-report-form__status" role="status"
       aria-live="polite"></p>
    <div class="location-report-form__actions">
      <button id="landschaft-dialog-delete" class="location-report-form__button location-report-form__button--secondary" type="button">Löschen</button>
      <button id="landschaft-dialog-cancel" class="location-report-form__button location-report-form__button--secondary" type="button">Abbrechen</button>
      <button id="landschaft-dialog-save" class="location-report-form__button location-report-form__button--primary" type="button">Speichern</button>
    </div>
  </div>
</div>
```

- [ ] **Schritt 6: Das Fenster IN DIE SECHS LISTEN eintragen**

💣 Ein Overlay-`<div>` erbt nichts. `#landschaft-dialog-overlay` muss stehen in:
1. `js/app/bootstrap.js` — die Klick-Ausnahmeliste (sonst schließt ein Klick im Fenster die Karte)
2. `js/review/review-core.js:118` — „ist der Beschriftungsdialog offen"
3. `js/review/review-core.js:130` — „ist irgendein Fenster offen" (der Tastatur-Riegel)
4.–6. `css/components/dialog-overlays.css` — **alle drei** Selektorlisten

- [ ] **Schritt 7: Reiterwechsel verdrahten + Stil**

```js
function avesmapsLandschaftDialogReiter(name) {
	const ziel = AVESMAPS_LANDSCHAFT_DIALOG_REITER.indexOf(name) === -1 ? "flaeche" : name;
	document.querySelectorAll("[data-landschaft-reiter]").forEach((knopf) => {
		knopf.setAttribute("aria-selected", String(knopf.dataset.landschaftReiter === ziel));
	});
	document.querySelectorAll("[data-landschaft-bereich]").forEach((feld) => {
		feld.hidden = feld.dataset.landschaftBereich !== ziel;
	});
	return ziel;
}
```

⚠️ **Der Reiter wird NIE gesperrt, auch wenn seine Hälfte fehlt** (Entwurf §4) — dort steht das
Angebot, und ein gesperrter Reiter verbirgt genau die Handlung, die gerade fehlt.

- [ ] **Schritt 8: Ablauf im Browser**

Vorschauserver auf den Worktree, `docs/`-Abnahmeseite oder `index.html?…`: Fenster per Konsole
öffnen, alle drei Reiter anklicken, `Esc` drücken, danebenklicken. Kein Schließen der Karte.

- [ ] **Schritt 9: Committen** (nicht pushen)

```bash
git add js/map-features/landschaft-dialog.js js/map-features/__tests__/landschaft-dialog-reiter.test.js css/components/landschaft-dialog.css css/styles.css index.html js/app/bootstrap.js js/review/review-core.js css/components/dialog-overlays.css
git commit -m "feat(landschaft): die Huelle des vereinigten Fensters -- drei Reiter, ein Einstieg"
```

---

## Aufgabe 2: Die Beschriftungs-Hälfte zieht um

**Dateien:** Ändern: `index.html`, `js/review/review-labels.js`

**Schnittstellen:**
- Nutzt: `avesmapsLandschaftDialogOeffnen`, `avesmapsLandschaftDialogSchliessen` aus Aufgabe 1.
- Liefert: nichts Neues — `openLabelEditDialog(options)` behält seine Signatur und bekommt
  `options.reiter`.

- [ ] **Schritt 1: Test, der den Umzug festnagelt**

```js
// js/map-features/__tests__/landschaft-dialog-umzug.test.js
// 💣 DIE IDs ZIEHEN UNVERAENDERT MIT. Sie sind der Grund, warum review-labels.js (950 Zeilen)
// und map-features-ecosystem-properties.js (2075 Zeilen) nicht angefasst werden muessen.
const markup = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const dlg = markup.slice(markup.indexOf('id="landschaft-dialog-overlay"'),
	markup.indexOf('id="landschaft-dialog-overlay"') + 60000);
for (const id of ["label-edit-text", "label-edit-type", "label-edit-size", "label-edit-priority",
	"label-edit-min-zoom", "label-edit-max-zoom", "label-edit-curve", "label-edit-curve-max-row",
	"label-edit-is-nodix", "label-edit-rotation", "label-edit-height-row"]) {
	assert.ok(dlg.includes('id="' + id + '"'), id + " ist im neuen Fenster");
}
// 🪤 Und NUR einmal im ganzen Dokument -- eine doppelte Id macht getElementById zufaellig richtig.
for (const id of ["label-edit-text", "label-edit-curve"]) {
	assert.strictEqual(markup.split('id="' + id + '"').length - 1, 1, id + " genau einmal");
}
```

- [ ] **Schritt 2: Lauf, der fehlschlägt** — die IDs stehen noch im alten Overlay.

- [ ] **Schritt 3: Umziehen**

Der Inhalt von `#label-edit-form` wird aufgeteilt:
- Abschnitt „Eigenschaften" (Text, Art, Höhe, Nodix) → **Kopf** (Text/Art) und Reiter
  **Beschriftung** (Höhe, Nodix)
- Abschnitt „Darstellung" → Reiter **Beschriftung**
- `#label-wiki-assign-host`, „Andere Quelle", „Quellen" → Reiter **Wiki & Quellen**
- „Landschaftsfläche / Gehört zu" → Reiter **Fläche** (leerer Zustand, Aufgabe 5)
- 💣 `#label-edit-form` **bleibt als `<form>`** um die Beschriftungs-Felder — sein
  `submit`-Handler ist der Schreibweg und wird in Aufgabe 4 vom gemeinsamen Knopf ausgelöst.
- 💣 Der versteckte `#label-edit-rotation` zieht MIT. Ohne ihn schreibt jedes Speichern eine 0
  über den gespeicherten Winkel.
- `#label-edit-overlay` wird aus `index.html` entfernt.

- [ ] **Schritt 4: `review-labels.js` gibt Öffnen/Schließen ab**

`$("#label-edit-overlay").prop("hidden", !isOpen)` → `avesmapsLandschaftDialogSichtbar(isOpen)`.

- [ ] **Schritt 5: Ganzes Testfeld** — besonders `label-vorgabemarke`, `label-maxnamen-riegel`,
  `kurvenbeschriftung-bedienelemente`, `wiki-assign-landschaft`.

- [ ] **Schritt 6: Ablauf** — Beschriftung anklicken, Größe ziehen (wirkt sofort auf der Karte),
  Abbrechen, erneut öffnen, speichern.

- [ ] **Schritt 7: Committen**

---

## Aufgabe 3: Die Flächen-Hälfte zieht um

**Dateien:** Ändern: `index.html`, `js/map-features/map-features-ecosystem-properties.js`

- [ ] **Schritt 1: Test erweitern** — dieselben Zusicherungen für
  `ecosystem-properties-{name,autoname,showname,nodix,locked,curve,curve-max,type,terrain,peaks,heightscale,wiki-host,feature-sources}`.
- [ ] **Schritt 2: Lauf, der fehlschlägt**
- [ ] **Schritt 3: Umziehen** — „Für Klicks gesperrt", Gelände, Höhenskala, Gipfel → Reiter
  **Fläche**; Wiki-Host und Quellen → Reiter **Wiki & Quellen**; Name/Art/Auto-Name → **Kopf**
  (Aufgabe 4 entscheidet, welches Feld gewinnt).
  💣 „Regionname anzeigen", „Nodix", „Kurvenbeschriftung" und „Anzahl Kurvenlabel" des
  Flächendialogs **entfallen ersatzlos** — sie bedienen denselben Wert wie ihre Zwillinge im
  Beschriftungsteil, und genau davor warnt das Markup heute. Die IDs verschwinden; ihre Leser in
  `map-features-ecosystem-properties.js` werden auf die Beschriftungs-IDs umgehängt.
- [ ] **Schritt 4: Die zwei Quellenlisten bekommen Überschriften**

🔴 Entwurf §8: Stufe 1 legt sie NICHT zusammen — das wäre eine Datenmigration über zwei
`entity_type` mit zwei Schlüsseln, samt Herkunft (`wiki_publication`/`manual`/`community`) und
Grabsteinen (`status='suppressed'`). Sie stehen untereinander und sagen, wem sie gehören:
**„Quellen der Fläche"** (`entity_type='ecosystem'`) und **„Quellen der Beschriftung"**
(`entity_type='region'`). ⚠️ Ohne die zwei Überschriften sähe es aus wie eine Liste mit
Dubletten.

- [ ] **Schritt 5: Ganzes Testfeld**
- [ ] **Schritt 6: Ablauf** — Fläche rechtsklicken, „Eigenschaften …", Gelände ziehen, speichern.
- [ ] **Schritt 7: Committen**

---

## Aufgabe 4: Der gemeinsame Kopf und der eine Speichern-Knopf

**Dateien:** Ändern: `index.html`, `js/map-features/landschaft-dialog.js`

**Schnittstellen:**
- Liefert: `avesmapsLandschaftDialogSpeichern()` — löst `requestSubmit()` auf **jedem** Formular
  aus, dessen Hälfte im Fenster existiert.

- [ ] **Schritt 1: Test**

```js
// 💣 EIN Knopf, ZWEI Formulare. Wer nur das Formular des OFFENEN Reiters abschickt, verliert die
// Aenderung im anderen -- und zwar lautlos, weil das Fenster danach zugeht.
const gerufen = [];
avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: true })
	.forEach((f) => gerufen.push(f));
assert.deepStrictEqual(gerufen, ["ecosystem-properties-form", "label-edit-form"]);
assert.deepStrictEqual(avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: true, hatLabel: false }),
	["ecosystem-properties-form"]);
assert.deepStrictEqual(avesmapsLandschaftDialogSpeichernAuftraege({ hatFlaeche: false, hatLabel: true }),
	["label-edit-form"]);
```

- [ ] **Schritt 2: Lauf, der fehlschlägt**
- [ ] **Schritt 3: Bauen** — Kopf-Markup (Name, Art, Auto-Name) + die Reihenfolge
  **Fläche zuerst, Beschriftung danach**: die Abwärts-Propagation trägt Name und Art ohnehin ans
  Label, und andersherum überschriebe die Beschriftung den frisch gesetzten Regionsnamen.
- [ ] **Schritt 4: Lauf, der besteht**
- [ ] **Schritt 5: Ablauf** — Name im Kopf ändern, speichern, **beide** Zeilen in der Datenbank
  nachsehen. ⚠️ Das ist der Handgriff, den kein Emulator beantwortet.
- [ ] **Schritt 6: Committen**

---

## Aufgabe 5: Die vier Datenlagen und die leeren Zustände

**Dateien:** Neu: `js/map-features/__tests__/landschaft-dialog-lagen.test.js`;
ändern: `index.html`, `js/map-features/landschaft-dialog.js`, `css/components/landschaft-dialog.css`

- [ ] **Schritt 1: Test**

```js
// 🔴 EIN Satz, keine Statistik (Owner 25.08.2026: „Reicht").
assert.strictEqual(avesmapsLandschaftDialogLeertext("flaeche", { hatFlaeche: false }),
	"Diese Beschriftung liegt auf keiner Fläche.");
assert.strictEqual(avesmapsLandschaftDialogLeertext("beschriftung", { hatLabel: false }),
	"Diese Fläche trägt keine Beschriftung.");
assert.strictEqual(avesmapsLandschaftDialogLeertext("flaeche", { hatFlaeche: true }), "");
```

- [ ] **Schritt 2: Lauf, der fehlschlägt**
- [ ] **Schritt 3: Bauen** — leere Zustände samt Angebot: im Reiter Fläche das vorhandene
  „Gehört zu" plus „Fläche zeichnen"; im Reiter Beschriftung „Beschriftung anlegen".
- [ ] **Schritt 4: Die Meldung nach dem Anlegen**

🔴 Owner 25.08.2026: „du kannst die meldung bringen dass am Punkt der Unzugänglichkeit … ein label
erstellt wurde, wenn man auf ‚label anlegen' klickt." Text:
`Beschriftung am Punkt der Unzugänglichkeit (x / y) angelegt.`
⚠️ Sie gehört dem **Vorgang**: sie verschwindet beim nächsten Reiterwechsel und beim Schließen.

- [ ] **Schritt 5: Lauf, der besteht** · **Schritt 6: Ablauf** (alle vier Lagen aufmachen)
- [ ] **Schritt 7: Committen**

---

## Aufgabe 6: Die Einstiege

**Dateien:** Neu: `js/map-features/__tests__/landschaft-dialog-einstieg.test.js`; ändern:
`map-features-ecosystem-context-action.js`, `map-features-labels.js`,
`review-panels-change-log.js`, `map-features-ecosystem-properties.js`

- [ ] **Schritt 1: Test — JEDER Aufrufer nennt seinen Einstieg**

```js
// 💣 Eine Regel, die einen von sechs Erzeugern bindet, ist keine Regel (AGENTS.md, zweimal
// gelernt). Der Test zaehlt die Aufrufer zur LAUFZEIT des Quelltextes, nicht aus dem Kopf.
const dateien = ["js/map-features/map-features-ecosystem-context-action.js",
	"js/map-features/map-features-labels.js", "js/review/review-panels-change-log.js"];
let aufrufe = 0;
for (const d of dateien) {
	const s = fs.readFileSync(path.join(wurzel, d), "utf8");
	for (const treffer of s.matchAll(/openLabelEditDialog\(\{([^}]*)\}/g)) {
		aufrufe++;
		assert.ok(/reiter:/.test(treffer[1]),
			d + ": ein Aufruf ohne `reiter` -- " + treffer[0].slice(0, 60));
	}
}
assert.strictEqual(aufrufe, 5, "fuenf Aufrufer, gefunden: " + aufrufe);
```

- [ ] **Schritt 2: Lauf, der fehlschlägt** · **Schritt 3: `reiter: "beschriftung"` ergänzen**
- [ ] **Schritt 4: Das Kontextmenü der Fläche** öffnet mit `reiter: "flaeche"`.
- [ ] **Schritt 5: Lauf** · **Schritt 6: Ablauf** — beide Wege anklicken.
- [ ] **Schritt 7: Committen**

---

## Aufgabe 6b: Der Löschknopf bekommt einen Bezug

**Dateien:** Neu: `js/map-features/__tests__/landschaft-dialog-loeschen.test.js`; ändern:
`js/map-features/landschaft-dialog.js`

💣 **„Löschen" bedeutet in den zwei alten Fenstern Verschiedenes** (Entwurf §10, Falle 4): im
Flächendialog nimmt es die Region SAMT ihren Flächen, im Beschriftungsdialog nur die eine
Beschriftung. Ein gemeinsamer Knopf ohne Bezug ist damit die gefährlichste Stelle des ganzen
Umbaus — er sieht in beiden Fällen gleich aus und tut Verschiedenes.

- [ ] **Schritt 1: Test**

```js
// 🔴 Der Knopf loescht, was der OFFENE Reiter zeigt -- und sagt es in seiner Beschriftung.
assert.strictEqual(avesmapsLandschaftDialogLoeschText("flaeche"), "Fläche löschen");
assert.strictEqual(avesmapsLandschaftDialogLoeschText("beschriftung"), "Beschriftung löschen");
// ⚠️ Im Reiter „Wiki & Quellen" gibt es nichts zu loeschen -- der Knopf ist dort verborgen,
// nicht gesperrt: ein Loeschknopf ohne Bezug ist schlimmer als keiner.
assert.strictEqual(avesmapsLandschaftDialogLoeschText("wiki"), "");
```

- [ ] **Schritt 2: Lauf, der fehlschlägt**
- [ ] **Schritt 3: Bauen** — Beschriftung und Sichtbarkeit folgen dem Reiter.
- [ ] **Schritt 4: Die Rückfragen behalten ihre Wächter.** 💣 Das LETZTE Label einer Region
  nimmt Region UND Flächen mit (`refuse_ecosystem_cascade`) — die Rückfrage nennt das. 💣 Ein
  `berggipfel`/`vulkan`-Label IST ein Stützpunkt des Höhenfelds (`terrain-store.php`) — die
  zweite Rückfrage bleibt.
- [ ] **Schritt 5: Lauf, der besteht**
- [ ] **Schritt 6: Ablauf** — beide Reiter, beide Rückfragen lesen, dann ABBRECHEN. ⚠️ Hier
  wird nichts probehalber gelöscht.
- [ ] **Schritt 7: Committen**

---

## Aufgabe 7: Mehrere Beschriftungen an einer Fläche

**Dateien:** ändern: `index.html`, `js/map-features/landschaft-dialog.js`

- [ ] **Schritt 1: Test** — bei einer Fläche mit drei Beschriftungen erscheint die Auswahl, bei
  einer mit einer nicht; der Wechsel mit ungespeicherter Änderung fragt zurück.
- [ ] **Schritt 2–4: Bauen und prüfen.** ⚠️ Der Kopf gehört der REGION: Name und Art wirken auf
  alle Beschriftungen; Größe, Zoom, Priorität und Position nur auf die gewählte.
- [ ] **Schritt 5: Ablauf am Ingvaltal** (3 Beschriftungen) · **Schritt 6: Committen**

---

## Aufgabe 8: Die Kurvenbeschriftung als Bindung

**Dateien:** ändern: `index.html`, `js/map-features/landschaft-dialog.js`

- [ ] **Schritt 1: Test** — der Bindungssatz wechselt mit dem Haken; ohne Fläche ist der Haken
  gesperrt und nennt den Grund.
- [ ] **Schritt 2–4: Bauen und prüfen.**
- [ ] **Schritt 5: Ablauf** · **Schritt 6: Committen**

---

## Abschluss

- [ ] **Das GANZE Testfeld** (JS + PHP + `tools/test-*.php`).
- [ ] **Die zehn Fallen aus §10 des Entwurfs einzeln abhaken** — erfüllt oder ausdrücklich
  verworfen mit Begründung (AGENTS.md §9: „Der eigene Entwurf ist die Abnahmeliste").
- [ ] **Sub-Agenten `usability-konsistenz` und `usability-design`** — nur, wenn der Owner sie
  ausdrücklich verlangt (er hat den Agent-Einsatz in dieser Sitzung ausgeschlossen).
- [ ] **Ein Push.** Danach `gh run list` prüfen und die geänderten Dateien LIVE abrufen — der
  Commit-SHA allein ist kein Beleg dafür, dass STRATO sie bekam.
- [ ] **Commit-Betreff nennt die editorsichtbare Wirkung** — die Handbuch-Routine liest ihn
  (AGENTS.md §9). Das Handbuch selbst wird NICHT angefasst.
- [ ] **AGENTS.md §11 korrigieren:** „der Finsterkamm liegt in 57 Flächen" stimmt nicht mehr.
