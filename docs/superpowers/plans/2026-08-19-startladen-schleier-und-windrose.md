# Startladen: Schleier, Windrose und die rechte Kante — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Während des Startlaufs liegt ein Schleier über der Karte mit einer stehenden Windrose und dem Satz „Karte wird geladen …" in der Mitte; die rechte Kante (Info-/Editor-Lasche und ihre Panels) wartet draußen und fährt nach links herein, sobald geladen ist.

**Architecture:** Nichts davon bekommt einen eigenen Zustand. Alles hängt an der schon vorhandenen Klasse `avesmaps-booting`, die `js/app/loading-bar.js` setzt und in `bootBeenden()` wieder entfernt — beim Ereignis `avesmaps:map-ready` oder spätestens nach 20 Sekunden durch das Sicherheitsnetz. Der Schleierknoten entsteht in derselben Datei wie der Balken; sein Aussehen steht vollständig in `css/features/loading-bar.css`.

**Tech Stack:** Vanilla JS ohne Bauschritt, CSS mit Token aus `css/base/tokens.css`, Inline-SVG. Tests sind Node-Skripte, die den Quelltext lesen und Regeln daraus prüfen (Hausform, siehe `js/app/__tests__/touch-scale.test.js`).

**Entwurf:** `docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md`
**Mockup:** `docs/startladen-mockup.html`

## Global Constraints

- **Sprache:** Kommentare, Doku und Commit-Nachrichten auf **Deutsch** (AGENTS.md §8). `error.code`-Werte und Kennungen bleiben, wie sie sind.
- **Keine hartkodierte Farbe** — jeder Farbwert kommt aus einem Token in `css/base/tokens.css` (AGENTS.md §12). Fehlt ein Token, wird es zuerst angelegt.
- **Kein Blau** in der Bedienoberfläche.
- **Kein `?v=` von Hand.** `css/features/loading-bar.css` und `js/app/loading-bar.js` hängen an `index.html` und werden vom Deploy automatisch gestempelt. **Kein `ASSET_VERSION`-Bump** — das gilt nur für die dynamisch geladenen Editor-Dateien in `js/territory/territory-editor-inline-host.js`, und keine davon wird hier angefasst.
- **Geteilter Arbeitsbaum:** niemals `git add -A`/`git add .`/`git commit -a`. Vor jedem Commit `git status`, und nur die eigenen Pfade einzeln stagen. Vor dem Commit `git diff --staged` **lesen** — `git add <datei>` nimmt auch fremde Hunks derselben Datei mit.
- **Vor jedem Push läuft das GANZE Testfeld**, nicht nur die eigenen Tests (AGENTS.md §9). Die drei Läufe stehen wörtlich in Task 4.
- **Sichtbare Änderungen gehen EINZELN live** und der Owner sieht jede (AGENTS.md §9). Dieser Plan hat deshalb zwei Halte: nach Task 3 und nach Task 5.

---

## File Structure

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `css/base/tokens.css` | die vier neuen Farbwerte, hell und dunkel | Task 1 |
| `js/app/loading-bar.js` | baut den Schleierknoten und die Windrose neben dem Balken | Task 2, 3 |
| `css/features/loading-bar.css` | Aussehen des Schleiers, der Rose, der Drehung, der rechten Startstellungen | Task 2, 3, 5 |
| `js/app/i18n-en.js` | der englische Wert für `boot.loading` | Task 2 |
| `css/features/infopanel.css` | `transform` in die Transition der Info-Lasche | Task 5 |
| `css/features/review-panel.css` | `transform` in die Transition der Editor-Lasche | Task 5 |
| `js/app/__tests__/startladen-schleier.test.js` | **neu** — alle Zusicherungen zu diesem Bau | Task 1–5 |

Der Testrahmen (Datei, Hilfsfunktionen) entsteht in Task 1 und wird von jeder folgenden Aufgabe **erweitert**, nicht ersetzt.

---

## Task 1: Die vier Token und der Testrahmen

**Files:**
- Create: `js/app/__tests__/startladen-schleier.test.js`
- Modify: `css/base/tokens.css` (heller `:root`-Block, endet Zeile 663; dunkler `:root[data-theme="dark"]`-Block, Zeilen 728–859)

**Interfaces:**
- Produces: die CSS-Variablen `--color-boot-veil`, `--color-boot-ring-ink`, `--color-boot-ring-pale`, `--color-boot-ring-track` in **beiden** Themen. Task 2 und 3 lesen sie.
- Produces: die Testdatei samt der Hilfsfunktionen `read`, `withoutComments`, `escapeRe`. Task 2, 3 und 5 hängen ihre Blöcke unten an.

⚠️ Das Gold des laufenden Stücks ist **kein neues Token**: es ist `--color-accent-strong` (Wappengold), das es schon gibt. Das Mockup führt abweichend ein eigenes `--color-boot-ring-gold` — **maßgeblich ist dieser Plan**, nicht die CSS des Mockups.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/app/__tests__/startladen-schleier.test.js`:

```js
// Der Startlauf hat eine MITTE: ein Schleier ueber der Karte, eine stehende Windrose darin,
// der Satz „Karte wird geladen …" darunter -- und die rechte Kante faehrt herein wie der
// Planer gegenueber.
// Entwurf: docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md
//
// Geprueft wird, was hier lautlos kippt: dass der Schleier Klicks DURCHLAESST (Owner-Entscheid),
// dass er UNTER dem schmalen Streifen oben liegt, dass jede Farbe aus einem Token kommt und in
// BEIDEN Themen steht -- und dass die gedrehte Editor-Lasche ihr Vorzeichen behaelt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/startladen-schleier.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/^[ \t]*\/\/.*$/gm, "");
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));

// ---- Die vier Token stehen in BEIDEN Themen -----------------------------------------------------
//
// 🔴 „leicht weiss" (Owner 19.08.2026) beschreibt das HELLE Thema. Derselbe Wert ueber der dunklen
// Karte waere ein Blitz -- deshalb ist dieser Schleier, anders als die Scrims daneben, nicht
// gepinnt, sondern hat einen eigenen dunklen Gegenwert.
const dunkelAb = tokens.indexOf(':root[data-theme="dark"]');
assert.ok(dunkelAb > 0, "tokens.css traegt einen :root[data-theme=\"dark\"]-Block");
const hellerBlock = tokens.slice(0, dunkelAb);
const dunklerBlock = tokens.slice(dunkelAb);

