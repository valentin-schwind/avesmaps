// Aufgabe 16 des Garetien Importers -- „Angehakte uebernehmen" durch das VORHANDENE Blatt.
// Auftrag: docs/superpowers/specs/2026-08-27-garetien-importer-fenster-auftrag.md §5.4
// Brief:   .superpowers/sdd/2026-08-27-garetien-importer-fenster/task-16-brief.md
// Mockup:  docs/garetien-importer-mockup.html §8
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-uebernahme-blatt.test.js
//
// 🔴 Geprueft wird gegen das ECHTE Blatt (js/review/sync-plan-sheet.js, in einer vm-Sandbox ohne
// DOM geladen -- derselbe Weg wie sync-plan-sheet.test.js). Ein nachgebautes Blatt zertifizierte
// den Nachbau: die tragende Frage dieser Aufgabe ist, ob die BESCHNITTENE Antwort im echten
// Markup und in der echten Fusszeilen-Rechnung noch stimmt.
// ⭐ Der Sender wird AUSGEFUEHRT, nicht gelesen. Und die zwei Rueckrufe (onApplied/onClose) werden
// an den Anfragen gemessen, die sie ausloesen -- nicht an ihrer Identitaet.
//
// 🔴 STAND 29.08.2026 (Aufgabe 8): KEIN Knopf dieses Fensters oeffnet dieses Blatt mehr -- „Neu
// einfügen" und der Fußknopf schreiben seither SELBST (garetienNeuKlick/
// garetienFussknopfEinfuegenKlick in review-garetien-importer.js, getestet in
// garetien-fussknopf-dom.test.js Abschnitt D und garetien-handlungen.test.js Abschnitt M). Diese
// Datei bleibt unveraendert gueltig, weil sie garetienBlattSender/garetienUebernahmeOeffnen/
// garetienUebernahmeKnopfZustand/…Setzen direkt prueft, nicht den Klick -- und genau diese
// Funktionen bleiben laut Brief unangetastet im Code stehen ("nicht loeschen, ohne dass jemand
// die Entscheidung dazu getroffen hat").

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

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

const {
	garetienBlattSender, garetienUebernahmeOeffnen,
	garetienUebernahmeKnopfZustand, garetienUebernahmeKnopfSetzen,
} = mod;

[["garetienBlattSender", garetienBlattSender], ["garetienUebernahmeOeffnen", garetienUebernahmeOeffnen],
	["garetienUebernahmeKnopfZustand", garetienUebernahmeKnopfZustand],
	["garetienUebernahmeKnopfSetzen", garetienUebernahmeKnopfSetzen],
].forEach(([name, fn]) => wahr(typeof fn === "function", name + " fehlt im Export"));

// =================================================================================================
// Das echte Blatt, in einer Sandbox ohne DOM
// =================================================================================================

const blattQuelle = fs.readFileSync(path.join(WURZEL, "js", "review", "sync-plan-sheet.js"), "utf8");
const sandkasten = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandkasten);
vm.runInContext(blattQuelle, sandkasten, { filename: "sync-plan-sheet.js" });

const blattMarkup = sandkasten.syncPlanSheetMarkup;
const blattFuss = sandkasten.syncPlanFooterState;
const blattNaht = sandkasten.syncPlanResolvePost;
const blattStandardSender = sandkasten.syncPlanDefaultPost;
wahr(typeof blattMarkup === "function" && typeof blattFuss === "function"
	&& typeof blattNaht === "function",
	"die ECHTEN Funktionen des Blattes sind geladen -- kein Nachbau");

// 🔴 DIE NAHT, AUSGEFUEHRT. „openSyncPlanSheet nimmt einen eigenen `post` entgegen" ist die eine
// Voraussetzung dieser Aufgabe. Sie hier zu GREPPEN waere Vakuum -- ein umbenanntes Feld liesse
// den Text stehen und die Uebernahme still auf den Standardsender zurueckfallen, also auf die
// UNbeschnittene Liste mit 259 Zeilen.
const eigener = function () { return null; };
gleich(blattNaht({ post: eigener }), eigener, "ein eigener `post` gewinnt -- das ist die Naht");
gleich(blattNaht({}), blattStandardSender,
	"und ohne eigenen `post` gilt weiter der Standardsender (die Gegenprobe: die Naht ist nicht "
	+ "einfach immer der eigene)");

