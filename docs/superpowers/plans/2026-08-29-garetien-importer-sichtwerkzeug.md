# Garetien Importer — der Anzeigen-Umbau (Bauplan)

> **Für agentische Arbeiter:** PFLICHT-UNTERSKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> Kästchen (`- [ ]`).

**Ziel:** Das Fenster „Garetien Importer" führt eine EIGENE Anzeige-Menge, mit der ein Editor jedes
der 8213 Objekte auf die Karte legen kann — unabhängig davon, ob es einen Vorschlag hat.

**Architektur:** Die Anzeige-Menge lebt client-seitig im Modulzustand des Fensters
(`zustand.anzeige`, Schlüssel → ganzes Objekt). Der Reiter „Anzeigen" rendert sie direkt, ohne den
Server zu fragen; die drei übrigen Reiter bleiben Server-Filter. Das Häkchen wird ein reiner
client-seitiger Marker. Gezeichnet wird, was in der Menge liegt — in der Form und Farbe, die das
Objekt auf unserer Karte hätte.

**Technik:** Vanilla JS ohne Bauschritt · Leaflet 1.9.4 (`L.CRS.Simple`) · PHP 8 + PDO ·
Node-Tests ohne Framework (`assert`, `node <datei>`)

**Entwurf:** `docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md`
**Übergabe:** `docs/superpowers/plans/2026-08-29-garetien-importer-sichtwerkzeug-UEBERGABE.md`
**Auftrag (gilt weiter):** `docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md` §5.5

---

## Globale Bedingungen

- 🔴 **Abbau-Bedingung (Auftrag §5.5):** nichts außerhalb von `api/_internal/import/` darf
  `garetien_import_row` oder `garetien_import_run` kennen. **Keine neue Server-Tabelle** für die
  Anzeige — sie ist client-seitig, genau deswegen.
- 🔴 **Deutsch:** Kommentare, Commit-Botschaften, Testnamen, Beschriftungen.
- 🔴 **Kein hartkodierter Farbwert** (AGENTS.md §12). Fehlt ein Token, wird es ZUERST in
  `css/base/tokens.css` angelegt — hell UND dunkel.
- 🔴 **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Jede Aufgabe ist ein Commit, ein
  Push, ein Blick des Owners. **Kein Bündel.**
- 🔴 **Vor JEDEM Push das ganze Testfeld**, beide Sprachen, mit der **Klammer um beide Gruppen**,
  Dateizahl gegengezählt, **NACH dem `git add`**. Vorbestehend rot ist genau einer:
  `linkcheck/link-url-test.php`.
- 🔴 **Geteilter Arbeitsbaum:** nie `git add -A`, nie `git add .`, nie force-pushen. Nur die eigenen
  Pfade, einzeln benannt.
- ⚠️ **Der Owner benutzt das Werkzeug nicht zum Importieren** („ich baue das tool für die
  editoren"). Gewässer, Stufen und das Tor sind **kein Thema** und werden nicht angesprochen.

### 💣 Vor dem Beginn: die Datei bewegt sich

`js/review/review-garetien-importer.js` und `js/review/review-garetien-karte.js` werden von
**mehreren Sitzungen gleichzeitig** bearbeitet (gemessen 29.08.2026, 16:07 — beide Dateien trugen
ungetrackte Änderungen einer parallelen Sitzung, die „✦ Zentrieren", die zwei Farbknöpfe und die
Tooltips gebaut hat).

⭐ **Jede Aufgabe beginnt deshalb mit `git status` und `git log --oneline -5`** und liest die
betroffene Funktion frisch, statt sich auf den Quelltext in diesem Plan zu verlassen. Wo dieser
Plan Code zeigt, zeigt er die **Absicht** und die **Namen** — nicht notwendig die Zeile, die dort
gerade steht.

### Dateien

| | |
|---|---|
| `js/review/review-garetien-importer.js` | Zustand, Reiter, Knöpfe, Fußzeile, Klickverteiler — **alle fünf Aufgaben** |
| `js/review/review-garetien-karte.js` | der Zeichner — Aufgaben 2, 3, 4 |
| `css/base/tokens.css` | `--color-garetien-unsere` (liegt ungetrackt), `--color-garetien-kollision` (neu) |
| `css/components/garetien-importer.css` | die zwei neuen Knöpfe, der Farbtupfer |
| `api/_internal/import/garetien-liste.php` | `stand`-Leiter (Aufgabe 1), Sicht-Auskunft (Aufgabe 3) |
| `js/review/__tests__/garetien-anzeige-menge.test.js` | **neu** — Aufgaben 1, 2, 5 |
| `js/review/__tests__/garetien-sicht-tafel.test.js` | **neu** — Aufgaben 3, 4 |
| `api/_internal/import/__tests__/garetien-stand-test.php` | **neu** — Aufgabe 1 |

---

## Aufgabe 1: Die Anzeige-Menge und der Reiter „Anzeigen"

Der Konstruktionsfehler aus Übergabe §3. Ohne diese Aufgabe kann keine der folgenden gebaut werden.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`zustand`, `AVESMAPS_GARETIEN_REITER`,
  `avesmapsGaretienTabsMarkup`, `avesmapsGaretienListeRendern`,
  `avesmapsGaretienFensterZustand`)
- Ändern: `api/_internal/import/garetien-liste.php` (`avesmapsGaretienListeObjektStand`)
- Neu: `js/review/__tests__/garetien-anzeige-menge.test.js`
- Neu: `api/_internal/import/__tests__/garetien-stand-test.php`

**Schnittstellen:**
- **Liefert an Aufgabe 2–5:**
  - `zustand.anzeige` — `Map<string, object>`, Schlüssel → das ganze Objekt
  - `avesmapsGaretienAnzeigeHinzufuegen(objekte)` → `number` (Größe danach)
  - `avesmapsGaretienAnzeigeLeeren()` → `number` (immer `0`)
  - `avesmapsGaretienAnzeigeListe()` → `Array<object>` in Einfügereihenfolge
  - `avesmapsGaretienAnzeigeHat(schluessel)` → `boolean`
  - Reiterschlüssel `"anzeigen"` in `AVESMAPS_GARETIEN_REITER`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Neu: `js/review/__tests__/garetien-anzeige-menge.test.js`