const BOOT_TOKEN = [
	"--color-boot-veil",
	"--color-boot-ring-ink",
	"--color-boot-ring-pale",
	"--color-boot-ring-track"
];
BOOT_TOKEN.forEach((name) => {
	const muster = new RegExp(escapeRe(name) + ":\\s*[^;]+;");
	assert.ok(muster.test(hellerBlock), `${name} fehlt im hellen Thema`);
	assert.ok(muster.test(dunklerBlock),
		`${name} fehlt im DUNKLEN Thema. „leicht weiss" beschreibt das helle; derselbe Wert ueber`
		+ " der dunklen Karte waere ein Blitz -- der Schleier ist bewusst nicht gepinnt.");
});

// 🔴 Das Gold ist KEIN eigenes Token: es ist --color-accent-strong, das Wappengold, das die
// Designsprache dafuer schon fuehrt. Ein fuenftes Token waere eine zweite Wahrheit fuer eine
// Farbe, die es gibt.
assert.ok(!/--color-boot-ring-gold\s*:/.test(tokens),
	"--color-boot-ring-gold gehoert NICHT nach tokens.css -- das Gold ist --color-accent-strong."
	+ " (Das Mockup fuehrt es abweichend; massgeblich ist der Bauplan.)");

console.log("startladen-schleier: alle Zusicherungen gehalten");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen:

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **FAIL** mit `--color-boot-veil fehlt im hellen Thema`.

- [ ] **Step 3: Die Token im hellen Block anlegen**

In `css/base/tokens.css`, direkt **nach** der Zeile `	--color-scrim-spoiler-text: #f4ece0;` einfügen:

```css

	/* ---- Der Startschleier (css/features/loading-bar.css) ----
	   Liegt ueber der Karte, solange die Klasse `avesmaps-booting` steht (Owner 19.08.2026:
	   „sollen die kacheln im hintergrund leicht weiss erscheinen"). Entwurf:
	   docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md
	   🔴 Anders als jeder Scrim darueber ist er NICHT gepinnt: „leicht weiss" beschreibt das helle
	   Thema, und derselbe Wert ueber der dunklen Karte waere ein Blitz. Der dunkle Gegenwert steht
	   im data-theme-Block weiter unten -- wer hier etwas aendert, aendert dort mit. */
	--color-boot-veil: rgba(255, 253, 249, 0.55);
	/* Die Windrose darin: zwei Haelften je Zacke (die Seekarten-Optik) plus der ruhende Ring und
	   sein Teilstrichkranz. Das Gold des laufenden Stuecks ist bewusst KEIN eigenes Token -- es ist
	   --color-accent-strong, das Wappengold, das die Designsprache dafuer schon fuehrt. */
	--color-boot-ring-ink: #6d5236;
	--color-boot-ring-pale: #d7c9a8;
	--color-boot-ring-track: rgba(109, 82, 54, 0.22);
```

- [ ] **Step 4: Die Token im dunklen Block anlegen**

In `css/base/tokens.css`, direkt **nach** der Zeile `	--shadow-button-hover-strong: 0 5px 12px rgba(0, 0, 0, 0.5);` (letzte Zeile vor dem schließenden `}` des dunklen Blocks) einfügen:

```css

	/* Der Startschleier, dunkel. Kein Weiss ueber der dunklen Karte -- die Begruendung steht im
	   hellen Block. Die Rose dreht ihre beiden Haelften um: hell wird cremefarben, „dunkel" wird
	   ein warmes Mittelbraun, damit beide auf dem dunklen Grund lesbar bleiben. */
	--color-boot-veil: rgba(33, 31, 25, 0.66);
	--color-boot-ring-ink: #cbb99a;
	--color-boot-ring-pale: #efe6d2;
	--color-boot-ring-track: rgba(238, 231, 218, 0.20);
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **PASS**, Ausgabe `startladen-schleier: alle Zusicherungen gehalten`.

- [ ] **Step 6: Commit**

```bash
git status --short
git add css/base/tokens.css js/app/__tests__/startladen-schleier.test.js
git diff --staged
git commit -m "feat(startladen): die vier Farben des Schleiers, hell und dunkel getrennt"
```

---

## Task 2: Der Schleier

**Files:**
- Modify: `js/app/loading-bar.js` (Knoten anlegen, direkt nach `host.appendChild(bar);`)
- Modify: `css/features/loading-bar.css` (ans Ende anhängen)
- Modify: `js/app/i18n-en.js`
- Modify: `js/app/__tests__/startladen-schleier.test.js` (Block anhängen)

**Interfaces:**
- Consumes: die vier Token aus Task 1.
- Produces: die lokale Konstante `veil` (das `<div class="avesmaps-boot-veil">`) und `veilText` im Rumpf von `initLoadingBar()`. **Task 3 hängt die Windrose mit `veil.insertBefore(rose, veilText)` davor** — die beiden Namen sind der Vertrag zwischen den Aufgaben.
- Produces: die CSS-Klassen `.avesmaps-boot-veil` und `.avesmaps-boot-veil__text`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `js/app/__tests__/startladen-schleier.test.js` anhängen, **vor** der `console.log`-Zeile:

```js
const ladeCss = withoutComments(read("css", "features", "loading-bar.css"));
const ladeJs = withoutComments(read("js", "app", "loading-bar.js"));

// ---- Der Schleier laesst DURCH -----------------------------------------------------------------
//
// 🔴 Owner-Entscheid 19.08.2026, keine Feinheit: Schieben und Zoomen gehen waehrend des Ladens
// weiter wie bisher. Wer das umdreht, sperrt den Besucher bei einem haengenden Ladevorgang
// 20 Sekunden aus -- so lange laeuft das Sicherheitsnetz in loading-bar.js.
const schleier = ladeCss.match(/^\.avesmaps-boot-veil\s*\{([^}]*)\}/m);
assert.ok(schleier, "css/features/loading-bar.css traegt die Regel .avesmaps-boot-veil");
assert.ok(/pointer-events:\s*none/.test(schleier[1]),
	"Der Schleier laesst Klicks DURCH (Owner-Entscheid). Sperrt er, sitzt der Besucher bei einem"
	+ " haengenden Ladevorgang 20 Sekunden fest, bis das Sicherheitsnetz greift.");

