// Die Art einer Quelle: niemand behauptet sie versehentlich, und eine Korrektur kommt an.
//
// 💣 DER BEFUND (Meldung #105, Nottel, 29.08.2026): „Die Auswahl des Typs einer Quellenangabe wird
// auf ‚Regionalspielhilfe' gestellt, unabhaengig von der Wahl des Benutzers." Zwei Ursachen, beide
// still:
//   1. Die Eingabezeile hatte KEINEN leeren Eintrag -- also stand die erste Art der Liste
//      vorausgewaehlt da, und die erste ist 'regionalspielhilfe'. Wer die Auswahl nie anfasste,
//      legte eine Behauptung an, die er nie getroffen hat.
//   2. Der Katalog-Upsert liess `source_type` einer BEKANNTEN Adresse unberuehrt. Jeder weitere
//      Versuch, die Art richtigzustellen, war damit ein Klick ins Leere -- ohne Fehler, ohne
//      Meldung, mit einer gueltigen Antwort.
// Live gemessen am selben Tag: Quelle 1322115 („Briefspiel Rommilyser Mark") stand als
// `regionalspielhilfe` im Katalog.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/quellen-art-korrigieren.test.js
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(REPO, "js", "review", "review-feature-sources.js"), "utf8");
// ⚠️ ZUERST, wie auf jeder der fuenf Seiten mit Quellen-Editor (AGENTS.md §11).
const geteilteMarkupQuelle = fs.readFileSync(
	path.join(REPO, "js", "ui", "feature-source-markup.js"), "utf8");

let pruefungen = 0;
const zaehl = () => { pruefungen += 1; };

function macheBehaelter() {
	const felder = {};
	for (const sel of [".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind",
		".fs-add-official", ".fs-add-pages", ".fs-add-license", ".fs-add-attribution"]) {
		felder[sel] = { value: "", checked: false, focus() {}, addEventListener() {} };
	}
	// Die Notizzeile und die Marke „bestehende Quelle" gehoeren dazu: an ihnen haengt, was der
	// Editor nach dem Klick zu sehen bekommt.
	const notiz = { textContent: "", hidden: true };
	felder["[data-fs-note]"] = notiz;
	felder["[data-fs-picked]"] = { hidden: true };
	felder[".fs-add-url"].value = "http://www.rommilyser-mark.de/index.php/81-herrschaft/137-baronie-rommilys";
	felder[".fs-add-label"].value = "Briefspiel Rommilyser Mark";
	return {
		innerHTML: "",
		notiz,
		felder,
		_klick: null,
		addEventListener(typ, fn) { if (typ === "click") { this._klick = fn; } },
		querySelector(sel) { return felder[sel] || null; },
	};
}

const KLICK_AUF_HINZUFUEGEN = { target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } };

// Baut den Kontext: echtes Modul, gefaelschtes Fenster, gefaelschter Server -- und eine
// gefaelschte Vorschlagsliste, deren onPick der Test selbst ausloest (die echte braucht ein DOM).
function macheKontext(antworten) {
	const gerufen = { koerper: [], pick: null };
	const context = {
		console,
		window: { __sourceCatalog: {}, __featureSourceRefs: {} },
		document: { querySelector: () => null },
		attachSourceAutocomplete: (_eingabe, opts) => {
			gerufen.pick = opts && opts.onPick;
			return () => {};
		},
		fetch: async (url, init) => {
			gerufen.koerper.push(JSON.parse(init.body));
			return { json: async () => antworten.shift() };
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(geteilteMarkupQuelle, context);
	vm.runInContext(quelle, context);
	context.__gerufen = gerufen;
	return context;
}

const ID = "9a1f0f7e-1111-2222-3333-444455556666";
const LEER = { ok: true, wiki_url: "", sources: [] };
const frisch = (objekt) => JSON.parse(JSON.stringify(objekt));

(async () => {
	// ---- 1. Das Markup: der leere Eintrag steht VORNE ----------------------------------------
	// 🔴 Nur der ERSTE Eintrag ist im Browser vorausgewaehlt. Ein leerer irgendwo in der Mitte
	// aenderte nichts an der Vorauswahl und damit nichts am Befund.
	const ctx0 = macheKontext([]);
	const markup = ctx0.renderFeatureSourceEditorHtml({ wiki_url: "", sources: [] }, {});
	const artFeld = markup.slice(markup.indexOf('<select class="fs-add-type">'));
	const artOptionen = artFeld.slice(0, artFeld.indexOf("</select>"));
	assert.ok(artOptionen.startsWith('<select class="fs-add-type"><option value="">'),
		"die Art-Auswahl muss mit einem LEEREN Eintrag beginnen -- sonst steht die erste Art "
		+ "('regionalspielhilfe') vorausgewaehlt da und wird zur Aussage, die niemand traf");
	zaehl();
	assert.ok(!/<option[^>]*selected/.test(artOptionen),
		"und keine Art traegt selected -- sonst gewinnt sie ueber die Reihenfolge");
	zaehl();
	assert.ok(artOptionen.indexOf('value="regionalspielhilfe"') > artOptionen.indexOf('<option value="">'),
		"die acht Arten stehen weiterhin zur Wahl, nur eben dahinter");
	zaehl();

	// ---- 2. Wer nichts waehlt, behauptet nichts ------------------------------------------------
	const ctx = macheKontext([frisch(LEER), frisch(LEER)]);
	const behaelter = macheBehaelter();
	await ctx.mountFeatureSourceEditor(behaelter, "settlement", () => ID, {});
	await behaelter._klick(KLICK_AUF_HINZUFUEGEN);
	const ohneWahl = ctx.__gerufen.koerper[ctx.__gerufen.koerper.length - 1];
	assert.strictEqual(ohneWahl.source_type, "",
		"eine unberuehrte Auswahl schickt '' -- der fruehere Rueckfall auf 'sonstiges' machte aus "
		+ "dem Nichtstun eine Aussage");
	zaehl();
	assert.strictEqual(ohneWahl.source_type_chosen, false,
		"und sagt ausdruecklich, dass niemand gewaehlt hat -- daran haengt serverseitig, ob eine "
		+ "bestehende Katalogzeile umgeschrieben werden darf");
	zaehl();

	// ---- 3. Eine ausdrueckliche Wahl reist mit ------------------------------------------------
	const ctx2 = macheKontext([frisch(LEER), frisch(LEER)]);
	const behaelter2 = macheBehaelter();
	await ctx2.mountFeatureSourceEditor(behaelter2, "settlement", () => ID, {});
	behaelter2.felder[".fs-add-type"].value = "briefspiel";
	await behaelter2._klick(KLICK_AUF_HINZUFUEGEN);
	const mitWahl = ctx2.__gerufen.koerper[ctx2.__gerufen.koerper.length - 1];
	assert.strictEqual(mitWahl.source_type, "briefspiel");
	zaehl();
	assert.strictEqual(mitWahl.source_type_chosen, true,
		"nur eine ausdrueckliche Wahl darf die Art einer bekannten Quelle richtigstellen");
	zaehl();

	// ---- 4. Die ZWEITE Tuer: ein Treffer aus der Vorschlagsliste ------------------------------
	// 💣 Wer den Titel tippt und den Treffer waehlt, geht durch 'add_existing'. Ohne die Wahl in
	// diesem Rumpf bliebe der Befund fuer genau diesen Weg bestehen -- eine Regel, die einen von
	// zwei Erzeugern bindet, ist keine Regel (AGENTS.md §11).
	const ctx3 = macheKontext([frisch(LEER), frisch(LEER)]);
	const behaelter3 = macheBehaelter();
	await ctx3.mountFeatureSourceEditor(behaelter3, "settlement", () => ID, {});
	ctx3.__gerufen.pick({
		source_id: 1322115,
		label: "Briefspiel Rommilyser Mark",
		url: "http://www.rommilyser-mark.de/index.php/81-herrschaft/137-baronie-rommilys",
		type: "regionalspielhilfe",
	});
	behaelter3.felder[".fs-add-type"].value = "briefspiel";
	await behaelter3._klick(KLICK_AUF_HINZUFUEGEN);
	const gewaehlt = ctx3.__gerufen.koerper[ctx3.__gerufen.koerper.length - 1];
	assert.strictEqual(gewaehlt.action, "add_existing");
	zaehl();
	assert.strictEqual(gewaehlt.source_id, 1322115);
	zaehl();
	assert.strictEqual(gewaehlt.source_type, "briefspiel");
	zaehl();
	assert.strictEqual(gewaehlt.source_type_chosen, true,
		"auch der Weg ueber die Vorschlagsliste nimmt die Richtigstellung mit");
	zaehl();

	// ---- 5. Die Korrektur wird BENANNT ---------------------------------------------------------
	// Eine Aenderung an einer katalogweit geteilten Zeile still zu tun waere dieselbe Falle wie
	// die stille Nicht-Aenderung davor, nur in die andere Richtung.
	const ctx4 = macheKontext([frisch(LEER), Object.assign(frisch(LEER), {
		retyped: { source_id: 1322115, from: "regionalspielhilfe", to: "briefspiel", label: "Briefspiel Rommilyser Mark" },
	})]);
	const behaelter4 = macheBehaelter();
	await ctx4.mountFeatureSourceEditor(behaelter4, "settlement", () => ID, {});
	behaelter4.felder[".fs-add-type"].value = "briefspiel";
	await behaelter4._klick(KLICK_AUF_HINZUFUEGEN);
	assert.strictEqual(behaelter4.notiz.hidden, false, "die Meldung muss sichtbar werden");
	zaehl();
	assert.ok(behaelter4.notiz.textContent.includes("Regionalspielhilfe")
		&& behaelter4.notiz.textContent.includes("Briefspiel")
		&& behaelter4.notiz.textContent.includes("Briefspiel Rommilyser Mark"),
		"sie nennt die Quelle, die alte und die neue Art -- gelesen wird der ANZEIGETEXT, nicht der "
		+ "Schluessel: " + behaelter4.notiz.textContent);
	zaehl();
	assert.ok(/berall/.test(behaelter4.notiz.textContent),
		"und sagt, dass die Aenderung ueberall gilt, wo die Quelle zitiert wird");
	zaehl();

	// ---- 6. Ohne Korrektur sagt die Zeile nichts UEBER DIE ART ---------------------------------
	// 🪟 UMGEDREHT am 03.09.2026 am Livelauf. Hier stand "bleibt die Zeile stumm" mit der
	// Begruendung "eine Meldung, die immer kommt, sagt nichts" -- und die galt der ART. Der Owner
	// hat das Schweigen des ERFOLGS beanstandet: Zeile angelegt, Formular geleert, und darueber
	// stand entweder nichts oder der blosse Verknuepfungssatz, der sich wie ein Einwand las.
	// 🔴 Die Regel bleibt also, nur enger: die Zeile bestaetigt IMMER, dass es geklappt hat,
	// und sagt NUR dann etwas ueber die Art, wenn der Katalog wirklich umgetypt wurde.
	const ctx5 = macheKontext([frisch(LEER), frisch(LEER)]);
	const behaelter5 = macheBehaelter();
	await ctx5.mountFeatureSourceEditor(behaelter5, "settlement", () => ID, {});
	behaelter5.felder[".fs-add-type"].value = "briefspiel";
	await behaelter5._klick(KLICK_AUF_HINZUFUEGEN);
	assert.strictEqual(behaelter5.notiz.hidden, false, "der Erfolg wird trotzdem bestaetigt");
	zaehl();
	assert.ok(/Hinzugef/.test(behaelter5.notiz.textContent),
		"und zwar als Erfolg: " + behaelter5.notiz.textContent);
	zaehl();
	assert.ok(!/ändert|berall/.test(behaelter5.notiz.textContent),
		"ohne 'retyped' in der Antwort darf kein Wort ueber die Art darin stehen: "
		+ behaelter5.notiz.textContent);
	zaehl();

	// ---- 7. Und BEIDE zusammen stehen in EINER Zeile -------------------------------------------
	// 💣 Der Fall, der den Umbau vom 03.09.2026 fast still gekostet haette: Erfolg und
	// Umtypung waren zwei Rufe hintereinander auf DIESELBE Notizzeile, der zweite gewann. Beide
	// Funktionen waren einzeln richtig, und jede Haelfte hatte ihren gruenen Test.
	const ctx6 = macheKontext([frisch(LEER), Object.assign(frisch(LEER), {
		retyped: { source_id: 1322115, from: "regionalspielhilfe", to: "briefspiel", label: "Briefspiel Rommilyser Mark" },
		linked: { source_id: 1322115, label: "Briefspiel Rommilyser Mark", typed_label: "" },
	})]);
	const behaelter6 = macheBehaelter();
	// ⚠️ DIESE Attrappe bekommt eine `classList`, die anderen bewusst nicht: an ihnen haengt der
	// Nachweis, dass ein Knoten OHNE sie den Meldungstext nicht mitreisst (der Riegel in
	// `showAddRowNote`, gefunden am 02.09.2026 durch einen fremden Test).
	const klassen = new Set();
	behaelter6.notiz.classList = {
		add: (...n) => n.forEach((x) => klassen.add(x)),
		remove: (...n) => n.forEach((x) => klassen.delete(x)),
	};
	await ctx6.mountFeatureSourceEditor(behaelter6, "settlement", () => ID, {});
	behaelter6.felder[".fs-add-type"].value = "briefspiel";
	await behaelter6._klick(KLICK_AUF_HINZUFUEGEN);
	const dreierlei = behaelter6.notiz.textContent;
	assert.ok(/Hinzugef/.test(dreierlei) && /berall/.test(dreierlei) && /Katalog/.test(dreierlei),
		"Erfolg, Umtypung und Verknuepfung stehen nebeneinander: " + dreierlei);
	zaehl();
	// 🔴 GRUEN, auch beim Verknuepfen -- das ist die zweite Haelfte der Owner-Beanstandung vom
	// 03.09.2026: der Satz stand neutral gefaerbt und allein da, nachdem das Formular geleert war,
	// und las sich wie ein Einwand. Die Farbe traegt die Aussage genauso wie das Wort.
	assert.ok(klassen.has("fs-add-note--ok"),
		"und die Zeile ist gruen: " + Array.from(klassen).join(", "));
	zaehl();

	console.log("quellen-art-korrigieren.test.js: " + pruefungen + " Zusicherungen erfuellt");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