```js
// Die Anzeige-Menge des Garetien Importers -- sie gehoert dem FENSTER, nicht dem Vorschlag.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-anzeige-menge.test.js
//
// 🔴 Gemessen wird am ERGEBNIS der echten Funktionen, nie am Quelltext. Die teuerste Fehlerklasse
// dieses Vorhabens ist die VAKUUM-Zusicherung (ein `includes(...)`, das auch die Definitionszeile
// trifft) -- deshalb wird hier ausgefuehrt.
"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

// ---- Die Fixture -------------------------------------------------------------------------------
//
// 🔴 `ohneVorschlag` ist der WICHTIGSTE Fall: 7930 der 8213 Objekte sehen so aus (`items: []`).
// Genau sie konnten bis zum 29.08.2026 nie auf die Karte -- die alte Menge las `items[].selected`.
const mitVorschlag  = { key: "ggp:Gewaesser:1", name: "Alke",       typ: "Bach", items: [{ selected: 1 }] };
const ohneVorschlag = { key: "ggp:Berge:7",     name: "Krähenkopf", typ: "Berg", items: [] };

// ---- 1. Ein Objekt OHNE Vorschlag kommt in die Menge -------------------------------------------
modul.avesmapsGaretienAnzeigeLeeren();
gleich(modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag]), 1,
	"ein Objekt ohne jedes Item MUSS in die Anzeige koennen -- das sind 7930 von 8213");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), true, "und es liegt drin");

// ---- 2. Gemerkt wird das OBJEKT, nicht der Schluessel -------------------------------------------
//
// Der Server liefert je Abruf nur die gefilterte Seite. Ein Schluessel ohne Objekt waere nach dem
// naechsten Filterwechsel nicht mehr aufloesbar -- die Karte verloere genau das, was der Editor
// zusammengetragen hat. Die DIFFERENZ dazu: nach dem Hinzufuegen ist der NAME noch da.
gleich(modul.avesmapsGaretienAnzeigeListe()[0].name, "Krähenkopf",
	"die Menge haelt das ganze Objekt -- sonst ueberlebt sie keinen Filterwechsel");

// ---- 3. Entdoppelt, und die Reihenfolge ist die des Einfuegens ----------------------------------
modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag, mitVorschlag]);
gleich(modul.avesmapsGaretienAnzeigeListe().length, 2,
	"zweimal dasselbe Objekt ergibt EINEN Eintrag -- zweimal gezeichnet waere ein doppelt "
	+ "kraeftiger Strich");
tief(modul.avesmapsGaretienAnzeigeListe().map((o) => o.key), ["ggp:Berge:7", "ggp:Gewaesser:1"],
	"Einfuegereihenfolge, damit die Liste sich unter dem Editor nicht umsortiert");

// ---- 4. Leeren leert wirklich ------------------------------------------------------------------
gleich(modul.avesmapsGaretienAnzeigeLeeren(), 0, "„Anzeige leeren\" leert");
gleich(modul.avesmapsGaretienAnzeigeListe().length, 0, "und danach ist sie leer");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), false, "auch fuer den Einzelnachschlag");

// ---- 5. Der Reiter „Anzeigen" steht an zweiter Stelle und traegt seine Zahl ---------------------
//
// ⚠️ Gemessen wird die REIHENFOLGE, nicht nur das Vorkommen: „Anzeigen" ersetzt „Vorgemerkt" an
// dessen Stelle, damit der Editor seinen Reiter nicht suchen muss.
modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag]);
const tabs = modul.avesmapsGaretienTabsMarkup({ offen: 259, abgelehnt: 3, uebernommen: 0 }, "offen");
const reihenfolge = (tabs.match(/data-stand="([a-z]+)"/g) || []).map((s) => s.slice(12, -1));
tief(reihenfolge, ["offen", "anzeigen", "abgelehnt", "uebernommen"],
	"vier Reiter, und „anzeigen\" steht an der Stelle des alten „vorgemerkt\"");
wahr(tabs.includes("Anzeigen (1)"),
	"die Zahl kommt aus der MENGE, nicht aus der Serverantwort -- der Server kennt sie nicht");

// ---- 6. Die DIFFERENZ: der Server wird nach „anzeigen" nie gefragt ------------------------------
//
// 🪤 Die Vakuum-Falle waere, hier den Quelltext zu lesen. Gemessen wird stattdessen, dass
// `anzeigen` in der Server-Standleiter GAR NICHT vorkommt -- ein `stand: "anzeigen"` waere ein
// Filter auf einen Wert, den `avesmapsGaretienListeObjektStand` nie zurueckgibt, und die Liste
// bliebe fuer immer leer.
wahr(!modul.AVESMAPS_GARETIEN_SERVER_STAENDE.includes("anzeigen"),
	"„anzeigen\" ist KEIN Serverstand -- es wird im Browser gerendert");
tief(modul.AVESMAPS_GARETIEN_SERVER_STAENDE, ["offen", "abgelehnt", "uebernommen"],
	"und `vorgemerkt` ist aus der Leiter heraus -- sonst springt die Zeile beim Anhaken");

console.log(`garetien-anzeige-menge: ${checks} Pruefungen bestanden.`);
```

- [ ] **Schritt 2: Den Test fahren, damit er scheitert**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js
```

Erwartet: `TypeError: modul.avesmapsGaretienAnzeigeLeeren is not a function`

- [ ] **Schritt 3: Die Menge und die Reiterleiste bauen**

In `js/review/review-garetien-importer.js`, im `zustand`-Objekt ergänzen:

```js
		// 🔴 DIE ANZEIGE-MENGE GEHOERT DEM FENSTER, NICHT DEM VORSCHLAG (Entwurf §3).
		// Bis zum 29.08.2026 hing „liegt auf der Karte" an `items[].selected` -- und 7930 der 8213
		// Objekte haben ueberhaupt kein Item. Sie konnten damit NIE angezeigt werden; kein
		// Umbenennen einer Beschriftung haette das geaendert.
		// ⚠️ Gemerkt wird das OBJEKT, nicht sein Schluessel: der Server liefert je Abruf nur die
		// gefilterte Seite, ein Schluessel allein waere nach dem naechsten Filterwechsel nicht mehr
		// aufloesbar.
		// 🔴 Eine `Map` und nicht ein Objekt: sie haelt die Einfuegereihenfolge zu, und ein
		// Objektschluessel wie „constructor" kann ihr nichts anhaben.
		anzeige: new Map(),
```

Daneben die vier reinen Zugriffe:

```js
	// ---- Die Anzeige-Menge ------------------------------------------------------------------------
	//
	// 🔴 CLIENT-SEITIG, und das ist eine Bedingung, keine Bequemlichkeit: eine Server-Tabelle dafuer
	// waere eine dritte Import-Tabelle und verstiesse gegen die Abbau-Regel (Auftrag §5.5).
	// Sie ist ein Arbeitsmittel der Sitzung und ueberlebt das Schliessen des Fensters nicht --
	// gewollt.

	function avesmapsGaretienAnzeigeHinzufuegen(objekte) {
		(objekte || []).forEach(function (o) {
			if (!o || o.key === undefined || o.key === null || o.key === "") { return; }
			// ⚠️ Ein bereits liegendes Objekt wird ERSETZT, nicht uebersprungen: die frischere
			// Fassung kommt aus der letzten Serverantwort und kann ein geaendertes Urteil tragen.
			// Die Reihenfolge bleibt trotzdem die des ERSTEN Einfuegens -- `Map.set` auf einen
			// vorhandenen Schluessel sortiert nicht um.
			zustand.anzeige.set(String(o.key), o);
		});
		return zustand.anzeige.size;
	}

	function avesmapsGaretienAnzeigeLeeren() {
		zustand.anzeige.clear();
		return zustand.anzeige.size;
	}

	function avesmapsGaretienAnzeigeListe() {
		return Array.from(zustand.anzeige.values());
	}

	function avesmapsGaretienAnzeigeHat(schluessel) {
		return zustand.anzeige.has(String(schluessel));
	}
```

`AVESMAPS_GARETIEN_REITER` ersetzen und die Serverstände danebenstellen:

```js
	// 🔴 VIER REITER, ABER NUR DREI SERVERSTAENDE. „Anzeigen" ist die client-seitige Menge
	// (Entwurf §3.1) -- der Server kennt den Wert nicht und wird danach nie gefragt.
	// 🔴 `vorgemerkt` ist aus der Leiter heraus (29.08.2026): es war ein SERVERstand, abgeleitet
	// aus `selected`, und deshalb sprang eine Zeile beim Anhaken aus „Offen" heraus und war dort
	// nicht mehr abhakbar. Owner: „Markieren aendert nichts."
	// ⚠️ Die ZAHL „14 vorgemerkt" bleibt in der Fusszeile -- sie ist weiter wahr, sie ist nur kein
	// Reiter mehr.
	const AVESMAPS_GARETIEN_SERVER_STAENDE = ["offen", "abgelehnt", "uebernommen"];

	const AVESMAPS_GARETIEN_REITER = [
		["offen", "Offen"],
		["anzeigen", "Anzeigen"],
		["abgelehnt", "Abgelehnt"],
		["uebernommen", "Übernommen"],
	];