// ---- ...und liegt UNTER dem schmalen Streifen oben ----------------------------------------------
//
// 💣 Beide Zahlen werden aus der Datei GELESEN, nicht hier abgeschrieben -- sonst prueft der Test
// seine eigene Kopie und nicht das Stylesheet.
const balken = ladeCss.match(/^\.avesmaps-loading-bar\s*\{([^}]*)\}/m);
assert.ok(balken, "die Balken-Regel steht weiterhin da");
const zBalken = Number((balken[1].match(/z-index:\s*(\d+)/) || [])[1]);
const zSchleier = Number((schleier[1].match(/z-index:\s*(\d+)/) || [])[1]);
assert.ok(Number.isFinite(zBalken) && Number.isFinite(zSchleier),
	"Balken und Schleier tragen beide einen z-index");
assert.ok(zSchleier < zBalken,
	`Der Schleier (${zSchleier}) muss UNTER dem Balken (${zBalken}) liegen -- darueber verdeckt er`
	+ " genau den schmalen Streifen oben, der laut Auftrag bleiben soll.");

// ---- Er blendet aus, er verschwindet nicht ------------------------------------------------------
//
// 💣 Gleiche Begruendung wie beim Knopfbund darueber: aus `display: none` gibt es kein Ausblenden.
assert.ok(/opacity:\s*0/.test(schleier[1]) && /visibility:\s*hidden/.test(schleier[1]),
	"der Schleier ruht auf opacity + visibility");
assert.ok(!/display:\s*none/.test(schleier[1]),
	"...und NICHT auf display:none -- daraus gibt es kein Ausblenden, nur ein Verschwinden");
const schleierAn = ladeCss.match(/^html\.avesmaps-booting \.avesmaps-boot-veil\s*\{([^}]*)\}/m);
assert.ok(schleierAn && /opacity:\s*1/.test(schleierAn[1]),
	"und er kommt an der Startlauf-Klasse -- nicht an einem eigenen, zweiten Zustand");

// ---- Die Farbe kommt aus dem Token --------------------------------------------------------------
assert.ok(/background:\s*var\(--color-boot-veil\)/.test(schleier[1]),
	"die Schleierfarbe kommt aus einem Token (AGENTS.md §12), nicht als Literal");

// ---- Der Satz darunter: data-i18n, weil es hier kein tr() gibt ----------------------------------
//
// ⚠️ js/app/loading-bar.js laeuft in index.html Zeile 247, js/app/i18n.js erst in Zeile 3003 --
// `window.tr` existiert zur Bauzeit des Knotens NICHT. Der Satz steht deutsch im Knoten und wird
// vom Durchlauf des Uebersetzers nachgezogen. Eine zweite Spracherkennung hier waere der teurere
// Fehler (dass es davon nur EINE gibt, ist die Zusicherung, die zaehlt).
assert.ok(/setAttribute\("data-i18n",\s*"boot\.loading"\)/.test(ladeJs),
	"der Satz unter dem Kreis traegt data-i18n=\"boot.loading\"");
assert.ok(/veilText\.textContent\s*=/.test(ladeJs),
	"...und seine deutsche Vorgabe steht als textContent im Knoten (nicht leer, sonst sieht ein"
	+ " deutscher Besucher gar nichts)");
assert.ok(!/window\.tr\b|[^.\w]tr\(/.test(ladeJs),
	"loading-bar.js ruft kein tr() -- es gibt hier keins, und ein Aufruf waere still undefined");

const enStrings = withoutComments(read("js", "app", "i18n-en.js"));
assert.ok(/"boot\.loading":\s*"[^"]+"/.test(enStrings),
	"js/app/i18n-en.js kennt boot.loading -- sonst steht der Satz unter ?lang=en dauerhaft deutsch");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **FAIL** mit `css/features/loading-bar.css traegt die Regel .avesmaps-boot-veil`.

- [ ] **Step 3: Das Stylesheet erweitern**

Ans **Ende** von `css/features/loading-bar.css` anhängen:

```css

/* ---- Der Startschleier ---------------------------------------------------------------------
   Owner 19.08.2026: „sollen die kacheln im hintergrund leicht weiss erscheinen waehrend im
   vordergrund zentriert mittig ein ladebalkenzirkel erscheint bis die labels geladen und die
   routenplanung verfuegbar ist". Entwurf:
   docs/superpowers/specs/2026-08-19-startladen-schleier-und-windrose-design.md
   Den Knoten baut js/app/loading-bar.js -- dieselbe Datei, die weiss, WANN der Startlauf vorbei
   ist; hier steht nur, WIE er aussieht. Damit haengt er an derselben einen Stelle wie der Balken,
   der Knopfbund und der Planer, samt ihrem 20-Sekunden-Netz.
   🔴 `pointer-events: none` ist ein Owner-Entscheid, keine Feinheit: Schieben und Zoomen gehen
   waehrend des Ladens weiter wie bisher. Wer das umdreht, sperrt den Besucher bei einem
   haengenden Ladevorgang 20 Sekunden aus.
   💣 Der z-index liegt UNTER dem des Balkens (2000000). Darueber verdeckte der Schleier genau den
   schmalen Streifen, der laut Auftrag bleiben soll -- der Test liest beide Zahlen und vergleicht.
   💣 `opacity`/`visibility`, nicht `display: none`: dieselbe Begruendung wie beim Knopfbund
   weiter oben -- aus `display: none` gibt es kein Ausblenden, nur ein Verschwinden. */
.avesmaps-boot-veil {
	position: fixed;
	inset: 0;
	z-index: 1999000;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 18px;
	background: var(--color-boot-veil);
	pointer-events: none;
	opacity: 0;
	visibility: hidden;
	transition: opacity 0.28s ease, visibility 0s linear 0.28s;
}
html.avesmaps-booting .avesmaps-boot-veil {
	opacity: 1;
	visibility: visible;
	transition: opacity 0.28s ease, visibility 0s linear 0s;
}

.avesmaps-boot-veil__text {
	font-size: 14px;
	color: var(--color-text-strong);
	letter-spacing: 0.01em;
}
```

- [ ] **Step 4: Den Knoten bauen**

In `js/app/loading-bar.js`, direkt **nach** der Zeile `	host.appendChild(bar);` einfügen:

