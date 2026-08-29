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
// 🔴 Aufgabe 8: „garetien-list" kam dazu -- garetienListeFehlerZeigen schreibt DORTHIN (nicht in
// die Spalte „garetien-listcol" selbst), und ohne einen eigenen Eintrag faende die gefaelschte
// getElementById()-Weiche es nie, egal was die Spalte als String-innerHTML traegt.
["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-list", "garetien-sheet"]
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
	avesmapsGaretienAnzeigeHat,
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
// D. Aufgabe 8: der Fussknopf SCHREIBT WIRKLICH -- kein Blatt mehr, sondern select DANN apply
// =================================================================================================
//
// 🔴 Bis zum 29.08.2026 endete ein Klick nach dem Anhaken in `openSyncPlanSheet(...)`. Owner:
// „kommt eine neue seite, anstatt alle angezeigten einzufuegen" -- der Knopf fuegte nicht ein.
// Seither ruft er, ueber garetienFussknopfEinfuegenKlick, SELBST `select` und danach `apply`,
// bereinigt die Anzeige und holt die Liste einmal neu -- ohne je ein Blatt zu oeffnen.
//
// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-8-brief.md

wahr((KNOPF._hoerer.click || []).length === 1,
	"💣 GENAU EIN Klick-Zuhoerer am Fussknopf. Zwei waeren die Doppelanmeldung aus AGENTS.md §11 "
	+ "(der erste oeffnet, der zweite schliesst im selben Klick) -- keiner heisst, der Knopf tut "
	+ "nichts.");

const LISTE_EL = ELEMENTE["garetien-list"];

/** Ein gefaelschtes `fetch`, das jede Anfrage protokolliert und `antworten(pfad,rumpf)` befragt. */
function machFetch(antworten) {
	const angefragt = [];
	return {
		angefragt: angefragt,
		fn: function (pfad, optionen) {
			const rumpf = JSON.parse((optionen && optionen.body) || "{}");
			angefragt.push({ pfad: String(pfad), rumpf: rumpf });
			return Promise.resolve({ json: function () {
				return Promise.resolve(antworten(pfad, rumpf, angefragt.length));
			} });
		},
	};
}

/** Eine gewoehnliche, leere `liste`-Antwort -- genug, damit avesmapsGaretienListeRendern durchlaeuft. */
function listeAntwortLeer() {
	return { ok: true, plan_run_id: 4711, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} };
}