```

`avesmapsGaretienTabsMarkup` liest die Anzeigen-Zahl aus der Menge:

```js
	function avesmapsGaretienTabsMarkup(reiter, aktiverStand) {
		const r = reiter || {};
		return AVESMAPS_GARETIEN_REITER.map(([schluessel, beschriftung]) => {
			const klasse = "avm-tab" + (schluessel === aktiverStand ? " is-active" : "");
			// 🔴 Die Zahl des Reiters „Anzeigen" kommt aus der MENGE. Sie aus `reiter.anzeigen` zu
			// lesen waere eine zweite Wahrheit ueber etwas, das der Server gar nicht kennt.
			const zahl = schluessel === "anzeigen"
				? zustand.anzeige.size
				: Number(r[schluessel] || 0);
			return '<button class="' + klasse + '" type="button" data-stand="' + schluessel + '">'
				+ avesmapsGaretienEscape(beschriftung) + " (" + zahl + ")</button>";
		}).join("");
	}
```

Und die vier neuen Namen plus `AVESMAPS_GARETIEN_SERVER_STAENDE` in den `module.exports`-Block
aufnehmen (er steht am Dateiende, bei `garetienListeKlick`).

- [ ] **Schritt 4: Den Test fahren — er muss bestehen**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js
```

Erwartet: `garetien-anzeige-menge: 12 Pruefungen bestanden.`

- [ ] **Schritt 5: Den Serverstand `vorgemerkt` fallen lassen — erst der Test**

Neu: `api/_internal/import/__tests__/garetien-stand-test.php`

```php
<?php

declare(strict_types=1);

// Der Bearbeitungsstand eines Objekts -- `vorgemerkt` ist seit dem 29.08.2026 KEINER mehr.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3.2
//
// Ausfuehren: php -d zend.assertions=1 -d assert.exception=1 \
//   api/_internal/import/__tests__/garetien-stand-test.php

require_once __DIR__ . '/../garetien-liste.php';

$checks = 0;
function pruefe(bool $bedingung, string $warum): void {
    global $checks;
    assert($bedingung, $warum);
    $checks++;
}

// 🔴 DER TRAGENDE FALL: ein angehaktes Item verschiebt die Zeile NICHT mehr.
// Bis zum 29.08.2026 gab dieselbe Eingabe 'vorgemerkt' zurueck -- die Zeile sprang aus „Offen"
// heraus und war dort nicht mehr abhakbar (Owner: „Markieren aendert nichts").
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 1, 'apply_state' => 'pending', 'declined' => false],
    ]) === 'offen',
    'ein angehaktes Item laesst das Objekt OFFEN -- ein Haekchen ist eine Markierung, kein Stand'
);

// Die DIFFERENZ nach oben: „uebernommen" und „abgelehnt" bleiben unberuehrt.
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 1, 'apply_state' => 'done', 'declined' => false],
    ]) === 'uebernommen',
    'ein uebernommenes Item schlaegt weiterhin alles'
);
pruefe(
    avesmapsGaretienListeObjektStand([
        ['selected' => 0, 'apply_state' => 'pending', 'declined' => true],
    ]) === 'abgelehnt',
    'alle Items abgelehnt heisst weiterhin abgelehnt'
);
pruefe(avesmapsGaretienListeObjektStand([]) === 'offen', 'ohne Item: offen');

echo "garetien-stand: {$checks} Pruefungen bestanden.\n";
```

- [ ] **Schritt 6: Den PHP-Test fahren, damit er scheitert**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/import/__tests__/garetien-stand-test.php
```

Erwartet: `AssertionError: ein angehaktes Item laesst das Objekt OFFEN …`

- [ ] **Schritt 7: Den `selected`-Zweig aus der Standleiter entfernen**

In `api/_internal/import/garetien-liste.php`, in `avesmapsGaretienListeObjektStand`, die Schleife
über `selected` (heute Zeilen 224–228) durch einen Kommentar ersetzen:

```php
    // 🔴 HIER STAND BIS ZUM 29.08.2026 EIN ZWEIG `selected === 1 ⇒ 'vorgemerkt'`.
    // Er machte aus dem Haekchen eine EINBAHNTUER: die Zeile sprang beim Anhaken aus „Offen"
    // heraus in einen Reiter, in dem sie nicht mehr abhakbar war. Owner 29.08.2026:
    // „Markieren aendert nichts." Das Haekchen ist seither ein client-seitiger Marker
    // (Entwurf §3.2), und die Anzeige ist eine eigene Menge im Fenster (§3).
    // ⚠️ Die ZAHL bleibt: `reiter.vorgemerkt` wird weiter gezaehlt und steht in der Fusszeile
    // („14 vorgemerkt · 3 abgelehnt · 0 uebernommen"). Sie ist kein Stand mehr, aber sie ist wahr.

    return 'offen';
```

⚠️ **Und die Zählung darf nicht mitsterben:** `reiter.vorgemerkt` wird an der Stelle gezählt, an
der die Reiterzahlen entstehen. Vor der Änderung mit `grep -n "vorgemerkt" api/_internal/import/garetien-liste.php`
alle Vorkommen ansehen; die Zählung für die Fußzeile muss ihre eigene Rechnung bekommen
(„irgendein Item `selected`"), da sie sie nicht mehr aus `stand` ableiten kann.

- [ ] **Schritt 8: Beide Tests fahren — beide müssen bestehen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/import/__tests__/garetien-stand-test.php && node js/review/__tests__/garetien-anzeige-menge.test.js
```

- [ ] **Schritt 9: Das ganze Testfeld, dann commit**

```bash
git add js/review/review-garetien-importer.js api/_internal/import/garetien-liste.php js/review/__tests__/garetien-anzeige-menge.test.js api/_internal/import/__tests__/garetien-stand-test.php
```

