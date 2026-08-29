// Aufgabe 5 des Garetien Importers -- die DOM-Haelfte des Fussknopfs
// „Alle angezeigten einfügen (n von m)".
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.4
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3.3
// Brief:   .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-5-brief.md
// Nachtrag: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-5-nachtrag.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-fussknopf-dom.test.js
//
// 🔴 WARUM ES DIESE DATEI GIBT. garetien-anzeige-menge.test.js prueft die REINEN Haelften (den
// neuen Zustand, die Haeppchen-Regel, den Sender-Ablauf mit einem Spion) -- und wuerde FUENF
// Mutationen der DOM-Haelfte gruen durchlassen: der Knopf wird nie gesperrt, traegt keine Zahl,
// der Grund bleibt verborgen, der Aufruf aus dem Listenlauf fehlt, die Klick-Verdrahtung fehlt.
// Die teuerste ist die vierte: ohne den Aufruf aus avesmapsGaretienListeRendern bleibt der Knopf
// FUER IMMER bei „(0 von 0)" gesperrt -- das Merkmal ist tot und das Feld gruen.
// ⭐ Gemessen wird am ERGEBNIS in einem gefaelschten `document`, nicht an einer Zeile im
// Quelltext. Das Vorbild steht nebenan: js/review/__tests__/garetien-karte.test.js.
// 💣 `hasDocument` wird beim LADEN ausgewertet (`typeof document !== "undefined"`), das
// `document` muss also VOR dem `require` stehen. Danach ist es zu spaet, und die Datei laeuft
// still in ihren Node-Zweig.
//
// 🔴 SEIT AUFGABE 5 NIMMT DER KNOPF DIE ANZEIGE-LISTE, KEINE ZAHL MEHR. Und sein Klick sendet
// jetzt wirklich (haengt die Items der angezeigten Objekte an), bevor er das Blatt oeffnet --
// deshalb braucht Abschnitt D dieser Datei ein gefaelschtes `fetch`, wo vorher keins noetig war.

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
function tief(ist, soll, warum) {
	assert.deepStrictEqual(ist, soll, warum || "");
	checks++;
}