```js

	// Der Startschleier. Dieselbe Frage („laeuft der Start noch?"), also dieselbe Datei -- er haengt
	// an derselben `avesmaps-booting`-Klasse wie der Knopfbund und der Planer und bekommt damit auch
	// deren 20-Sekunden-Netz geschenkt. Wie er aussieht, steht in css/features/loading-bar.css.
	// ⚠️ Der Satz steht DEUTSCH im Knoten und traegt `data-i18n`. `window.tr` gibt es hier NICHT:
	// diese Datei laeuft in index.html Zeile 247, js/app/i18n.js erst in Zeile 3003. Der Uebersetzer
	// laeuft dann einmal ueber das Dokument und zieht den Satz nach -- unter ?lang=en steht er auf
	// einem kalten Ladevorgang also kurz deutsch da. Eine zweite Spracherkennung hier waere der
	// teurere Fehler; dass es davon nur EINE gibt, wiegt die Sekunde auf.
	// 💣 `data-i18n` gehoert an ein Element, das NUR den Text enthaelt: der Uebersetzer setzt
	// `el.textContent = v` und raeumte eine SVG im selben Knoten mit weg (die Falle steht zweimal
	// in index.html vermerkt). Die Windrose ist deshalb ein GESCHWISTER, kein Kind.
	const veil = document.createElement("div");
	veil.className = "avesmaps-boot-veil";
	const veilText = document.createElement("div");
	veilText.className = "avesmaps-boot-veil__text";
	veilText.setAttribute("data-i18n", "boot.loading");
	veilText.setAttribute("role", "status");
	veilText.textContent = "Karte wird geladen …";
	veil.appendChild(veilText);
	host.appendChild(veil);
```

- [ ] **Step 5: Den englischen Wert eintragen**

In `js/app/i18n-en.js`, direkt **nach** der Zeile `	"ui.editorOnly": "editors only",` einfügen:

```js

	// Der Satz unter der Windrose waehrend des Startlaufs (js/app/loading-bar.js).
	// ⚠️ Er wird NACHGEZOGEN, nicht sofort gesetzt: loading-bar.js laeuft lange vor dieser Datei
	// und kennt kein tr(). Unter ?lang=en steht der Satz auf einem kalten Ladevorgang deshalb
	// kurz deutsch da, bis der Uebersetzer laeuft. Bewusst so; siehe den Entwurf §5.
	"boot.loading": "Loading the map …",
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **PASS**.

- [ ] **Step 7: Commit**

```bash
git status --short
git add css/features/loading-bar.css js/app/loading-bar.js js/app/i18n-en.js js/app/__tests__/startladen-schleier.test.js
git diff --staged
git commit -m "feat(startladen): der Schleier ueber der Karte, mit dem Satz darunter"
```

---

## Task 3: Die Windrose

**Files:**
- Modify: `js/app/loading-bar.js` (Baufunktion + Einhängen vor `veilText`)
- Modify: `css/features/loading-bar.css` (ans Ende anhängen)
- Modify: `js/app/__tests__/startladen-schleier.test.js` (Block anhängen)

**Interfaces:**
- Consumes: `veil` und `veilText` aus Task 2, sowie `--color-boot-ring-ink|pale|track` aus Task 1 und das vorhandene `--color-accent-strong`.
- Produces: die Funktion `windroseMarkup()` (keine Parameter, liefert einen SVG-String) im Rumpf von `initLoadingBar()`, und die CSS-Klassen `.avesmaps-boot-veil__rose`, `__pale`, `__ink`, `__track`, `__hub`, `__sweep`.

🔴 **Die Rose steht still, das Gold wandert.** Eine kreiselnde Kompassrose liest sich als „verirrt", nicht als „lädt" — bewegt wird allein das goldene Stück auf dem Außenring, wie ein Sonnenschatten.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `js/app/__tests__/startladen-schleier.test.js` anhängen, **vor** der `console.log`-Zeile:

```js
// ---- Die Windrose ------------------------------------------------------------------------------
//
// 💣 Der Ring haengt am SCHLEIER, nicht im Textknoten: der Uebersetzer setzt `el.textContent = v`
// und raeumte die SVG im selben Knoten mit weg, sobald jemand ?lang=en aufruft. Der Fehler waere
// unter Deutsch unsichtbar.
assert.ok(/veil\.insertBefore\(\s*rose\s*,\s*veilText\s*\)/.test(ladeJs),
	"die Windrose wird VOR den Textknoten in den Schleier gehaengt (Geschwister, nicht Kind)");
assert.ok(!/veilText\.(innerHTML|appendChild)/.test(ladeJs),
	"...und NICHT in den Textknoten: der Uebersetzer setzt dort textContent und raeumte die SVG"
	+ " mit weg -- unter Deutsch waere das unsichtbar");

// 🔴 Die Rose STEHT. Bewegt wird allein das goldene Stueck (Owner 19.08.2026) -- eine kreiselnde
// Kompassrose liest sich als „verirrt", nicht als „laedt".
const sweep = ladeCss.match(/^\.avesmaps-boot-veil__sweep\s*\{([^}]*)\}/m);
assert.ok(sweep, "das laufende Stueck hat eine eigene Regel");
assert.ok(/animation:\s*avesmaps-boot-sweep/.test(sweep[1]),
	"...und es ist das EINZIGE, was sich dreht");
const rosenRegel = ladeCss.match(/^\.avesmaps-boot-veil__rose\s*\{([^}]*)\}/m);
assert.ok(rosenRegel && !/animation:/.test(rosenRegel[1]),
	"die Rose selbst dreht sich NICHT -- eine kreiselnde Kompassrose liest sich als „verirrt\"");

// 💣 Ohne `transform-box: fill-box` ist der Bezugspunkt einer Drehung bei einem SVG-Teilelement
// der ganze Zeichenbereich: das goldene Stueck liefe dann auf einer KREISBAHN um die Rose herum,
// statt sich an Ort und Stelle zu drehen. Das sieht aus wie ein Fehler im Pfad und ist keiner.
assert.ok(/transform-box:\s*fill-box/.test(sweep[1]),
	"transform-box: fill-box ist tragend -- ohne sie kreist das Goldstueck um die Rose herum");
assert.ok(/transform-origin:\s*center/.test(sweep[1]),
	"...zusammen mit transform-origin: center");

