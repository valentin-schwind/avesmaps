// Der Reparatur-Knopf des Ausreisser-Reiters: "gehoert nicht zum Weg".
//
// 🔴 DIESER TEST EXISTIERT, WEIL DER LISTE IHR GEGENSTUECK FEHLTE. Sie kannte drei Verben --
// "Neu pruefen", "gehoert zum Weg", "wieder oeffnen" --, und alle drei sagen "Fehlalarm". Fuer einen
// ECHTEN Streuner gab es keinen einzigen Knopf: man konnte ihn ansehen, sich auf der Karte zeigen
// lassen und musste ihn dann von Hand im Wege-Editor suchen. Eine Liste, die nur ihre Fehltreffer
// abraeumen kann, sammelt genau die Faelle an, fuer die sie gebaut wurde.
//
// 💣 Gemessen: der Strand-Streuner der Eisenstrasse steht seit dem 23.07.2026 namentlich im Entwurf
// (docs/superpowers/specs/2026-07-23-wege-ausreisser-wiki-validierung-design.md, "344,2 Einheiten
// daneben", dort schon als der Bug-#39-Fall). Am 22.08.2026 lag er immer noch live -- ein
// siebenpunktiges Wegstueck bei Qinsay (y 108..111), waehrend die echte Eisenstrasse bei y 441..480
// liegt -- und kam als Discord #88 zurueck. Der Detektor hatte ihn die ganze Zeit gemeldet.
//
// ⭐ KEIN NEUES SERVER-VERB. `clear_assign` mit `single_segment` gibt es laengst, und sein Kommentar
// in api/_internal/wiki/paths.php nennt woertlich den "faelschlich zugewiesenen Zufahrts-Sporn".
// Der Knopf schliesst es an, statt "Zuweisung loesen" ein zweites Mal zu schreiben.
//
// 🔴 Geprueft wird die ECHTE Datei in einer vm-Sandbox (Hausform wie conflict-dublette-verben.test.js
// und wiki-assign-weg.test.js): der Knopf wird wirklich GEDRUECKT und die abgeschickten Ruempfe
// werden gelesen. Ein Test, der nur nachsieht, ob der Knopf dasteht, sagt nichts darueber, was er
// tut.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/ausreisser-loesen.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(ROOT, "js", "review", "review-path-sync.js"), "utf8");

let checks = 0;
const pruefe = (bedingung, text) => { assert.ok(bedingung, text); checks++; };

// ---- Sandbox ----------------------------------------------------------------------------------
// Nur so viel Umwelt, wie die Datei beim LADEN anfasst. Alles Weitere sind Funktionsaufrufe, die
// erst im Test fallen.
let klickHandler = null;
const gefragt = [];          // jeder window.confirm-Text, in seiner Reihenfolge
let confirmAntwort = () => true;
const anfragen = [];         // { body, phase: "start" | "ende" }

function textKnoten() {
	// pathSyncEscapeText geht ueber ein <div>: textContent rein, innerHTML raus.
	return {
		_text: "",
		set textContent(wert) { this._text = String(wert); },
		get textContent() { return this._text; },
		get innerHTML() {
			return this._text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		},
	};
}

// 💣 Eine Antwort-Attrappe traegt `text()`, nicht `json()`: review-path-sync.js liest den Rumpf
// seit 24.08.2026 als TEXT und wertet einen Wurf beim Lesen als abgerissene Verbindung (nur so
// ist ein Abbruch NACH den Kopfzeilen von kaputtem JSON zu unterscheiden). Eine Attrappe mit
// `json()` liess loadOutliers hier lautlos in den Transport-Zweig laufen -- die Liste kam leer
// zurueck, und der Test meldete den fehlenden Knopf statt der falschen Attrappe.
function antwort(objekt, status = 200) {
	const text = JSON.stringify(objekt);
	return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) };
}