// Einen Umlauf des Microtask-Warteschlange abwarten -- `setImmediate` ist ein MAKROtask und laeuft
// erst, nachdem JEDE davor angestossene Microtask (jede `.then`-Kette, egal wie tief) fertig ist.
// Fuer die Haeppchen-Kette dieser Datei (kein echter Timer darin) reicht das GENAU EINMAL.
function tick() {
	return new Promise(function (resolve) { setImmediate(resolve); });
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
const {
	garetienUebernahmeKnopfSetzen,
	avesmapsGaretienListeRendern,
	avesmapsGaretienAnzeigeLeeren,
	avesmapsGaretienAnzeigeHinzufuegen,
	avesmapsGaretienAnzeigeListe,
} = mod;

const KNOPF = ELEMENTE["garetien-apply"];
const HINWEIS = ELEMENTE["garetien-apply-hint"];

wahr(typeof garetienUebernahmeKnopfSetzen === "function",
	"garetienUebernahmeKnopfSetzen fehlt im Export");
wahr(typeof avesmapsGaretienListeRendern === "function",
	"avesmapsGaretienListeRendern fehlt im Export");

// ---- Die Fixture --------------------------------------------------------------------------------
//
// Zwei Objekte MIT Vorschlag -- eines offen, eines schon vollstaendig angehakt (fuer den
// netzfreien Klick-Test in Abschnitt D) -- und zwei ohne.
const mitVorschlagOffen = { key: "ggp:Gewaesser:1", items: [{ id: 501, selected: 0 }] };
const mitVorschlagVoll  = { key: "ggp:Gewaesser:2", items: [{ id: 502, selected: 1 }] };
const ohneVorschlag     = { key: "ggp:Berge:7", items: [] };
const ohneVorschlag2    = { key: "ggp:Berge:8", items: [] };

// =================================================================================================
// A. Der Knopf sagt „n von m" und ist offen, solange mindestens EIN Vorschlag angezeigt wird
// =================================================================================================

const stand3 = garetienUebernahmeKnopfSetzen([mitVorschlagOffen, ohneVorschlag, ohneVorschlag2]);
gleich(KNOPF.textContent, "Alle angezeigten einfügen (1 von 3)",
	"💣 der Knopf traegt „n von m\" -- nicht mehr nur EINE Zahl -- nur `mitVorschlagOffen` traegt "
	+ "ein Item, die zwei anderen sind angezeigt, aber nicht einfuegbar");
gleich(KNOPF.disabled, false, "und er ist offen, weil n >= 1");
gleich(HINWEIS.textContent, "", "der Grund steht nur da, wenn es einen gibt");
gleich(HINWEIS.hidden, true,
	"und er ist verborgen -- ein immer sichtbarer Hinweis waere Zierrat statt einer Antwort");
gleich(stand3 && stand3.anzahl, 1, "die DOM-Haelfte gibt den Stand zurueck, den sie gesetzt hat");
gleich(stand3 && stand3.gesamt, 3, "…samt der Gesamtzahl der Anzeige, nicht nur der einfuegbaren");

// =================================================================================================
// B. Angezeigt, aber KEIN einziger Vorschlag darunter: gesperrt UND der Grund steht sichtbar daneben
// =================================================================================================

garetienUebernahmeKnopfSetzen([ohneVorschlag]);
gleich(KNOPF.textContent, "Alle angezeigten einfügen (0 von 1)",
	"ein angezeigtes Objekt ohne Vorschlag zaehlt bei m mit, nie bei n");
gleich(KNOPF.disabled, true,
	"🔴 kein Vorschlag unter den Angezeigten ⇒ gesperrt. Das Blatt haette dort nichts zu zeigen.");
gleich(HINWEIS.hidden, false,
	"⚠️ und der Grund wird SICHTBAR. In einem `title` erschiene er nie: ein deaktivierter Knopf "
	+ "bekommt keine Zeigerereignisse.");
wahr(HINWEIS.textContent.indexOf("Keines der angezeigten") === 0,
	"…und der Grund nennt, DASS angezeigte Objekte da sind, nur eben ohne Vorschlag");

// Die leere Anzeige ist ein ANDERER Grund als „angezeigt, aber ohne Vorschlag" -- beide Saetze
// muessen auseinanderfallen, sonst verwechselt ein Editor „nichts hingelegt" mit „nichts davon
// einfuegbar".
garetienUebernahmeKnopfSetzen([]);
gleich(KNOPF.textContent, "Alle angezeigten einfügen (0 von 0)", "die leere Anzeige nennt zwei Nullen");
gleich(HINWEIS.textContent, "Nichts angezeigt — leg links etwas auf die Karte.",
	"…mit einem ANDEREN Hinweistext als der Fall „angezeigt, aber ohne Vorschlag\" oben");

// =================================================================================================
// C. Der Knopf folgt dem LISTENLAUF -- und zwar der ANZEIGE-MENGE, nicht mehr `angehakt`
// =================================================================================================
//
// 🔴 Ohne den Aufruf in avesmapsGaretienListeRendern bleibt der Knopf fuer immer auf dem Stand,
// den ihn zuletzt jemand von Hand gesetzt hat -- also bei „(0 von 0)" und gesperrt. Das Merkmal
// waere tot, und keine Zusicherung des uebrigen Feldes wuerde es merken.
// ⭐ Gemessen als DIFFERENZ: der Knopf steht durch Abschnitt B nachweislich auf „(0 von 0)"/
// gesperrt, und der Listenlauf muss ihn davon wegbewegen -- OHNE dass die Antwort selbst
// irgendetwas ueber `angehakt` sagt (Aufgabe 5 hat diese Quelle ERSETZT, nicht ergaenzt).

gleich(KNOPF.textContent, "Alle angezeigten einfügen (0 von 0)",
	"die Gegenprobe zum Ausgangspunkt: der Knopf steht wirklich auf (0 von 0), bevor die Liste laeuft");

avesmapsGaretienAnzeigeLeeren();
avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagOffen, ohneVorschlag]);
avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
gleich(KNOPF.textContent, "Alle angezeigten einfügen (1 von 2)",
	"💣 der Listenlauf liest jetzt die ANZEIGE-MENGE -- 1 von 2, obwohl die Antwort selbst gar "
	+ "keine `angehakt`-Angabe traegt");
gleich(KNOPF.disabled, false, "und macht ihn auf");

// Die Gegenprobe: der Listenlauf faehrt den Knopf auch wieder ZU, sobald die Anzeige wieder leer
// ist. Ohne sie kann die Zusicherung darueber von einem Knopf erfuellt werden, der nur einmal
// aufgeht und nie mehr zu.
avesmapsGaretienAnzeigeLeeren();
avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
gleich(KNOPF.textContent, "Alle angezeigten einfügen (0 von 0)", "und beim naechsten Lauf wieder zurueck");
gleich(KNOPF.disabled, true, "samt Sperre");
gleich(HINWEIS.hidden, false, "und samt Grund");

// 🔴 UND `angehakt` IN DER ANTWORT WIRD NICHT MEHR GELESEN -- selbst ein Angebot von 99 angehakten
// Items aendert nichts, wenn die Anzeige leer ist. Vor Aufgabe 5 war GENAU DAS die Quelle des
// Knopfs; wer sie stehen liesse, haette zwei Zaehler, die auseinanderlaufen koennen.
avesmapsGaretienListeRendern({
	ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {},
	angehakt: { new: 99, changed: 1 },
});
gleich(KNOPF.textContent, "Alle angezeigten einfügen (0 von 0)",
	"`angehakt` aus der Antwort ist tot -- der Fussknopf zaehlt die ANZEIGE, und die ist hier leer");