Dann das Feld (siehe „Das Testfeld" ganz unten), dann:

```bash
git commit -m "garetien(anzeigen): die Anzeige ist eine eigene Menge -- auch die 7930 ohne Vorschlag"
```

---

## Aufgabe 2: Das Häkchen markiert, die zwei Knöpfe füllen die Anzeige, die Karte folgt

Die erste Aufgabe, die der Owner **sehen** kann.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienListeSkelettMarkup`,
  `garetienHakenKlick`, `avesmapsGaretienAufDerKarte`, `avesmapsGaretienListeRendern`)
- Ändern: `css/components/garetien-importer.css`
- Ändern: `js/review/__tests__/garetien-anzeige-menge.test.js`

**Schnittstellen:**
- **Verbraucht:** `avesmapsGaretienAnzeige*` aus Aufgabe 1
- **Liefert an Aufgabe 3–5:**
  - `zustand.markiert` — `Set<string>`, die client-seitig markierten Schlüssel
  - `avesmapsGaretienMarkierungUmschalten(schluessel)` → `boolean` (Stand danach)
  - `avesmapsGaretienAufDerKarte()` gibt jetzt die **Anzeige-Menge** zurück

- [ ] **Schritt 1: Den scheiternden Test schreiben** (an `garetien-anzeige-menge.test.js` anhängen)

```js
// ---- 7. Das Haekchen ist ein MARKER und schreibt NICHTS ----------------------------------------
//
// 🔴 Gemessen an der DIFFERENZ: ein Klick auf das Haekchen darf keinen Netzaufruf ausloesen. Der
// Sender wird deshalb durch einen Spion ersetzt, der mitzaehlt.
let gesendet = 0;
const spion = function () { gesendet++; return Promise.resolve({}); };

modul.avesmapsGaretienAnzeigeLeeren();
gleich(modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7"), true, "erster Klick markiert");
gleich(modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7"), false, "zweiter Klick nimmt zurueck");
gleich(gesendet, 0,
	"ein Haekchenklick schreibt NICHTS auf den Server -- er verschiebt die Zeile nicht und "
	+ "veraendert `selected` nicht (Owner: „Markieren aendert nichts\")");

// ---- 8. „Markierte anzeigen" legt sie dazu und laesst sie markiert ------------------------------
modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7");
gleich(modul.avesmapsGaretienMarkierteAnzeigen([ohneVorschlag, mitVorschlag]), 1,
	"nur das MARKIERTE kommt in die Anzeige, nicht die ganze Liste");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), true, "und es liegt drin");
gleich(modul.avesmapsGaretienMarkierungHat("ggp:Berge:7"), true,
	"es bleibt markiert und bleibt in „Offen\" -- „sie sind ja immer noch offen\"");

// ---- 9. Die Karte zeigt die ANZEIGE, nicht mehr die Haekchen -----------------------------------
//
// 🔴 DIE TRAGENDE ZUSICHERUNG DES GANZEN VORHABENS. Vorher las `avesmapsGaretienAufDerKarte`
// `items[].selected`; ein Objekt ohne Item war damit auf KEINE Weise sichtbar zu machen.
const aufDerKarte = modul.avesmapsGaretienAufDerKarte([mitVorschlag, ohneVorschlag]);
tief(aufDerKarte.map((o) => o.key), ["ggp:Berge:7"],
	"auf der Karte liegt die ANZEIGE-MENGE -- das angehakte `mitVorschlag` liegt NICHT dort, "
	+ "obwohl sein Item `selected: 1` traegt");
```

- [ ] **Schritt 2: Test fahren, scheitert**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js
```

Erwartet: `TypeError: modul.avesmapsGaretienMarkierungUmschalten is not a function`

- [ ] **Schritt 3: Markierung, die zwei Knöpfe und die neue Kartenmenge bauen**

Im `zustand`:

```js
		// 🔴 Die Markierung ist CLIENT-SEITIG und schreibt nichts (Owner 29.08.2026: „Markieren
		// aendert nichts"). Sie hat genau einen Zweck: der Knopf „Markierte anzeigen".
		markiert: new Set(),
```

```js
	function avesmapsGaretienMarkierungUmschalten(schluessel) {
		const s = String(schluessel);
		if (zustand.markiert.has(s)) { zustand.markiert.delete(s); return false; }
		zustand.markiert.add(s);
		return true;
	}

	function avesmapsGaretienMarkierungHat(schluessel) {
		return zustand.markiert.has(String(schluessel));
	}

	// „Markierte anzeigen": sie kommen ZUSAETZLICH in die Anzeige und BLEIBEN markiert und offen.
	// ⚠️ Die Liste kommt HEREIN (Hausform in dieser Datei), damit sich am Ergebnis messen laesst,
	// welche Objekte wirklich uebernommen wurden.
	function avesmapsGaretienMarkierteAnzeigen(objekte) {
		const liste = (objekte || zustand.objekte || []).filter(function (o) {
			return o && zustand.markiert.has(String(o.key));
		});
		avesmapsGaretienAnzeigeHinzufuegen(liste);
		return liste.length;
	}
```

`avesmapsGaretienAufDerKarte` vollständig ersetzen:

```js
	/*
	 * Was auf der Karte liegt: DIE ANZEIGE-MENGE -- und das ANGEKLICKTE dazu.
	 *
	 * 🔴 HIER STAND BIS ZUM 29.08.2026 `liste.filter(avesmapsGaretienHatAuswahl)`, also
	 * `items[].selected`. Ein Objekt OHNE Item hat kein Haekchen und war damit auf KEINE Weise
	 * sichtbar zu machen -- und das sind 7930 von 8213. Owner: „ich will, dass alles was
	 * importiert werden kann angezeigt werden kann."
	 *
	 * ⚠️ Entdoppelt ueber den Schluessel: das angeklickte Objekt liegt oft schon in der Anzeige,
	 * und zweimal gezeichnet ergaebe einen doppelt so kraeftigen Strich.
	 * ⚠️ Das ANGEKLICKTE kommt weiterhin dazu, ohne in die Menge zu wandern: eine Zeile ansehen
	 * soll die Anzeige nicht heimlich fuellen (dann waere „Anzeige leeren" nie wirksam).
	 */
	function avesmapsGaretienAufDerKarte(objekte) {
		const raus = avesmapsGaretienAnzeigeListe();
		if (zustand.detailKey === null) { return raus; }
		const schonDrin = raus.some(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		});
		if (schonDrin) { return raus; }
		const liste = objekte || zustand.objekte || [];
		const angeklickt = liste.filter(function (o) {
			return o && String(o.key) === String(zustand.detailKey);
		})[0];
		return angeklickt ? raus.concat([angeklickt]) : raus;
	}
```

Im Skelett (`garetienListeSkelettMarkup`), unter der Suchzeile, die zwei Knöpfe:

```js
			+ '<div class="gi-anzeigebar">'
			+ '<button class="btn" type="button" id="garetien-mark-show">Markierte anzeigen</button>'
			+ '<button class="btn" type="button" id="garetien-anzeige-clear">Anzeige leeren</button>'
			+ "</div>"
```

Beide im Skelett-Verdrahter (`garetienListeSkelettVerdrahten`) anschließen; jeder ruft seinen
reinen Zug und danach `avesmapsGaretienListeRendern(zustand.letzteAntwort)` sowie
`window.avesmapsGaretienKarteZeigen(avesmapsGaretienAufDerKarte())`.

`garetienHakenKlick` so umbauen, dass er `avesmapsGaretienMarkierungUmschalten` ruft und **nicht
mehr sendet**. 💣 Der bisherige Sender bleibt als Funktion stehen — er wird in Aufgabe 5 vom
Fußknopf gebraucht.

`garetienZeileMarkup`: das `checked`-Attribut kommt jetzt aus `zustand.markiert`, nicht aus
`avesmapsGaretienCheckboxZustand`. ⚠️ `garetienZeileMarkup` ist **rein** und muss es bleiben — der
Markierungsstand wird deshalb als zweites Argument hereingereicht, nicht aus dem Modulzustand
gelesen.

CSS in `css/components/garetien-importer.css`:

```css
/* Die zwei Knoepfe der Anzeige. Beide WEICH (`.btn`, kein `--main`): die Haupthandlung der Seite
   ist „Holen & Rechnen" im Menueband, und eine Zeilen-/Listenhandlung ist nie die Haupthandlung
   (AGENTS.md §12). */
.gi-anzeigebar {
	display: flex;
	gap: var(--space-6);
	margin-bottom: var(--space-6);
}
```

- [ ] **Schritt 4: Test fahren — muss bestehen**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js
```

- [ ] **Schritt 5: Im Browser abnehmen — der ABLAUF, nicht das Maß**

🔴 AGENTS.md §9: „Abnahme heißt ABLAUF, nicht Maß." Die vier Handgriffe wirklich ausführen und
benennen:

1. Fenster öffnen → **die Karte ist leer** und der Reiter zeigt „Anzeigen (0)".
2. Eine Zeile **ohne Vorschlag** (Reiter „Offen", Urteil „übersprungen") anhaken → **die Zeile
   bleibt stehen**, springt nicht weg.
3. „Markierte anzeigen" → das Objekt liegt auf der Karte, der Reiter zeigt „Anzeigen (1)".
4. „Anzeige leeren" → die Karte ist wieder leer.

- [ ] **Schritt 6: Testfeld, dann commit**

```bash
git add js/review/review-garetien-importer.js css/components/garetien-importer.css js/review/__tests__/garetien-anzeige-menge.test.js
git commit -m "garetien(anzeigen): markieren aendert nichts -- zwei Knoepfe fuellen und leeren die Karte"
```

---

## Aufgabe 3: Das Objekt tut so, als läge es schon auf der Karte

Entwurf §4.1. Ab hier wird es das, wonach der Owner gefragt hat.

**Dateien:**
- Ändern: `js/review/review-garetien-karte.js`
- Neu: `js/review/__tests__/garetien-sicht-tafel.test.js`

**Schnittstellen:**
- **Liefert an Aufgabe 4:**
  - `avesmapsGaretienSichtFuer(objekt)` → `{ form: "linie"|"flaeche"|"punkt", token: string, breite: number, neutral: boolean }`
  - `AVESMAPS_GARETIEN_SICHT_EBENE` — die Tafel

- [ ] **Schritt 1: Den scheiternden Test schreiben**

Neu: `js/review/__tests__/garetien-sicht-tafel.test.js`

```js
// Die Sicht-Tafel: welche FORM und welche FARBE ein importiertes Objekt auf der Karte bekommt.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §4.1
//
// Ausfuehren: node js/review/__tests__/garetien-sicht-tafel.test.js
"use strict";

const assert = require("assert");
const path = require("path");
let checks = 0;
function gleich(i, s, w) { assert.strictEqual(i, s, w || ""); checks++; }

const karte = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const sicht = karte.avesmapsGaretienSichtFuer;

// ---- 1. Mit Vorschlag gewinnt die SERVER-Auskunft -----------------------------------------------
//
// 🔴 `kind` + `subtyp` erlauben den Tokennamen nach der HAUSKONVENTION herzuleiten
// (`--color-ecosystem-<kind>-<subtyp mit _ als ->`, css/base/tokens.css:282). Kein zweiter
// Tabelleneintrag, keine zweite Wahrheit.
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).token, "--color-ecosystem-topographie-see",
	"ein See mit Vorschlag bekommt SEINE echte Kartenfarbe, hergeleitet aus kind+subtyp");
