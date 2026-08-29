// Aufgabe 16 des Garetien Importers -- die DOM-Haelfte des Fussknopfs „Angehakte uebernehmen".
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.4
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-16-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-fussknopf-dom.test.js
//
// 🔴 WARUM ES DIESE DATEI GIBT. garetien-uebernahme-blatt.test.js prueft die REINEN Haelften und
// den Sender -- und liess damit FUENF Mutationen der DOM-Haelfte gruen durch (Pruefung der
// Aufgabe 16): der Knopf wurde nie gesperrt, trug keine Zahl, der Grund blieb verborgen, der
// Aufruf aus dem Listenlauf fehlte, die Klick-Verdrahtung fehlte. Die teuerste ist die vierte:
// ohne den Aufruf aus avesmapsGaretienListeRendern bleibt der Knopf FUER IMMER bei „(0)"
// gesperrt -- das Merkmal ist tot und das Feld gruen.
// ⭐ Gemessen wird am ERGEBNIS in einem gefaelschten `document`, nicht an einer Zeile im
// Quelltext. Das Vorbild steht nebenan: js/review/__tests__/garetien-karte.test.js.
// 💣 `hasDocument` wird beim LADEN ausgewertet (`typeof document !== "undefined"`), das
// `document` muss also VOR dem `require` stehen. Danach ist es zu spaet, und die Datei laeuft
// still in ihren Node-Zweig.

"use strict";

const path = require("path");
const assert = require("assert");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

// ---- Das gefaelschte `document` ---------------------------------------------------------------
//
// ⚠️ Absichtlich MAGER: `getElementById` liefert nur die vier Elemente, um die es hier geht, und
// `null` fuer alles andere. Jede beruehrte Stelle des Listenlaufs ist gegen `null` abgesichert
// (`if (!el) { return; }`) -- ein volleres Dokument wuerde mehr Code mitfahren, ohne dass diese
// Datei etwas davon prueft.

function macheElement(id) {
	return {
		id: id,
		hidden: false,
		disabled: false,
		textContent: "",
		innerHTML: "",
		value: "",
		dataset: {},
		_hoerer: {},
		addEventListener(art, fn) {
			this._hoerer[art] = this._hoerer[art] || [];
			this._hoerer[art].push(fn);
		},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
		/** Einen echten Klick ausloesen -- so, wie ihn der Browser zustellt. */
		klick() {
			(this._hoerer.click || []).forEach((fn) => fn({ target: this }));
			return (this._hoerer.click || []).length;
		},
	};
}

const ELEMENTE = {};
["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-sheet"]
	.forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: {},
	// „complete" statt „loading": boot() laeuft damit schon beim `require`, und die Verdrahtung
	// steht, bevor die erste Zusicherung sie befragt.
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienUebernahmeKnopfSetzen, avesmapsGaretienListeRendern } = mod;

const KNOPF = ELEMENTE["garetien-apply"];
const HINWEIS = ELEMENTE["garetien-apply-hint"];

wahr(typeof garetienUebernahmeKnopfSetzen === "function",
	"garetienUebernahmeKnopfSetzen fehlt im Export");
wahr(typeof avesmapsGaretienListeRendern === "function",
	"avesmapsGaretienListeRendern fehlt im Export");

// =================================================================================================
// A. Der Knopf traegt die Zahl und ist offen, solange etwas angehakt ist
// =================================================================================================

const stand14 = garetienUebernahmeKnopfSetzen(14);
gleich(KNOPF.textContent, "Angehakte übernehmen (14)",
	"💣 der Knopf traegt die ZAHL. Ohne sie sieht ein Editor nicht, wie viele Zeilen das Blatt "
	+ "gleich zeigen wird -- und die Zahl ist das Einzige, was den gesperrten Zustand erklaert.");
gleich(KNOPF.disabled, false, "und er ist offen");
gleich(HINWEIS.textContent, "", "der Grund steht nur da, wenn es einen gibt");
gleich(HINWEIS.hidden, true,
	"und er ist verborgen -- ein immer sichtbarer Hinweis waere Zierrat statt einer Antwort");
gleich(stand14 && stand14.anzahl, 14, "die DOM-Haelfte gibt den Stand zurueck, den sie gesetzt hat");

// =================================================================================================
// B. Nichts angehakt: gesperrt UND der Grund steht sichtbar daneben
// =================================================================================================

garetienUebernahmeKnopfSetzen(0);
gleich(KNOPF.textContent, "Angehakte übernehmen (0)", "die Null steht auch da");
gleich(KNOPF.disabled, true,
	"🔴 nichts angehakt ⇒ gesperrt. Das echte Blatt haette dort nicht einmal einen "
	+ "Uebernehmen-Knopf -- ein Blatt mit null Zeilen ist eine Sackgasse.");
gleich(HINWEIS.hidden, false,
	"⚠️ und der Grund wird SICHTBAR. In einem `title` erschiene er nie: ein deaktivierter Knopf "
	+ "bekommt keine Zeigerereignisse.");