// =================================================================================================
// A. Der Sender: das Blatt zeigt, was ANGEHAKT ist -- nicht den ganzen Lauf
// =================================================================================================
//
// ⭐ Die Arbeitsliste wird WIRKLICH geholt (mit gefaelschtem fetch), damit
// avesmapsGaretienAngehakt() eine echte Zahl liest. Ohne diesen Schritt stuende sie auf 0, und
// jede truncated-Zusicherung darunter waere „0 === 0" -- Vakuum.

function mitFetch(antworten, fn) {
	const echt = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		const roh = antworten(rumpf, gestellt.length);
		// Frische Kopie je Anfrage: die Vorlage bleibt unberuehrt und laesst sich danach als
		// „so kam es vom Server" gegen das Ergebnis halten.
		return Promise.resolve({ json: () => Promise.resolve(JSON.parse(JSON.stringify(roh))) });
	};
	return Promise.resolve(fn(gestellt))
		.then((wert) => { global.fetch = echt; return { gestellt, wert }; })
		.catch((fehler) => { global.fetch = echt; throw fehler; });
}

/** Eine Listenantwort, wie sie api/_internal/import/garetien-liste.php baut. */
function listeAntwort(angehakt) {
	return {
		ok: true, plan_run_id: 4711, gesamt: 0, objekte: [],
		bilanz: {}, reiter: {}, facetten: {}, angehakt: angehakt,
	};
}

/**
 * Eine `get`-Antwort, wie sie api/edit/wiki/sync-plan.php baut.
 * ⚠️ `selected` ist dort ein echter Bool (`(int) $row['selected'] === 1`, sync-plan.php:115) --
 * anders als in der Listenantwort, wo eine 0/1-ZAHL steht.
 */
function zeile(id, gehakt, name) {
	return {
		id: id, entity_key: "ggp:Gewaesser:Fluss:" + name, change_type: "new",
		label: name, before: {}, after: {}, override: {}, selected: gehakt,
		skipped_count: 0, last_skipped_at: "",
	};
}

// --- Fall 1: ein ungedeckelter Lauf -- 259 Unterschiede, 3 Haekchen ------------------------------
const LAUF_A = {
	ok: true,
	run: {
		id: 4711, state: "open", created_at: "2026-08-28 09:00:00", source_stamp: "27.08.",
		counts: { new: 129, changed: 130, deleted: 0, total: 259 },
	},
	items: {
		new: [zeile(1, true, "Blutmoor"), zeile(2, false, "Natter")],
		changed: [zeile(3, true, "Ingval"), zeile(4, true, "Darpat"), zeile(5, false, "Szinto")],
		deleted: [],
	},
	// Der Server hat bei 200 abgeschnitten -- so sieht seine eigene Angabe aus.
	truncated: { new: 127, changed: 127, deleted: 0 },
	category_limit: 200,
	declined_count: 0,
};

/** Eine dritte, kleine `get`-Antwort fuer den Oeffner-Abschnitt. */
const LAUF_C = {
	ok: true,
	run: {
		id: 4711, state: "open", created_at: "2026-08-28 09:00:00", source_stamp: "",
		counts: { new: 0, changed: 40, deleted: 0, total: 40 },
	},
	items: { new: [], changed: [zeile(7, true, "Alke"), zeile(8, false, "Llavari")], deleted: [] },
	truncated: { new: 0, changed: 38, deleted: 0 },
	category_limit: 200,
	declined_count: 0,
};