gleich(sicht({ ebene: "Gewaesser", typ: "See", kind: "topographie", subtyp: "see",
	geometrie_typ: "Polygon" }).form, "flaeche",
	"und `geometrie_typ` entscheidet die Form -- die Auskunft des Erzeugers ueber sich selbst");

gleich(sicht({ ebene: "Gewaesser", typ: "Fluss", subtyp: "Flussweg",
	geometrie_typ: "LineString" }).token, "--color-path-flussweg",
	"ein Weg-Ziel hat kein `kind` und leitet aus dem `subtyp` her -- kleingeschrieben");

// ---- 2. OHNE Vorschlag entscheidet die EBENE ----------------------------------------------------
//
// 🔴 DER HAEUFIGSTE FALL: 7930 der 8213 Objekte. `subtyp` und `geometrie_typ` sind bei ihnen LEER
// (beide kommen aus `after`, das es ohne Vorschlag nicht gibt) -- ihr `ebene` dagegen ist immer da,
// und es ist ein GESCHLOSSENER Satz von neun Werten (AVESMAPS_GARETIEN_EBENEN).
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"ein Berg ohne Vorschlag ist ein PUNKT -- als Linie gezeichnet waere er unsichtbar");
gleich(sicht({ ebene: "Ortschaften_3", typ: "Dorf", subtyp: "", geometrie_typ: "" }).form, "punkt",
	"alle vier Ortschaften-Ebenen sind Punkte");
gleich(sicht({ ebene: "Waelder", typ: "Forst", subtyp: "", geometrie_typ: "" }).token,
	"--color-ecosystem-vegetation-wald", "ein Wald ist gruen, auch ohne Vorschlag");

// ---- 3. Unbekannt faellt NEUTRAL aus, und sagt es ------------------------------------------------
//
// ⚠️ Die zurueckhaltende Richtung: eine unbekannte Ebene wird gezeichnet wie bisher (goldene Linie),
// nie gar nicht. Ein nicht gezeichnetes Objekt ist von „liegt da nichts" nicht zu unterscheiden.
const unbekannt = sicht({ ebene: "Sternenhimmel", typ: "Komet", subtyp: "", geometrie_typ: "" });
gleich(unbekannt.form, "linie", "unbekannt heisst Linie -- das heutige Bild");
gleich(unbekannt.token, "--color-marker-active", "und Gold");
gleich(unbekannt.neutral, true,
	"🔴 und es SAGT, dass es geraten hat -- die Bilanzzeile meldet es, sonst sieht ein Rueckfall "
	+ "aus wie „so sieht das Objekt eben aus\"");
gleich(sicht({ ebene: "Berge", typ: "Berg", subtyp: "", geometrie_typ: "" }).neutral, false,
	"die DIFFERENZ: ein getroffener Fall meldet sich NICHT als neutral");