// ⚠️ Ein voellig stehender Kreis sagt nichts. Unter prefers-reduced-motion blendet er auf und ab.
const ruhig = ladeCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g) || [];
assert.ok(ruhig.some((block) => /avesmaps-boot-veil__sweep/.test(block) && /avesmaps-boot-pulse/.test(block)),
	"unter prefers-reduced-motion tritt eine Blende an die Stelle der Drehung -- ein voellig"
	+ " stehender Kreis sagt nichts, und eine Blende ist keine vestibulaere Bewegung");

// ---- Keine Farbe im Markup ---------------------------------------------------------------------
//
// 💣 Die SVG entsteht als String im JS. Genau dort schleicht sich ein Literal ein, das kein
// CSS-Sweep je findet -- und im dunklen Thema faellt es dann als schwarzer Fleck auf.
const markup = ladeJs.match(/function windroseMarkup\(\)[\s\S]*?\n\t\}/);
assert.ok(markup, "windroseMarkup() steht in loading-bar.js");
assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(markup[0]),
	"kein Farbliteral in der SVG -- die Farben kommen ueber Klassen aus dem Stylesheet"
	+ " (AGENTS.md §12). Ein Literal hier faende kein CSS-Sweep je.");

// ---- Der Teilstrichkranz ist GERECHNET, nicht geraten -------------------------------------------
//
// 24 Striche auf dem Ring r=40: Umfang 2*PI*40 = 251,33, geteilt durch 24 = 10,47 -- minus der
// Strichlaenge 1,6 bleibt die Luecke 8,87. Eine geratene Zahl laesst den Kranz sichtbar auslaufen
// (der letzte Strich trifft den ersten nicht).
const kranz = ladeJs.match(/stroke-dasharray="1\.6 ([0-9.]+)"/);
assert.ok(kranz, "der Teilstrichkranz traegt seine dasharray");
const erwarteteLuecke = (2 * Math.PI * 40) / 24 - 1.6;
assert.ok(Math.abs(Number(kranz[1]) - erwarteteLuecke) < 0.05,
	`die Luecke im Kranz ist ${kranz[1]}, gerechnet waeren es ${erwarteteLuecke.toFixed(2)}`
	+ " (24 Striche auf r=40). Eine geratene Zahl laesst den Kranz sichtbar auslaufen.");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **FAIL** mit `die Windrose wird VOR den Textknoten in den Schleier gehaengt`.

- [ ] **Step 3: Die Rose bauen**

In `js/app/loading-bar.js`, direkt **nach** der Zeile `	veil.appendChild(veilText);` und **vor** `	host.appendChild(veil);` einfügen:

```js

	// Die Windrose -- das Wappen der alten Karten, gewaehlt aus vier vorgelegten Fassungen
	// (Owner 19.08.2026: „die windrose ist schön").
	// 🔴 Sie STEHT. Bewegt wird allein das goldene Stueck auf dem Aussenring, wie ein
	// Sonnenschatten: eine kreiselnde Kompassrose liest sich als „verirrt", nicht als „laedt".
	// 💣 Kein Farbwert im Markup -- die Farben haengen an Klassen und kommen aus dem Stylesheet
	// (AGENTS.md §12). Ein Literal hier faende kein CSS-Sweep je, und im dunklen Thema stuende es
	// als schwarzer Fleck da.
	// Die acht Zacken entstehen in zwei Schleifen, damit die Drehwinkel nicht achtmal von Hand
	// dastehen. Gezeichnet wird in einem 0..100-Feld um den Mittelpunkt 50,50.
	function windroseMarkup() {
		let zacken = "";
		// vier LANGE Zacken (N/O/S/W), je zwei Haelften hell/dunkel -- die Seekarten-Optik
		[0, 90, 180, 270].forEach(function (grad) {
			zacken += '<g transform="rotate(' + grad + ' 50 50)">'
				+ '<path class="avesmaps-boot-veil__pale" d="M50 15 L43.5 43.5 L50 50 Z"/>'
				+ '<path class="avesmaps-boot-veil__ink" d="M50 15 L56.5 43.5 L50 50 Z"/>'
				+ "</g>";
		});
		// vier KURZE Zacken (NO/SO/SW/NW)
		[45, 135, 225, 315].forEach(function (grad) {
			zacken += '<g transform="rotate(' + grad + ' 50 50)">'
				+ '<path class="avesmaps-boot-veil__pale" d="M50 27 L46 46 L50 50 Z"/>'
				+ '<path class="avesmaps-boot-veil__ink" d="M50 27 L54 46 L50 50 Z"/>'
				+ "</g>";
		});
		return '<svg class="avesmaps-boot-veil__rose" viewBox="0 0 100 100" aria-hidden="true">'
			+ '<circle class="avesmaps-boot-veil__track" cx="50" cy="50" r="46" fill="none"'
			+ ' stroke-width="1.5"/>'
			// 💣 Die Luecke ist AUS DEM UMFANG gerechnet: 24 Striche auf r=40, Umfang 2*PI*40 =
			// 251,33, davon ein Vierundzwanzigstel = 10,47, minus 1,6 Strichlaenge = 8,87. Eine
			// geratene Zahl laesst den Kranz sichtbar auslaufen -- der letzte Strich trifft den
			// ersten nicht. Der Test rechnet es nach.
			+ '<circle class="avesmaps-boot-veil__track" cx="50" cy="50" r="40" fill="none"'
			+ ' stroke-width="4" stroke-dasharray="1.6 8.87"/>'
			+ zacken
			+ '<circle class="avesmaps-boot-veil__hub" cx="50" cy="50" r="2.6"/>'
			// Das laufende Stueck: 48 von 289,03 Umfang (2*PI*46), also rund ein Sechstel des
			// Kreises -- gross genug, um es zu sehen, klein genug, um nicht als Ring zu lesen.
			+ '<circle class="avesmaps-boot-veil__sweep" cx="50" cy="50" r="46" fill="none"'
			+ ' stroke-width="3" stroke-linecap="round" stroke-dasharray="48 241"/>'
			+ "</svg>";
	}

	const rose = document.createElement("div");
	rose.className = "avesmaps-boot-veil__ring";
	rose.innerHTML = windroseMarkup();
	veil.insertBefore(rose, veilText);
```

- [ ] **Step 4: Das Stylesheet erweitern**

