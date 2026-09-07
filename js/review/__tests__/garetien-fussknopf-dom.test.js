// Aufgabe 5 des Garetien Importers -- die DOM-Haelfte des Fussknopfs
// „Stage importieren (n von m)".
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

// 🔴 Pruefrunde 06.09.2026, Befund 4: die Element-Fabrik ist NICHT mehr eine eigene Kopie -- sie
// kam mit Aufgabe 1 aus js/review/__tests__/helfer/garetien-testumgebung.js hinzu (dieselbe Form,
// jetzt samt `klick()`, das diese Datei braucht). Diese Datei baut ihr `global.document`/`ELEMENTE`
// weiterhin selbst (eigene IDs, eigenes `fetch`), aber die Element-Fabrik selbst ist geteilt.
const { macheElement } = require("./helfer/garetien-testumgebung.js");

const ELEMENTE = {};
// 🔴 Aufgabe 8: „garetien-list" kam dazu, weil garetienListeFehlerZeigen damals DORTHIN schrieb.
// Seit Aufgabe 1 (06.09.2026) tut sie das nicht mehr -- ein Fehler steht in der Statuszeile
// (garetien-status-text/-aktion), und genau deshalb bleibt „garetien-list" hier trotzdem stehen:
// D4 weiter unten prueft ausdruecklich, dass sie UNBERUEHRT bleibt.
["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-list", "garetien-sheet",
	"garetien-status-text", "garetien-status-aktion"]
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
	avesmapsGaretienStageLeeren,
	avesmapsGaretienStageHinzufuegen,
	avesmapsGaretienStageListe,
	avesmapsGaretienStageHat,
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
gleich(KNOPF.textContent, "Stage importieren (1 von 3)",
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
gleich(KNOPF.textContent, "Stage importieren (0 von 1)",
	"ein angezeigtes Objekt ohne Vorschlag zaehlt bei m mit, nie bei n");
gleich(KNOPF.disabled, true,
	"🔴 kein Vorschlag unter den Angezeigten ⇒ gesperrt. Das Blatt haette dort nichts zu zeigen.");
gleich(HINWEIS.hidden, false,
	"⚠️ und der Grund wird SICHTBAR. In einem `title` erschiene er nie: ein deaktivierter Knopf "
	+ "bekommt keine Zeigerereignisse.");
wahr(HINWEIS.textContent.indexOf("Keines der Objekte auf der Stage") === 0,
	"…und der Grund nennt, DASS Objekte auf der Stage liegen, nur eben ohne Vorschlag");

// Die leere Stage ist ein ANDERER Grund als „auf der Stage, aber ohne Vorschlag" -- beide Saetze
// muessen auseinanderfallen, sonst verwechselt ein Editor „nichts hingelegt" mit „nichts davon
// einfuegbar".
garetienUebernahmeKnopfSetzen([]);
gleich(KNOPF.textContent, "Stage importieren (0 von 0)", "die leere Stage nennt zwei Nullen");
gleich(HINWEIS.textContent, "Die Stage ist leer — leg links etwas darauf.",
	"…mit einem ANDEREN Hinweistext als der Fall „auf der Stage, aber ohne Vorschlag\" oben");

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

gleich(KNOPF.textContent, "Stage importieren (0 von 0)",
	"die Gegenprobe zum Ausgangspunkt: der Knopf steht wirklich auf (0 von 0), bevor die Liste laeuft");

avesmapsGaretienStageLeeren();
avesmapsGaretienStageHinzufuegen([mitVorschlagOffen, ohneVorschlag]);
avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
gleich(KNOPF.textContent, "Stage importieren (1 von 2)",
	"💣 der Listenlauf liest jetzt die ANZEIGE-MENGE -- 1 von 2, obwohl die Antwort selbst gar "
	+ "keine `angehakt`-Angabe traegt");
gleich(KNOPF.disabled, false, "und macht ihn auf");

// Die Gegenprobe: der Listenlauf faehrt den Knopf auch wieder ZU, sobald die Anzeige wieder leer
// ist. Ohne sie kann die Zusicherung darueber von einem Knopf erfuellt werden, der nur einmal
// aufgeht und nie mehr zu.
avesmapsGaretienStageLeeren();
avesmapsGaretienListeRendern({ ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} });
gleich(KNOPF.textContent, "Stage importieren (0 von 0)", "und beim naechsten Lauf wieder zurueck");
gleich(KNOPF.disabled, true, "samt Sperre");
gleich(HINWEIS.hidden, false, "und samt Grund");