console.log(`garetien-sicht-tafel: ${checks} Pruefungen bestanden.`);
```

- [ ] **Schritt 2: Test fahren, scheitert**

```bash
node js/review/__tests__/garetien-sicht-tafel.test.js
```

Erwartet: `TypeError: karte.avesmapsGaretienSichtFuer is not a function`

- [ ] **Schritt 3: Die Tafel und die Ordnung bauen**

In `js/review/review-garetien-karte.js`:

```js
	/*
	 * 🔴 DIE SICHT-TAFEL: wie ein importiertes Objekt AUSSIEHT. Sie sagt NIE, was daraus wird --
	 * ein Eintrag hier legt nichts an und aendert keine Zuordnung. Das ist der Unterschied zu
	 * AVESMAPS_GARETIEN_TYP_MAP (api/_internal/import/garetien-abgleich.php), und er ist der Grund,
	 * warum diese Tafel Ruling R21 nicht verletzt: R21 verbot eine hartkodierte Typenliste, die
	 * SEMANTIK entscheidet. Hier entscheidet nichts, hier wird gezeichnet.
	 *
	 * 🔴 GESCHLUESSELT AUF `ebene`, NICHT AUF `typ` -- und das ist gemessen, nicht Geschmack:
	 *   · `ebene` hat NEUN Werte, sie stehen als AVESMAPS_GARETIEN_EBENEN im Abruf, und JEDES der
	 *     8213 Objekte traegt einen davon.
	 *   · `typ` hat rund fuenfzig Werte, von denen sechs zugeordnet sind (Uebergabe §7.4). Eine
	 *     Tafel darauf waere zu 90 % geraten und muesste bei jedem neuen Quelltyp nachgezogen
	 *     werden -- genau die Zahl-im-Kommentar-Falle, die dieses Projekt sechsmal bezahlt hat.
	 * ⚠️ Grob, aber immer richtig: „Gewaesser" ist Wasser, auch wenn der einzelne Eintrag ein
	 * Wasserfall ist. Wer es feiner braucht, gibt dem Objekt einen Vorschlag -- dann gewinnt
	 * ohnehin die Server-Auskunft (Stufe 1 der Ordnung unten).
	 */
	var AVESMAPS_GARETIEN_SICHT_EBENE = {
		Gewaesser:     { form: "linie",   token: "--color-path-flussweg",                breite: 3 },
		Berge:         { form: "punkt",   token: "--color-ecosystem-topographie-gebirge", breite: 3 },
		Waelder:       { form: "flaeche", token: "--color-ecosystem-vegetation-wald",     breite: 2 },
		Wege:          { form: "linie",   token: "--color-path-strasse",                  breite: 3 },
		Grenzen:       { form: "linie",   token: "--color-territory-boundary",            breite: 2 },
		Ortschaften_1: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_2: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_3: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Ortschaften_4: { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Detail_1:      { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Detail_2:      { form: "punkt",   token: "--color-marker-settlement",             breite: 3 },
		Sonstiges:     { form: "linie",   token: "--color-marker-active",                 breite: 3 },
	};

	// Der Rueckfall. 🔴 Er ist das HEUTIGE Bild -- wer die Tafel entfernt, bekommt den Stand vom
	// 29.08.2026 zurueck und nicht eine leere Karte.
	var AVESMAPS_GARETIEN_SICHT_NEUTRAL = { form: "linie", token: "--color-marker-active", breite: 3 };

	/*
	 * Die Ordnung (Entwurf §4.1). REIN -- kein DOM, keine Karte.
	 *
	 * 🔴 EINE ORDNUNG, KEINE AUSWAHL -- dieselbe Bauform wie die Art-Regel der Landschaft
	 * (AGENTS.md §11): erst die Server-Auskunft, dann die Tafel, dann neutral.
	 * ⚠️ Der Tokenname wird nach der HAUSKONVENTION hergeleitet
	 * (`--color-ecosystem-<kind>-<subtyp mit _ als ->`, css/base/tokens.css:282) -- eine zweite
	 * Tabelle, die dieselbe Abbildung noch einmal auflistet, liefe beim ersten neuen Typ
	 * auseinander.
	 */
	function avesmapsGaretienSichtFuer(objekt) {
		var o = objekt || {};
		var kind = String(o.kind || "");
		var subtyp = String(o.subtyp || "");
		var geoTyp = String(o.geometrie_typ || "");

		if (subtyp !== "") {
			var token = kind !== ""
				? "--color-ecosystem-" + kind + "-" + subtyp.replace(/_/g, "-")
				: "--color-path-" + subtyp.toLowerCase();
			return {
				form: geoTyp === "Polygon" ? "flaeche" : "linie",
				token: token,
				breite: 3,
				neutral: false,
			};
		}

		var eintrag = AVESMAPS_GARETIEN_SICHT_EBENE[String(o.ebene || "")];
		if (!eintrag) {
			return {
				form: AVESMAPS_GARETIEN_SICHT_NEUTRAL.form,
				token: AVESMAPS_GARETIEN_SICHT_NEUTRAL.token,
				breite: AVESMAPS_GARETIEN_SICHT_NEUTRAL.breite,
				neutral: true,
			};
		}
		// ⚠️ `geometrie_typ` schlaegt die Tafel auch hier, falls es doch einmal gefuellt ist --
		// es ist die Auskunft des Erzeugers, die Tafel ist die Faustregel.
		return {
			form: geoTyp === "Polygon" ? "flaeche" : eintrag.form,
			token: eintrag.token,
			breite: eintrag.breite,
			neutral: false,
		};
	}
```

💣 **Vor dem Bauen prüfen, dass jedes Token WIRKLICH existiert:**

```bash
for t in --color-path-flussweg --color-ecosystem-topographie-gebirge --color-ecosystem-vegetation-wald --color-path-strasse --color-territory-boundary --color-marker-settlement --color-marker-active; do printf '%s: ' "$t"; grep -c -- "$t:" css/base/tokens.css; done
```

⚠️ Jede Zahl muss **≥ 2** sein (hell und dunkel). Eine `0` heißt: das Token gibt es nicht — dann
wird es **zuerst angelegt** (AGENTS.md §12), niemals ein Hexwert eingesetzt. 🪤 Ein undefiniertes
`var()` macht die ganze Deklaration ungültig, und `getComputedStyle` gibt `""` zurück — der Strich
verschwindet dann lautlos.

Danach `garetienGoldton()` zu `garetienToken(name)` verallgemeinern und die drei Zeichenzweige
(`circleMarker`, `polygon`, `polyline`) ihre Farbe, Form und Breite aus `avesmapsGaretienSichtFuer`
nehmen lassen. 🔴 Die **Strichelung bleibt** — sie sagt „das ist ihre Fassung, sie steht noch nicht
bei uns", und diese Aussage hängt nicht an der Farbe.

- [ ] **Schritt 4: Test fahren — muss bestehen**

```bash
node js/review/__tests__/garetien-sicht-tafel.test.js && node js/review/__tests__/garetien-karte.test.js
```

⚠️ **Beide.** `garetien-karte.test.js` misst die alten Zeichenzweige und wird von dieser Änderung
getroffen — genau dafür ist es da.

- [ ] **Schritt 5: Die Neutral-Meldung in die Bilanzzeile**

In `avesmapsGaretienListeRendern`, neben „✦ n leuchten":

```js
			// ⭐ Der Rueckfall wird GEMELDET, nicht verschwiegen (Entwurf §4.1). Ein stiller
			// Rueckfall saehe aus wie „so sieht das Objekt eben aus"; genannt ist er die
			// Arbeitsliste fuer die Sicht-Tafel. Dieselbe Regel wie „ein Pruefhaken zeigt seine
			// Funde".
			const neutrale = avesmapsGaretienAnzeigeListe().filter(function (o) {
				return typeof window !== "undefined"
					&& typeof window.avesmapsGaretienSichtFuer === "function"
					&& window.avesmapsGaretienSichtFuer(o).neutral;
			});
			const neutralText = neutrale.length === 0 ? "" : ' · <span class="gi-neutral">'
				+ neutrale.length + " neutral gezeichnet · Ebene "
				+ avesmapsGaretienEscape(
					Array.from(new Set(neutrale.map((o) => String(o.ebene || "?")))).join(", "))
				+ " hat keine Sicht-Regel</span>";
```

- [ ] **Schritt 6: Im Browser abnehmen — der ABLAUF**

1. Ein **Gewässer** anzeigen → blaue Linie, nicht mehr golden.
2. Einen **Berg** anzeigen → ein Punkt, sichtbar.
3. Einen **Wald** anzeigen → grüne Fläche.
4. Die Bilanzzeile nennt, was neutral blieb.

- [ ] **Schritt 7: Testfeld, dann commit**

```bash
git add js/review/review-garetien-karte.js js/review/review-garetien-importer.js js/review/__tests__/garetien-sicht-tafel.test.js js/review/__tests__/garetien-karte.test.js css/components/garetien-importer.css
git commit -m "garetien(sicht): das Objekt tut so, als laege es schon auf der Karte -- Form und Farbe aus seiner Art"
```

---

## Aufgabe 4: Rotes Leuchten bei Kollision

Entwurf §4.2. Der Fall „Krähensee": es gibt ihn im Import **und** bei uns.

**Dateien:**
- Ändern: `css/base/tokens.css` (neues Token, hell + dunkel)
- Ändern: `js/review/review-garetien-karte.js`
- Ändern: `js/review/__tests__/garetien-sicht-tafel.test.js`

**Schnittstellen:**
- **Verbraucht:** `avesmapsGaretienSichtFuer` aus Aufgabe 3
- **Liefert:** `avesmapsGaretienKollidiert(objekt)` → `boolean`

- [ ] **Schritt 1: Den scheiternden Test schreiben** (anhängen)

```js
// ---- 4. Rot heisst: bei uns liegt etwas, und eine Frage ist offen -------------------------------
const kollidiert = karte.avesmapsGaretienKollidiert;
gleich(kollidiert({ urteil: "widerspruch" }), true, "ein Widerspruch glueht rot");
gleich(kollidiert({ urteil: "zweifel" }), true, "ein Zweifel auch");
gleich(kollidiert({ urteil: "ergaenzung" }), true, "und eine Ergaenzungsfrage auch");

// 🔴 DIE DIFFERENZ, und sie traegt die Aussage: wo nichts kollidiert, glueht auch nichts.
gleich(kollidiert({ urteil: "neu" }), false,
	"bei „neu\" liegt bei uns NICHTS -- ein rotes Gluehen behauptete eine Kollision, die es "
	+ "nicht gibt");
gleich(kollidiert({ urteil: "deckt_sich" }), false,
	"bei „deckt sich\" ist nichts zu entscheiden");
gleich(kollidiert({ urteil: "uebersprungen" }), false, "und uebersprungen ist keine Kollision");
gleich(kollidiert({}), false, "ohne Urteil: kein Gluehen (die zurueckhaltende Richtung)");
```

- [ ] **Schritt 2: Test fahren, scheitert**

```bash
node js/review/__tests__/garetien-sicht-tafel.test.js
```

Erwartet: `TypeError: karte.avesmapsGaretienKollidiert is not a function`

- [ ] **Schritt 3: Das Token anlegen — hell UND dunkel**

In `css/base/tokens.css`, direkt unter `--color-garetien-unsere` (hell) bzw. dessen dunklem
Zwilling:

```css
	/* 🔴 DIE DRITTE FARBE DES GARETIEN-IMPORTERS: die KOLLISION (Owner 29.08.2026 -- „Kollisionen
	   (oder Ergaenzungsfragen) mit bestehenden koennen durch rotes gluehen ergaenzt werden").
	   ⚠️ ERGAENZUNG, kein Ersatz: das rote Gluehen liegt als zweiter Hof AUSSEN um das goldene
	   (ihre Fassung) bzw. magentafarbene (unsere). Wer es statt der Herkunftsfarbe zeichnete,
	   naehme dem Bild genau die Auskunft, um die es geht.
	   ⚠️ Nicht --color-path-open-end mitbenutzt, obwohl es derselbe Rotton waere: das heisst
	   „offenes Wegende" und liefe beim naechsten Umton auseinander. */
	--color-garetien-kollision: #d92b2b;
```

```css
	/* Der Zwilling im dunklen Thema -- heller, damit er auf dem dunklen Untergrund nicht zulaeuft.
	   Siehe die Begruendung im hellen Block. */
	--color-garetien-kollision: #ff6b6b;
```

- [ ] **Schritt 4: Das Prädikat und den zweiten Hof bauen**

```js
	/*
	 * Kollidiert dieses Objekt mit unserem Bestand? REIN.
	 *
	 * 🔴 Genau die drei Urteile, bei denen bei uns etwas an derselben Stelle liegt UND eine Frage
	 * offen ist. `neu` faellt heraus (da liegt nichts), `deckt_sich` faellt heraus (da ist nichts
	 * zu entscheiden), `uebersprungen` faellt heraus (es wurde gar nicht abgeglichen).
	 * ⚠️ Eine LISTE, kein `if`-Baum: bei der naechsten Urteilsart ist eine Kette still falsch, und
	 * niemand merkt es (Ruling R21).
	 */
	var AVESMAPS_GARETIEN_KOLLISION_URTEILE = ["widerspruch", "zweifel", "ergaenzung"];

	function avesmapsGaretienKollidiert(objekt) {
		return AVESMAPS_GARETIEN_KOLLISION_URTEILE.indexOf(String((objekt || {}).urteil || "")) !== -1;
	}
```

Im Zeichner: für jedes kollidierende Objekt eine **zusätzliche** Ebene in der Schein-Pane, breiter
als der vorhandene Hof:

```js
	// Der zweite Hof. 🔴 AUSSEN um den ersten, deshalb breiter -- und deshalb ZUERST gezeichnet:
	// innerhalb einer Pane entscheidet die Einfuegereihenfolge, und der schmalere Hof muss oben
	// liegen, sonst deckt der rote ihn zu.
	var AVESMAPS_GARETIEN_KOLLISION_BREITE = 21;
	var AVESMAPS_GARETIEN_KOLLISION_DECKKRAFT = 0.45;
```

- [ ] **Schritt 5: Tests fahren — beide**

```bash
node js/review/__tests__/garetien-sicht-tafel.test.js && node js/review/__tests__/garetien-karte.test.js
```

- [ ] **Schritt 6: Im Browser abnehmen — hell UND dunkel**

🔴 AGENTS.md §12: die Rangfolge muss in **beiden** Themen stimmen. Ein `widerspruch`-Objekt
anzeigen und prüfen, dass der rote Hof außen liegt und die goldene Form darin noch erkennbar ist.

- [ ] **Schritt 7: Testfeld, dann commit**

```bash
git add css/base/tokens.css js/review/review-garetien-karte.js js/review/__tests__/garetien-sicht-tafel.test.js
git commit -m "garetien(sicht): rotes Gluehen, wo bei uns etwas an derselben Stelle liegt"
```

⚠️ **In diesem Commit reist `--color-garetien-unsere` mit**, das seit dem 29.08.2026 ungetrackt im
Baum liegt (Übergabe §5). Vorher `git diff css/base/tokens.css` lesen und sicherstellen, dass nur
die zwei Garetien-Blöcke darin stehen — nichts Fremdes.

---

## Aufgabe 5: Der Fußknopf „Alle angezeigten einfügen (n von m)"

Entwurf §3.3. Der einzige Schreibweg — und er sagt die Wahrheit über sich.

**Dateien:**
- Ändern: `js/review/review-garetien-importer.js` (`garetienUebernahmeKnopfZustand`,
  `garetienUebernahmeKnopfSetzen`, der Sender)
- Ändern: `js/review/__tests__/garetien-anzeige-menge.test.js`
- Ändern: `js/review/__tests__/garetien-fussknopf-dom.test.js`

**Schnittstellen:**
- **Verbraucht:** `avesmapsGaretienAnzeigeListe()` aus Aufgabe 1

- [ ] **Schritt 1: Den scheiternden Test schreiben** (an `garetien-anzeige-menge.test.js` anhängen)

```js
// ---- 10. Der Fussknopf sagt EHRLICH, wie viele einen Vorschlag haben ---------------------------
//
// 🔴 7930 der 8213 Objekte haben keinen. Ein Knopf, der „244 einfuegen" verspricht und 37 einfuegt,
// ist eine Falschaussage ueber die naechste Handlung.
const stand = modul.garetienUebernahmeKnopfZustand([mitVorschlag, ohneVorschlag, ohneVorschlag]);
gleich(stand.beschriftung, "Alle angezeigten einfügen (1 von 3)",
	"1 von 3 -- nur `mitVorschlag` traegt ein Item");
gleich(stand.gesperrt, false, "mit mindestens einem Vorschlag ist der Knopf bedienbar");

const leer = modul.garetienUebernahmeKnopfZustand([ohneVorschlag]);
gleich(leer.gesperrt, true, "ohne einen einzigen Vorschlag ist nichts einzufuegen");
gleich(leer.hinweis !== "", true,
	"und der Grund steht SICHTBAR daneben, nie in einem `title` -- ein gesperrter Knopf bekommt "
	+ "in Chrome keine Zeigerereignisse und zeigt seinen `title` deshalb nie");

gleich(modul.garetienUebernahmeKnopfZustand([]).beschriftung,
	"Alle angezeigten einfügen (0 von 0)", "die leere Anzeige nennt zwei Nullen, keine Ausnahme");
```

- [ ] **Schritt 2: Test fahren, scheitert**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js
```

Erwartet: `AssertionError: 1 von 3 …` (die Funktion nimmt heute eine Zahl, keine Liste)

- [ ] **Schritt 3: Den Knopf umbauen**

```js
	/*
	 * REIN: was der Fussknopf sagt und ob er geht.
	 *
	 * 🔴 ER NIMMT DIE ANZEIGE-MENGE, NICHT MEHR EINE ZAHL (29.08.2026). „Nur angezeigte koennen
	 * uebernommen werden" (Owner) -- Anzeige ist die Vorstufe, nicht der Ersatz.
	 * 🔴 UND ER SAGT „n von m". Von 8213 Objekten haben 7930 keinen Vorschlag; sie duerfen
	 * angezeigt werden (das ist der ganze Sinn dieses Werkzeugs), aber eingefuegt werden kann nur,
	 * was ein Item hat. Ein Knopf, der „244 einfuegen" verspricht und 37 einfuegt, ist eine
	 * Falschaussage ueber die naechste Handlung.
	 * ⚠️ Der Grund fuer „gesperrt" steht SICHTBAR daneben, nie in einem `title`: ein deaktivierter
	 * Knopf bekommt keine Zeigerereignisse, sein `title` erscheint in Chrome also nie.
	 */
	function garetienUebernahmeKnopfZustand(angezeigte) {
		const liste = angezeigte || [];
		const mitVorschlag = liste.filter(function (o) {
			return o && Array.isArray(o.items) && o.items.length > 0;
		}).length;
		return {
			anzahl: mitVorschlag,
			gesamt: liste.length,
			beschriftung: "Alle angezeigten einfügen (" + mitVorschlag + " von " + liste.length + ")",
			gesperrt: mitVorschlag < 1,
			hinweis: mitVorschlag > 0
				? ""
				: (liste.length === 0
					? "Nichts angezeigt — leg links etwas auf die Karte."
					: "Keines der angezeigten Objekte hat einen Vorschlag — sie gehören zu Stufen, "
						+ "für die es noch keine Zuordnung gibt."),
		};
	}
```

`garetienUebernahmeKnopfSetzen` bekommt dieselbe Signatur (Liste statt Zahl); der einzige Aufrufer
in `avesmapsGaretienListeRendern` reicht `avesmapsGaretienAnzeigeListe()` herein.

Der Knopf selbst hakt beim Drücken die Items der angezeigten Objekte an (der Sender aus Aufgabe 2,
der dort stehengeblieben ist) und öffnet danach das vorhandene Übernahme-Blatt. 🔴 **Kein zweiter
Endpunkt, kein zweites Blatt** — Auftrag §5.

- [ ] **Schritt 4: Tests fahren — alle drei**

```bash
node js/review/__tests__/garetien-anzeige-menge.test.js && node js/review/__tests__/garetien-fussknopf-dom.test.js && node js/review/__tests__/garetien-uebernahme-blatt.test.js
```

- [ ] **Schritt 5: Im Browser abnehmen — der ABLAUF**

1. Anzeige leeren → Knopf: „Alle angezeigten einfügen (0 von 0)", gesperrt, Hinweis sichtbar.
2. Ein Objekt **ohne** Vorschlag anzeigen → „(0 von 1)", gesperrt, Hinweis nennt den Grund.
3. Ein Objekt **mit** Vorschlag dazu → „(1 von 2)", bedienbar.
4. Drücken → das Übernahme-Blatt öffnet sich und zeigt genau die eine Zeile.

🔧 **Nicht abgenommen und ausdrücklich gemeldet:** was danach in der Datenbank steht. Der Ablauf
mit angemeldeter Sitzung ist nie gelaufen (Übergabe §8) — insbesondere ist ungeprüft, ob die
Quelle (CC BY-NC-SA 3.0, „VolkoV / garetien.de") am übernommenen Objekt wirklich dransteht.

- [ ] **Schritt 6: Testfeld, dann commit**

```bash
git add js/review/review-garetien-importer.js js/review/__tests__/garetien-anzeige-menge.test.js js/review/__tests__/garetien-fussknopf-dom.test.js
git commit -m "garetien(anzeigen): nur Angezeigtes wird eingefuegt -- und der Knopf sagt, wie viele es koennen"
```

---

## Das Testfeld — vor JEDEM Push, nach dem `git add`

💣 **Die Klammer um BEIDE Gruppen ist tragend.** Ohne sie bindet `-print0` nur an die zweite
Gruppe, der Lauf fährt 21 von über 300 Dateien und meldet „null rot".

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tr -dc '\0' | wc -c
```

⭐ Die Zahl gegen `.github/workflows/deploy-avesmaps-strato.yml` halten. Eine viel zu kleine Zahl
ist der einzige Unterschied zwischen diesem Fehler und einem grünen Feld.

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-js
```

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-php
```

💣 **KEIN `2>&1` auf die Ergebnisdatei** — `xargs`-Warnungen darin läsen sich als roter Test.
⚠️ Vorbestehend rot ist genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
⚠️ Bei einem **unerwarteten** Roten seriell nachfahren, bevor man ihn glaubt. Bei einem
unerwarteten **Grünen** ebenso: erst die Dateizahl nachzählen, dann glauben.

---

## Selbstprüfung gegen den Entwurf

| Entwurf | Aufgabe |
|---|---|
| §3 Anzeige-Menge client-seitig, hält das Objekt | 1 |
| §3.1 vier Reiter, „Anzeigen" filtert nicht | 1 |
| §3.2 Häkchen wird Marker, `vorgemerkt` fällt aus der Standleiter | 1 (Server) + 2 (Client) |
| §3.3 „Markierte anzeigen" · „Anzeige leeren" | 2 |
| §3.3 „Alle angezeigten einfügen (n von m)" · Anzeige startet leer | 5 · 1 |
| §4.1 Form/Farbe/Größe aus der Art · Ordnung · Neutral-Meldung | 3 |
| §4.2 gold / magenta / rot | 4 (rot) · **bereits gebaut** (gold/magenta) |
| §4.3 zwei Knöpfe | **bereits gebaut** |
| §4.4 Tooltip | **bereits gebaut** |

🔴 **Die drei mit „bereits gebaut" liegen am 29.08.2026 ungetrackt im Baum**, gebaut von einer
parallelen Sitzung. Vor Aufgabe 3 ist zu klären, ob sie committet sind — sonst kollidieren
Aufgabe 3 und 4 mit ihnen in denselben zwei Dateien (Übergabe §5: „Nicht parallel bauen").