Ans **Ende** von `css/features/loading-bar.css` anhängen:

```css

/* ---- Die Windrose im Schleier ----------------------------------------------------------------
   Gebaut in js/app/loading-bar.js (windroseMarkup); hier stehen ihre Farben und ihre Bewegung.
   💣 Die Farben stehen NUR hier. Das Markup traegt Klassen und keinen einzigen Farbwert -- ein
   Literal im JS-String faende kein CSS-Sweep je (AGENTS.md §12), und im dunklen Thema stuende es
   als schwarzer Fleck da. */
.avesmaps-boot-veil__rose {
	display: block;
	width: 64px;
	height: 64px;
}
.avesmaps-boot-veil__pale { fill: var(--color-boot-ring-pale); }
.avesmaps-boot-veil__ink { fill: var(--color-boot-ring-ink); }
.avesmaps-boot-veil__hub { fill: var(--color-accent-strong); }
.avesmaps-boot-veil__track { stroke: var(--color-boot-ring-track); }

/* 🔴 Das EINZIGE, was sich bewegt. Die Rose selbst steht -- eine kreiselnde Kompassrose liest sich
   als „verirrt", nicht als „laedt" (Owner 19.08.2026).
   💣 `transform-box: fill-box` ist tragend: ohne sie ist der Bezugspunkt einer Drehung bei einem
   SVG-Teilelement der ganze Zeichenbereich, und das Goldstueck liefe auf einer KREISBAHN um die
   Rose herum, statt sich an Ort und Stelle zu drehen. Das sieht aus wie ein Fehler im Pfad und
   ist keiner. */
.avesmaps-boot-veil__sweep {
	stroke: var(--color-accent-strong);
	transform-box: fill-box;
	transform-origin: center;
	animation: avesmaps-boot-sweep 1.5s linear infinite;
}

@keyframes avesmaps-boot-sweep {
	to { transform: rotate(360deg); }
}

/* ⚠️ Ein voellig stehender Kreis sagt nichts -- er saehe aus, als waere die Seite eingefroren,
   also genau nach dem, was er widerlegen soll. Statt der Drehung blendet er langsam auf und ab:
   das ist keine vestibulaere Bewegung und bleibt trotzdem ein Lebenszeichen. */
@keyframes avesmaps-boot-pulse {
	0%, 100% { opacity: 0.35; }
	50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
	.avesmaps-boot-veil__sweep {
		animation: avesmaps-boot-pulse 1.8s ease-in-out infinite;
	}
}
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **PASS**.

- [ ] **Step 6: Commit**

```bash
git status --short
git add css/features/loading-bar.css js/app/loading-bar.js js/app/__tests__/startladen-schleier.test.js
git diff --staged
git commit -m "feat(startladen): die Windrose in der Mitte -- sie steht, das Gold wandert"
```

---

## Task 4: Das ganze Testfeld, dann live — und der Owner sieht es

🔴 **Hier ist ein HALT.** Der Schleier samt Windrose ist eine sichtbare Änderung an der Oberfläche. Sie geht **allein** live, und der Owner sieht sie, bevor Task 5 beginnt (AGENTS.md §9).

**Files:** keine — dies ist ein Prüf- und Freigabeschritt.

- [ ] **Step 1: Das ganze JS-Testfeld**

💣 Nicht nur die eigenen Tests. Die Datei, die bricht, gehört meistens jemand anderem.

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

Erwartet: kein `ROT:`.

- [ ] **Step 2: Das PHP-Testfeld, mit den Erweiterungen**

⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden **45 Tests** rot, die alle nur die Erweiterung vermissen. Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf) — kein Regressionssignal.

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" || echo "ROT: $t"; done
```

- [ ] **Step 3: Die 21 Wikidump-Tests, die das Muster oben NICHT findet**

💣 Sie stehen weder in einem `__tests__`-Verzeichnis noch enden sie auf `-test.php` — genau diese Lücke kostete am 15.08.2026 zwei Deploys.

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

- [ ] **Step 4: Im Browser ansehen, bevor gepusht wird**

💣 Abnahme heißt ABLAUF, nicht Maß. Eine grüne Regexp belegt nicht, dass etwas funktioniert.

Auszuführen und zu benennen:
1. `index.html` mit **leerem Cache** laden (Netzwerk-Drosselung hilft, den Zustand zu sehen).
2. Der Schleier liegt über den Kacheln, die Rose steht, das goldene Stück wandert.
3. **Während der Schleier steht: die Karte schieben und zoomen** — beides muss gehen (`pointer-events: none`).
4. Der schmale Streifen oben ist **sichtbar**, nicht verdeckt.
5. Ist geladen, blendet der Schleier aus — kein Sprung, kein Rest.
6. Dasselbe im **dunklen Thema** (Themenschalter): kein weißer Blitz, die Rose bleibt lesbar.

⚠️ Was ein Emulator nicht beantworten kann, wird als **offene Frage gemeldet**, nicht als bestanden.

- [ ] **Step 5: Push und Deploy prüfen**

```bash
git status --short
git log --oneline origin/master..HEAD
git push
```

Danach die entfernte SHA prüfen und ~1–2 Minuten warten, bevor die Live-Seite beurteilt wird.

```bash
git ls-remote origin master
```

- [ ] **Step 6: Dem Owner zeigen und auf sein Wort warten**

Die Live-Adresse nennen und **anhalten**. Task 5 beginnt erst, wenn der Owner den Schleier gesehen hat.

---

## Task 5: Die rechte Kante fährt herein

**Files:**
- Modify: `css/features/loading-bar.css` (ans Ende anhängen)
- Modify: `css/features/infopanel.css` (Regel `.avesmaps-infopanel__handle`, Transition)
- Modify: `css/features/review-panel.css` (Regel `.review-panel-toggle`, Transition)
- Modify: `js/app/__tests__/startladen-schleier.test.js` (Block anhängen)

**Interfaces:**
- Consumes: nichts aus Task 1–3. Diese Aufgabe ist unabhängig und könnte allein stehen.
- Produces: vier Startstellungen an der Klasse `avesmaps-booting`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

An `js/app/__tests__/startladen-schleier.test.js` anhängen, **vor** der `console.log`-Zeile:

```js
// ---- Die rechte Kante faehrt herein ------------------------------------------------------------
//
// Owner 19.08.2026: „info bzw. editor panel ebenfalls rechts versteckt bleiben und nach links
// ausklappen sobald geladen ist" -- spiegelbildlich zum Planer gegenueber.
const startstellung = ladeCss.match(
	/^html\.avesmaps-booting \.avesmaps-infopanel__handle,\s*html\.avesmaps-booting \.avesmaps-infopanel,\s*html\.avesmaps-booting #review-panel\s*\{([^}]*)\}/m);
assert.ok(startstellung,
	"die drei UNGEDREHTEN Flaechen der rechten Kante stehen in EINER Regel -- drei Regeln waeren"
	+ " drei Strecken, die auseinanderlaufen koennen");
assert.ok(/transform:\s*translateX\(100%\)/.test(startstellung[1]),
	"...und warten 100% ihrer EIGENEN Breite weit draussen. Prozent, keine Zahl: am Telefon ist"
	+ " die Lasche 26px breit statt 30 (--avesmaps-tab-w im Finger-Block), und ein Token waere"
	+ " hier eine zweite Stelle, die das wissen muesste.");

// 💣 `transform`, nicht `right`. `right` waere naheliegend -- beide Laschen haben schon eine
// right-Transition fuers Andocken an die Panelkante. Aber die Andockregeln in
// css/features/infopanel.css setzen `right: 0` bei GLEICHER Spezifitaet und stehen SPAETER im
// Ladepfad als diese Datei: sie ueberstuermen die Startstellung lautlos, und die Laschen blieben
// einfach stehen. `transform` kollidiert mit nichts.
assert.ok(!/(^|[^-])right:/.test(startstellung[1]),
	"die Startstellung laeuft ueber transform, NICHT ueber right -- die Andockregeln in"
	+ " infopanel.css setzen right:0 bei gleicher Spezifitaet und stehen spaeter im Ladepfad");

// 💣 Die Editor-Lasche traegt schon `transform: rotate(180deg)`. Ein danebengeschriebenes
// translateX ERSETZT die Drehung -- die Beschriftung stuende kopf. Und weil nach der Drehung ihre
// eigene x-Achse nach LINKS zeigt, muss es MINUS heissen: ein +100% schoebe sie ueber die Karte
// statt aus dem Bild. Dieselbe Strecke wie oben, zwei Schreibweisen -- deshalb eine eigene Regel.
const editorLasche = ladeCss.match(/^html\.avesmaps-booting #review-panel-toggle\s*\{([^}]*)\}/m);
assert.ok(editorLasche, "die Editor-Lasche hat ihre EIGENE Regel (sie ist gedreht)");
assert.ok(/transform:\s*rotate\(180deg\)\s+translateX\(-100%\)/.test(editorLasche[1]),
	"Sie komponiert rotate(180deg) MIT translateX(-100%). Ohne das rotate steht die Beschriftung"
	+ " kopf; mit +100% schiebt sie sich ueber die Karte statt aus dem Bild.");

// ⚠️ Ohne `transform` in der eigenen Transition SPRINGEN die Laschen am Ende des Startlaufs auf
// ihren Platz, statt zu gleiten. Der Balken faellt auf, die fehlende Bewegung nicht.
const infoCss = withoutComments(read("css", "features", "infopanel.css"));
const handleRegel = infoCss.match(/^\.avesmaps-infopanel__handle\s*\{([^}]*)\}/m);
assert.ok(handleRegel, "die Regel .avesmaps-infopanel__handle steht in infopanel.css");
assert.ok(/transition:[^;]*transform 0\.22s/.test(handleRegel[1]),
	"die Info-Lasche fuehrt transform in ihrer Transition -- sonst springt sie, statt zu gleiten");

const reviewCss = withoutComments(read("css", "features", "review-panel.css"));
const toggleRegel = reviewCss.match(/^\.review-panel-toggle\s*\{([^}]*)\}/m);
assert.ok(toggleRegel, "die Regel .review-panel-toggle steht in review-panel.css");
assert.ok(/transition:[^;]*transform 220ms/.test(toggleRegel[1]),
	"die Editor-Lasche ebenso -- und in IHRER Dauer (220ms), nicht in einer neuen");

// 🔴 Der Planer und SEINE Lasche bleiben unangetastet. #toggle-button steht auf left:350px und
// landet beim Start auf left:0 -- also sichtbar. Das ist der Owner-Entscheid vom 12.08.2026
// („ich meinte nicht, dass die tab-lasche nachgeladen wird") und kein Versehen.
const planerEinfahrt = ladeCss.match(
	/^html:not\(\.avesmaps-phone\)\.avesmaps-booting #search,\s*html:not\(\.avesmaps-phone\)\.avesmaps-booting #toggle-button\s*\{([^}]*)\}/m);
assert.ok(planerEinfahrt && /--avesmaps-planner-width/.test(planerEinfahrt[1]),
	"die Startstellung des Planers steht unveraendert da -- dieser Bau fasst sie nicht an");
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **FAIL** mit `die drei UNGEDREHTEN Flaechen der rechten Kante stehen in EINER Regel`.

- [ ] **Step 3: Die Startstellungen anlegen**

Ans **Ende** von `css/features/loading-bar.css` anhängen:

```css

/* ---- Und die rechte Kante faehrt herein ------------------------------------------------------
   Owner 19.08.2026: „info bzw. editor panel ebenfalls rechts versteckt bleiben und nach links
   ausklappen sobald geladen ist" -- spiegelbildlich zum Planer weiter oben, gleiche 0,22s.
   Betroffen sind vier Flaechen: die beiden Rand-Laschen und die beiden Panels dahinter. Die
   Panels tragen ihre Startstellung ueber `.is-hidden` ohnehin schon; die Regel hier wirkt bei
   ihnen nur in dem einen Fall, der sonst durchfiele -- ein Panel, das im Edit-Modus bereits
   offen ist, waehrend der Startlauf noch laeuft.
   💣 `transform`, nicht `right`. `right` waere naheliegend: beide Laschen haben schon eine
   right-Transition fuers Andocken an die Panelkante. Aber die Andockregeln in
   css/features/infopanel.css setzen `right: 0` bei GLEICHER Spezifitaet und stehen spaeter im
   Ladepfad als diese Datei -- sie ueberstuermen die Startstellung lautlos, und die Laschen
   blieben einfach stehen. `transform` kollidiert mit nichts.
   💣 Verschoben wird um 100% der EIGENEN Breite, nicht um eine Zahl: am Telefon ist die Lasche
   26px breit statt 30 (--avesmaps-tab-w im Finger-Block von tokens.css), und ein Token waere hier
   eine zweite Stelle, die das wissen muesste. */