mitFetch(
	(rumpf) => (rumpf.action === "liste" ? listeAntwort({ new: 1, changed: 2 }) : LAUF_A),
	function () {
		return mod.avesmapsGaretienListeHolen()
			.then(() => garetienBlattSender({ action: "get", kind: "garetien" }));
	}
).then(function (a) {
	const antwort = a.wert;

	// Die Gegenprobe zuerst: es lief wirklich eine Liste UND ein `get`, in dieser Reihenfolge.
	tief(a.gestellt.map((r) => r.rumpf.action), ["liste", "get"],
		"die Gegenprobe: die Arbeitsliste wurde wirklich geholt, DANN das Blatt gefragt");
	gleich(a.gestellt[1].pfad, "/api/edit/wiki/sync-plan.php",
		"das Blatt fragt durch die EINE Uebernahme-Tuer");

	// --- Beschnitten wird die ANZEIGE -------------------------------------------------------
	gleich(LAUF_A.items.changed.length, 3, "die Gegenprobe: der Server schickte 3 `changed`-Zeilen");
	gleich(antwort.items.changed.length, 2,
		"nur die angehakten Zeilen gehoeren ins Blatt -- die DIFFERENZ 3 -> 2 ist der ganze Zweck");
	gleich(antwort.items.new.length, 1, "und bei „neu\" 2 -> 1");
	tief(antwort.items.changed.map((z) => z.id), [3, 4], "und zwar genau die mit Haekchen");
	tief(antwort.items.new.map((z) => z.id), [1], "ebenso bei „neu\"");
	wahr(antwort.items.changed.every((z) => z.selected === true),
		"keine ungehakte Zeile ueberlebt den Schnitt");

	// --- `counts` wird MITGEZOGEN ------------------------------------------------------------
	gleich(LAUF_A.run.counts.total, 259, "die Gegenprobe: der Server nannte 259 Unterschiede");
	gleich(antwort.run.counts.total, 3, "die Zahl im Kopf muss die angehakten zaehlen");
	tief(antwort.run.counts, { new: 1, changed: 2, deleted: 0, total: 3 },
		"und zwar je Kategorie -- sonst behauptet die Ueberschrift der Gruppe etwas anderes als "
		+ "die Zeilen darunter");

	// --- `truncated` wird MITGEZOGEN, und die Zahl kommt aus der ARBEITSLISTE ----------------
	gleich(LAUF_A.truncated.changed, 127, "die Gegenprobe: der Server nannte 127 abgeschnittene");
	gleich(antwort.truncated.changed, 0,
		"💣 Stuende hier die Serverzahl, meldete das Blatt „und 127 weitere werden mit "
		+ "uebernommen\" fuer Zeilen, die gerade NICHT angehakt sind -- eine Falschaussage ueber "
		+ "eine Uebernahme.");
	gleich(antwort.truncated.new, 0, "dasselbe bei „neu\"");

	// --- Und das ECHTE Blatt sagt daraus das Richtige ----------------------------------------
	const markupBeschnitten = blattMarkup(Object.assign({ kind: "garetien" }, antwort));
	const markupRoh = blattMarkup(Object.assign({ kind: "garetien" }, JSON.parse(JSON.stringify(LAUF_A))));
	wahr(markupRoh.includes("259 Unterschiede"),
		"die Gegenprobe: OHNE das Mitziehen behauptet das echte Blatt 259 Unterschiede");
	wahr(!markupBeschnitten.includes("259 Unterschiede"),
		"mit dem Mitziehen nicht mehr");
	wahr(markupBeschnitten.includes("3 Unterschiede"),
		"sondern genau die drei Zeilen, die es zeigt");
	wahr(markupRoh.includes("und 127 weitere"),
		"die Gegenprobe: OHNE das Mitziehen verspricht das echte Blatt 127 weitere Uebernahmen");
	wahr(!markupBeschnitten.includes("weitere (sie sind mit ihrem Häkchen gespeichert"),
		"💣 mit dem Mitziehen verspricht es gar keine -- es gibt keine");

	// --- `apply` geht UNVERAENDERT durch ------------------------------------------------------
	// 🔴 DIESELBE Nutzlast, andere `action`: das belegt, dass der Riegel an der HANDLUNG haengt und
	// nicht zufaellig an der Form der Antwort. Ohne diesen Fall koennte der Schnitt an
	// `antwort.items` haengen und dieselbe Zusicherung waere gruen.
	return mitFetch(() => LAUF_A, () => garetienBlattSender({ action: "apply", kind: "garetien", run_id: 4711 }));
}).then(function (a) {
	const durch = a.wert;
	gleich(durch.items.changed.length, 3, "apply darf nicht angefasst werden -- alle 3 Zeilen stehen noch da");
	gleich(durch.run.counts.total, 259, "und die Serverzahl auch");
	gleich(durch.truncated.changed, 127, "und seine truncated-Angabe ebenso");
	gleich(durch.beruehrt, undefined, "apply bekommt kein zusaetzliches Feld");

	// `select` und `undecline` ebenso -- sie sind die zwei anderen Handlungen, die das Blatt schickt.
	return mitFetch(() => LAUF_A, () => Promise.all([
		garetienBlattSender({ action: "select", kind: "garetien", run_id: 4711, ids: [3], selected: false }),
		garetienBlattSender({ action: "undecline", kind: "garetien", entity_keys: ["x"] }),
	]));
}).then(function (a) {
	gleich(a.wert[0].items.changed.length, 3, "`select` geht unveraendert durch");
	gleich(a.wert[1].items.changed.length, 3, "`undecline` ebenso");

	// =============================================================================================
	// B. Der gedeckelte Lauf -- die einzige Stelle, an der `counts` und `truncated` auseinandergehen
	// =============================================================================================
	//
	// 💣 Ueber 200 Zeilen je Kategorie schneidet der Server ab (AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT),
	// und was er abgeschnitten hat, KANN angehakt sein. Hier stehen 2 angehakte Zeilen im Blatt,
	// waehrend die Arbeitsliste 5 Haekchen dieser Kategorie zaehlt.
	const LAUF_B = {
		ok: true,
		run: {
			id: 4711, state: "open", created_at: "2026-08-28 09:00:00", source_stamp: "27.08.",
			counts: { new: 0, changed: 900, deleted: 0, total: 900 },
		},
		items: {
			new: [],
			changed: [zeile(3, true, "Ingval"), zeile(4, true, "Darpat"), zeile(5, false, "Szinto")],
			deleted: [],
		},
		truncated: { new: 0, changed: 897, deleted: 0 },
		category_limit: 200,
		declined_count: 0,
	};
	return mitFetch(
		(rumpf) => (rumpf.action === "liste" ? listeAntwort({ new: 0, changed: 5 }) : LAUF_B),
		function () {
			return mod.avesmapsGaretienListeHolen()
				.then(() => garetienBlattSender({ action: "get", kind: "garetien" }));
		}
	);
}).then(function (a) {
	const antwort = a.wert;
	gleich(antwort.items.changed.length, 2, "sichtbar sind die 2 angehakten der ausgelieferten 3");
	gleich(antwort.truncated.changed, 3,
		"💣 die 3 abgeschnittenen ANGEHAKTEN kommen aus der ungedeckelten Arbeitsliste (5), nicht "
		+ "aus einer Schaetzung ueber die 897, die der Server abgeschnitten hat");
	gleich(antwort.run.counts.changed, 5,
		"💣 `counts` zaehlt ALLE angehakten der Kategorie (sichtbar + abgeschnitten), nicht nur die "
		+ "sichtbaren -- siehe die Fusszeilen-Rechnung darunter");
	gleich(antwort.run.counts.total, 5, "und der Kopf nennt dieselbe Summe");

	// --- Die ECHTE Fusszeilen-Rechnung des Blattes ------------------------------------------
	// So ruft syncPlanBindSheet sie: `selected` = die sichtbar angehakten Kaestchen,
	// `hidden` = truncated.new + truncated.changed, `total` = counts.total.
	const sichtbarGehakt = antwort.items.changed.length + antwort.items.new.length;
	const verborgen = antwort.truncated.new + antwort.truncated.changed;
	const fuss = blattFuss({
		kind: "garetien", total: antwort.run.counts.total,
		selected: sichtbarGehakt, hidden: verborgen, deletions: 0, confirmed: false,
	});
	gleich(fuss.selectedTotal, antwort.run.counts.total,
		"💣 die Fusszeile sagt „N von N werden uebernommen\" -- mit der bloss SICHTBAREN Zahl in "
		+ "`counts` stuende dort „5 von 2\"");
	gleich(fuss.applyDisabled, false, "und der Uebernehmen-Knopf des Blattes ist offen");
	gleich(fuss.applyVisible, true, "es gibt ihn ueberhaupt");

	// Die Gegenprobe zur Zeile darueber: mit der sichtbaren Zahl in `counts` waere es wirklich
	// falsch. Ohne sie koennte `counts` alles Moegliche sein und die Zusicherung bliebe gruen.
	const falsch = blattFuss({
		kind: "garetien", total: sichtbarGehakt,
		selected: sichtbarGehakt, hidden: verborgen, deletions: 0, confirmed: false,
	});
	wahr(falsch.selectedTotal > sichtbarGehakt,
		"die Gegenprobe: mit `counts[art] = nur die sichtbaren` behauptete das Blatt "
		+ `„${falsch.selectedTotal} von ${sichtbarGehakt}"`);

	// Und im echten Markup steht die verborgene Zahl als Satz.
	const markup = blattMarkup(Object.assign({ kind: "garetien" }, antwort));
	wahr(markup.includes("und 3 weitere"),
		"das echte Blatt nennt die 3 verborgenen ANGEHAKTEN -- und nur die");
	wahr(!markup.includes("und 897 weitere"), "nicht die 897, die der Server abgeschnitten hat");

	// =============================================================================================
	// C. Der Oeffner -- was dem Blatt hereingereicht wird, und was die zwei Rueckrufe TUN
	// =============================================================================================
	const gesehen = [];
	const wirt = { id: "garetien-sheet" };
	const ergebnis = garetienUebernahmeOeffnen(function (optionen) {
		gesehen.push(optionen);
		return "aufgemacht";
	}, wirt);
	gleich(ergebnis, "aufgemacht", "der Rueckgabewert des Blattes wird durchgereicht");
	gleich(gesehen.length, 1, "die Gegenprobe: das Blatt wurde wirklich EINMAL gerufen");
	gleich(gesehen[0].kind, "garetien", "mit der `kind`-Kennung dieses Imports");
	gleich(gesehen[0].mount, wirt, "und mit dem Wirt, der hereingereicht wurde");
	wahr(typeof gesehen[0].onApplied === "function" && typeof gesehen[0].onClose === "function",
		"ohne onApplied bleibt die Liste nach dem Uebernehmen auf dem alten Stand stehen -- und "
		+ "ohne onClose ebenso nach einem „Später\", in dem jemand Haekchen weggenommen hat");

	// 🔴 KEIN STILLER RUECKFALL: ohne Blatt wird nichts geoeffnet und nichts erfunden.
	gleich(garetienUebernahmeOeffnen(null, wirt), null,
		"fehlt js/review/sync-plan-sheet.js, gibt es keine Ersatzfassung -- das waere genau die "
		+ "zweite Uebernahme-Vorschau, die dieses Vorhaben nicht bauen darf");
	gleich(garetienUebernahmeOeffnen(function () { return "x"; }, null), null,
		"und ohne Wirt ebenso");

	// --- Der hereingereichte `post` IST der beschneidende Sender -----------------------------
	// ⭐ Behavioral gemessen, nicht per Identitaetsvergleich: `post === garetienBlattSender` waere
	// gruen, auch wenn der Export irgendwann auf eine andere Fassung zeigt.
	return mitFetch(() => LAUF_C, () => gesehen[0].post({ action: "get", kind: "garetien" }))
		.then((b) => ({ b: b, gesehen: gesehen }));
}).then(function (x) {
	gleich(x.b.wert.items.changed.length, 1,
		"der `post`, den das Blatt bekommt, beschneidet wirklich -- gemessen an seiner Wirkung, "
		+ "nicht an seiner Identitaet");
	gleich(x.b.gestellt[0].pfad, "/api/edit/wiki/sync-plan.php", "und geht durch die EINE Tuer");

	// --- Die zwei Rueckrufe holen die Arbeitsliste WIRKLICH nach -----------------------------
	// ⭐ Gemessen an der Anfrage, die hinausgeht. Ein Spion auf `avesmapsGaretienListeHolen` saehe
	// den modulinternen Aufruf ohnehin nicht.
	return mitFetch(() => listeAntwort({ new: 0, changed: 0 }), () => {
		x.gesehen[0].onApplied({ applied: 2 });
		return Promise.resolve();
	}).then((c) => ({ c: c, gesehen: x.gesehen }));
}).then(function (x) {
	tief(x.c.gestellt.map((r) => r.rumpf.action), ["liste"],
		"💣 onApplied holt die Arbeitsliste NEU -- ohne das steht sie auf dem Stand von vorher, "
		+ "und der naechste Klick hakt etwas an, das schon geschrieben ist");
	gleich(x.c.gestellt[0].pfad, "/api/edit/map/garetien-import.php",
		"und zwar ueber den EINEN Weg, auf dem die Liste sich aendert");

	return mitFetch(() => listeAntwort({ new: 0, changed: 0 }), () => {
		x.gesehen[0].onClose();
		return Promise.resolve();
	});
}).then(function (a) {
	tief(a.gestellt.map((r) => r.rumpf.action), ["liste"],
		"und onClose ebenso: wer im Blatt „keine\" drueckt und dann „Später\", hat den Serverstand "
		+ "veraendert, ohne etwas zu uebernehmen");

	console.log(`garetien-uebernahme-blatt ok -- ${checks} Zusicherungen`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});


// =================================================================================================
// D. Der Fussknopf -- „n von m", und der Grund, wenn er nicht geht
// =================================================================================================
//
// 🔴 SEIT AUFGABE 5 (29.08.2026, Entwurf §3.3) NIMMT DER KNOPF DIE ANZEIGE-LISTE, KEINE ZAHL MEHR:
// „Alle angezeigten einfügen (n von m)" ersetzt „Angehakte übernehmen (n)". n zaehlt die
// angezeigten Objekte MIT mindestens einem Item, m die ganze Anzeige -- „Nur Angezeigtes kann
// uebernommen werden" (Owner). Die ausfuehrliche Pruefung dieser Regel (samt der Haeppchen-Regel
// aus dem Nachtrag zu Aufgabe 5) steht in garetien-anzeige-menge.test.js; hier nur die Gegenprobe
// gegen das ECHTE Blatt daneben.

const mitItem = { key: "ggp:Gewaesser:1", items: [{ id: 1, selected: 0 }] };
const ohneItem = { key: "ggp:Berge:7", items: [] };

const knopfLeer = garetienUebernahmeKnopfZustand([ohneItem]);
const knopfVoll = garetienUebernahmeKnopfZustand([mitItem, mitItem, ohneItem]);
gleich(knopfVoll.beschriftung, "Alle angezeigten einfügen (2 von 3)",
	"der Knopf traegt „n von m\" -- zwei der drei Angezeigten haben ein Item");
gleich(knopfVoll.gesperrt, false, "und ist offen, solange mindestens ein Vorschlag angezeigt wird");
gleich(knopfLeer.gesperrt, true,
	"🔴 kein Vorschlag unter den Angezeigten ⇒ gesperrt. Ein Blatt mit null Zeilen ist eine "
	+ "Sackgasse: das echte Blatt haette dort nicht einmal einen Uebernehmen-Knopf.");
gleich(knopfLeer.beschriftung, "Alle angezeigten einfügen (0 von 1)", "und sagt die Null auch");
wahr(knopfLeer.hinweis.length > 0, "… und sagt WARUM");
gleich(knopfVoll.hinweis, "",
	"die Gegenprobe: bei mindestens einem Vorschlag steht KEIN Hinweis da -- sonst waere er "
	+ "Zierrat statt eines Grundes");
// Die Gegenprobe zur Sperre: das echte Blatt bestaetigt sie. Bei null Haekchen gibt es dort
// keinen Uebernehmen-Knopf, und der andere heisst „Schliessen".
const blattLeer = blattFuss({ kind: "garetien", total: 0, selected: 0, deletions: 0 });
gleich(blattLeer.applyVisible, false,
	"das echte Blatt zeigt bei null Zeilen gar keinen Uebernehmen-Knopf -- deshalb ist der Weg "
	+ "dorthin schon im Fenster gesperrt");
gleich(blattLeer.closeLabel, "Schließen", "und sein anderer Knopf heisst dann „Schließen\"");

// Eine leere oder fehlende Anzeige faellt auf „0 von 0" -- die sichere Richtung.
gleich(garetienUebernahmeKnopfZustand([]).gesperrt, true, "eine leere Anzeige sperrt");
gleich(garetienUebernahmeKnopfZustand(undefined).anzahl, 0, "und eine fehlende ebenso");
gleich(garetienUebernahmeKnopfZustand(undefined).beschriftung, "Alle angezeigten einfügen (0 von 0)",
	"…und nennt zwei Nullen, keine Ausnahme");

// Ohne `document` fasst die DOM-Haelfte nichts an und wirft nicht.
gleich(garetienUebernahmeKnopfSetzen([mitItem]), null,
	"ohne document tut die DOM-Haelfte nichts -- diese Datei muss unter Node ladbar bleiben");

// =================================================================================================
// E. Das Blatt selbst ist UNVERAENDERT -- und bleibt beim Abbau stehen
// =================================================================================================
//
// 🔴 Sieben andere Objektarten benutzen dieselbe Datei. Kennte sie den Importer, naehme der Abbau
// (Auftrag §5.5) sie mit -- und mit ihr die Uebernahme der sieben anderen.

const importerName = "garetien" + "-import";
wahr(!blattQuelle.includes(importerName),
	"Das Blatt darf den Importer nicht kennen -- sonst nimmt der Abbau es mit.");
wahr(!blattQuelle.includes("review-garetien"),
	"und die Datei dieses Fensters erst recht nicht");
// Die Gegenprobe: dieselbe Suche findet den Namen dort, wo er STEHT -- sonst misst sie nur, dass
// eine Zeichenkette irgendwo nicht vorkommt.
const importerQuelle = fs.readFileSync(
	path.join(WURZEL, "js", "review", "review-garetien-importer.js"), "utf8");
wahr(importerQuelle.includes(importerName),
	"die Gegenprobe: im Importer selbst findet dieselbe Suche den Namen sehr wohl");

// Und das Blatt kennt „garetien" weiterhin als ART -- ohne diesen Eintrag traegt es den falschen
// Titel und faellt bei der Loeschgruppe in den Zweig einer Art, die loescht.
wahr(/garetien:\s*null/.test(blattQuelle),
	"🔴 `SYNC_PLAN_KIND_DELETIONS.garetien === null` -- ein Import loescht nichts, und nur deshalb "
	+ "ist `counts.protected_note` fuer diese Art unerreichbar");

// =================================================================================================
// F. Der Wirt liegt AUSSERHALB des Fensters -- gemessen an der Verschachtelung, nicht geraten
// =================================================================================================
//
// ⚠️ `.gi-win` traegt `overflow: hidden` und ist 800×700 gross; ein Blatt darin waere abgeschnitten.
// „Steht weiter unten in der Datei" belegt das NICHT -- es koennte im Fenster stehen. Gemessen wird
// deshalb die Tiefe: ab dem oeffnenden `<div id="garetien-importer"` wird mitgezaehlt, bis sie
// wieder auf 0 faellt; das ist das Ende des Fensters.

const indexHtml = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");

function endeDesFensters(html, startMuster) {
	const start = html.indexOf(startMuster);
	if (start < 0) { return -1; }
	let tiefe = 0;
	const muster = /<div\b[^>]*>|<\/div\s*>/g;
	muster.lastIndex = start;
	let treffer;
	while ((treffer = muster.exec(html)) !== null) {
		tiefe += treffer[0].startsWith("</") ? -1 : 1;
		if (tiefe === 0) { return muster.lastIndex; }
	}
	return -1;
}

const fensterStart = indexHtml.indexOf('<div id="garetien-importer"');
const fensterEnde = endeDesFensters(indexHtml, '<div id="garetien-importer"');
const wirtStelle = indexHtml.indexOf('id="garetien-sheet"');
wahr(fensterStart > 0, "das Fenster steht in index.html");
wahr(fensterEnde > fensterStart, "und der Tiefenzaehler findet sein Ende");
wahr(wirtStelle > 0, "der Wirt #garetien-sheet steht in index.html");
wahr(wirtStelle > fensterEnde,
	"⚠️ und AUSSERHALB von .gi-win -- darin waere das Blatt an `overflow: hidden` abgeschnitten");
// Die Gegenprobe zum Tiefenzaehler: der Fussknopf liegt DRINNEN, und derselbe Vergleich sagt das.
// Ohne sie koennte `fensterEnde` irgendeine Zahl sein und die Zusicherung darueber immer halten.
const knopfStelle = indexHtml.indexOf('id="garetien-apply"');
wahr(knopfStelle > fensterStart && knopfStelle < fensterEnde,
	"die Gegenprobe: derselbe Zaehler verortet #garetien-apply INNERHALB des Fensters");

// Der Wirt traegt die Hausklasse des Blattes und startet verborgen.
const wirtZeile = indexHtml.slice(indexHtml.lastIndexOf("<div", wirtStelle),
	indexHtml.indexOf(">", wirtStelle) + 1);
wahr(wirtZeile.includes('class="sync-plan-host"'),
	"der Wirt traegt `.sync-plan-host` -- die Hausform aus css/components/sync-plan-sheet.css");
wahr(/\shidden\b/.test(wirtZeile), "und startet verborgen");

// Kein zweites CSS: das Blatt-Stylesheet steht genau einmal in index.html.
gleich(indexHtml.split("css/components/sync-plan-sheet.css").length - 1, 1,
	"⚠️ kein zweites CSS -- das Blatt-Stylesheet ist ueber index.html bereits geladen");

// Der Hinweis steht neben dem Knopf, in derselben Fusszeile.
const hinweisStelle = indexHtml.indexOf('id="garetien-apply-hint"');
wahr(hinweisStelle > 0 && hinweisStelle < knopfStelle,
	"der Grund steht VOR dem Knopf in der Fusszeile -- man liest ihn, bevor man den grauen Knopf "
	+ "sucht");

// =================================================================================================
// G. Der Hinweis ist lesbar -- gemessen, nicht geschaetzt
// =================================================================================================
//
// ⚠️ Der Leser ist absichtlich stumpf: die ERSTE Fassung eines Tokens ist die helle (blankes
// `:root`), die LETZTE die dunkle. Belegt wird das dadurch, dass beide sich unterscheiden.

const tokenCss = fs.readFileSync(path.join(WURZEL, "css/base/tokens.css"), "utf8");
function tokenWerte(name) {
	// 🪤 Gesplittet, NICHT ueber einen aus einer Zeichenkette gebauten Regex: `"\s*"` in einem
	// JS-Stringliteral ist `"s*"`. Der Regex unten ist ein LITERAL.
	const werte = tokenCss.split(name + ":").slice(1)
		.map((rest) => (rest.match(/^\s*(#[0-9a-fA-F]{6})/) || [])[1])
		.filter((wert) => !!wert);
	return { hell: werte[0], dunkel: werte[werte.length - 1], anzahl: werte.length };
}
function leuchtdichte(hex) {
	const teile = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
		.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
	return 0.2126 * teile[0] + 0.7152 * teile[1] + 0.0722 * teile[2];
}
function kontrast(a, b) {
	const l1 = leuchtdichte(a), l2 = leuchtdichte(b);
	return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
}

const importerCss = fs.readFileSync(
	path.join(WURZEL, "css/components/garetien-importer.css"), "utf8");
const hinweisRegel = (importerCss.match(/\.gi-foot__hint\s*\{[^}]*\}/) || [])[0] || "";
wahr(hinweisRegel.length > 0, "`.gi-foot__hint` hat eine Regel");
wahr(/font-size:\s*var\(--font-size-caption\)/.test(hinweisRegel),
	"💣 nur Tokens, nie eine harte Zahl (Designsprache)");
wahr(/color:\s*var\(--color-text-muted\)/.test(hinweisRegel), "und die Farbe ebenso");
wahr(/flex:\s*none/.test(hinweisRegel),
	"⚠️ `flex: none` -- die Zaehlzeile links traegt `flex: 1 1 auto` und schiebt Hinweis und Knopf "
	+ "nach rechts; ein mitwachsender Hinweis naehme ihr genau das ab");
// Gegenprobe zum Muster: dieselbe Suche findet in derselben Regel KEINE harte Farbe.
wahr(!/color:\s*#[0-9a-fA-F]{3,8}/.test(hinweisRegel),
	"die Gegenprobe: dasselbe Muster findet in dieser Regel keinen Hex-Wert");

const grundFarbe = tokenWerte("--color-panel-soft");
const textFarbe = tokenWerte("--color-text-muted");
[["--color-panel-soft", grundFarbe], ["--color-text-muted", textFarbe]].forEach(([name, w]) => {
	wahr(w.anzahl >= 2 && w.hell && w.dunkel && w.hell !== w.dunkel,
		`der Token-Leser findet fuer ${name} kein helles UND dunkles Paar (${w.hell}/${w.dunkel})`);
});
["hell", "dunkel"].forEach((thema) => {
	wahr(kontrast(textFarbe[thema], grundFarbe[thema]) >= 4.5,
		`der Hinweis liest sich im ${thema}en Thema nur mit `
		+ `${kontrast(textFarbe[thema], grundFarbe[thema])}:1 -- AA verlangt 4,5 bei 11px`);
});
// Und die Gegenprobe, dass die Schranke ueberhaupt etwas ausschliesst: die gedaempfte Urteilsfarbe
// auf demselben Grund faellt im dunklen Thema NICHT durch, ein Token wie --color-disabled-text
// aber sehr wohl. Ohne so eine Zeile liesse die Schranke jede Farbe durch.
const gesperrtFarbe = tokenWerte("--color-disabled-text");
wahr(kontrast(gesperrtFarbe.hell, grundFarbe.hell) < 4.5,
	"die Gegenprobe: --color-disabled-text faellt auf demselben Grund wirklich durch -- deshalb "
	+ "steht der Grund NEBEN dem grauen Knopf und nicht in ihm");

// Die Schriftgroesse liegt nicht unter der Hausuntergrenze von 11px (AGENTS.md §11/§12).
const captionPx = Number((tokenCss.match(/--font-size-caption:\s*(\d+)px/) || [])[1]);
wahr(captionPx >= 11, `--font-size-caption ist ${captionPx}px -- unter der Untergrenze von 11px`);