// 🔴 UND `angehakt` IN DER ANTWORT WIRD NICHT MEHR GELESEN -- selbst ein Angebot von 99 angehakten
// Items aendert nichts, wenn die Anzeige leer ist. Vor Aufgabe 5 war GENAU DAS die Quelle des
// Knopfs; wer sie stehen liesse, haette zwei Zaehler, die auseinanderlaufen koennen.
avesmapsGaretienListeRendern({
	ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {},
	angehakt: { new: 99, changed: 1 },
});
gleich(KNOPF.textContent, "Stage importieren (0 von 0)",
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
	// D0: SCHADENSFALL 30.08.2026 (Owner: „Eine Warnung gabs nicht … hat unsere ganze karte
	// zerstört") -- die Rückfrage nennt die ECHTE Zahl, und OHNE Bestätigung passiert NICHTS.
	avesmapsGaretienStageLeeren();
	avesmapsGaretienStageHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());

	let letzterRueckfrageText = null;
	const echtesFetchD0 = global.fetch;
	global.window.confirm = function (text) { letzterRueckfrageText = text; return false; };
	global.fetch = function () { throw new Error("D0 darf OHNE Bestätigung KEIN fetch auslösen"); };
	KNOPF.klick();
	await tick();
	global.fetch = echtesFetchD0;

	wahr(letzterRueckfrageText !== null, "🔴 die Rückfrage wird tatsächlich gestellt");
	wahr(letzterRueckfrageText.indexOf("1 Objekt") !== -1,
		"…und nennt die ECHTE Zahl -- hier genau das eine angezeigte Objekt, keine Schätzung");
	gleich(KNOPF.disabled, false,
		"ein „Nein“ lässt den Knopf bedienbar -- der Riegel steht VOR `garetienEinfuegenLaeuft`");

	// Ab hier bestätigt `window.confirm` jeden weiteren Klick dieses Abschnitts -- die restlichen
	// D-Tests prüfen den Schreibweg SELBST, nicht die Rückfrage ein zweites Mal.
	global.window.confirm = function () { return true; };

	// Und die Anzeige geht zurück auf den Stand, den D1 erwartet ("(0 von 0)"/gesperrt) -- D0 hat
	// sie fürs Nennen der echten Zahl absichtlich gefüllt, D1 prüft den gesperrten Ausgangszustand.
	avesmapsGaretienStageLeeren();
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());

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
	avesmapsGaretienStageLeeren();
	avesmapsGaretienStageHinzufuegen([mitVorschlagVoll]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());
	gleich(KNOPF.disabled, false, "die Anzeige traegt einen Vorschlag -- offen");

	// 🔴 Aufgabe 6 (06.09.2026): der Nachlauf fragt seither per `keys` nach, nicht mehr per
	// `stand: "uebernommen"` -- und `keys` schlaegt serverseitig JEDEN Stand (garetien-liste.php,
	// avesmapsGaretienListeFilterHatKeys). 💣 DAS ÄNDERT DIE FOLGE: ein gefundenes Objekt bleibt
	// jetzt auf der Stage (nur seine Kopie wird aufgefrischt) -- „verlässt die Stage" gilt seit
	// dieser Aufgabe nur noch für Objekte, die im GELTENDEN LAUF gar nicht mehr existieren, nicht
	// mehr fürs blosse Erreichen von `stand: "uebernommen"`. Siehe
	// js/review/__tests__/garetien-stage-nachschlagen.test.js für die reine Regel.
	const d2 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "apply") {
			return { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		}
		if (rumpf.action === "liste" && Array.isArray(rumpf.keys)) {
			return {
				ok: true,
				objekte: [Object.assign({}, mitVorschlagVoll, {
					stand: "uebernommen",
					items: [{ id: 4001, change_type: "new", selected: 1 }],
				})],
			};
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
	tief(d2.angefragt[1].rumpf.keys, [mitVorschlagVoll.key],
		"…dann der Stage-Nachlauf: EIN Ruf mit `keys`, nicht mehr mit `stand: \"uebernommen\"\"");
	gleich(avesmapsGaretienStageHat(mitVorschlagVoll.key), true,
		"das Objekt bleibt auf der Stage -- `keys` findet es unabhängig von seinem Stand, und nur "
		+ "was im Lauf GAR NICHT mehr existiert, verlässt sie (Aufgabe 6)");
	gleich(avesmapsGaretienStageListe()[0].items[0].id, 4001,
		"und seine Item-Nummer ist die frische aus der Nachlese, nicht mehr die alte");

	// D3: ein WIRKLICH offener Vorschlag -- select, DANN apply, DANN die zwei Lesevorgaenge.
	avesmapsGaretienStageLeeren();
	avesmapsGaretienStageHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());
	gleich(KNOPF.disabled, false, "…und wieder offen, jetzt mit einem UNGEHAKTEN Vorschlag");

	// 🔴 Aufgabe 6: derselbe Nachlauf wie in D2 -- `keys`, kein `stand`.
	const d3 = machFetch(function (pfad, rumpf) {
		if (rumpf.action === "apply") {
			return { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		}
		if (rumpf.action === "liste" && Array.isArray(rumpf.keys)) {
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
		"💣 VIER Anfragen in dieser Reihenfolge: anhaken, WIRKLICH uebernehmen, der Stage-Nachlauf, "
		+ "dann die gewoehnliche Listenaktualisierung");
	tief(d3.angefragt[0].rumpf.ids, [501], "…mit genau der id des offenen Items");
	gleich(d3.angefragt[0].rumpf.selected, true, "der Fussknopf HAENGT AN, er toggelt nie ab");
	gleich(d3.angefragt[1].rumpf.action, "apply",
		"🔴 die tragende Zusicherung dieser Aufgabe: NACH dem Anhaken kommt `apply`, nicht bloss "
		+ "eine weitere Vormerkung");
	tief(d3.angefragt[2].rumpf.keys, [mitVorschlagOffen.key], "…der Stage-Nachlauf fragt gezielt nach");
	gleich(d3.angefragt[3].rumpf.stand, "offen", "…und die Listenaktualisierung liest den aktiven Reiter");

	// D4: Ein Fehler MITTENDRIN (schon beim Anhaken) bricht ab, entsperrt den Knopf wieder und
	// darf nie als Erfolg durchgehen (Brief). 🔴 SEIT AUFGABE 1 (06.09.2026) STEHT ER IN DER
	// STATUSZEILE, NICHT MEHR IN DER LISTE -- die bleibt unberuehrt stehen.
	avesmapsGaretienStageLeeren();
	avesmapsGaretienStageHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());
	LISTE_EL.innerHTML = "<div class='avm-row'>vorher unveraendert</div>";

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
	wahr(ELEMENTE["garetien-status-text"].textContent.indexOf("dump_locked") !== -1,
		"der Fehler steht in der Statuszeile -- er darf nie als Erfolg durchgehen");
	wahr(ELEMENTE["garetien-status-text"]._klassen.has("bad"), "und traegt den Ton bad");
	gleich(LISTE_EL.innerHTML, "<div class='avm-row'>vorher unveraendert</div>",
		"💣 die Liste bleibt UNBERUEHRT -- ein Fehler ersetzt sie nicht mehr (Aufgabe 1)");
	gleich(KNOPF.disabled, false, "…und der Knopf wird wieder freigegeben, nicht fuer immer gesperrt");

	// D5: WAEHREND ein Lauf laeuft, startet ein zweiter Klick KEINE zweite Sequenz. Der erste Klick
	// sperrt den Knopf SYNCHRON (noch bevor die erste Antwort da ist) -- der zweite Klick trifft
	// deshalb schon in der Verdrahtung auf `uebernehmenBtn.disabled` und ruft die Einfuege-Funktion
	// gar nicht erst auf.
	avesmapsGaretienStageLeeren();
	avesmapsGaretienStageHinzufuegen([mitVorschlagOffen]);
	garetienUebernahmeKnopfSetzen(avesmapsGaretienStageListe());

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