html.avesmaps-booting .avesmaps-infopanel__handle,
html.avesmaps-booting .avesmaps-infopanel,
html.avesmaps-booting #review-panel {
	transform: translateX(100%);
}
/* 💣 Und DESHALB steht die Editor-Lasche nicht in der Regel darueber, obwohl es dieselbe Strecke
   ist: sie traegt schon `transform: rotate(180deg)` (css/features/review-panel.css). Ein
   danebengeschriebenes translateX ERSETZT die Drehung -- die Beschriftung stuende kopf. Und weil
   nach der Drehung ihre eigene x-Achse nach LINKS zeigt, muss es MINUS heissen: ein +100% schoebe
   sie ueber die Karte statt aus dem Bild. Beide Vorzeichen sind einzeln im Test festgenagelt. */
html.avesmaps-booting #review-panel-toggle {
	transform: rotate(180deg) translateX(-100%);
}
```

- [ ] **Step 4: Die Info-Lasche gleiten lassen**

In `css/features/infopanel.css`, in der Regel `.avesmaps-infopanel__handle`, diese Zeile:

```css
	transition: right 0.22s ease, background-color 0.12s ease;
```

ersetzen durch:

```css
	/* `transform` gehoert dazu, seit die Lasche beim Startlauf hereinfaehrt
	   (css/features/loading-bar.css) -- ohne sie SPRINGT sie am Ende auf ihren Platz. */
	transition: right 0.22s ease, transform 0.22s ease, background-color 0.12s ease;
```

- [ ] **Step 5: Die Editor-Lasche gleiten lassen**

In `css/features/review-panel.css`, in der Regel `.review-panel-toggle`, diese Zeile:

```css
	transition: right 220ms ease;
```

ersetzen durch:

```css
	/* `transform` gehoert dazu, seit die Lasche beim Startlauf hereinfaehrt
	   (css/features/loading-bar.css) -- ohne sie SPRINGT sie am Ende auf ihren Platz. Die Drehung
	   darueber ist konstant und wird dadurch nicht animiert. */
	transition: right 220ms ease, transform 220ms ease;
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

```bash
node js/app/__tests__/startladen-schleier.test.js
```

Erwartet: **PASS**.

- [ ] **Step 7: Commit**

```bash
git status --short
git add css/features/loading-bar.css css/features/infopanel.css css/features/review-panel.css js/app/__tests__/startladen-schleier.test.js
git diff --staged
git commit -m "feat(startladen): die rechte Kante wartet draussen und faehrt nach links herein"
```

---

## Task 6: Das ganze Testfeld, dann live — zweiter Halt

🔴 Die zweite sichtbare Änderung geht **allein** live.

**Files:** keine — Prüf- und Freigabeschritt.

- [ ] **Step 1: Die drei Testläufe wiederholen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" || echo "ROT: $t"; done
```

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t" || echo "ROT: $t"; done
```

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

- [ ] **Step 2: Im Browser ansehen — die Handgriffe, nicht die Maße**

1. Kalt laden: die rechte Kante ist **leer** — keine „Info"-Lasche, keine „Editor"-Lasche.
2. Ist geladen, **gleitet** die Info-Lasche von rechts herein (kein Sprung).
3. Auf die Lasche klicken: das Infopanel fährt auf wie immer.
4. Ein Kartenobjekt anklicken: das Panel öffnet, die Lasche wandert an die Panelkante (die alte `right`-Bewegung ist unversehrt).
5. Im **Edit-Modus** (`edit/`) dasselbe für die Editor-Lasche — und die Beschriftung „Editor" steht **richtig herum**, nicht kopf.
6. Beide Themen.

- [ ] **Step 3: Push und dem Owner zeigen**

```bash
git status --short
git log --oneline origin/master..HEAD
git push
git ls-remote origin master
```

Danach ~1–2 Minuten warten, die Live-Adresse nennen und **anhalten**.

- [ ] **Step 4: Den Entwurf um das Gemessene ergänzen**

Was im Browser anders war als gedacht, wird im Entwurf an seiner Stelle korrigiert — nicht stillschweigend geglättet. Die drei offenen Punkte in §11 des Entwurfs werden abgehakt oder umformuliert.

---

## Selbstdurchgang gegen den Entwurf

| Entwurf | Aufgabe |
|---|---|
| §3 hängt an `avesmaps-booting`, kein zweiter Zuhörer | Task 2 Step 4 (Knoten in derselben Datei), Task 5 Step 3 (Regeln an derselben Klasse) |
| §4 Schleier: `pointer-events: none` | Task 2, Test + Step 3 |
| §4 z-index unter dem Balken | Task 2, Test liest beide Zahlen |
| §4 `opacity`/`visibility`, kein `display` | Task 2, Test + Step 3 |
| §4 dunkles Thema nicht weiß | Task 1 Step 4, Test prüft beide Blöcke |
| §5 Rose steht, Gold wandert | Task 3, Test prüft `.rose` **ohne** `animation` |
| §5 Teilstrichkranz aus dem Umfang gerechnet | Task 3, Test rechnet nach |
| §5 `transform-box: fill-box` | Task 3, Test |
| §5 `prefers-reduced-motion` | Task 3, Test + Step 4 |
| §5 Text mit `data-i18n`, getrennt von der SVG | Task 2 (i18n) + Task 3 (Geschwister-Zusicherung) |
| §6 vier Flächen, `transform` statt `right` | Task 5, Test + Step 3 |
| §6 Editor-Lasche: `rotate(180deg) translateX(-100%)` | Task 5, eigene Regel + eigene Zusicherung |
| §6 `transform` in beide Transitions | Task 5 Steps 4 + 5, je eine Zusicherung |
| §7 Planer und seine Lasche unangetastet | Task 5, Test nagelt die alte Regel fest |
| §8 vier Token, Gold ist `--color-accent-strong` | Task 1, Test verbietet ein fünftes Token |
| §10 alle neun Zusicherungen | über Task 1, 2, 3, 5 verteilt |