gleich(KNOPF.disabled, true, "…und bleibt deshalb gesperrt");

// =================================================================================================
// D. Die Klick-Verdrahtung -- der Knopf sendet ZUERST, dann oeffnet er
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

async function pruefeKlickVerdrahtung() {
	// D1: Erst im GESPERRTEN Zustand (den Abschnitt C hinterlassen hat): es darf nichts geschehen.
	KNOPF.klick();
	await tick();
	gleich(gesehen.length, 0,
		"⚠️ ein Klick auf den gesperrten Knopf oeffnet nichts -- `disabled` ist die Anzeige, der "
		+ "Riegel steht noch einmal im Zuhoerer");

	// D2: Offen, aber mit einem Objekt, dessen einziges Item schon VOLLSTAENDIG angehakt ist --
	// nichts zu senden. Dieser Fall bleibt bewusst OHNE `fetch`: er beweist, dass „nichts zu tun"
	// keinen Netzruf braucht und das Blatt trotzdem aufgeht.
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagVoll]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
	gleich(KNOPF.disabled, false, "die Anzeige traegt jetzt einen Vorschlag -- offen");

	const echtesFetchD2 = global.fetch;
	global.fetch = function () { throw new Error("D2 darf KEIN fetch ausloesen -- nichts ist offen"); };
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD2;

	gleich(gesehen.length, 1,
		"der offene Knopf oeffnet das Blatt -- auch ohne etwas zu senden, denn das einzige Item "
		+ "war schon angehakt");
	gleich(gesehen[0].kind, "garetien", "mit der `kind`-Kennung dieses Imports");
	gleich(gesehen[0].mount, ELEMENTE["garetien-sheet"],
		"⚠️ und mit dem Wirt #garetien-sheet -- er liegt in index.html AUSSERHALB von .gi-win, das "
		+ "`overflow: hidden` traegt");
	wahr(typeof gesehen[0].post === "function", "samt dem beschneidenden Sender");
	wahr(typeof gesehen[0].onApplied === "function" && typeof gesehen[0].onClose === "function",
		"und den zwei Rueckrufen, die die Arbeitsliste nachholen");

	// D3: Offen, mit einem WIRKLICH offenen Vorschlag -- jetzt MUSS gesendet werden, BEVOR das
	// Blatt aufgeht. Ein gefaelschtes `fetch` steht fuer den Sender aus Aufgabe 2
	// (avesmapsGaretienHandlungSenden), der wirklich POSTet und danach die Liste neu holt.
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
	gleich(KNOPF.disabled, false, "…und wieder offen, jetzt mit einem UNGEHAKTEN Vorschlag");

	const angefragt = [];
	const echtesFetchD3 = global.fetch;
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		angefragt.push({ pfad: String(pfad), rumpf: rumpf });
		return Promise.resolve({
			json: () => Promise.resolve({
				ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {},
			}),
		});
	};
	const vorGesehen = gesehen.length;
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD3;

	gleich(angefragt.length, 2,
		"💣 ZWEI Anfragen -- ERST der `select`-Ruf (das Anhaken), DANN der Listenlauf, den "
		+ "avesmapsGaretienHandlungSenden danach ohnehin ausloest");
	gleich(angefragt[0].pfad, "/api/edit/wiki/sync-plan.php", "die schreibende Adresse zuerst");
	gleich(angefragt[0].rumpf.action, "select", "…mit der Aktion, die der Server erwartet");
	gleich(angefragt[0].rumpf.kind, "garetien", "…und der kind-Kennung dieses Imports");
	tief(angefragt[0].rumpf.ids, [501], "…mit genau der id des offenen Items");
	gleich(angefragt[0].rumpf.selected, true, "der Fussknopf HAENGT AN, er toggelt nie ab");
	gleich(angefragt[1].pfad, "/api/edit/map/garetien-import.php",
		"die lesende Adresse danach -- der EINE Weg hinaus fuer jede Handlung (avesmapsGaretienHandlungSenden)");
	gleich(angefragt[1].rumpf.action, "liste", "…die Arbeitsliste wird neu geholt");
	gleich(gesehen.length, vorGesehen + 1, "und erst NACH beidem geht das Blatt auf");

	// D4: Fehlt das geteilte Blatt, wird nichts erfunden -- der Fehler steht in der Liste. Wieder
	// im netzfreien D2-Fall (nichts zu senden), damit dieser Test keinen `fetch` braucht.
	delete global.window.openSyncPlanSheet;
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagVoll]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
	const vorherD4 = gesehen.length;
	KNOPF.klick();
	await tick();
	gleich(gesehen.length, vorherD4,
		"ohne js/review/sync-plan-sheet.js oeffnet sich keine Ersatzfassung -- das waere genau die "
		+ "zweite Uebernahme-Vorschau, die dieses Vorhaben nicht bauen darf");
}

pruefeKlickVerdrahtung().then(function () {
	console.log(`garetien-fussknopf-dom ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
