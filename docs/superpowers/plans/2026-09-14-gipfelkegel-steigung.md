# Gipfel als Kegel mit Steigung — Bauplan

> **Für ausführende Agenten:** PFLICHT-SKILL: superpowers:subagent-driven-development (empfohlen) oder
> superpowers:executing-plans, Aufgabe für Aufgabe. Schritte tragen Häkchen (`- [ ]`).

**Ziel:** Der Regler „Ausstrahlung der Gipfel" wird zu „Steigung der Gipfel": nach der Erosion wird das
Gelände um jeden Gipfel auf einen Kegel mit Radius Höhe ÷ tan(Steigung) eingeblendet („eingeblendet,
korrigiert"), und der Flächendialog zeigt diesen Radius als gestrichelten Kreis.

**Architektur:** Eine reine Funktion `blendeGipfelkegel` in `map-features-ecosystem-hydrologie.js` läuft im
Trichter `avesmapsGebirgsRasterBauen` nach dem Deckel am Ausgang; `addiereGipfelkegel` (die Ausstrahlung vor
dem Rauschen) fällt. Der Wert reist als neue Spalte `ecosystem_area.terrain_gipfel_steigung` durch Server
(DDL, Schranke, Lesewege, Fingerabdruck, Nutzlastversion), Loader, Eigenschaftenfenster und `reglerFuer`.
Den Kreis zeichnet `map-features-ecosystem-height-render.js` auf seiner Leinwand aus demselben
`avesmapsGipfelRadius`.

**Tech Stack:** Vanilla-JS ohne Build (Node-Tests mit `assert`/`vm`), PHP 8 strict + MySQL, Headless-Chrome
per CDP für Bilder.

**Entwurf:** `docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md` (samt Nachtrag „Eingeblendet,
korrigiert"). **Mockup:** `docs/gipfel-steigung-dialog-mockup.html`.

## Globale Vorgaben

- 🔴 **Kein Produktivcode ohne ausdrückliches GO des Owners**, und jeder Schritt wird ihm vorher als Bild oder
  Mockup gezeigt (Owner 14.09.2026).
- 🔴 **Fall #109 (Flusstäler) zuerst** (Entwurf §7). Dieser Bau setzt auf dessen Stand auf.
- Gebaut wird in einem **eigenen Worktree auf `origin/master`**, nie im Hauptbaum (veraltet, trägt fremde
  Arbeit).
- Nur eigene Pfade stagen, einzeln per Pfad — nie `git add -A`, `git add .`, `git commit -a`; `git add` und
  `git commit` in EINEM Zug.
- Commit-Nachricht **immer per Datei** (`git commit -F <datei>`), Deutsch, Scope `landschaften:`, letzte Zeile
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`; vor dem Push `git log -1 --format=%B` lesen.
- Vor **jedem** Push: ganzes Testfeld nach dem Muster des Workflows (unten), Dateizahl gegengezählt;
  `gh run list --limit 3` (steht ein Lauf `in_progress` UND einer `pending`: warten); die jüngsten Commits an
  `js/map-features/map-features-ecosystem-hydrologie.js` lesen; Push ohne Pipe; danach
  `git ls-remote origin master` muss den eigenen SHA zeigen.
- **Sichtbare Änderungen einzeln live:** Push 1 (Regler + Kegel) → Deploy-Lauf abwarten → Owner-Blick →
  erst dann Push 2 (Kreise).
- **Einen Bauer ausführen statt Quelltext greppen:** jede neue Zusicherung fährt die Funktion; jede wird gegen
  die Mutationen aus Entwurf §9 geprüft.
- Nicht anfassen: `html/editor-handbuch.html` (nächtliche Routine). `terrain_bergform` bleibt in der
  Datenbank stehen (kein `DROP`, der Deploy löscht ohnehin nie).
- Deutsch schreiben — Kommentare, Tests, Commits.

**Werte, wörtlich aus dem Entwurf:**

| Was | Wert |
|---|---|
| Vorgabe ohne eigenen Wert | 30° (`ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG`) |
| Exponent des Herabziehens | 4 (`ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT`) |
| Regler | 0–60°, Schritt 1, Zahlenfeld, Vorgabemarke, ↺ |
| Server-Schranke | `'terrain_gipfel_steigung' => [0.0, 60.0]` |
| Spalte | `ecosystem_area.terrain_gipfel_steigung DECIMAL(6,2)`, `NULL` = Vorgabe |
| Steigung 0 | kein Kegel, keine Kreise |
| Token | `--color-ecosystem-gipfel-radius: #e0a82e` (nur `:root`) |
| Kreis | 1,3 px, gestrichelt 4/3 |
| Vorlagen | Kamm 25 · Grat 30 · Kette 35 (🔧 Aufgabe 0) · Kuppen 20 · Massen 20 · Plateau 15 · Rumpf 12 · Schild 6 · Inselberg 45 · Karst 30 |
| Beschriftung / Tooltip | „Steigung der Gipfel" / „Wie steil ein Gipfel abfällt. Daraus folgt, wie weit er ins Gelände reicht: Höhe ÷ tan(Steigung) — ein 5.000er reicht bei 30° 8,7 Meilen. 0 = die Gipfel formen das Gelände nicht." |
| Ohne Gipfel | „Diese Fläche hat keinen Gipfel — es gibt keinen Hang, dessen Steigung wirken könnte." |

**Das Testfeld** (im Worktree, Bash; `$SCRATCH` = Scratchpad der ausführenden Sitzung):

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-js.txt"
```

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > "$SCRATCH/rot-php.txt"
```

💣 Die doppelte Klammer um beide `find`-Gruppen ist tragend (sonst laufen nur die `test-*`-Dateien). Die
Zählzeilen müssen dieselbe Zahl ergeben wie das Muster in `.github/workflows/deploy-avesmaps-strato.yml`.
Ein unerwartet Roter wird seriell nachgefahren, bevor man ihn glaubt.

## Dateikarte

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `js/map-features/map-features-ecosystem-hydrologie.js` | Radius, Einblendung, Trichter, Vorlagen, „ohne Wirkung", Exporte | 1, 3 |
| `js/map-features/__tests__/gipfelkegel-steigung.test.js` (neu) | Kern und Trichter, ausgeführt | 1, 3 |
| `js/map-features/map-features-ecosystem-height-render.js` | `reglerFuer`, Kreise | 3, 7 |
| `js/map-features/map-features-ecosystem-properties.js` | `TERRAIN_FIELDS`, Vorgaben, Vorlagenfelder | 3 |
| `js/map-features/map-features-ecosystem-loader.js` | Wertfelder | 3 |
| `index.html` | Reglerzeile | 3 |
| `api/_internal/app/ecosystem.php` | Spalte, Lesewege, Schranke | 3 |
| `api/_internal/app/terrain-store.php` | Fingerabdruck, zwei SELECTs | 3 |
| `api/app/ecosystem-areas.php` | Nutzlastversion 13 → 14 | 3 |
| Tests mit `bergform` (Liste in Aufgabe 3) | nachziehen | 3 |
| `css/base/tokens.css` | Token des Kreises | 6 |
| `js/map-features/__tests__/gipfel-kreis.test.js` (neu) | Kreise, ausgeführt | 6 |
| `docs/gipfel-steigung-dialog-mockup.html` | Vertragsmarken für das Token | 6 |
| `docs/ansicht-untergrund-mockup.html` | aus `tokens.css` neu erzeugen | 6 |
| `AGENTS.md` §11 | Eintrag | 8 |

Reihenfolge: 0 Voraussetzungen · 1 Kern · 2 Damm messen (Haltepunkt) · 3 Umstieg Modul/Dialog/Server ·
4 Reisezeiten messen · 5 Push 1 + Abnahme · 6 Kreise · 7 Push 2 + Abnahme · 8 Nacharbeit.
Messwerkzeuge (Aufgaben 2 und 4) liegen im Scratchpad und werden **nicht** committet.

---

## Aufgabe 0: Voraussetzungen und Owner-Fragen (kein Code)

**Dateien:** keine (nur lesen, fragen, Worktree anlegen).

- [ ] **Schritt 1: Ist #109 gelandet?**

```bash
git fetch origin master && git log origin/master --since=2026-09-14 --format="%h %ad %s" --date=format:"%d.%m %H:%M" -- js/map-features/map-features-ecosystem-hydrologie.js js/map-features/map-features-ecosystem-height-render.js api/_internal/app/terrain-store.php
```

Erwartet: Commits von #109 (Mündungsbaum, Stempel mit Flüssen). Stand beim Schreiben dieses Plans
(14.09.2026 20:40): **keiner**. Ohne sie: STOPP und den Owner fragen, ob gewartet wird.

- [ ] **Schritt 2: Überschneidungen lesen.** `git show --stat <jeder #109-Commit>`; danach prüfen, dass jeder
  Anker aus Aufgabe 3 genau einmal vorkommt (ein Zähler ≠ 1 heißt: der Schritt muss an den neuen Stand
  angepasst werden, und der Owner hört davon):

```bash
cd "$WT" && for a in "const ECOSYSTEM_HYDRO_BERGFORM = 2.5;" "const kegel = addiereGipfelkegel(r, h, peaks, reg.bergform, ECOSYSTEM_HYDRO_STANDARDHOEHE, fest, mantel);" "if (melde) { melde(1); }" "stempleGipfel, addiereGipfelkegel, spannbaum," "ECOSYSTEM_HYDRO_BERGFORM, ECOSYSTEM_HYDRO_RAUSCHEN," "bergform: area?.terrain_bergform ?? undefined," "'bergform=' . \$number(\$areaRow['terrain_bergform'] ?? null),"; do printf '%s  <- ' "$(grep -F -- "$a" js/map-features/map-features-ecosystem-hydrologie.js js/map-features/map-features-ecosystem-height-render.js api/_internal/app/terrain-store.php | wc -l)"; echo "$a"; done
```

Erwartet: jede Zeile beginnt mit `1`.

- [ ] **Schritt 3: Worktree anlegen.**

```bash
git worktree add --detach "$SCRATCH/wt-gipfel" origin/master
```

Ab hier ist `$WT` = `$SCRATCH/wt-gipfel`. Gepusht wird mit `git push origin HEAD:master`. Den Ausgangsstand
für den Vergleich „heute" festhalten:

```bash
git -C "$SCRATCH/wt-gipfel" rev-parse HEAD > "$SCRATCH/basis.txt"
```

- [ ] **Schritt 4: Nulllinie des Testfelds** auf dem frischen Worktree fahren (Befehle oben) und die zwei
  Listen als `$SCRATCH/nulllinie-js.txt` / `nulllinie-php.txt` ablegen. Nach dem Bau darf keine Datei neu rot
  sein; vorbestehend rot ist `tools/linkcheck/link-url-test.php` (DNS).

- [ ] **Schritt 5: 🔧 Owner-Frage stellen** — einfach, mit Empfehlung, EINE Frage:

  > Mit Steigung statt Ausstrahlung sind Gratgebirge und Kettengebirge im Vorlagentest nicht mehr zu
  > unterscheiden. Gemessen (mittlere Höhe 1–2 Einheiten um die Gipfel, Anteil der Gipfelhöhe): Grat 30° 0,522
  > · Kette 35° 0,540 (Abstand 0,018) · Kette 40° 0,561 (Abstand 0,039).
  > **Empfehlung:** Kettengebirge bekommt **40°** statt 35°, und der Test bekommt diese Hang-Kennzahl als
  > fünfte (Schwelle 0,02). **Oder:** 35° bleibt, und das Paar steht als benannte Ausnahme im Test.

  Die Antwort bestimmt Aufgabe 3, Schritt 9. Wählt der Owner 40°, gehört ein Nachtrag in Entwurf §5.2.

- [ ] **Schritt 6: GO einholen** — wörtlich notieren. Ohne GO endet der Plan hier.

---
## Aufgabe 1: Der Kern — Radius und Einblendung (TDD)

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-hydrologie.js` (Konstante bei `const ECOSYSTEM_HYDRO_BERGFORM = 2.5;`, zwei neue Funktionen direkt über dem Kommentar `// DIE EINZELBERGE -- ADDIERT, nicht festgenagelt`, Exporte)
- Anlegen: `js/map-features/__tests__/gipfelkegel-steigung.test.js`

**Schnittstellen:**
- Nutzt (vorhanden): `randAbstand(r)` (Chamfer, Zellen × 3), `ecosystemTalSohle(talIndex, x, y) → { bed } | null`,
  `SCHRITT_JE_EINHEIT` (3000), `ECOSYSTEM_HYDRO_STANDARDHOEHE` (5000); am Raster `r`: `w`, `hh`, `cell`,
  `cellS` (Schritt je Zelle), `drin`, `i(x)`, `j(y)`, `x(i)`, `y(j)`.
- Liefert:
  - `const ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG = 30;` · `const ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT = 4;`
  - `avesmapsGipfelRadius(hoehe: number|null, steigung: number|null|undefined): number` — Karteneinheiten, `0` bei Steigung ≤ 0
  - `blendeGipfelkegel(r, h: Float64Array, gipfel: Array<{x, y, h, n?}>, steigung, kern: Uint8Array, senke: Uint8Array, talIndex|null): { zellen: number, wirksam: Array<{name: string, rad: number}> }` — schreibt `h` an Ort und Stelle
- ⚠️ In dieser Aufgabe wird **nichts verdrahtet**; `addiereGipfelkegel` bleibt bis Aufgabe 3 stehen.

- [ ] **Schritt 1: Den Test schreiben** — `js/map-features/__tests__/gipfelkegel-steigung.test.js`:

```js
"use strict";

// Der Gipfelkegel mit Steigung (Entwurf docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md, §4).
//
// 🔴 AUSGEFUEHRT, NICHT GELESEN: jede Zusicherung faehrt `blendeGipfelkegel` bzw. den Trichter. Jede ist
// gegen eine Mutation aus §9 des Entwurfs gebaut -- wer genau das im Produktivcode tut, macht sie rot.
// 💣 Jede Zusicherung ueber eine Menge zaehlt zuerst, dass die Menge nicht leer ist: eine leere Maske
// haelt jede Behauptung.

const assert = require("assert");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const hydro = require(path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js"));

let gehalten = 0;
function pruefe(name, fn) {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
}

const BOUNDS = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
const IM_QUADRAT = (x, y) => x >= 1 && x <= 19 && y >= 1 && y <= 19;
const TAN = (grad) => Math.tan(grad * Math.PI / 180);
const FLUSS = { n: "Probefluss", dir: "forward", bach: false, p: [[2, 10], [10, 10], [18, 11]] };

// Die Buehne: `r`, `kern`, `senke` und `talIndex` kommen aus dem ECHTEN Trichter, damit die Funktion
// dieselben Masken sieht wie in der Produktion. Das Feld selbst setzt jede Zusicherung eigens.
function buehne(peaks, extra) {
	return hydro.avesmapsGebirgsRasterBauen(Object.assign({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks, kurve: null,
		fluesse: [], seen: [], istImSee: () => false,
		regler: { koernung: 4, stufen: 3, steigung: 0, rauschen: 0, sattel: 0.75, erosion: 0, maximalhoehe: 0 },
		saat: 4242,
	}, extra || {}));
}
const feld = (o, wert) => Float64Array.from(o.h, () => wert);
const zelle = (o, x, y) => (o.r.j(y) * o.r.w) + o.r.i(x);
const smoothstep = (u) => 1 - (u * u * (3 - (2 * u)));

pruefe("der Radius ist Hoehe durch tan(Steigung), in Karteneinheiten", () => {
	const nah = (a, b) => Math.abs(a - b) < 1e-9;
	// 🔴 Die Rechnung des Owners: ein 5.000er bei 45° reicht 5 Meilen, also 5/3 Karteneinheiten.
	assert.ok(nah(hydro.avesmapsGipfelRadius(5000, 45), 5 / 3), "45°: " + hydro.avesmapsGipfelRadius(5000, 45));
	assert.ok(nah(hydro.avesmapsGipfelRadius(5000, 30), 5000 / TAN(30) / hydro.SCHRITT_JE_EINHEIT), "30°");
	assert.strictEqual(hydro.ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG, 30);
	assert.ok(nah(hydro.avesmapsGipfelRadius(null, 30), hydro.avesmapsGipfelRadius(5000, 30)), "ohne Hoehe gilt die Standardhoehe");
	assert.ok(nah(hydro.avesmapsGipfelRadius(5000, undefined), hydro.avesmapsGipfelRadius(5000, 30)), "undefined = Vorgabe");
	assert.ok(nah(hydro.avesmapsGipfelRadius(5000, null), hydro.avesmapsGipfelRadius(5000, 30)), "null = Vorgabe");
	// 💣 Die ausdrueckliche 0 ist KEIN leerer Wert: sie schaltet den Kegel ab.
	assert.strictEqual(hydro.avesmapsGipfelRadius(5000, 0), 0);
});

pruefe("Steigung 0 laesst das Feld Bit fuer Bit stehen", () => {
	const peaks = [{ x: 10, y: 10, h: 5000 }];
	const o = buehne(peaks);
	const h = feld(o, 1234);
	const vorher = Float64Array.from(h);
	const antwort = hydro.blendeGipfelkegel(o.r, h, peaks, 0, o.kern, o.senke, null);
	assert.strictEqual(antwort.zellen, 0);
	assert.deepStrictEqual([...h], [...vorher]);
});

pruefe("Gipfelkern und Flussachse bleiben unberuehrt", () => {
	const peaks = [{ x: 10, y: 12, h: 5000 }];
	const o = buehne(peaks, { fluesse: [FLUSS] });
	const h = feld(o, 0);
	const vorher = Float64Array.from(h);
	hydro.blendeGipfelkegel(o.r, h, peaks, 30, o.kern, o.senke, null);
	const rad = hydro.avesmapsGipfelRadius(5000, 30);
	let kernZellen = 0;
	let senkeImKreis = 0;
	for (let k = 0; k < h.length; k++) {
		if (!o.r.drin[k]) { continue; }
		const j = Math.floor(k / o.r.w);
		const d = Math.hypot(o.r.x(k - (j * o.r.w)) - 10, o.r.y(j) - 12);
		if (o.kern[k]) {
			kernZellen++;
			assert.strictEqual(h[k], vorher[k], "Kernzelle " + k + " wurde veraendert");
		}
		if (o.senke[k]) {
			if (d < rad) { senkeImKreis++; }
			assert.strictEqual(h[k], vorher[k], "Senkenzelle " + k + " wurde veraendert");
		}
	}
	assert.ok(kernZellen > 0, "die Fixture hat keinen Gipfelkern");
	assert.ok(senkeImKreis > 0, "keine Flussachse im Gipfelkreis -- die Fixture zeigt die Ausnahme nicht");
});

pruefe("am Flaechenrand laeuft der Kegel mit derselben Steigung aus (Randkeil)", () => {
	// Ein Gipfel eine Einheit vom Rand: ohne Randkeil stuende die Randzelle bei rund 3.270 Schritt.
	const peaks = [{ x: 2, y: 10, h: 5000 }];
	const o = buehne(peaks);
	const h = feld(o, 0);
	hydro.blendeGipfelkegel(o.r, h, peaks, 30, o.kern, o.senke, null);
	const { r } = o;
	const rad = hydro.avesmapsGipfelRadius(5000, 30);
	const grenze = (r.cellS * TAN(30)) + 1e-6;
	let randZellen = 0;
	for (let j = 0; j < r.hh; j++) {
		for (let i = 0; i < r.w; i++) {
			const k = (j * r.w) + i;
			if (!r.drin[k] || o.kern[k]) { continue; }
			const amRand = i === 0 || j === 0 || i === r.w - 1 || j === r.hh - 1
				|| !r.drin[k - 1] || !r.drin[k + 1] || !r.drin[k - r.w] || !r.drin[k + r.w];
			if (!amRand || Math.hypot(r.x(i) - 2, r.y(j) - 10) >= rad) { continue; }
			randZellen++;
			assert.ok(h[k] <= grenze, "Randzelle (" + i + "," + j + ") steht auf " + h[k].toFixed(0)
				+ " Schritt, erlaubt sind " + grenze.toFixed(0));
		}
	}
	assert.ok(randZellen > 0, "kein Rand im Gipfelkreis -- die Fixture zeigt den Randkeil nicht");
});

pruefe("zwei Kegel addieren sich nicht -- es gilt der hoehere (max, keine Summe)", () => {
	const peaks = [{ x: 9, y: 10, h: 4000 }, { x: 11, y: 10, h: 4000 }];
	const o = buehne(peaks);
	const h = feld(o, 0);
	hydro.blendeGipfelkegel(o.r, h, peaks, 30, o.kern, o.senke, null);
	const k = zelle(o, 10, 10);
	const xc = o.r.x(o.r.i(10));
	const yc = o.r.y(o.r.j(10));
	const d = peaks.map((p) => Math.hypot(xc - p.x, yc - p.y));
	const rad = hydro.avesmapsGipfelRadius(4000, 30);
	const T = Math.max(...peaks.map((p, n) => p.h - (d[n] * hydro.SCHRITT_JE_EINHEIT * TAN(30))));
	const erwartet = smoothstep(Math.min(...d) / rad) * T;
	assert.ok(T > 0 && !o.kern[k], "die Mitte liegt nicht in beiden Kreisen oder im Kern -- Fixture falsch");
	assert.ok(Math.abs(h[k] - erwartet) < 1e-6, "Mitte " + h[k].toFixed(3) + ", erwartet " + erwartet.toFixed(3));
});

pruefe("ueber dem Kegel kraeftig herab (1 − u⁴), darunter sanft hinauf (Smoothstep)", () => {
	const peaks = [{ x: 10, y: 10, h: 5000 }];
	const o = buehne(peaks);
	const rad = hydro.avesmapsGipfelRadius(5000, 30);
	const x = 10 + (rad / 2);
	const k = zelle(o, x, 10);
	const d = Math.hypot(o.r.x(o.r.i(x)) - 10, o.r.y(o.r.j(10)) - 10);
	const u = d / rad;
	const T = 5000 - (d * hydro.SCHRITT_JE_EINHEIT * TAN(30));
	// 💣 Die zwei Gewichte muessen hier wirklich verschieden sein -- sonst prueften beide Zeilen dasselbe.
	assert.ok(Math.abs((1 - Math.pow(u, 4)) - smoothstep(u)) > 0.2, "u=" + u.toFixed(2) + " trennt die Gewichte nicht");

	const hoch = feld(o, 6000);
	hydro.blendeGipfelkegel(o.r, hoch, peaks, 30, o.kern, o.senke, null);
	const ab = 6000 + ((1 - Math.pow(u, 4)) * (T - 6000));
	assert.ok(Math.abs(hoch[k] - ab) < 1e-6, "herabgezogen auf " + hoch[k].toFixed(1) + ", erwartet " + ab.toFixed(1));

	const tief = feld(o, 0);
	hydro.blendeGipfelkegel(o.r, tief, peaks, 30, o.kern, o.senke, null);
	const auf = smoothstep(u) * T;
	assert.ok(Math.abs(tief[k] - auf) < 1e-6, "angehoben auf " + tief[k].toFixed(1) + ", erwartet " + auf.toFixed(1));
});

pruefe("eine Talflanke wird nie unter die Sohle ihres Tals gezogen (Entwurf §4.5)", () => {
	// Ein niedriger Gipfel direkt am Fluss, der Kamm auf dem Fluss: der Kegel will die Flanke tief ziehen,
	// die Sohle liegt hoch -- genau die Lage, in der der Damm entsteht.
	const peaks = [{ x: 10, y: 10.5, h: 1000 }];
	const o = buehne(peaks, {
		fluesse: [FLUSS], kurve: FLUSS.p,
		regler: { koernung: 4, stufen: 3, steigung: 0, rauschen: 0, sattel: 0.75, erosion: 0, maximalhoehe: 4000 },
	});
	assert.ok(o.talIndex, "die Fixture hat keinen Talindex -- ohne Tal gibt es keine Talflanke");
	const ohne = feld(o, 6000);
	const mit = feld(o, 6000);
	hydro.blendeGipfelkegel(o.r, ohne, peaks, 30, o.kern, o.senke, null);
	hydro.blendeGipfelkegel(o.r, mit, peaks, 30, o.kern, o.senke, o.talIndex);
	let gehaltenZellen = 0;
	for (let k = 0; k < mit.length; k++) {
		assert.ok(mit[k] >= ohne[k] - 1e-9, "der Riegel hat Zelle " + k + " GESENKT -- er darf nur halten");
		if (mit[k] > ohne[k] + 1e-9) {
			gehaltenZellen++;
			const j = Math.floor(k / o.r.w);
			const sohle = hydro.ecosystemTalSohle(o.talIndex, o.r.x(k - (j * o.r.w)), o.r.y(j));
			assert.ok(sohle && Math.abs(mit[k] - Math.min(6000, sohle.bed)) < 1e-6,
				"Zelle " + k + " steht auf " + mit[k].toFixed(1) + ", nicht auf ihrer Sohle");
		}
	}
	assert.ok(gehaltenZellen > 0, "keine Talflanke wurde gehalten -- entweder fehlt der Riegel oder die Fixture zeigt ihn nicht");
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
```

- [ ] **Schritt 2: Rot sehen.**

Run: `node js/map-features/__tests__/gipfelkegel-steigung.test.js`
Erwartet: jede `pruefe` FEHLER mit `hydro.avesmapsGipfelRadius is not a function` bzw. `blendeGipfelkegel is not a function`, Exit ≠ 0.

- [ ] **Schritt 3: Die Konstanten.** In `map-features-ecosystem-hydrologie.js` direkt unter
  `const ECOSYSTEM_HYDRO_BERGFORM = 2.5;` (die alte bleibt bis Aufgabe 3):

```js
// 🔴 Die Steigung eines Gipfels, wenn die Flaeche keine eigene traegt (Entwurf §5.1). Owner 14.09.2026:
// „steigung kannst du gerne von sinnvollen gebirgseinstellungen abhaengig machen" -- die Vorlagen tun das.
const ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG = 30;
// ⚠️ GEMESSEN, NICHT HERGELEITET: mit 4 sind die Bilder entstanden, die der Owner gewaehlt hat
// („Eingeblendet, korrigiert"). Wer ihn aendert, aendert das gewaehlte Bild.
const ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT = 4;
```

- [ ] **Schritt 4: Die zwei Funktionen.** Direkt über `// DIE EINZELBERGE -- ADDIERT, nicht festgenagelt`:

```js
// DER GIPFELKEGEL -- nach der Erosion eingeblendet (Entwurf 2026-09-14-gipfelkegel-steigung-design.md, §4).
//
// 🔴 Radius = Hoehe / tan(Steigung). Ein 5.000er reicht bei 30° 8,7 Meilen, bei 45° 5 Meilen.
// ⚠️ `null`/`undefined` heisst „Modulvorgabe", die ausdrueckliche 0 heisst „kein Kegel".
function avesmapsGipfelRadius(hoehe, steigung) {
	const grad = steigung === null || steigung === undefined ? ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG : Number(steigung);
	if (!(grad > 0)) {
		return 0;
	}
	const H = Number(hoehe) > 0 ? Number(hoehe) : ECOSYSTEM_HYDRO_STANDARDHOEHE;

	return H / Math.tan(Math.min(89, grad) * Math.PI / 180) / SCHRITT_JE_EINHEIT;
}

// Zielflaeche T = max ueber die Gipfel von min(Kegel, Randkeil). Gelaende unter T wird sanft angehoben
// (Smoothstep), Gelaende ueber T kraeftig herabgezogen (1 − u⁴) -- Owner-Wahl „Eingeblendet, korrigiert".
// 💣 Der Randkeil ist tragend: ohne ihn reicht ein Kegel ueber den Flaechenrand, und die Fusshoehe 0 an der
// Naht zweier Gebirge bricht (Entwurf §4.2). `dRand` kommt aus `randAbstand`, nie aus einer zweiten Rechnung.
// 💣 `max`, nie eine Summe: zwei Kegel addieren sich nicht -- deshalb braucht es keine Kappung mehr.
// 💣 Eine Talflanke wird nie unter die Sohle ihres Tals gezogen (§4.5) -- sonst steht die Flussachse als
// Damm ueber ihrem Ufer (gemessen Rote Sichel +477 Schritt ohne diesen Riegel).
// ⚠️ Kern (festgehaltener Gipfel) und Senke (Flussachse, See) bleiben unberuehrt.
function blendeGipfelkegel(r, h, gipfel, steigung, kern, senke, talIndex) {
	const grad = steigung === null || steigung === undefined ? ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG : Number(steigung);
	const liste = Array.isArray(gipfel) ? gipfel : [];
	if (!(grad > 0) || !liste.length) {
		return { zellen: 0, wirksam: [] };
	}
	const tanA = Math.tan(Math.min(89, grad) * Math.PI / 180);
	const rand = randAbstand(r);
	const zellenGesamt = r.w * r.hh;
	const ziel = new Float64Array(zellenGesamt).fill(-Infinity);
	const uMin = new Float64Array(zellenGesamt).fill(Infinity);
	const wirksam = [];
	for (const p of liste) {
		const H = Number(p.h) > 0 ? Number(p.h) : ECOSYSTEM_HYDRO_STANDARDHOEHE;
		const rad = avesmapsGipfelRadius(H, grad);
		wirksam.push({ name: p.n || "", rad });
		const ci = r.i(p.x);
		const cj = r.j(p.y);
		const reich = Math.ceil(rad / r.cell);
		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = ci + di;
				const jj = cj + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) { continue; }
				const k = (jj * r.w) + ii;
				if (!r.drin[k]) { continue; }
				const d = Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y);
				if (d >= rad) { continue; }
				const randSchritt = (rand[k] / 3) * r.cellS;
				const c = Math.min(H - (d * SCHRITT_JE_EINHEIT * tanA), randSchritt * tanA);
				if (c > ziel[k]) { ziel[k] = c; }
				const u = d / rad;
				if (u < uMin[k]) { uMin[k] = u; }
			}
		}
	}
	let zellen = 0;
	for (let k = 0; k < zellenGesamt; k++) {
		if (!r.drin[k] || kern[k] || senke[k] || ziel[k] === -Infinity) { continue; }
		const u = uMin[k];
		let neu;
		if (h[k] < ziel[k]) {
			neu = h[k] + ((1 - (u * u * (3 - (2 * u)))) * (ziel[k] - h[k]));
		} else {
			neu = h[k] + ((1 - Math.pow(u, ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT)) * (ziel[k] - h[k]));
			if (talIndex) {
				const j = Math.floor(k / r.w);
				const sohle = ecosystemTalSohle(talIndex, r.x(k - (j * r.w)), r.y(j));
				if (sohle) { neu = Math.max(neu, Math.min(h[k], sohle.bed)); }
			}
		}
		if (neu !== h[k]) { h[k] = neu; zellen++; }
	}

	return { zellen, wirksam };
}

```

- [ ] **Schritt 5: Exporte.** In `module.exports` hinter `stempleGipfel, addiereGipfelkegel,` die Namen
  `blendeGipfelkegel, avesmapsGipfelRadius,` ergänzen und hinter `ECOSYSTEM_HYDRO_BERGFORM,` die Namen
  `ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG, ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT,`.

- [ ] **Schritt 6: Grün sehen.**

Run: `node js/map-features/__tests__/gipfelkegel-steigung.test.js`
Erwartet: sieben `ok`, „7 Zusicherungen gehalten.", Exit 0.
⚠️ Ist nur der Talflanken-Test rot mit „keine Talflanke wurde gehalten": in seiner Fixture `maximalhoehe`
auf `6000` setzen (die Sohle steigt mit der Kammhöhe) und erneut fahren. Bleibt er rot, STOPP und melden —
dann zeigt die Fixture den Riegel nicht, und das ist eine Frage, keine Stellschraube.

- [ ] **Schritt 7: Mutationsproben** — je Mutation Datei ändern, Test fahren (muss rot), zurücksetzen, Bytes
  gegenprüfen (`git diff --stat` zeigt danach nur die gewollten Änderungen):
  1. Randkeil weg: `Math.min(H - (d * SCHRITT_JE_EINHEIT * tanA), randSchritt * tanA)` → `H - (d * SCHRITT_JE_EINHEIT * tanA)` — rot: Randkeil.
  2. Summe statt max: `if (c > ziel[k]) { ziel[k] = c; }` → `ziel[k] = (ziel[k] === -Infinity ? 0 : ziel[k]) + c;` — rot: max.
  3. Kern-Ausnahme weg: `|| kern[k] ` streichen — rot: Kern/Senke.
  4. Senke-Ausnahme weg: `|| senke[k] ` streichen — rot: Kern/Senke.
  5. `wAb` durch `wAuf`: `Math.pow(u, ECOSYSTEM_HYDRO_GIPFEL_ABZUG_EXPONENT)` → `(u * u * (3 - (2 * u)))` — rot: Gewichte.
  6. Talsohlen-Riegel weg: `if (sohle) { … }` streichen — rot: Talflanke.
  7. 0 als Vorgabe lesen: in beiden Funktionen `steigung === null || steigung === undefined` → `!steigung` — rot: Radius und Steigung 0.

  💣 Die Arbeitskopie trägt CRLF: Mutationen per Skript, das `\r\n` normalisiert und zurückschreibt, oder per
  Edit-Werkzeug — nie ein LF-Anker gegen die CRLF-Datei.

- [ ] **Schritt 8: Commit.**

```bash
cd "$WT" && git add js/map-features/map-features-ecosystem-hydrologie.js js/map-features/__tests__/gipfelkegel-steigung.test.js && git commit -F "$SCRATCH/commit-1.txt"
```

`$SCRATCH/commit-1.txt`:

```text
feat(landschaften): Gipfelkegel mit Steigung als reine Funktion -- noch nicht verdrahtet

avesmapsGipfelRadius (Hoehe durch tan(Steigung)) und blendeGipfelkegel (Zielflaeche mit Randkeil,
sanft hinauf, kraeftig herab, Talflanke nie unter ihre Sohle) nach Entwurf
docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md §4. Der Trichter ruft sie noch nicht;
die Ausstrahlung der Gipfel rechnet unveraendert.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
## Aufgabe 2: Talflanken messen — Damm nicht höher als heute (Haltepunkt)

Entwurf §4.5: die korrigierte Einblendung kann ohne Talsohlen-Riegel nicht live gehen. Hier wird gemessen,
ob der Riegel reicht — **bevor** irgendetwas verdrahtet wird.

**Dateien:** nur Scratchpad (`$SCRATCH/gipfel-damm.js`, zwei Live-Nutzlasten). Nichts im Repo.

**Schnittstellen:**
- Nutzt: `blendeGipfelkegel` aus Aufgabe 1 (im Worktree), `avesmapsGebirgsRasterBauen` (heute und neu),
  `pointInGeometry` aus `js/map-features/map-features-point-in-polygon.js`.
- Liefert: je Messgebirge die Zeile „heute / neu ohne Riegel / neu mit Riegel" für die Kennzahlen aus §4.7.

- [ ] **Schritt 1: Die Eingaben holen — je EINE Anfrage** (STRATO: nie in einer Schleife):

```bash
curl -s --compressed "https://avesmaps.de/api/app/ecosystem-areas.php?kind=topographie" -o "$SCRATCH/eco-topo.json"
```

```bash
curl -s --compressed "https://avesmaps.de/api/app/map-features.php" -o "$SCRATCH/map-features.json"
```

Erwartet: beide Dateien beginnen mit `{"ok":true`.

- [ ] **Schritt 2: Die heutige Fassung ablegen.**

```bash
cd "$WT" && git show origin/master:js/map-features/map-features-ecosystem-hydrologie.js > "$SCRATCH/hydro-heute.js"
```

- [ ] **Schritt 3: Das Messskript** — `$SCRATCH/gipfel-damm.js`:

```js
// Wegwerf-Messung (Bauplan Gipfelkegel, Aufgabe 2): Damm an Flussachsen im Gipfelkreis, heute gegen neu.
// Aufruf: node gipfel-damm.js <Worktree> <Scratchpad>
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Module = require("module");

const [,, WT, SCRATCH] = process.argv;
const NAMEN = ["Finsterkamm", "Rote Sichel", "Schwarze Sichel"];
const STEIGUNG = 30;

function ladeModul(quelle, datei) {
	const m = new Module(datei, module);
	m.filename = datei;
	m.paths = Module._nodeModulePaths(path.dirname(datei));
	m._compile(quelle, datei);
	return m.exports;
}
function ersetzeEinmal(text, alt, neu) {
	const n = text.split(alt).length - 1;
	if (n !== 1) { throw new Error("Naht nicht genau einmal (" + n + "): " + alt.slice(0, 70)); }
	return text.replace(alt, () => neu);
}

const pipKontext = {};
vm.createContext(pipKontext);
vm.runInContext(fs.readFileSync(path.join(WT, "js/map-features/map-features-point-in-polygon.js"), "utf8"), pipKontext);
const pointInGeometry = pipKontext.pointInGeometry;

const heute = ladeModul(fs.readFileSync(path.join(SCRATCH, "hydro-heute.js"), "utf8"), path.join(SCRATCH, "hydro-heute.js"));
// Die Verdrahtung aus Aufgabe 3, nur im Speicher: Ausstrahlung aus, Kegel nach dem Deckel. `e.__ohneRiegel`
// reicht `null` statt des Talindex durch -- so zeigt dieselbe Datei beide Fassungen.
let quelleNeu = fs.readFileSync(path.join(WT, "js/map-features/map-features-ecosystem-hydrologie.js"), "utf8").replace(/\r\n/g, "\n");
quelleNeu = ersetzeEinmal(quelleNeu,
	"\tconst kegel = addiereGipfelkegel(r, h, peaks, reg.bergform, ECOSYSTEM_HYDRO_STANDARDHOEHE, fest, mantel);",
	"\tlet kegel = { zellen: 0, wirksam: [] };");
quelleNeu = ersetzeEinmal(quelleNeu, "\tif (melde) { melde(1); }",
	"\tkegel = blendeGipfelkegel(r, zustand.h, peaks, reg.steigung, kern, senke, e.__ohneRiegel ? null : talIndex);\n\tif (melde) { melde(1); }");
const neu = ladeModul(quelleNeu, path.join(WT, "hydro-neu-gemessen.js"));

const eco = JSON.parse(fs.readFileSync(path.join(SCRATCH, "eco-topo.json"), "utf8")).areas;
const mf = JSON.parse(fs.readFileSync(path.join(SCRATCH, "map-features.json"), "utf8")).features;
const byId = new Map(mf.map((f) => [String(f.id || f.properties.public_id || ""), f]));

function eingabeFuer(area) {
	const G = area.geometry;
	const lab = byId.get(String(area.label_public_id || ""));
	const kurve = Array.isArray(area.terrain_ridge_line) && area.terrain_ridge_line.length > 1 ? area.terrain_ridge_line
		: (lab && Array.isArray(lab.properties.curve_label_line) && lab.properties.curve_label_line.length > 1 ? lab.properties.curve_label_line : null);
	const peaks = mf.filter((f) => ["berggipfel", "vulkan"].includes(f.properties.feature_subtype))
		.map((f) => {
			const hs = f.properties.height_schritt;
			return { n: f.properties.name, x: Number(f.geometry.coordinates[0]), y: Number(f.geometry.coordinates[1]),
				h: hs === null || hs === undefined || hs === "" ? null : Number(hs) };
		})
		.filter((p) => pointInGeometry([p.x, p.y], G));
	const fluesse = [];
	for (const f of mf) {
		const p = f.properties || {};
		if (p.feature_subtype !== "Flussweg" || !f.geometry) { continue; }
		const g = f.geometry;
		const linien = g.type === "LineString" ? [g.coordinates] : (g.type === "MultiLineString" ? g.coordinates : []);
		for (const l of linien) {
			if (Array.isArray(l) && l.length > 1 && l.some((c) => pointInGeometry([c[0], c[1]], G))) {
				fluesse.push({ n: String(p.name || p.public_id || ""), bach: p.is_bach === true, dir: (p.flow && p.flow.dir) || null, p: l });
			}
		}
	}
	const b = area.bounds;
	const seen = eco.filter((k) => k.kind === "topographie" && k.region_type === "see" && k.geometry && k.bounds
		&& !(k.bounds.max_x < b.min_x || b.max_x < k.bounds.min_x || k.bounds.max_y < b.min_y || b.max_y < k.bounds.min_y))
		.map((k) => ({ n: String(k.region_name || ""), g: k.geometry }));
	const text = String(area.public_id || "") + "#" + String(area.geometry_revision ?? 0);
	let saat = 0;
	for (let i = 0; i < text.length; i++) { saat = (Math.imul(saat, 31) + text.charCodeAt(i)) | 0; }
	const regler = {
		koernung: area.terrain_grain ?? undefined, stufen: area.terrain_levels ?? undefined, erosion: area.terrain_erosion ?? undefined,
		plateau: area.terrain_plateau ?? undefined, hypsometrie: area.terrain_hypsometrie ?? undefined,
		maximalhoehe: area.terrain_avg_height ?? undefined, bergform: area.terrain_bergform ?? undefined,
		rauschen: area.terrain_rauschen ?? undefined, sattel: area.terrain_sattel ?? undefined,
		talbreite: area.terrain_talbreite ?? undefined, einschnitt: area.terrain_einschnitt ?? undefined,
		steigung: STEIGUNG,
	};
	return { bounds: area.bounds, peaks, kurve, fluesse, seen, regler, saat,
		istDrin: (x, y) => pointInGeometry([x, y], G), istImSee: (i, x, y) => pointInGeometry([x, y], seen[i].g) };
}

function kennzahlen(o, peaks) {
	const { r, h } = o;
	const tanA = Math.tan(STEIGUNG * Math.PI / 180);
	const imKreis = new Uint8Array(r.w * r.hh);
	const hoeherAlsGipfel = new Uint8Array(r.w * r.hh);
	let gipfelAbweichung = 0;
	for (const p of peaks) {
		const H = Number(p.h) > 0 ? Number(p.h) : 5000;
		const rad = H / tanA / 3000;
		const kc = (r.j(p.y) * r.w) + r.i(p.x);
		gipfelAbweichung = Math.max(gipfelAbweichung, Math.abs(h[kc] - H));
		const reich = Math.ceil(rad / r.cell);
		for (let dj = -reich; dj <= reich; dj++) {
			for (let di = -reich; di <= reich; di++) {
				const ii = r.i(p.x) + di;
				const jj = r.j(p.y) + dj;
				if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) { continue; }
				const k = (jj * r.w) + ii;
				if (!r.drin[k] || Math.hypot(r.x(ii) - p.x, r.y(jj) - p.y) >= rad) { continue; }
				imKreis[k] = 1;
				if (!o.kern[k] && h[k] > H + 0.5) { hoeherAlsGipfel[k] = 1; }
			}
		}
	}
	// Damm: eine Senkenzelle im Gipfelkreis gegen das Mittel ihrer Nachbarn, die weder Senke noch Kern sind.
	let dammSumme = 0;
	let dammZellen = 0;
	let randHoch = 0;
	let hoeher = 0;
	let summe = 0;
	let drin = 0;
	for (let j = 0; j < r.hh; j++) {
		for (let i = 0; i < r.w; i++) {
			const k = (j * r.w) + i;
			if (!r.drin[k]) { continue; }
			drin++;
			summe += h[k];
			hoeher += hoeherAlsGipfel[k];
			const amRand = i === 0 || j === 0 || i === r.w - 1 || j === r.hh - 1
				|| !r.drin[k - 1] || !r.drin[k + 1] || !r.drin[k - r.w] || !r.drin[k + r.w];
			if (amRand && !(o.kammMaske && o.kammMaske[k]) && h[k] > 1000) { randHoch++; }
			if (!o.senke[k] || !imKreis[k]) { continue; }
			let ufer = 0;
			let n = 0;
			for (let dj = -1; dj <= 1; dj++) {
				for (let di = -1; di <= 1; di++) {
					const ii = i + di;
					const jj = j + dj;
					if ((di === 0 && dj === 0) || ii < 0 || jj < 0 || ii >= r.w || jj >= r.hh) { continue; }
					const kk = (jj * r.w) + ii;
					if (r.drin[kk] && !o.senke[kk] && !o.kern[kk]) { ufer += h[kk]; n++; }
				}
			}
			if (n) { dammSumme += h[k] - (ufer / n); dammZellen++; }
		}
	}
	return { damm: dammZellen ? dammSumme / dammZellen : 0, dammZellen, gipfelAbweichung, randHoch, hoeher, mittel: drin ? summe / drin : 0 };
}

for (const name of NAMEN) {
	const area = eco.find((a) => a.region_type === "gebirge" && a.region_name === name);
	if (!area) { throw new Error("Gebirge fehlt in der Nutzlast: " + name); }
	const e = eingabeFuer(area);
	const zeilen = {
		heute: kennzahlen(heute.avesmapsGebirgsRasterBauen(e), e.peaks),
		ohneRiegel: kennzahlen(neu.avesmapsGebirgsRasterBauen({ ...e, __ohneRiegel: true }), e.peaks),
		mitRiegel: kennzahlen(neu.avesmapsGebirgsRasterBauen(e), e.peaks),
	};
	console.log("\n" + name + " (" + e.peaks.length + " Gipfel, " + e.fluesse.length + " Flusslinien)");
	for (const [fassung, z] of Object.entries(zeilen)) {
		console.log("  " + fassung.padEnd(10), "Damm", z.damm.toFixed(0).padStart(5), "(" + z.dammZellen + " Zellen)",
			"| Gipfel-Abweichung", z.gipfelAbweichung.toFixed(0), "| Randzellen >1000", z.randHoch,
			"| hoeher als Gipfel", z.hoeher, "| Mittel", z.mittel.toFixed(0));
	}
	const ok = zeilen.mitRiegel.damm <= zeilen.heute.damm + 0.5;
	console.log("  => Damm mit Riegel " + (ok ? "NICHT ueber heute" : "UEBER HEUTE -- HALT"));
	if (!ok) { process.exitCode = 1; }
}
```

- [ ] **Schritt 4: Fahren.**

Run: `node "$SCRATCH/gipfel-damm.js" "$WT" "$SCRATCH"`
Erwartet je Gebirge vier Zeilen; die Zahlen „heute" liegen in der Größenordnung von Entwurf §4.5/§4.7
(nach #109 dürfen sie abweichen — dann gelten die neuen). „ohneRiegel" zeigt den Damm (Rote Sichel ungefähr
+477), „mitRiegel" darf nirgends über „heute" liegen; „Gipfel-Abweichung" ist 0.
⚠️ Die Schwarze Sichel hat laut Entwurf keine Flussachse im Gipfelkreis — dort ist `Damm 0 (0 Zellen)` kein
Fehler.

- [ ] **Schritt 5: 🛑 Haltepunkt.** Exit ≠ 0 (ein Gebirge „UEBER HEUTE"): **STOPP.** Die drei Zeilen gehen an
  den Owner, einfach erklärt, mit dem Bild der betroffenen Stelle; weiter erst nach seiner Entscheidung.
  Exit 0: Tabelle für den Owner festhalten (sie gehört in die Abnahme, Entwurf §9 Punkt 10) und weiter.

---
## Aufgabe 3: Der Umstieg — Modul, Dialog und Server in einem Zug

💣 **Eine Aufgabe, weil es ein Livegang ist.** Geht der Server ohne den Dialog live (oder umgekehrt), rechnet
die Karte für die vier Flächen mit eigener Ausstrahlung still mit einem anderen Wert — eine sichtbare
Änderung, die niemand bestellt hat. Deshalb: alle Schritte, dann EIN Testfeld, dann EIN Commit, gepusht erst
in Aufgabe 5.

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-hydrologie.js`, `js/map-features/map-features-ecosystem-height-render.js`,
  `js/map-features/map-features-ecosystem-properties.js`, `js/map-features/map-features-ecosystem-loader.js`, `index.html`,
  `api/_internal/app/ecosystem.php`, `api/_internal/app/terrain-store.php`, `api/app/ecosystem-areas.php`
- Tests ändern: `js/map-features/__tests__/{gipfelkegel-steigung,gebirgssimulation,gelaende-tal-schneidet-nicht-auf-null,gelaende-vorlagen,gelaende-regler-ausgrauen,gelaende-gruppen-und-rangfolge,gelaende-schranken-gleich,gelaende-vorgabemarken,gelaenderegler-kette,gelaende-preset-wirkt}.test.js`,
  `api/_internal/app/__tests__/terrain-store-test.php`

**Schnittstellen:**
- Nutzt: `blendeGipfelkegel`, `avesmapsGipfelRadius`, beide Konstanten (Aufgabe 1).
- Liefert: `regler.steigung` im Trichter; Vorlagenschlüssel `steigung`; Flächenfeld `terrain_gipfel_steigung`
  (Nutzlast, Loader, Dialog, Server); Markup-Kennung `ecosystem-properties-steigung` (Regler, `-mark`, `-num`,
  `-reset`); Rückgabe des Trichters `kegel = { zellen, wirksam: [{name, rad}] }`, `mantel` bleibt leer.

⚠️ Alle Dateien tragen CRLF. Mit dem Edit-Werkzeug arbeiten; ein Skript normalisiert `\r\n` und schreibt
das Zeilenende zurück (Muster: `scratchpad/proto-patch.js` der Entwurfssitzung).

### Teil A — das Modul

- [ ] **Schritt 1: Trichter-Zusicherungen schreiben** — in `gipfelkegel-steigung.test.js` vor
  `if (!process.exitCode) {` einfügen:

```js
/* ── Der Trichter -- nach dem Umstieg (Bauplan Aufgabe 3) ───────────────────────────────────── */

const GIPFEL = [{ x: 6, y: 6, h: 3000 }, { x: 14, y: 14, h: 5000 }];
const SEE = { min_x: 9, min_y: 3, max_x: 12, max_y: 5 };
function trichter(steigung, erosion) {
	return hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks: GIPFEL, kurve: [[6, 6], [10, 10], [14, 14]],
		fluesse: [FLUSS], seen: [{ n: "Probesee" }],
		istImSee: (i, x, y) => x >= SEE.min_x && x <= SEE.max_x && y >= SEE.min_y && y <= SEE.max_y,
		regler: { koernung: 4, stufen: 3, steigung, rauschen: 0.3, sattel: 0.75, erosion },
		saat: 4242,
	});
}

pruefe("die Ausstrahlung der Gipfel ist gefallen -- keine alte Funktion, kein Mantel", () => {
	assert.strictEqual(hydro.addiereGipfelkegel, undefined, "addiereGipfelkegel ist noch exportiert");
	assert.strictEqual(hydro.ECOSYSTEM_HYDRO_BERGFORM, undefined, "ECOSYSTEM_HYDRO_BERGFORM ist noch exportiert");
	const o = trichter(30, 3);
	assert.ok(o.mantel.every((v) => v === 0), "der Mantel ist nicht leer -- die Ausstrahlung rechnet noch");
});

pruefe("im Trichter: Gipfel zeigen ihre Hoehe, und jeder bekommt seinen Kegel", () => {
	const o = trichter(30, 3);
	for (const p of GIPFEL) {
		const k = zelle(o, p.x, p.y);
		assert.ok(Math.abs(o.h[k] - p.h) < 1e-6, "Gipfel (" + p.x + "," + p.y + ") steht auf " + o.h[k].toFixed(1));
	}
	assert.strictEqual(o.kegel.wirksam.length, GIPFEL.length);
	assert.ok(o.kegel.zellen > 0, "der Kegel hat keine Zelle veraendert -- ist er verdrahtet?");
});

pruefe("im Trichter: Steigung 0 heisst kein Kegel", () => {
	const o = trichter(0, 3);
	assert.strictEqual(o.kegel.zellen, 0);
	assert.deepStrictEqual(o.kegel.wirksam, []);
});

pruefe("im Trichter: die Nadel heilt -- zwei Zellen neben dem Gipfel naeher am Kegel als ohne", () => {
	const p = GIPFEL[1];
	const ring = (o) => {
		let s = 0;
		let n = 0;
		for (let dj = -2; dj <= 2; dj++) {
			for (let di = -2; di <= 2; di++) {
				if (Math.max(Math.abs(di), Math.abs(dj)) !== 2) { continue; }
				const k = ((o.r.j(p.y) + dj) * o.r.w) + o.r.i(p.x) + di;
				if (o.r.drin[k] && !o.senke[k]) { s += o.h[k]; n++; }
			}
		}
		return s / n;
	};
	const ohne = trichter(0, 5);
	const mit = trichter(30, 5);
	const ideal = p.h - (2 * ohne.r.cell * hydro.SCHRITT_JE_EINHEIT * TAN(30));
	assert.ok(Math.abs(ring(mit) - ideal) < Math.abs(ring(ohne) - ideal),
		"Ring 2: mit Kegel " + ring(mit).toFixed(0) + ", ohne " + ring(ohne).toFixed(0) + ", Kegel " + ideal.toFixed(0));
});
```

- [ ] **Schritt 2: Rot sehen.** `node js/map-features/__tests__/gipfelkegel-steigung.test.js` — die vier neuen
  `pruefe` FEHLER (alte Funktion noch exportiert, `kegel.wirksam` in der alten Form, Kegel wirkt nicht bei 0).

- [ ] **Schritt 3: Die alte Konstante fällt.** In `map-features-ecosystem-hydrologie.js` die Zeile
  `const ECOSYSTEM_HYDRO_BERGFORM = 2.5;` samt ihrem Kommentar darüber löschen.

- [ ] **Schritt 4: Die Vorlagen.** In `ECOSYSTEM_HYDRO_MORPHOLOGIEN` je Zeile `bergform: <alt>` → `steigung: <neu>`
  (die übrigen neun Zahlen bleiben):

| Vorlage | alt | neu |
|---|---|---|
| kammgebirge | `bergform: 2,` | `steigung: 25,` |
| gratgebirge | `bergform: 2,` | `steigung: 30,` |
| kettengebirge | `bergform: 2.5,` | `steigung: 40,` (🔧 Owner-Wahl „Empfehlung") oder `steigung: 35,` |
| kuppengebirge | `bergform: 3.5,` | `steigung: 20,` |
| massengebirge | `bergform: 4,` | `steigung: 20,` |
| plateaugebirge | `bergform: 0.5,` | `steigung: 15,` |
| rumpfgebirge | `bergform: 2,` | `steigung: 12,` |
| schild | `bergform: 0.3,` | `steigung: 6,` |
| inselberg | `bergform: 8,` | `steigung: 45,` |
| karst | `bergform: 10.5,` | `steigung: 30,` |

  Über `steigung` in der ersten Vorlage (Kammgebirge) einen Kommentar setzen:

```js
		// 🔴 `steigung` (Grad) ersetzt am 14.09.2026 `bergform` (Radius der Ausstrahlung): Vorschlag nach
		// typischen Hangneigungen der Vorbilder, KEINE Owner-Messung wie die neun Zahlen daneben
		// (Entwurf gipfelkegel-steigung §5.2). Wer sie aendert, aendert einen Vorschlag.
```

  Den Inselberg-Kommentar `// 🪟 \`bergform\` 8 und \`sattel\` 0,3: bei tiefem HI drueckt die Potenz das Umland flach, und ein`
  bis `// Punkten darauf.` ersetzen durch:

```js
		// 🪟 `steigung` 45 und `sattel` 0,3: der Restberg MUSS steil herausragen und ISOLIERT stehen, sonst
		// ist es ein Kuppengebirge -- mit der alten Ausstrahlung war das erste Bild eine ebene Flaeche mit
		// zwei Punkten darauf.
```

- [ ] **Schritt 5: „Regler ohne Wirkung".** In `avesmapsGebirgsReglerOhneWirkung`:

  `raus.terrain_bergform = "Diese Fläche hat keinen Gipfel — es gibt keinen Einzelberg, der ausstrahlen könnte.";`
  → `raus.terrain_gipfel_steigung = "Diese Fläche hat keinen Gipfel — es gibt keinen Hang, dessen Steigung wirken könnte.";`

  Im Kommentar darüber `//   • \`addiereGipfelkegel\` kehrt ohne Gipfel sofort zurueck (\`bergform\`), und \`kammHoeheAn\` liefert`
  → `//   • \`blendeGipfelkegel\` kehrt ohne Gipfel sofort zurueck (\`steigung\`), und \`kammHoeheAn\` liefert`.

- [ ] **Schritt 6: Die Ausstrahlung fällt.** Den Block von der Zeile
  `// DIE EINZELBERGE -- ADDIERT, nicht festgenagelt (Owner 04.09.2026: „berge haben um sich herum`
  bis einschließlich `\treturn { zellen: gesetzt, wirksam };` und der folgenden `}` löschen (die Funktion
  `addiereGipfelkegel` samt Kopfkommentar). Die zwei neuen Funktionen aus Aufgabe 1 stehen direkt darüber
  und bleiben.

- [ ] **Schritt 7: Verdrahten.** Im Trichter `avesmapsGebirgsRasterBauen`:

  Alt:
```js
	// Die Einzelberge -- ADDITIV (siehe addiereGipfelkegel: festgenagelt zoegen sie einen Graben).
	const kegel = addiereGipfelkegel(r, h, peaks, reg.bergform, ECOSYSTEM_HYDRO_STANDARDHOEHE, fest, mantel);
```
  Neu:
```js
	// 🔴 Die Ausstrahlung der Gipfel ist am 14.09.2026 gefallen: sie wirkte VOR dem Rauschen, und die
	// Erosion hat ihren Kegel wieder eingeebnet. Der Gipfelkegel kommt jetzt NACH dem Deckel am Ausgang
	// (blendeGipfelkegel, Entwurf gipfelkegel-steigung §4.6). `mantel` bleibt dadurch leer.
	let kegel = { zellen: 0, wirksam: [] };
```
  Und direkt vor `\tif (melde) { melde(1); }` (nach dem Deckel-Block `if (hoechsterFest > 0) { … }`):
```js
	// 🔴 DER GIPFELKEGEL, eingeblendet NACH dem Deckel -- so ist er gemessen (Entwurf §4.6). Der Deckel
	// bleibt trotzdem wirksam: T liegt nie ueber dem Gipfel, und eine Einblendung zwischen zwei Werten
	// unter der Grenze bleibt darunter. ⚠️ VOR dem Deckel waere es NICHT dasselbe.
	kegel = blendeGipfelkegel(r, zustand.h, peaks, reg.steigung, kern, senke, talIndex);
```
  In der Kopf-Doku des Trichters: `//   Gipfelkerne -> loesen -> Kamm -> loesen -> Bergform ADDIEREN -> Rauschen` →
  `//   Gipfelkerne -> loesen -> Kamm -> loesen -> Rauschen`; die Zeile `//   -> TAELER ABZIEHEN (Fluesse + Seen) -> Erosion`
  → `//   -> TAELER ABZIEHEN (Fluesse + Seen) -> Erosion -> Deckel -> GIPFELKEGEL EINBLENDEN`; in
  `// 💣 Kamm NACH dem ersten Loesen (sonst Rinne statt Grat) · Bergform ADDITIV (sonst Graben um jeden` das Stück
  `· Bergform ADDITIV (sonst Graben um jeden` durch `· Gipfelkegel NACH der Erosion (sonst ebnet sie ihn ein`
  ersetzen und in der Folgezeile `// Gipfel) ·` durch `// wieder) ·`; `regler: { koernung, stufen, bergform, rauschen,`
  → `regler: { koernung, stufen, steigung, rauschen,`; im Kommentar `// 🔴 DAS INITIALE HOEHENFELD STEHT -- Gipfel, Kamm, Bergform UND Rauschen.`
  → `// 🔴 DAS INITIALE HOEHENFELD STEHT -- Gipfel, Kamm UND Rauschen.`

- [ ] **Schritt 8: Exporte.** `stempleGipfel, addiereGipfelkegel, blendeGipfelkegel, avesmapsGipfelRadius,` →
  `stempleGipfel, blendeGipfelkegel, avesmapsGipfelRadius,`; `ECOSYSTEM_HYDRO_BERGFORM, ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG,`
  → `ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG,`.

- [ ] **Schritt 9: Der Vorlagentest** (`gelaende-vorlagen.test.js`) — nach der Owner-Wahl aus Aufgabe 0.

  In beiden Fällen: Kopfzeile der Tabelle `//                koernung bergform rauschen …` →
  `//                koernung steigung rauschen …`; zweite Spalte je Zeile mit den Werten aus Schritt 4
  (`kammgebirge: [14, 25, 0.25, …]`, … `karst: [18, 30, 0.94, …]`); `const spalten = ["koernung", "bergform", …`
  → `["koernung", "steigung", …`; in `reglerId` `bergform: "bergform",` → `steigung: "steigung",`.

  **Fall „Empfehlung" (Kette 40°, fünfte Kennzahl):** in „jede Morphologie ergibt ein eigenes Gelände" vor
  `return {` einfügen:

```js
		// 🔴 DIE FUENFTE KENNZAHL: der HANG um die Gipfel (Owner-Entscheid, Bauplan gipfelkegel-steigung
		// Aufgabe 0). Seit die Steigung die Ausstrahlung ersetzt, unterscheiden sich Grat- und Kettengebirge
		// vor allem darin, wie steil ihre Gipfel abfallen -- das sieht keine der vier Flaechenkennzahlen.
		// Gemessen: mittlere Hoehe im Ring 1..2 Einheiten um jeden Gipfel, als Anteil seiner Hoehe
		// (14.09.2026: Grat 30° 0,522 · Kette 35° 0,540 · Kette 40° 0,561).
		let hang = 0;
		let hangN = 0;
		for (const g of gipfel) {
			let s = 0;
			let c = 0;
			const reich = Math.ceil(2 / o.r.cell);
			for (let dj = -reich; dj <= reich; dj++) {
				for (let di = -reich; di <= reich; di++) {
					const ii = o.r.i(g.x) + di;
					const jj = o.r.j(g.y) + dj;
					if (ii < 0 || jj < 0 || ii >= o.r.w || jj >= o.r.hh) { continue; }
					const k = (jj * o.r.w) + ii;
					const d = Math.hypot(o.r.x(ii) - g.x, o.r.y(jj) - g.y);
					if (!o.r.drin[k] || d < 1 || d > 2) { continue; }
					s += o.h[k];
					c++;
				}
			}
			if (c) { hang += (s / c) / g.h; hangN++; }
		}
```
  In `return { … }` `hang: hangN ? hang / hangN : 0,` ergänzen; in der Paarschleife
  `|| Math.abs(x.koernigkeit - y.koernigkeit) > 0.02;` → `|| Math.abs(x.koernigkeit - y.koernigkeit) > 0.02`
  plus neue Zeile `|| Math.abs(x.hang - y.hang) > 0.02;`; an die Fehlermeldung
  `+ ", Hang " + x.hang.toFixed(3) + "/" + y.hang.toFixed(3)` anhängen. Im Kommentar `// 🚩 DREI PAARE HAENGEN …`
  eine Zeile ergänzen: `// ⚠️ Seit 14.09.2026 trennt Grat/Kette die fuenfte Kennzahl (Hang 0,522 gegen 0,561), nicht mehr das HI.`

  **Fall „Ausnahme" (Kette 35°):** in `return { … }` `key: v.key,` ergänzen und in der Paarschleife als erste
  Zeile nach `const y = werte[b];`:

```js
			// ⚠️ BENANNTE AUSNAHME (Owner-Entscheid, Bauplan gipfelkegel-steigung Aufgabe 0): mit Steigung statt
			// Ausstrahlung liegen Grat- und Kettengebirge auf allen vier Kennzahlen zusammen (Hang 0,522 gegen
			// 0,540). Die Abhilfe waere eine zweite Kammlinie -- ein eigenes Stueck Arbeit.
			if ([x.key, y.key].sort().join("/") === "gratgebirge/kettengebirge") { continue; }
```

- [ ] **Schritt 10: Die Simulations-Fixtures.** In `gebirgssimulation.test.js` und
  `gelaende-tal-schneidet-nicht-auf-null.test.js` jedes `bergform: <Zahl>` durch `steigung: 30` ersetzen
  (gebirgssimulation: 23 Stellen, tal-schneidet: 2 — Stand 14.09.2026, vorher `grep -c "bergform:"` zählen). ⚠️ Das ist **bitgleich** zum Probelauf der Entwurfssitzung:
  dort war `bergform` schon wirkungslos, `reg.steigung` also `undefined` = 30°.

- [ ] **Schritt 11: Die Modul-Tests fahren.**

```bash
cd "$WT" && for t in gipfelkegel-steigung gebirgssimulation gelaende-tal-schneidet-nicht-auf-null gelaende-vorlagen; do node "js/map-features/__tests__/$t.test.js" >/dev/null 2>&1 && echo "gruen $t" || echo "ROT $t"; done
```

Erwartet: die drei ersten grün. `gelaende-vorlagen` darf noch rot sein, aber NUR mit zwei Meldungen: „der Regler
`steigung` steht nicht mehr im Markup" (kommt in Schritt 12) und der fehlende Vorlagenschlüssel `steigung` im
Fenster (kommt in Schritt 13). Jede andere Meldung wird jetzt behoben.

### Teil B — Dialog, Loader, Zeichner

- [ ] **Schritt 12: Die Reglerzeile** in `index.html` (Gruppe „Kamm und Form", vierte Zeile):
  - `title="Wie weit ein Einzelberg ausstrahlt, bevor das Grundrelief &uuml;bernimmt. 0 = der Gipfel ist ein Punkt im Kamm.">`
    → `title="Wie steil ein Gipfel abf&auml;llt. Daraus folgt, wie weit er ins Gel&auml;nde reicht: H&ouml;he &divide; tan(Steigung) &mdash; ein 5.000er reicht bei 30&deg; 8,7 Meilen. 0 = die Gipfel formen das Gel&auml;nde nicht.">`
  - `<span>Ausstrahlung der Gipfel</span>` → `<span>Steigung der Gipfel</span>`
  - in den zwei Folgezeilen jedes `ecosystem-properties-bergform` → `ecosystem-properties-steigung` (4×: Regler,
    `-mark`, `-num`, `-reset`) und `min="0" max="12" step="0.1"` → `min="0" max="60" step="1"` (2×)
  - Kommentar `wie weit ein Einzelberg ausstrahlt und wie die Hoehen sich verteilen.` →
    `wie steil die Gipfel abfallen und wie die Hoehen sich verteilen.`
  - Kommentar `(Kamm → Bergform → Rauschen` → `(Kamm → Rauschen`; direkt vor dessen schließendem ` -->` ergänzen:
    `⚠️ Ausnahme: „Steigung der Gipfel" steht, wo die Ausstrahlung stand (Mockup 14.09.2026) -- gerechnet wird der Kegel als LETZTER Schritt, nach der Erosion.`

- [ ] **Schritt 13: Das Eigenschaftenfenster** (`map-features-ecosystem-properties.js`):
  - `{ key: "terrain_bergform", element: "bergform", decimals: 1 },` → `{ key: "terrain_gipfel_steigung", element: "steigung", decimals: 0 },`
  - den sechszeiligen Kommentar darüber, der mit `// 🪤 HIER STAND DAS GEGENTEIL, und es war seit dem 04.09.2026 falsch:` beginnt
    und mit `// andersherum. Gefunden von einem Pruefagenten am 05.09.2026, gemessen am Rumpf der Funktion.` endet, ersetzen durch:

```js
		// ⚠️ `terrain_gipfel_steigung` (seit 14.09.2026, loest `terrain_bergform` ab): `undefined` nimmt die
		// Modulvorgabe 30° wie jeder andere Regler, die ausdrueckliche **0** schaltet den Gipfelkegel ab
		// (`avesmapsGipfelRadius`). Ein leerer Wert ist harmlos, die 0 ist eine Entscheidung.
```
  - `terrain_bergform: typeof ECOSYSTEM_HYDRO_BERGFORM === "number" ? ECOSYSTEM_HYDRO_BERGFORM : 2.5,` →
    `terrain_gipfel_steigung: typeof ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG === "number" ? ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG : 30,`
  - in `VORLAGEN_FELDER` `bergform: "terrain_bergform",` → `steigung: "terrain_gipfel_steigung",`

- [ ] **Schritt 14: Der Loader** (`map-features-ecosystem-loader.js`): `"terrain_bergform", "terrain_rauschen", "terrain_sattel",`
  → `"terrain_gipfel_steigung", "terrain_rauschen", "terrain_sattel",`; im Kommentar `Karst, eine Bergform 0)` →
  `Karst, eine Steigung 0)`.

- [ ] **Schritt 15: Der Zeichner** (`map-features-ecosystem-height-render.js`, `reglerFuer`):
  `bergform: area?.terrain_bergform ?? undefined,` → `steigung: area?.terrain_gipfel_steigung ?? undefined,`.
  (`hydroFlaechenSchluessel` liest `reglerFuer` und zieht damit von selbst nach.)

### Teil C — Server

- [ ] **Schritt 16: `api/_internal/app/ecosystem.php`.**
  - Spalte: unter `'terrain_bergform' => 'DECIMAL(6,2)',` die Zeile `'terrain_gipfel_steigung' => 'DECIMAL(6,2)',`.
  - Die vier Kommentarzeilen ab `// terrain_bergform   -- Kegelradius je Gipfel in KARTENeinheiten.` bis
    `//                       Punkt im Kamm. Das ist eine Entscheidung, kein Versehen.` ersetzen durch:

```php
        // terrain_bergform   -- 🔴 STILLGELEGT seit 14.09.2026: Radius der alten „Ausstrahlung der Gipfel"
        //                       in KARTENeinheiten. Kein Leser mehr; die Spalte bleibt (der Deploy loescht
        //                       nie). 💣 NIE als Grad umdeuten -- 1,3 hiesse sonst 220 Meilen Kegelradius.
        // terrain_gipfel_steigung -- Steigung der Gipfel in GRAD (0..60); Radius = Hoehe / tan(Steigung).
        //                       ⚠️ 0 heisst „kein Kegel", NULL heisst Modulvorgabe 30°.
```
  - Liste: `                a.terrain_bergform,` → `                a.terrain_gipfel_steigung,`
  - Listenzeile: `'terrain_bergform' => $row['terrain_bergform'] === null ? null : (float) $row['terrain_bergform'],`
    → `'terrain_gipfel_steigung' => $row['terrain_gipfel_steigung'] === null ? null : (float) $row['terrain_gipfel_steigung'],`
  - Schranke: `'terrain_bergform' => [0.0, 12.0],` → `'terrain_gipfel_steigung' => [0.0, 60.0],`
  - Einzel-SELECT: `terrain_bergform, terrain_rauschen, terrain_talbreite, terrain_einschnitt,` → `terrain_gipfel_steigung, terrain_rauschen, terrain_talbreite, terrain_einschnitt,`
  - Einzelzeile: `'terrain_bergform' => ($row['terrain_bergform'] ?? null) === null ? null : (float) $row['terrain_bergform'],`
    → `'terrain_gipfel_steigung' => ($row['terrain_gipfel_steigung'] ?? null) === null ? null : (float) $row['terrain_gipfel_steigung'],`
  - Gegenprobe, dass keine Spaltenliste vergessen ist — jede Zeile, die `terrain_sattel` nennt, muss auch
    `terrain_gipfel_steigung` nennen (Ausnahme: Kommentar und DDL-Tabelle):

```bash
cd "$WT" && git grep -n "terrain_sattel" -- api | grep -v "__tests__" | grep -v "terrain_gipfel_steigung"
```

- [ ] **Schritt 17: `api/_internal/app/terrain-store.php`.**
  - `'bergform=' . $number($areaRow['terrain_bergform'] ?? null),` → `'steigung=' . $number($areaRow['terrain_gipfel_steigung'] ?? null),`
  - `terrain_bergform, terrain_rauschen, terrain_talbreite, terrain_einschnitt, terrain_sattel` → `terrain_gipfel_steigung, terrain_rauschen, terrain_talbreite, terrain_einschnitt, terrain_sattel`
  - `a.terrain_bergform, a.terrain_rauschen, a.terrain_talbreite,` → `a.terrain_gipfel_steigung, a.terrain_rauschen, a.terrain_talbreite,`

- [ ] **Schritt 18: Nutzlastversion** (`api/app/ecosystem-areas.php`): `const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 13;` →
  `const AVESMAPS_ECOSYSTEM_PAYLOAD_VERSION = 14;` und direkt darüber:

```php
// 14 (2026-09-14): `terrain_gipfel_steigung` je Zeile loest `terrain_bergform` ab (Gipfelkegel mit Steigung).
// Ohne den Bump bekaeme ein warmer Client sein 304 und rechnete ohne den neuen Schluessel -- still mit der
// Vorgabe 30°, auch dort, wo ein Editor eine Steigung gestellt hat.
```

### Teil D — die Tests nachziehen

- [ ] **Schritt 19: `api/_internal/app/__tests__/terrain-store-test.php`.**
  - in der `foreach`-Liste `'terrain_bergform' => 3.5,` → `'terrain_gipfel_steigung' => 40.0,`
  - `['terrain_bergform' => 0.0] + $area` und `['terrain_bergform' => null] + $area` → je `terrain_gipfel_steigung`
  - direkt danach ergänzen:

```php
// 🔴 Die stillgelegte Spalte darf den Abdruck NICHT mehr bewegen: sonst gaelte ein Raster als veraltet,
// weil sich ein Wert aendert, den keine Rechnung mehr liest.
assert(avesmapsTerrainAreaFingerprint(['terrain_bergform' => 3.5] + $area) === $base,
    'the retired terrain_bergform must not change the fingerprint');
```

- [ ] **Schritt 20: Die Oberflächen-Tests.**
  - `gelaende-regler-ausgrauen.test.js`: `pruefe("ohne Gipfel sind Ausstrahlung und Durchhang stumm"` → `"ohne Gipfel sind Steigung und Durchhang stumm"`;
    `["terrain_bergform", "terrain_sattel"]` → `["terrain_gipfel_steigung", "terrain_sattel"]`; im Regex
    `|bergform|` → `|steigung|`; `pruefe("NAHT: ohne Gipfel stehen Ausstrahlung und Durchhang grau"` → `"… Steigung und Durchhang grau"`;
    `assert.ok(istGrau("bergform"), "„Ausstrahlung der Gipfel\" ist nicht ausgegraut");` →
    `assert.ok(istGrau("steigung"), "„Steigung der Gipfel\" ist nicht ausgegraut");`;
    `zeilen.get("ecosystem-properties-bergform")` → `zeilen.get("ecosystem-properties-steigung")`.
  - `gelaende-gruppen-und-rangfolge.test.js`: in `GRUPPEN` `"bergform"` → `"steigung"`; in `NAMEN`
    `bergform: "Ausstrahlung der Gipfel",` → `steigung: "Steigung der Gipfel",`.
  - `gelaende-schranken-gleich.test.js`: `terrain_bergform: "bergform",` → `terrain_gipfel_steigung: "steigung",`.
  - `gelaende-vorgabemarken.test.js`: in `ELEMENTE` `"bergform"` → `"steigung"`.
  - `gelaenderegler-kette.test.js`: `{ key: "terrain_bergform", element: "bergform" },` → `{ key: "terrain_gipfel_steigung", element: "steigung" },`;
    `terrain_bergform: "bergform",` → `terrain_gipfel_steigung: "steigung",`; `"ECOSYSTEM_HYDRO_BERGFORM"` →
    `"ECOSYSTEM_HYDRO_GIPFEL_STEIGUNG"`; in der Id-Liste `"bergform"` → `"steigung"`.
  - `gelaende-preset-wirkt.test.js`: `assert.strictEqual(flaeche.terrain_bergform, karst.bergform, "Bergform fehlt in der Fläche");`
    → `assert.strictEqual(flaeche.terrain_gipfel_steigung, karst.steigung, "Steigung fehlt in der Fläche");`

- [ ] **Schritt 21: Restsuche** — kein Leser des alten Werts darf überleben:

```bash
cd "$WT" && git grep -n -E "terrain_bergform|reg\.bergform|ECOSYSTEM_HYDRO_BERGFORM|addiereGipfelkegel|properties-bergform|Ausstrahlung der Gipfel" -- js api index.html css
```

Erwartet NUR: `ecosystem.php` (DDL-Zeile + Stilllegungskommentar), `ecosystem-areas.php` (Versionsgeschichte V12
und 14), `map-features-ecosystem-properties.js` (Kommentar „loest `terrain_bergform` ab"),
`map-features-ecosystem-hydrologie.js` (Kommentar „Ausstrahlung der Gipfel ist … gefallen"),
`gipfelkegel-steigung.test.js` (Zusicherungen auf Abwesenheit), `terrain-store-test.php` (Stilllegungs-Zusicherung).
Jede andere Fundstelle wird nachgezogen.

- [ ] **Schritt 22: Das ganze Testfeld** (Befehle unter „Globale Vorgaben"), beide Zählzeilen gegen den Workflow.
  Erwartet: `rot-js.txt` und `rot-php.txt` gleich der Nulllinie aus Aufgabe 0. Jede neue rote Datei wird seriell
  nachgefahren und behoben — auch wenn sie „jemand anderem gehört".

- [ ] **Schritt 23: Mutationsproben der Verdrahtung** (je fahren, rot sehen, zurücksetzen, Bytes gegenprüfen):
  1. Aufruf `kegel = blendeGipfelkegel(…)` löschen → `gipfelkegel-steigung` rot („ist er verdrahtet?").
  2. Aufruf VOR den Deckel-Block schieben → ⚠️ die Tests dürfen grün bleiben: die Position hält der Kommentar
     am Aufruf, kein Test. Das wird so festgehalten (Abnahmeliste, Aufgabe 8) und nicht wegerklärt.
  3. `'steigung=' . …` aus dem Fingerabdruck streichen → `terrain-store-test.php` rot.
  4. Schranke auf `[0.0, 12.0]` zurück → `gelaende-schranken-gleich` rot.
  5. `steigung: area?.terrain_gipfel_steigung` in `reglerFuer` → `steigung: undefined` → `gelaenderegler-kette` rot.

- [ ] **Schritt 24: Prüfagent `usability-konsistenz`** (Entwurf gegen Diff):

  > Prüfe den Diff `git -C <WT> diff origin/master` gegen `docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md`
  > (§4, §5.1–5.3, §5.5) und den Bauplan `docs/superpowers/plans/2026-09-14-gipfelkegel-steigung.md` Aufgabe 3.
  > Frage: Stehen alle gekoppelten Werte gemeinsam da (Schieber 0–60 ↔ Server [0.0, 60.0] ↔ Vorlagenwerte in den
  > Schranken; Spaltenname in DDL, Listen, Einzelzeile, Fingerabdruck, Loader, Dialog, `reglerFuer`; Vorgabe 30 in
  > Modul und Fenster)? Liest irgendein Pfad noch `terrain_bergform`? Kein `git checkout`, `stash` oder `restore`.

  Jeder Befund wird behoben oder mit Begründung verworfen.

- [ ] **Schritt 25: Commit** (noch **kein** Push):

```bash
cd "$WT" && git add js/map-features/map-features-ecosystem-hydrologie.js js/map-features/map-features-ecosystem-height-render.js js/map-features/map-features-ecosystem-properties.js js/map-features/map-features-ecosystem-loader.js index.html api/_internal/app/ecosystem.php api/_internal/app/terrain-store.php api/app/ecosystem-areas.php js/map-features/__tests__/gipfelkegel-steigung.test.js js/map-features/__tests__/gebirgssimulation.test.js js/map-features/__tests__/gelaende-tal-schneidet-nicht-auf-null.test.js js/map-features/__tests__/gelaende-vorlagen.test.js js/map-features/__tests__/gelaende-regler-ausgrauen.test.js js/map-features/__tests__/gelaende-gruppen-und-rangfolge.test.js js/map-features/__tests__/gelaende-schranken-gleich.test.js js/map-features/__tests__/gelaende-vorgabemarken.test.js js/map-features/__tests__/gelaenderegler-kette.test.js js/map-features/__tests__/gelaende-preset-wirkt.test.js api/_internal/app/__tests__/terrain-store-test.php && git commit -F "$SCRATCH/commit-3.txt"
```

`$SCRATCH/commit-3.txt`:

```text
feat(landschaften): „Steigung der Gipfel" ersetzt „Ausstrahlung der Gipfel" -- der Gipfelkegel kommt nach der Erosion

Editor-sichtbar: im Flaechendialog (Topographie, Gruppe „Kamm und Form") heisst der Regler jetzt
„Steigung der Gipfel", 0–60°, Vorgabe 30°. Um jeden Gipfel wird das Gelaende nach der Erosion auf einen
Kegel mit Radius Hoehe / tan(Steigung) eingeblendet: sanft angehoben, kraeftig herabgezogen, am
Flaechenrand mit derselben Steigung auf den Fuss, eine Talflanke nie unter ihre Sohle. Jede
Gebirgsform bringt eine Steigung als Vorlage mit.

Neue Spalte ecosystem_area.terrain_gipfel_steigung (Schranke [0, 60], im Rasterstempel);
terrain_bergform bleibt stehen und hat keinen Leser mehr. Nutzlastversion 14.
Entwurf docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
## Aufgabe 4: Reisezeiten messen — vor dem Livegang, offline

Entwurf §6.1. Der Wege-Router liest `path_terrain`, der Querfeldein-A* das Raster. Beide ändern sich erst,
wenn der Owner nach dem Livegang „Höhenraster starten" und den Profillauf fährt — gemessen wird **vorher**,
was sich dann ändert.

**Dateien:** nur Scratchpad (`raster-erzeugen.js`, `reisezeit-vergleich.php`, Ausgaben). Nichts im Repo.

**Schnittstellen:**
- Nutzt: `AvesmapsEcosystemHeightRender.hochladen(area, { bestand })` — **derselbe Speicherweg wie die Karte**,
  mit abgefangenem `postEcosystemEdit`; PHP `avesmapsHeightmapDecode`, `avesmapsTerrainProfileForLine`,
  `avesmapsTerrainLeistungsFactor`.
- Liefert: `raster-heute.json`, `raster-neu.json` (je Gebirge `{area, name, width, height, cell_size, origin_x, origin_y, samples, geometry}`)
  und die Tabelle der zehn größten Änderungen.

- [ ] **Schritt 1: Den Stand „heute" auschecken.**

```bash
git worktree add --detach "$SCRATCH/wt-heute" "$(cat "$SCRATCH/basis.txt")"
```

- [ ] **Schritt 2: Der Rastererzeuger** — `$SCRATCH/raster-erzeugen.js`:

```js
// Wegwerf (Bauplan Gipfelkegel, Aufgabe 4): alle Gebirgsraster ueber den ECHTEN Speicherweg der Karte
// rechnen und ablegen, statt sie hochzuladen. Aufruf: node raster-erzeugen.js <Baum> <heute|neu> <Scratchpad>
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const [,, BAUM, TAG, SCRATCH] = process.argv;
const eco = JSON.parse(fs.readFileSync(path.join(SCRATCH, "eco-topo.json"), "utf8")).areas;
const mf = JSON.parse(fs.readFileSync(path.join(SCRATCH, "map-features.json"), "utf8")).features;

// Die Formen, die die Karte im Browser haelt: Labels mit [lat, lng] = [y, x], Wege als rohe Features.
const labelData = mf.filter((f) => (f.properties || {}).feature_type === "label" && f.geometry).map((f) => {
	const p = f.properties;
	const hs = p.height_schritt;
	return {
		labelType: p.feature_subtype,
		publicId: String(p.public_id || f.id || ""),
		coordinates: [Number(f.geometry.coordinates[1]), Number(f.geometry.coordinates[0])],
		heightSchritt: hs === null || hs === undefined || hs === "" ? undefined : Number(hs),
		curveLine: Array.isArray(p.curve_label_line) ? p.curve_label_line : undefined,
	};
});
const pathData = mf.filter((f) => (f.properties || {}).feature_type === "path");
const abgelegt = [];

const sandkasten = {
	console: { warn() {}, log() {}, error: console.error },
	...require(path.join(BAUM, "js/map-features/__tests__/gebirgs-worker-hilfe.cjs"))(),
	document: {
		currentScript: { src: path.join(BAUM, "js/map-features/map-features-ecosystem-hydrologie.js") },
		createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
	},
	setTimeout: (fn, delay) => delay === 300000 ? setTimeout(fn, delay) : 0,
	clearTimeout, requestAnimationFrame: () => 0, performance: { now: () => 0 }, devicePixelRatio: 1,
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	map: {
		createPane: () => ({ style: {}, appendChild() {} }), getPane: () => ({ style: {}, appendChild() {} }),
		getSize: () => ({ x: 0, y: 0 }), getZoom: () => 4,
		containerPointToLayerPoint: () => ({ x: 0, y: 0 }), containerPointToLatLng: (p) => ({ lat: p[1], lng: p[0] }),
		latLngToContainerPoint: () => ({ x: 0, y: 0 }), on() {}, off() {},
	},
	L: { DomUtil: { setPosition() {} } },
	ecosystemLayers: new Map(eco.map((a) => [String(a.public_id), { _ecosystemArea: a }])),
	labelData, pathData,
	isEcosystemLayerModeActive: () => true, getActiveEcosystemLayerKind: () => "topographie",
	Math, Number, String, Array, Object, JSON, Promise, isFinite, Buffer, Error, Infinity, NaN, Map, Set, Date,
	Uint8Array, Uint8ClampedArray, Uint16Array, Float64Array, Float32Array, Int32Array,
	postEcosystemEdit: (aktion, rumpf) => { abgelegt.push(rumpf); return Promise.resolve({ written: 1 }); },
};
sandkasten.window = sandkasten;
sandkasten.globalThis = sandkasten;
const kontext = vm.createContext(sandkasten);
for (const datei of [
	"js/map-features/map-features-point-in-polygon.js",
	"js/map-features/map-features-ecosystem-geometry.js",
	"js/map-features/map-features-ecosystem-heightmap-raster.js",
	"js/map-features/map-features-ecosystem-height-field.js",
	"js/map-features/map-features-ecosystem-hydrologie.js",
	"js/map-features/map-features-ecosystem-height-render.js",
]) {
	sandkasten.module = { exports: {} };
	vm.runInContext(fs.readFileSync(path.join(BAUM, datei), "utf8"), kontext, { filename: datei });
}

(async () => {
	const modul = sandkasten.AvesmapsEcosystemHeightRender;
	const gebirge = eco.filter((a) => a.kind === "topographie" && a.region_type === "gebirge");
	const raus = [];
	for (const area of gebirge) {
		abgelegt.length = 0;
		const antwort = await modul.hochladen(area, { bestand: eco });
		if (!antwort || !antwort.hochgeladen || !abgelegt.length) {
			console.log("uebersprungen", area.region_name, antwort && antwort.grund);
			continue;
		}
		const r = abgelegt[0];
		raus.push({ area: r.area, name: area.region_name, width: r.width, height: r.height, cell_size: r.cell_size,
			origin_x: r.origin_x, origin_y: r.origin_y, samples: r.samples, geometry: area.geometry_geojson || area.geometry });
	}
	fs.writeFileSync(path.join(SCRATCH, "raster-" + TAG + ".json"), JSON.stringify(raus));
	console.log(TAG + ":", raus.length, "Raster von", gebirge.length, "Gebirgen");
	process.exit(0);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
```

- [ ] **Schritt 3: Beide Stände rechnen.**

```bash
node "$SCRATCH/raster-erzeugen.js" "$SCRATCH/wt-heute" heute "$SCRATCH"
```

```bash
node "$SCRATCH/raster-erzeugen.js" "$SCRATCH/wt-gipfel" neu "$SCRATCH"
```

Erwartet: beide Male dieselbe Zahl Raster (rund 71; flache Gebirge ohne Gipfel und Kammhöhe fehlen in beiden).
Unterscheidet sich die Zahl: STOPP — dann rechnen die zwei Stände nicht dasselbe Gebiet.

- [ ] **Schritt 4: Der Vergleich** — `$SCRATCH/reisezeit-vergleich.php`:

```php
<?php
// Wegwerf (Bauplan Gipfelkegel, Aufgabe 4): Leistungsfaktor je Landweg, heute gegen neu, aus denselben
// Profilfunktionen, die der Profillauf auf dem Server faehrt.
// Aufruf: php reisezeit-vergleich.php <Repo> <raster-heute.json> <raster-neu.json> <map-features.json>
declare(strict_types=1);

$repo = $argv[1];
require $repo . '/api/_internal/app/terrain-store.php';
require_once $repo . '/api/_internal/app/heightmap.php';

function laden(string $datei): array
{
    $raster = [];
    foreach (json_decode((string) file_get_contents($datei), true) as $z) {
        $r = avesmapsHeightmapDecode([
            'origin_x' => $z['origin_x'], 'origin_y' => $z['origin_y'], 'cell_size_mapunits' => $z['cell_size'],
            'width_px' => $z['width'], 'height_px' => $z['height'],
            'samples' => gzdeflate((string) base64_decode($z['samples'])),
        ]);
        $r['geometry'] = $z['geometry'];
        $r['area_id'] = $z['area'];
        $r['min_x'] = $r['origin_x'];
        $r['min_y'] = $r['origin_y'];
        $r['max_x'] = $r['origin_x'] + ($r['width'] - 1) * $r['cell'];
        $r['max_y'] = $r['origin_y'] + ($r['height'] - 1) * $r['cell'];
        $raster[] = $r;
    }
    return $raster;
}

// Vorwaerts zahlt Anstieg + steilen Abstieg, rueckwaerts tauschen die Paare (terrain-store.php, „FOUR NUMBERS").
function faktoren(?array $profil, array $coords): array
{
    if ($profil === null) {
        return [1.0, 1.0];
    }
    $laenge = 0.0;
    for ($i = 1; $i < count($coords); $i++) {
        $laenge += hypot((float) $coords[$i][0] - (float) $coords[$i - 1][0], (float) $coords[$i][1] - (float) $coords[$i - 1][1]);
    }
    $steilAuf = (float) array_sum(array_column($profil['profile'], 2));
    $steilAb = (float) array_sum(array_column($profil['profile'], 3));
    return [
        avesmapsTerrainLeistungsFactor((float) $profil['ascent'], $steilAb, $laenge),
        avesmapsTerrainLeistungsFactor((float) $profil['descent'], $steilAuf, $laenge),
    ];
}

function beruehrt(array $rasters, array $coords): bool
{
    $xs = array_map(static fn($c) => (float) $c[0], $coords);
    $ys = array_map(static fn($c) => (float) $c[1], $coords);
    foreach ($rasters as $r) {
        if (!(max($xs) < $r['min_x'] || $r['max_x'] < min($xs) || max($ys) < $r['min_y'] || $r['max_y'] < min($ys))) {
            return true;
        }
    }
    return false;
}

$heute = laden($argv[2]);
$neu = laden($argv[3]);
$mf = json_decode((string) file_get_contents($argv[4]), true);
$wasser = defined('AVESMAPS_TERRAIN_WATER_ROUTE_TYPES') ? AVESMAPS_TERRAIN_WATER_ROUTE_TYPES : ['Flussweg', 'Seeweg'];

$zeilen = [];
foreach ($mf['features'] as $f) {
    $p = $f['properties'] ?? [];
    if (($p['feature_type'] ?? '') !== 'path' || in_array((string) ($p['feature_subtype'] ?? ''), $wasser, true)) {
        continue;
    }
    $g = $f['geometry'] ?? null;
    if (!is_array($g) || ($g['type'] ?? '') !== 'LineString' || count($g['coordinates']) < 2) {
        continue;
    }
    $c = $g['coordinates'];
    if (!beruehrt($heute, $c) && !beruehrt($neu, $c)) {
        continue;
    }
    $a = faktoren(avesmapsTerrainProfileForLine($heute, $c), $c);
    $b = faktoren(avesmapsTerrainProfileForLine($neu, $c), $c);
    $d = max(abs($b[0] - $a[0]), abs($b[1] - $a[1]));
    $zeilen[] = [$d, (string) ($p['display_name'] ?? $p['name'] ?? ''), (string) ($p['public_id'] ?? ''), $a, $b];
}
usort($zeilen, static fn($x, $y) => $y[0] <=> $x[0]);
printf("%d Landwege beruehren ein Raster, %d aendern ihren Faktor um mehr als 0,01, %d um mehr als 0,1\n",
    count($zeilen), count(array_filter($zeilen, static fn($z) => $z[0] > 0.01)), count(array_filter($zeilen, static fn($z) => $z[0] > 0.1)));
foreach (array_slice($zeilen, 0, 10) as $z) {
    printf("  %-38s %-14s hin %.3f -> %.3f   zurueck %.3f -> %.3f\n", mb_substr($z[1], 0, 38), $z[2], $z[3][0], $z[4][0], $z[3][1], $z[4][1]);
}

// ⚠️ STICHPROBE QUERFELDEIN: je Messgebirge ein gerader Schnitt West-Ost und Sued-Nord durch die Mitte seiner
// Rasterbox. Das ist NICHT der A*-Weg -- es zeigt nur, wie sich der Hoehenpreis quer durchs Gebirge aendert.
$namen = array_column(json_decode((string) file_get_contents($argv[3]), true), 'name', 'area');
foreach (['Finsterkamm', 'Rote Sichel', 'Schwarze Sichel'] as $name) {
    foreach ($neu as $r) {
        if (($namen[$r['area_id']] ?? '') !== $name) { continue; }
        $mx = ($r['min_x'] + $r['max_x']) / 2;
        $my = ($r['min_y'] + $r['max_y']) / 2;
        foreach (['West-Ost' => [[$r['min_x'], $my], [$r['max_x'], $my]], 'Sued-Nord' => [[$mx, $r['min_y']], [$mx, $r['max_y']]]] as $richtung => $linie) {
            $a = faktoren(avesmapsTerrainProfileForLine($heute, $linie), $linie);
            $b = faktoren(avesmapsTerrainProfileForLine($neu, $linie), $linie);
            printf("  Schnitt %-16s %-9s hin %.3f -> %.3f   zurueck %.3f -> %.3f\n", $name, $richtung, $a[0], $b[0], $a[1], $b[1]);
        }
    }
}
```

- [ ] **Schritt 5: Fahren.**

```bash
php -d extension=php_mbstring.dll "$SCRATCH/reisezeit-vergleich.php" "$SCRATCH/wt-gipfel" "$SCRATCH/raster-heute.json" "$SCRATCH/raster-neu.json" "$SCRATCH/map-features.json"
```

Erwartet: eine Kopfzeile mit drei Zahlen, zehn Wege mit Namen, sechs Schnittzeilen. Außerhalb der Gipfelkreise
bewegt sich nichts, also stehen oben Wege, die durch Gipfelkreise laufen.

- [ ] **Schritt 6: Festhalten.** Ausgabe als `$SCRATCH/reisezeit-ergebnis.txt` ablegen; sie geht in Aufgabe 5 an
  den Owner. `git worktree remove "$SCRATCH/wt-heute"` und `git worktree prune`.

---
## Aufgabe 5: Push 1 — Regler und Kegel live, dann der Blick des Owners

**Dateien:** keine neuen; gepusht werden die Commits aus Aufgabe 1 und 3.

- [ ] **Schritt 1: Bericht an den Owner, VOR dem Push** — einfach, ohne Fachwörter, mit Bildern:
  - die Damm-Tabelle aus Aufgabe 2 (drei Gebirge, heute / neu),
  - das Ergebnis aus Aufgabe 4 (wie viele Wege sich ändern, die zehn größten beim Namen),
  - das Mockup `docs/gipfel-steigung-dialog-mockup.html` als Erinnerung, was im Dialog kommt,
  - der Hinweis: die Reisezeiten ändern sich erst nach seinem Rasterlauf (Aufgabe 8).

  Frage: „Darf das live?" — ohne ausdrückliches Ja kein Push.

- [ ] **Schritt 2: Prüfagent `usability-design`** (Mockup gegen gebauten Zustand, nur die Reglerzeile):

  > Vergleiche die Reglerzeile „Steigung der Gipfel" in `<WT>/index.html` (Gruppe „Kamm und Form") mit
  > `docs/gipfel-steigung-dialog-mockup.html`: Beschriftung, Tooltip, Schieber 0–60 Schritt 1, Zahlenfeld,
  > Vorgabemarke, ↺, Platz in der Gruppe, grau ohne Gipfel samt Satz. Kreise sind NICHT Teil dieses Pushs.
  > Kein `git checkout`, `stash` oder `restore`.

- [ ] **Schritt 3: Auf den neuesten Stand.** Der Worktree trägt nur eigene Commits — hier ist Rebase erlaubt:

```bash
cd "$WT" && git fetch origin master && git log --oneline HEAD..origin/master -- js/map-features/map-features-ecosystem-hydrologie.js api/_internal/app/terrain-store.php && git rebase origin/master
```

  Kam etwas an `hydrologie.js` oder `terrain-store.php` dazu: lesen, Überschneidung benennen, und das Testfeld
  (Aufgabe 3, Schritt 22) erneut fahren. Kam irgendetwas anderes dazu: Testfeld ebenfalls erneut.

- [ ] **Schritt 4: Tor und Warteschlange.**

```bash
gh run list --limit 3
```

  Steht ein Lauf `in_progress` und einer `pending`: warten, bis höchstens einer läuft.

- [ ] **Schritt 5: Nachricht lesen, pushen, SHA prüfen.**

```bash
cd "$WT" && git log -2 --format="%h %s%n%b"
```

```bash
cd "$WT" && git push origin HEAD:master
```

```bash
cd "$WT" && git rev-parse HEAD && git ls-remote origin master
```

  Erwartet: beide SHAs gleich.

- [ ] **Schritt 6: Deploy abwarten.**

```bash
gh run list --limit 1
```

```bash
gh run watch <run-id> --exit-status
```

  Erwartet: `completed success`. Rot: `.github/workflows/deploy-avesmaps-strato.yml`-Schritt lesen, der
  gescheitert ist (vor SFTP = nichts live), beheben, NICHT den nächsten Push obendrauf setzen.

- [ ] **Schritt 7: Ist es wirklich ausgeliefert?** (Cache-Falle AGENTS.md §7)

```bash
curl -s "https://avesmaps.de/js/map-features/map-features-ecosystem-hydrologie.js?cb=$(date +%s)" | grep -c "function blendeGipfelkegel"
```

```bash
curl -s "https://avesmaps.de/index.html?cb=$(date +%s)" | grep -c "Steigung der Gipfel"
```

  Erwartet: je `1`.

- [ ] **Schritt 8: Als Besucher laden, Konsole lesen.** Browser-Pane `https://avesmaps.de/` (ohne `edit=1`),
  `read_console_messages` mit `onlyErrors: true`. Erwartet: keine neuen Fehler.

- [ ] **Schritt 9: Abnahme mit dem Owner** (Entwurf §9, ohne die Kreise) — der Owner führt aus, oder die Sitzung
  in seinem Chrome mit seiner Editor-Sitzung; jeder Handgriff wird benannt:
  1. Karte mit `?edit=1`, Topographie, Flächendialog der **Roten Sichel** öffnen.
  2. Der Regler heißt „Steigung der Gipfel", steht auf 30°, zeigt die Vorgabemarke der Vorlage (Karst, 30°).
  3. Regler auf 45°: das Streiflicht rechnet neu.
  4. An der Adlerspitze keine Nadel mehr; an der Schwarzen Sichel ist der Aarenfels der höchste Punkt seiner
     Nähe (Mulde wie Entwurf §4.8, nicht tiefer).
  5. Regler auf 0: keine Gipfelkegel.
  6. Fläche ohne Gipfel (Gorische Wüste): Regler grau, Satz im Tooltip.
  7. Den Regler zurück auf den alten Wert und **nicht speichern**, außer der Owner will es.
  ⚠️ „Höhenfeld erzeugen" (§9 Punkt 7) gehört zum Rasterlauf in Aufgabe 8, nicht hierher.

  Rückmeldung abwarten. Befund → beheben, eigener Commit, eigener Push, wieder Schritt 4–9.

---
## Aufgabe 6: Der Kreis im Flächendialog

Entwurf §5.4, Mockup `docs/gipfel-steigung-dialog-mockup.html`. Zweite sichtbare Änderung — eigener Commit,
eigener Push (Aufgabe 7), erst nach dem Owner-Blick auf Push 1.

**Dateien:**
- Ändern: `css/base/tokens.css`, `js/map-features/map-features-ecosystem-height-render.js`, `docs/gipfel-steigung-dialog-mockup.html`
- Neu erzeugen: `docs/ansicht-untergrund-mockup.html` (Generator liest `tokens.css`)
- Anlegen: `js/map-features/__tests__/gipfel-kreis.test.js`

**Schnittstellen:**
- Nutzt: `avesmapsGipfelRadius` (global aus `hydrologie.js`, in `index.html` vor `height-render.js` geladen),
  im Zeichner `flaecheMitId`, `aktiveFlaeche`, `nachbarnVon`, `reglerFuer`, `gipfelDieserFlaeche`, `map`, `context`, `STEP`.
- Liefert: `zeichneGipfelKreise(dpr)` (modulintern), Token `--color-ecosystem-gipfel-radius`.

- [ ] **Schritt 1: Den Test schreiben** — `js/map-features/__tests__/gipfel-kreis.test.js`:

```js
"use strict";

// Der Radius jedes Gipfels als gestrichelter Kreis (Entwurf gipfelkegel-steigung §5.4).
// 🔴 `redraw()` WIRKLICH GEFAHREN, mit einer Leinwand-Attrappe OHNE Proxy (Lehre vom 03.09.2026: ein Proxy
// beantwortet jeden Bezeichner und verschluckt den ReferenceError, um dessentwillen der Test existiert).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const TOKEN = "--color-ecosystem-gipfel-radius";
const BOUNDS = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
const GIPFEL = [{ x: 6, y: 10, h: 3000 }, { x: 14, y: 14, h: 5000 }];

let gehalten = 0;
const offen = [];
function pruefe(name, fn) {
	offen.push(Promise.resolve().then(fn).then(() => { gehalten++; console.log("  ok  " + name); },
		(fehler) => { console.error("  FEHLER  " + name + "\n    " + fehler.message); process.exitCode = 1; }));
}

function baueZeichner(steigung) {
	const flaeche = {
		public_id: "probe", region_name: "Probegebirge", kind: "topographie", region_type: "gebirge",
		geometry_revision: 1, bounds: BOUNDS,
		geometry: { type: "Polygon", coordinates: [[[1, 1], [19, 1], [19, 19], [1, 19], [1, 1]]] },
		terrain_grain: 4, terrain_levels: 2, terrain_avg_height: 4000, terrain_gipfel_steigung: steigung,
	};
	const boegen = [];
	const stift = { dash: null, farbe: null, breite: null };
	let anstrich;
	const gemalt = new Promise((resolve) => { anstrich = resolve; });
	const ctx2d = {
		setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
		closePath() {}, fill() {}, stroke() {},
		arc(x, y, r) { boegen.push({ x, y, r }); },
		setLineDash(muster) { stift.dash = [...muster]; },
		set strokeStyle(w) { stift.farbe = w; }, get strokeStyle() { return stift.farbe; },
		set lineWidth(w) { stift.breite = w; }, get lineWidth() { return stift.breite; },
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData() { anstrich(); },
	};
	const canvas = { width: 0, height: 0, style: {}, classList: { add() {}, toggle() {} }, getContext: () => ctx2d };
	const pane = { style: {}, appendChild() {} };
	const ctx = {
		...require("./gebirgs-worker-hilfe.cjs")(),
		console: { log() {}, warn() {}, error() {} },
		Math, Number, String, Array, Object, JSON, Float64Array, Uint8Array, Uint8ClampedArray,
		Infinity, NaN, isFinite, Map, Set, Date,
		performance: { now: () => 0 },
		setTimeout: (fn, delay) => delay === 300000 ? setTimeout(fn, delay) : 0,
		requestAnimationFrame: () => 0,
		devicePixelRatio: 1,
		map: {
			createPane: () => pane, getPane: () => pane, getSize: () => ({ x: 200, y: 160 }),
			containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
			containerPointToLatLng: (p) => ({ lat: BOUNDS.min_y + (p[1] * 0.1), lng: BOUNDS.min_x + (p[0] * 0.1) }),
			on() {}, off() {},
		},
		L: { DomUtil: { setPosition() {} } },
		document: {
			createElement: () => canvas, documentElement: {},
			currentScript: { src: path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js") },
		},
		ecosystemLayers: new Map([["probe", { _ecosystemArea: flaeche }]]),
		labelData: GIPFEL.map((p, n) => ({ labelType: "berggipfel", publicId: "g" + n, coordinates: [p.y, p.x], heightSchritt: p.h })),
		pathData: [],
		isEcosystemLayerModeActive: () => true,
		getActiveEcosystemLayerKind: () => "topographie",
		getComputedStyle: () => ({ getPropertyValue: (name) => (name === TOKEN ? " #e0a82e" : "") }),
	};
	ctx.window = ctx;
	ctx.globalThis = ctx;
	vm.createContext(ctx);
	for (const datei of [
		"js/map-features/map-features-point-in-polygon.js",
		"js/map-features/map-features-ecosystem-geometry.js",
		"js/map-features/map-features-ecosystem-height-field.js",
		"js/map-features/map-features-ecosystem-hydrologie.js",
		"js/map-features/map-features-ecosystem-height-render.js",
	]) {
		ctx.module = { exports: {} };
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), ctx, { filename: datei });
	}
	const zeichner = ctx.window.AvesmapsEcosystemHeightRender;
	zeichner.setSolid(true, "probe");

	return { zeichner, boegen, stift, gemalt, radius: (h) => ctx.avesmapsGipfelRadius(h, steigung) };
}

// Die Attrappe rechnet 0,1 Karteneinheiten je Bildpunkt, Ursprung (0,0): Mitte = Koordinate × 10.
function erwarteKreise(boegen, radius) {
	for (const p of GIPFEL) {
		const soll = { x: p.x * 10, y: p.y * 10, r: radius(p.h) * 10 };
		assert.ok(boegen.some((b) => Math.abs(b.x - soll.x) < 1e-6 && Math.abs(b.y - soll.y) < 1e-6 && Math.abs(b.r - soll.r) < 1e-6),
			"kein Kreis um (" + p.x + "," + p.y + ") mit Radius " + soll.r.toFixed(3) + " px -- gezeichnet: " + JSON.stringify(boegen));
	}
}

pruefe("um jeden Gipfel ein gestrichelter Kreis -- sofort, noch bevor das Raster gerechnet ist", () => {
	const z = baueZeichner(30);
	z.zeichner.redraw();
	erwarteKreise(z.boegen, z.radius);
	assert.deepStrictEqual(z.stift.dash, [4, 3], "nicht gestrichelt 4/3");
	assert.strictEqual(z.stift.farbe, "#e0a82e", "die Farbe kommt nicht aus dem Token");
	assert.strictEqual(z.stift.breite, 1.3);
	z.zeichner.setSolid(false);
});

pruefe("nach dem vollen Anstrich stehen die Kreise weiter -- ueber der Maske", async () => {
	const z = baueZeichner(30);
	z.zeichner.redraw();
	await z.gemalt;
	z.boegen.length = 0;
	z.zeichner.redraw();
	erwarteKreise(z.boegen, z.radius);
	z.zeichner.setSolid(false);
});

pruefe("45° zieht den Kreis zusammen: ein 5.000er reicht 5 Meilen", () => {
	const z = baueZeichner(45);
	z.zeichner.redraw();
	assert.ok(z.boegen.some((b) => Math.abs(b.r - ((5 / 3) * 10)) < 1e-6), "kein Kreis mit 16,67 px");
	z.zeichner.setSolid(false);
});

pruefe("Steigung 0: kein einziger Kreis", () => {
	const z = baueZeichner(0);
	z.zeichner.redraw();
	assert.strictEqual(z.boegen.length, 0, "bei Steigung 0 wurden Kreise gezeichnet");
	z.zeichner.setSolid(false);
});

Promise.all(offen).then(() => {
	if (!process.exitCode) { console.log("\n" + gehalten + " Zusicherungen gehalten."); }
	process.exit(process.exitCode || 0);
});
```

- [ ] **Schritt 2: Rot sehen.** `node js/map-features/__tests__/gipfel-kreis.test.js` — die drei Zusicherungen mit
  Kreisen FEHLER („kein Kreis um …"), „Steigung 0" grün.

- [ ] **Schritt 3: Das Token.** In `css/base/tokens.css` direkt unter
  `--color-ecosystem-height-4: #f7f3ee;                    /* 100 % -- Firn, fast Weiss */`:

```css
	/* Der Radius eines Gipfelkegels als gestrichelter Kreis im Flaechendialog (Entwurf gipfelkegel-steigung
	   §5.4). Warmes Gold, auf dem Graustufen-Relief in jeder Hoehe lesbar. ⚠️ Nur hier: die Kartenflaeche
	   wechselt mit dem Thema nicht (Kopf dieser Datei), deshalb kein Wert im dunklen Block. */
	--color-ecosystem-gipfel-radius: #e0a82e;
```

- [ ] **Schritt 4: Der Zeichner.** In `map-features-ecosystem-height-render.js` direkt vor `\tfunction redraw() {`:

```js
	// Der Radius jedes Gipfels als gestrichelter Kreis (Entwurf gipfelkegel-steigung §5.4). Er folgt der
	// Flaeche sofort -- auch solange das neue Raster noch gerechnet wird -- und liest DENSELBEN Radius wie der
	// Trichter (`avesmapsGipfelRadius`), damit Kreis und Kegel nie auseinanderlaufen.
	// ⚠️ Ohne Token (Stylesheet nicht geladen) zeichnet er nichts, statt eine erfundene Farbe zu malen.
	const GIPFEL_KREIS_TOKEN = "--color-ecosystem-gipfel-radius";
	function zeichneGipfelKreise(dpr) {
		const area = flaecheMitId(aktiveFlaeche);
		if (!area || typeof avesmapsGipfelRadius !== "function") { return; }
		const farbe = String(getComputedStyle(document.documentElement).getPropertyValue(GIPFEL_KREIS_TOKEN) || "").trim();
		if (!farbe) { return; }
		const origin = map.containerPointToLatLng([0, 0]);
		const schritt = map.containerPointToLatLng([STEP, STEP]);
		const deltaX = (schritt.lng - origin.lng) / STEP;
		const deltaY = (schritt.lat - origin.lat) / STEP;
		if (!(Math.abs(deltaX) > 0) || !(Math.abs(deltaY) > 0)) { return; }
		const flaechen = [area].concat(nachbarnVon(area).map((n) => n.area));
		context.save();
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.strokeStyle = farbe;
		context.lineWidth = 1.3 * dpr;
		context.setLineDash([4 * dpr, 3 * dpr]);
		for (const flaeche of flaechen) {
			const steigung = reglerFuer(flaeche).steigung;
			for (const p of gipfelDieserFlaeche(flaeche)) {
				const rad = avesmapsGipfelRadius(p.h, steigung);
				if (!(rad > 0)) { continue; }
				context.beginPath();
				context.arc((p.x - origin.lng) / deltaX * dpr, (p.y - origin.lat) / deltaY * dpr,
					Math.abs(rad / deltaX) * dpr, 0, 2 * Math.PI);
				context.stroke();
			}
		}
		context.restore();
	}

```
  In `redraw()` zweimal aufrufen:
  - im frühen Ausstieg `if (!raster || raster.leer || !raster.r) {` die Zeile `meldeAnstrich(0);` um
    `zeichneGipfelKreise(dpr);` direkt dahinter ergänzen (vor `return;`);
  - nach der Maske `context.fill("nonzero");` + `context.restore();` die Zeile `zeichneGipfelKreise(dpr);`.

- [ ] **Schritt 5: Grün sehen.** `node js/map-features/__tests__/gipfel-kreis.test.js` → vier `ok`, Exit 0.
  Dazu `node js/map-features/__tests__/gebirgssimulation.test.js` (seine Attrappe liefert `""` fürs Token und
  darf nicht werfen).
  ⚠️ Scheitert nur „sofort, noch bevor das Raster gerechnet ist": `redraw()` kehrt dann vor dem frühen Ausstieg
  zurück. Die Stelle suchen, an der das passiert, und den Aufruf dort ergänzen — die Zusage „folgt dem Regler
  sofort" (§5.4) steht, der Test wird nicht gelockert.

- [ ] **Schritt 6: Mutationsproben** (je rot sehen, zurücksetzen, Bytes gegenprüfen): Aufruf im frühen Ausstieg
  streichen · Aufruf nach der Maske streichen · `reglerFuer(flaeche).steigung` → `undefined` ·
  `setLineDash([4 * dpr, 3 * dpr])` → `setLineDash([])`.

- [ ] **Schritt 7: Das Mockup bindet das Token.** In `docs/gipfel-steigung-dialog-mockup.html` den Block

```css
	/* Das neue Token ist der Vorschlag dieses Mockups. Die Vertragsmarken fuer css/base/tokens.css
	   kommen erst im Bau-Commit dazu, zusammen mit dem Token selbst: vorher machte der Pruefer
	   (tools/mockup-vertrag) das Deploy-Tor fuer alle rot. Die Kartenflaeche wechselt mit dem Thema
	   nicht (Kopf von tokens.css), deshalb kein Wert im dunklen Block. */
	:root {
		--color-ecosystem-gipfel-radius: #e0a82e;
	}
```
  ersetzen durch

```css
	/* ══ VERTRAG: css/base/tokens.css ══
	   🔴 ALLES ZWISCHEN DIESEN MARKEN MUSS IN DER GENANNTEN DATEI ZEICHENGLEICH STEHEN.
	   Gewacht von tools/mockup-vertrag/__tests__/mockup-vertrag.test.js. Die Kartenflaeche wechselt mit
	   dem Thema nicht (Kopf von tokens.css), deshalb kein Wert im dunklen Block. */
	:root {
		--color-ecosystem-gipfel-radius: #e0a82e;
	}
	/* ══ VERTRAG ENDE ══ */
```

- [ ] **Schritt 8: Das Nachbar-Mockup neu erzeugen** (es wird aus `tokens.css` gebaut, ein neues Token macht
  seinen Test sonst rot):

```bash
cd "$WT" && node tools/bau-ansicht-untergrund-mockup.js && node tools/__tests__/ansicht-untergrund-mockup.test.js && node tools/mockup-vertrag/__tests__/mockup-vertrag.test.js
```

  Erwartet: beide Tests grün; `git diff --stat docs/ansicht-untergrund-mockup.html` zeigt nur die Tokenzeile.

- [ ] **Schritt 9: Das ganze Testfeld** (Befehle unter „Globale Vorgaben") — gleich der Nulllinie.

- [ ] **Schritt 10: Prüfagent `mockup-treue`:**

  > Miss den gebauten Kreis in `<WT>` (Token in `css/base/tokens.css`, `zeichneGipfelKreise` in
  > `js/map-features/map-features-ecosystem-height-render.js`) gegen `docs/gipfel-steigung-dialog-mockup.html`:
  > Farbe, Linienbreite 1,3, Strich 4/3, Kreis um jeden Gipfel der Fläche UND ihrer mitgezeigten Nachbarn,
  > Radius Höhe ÷ tan(Steigung), Gipfel ohne Höhe = 5.000, kein Kreis bei 0, folgt dem Schieber sofort.
  > Kein `git checkout`, `stash` oder `restore`.

- [ ] **Schritt 11: Commit** (Push in Aufgabe 7):

```bash
cd "$WT" && git add css/base/tokens.css js/map-features/map-features-ecosystem-height-render.js js/map-features/__tests__/gipfel-kreis.test.js docs/gipfel-steigung-dialog-mockup.html docs/ansicht-untergrund-mockup.html && git commit -F "$SCRATCH/commit-6.txt"
```

`$SCRATCH/commit-6.txt`:

```text
ui(landschaften): ein gestrichelter Kreis zeigt im Flaechendialog, wie weit jeder Gipfel reicht

Editor-sichtbar: in der Topographie steht bei offenem Flaechendialog um jeden Gipfel der Flaeche und
ihrer Nachbarn ein goldener gestrichelter Kreis mit dem Radius Hoehe / tan(Steigung). Er folgt dem
Regler „Steigung der Gipfel" sofort und verschwindet bei 0. Neues Token
--color-ecosystem-gipfel-radius, im Mockup docs/gipfel-steigung-dialog-mockup.html als Vertrag gebunden.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---
## Aufgabe 7: Push 2 — die Kreise live

- [ ] **Schritt 1:** Erst wenn der Owner Push 1 abgenommen hat (Aufgabe 5, Schritt 9).
- [ ] **Schritt 2:** Aufgabe 5, Schritte 3–6 genau so wiederholen (Rebase, Testfeld falls etwas kam,
  `gh run list --limit 3`, Nachricht lesen, `git push origin HEAD:master`, SHA gegen `git ls-remote`, Deploy
  abwarten).
- [ ] **Schritt 3: Ausgeliefert?**

```bash
curl -s "https://avesmaps.de/css/base/tokens.css?cb=$(date +%s)" | grep -c "color-ecosystem-gipfel-radius"
```

```bash
curl -s "https://avesmaps.de/js/map-features/map-features-ecosystem-height-render.js?cb=$(date +%s)" | grep -c "function zeichneGipfelKreise"
```

  Erwartet: je `1`. Danach als Besucher laden und die Konsole lesen (Aufgabe 5, Schritt 8).

- [ ] **Schritt 4: Abnahme mit dem Owner** (Entwurf §9, Punkte 3, 4, 6), in hell UND dunkel:
  1. Flächendialog der Roten Sichel: um jeden der 14 Gipfel ein gestrichelter Kreis.
  2. Regler auf 45°: die Kreise schrumpfen sofort; auf 0: keine Kreise.
  3. Eine Nachbarfläche, die im Dialog mitgezeigt wird, trägt ihre Kreise ebenfalls.
  4. Das Thema umschalten: der Kreis bleibt lesbar (die Kartenfläche wechselt nicht).

  Rückmeldung abwarten; ein Befund wird ein eigener Commit und Push.

---

## Aufgabe 8: Nacharbeit — Abnahmeliste, Doku, Rasterlauf

**Dateien:** `AGENTS.md` (§11), `docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md` (Nachtrag),
Memory `kamm-anwuchs-erosion-stand.md` (außerhalb des Repos).

- [ ] **Schritt 1: Die Abnahmeliste abhaken** — jede 💣 / ⚠️ / 🔴-Zeile des Entwurfs, erfüllt oder begründet
  verworfen (AGENTS.md §9 „Der eigene Entwurf ist die Abnahmeliste"):

| Entwurf | Zeile | Wo erfüllt |
|---|---|---|
| §0/§3 | 🔴 Kamm-Anwuchs nicht gebaut | nichts gebaut |
| §4.2 | 💣 Randkeil tragend | Test „Randkeil", Mutation 1 (Aufgabe 1) |
| §4.2 | ⚠️ `max`, nie Summe | Test „max", Mutation 2 |
| §4.4 | 🔴 eingeblendet, korrigiert · ⚠️ Exponent 4 gemessen | Test „Gewichte", Konstante mit Kommentar |
| §4.5 | 💣 Talflanken Pflicht | Riegel + Test + Messung Aufgabe 2 |
| §4.6 | 🔴 Ausstrahlung fällt · ⚠️ nach dem Deckel | Test „gefallen"; Position nur per Kommentar (Aufgabe 3, Mutation 2) |
| §4.8 | ⚠️ Mulde, tieferes Umland, glatte Kreise | dem Owner in Aufgabe 5 gezeigt |
| §5.1 | 💣 `terrain_bergform` nicht umdeuten · ⭐ 30° · ⭐ vier Flächen nicht umgerechnet | neue Spalte; Stilllegungs-Zusicherung PHP |
| §5.2 | 🔧 Steigung je Form · 💣 Vorlagen in den Schranken | Owner-Wahl Aufgabe 0; `gelaende-vorlagen` |
| §5.3 | Regler, Tooltip, grau ohne Gipfel | Aufgabe 3 Schritte 12–13, `gelaende-regler-ausgrauen` |
| §5.4 | ⚠️ Token · 🔴 Mockup vor dem Bau | Aufgabe 6, Vertrag im Mockup |
| §5.5 | 💣 Stempel, `reglerFuer`, Loader, Nutzlast, Server-Schranke | `terrain-store-test`, `gelaenderegler-kette`, Version 14, `gelaende-schranken-gleich` |
| §6.1 | Reisezeiten vor dem Livegang · 🔧 DU Rasterlauf | Aufgabe 4; Schritt 4 hier |
| §7 | ⭐ #109 zuerst · ein Lauf für beide | Aufgabe 0; Schritt 4 hier |
| §9 | Abnahme als Ablauf | Aufgaben 5 und 7 |
| §10 | ⚠️ vor dem Bau neu greppen | Aufgabe 0 Schritt 2, Aufgabe 3 Schritt 21 |

- [ ] **Schritt 2: Nachtrag im Entwurf** (nur was sich beim Bau ergab): die Owner-Wahl zu Kettengebirge (§5.2),
  die Damm-Zahlen aus Aufgabe 2 (§4.5), dass die Position „nach dem Deckel" nur ein Kommentar hält (§4.6),
  die Reisezeit-Zahlen aus Aufgabe 4 (§6.1). Commit `docs(landschaften): …` per Datei.

- [ ] **Schritt 3: AGENTS.md §11** — ein Eintrag am Ende der Landschaften-Einträge:

```markdown
- **Gipfel als Kegel mit Steigung — und der Kegel kommt NACH der Erosion.** Live <Datum> (Entwurf
  `docs/superpowers/specs/2026-09-14-gipfelkegel-steigung-design.md`, Mockup `docs/gipfel-steigung-dialog-mockup.html`).
  Der Regler „Steigung der Gipfel" (0–60°, Vorgabe 30°) ersetzt „Ausstrahlung der Gipfel"; Radius = Höhe ÷
  tan(Steigung), im Flächendialog als gestrichelter Kreis. 🔴 **Die Ausstrahlung wirkte VOR dem Rauschen, und die
  Erosion hat ihren Kegel wieder eingeebnet** — ein hoher Gipfel wurde zur Nadel, ein niedriger überwachsen.
  `blendeGipfelkegel` läuft deshalb nach dem Deckel am Ausgang: darunter sanft angehoben, darüber kräftig herab
  (1 − u⁴, Owner-Wahl „eingeblendet, korrigiert"). 💣 Drei tragende Riegel, alle getestet: der **Randkeil**
  (sonst reicht ein Kegel über den Flächenrand und bricht die Fußhöhe 0 an der Naht), **max statt Summe**, und
  die **Talsohle** (sonst steht die Flussachse als Damm über ihrem Ufer, gemessen +477 Schritt). 💣
  `terrain_bergform` ist stillgelegt, nicht umgedeutet — die gespeicherten Radien als Grad gelesen hießen 220
  Meilen Kegelradius. ⚠️ Die Position „nach dem Deckel" hält nur ein Kommentar, kein Test. Tests:
  `gipfelkegel-steigung.test.js`, `gipfel-kreis.test.js`, `terrain-store-test.php`.
```

  Commit `docs(agents): …` per Datei; nicht sichtbar, darf ohne eigenen Owner-Blick gepusht werden.

- [ ] **Schritt 4: 🔧 DU — Rasterlauf und Profillauf, EINMAL gemeinsam mit #109** (Entwurf §6.1, §7). Dem Owner
  schreiben: im Landschaften-Editor „Rechnen ▾ → Höhenraster starten", danach den Wegprofil-Lauf. Erst danach
  wirken die neuen Höhen auf Reisezeiten. Anschließend EINE Probe an `POST /api/route/` (irgendeine Gebirgsroute)
  und prüfen, dass `terrain.stale` jetzt `false` meldet.

- [ ] **Schritt 5: Memory** `kamm-anwuchs-erosion-stand.md` auf den gebauten Stand bringen (was live ist, was
  offen bleibt: Entwurf §8), Zeiger in `MEMORY.md` anpassen.

- [ ] **Schritt 6: Aufräumen.**

```bash
git worktree remove "$SCRATCH/wt-gipfel" && git worktree prune
```