wahr(HINWEIS.textContent.length > 0, "… und er hat auch einen Text");

// =================================================================================================
// C. Der Knopf folgt dem LISTENLAUF -- die teuerste der fuenf Luecken
// =================================================================================================
//
// 🔴 Ohne den Aufruf in avesmapsGaretienListeRendern bleibt der Knopf fuer immer auf dem Stand,
// den ihn zuletzt jemand von Hand gesetzt hat -- also bei „(0)" und gesperrt. Das Merkmal waere
// tot, und keine Zusicherung des uebrigen Feldes wuerde es merken.
// ⭐ Gemessen als DIFFERENZ: der Knopf steht durch Abschnitt B nachweislich auf „(0)"/gesperrt,
// und der Listenlauf muss ihn davon wegbewegen.

gleich(KNOPF.textContent, "Angehakte übernehmen (0)",
	"die Gegenprobe zum Ausgangspunkt: der Knopf steht wirklich auf (0), bevor die Liste laeuft");

avesmapsGaretienListeRendern({
	ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {},
	angehakt: { new: 2, changed: 3 },
});
gleich(KNOPF.textContent, "Angehakte übernehmen (5)",
	"💣 der Listenlauf setzt den Knopf -- und zaehlt BEIDE Kategorien (2 neu + 3 geaendert). "
	+ "Zaehlt er nur eine, verspricht der Knopf weniger, als das Blatt gleich zeigt.");
gleich(KNOPF.disabled, false, "und macht ihn auf");

// Die Gegenprobe: der Listenlauf faehrt den Knopf auch wieder ZU. Ohne sie kann die Zusicherung
// darueber von einem Knopf erfuellt werden, der nur einmal aufgeht und nie mehr zu.
avesmapsGaretienListeRendern({
	ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {},
	angehakt: { new: 0, changed: 0 },
});
gleich(KNOPF.textContent, "Angehakte übernehmen (0)", "und beim naechsten Lauf wieder zurueck");
gleich(KNOPF.disabled, true, "samt Sperre");
gleich(HINWEIS.hidden, false, "und samt Grund");

// Eine Antwort OHNE `angehakt` faellt auf 0 -- die sichere Richtung: lieber ein gesperrter Knopf
// als einer, der eine Uebernahme verspricht, die niemand gezaehlt hat.
avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
gleich(KNOPF.disabled, true, "ohne `angehakt` in der Antwort bleibt der Knopf zu");

// =================================================================================================
// D. Die Klick-Verdrahtung -- gemessen an dem, was sie dem Blatt hereinreicht
// =================================================================================================
//
// 🔴 Sie steht in bindFenster und lief beim `require` (readyState „complete"). Ohne sie tut der
// Knopf nichts, und keine reine Funktion merkt es.

wahr((KNOPF._hoerer.click || []).length === 1,
	"💣 GENAU EIN Klick-Zuhoerer am Fussknopf. Zwei waeren die Doppelanmeldung aus AGENTS.md §11 "
	+ "(der erste oeffnet, der zweite schliesst im selben Klick) -- keiner heisst, der Knopf tut "
	+ "nichts.");

const gesehen = [];
global.window.openSyncPlanSheet = function (optionen) { gesehen.push(optionen); return "auf"; };

// Erst im GESPERRTEN Zustand (den Abschnitt C hinterlassen hat): es darf nichts geschehen.
KNOPF.klick();
gleich(gesehen.length, 0,
	"⚠️ ein Klick auf den gesperrten Knopf oeffnet nichts -- `disabled` ist die Anzeige, der "
	+ "Riegel steht noch einmal im Zuhoerer");

// Und jetzt offen.
garetienUebernahmeKnopfSetzen(3);
KNOPF.klick();
gleich(gesehen.length, 1, "der offene Knopf oeffnet das Blatt -- genau einmal");
gleich(gesehen[0].kind, "garetien", "mit der `kind`-Kennung dieses Imports");
gleich(gesehen[0].mount, ELEMENTE["garetien-sheet"],
	"⚠️ und mit dem Wirt #garetien-sheet -- er liegt in index.html AUSSERHALB von .gi-win, das "
	+ "`overflow: hidden` traegt");
wahr(typeof gesehen[0].post === "function", "samt dem beschneidenden Sender");
wahr(typeof gesehen[0].onApplied === "function" && typeof gesehen[0].onClose === "function",
	"und den zwei Rueckrufen, die die Arbeitsliste nachholen");

// 🔴 Fehlt das geteilte Blatt, wird nichts erfunden -- der Fehler steht in der Liste.
delete global.window.openSyncPlanSheet;
const vorher = gesehen.length;
KNOPF.klick();
gleich(gesehen.length, vorher,
	"ohne js/review/sync-plan-sheet.js oeffnet sich keine Ersatzfassung -- das waere genau die "
	+ "zweite Uebernahme-Vorschau, die dieses Vorhaben nicht bauen darf");

console.log(`garetien-fussknopf-dom ok -- ${checks} Zusicherungen`);