const sandbox = {
	console, JSON, Math, Date, Number, String, Array, Object, Boolean, Map, Set, Promise,
	setTimeout, clearTimeout, RegExp, Error,
	// Der Ladekopf der Datei: diese fasst sie auf oberster Ebene an.
	SOURCE_FILTER_OPTIONS: [],
	attachFilterMenu() {},
	apiErrorMessage: (data, fallback) => (data && data.error && data.error.message) || fallback || "Fehler",
	showFeedbackToast() {},
	focusWayOnMap() {},
	focusPathOnMap() {},
	avesmapsListBalanceNumber: (n) => String(n),
	wikiSyncViewTabsHostFor: () => null,
	document: {
		createElement: () => textKnoten(),
		getElementById: () => null,
		querySelector: () => null,
		querySelectorAll: () => [],
		addEventListener(typ, fn) { if (typ === "click") { klickHandler = fn; } },
	},
	fetch(url, options) {
		if (!options || options.method !== "POST") {
			// Der Neu-Lade-Lauf nach der Reparatur.
			anfragen.push({ body: { get: String(url) }, phase: "ende" });
			return Promise.resolve(antwort({ ok: true, ways: [], resolved: [], scanned: 0, flagged: 0 }));
		}
		const body = JSON.parse(options.body);
		anfragen.push({ body, phase: "start" });
		// 💣 Absichtlich verzoegert aufgeloest: nur so laesst sich belegen, dass der zweite Ruf erst
		// NACH dem ersten losgeht (siehe Pruefung 5).
		return new Promise((fertig) => setTimeout(() => {
			anfragen.push({ body, phase: "ende" });
			fertig(antwort({ ok: true, dry_run: false, applied: 1, generic_name: "Weg-4711", segments_updated: [] }));
		}, 0));
	},
};
sandbox.window = { confirm: (text) => { gefragt.push(String(text)); return confirmAntwort(); } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(quelle, sandbox, { filename: "review-path-sync.js" });

pruefe(typeof sandbox.renderOutlierList === "function", "die echte renderOutlierList ist geladen");
pruefe(typeof klickHandler === "function", "der Klick-Zuhoerer der Datei ist eingefangen");

// ---- Fixture: der gemeldete Fall --------------------------------------------------------------
// Die Eisenstrasse, wie der Server sie am 22.08.2026 liefert: EIN Segment, 344,7 Einheiten vom
// Hauptklumpen, ohne Verlauf-Station. Daneben ein mehrdeutiger Weg -- dort zerfaellt die Strasse in
// zwei gleich grosse Haelften, und welche stimmt, weiss niemand.
const EISENSTRASSE = {
	wiki_key: "eisenstrasse",
	name: "Eisenstrasse",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Eisenstra%C3%9Fe",
	kind: "strasse",
	total: 21,
	main_size: 20,
	outlier_count: 1,
	max_distance: 344.7,
	ambiguous: false,
	has_course: true,
	detached: [{
		fingerprint: "fp-eisen",
		on_course: false,
		size: 1,
		distance: 344.7,
		segments: [{ public_id: "2369a47a-be76-4d4b-916d-47633e7c673a", source: "editor" }],
	}],
};
const MEHRDEUTIG = {
	wiki_key: "angra",
	name: "Angra",
	wiki_url: "",
	kind: "fluss",
	total: 4,
	main_size: 2,
	outlier_count: 2,
	max_distance: 160.5,
	ambiguous: true,
	has_course: true,
	detached: [{
		fingerprint: "fp-angra",
		on_course: false,
		size: 2,
		distance: 160.5,
		segments: [
			{ public_id: "e3f7cd72-0645-4a08-bc71-354887111401", source: "verlauf-sync" },
			{ public_id: "aaaaaaaa-0000-4000-8000-000000000001", source: "editor" },
		],
	}],
};

/** Wartet, bis die angestossene Arbeit samt Neu-Laden durch ist. */
async function fliessen(runden = 30) {
	for (let i = 0; i < runden; i += 1) {
		await new Promise((fertig) => setTimeout(fertig, 0));
	}
}

async function ladeListe(ways) {
	// loadOutliers() ueber den echten Weg fuettern: eigener fetch nur fuer diesen einen GET.
	const echterFetch = sandbox.fetch;
	sandbox.fetch = () => Promise.resolve(antwort({ ok: true, ways, resolved: [], scanned: 100, flagged: ways.length }));
	await sandbox.loadOutliers();
	sandbox.fetch = echterFetch;
	const liste = { innerHTML: "" };
	sandbox.renderOutlierList(liste);
	return liste.innerHTML;
}

/** Ein Klick-Ereignis, das `closest` so beantwortet, wie es der echte DOM taete. */
function ereignis(knopf) {
	const zeile = { dataset: { focusWay: "eisenstrasse" } };
	const ziel = {
		closest(selektor) {
			if (selektor === "button") { return knopf; }
			if (selektor === "a") { return null; }
			if (selektor === ".path-sync__normalize") { return null; }
			// Der Segment-Chip verlangt data-path-id -- der Reparatur-Knopf traegt keines.
			if (selektor === ".region-sync__cand[data-path-id]") { return knopf.dataset.pathId ? knopf : null; }
			if (selektor === "[data-focus-way]") { return zeile; }
			if (selektor === "[data-outlier-action]") { return knopf.dataset.outlierAction ? knopf : null; }
			if (selektor === "[data-outlier-approve]") { return knopf.dataset.outlierApprove ? knopf : null; }
			if (selektor === "[data-outlier-reopen]") { return knopf.dataset.outlierReopen ? knopf : null; }
			if (selektor === "[data-outlier-detach]") { return knopf.dataset.outlierDetach ? knopf : null; }
			return null;
		},
	};
	return { target: ziel, stopPropagation() {}, preventDefault() {} };
}

/**
 * Zieht den Reparatur-Knopf aus dem gebauten HTML und baut sein dataset nach.
 *
 * 🪤 ALLE data-Attribute, nicht eine Handauswahl. Die erste Fassung listete drei davon in einem
 * regulaeren Ausdruck auf und liess `data-ambiguous` weg -- der Knopf emittierte es, der Test sah
 * es nie, und die zweite Rueckfrage galt faelschlich als nicht gebaut. Ein Nachbau, der weniger
 * liest als die Wirklichkeit sendet, prueft den Nachbau.
 */
function knopfAusHtml(html) {
	const tag = /<button[^>]*data-outlier-detach[^>]*>/.exec(html);
	if (!tag) { return null; }
	const dataset = {};
	const attribut = /data-([a-z-]+)="([^"]*)"/g;
	let treffer = attribut.exec(tag[0]);
	while (treffer) {
		// data-way-name -> wayName, genau wie der echte DOM es tut.
		const name = treffer[1].replace(/-([a-z])/g, (_, buchstabe) => buchstabe.toUpperCase());
		dataset[name] = treffer[2];
		treffer = attribut.exec(tag[0]);
	}
	return { dataset };
}