async function pruefeFussknopfSchreibtWirklich() {
	// D1: GESPERRT (der Zustand, den Abschnitt C hinterlassen hat) -- kein einziger Netzruf.
	const echtesFetchD1 = global.fetch;
	global.fetch = function () { throw new Error("D1 darf KEIN fetch ausloesen -- der Knopf ist gesperrt"); };
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD1;

	// D2: ein Objekt, dessen EINZIGES Item schon VOLLSTAENDIG angehakt ist. 🔴 DIE DIFFERENZ ZUM
	// ALTEN VERHALTEN: vorher loeste das GAR KEIN fetch aus (es oeffnete nur das Blatt). Jetzt MUSS
	// trotzdem `apply` gerufen werden -- sonst bliebe eine fruehere Vormerkung (z.B. aus einem
	// „Namen ersetzen"-Klick anderswo) fuer immer nur vorgemerkt und nie wirklich uebernommen.
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagVoll]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
	gleich(KNOPF.disabled, false, "die Anzeige traegt einen Vorschlag -- offen");

	const d2 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "apply") {
			return { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			return { ok: true, objekte: [Object.assign({}, mitVorschlagVoll, { stand: "uebernommen" })] };
		}
		return listeAntwortLeer();
	});
	const echtesFetchD2 = global.fetch;
	global.fetch = d2.fn;
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD2;

	tief(d2.angefragt.map(function (a) { return a.rumpf.action; }), ["apply", "liste", "liste"],
		"🔴 KEIN `select` (nichts ist NEU anzuhaken), aber `apply` geht trotzdem hinaus -- genau die "
		+ "Differenz zum alten Verhalten");
	gleich(d2.angefragt[0].pfad, "/api/edit/wiki/sync-plan.php", "…durch die eine Uebernahme-Tuer");
	gleich(d2.angefragt[1].rumpf.stand, "uebernommen",
		"…dann die gezielte Nachlese, WELCHE Objekte jetzt wirklich uebernommen sind");
	gleich(avesmapsGaretienAnzeigeHat(mitVorschlagVoll.key), false,
		"und das jetzt bestaetigt uebernommene Objekt hat die Anzeige verlassen");

	// D3: ein WIRKLICH offener Vorschlag -- select, DANN apply, DANN die zwei Lesevorgaenge.
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());
	gleich(KNOPF.disabled, false, "…und wieder offen, jetzt mit einem UNGEHAKTEN Vorschlag");

	const d3 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "apply") {
			return { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		}
		if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			return { ok: true, objekte: [Object.assign({}, mitVorschlagOffen, { stand: "uebernommen" })] };
		}
		return listeAntwortLeer();
	});
	const echtesFetchD3 = global.fetch;
	global.fetch = d3.fn;
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD3;

	tief(d3.angefragt.map(function (a) { return a.rumpf.action; }), ["select", "apply", "liste", "liste"],
		"💣 VIER Anfragen in dieser Reihenfolge: anhaken, WIRKLICH uebernehmen, die gezielte "
		+ "Nachlese, dann die gewoehnliche Listenaktualisierung");
	tief(d3.angefragt[0].rumpf.ids, [501], "…mit genau der id des offenen Items");
	gleich(d3.angefragt[0].rumpf.selected, true, "der Fussknopf HAENGT AN, er toggelt nie ab");
	gleich(d3.angefragt[1].rumpf.action, "apply",
		"🔴 die tragende Zusicherung dieser Aufgabe: NACH dem Anhaken kommt `apply`, nicht bloss "
		+ "eine weitere Vormerkung");
	gleich(d3.angefragt[3].rumpf.stand, "offen", "…und die Listenaktualisierung liest den aktiven Reiter");

	// D4: Ein Fehler MITTENDRIN (schon beim Anhaken) bricht ab, steht IN der Liste und entsperrt
	// den Knopf wieder -- er darf nie als Erfolg durchgehen (Brief).
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());

	const d4 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "select") { return { ok: false, error: { message: "dump_locked" } }; }
		throw new Error("D4 darf nach dem gescheiterten select NICHTS weiter senden");
	});
	const echtesFetchD4 = global.fetch;
	global.fetch = d4.fn;
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD4;

	gleich(d4.angefragt.length, 1, "🔴 ein Fehler mittendrin bricht die Kette ab -- kein `apply` danach");
	wahr(LISTE_EL.innerHTML.indexOf("dump_locked") !== -1,
		"und der Fehler steht IN der Liste -- er darf nie als Erfolg durchgehen");
	gleich(KNOPF.disabled, false, "…und der Knopf wird wieder freigegeben, nicht fuer immer gesperrt");

	// D5: WAEHREND ein Lauf laeuft, startet ein zweiter Klick KEINE zweite Sequenz. Der erste Klick
	// sperrt den Knopf SYNCHRON (noch bevor die erste Antwort da ist) -- der zweite Klick trifft
	// deshalb schon in der Verdrahtung auf `uebernehmenBtn.disabled` und ruft die Einfuege-Funktion
	// gar nicht erst auf.
	avesmapsGaretienAnzeigeLeeren();
	avesmapsGaretienAnzeigeHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienAnzeigeListe());

	const d5 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "apply") {
			return { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		}
		return listeAntwortLeer();
	});
	const echtesFetchD5 = global.fetch;
	global.fetch = d5.fn;

	KNOPF.klick();
	gleich(KNOPF.disabled, true,
		"🔴 der erste Klick sperrt den Knopf SYNCHRON -- noch bevor irgendeine Antwort da ist");
	KNOPF.klick();   // ein zweiter Klick, WAEHREND der erste noch laeuft
	await tick();
	await tick();
	global.fetch = echtesFetchD5;

	gleich(d5.angefragt.filter(function (a) { return a.rumpf.action === "select"; }).length, 1,
		"genau EIN `select` ueber die ganze Sequenz -- der zweite Klick hat keinen zweiten ausgeloest");
	gleich(d5.angefragt.filter(function (a) { return a.rumpf.action === "apply"; }).length, 1,
		"und genau EIN `apply` -- kein zweiter, parallel gestarteter Uebernahme-Lauf");
}

pruefeFussknopfSchreibtWirklich().then(function () {
	console.log(`garetien-fussknopf-dom ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