(async () => {
	// ---- 1. Der Knopf steht in der Zeile, neben seinem Gegenstueck -----------------------------
	const html = await ladeListe([EISENSTRASSE]);
	pruefe(html.indexOf("gehoert zum Weg") >= 0 || html.indexOf("gehört zum Weg") >= 0,
		"das bestaetigende Verb steht weiterhin da");
	pruefe(html.indexOf("nicht zum Weg") >= 0,
		"der Reparatur-Knopf fehlt in der Ausreisser-Zeile -- ein echter Streuner hat sonst kein Verb");
	// ⚠️ §12: eine Zeilenhandlung ist nie die Haupthandlung. Weich/outline wie der Nachbar,
	// niemals `wiki-sync-panel__start` (das ist der gefuellte Knopf des Menuebands).
	const knopfHtml = /<button[^>]*data-outlier-detach[^>]*>/.exec(html);
	pruefe(knopfHtml && knopfHtml[0].indexOf("region-sync__cand") >= 0,
		"der Knopf ist weich/outline wie sein Nachbar: " + (knopfHtml ? knopfHtml[0] : "(kein Knopf)"));
	pruefe(knopfHtml && knopfHtml[0].indexOf("wiki-sync-panel__start") < 0,
		"und NICHT der gefuellte Knopf des Menuebands");

	const knopf = knopfAusHtml(html);
	pruefe(knopf !== null, "der Knopf traegt seine Kennung, seine Segmente und den Wegnamen");
	pruefe(knopf.dataset.outlierDetach === "eisenstrasse" && knopf.dataset.wayName === "Eisenstrasse",
		"Weg-Kennung und Wegname reisen mit: " + JSON.stringify(knopf.dataset));
	pruefe(knopf.dataset.segments === "2369a47a-be76-4d4b-916d-47633e7c673a",
		"die Segment-Kennung reist am Knopf mit: " + knopf.dataset.segments);
	// ⚠️ Die Reichweite steht IM Knopf, nicht erst im Dialog: data-segments nennt genau den einen
	// Klumpen -- nie alle 21 Segmente der Eisenstrasse.
	pruefe(knopf.dataset.segments.split(",").length === 1,
		"der Knopf meint EINEN Klumpen, nicht den ganzen Weg: " + knopf.dataset.segments);
	pruefe(knopf.dataset.ambiguous === "", "ein eindeutiger Weg ist nicht als mehrdeutig markiert");

	// ---- 2. Er FRAGT, bevor er schreibt -- und ein Nein schreibt NICHTS ------------------------
	gefragt.length = 0; anfragen.length = 0;
	confirmAntwort = () => false;
	klickHandler(ereignis(knopf));
	await fliessen();
	pruefe(gefragt.length === 1, "genau eine Rueckfrage bei einem eindeutigen Fall, nicht null: " + gefragt.length);
	pruefe(/Eisenstrasse/.test(gefragt[0]), "die Rueckfrage nennt den Weg: " + gefragt[0]);
	pruefe(anfragen.length === 0,
		"🔴 ABGEBROCHEN IST ABGELEHNT: nach einem Nein darf KEINE Anfrage rausgehen, sonst loest der "
		+ "Knopf die Zuweisung hinter dem Ruecken des Editors");

	// ---- 3. Bestaetigt: genau ein clear_assign je Segment, chirurgisch --------------------------
	gefragt.length = 0; anfragen.length = 0;
	confirmAntwort = () => true;
	klickHandler(ereignis(knopf));
	await fliessen();
	const posts = anfragen.filter((a) => a.phase === "start" && a.body.action);
	pruefe(posts.length === 1, "ein Segment, eine Anfrage: " + posts.length);
	const rumpf = posts[0].body;
	pruefe(rumpf.action === "clear_assign",
		"⭐ kein neues Verb -- der Knopf ruft das vorhandene clear_assign: " + rumpf.action);
	pruefe(rumpf.public_id === "2369a47a-be76-4d4b-916d-47633e7c673a", "und zwar fuer das Streuner-Segment");
	pruefe(rumpf.single_segment === true,
		"💣 single_segment MUSS true sein -- ohne es raeumt clear_assign den GANZEN Weg ab, also alle "
		+ "21 Segmente der Eisenstrasse statt des einen Streuners");
	pruefe(rumpf.dry_run === false && rumpf.confirm === "apply",
		"und es ist ein echter Schreibvorgang, keine Vorschau");

	// ---- 4. Danach laedt die Liste neu -----------------------------------------------------------
	pruefe(anfragen.some((a) => a.body.get && /action=outliers/.test(a.body.get)),
		"nach der Reparatur wird die Liste neu geholt -- sonst bleibt der erledigte Fall stehen");

	// ---- 5. Mehrere Segmente: NACHEINANDER, nicht gleichzeitig -----------------------------------
	// 💣 clear_assign vergibt dem geloesten Segment einen neuen generischen Namen und liest dafuer den
	// Namensvorrat frisch aus der Datenbank. Zwei gleichzeitige Rufe lesen denselben Vorrat und
	// vergeben denselben Namen. Die Reihenfolge ist hier also Korrektheit, nicht Hoeflichkeit.
	const html2 = await ladeListe([MEHRDEUTIG]);
	const knopf2 = knopfAusHtml(html2);
	pruefe(knopf2 !== null, "auch der mehrdeutige Weg bietet den Knopf an");
	gefragt.length = 0; anfragen.length = 0;
	klickHandler(ereignis(knopf2));
	await fliessen();
	const folge = anfragen.filter((a) => a.body.action).map((a) => a.phase);
	pruefe(folge.length === 4, "zwei Segmente, zwei Rufe mit Start und Ende: " + JSON.stringify(folge));
	pruefe(folge[0] === "start" && folge[1] === "ende" && folge[2] === "start",
		"der zweite Ruf startet erst, wenn der erste fertig ist: " + JSON.stringify(folge));

	// ---- 6. Der mehrdeutige Fall fragt ZWEIMAL ---------------------------------------------------
	// 🔴 Bei `ambiguous` sind beide Haelften gleich gross, und welche "die Strasse" ist, entscheidet
	// niemand -- der Server haelt sich dort ausdruecklich zurueck. Wer hier die falsche Haelfte loest,
	// nimmt dem Weg seine echte Strecke. Dieselbe Vorsicht wie bei der Dublette mit Hoehe (63b0b35b).
	pruefe(gefragt.length === 2,
		"ein mehrdeutiger Weg fragt zweimal, ein eindeutiger einmal: " + gefragt.length);
	pruefe(/gleich gro|mehrdeutig/i.test(gefragt.join(" ")),
		"und die zweite Frage sagt WARUM sie kommt: " + JSON.stringify(gefragt));

	console.log("ausreisser-loesen.test.js: " + checks + " Zusicherungen erfuellt.");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
