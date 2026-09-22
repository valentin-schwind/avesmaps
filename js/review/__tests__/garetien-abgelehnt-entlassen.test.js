// Fall #141 (21.09.2026, Tigersprung): „Garetien-Importer: Abgelehnt heißt abgelehnt".
// Wörtlich: „Ein aus der ‚Offen'-Liste abgelehntes Objekt bleibt im Moment ausgewählt. Das soll
// nicht passieren, mit der Ablehnung soll es auch abgewählt werden. Aus der Stage heraus
// abgelehnte Objekte sollen automatisch von der Stage genommen und abgewählt werden."
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-abgelehnt-entlassen.test.js
//
// 🔴 GEMESSEN WIRD DER AUSGEFÜHRTE ABLAUF, nicht der Quelltext. Eine Zusicherung, die bloß
// behauptet, irgendwo stehe ein Aufruf, wäre Vakuum -- und genau dieser Fehler ist in diesem
// Fenster schon mehrfach zugeschnappt. Die drei Erzeuger einer Ablehnung werden deshalb einzeln
// GEFAHREN, mit ihren echten Verteilern und ihren echten Türen.

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

// ⭐ Die Ids des Listen-Skeletts kommen mit, weil Abschnitt 5 den DRITTEN Erzeuger WIRKLICH fährt --
// samt seinem Listenlauf. Ohne sie bricht `garetienListeSkelettSicherstellen` ab, und der Lauf
// bewiese nichts.
const { api } = ladeImporter(["garetien-auswahlleiste",
	"garetien-listcol", "garetien-tabs", "garetien-search", "garetien-chips",
	"garetien-neutral-hinweis", "garetien-anzeige-hinweis", "garetien-detailcol",
	"garetien-apply", "garetien-apply-hint", "garetien-zentrieren-alle", "garetien-anzeige-clear",
	"garetien-filter-toggle", "garetien-filter-menu"]);
const {
	garetienAbgelehnteEntlassen,
	avesmapsGaretienAuswahlUmschalten, avesmapsGaretienAuswahlHat, avesmapsGaretienAuswahlAufheben,
	avesmapsGaretienStageHinzufuegen, avesmapsGaretienStageHat, avesmapsGaretienStageLeeren,
	avesmapsGaretienStageListe,
	garetienHandlungKlick, garetienHandlungSendenMitMeldung,
	garetienAuswahlleisteKlick, garetienMengeSendenMitMeldung,
	garetienRuecknahmeKlick,
} = api;

let checks = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); checks++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); checks++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); checks++; };

[["garetienAbgelehnteEntlassen", garetienAbgelehnteEntlassen]]
	.forEach(([n, f]) => wahr(typeof f === "function", n + " fehlt im Export"));

const a = { key: "a", stand: "offen", urteil: "neu", name: "Gramfeldermoor", items: [{ id: 1, change_type: "new" }] };
const b = { key: "b", stand: "offen", urteil: "neu", name: "Briskenmoor", items: [{ id: 2, change_type: "new" }] };
// Ein Objekt OHNE Vorschlag -- es reist als SCHLUESSEL an die eigene Tuer (15.09.2026), und es
// muss genauso entlassen werden: „auch wenn sie keinen vorschlag tragen".
const c = { key: "c", stand: "offen", urteil: "uebersprungen", name: "Perz", items: [] };

function frischerStand() {
	avesmapsGaretienAuswahlAufheben();
	avesmapsGaretienStageLeeren();
}

// =================================================================================================
// 1. DER REINE ZUG -- er nimmt aus BEIDEN Mengen, und nur die genannten Schlüssel.
// =================================================================================================
frischerStand();
avesmapsGaretienAuswahlUmschalten("a", a);
avesmapsGaretienAuswahlUmschalten("b", b);
avesmapsGaretienStageHinzufuegen([a, b]);
gleich(avesmapsGaretienAuswahlHat("a"), true, "Vorbedingung: „a\" ist gewählt");
gleich(avesmapsGaretienStageHat("a"), true, "Vorbedingung: „a\" liegt auf der Stage");

const zahlen = garetienAbgelehnteEntlassen(["a"]);
gleich(avesmapsGaretienAuswahlHat("a"), false, "🔴 abgelehnt heißt ABGEWÄHLT");
gleich(avesmapsGaretienStageHat("a"), false, "🔴 und von der STAGE genommen");
tief(zahlen, { auswahl: 1, stage: 1 }, "und der Zug meldet beide Zahlen");
gleich(avesmapsGaretienAuswahlHat("b"), true, "💣 der Nachbar bleibt gewählt");
gleich(avesmapsGaretienStageHat("b"), true, "💣 und liegt weiter auf der Stage");

// Ein unbekannter, ein leerer und ein fehlender Schlüssel sind harmlos.
tief(garetienAbgelehnteEntlassen([]), { auswahl: 0, stage: 0 }, "die leere Menge tut nichts");
tief(garetienAbgelehnteEntlassen(null), { auswahl: 0, stage: 0 }, "und `null` ebenso");
tief(garetienAbgelehnteEntlassen(["", null, undefined]), { auswahl: 0, stage: 0 },
	"leere Schlüssel fallen heraus, bevor irgendetwas angefasst wird");
tief(garetienAbgelehnteEntlassen(["gibtsnicht"]), { auswahl: 0, stage: 0 },
	"ein unbekannter Schlüssel meldet 0, statt zu werfen");
gleich(avesmapsGaretienStageListe().length, 1, "und die Stage trägt weiterhin genau „b\"");

// Nur auf der Stage, nicht gewählt -- und umgekehrt.
frischerStand();
avesmapsGaretienStageHinzufuegen([a]);
tief(garetienAbgelehnteEntlassen(["a"]), { auswahl: 0, stage: 1 },
	"nur auf der Stage: sie wird geräumt, die Auswahl zählt 0");
frischerStand();
avesmapsGaretienAuswahlUmschalten("a", a);
tief(garetienAbgelehnteEntlassen(["a"]), { auswahl: 1, stage: 0 },
	"nur gewählt: die Auswahl geht, die Stage zählt 0");

// =================================================================================================
// 2. ERZEUGER 1 -- der Einzelknopf „Ablehnen" reicht SEINEN Schlüssel an die Tür.
// =================================================================================================
function kette(knoten) {
	const kandidaten = knoten.map((k) => Object.assign({
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(k.attribute || {}, name)
				? k.attribute[name] : null;
		},
	}, k));
	kandidaten[0].closest = function (auswahl) {
		const teile = String(auswahl).split(",").map((t) => t.trim());
		for (const k of kandidaten) {
			for (const teil of teile) {
				if ((k.passt || []).indexOf(teil) !== -1) { return k; }
			}
		}
		return null;
	};
	return kandidaten[0];
}
const handlungsZiel = (name, key) => kette([{
	passt: ["[data-handlung]", "[data-key]"],
	attribute: { "data-handlung": name, "data-key": key },
}]);

let gesendet = [];
const senden = (rumpf, meldung, entlassen) => { gesendet.push({ rumpf, meldung, entlassen }); return "ok"; };

gesendet = [];
garetienHandlungKlick({ target: handlungsZiel("ablehnen", "a") }, [a, b], 7, senden, () => true);
gleich(gesendet.length, 1, "der Einzelknopf schickt");
gleich(gesendet[0].rumpf.action, "decline", "als Ablehnung");
tief(gesendet[0].entlassen, ["a"],
	"🔴 und reicht GENAU SEINEN Schlüssel zum Entlassen weiter -- nicht die ganze Liste");

// 💣 DIE GEGENPROBE: „wieder vorschlagen" entlässt NICHTS. Wer ein Objekt zurück in den
// Arbeitsvorrat holt, hat es nicht abgelehnt -- und seine Auswahl soll er behalten.
// ⚠️ Sie braucht ein wirklich ABGELEHNTES Objekt: an einem offenen bietet der Bauer den Knopf gar
// nicht an, und der Klick fiele durch -- die Zusicherung wäre dann Vakuum.
const abgelehnt = {
	key: "x", stand: "abgelehnt", urteil: "neu", name: "Perricum",
	items: [{ id: 9, change_type: "new", selected: 0 }],
};
gesendet = [];
garetienHandlungKlick({ target: handlungsZiel("wieder", "x") }, [abgelehnt], 7, senden, () => true);
gleich(gesendet.length, 1, "„Wieder vorschlagen\" schickt ebenfalls");
gleich(gesendet[0].rumpf.action, "undecline", "als Rücknahme der Ablehnung");
gleich(gesendet[0].entlassen, null, "💣 aber es entlässt NICHTS");

// =================================================================================================
// 3. DIE TÜR ENTLÄSST WIRKLICH -- und zwar VOR dem Listenlauf.
//
// 💣 DAS IST DIE TRAGENDE ZUSICHERUNG DER REIHENFOLGE. Die Stage speist „Stage importieren" und
// „Alle zentrieren", und deren Zahlen entstehen IM Listenlauf. Entließe die Tür erst danach,
// stünde dort die alte Zahl -- sichtbar falsch, und von einem kaputten Knopf nicht zu
// unterscheiden. Gemessen wird deshalb der Zustand IM AUGENBLICK des Listenlaufs.
// =================================================================================================
frischerStand();
avesmapsGaretienAuswahlUmschalten("a", a);
avesmapsGaretienStageHinzufuegen([a]);
let standBeimListenlauf = null;
const listeHolen = () => {
	standBeimListenlauf = {
		auswahl: avesmapsGaretienAuswahlHat("a"),
		stage: avesmapsGaretienStageHat("a"),
	};
	return Promise.resolve(null);
};

garetienHandlungSendenMitMeldung(
	{ action: "decline", ids: [1] }, "„Gramfeldermoor\" abgelehnt.",
	() => Promise.resolve({ ok: true }), listeHolen, ["a"]
).then(() => {
	tief(standBeimListenlauf, { auswahl: false, stage: false },
		"💣 beim Listenlauf ist das Objekt schon aus Auswahl UND Stage -- sonst zeichnet er alte Zahlen");
	gleich(avesmapsGaretienAuswahlHat("a"), false, "und danach erst recht");

	// --- Der Riegel: hat der Server GAR NICHTS entschieden, bleibt das Objekt gewählt. ----------
	// 🔴 Die Antwort sagt das nur beim Objekt-Weg (`objekte_ablehnen`): „abgelehnt: 0" und ein
	// Nachsatz. Dann widerspräche ein verschwundener Haken der Meldung „Nicht abgelehnt: …".
	frischerStand();
	avesmapsGaretienAuswahlUmschalten("c", c);
	return garetienHandlungSendenMitMeldung(
		{ action: "objekte_ablehnen", keys: ["c"] }, "„Perz\" abgelehnt.",
		() => Promise.resolve({ abgelehnt: 0, mit_vorschlag: 1 }), () => Promise.resolve(null), ["c"]
	);
}).then(() => {
	gleich(avesmapsGaretienAuswahlHat("c"), true,
		"🔴 der Server hat NICHTS entschieden -- also bleibt das Objekt gewählt");

	// Und die Gegenprobe: hat er entschieden, geht es.
	frischerStand();
	avesmapsGaretienAuswahlUmschalten("c", c);
	return garetienHandlungSendenMitMeldung(
		{ action: "objekte_ablehnen", keys: ["c"] }, "„Perz\" abgelehnt.",
		() => Promise.resolve({ abgelehnt: 1 }), () => Promise.resolve(null), ["c"]
	);
}).then(() => {
	gleich(avesmapsGaretienAuswahlHat("c"), false, "entschieden -- also entlassen");

	// 💣 EIN FEHLGESCHLAGENER RUF ENTLÄSST NICHTS. Sonst stünde das Objekt abgewählt und
	// unabgelehnt da, und der Editor hielte die Arbeit für getan.
	frischerStand();
	avesmapsGaretienAuswahlUmschalten("a", a);
	avesmapsGaretienStageHinzufuegen([a]);
	return garetienHandlungSendenMitMeldung(
		{ action: "decline", ids: [1] }, "abgelehnt.",
		() => Promise.reject(new Error("Netz weg")), () => Promise.resolve(null), ["a"]
	);
}).then(() => {
	gleich(avesmapsGaretienAuswahlHat("a"), true, "💣 nach einem Fehlschlag bleibt das Objekt gewählt");
	gleich(avesmapsGaretienStageHat("a"), true, "💣 und liegt weiter auf der Stage");
	return mengenWeg();
}).then(() => ruecknahmeWeg())
	.then(() => {
		console.log("OK -- " + checks + " Zusicherungen");
	})
	.catch((fehler) => { console.error(fehler); process.exit(1); });

// =================================================================================================
// 4. ERZEUGER 2 -- „Auswahl ablehnen" reicht die Schlüssel der Menge weiter, die auch die
//    Meldung zählt (garetienLaesstSichEntscheiden).
// =================================================================================================
const leistenEreignis = (name) => ({
	target: {
		closest(sel) {
			return sel === "[data-auswahl]"
				? { disabled: false, getAttribute: (x) => (x === "data-auswahl" ? name : null) }
				: null;
		},
	},
});

function mengenWeg() {
	frischerStand();
	avesmapsGaretienAuswahlUmschalten("a", a);
	avesmapsGaretienAuswahlUmschalten("c", c);   // eines MIT, eines OHNE Vorschlag
	avesmapsGaretienStageHinzufuegen([a, c]);

	let geschickt = [];
	const werkzeuge = {
		sendenMenge: (rumpf, ids, meldung, objektRumpf, entlassen) => {
			geschickt.push({ rumpf, ids, objektRumpf, entlassen });
			return "ok";
		},
		fragen: () => true,
	};
	garetienAuswahlleisteKlick(leistenEreignis("auswahl_ablehnen"), [a, b, c], 7, werkzeuge);
	gleich(geschickt.length, 1, "die Auswahlleiste schickt");
	tief(geschickt[0].entlassen.slice().sort(), ["a", "c"],
		"🔴 entlassen werden BEIDE gewählten -- auch das Objekt OHNE Vorschlag, das als Schlüssel reist");
	gleich(geschickt[0].entlassen.indexOf("b"), -1,
		"💣 und der ungewählte Nachbar ist NICHT dabei");

	// 💣 Die Gegenprobe: „Auswahl wieder vorschlagen" entlässt nichts.
	geschickt = [];
	garetienAuswahlleisteKlick(leistenEreignis("auswahl_wieder"), [a, b, c], 7, werkzeuge);
	gleich(geschickt.length, 1, "„Auswahl wieder vorschlagen\" schickt ebenfalls");
	gleich(geschickt[0].entlassen, null, "💣 aber entlässt NICHTS");

	// --- Und die Mengen-Tür entlässt wirklich, VOR ihrem Listenlauf. ---------------------------
	frischerStand();
	avesmapsGaretienAuswahlUmschalten("a", a);
	avesmapsGaretienStageHinzufuegen([a]);
	let beimLauf = null;
	return garetienMengeSendenMitMeldung(
		{ action: "decline" }, [1], "1 Objekt abgelehnt.",
		() => Promise.resolve({ ok: true }),
		() => {
			beimLauf = { auswahl: avesmapsGaretienAuswahlHat("a"), stage: avesmapsGaretienStageHat("a") };
			return Promise.resolve(null);
		},
		null, ["a"]
	).then(() => {
		tief(beimLauf, { auswahl: false, stage: false },
			"💣 auch die MENGEN-Tür entlässt VOR dem Listenlauf");
	});
}

// =================================================================================================
// 5. ERZEUGER 3 -- „Zurücknehmen und ablehnen". Die gewöhnliche Rücknahme entlässt NICHTS.
// =================================================================================================
const uebernommen = {
	key: "u", name: "Gardel", urteil: "neu", stand: "uebernommen", geometrie_typ: "LineString",
	items: [{ id: 501, change_type: "new", apply_state: "done", selected: 0 }],
};
const ruecknahmeZiel = (handlung) => kette([{
	passt: ['[data-handlung="ruecknahme"]', '[data-handlung="ruecknahme_ablehnen"]',
		"[data-handlung]", "[data-key]"],
	attribute: { "data-handlung": handlung, "data-key": "u" },
}]);

function ruecknahmeWeg() {
	let gerufen = [];
	const ruecknahmeSenden = (ids, runId, ablehnenIds, entlassen) => {
		gerufen.push({ ids, ablehnenIds, entlassen });
		return "ok";
	};

	gerufen = [];
	garetienRuecknahmeKlick({ target: ruecknahmeZiel("ruecknahme_ablehnen") }, [uebernommen], 7,
		ruecknahmeSenden, () => true);
	gleich(gerufen.length, 1, "„Zurücknehmen und ablehnen\" schickt");
	tief(gerufen[0].entlassen, ["u"], "🔴 und reicht seinen Schlüssel zum Entlassen weiter");

	gerufen = [];
	garetienRuecknahmeKlick({ target: ruecknahmeZiel("ruecknahme") }, [uebernommen], 7,
		ruecknahmeSenden, () => true);
	gleich(gerufen.length, 1, "die gewöhnliche Rücknahme schickt ebenfalls");
	gleich(gerufen[0].ablehnenIds, null, "sie lehnt nichts ab");
	gleich(gerufen[0].entlassen, null,
		"💣 und entlässt deshalb nichts -- sie stellt das Objekt zurück in den Arbeitsvorrat");

	// --- Und der ECHTE Sender entlässt auch wirklich. -----------------------------------------
	// 🔴 Er hängt an `avesmapsGaretienRufe`, das sich nicht hereinreichen lässt -- gefälscht wird
	// deshalb `fetch`, eine Etage tiefer. Nur so wird dieser Erzeuger GEFAHREN statt gelesen; eine
	// Zusicherung über den Aufruf im Quelltext wäre Vakuum.
	const aktionen = [];
	let beimListenlauf = null;
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse(String((optionen && optionen.body) || "{}"));
		aktionen.push(rumpf.action);
		if (rumpf.action === "liste") {
			beimListenlauf = avesmapsGaretienAuswahlHat("u");
			return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: [], reiter: {} }) });
		}
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, zurueckgenommen: 1 }) });
	};

	frischerStand();
	avesmapsGaretienAuswahlUmschalten("u", uebernommen);
	avesmapsGaretienStageHinzufuegen([uebernommen]);
	return api.garetienRuecknahmeSenden(501, 7, [501], ["u"]).then(() => {
		tief(aktionen, ["ruecknahme", "decline", "liste"],
			"der echte Sender geht zuerst zurücknehmen, dann ablehnen, dann Liste: " + aktionen.join(", "));
		gleich(beimListenlauf, false,
			"💣 und beim Listenlauf ist das Objekt schon entlassen -- dieselbe Reihenfolge wie bei den zwei Türen");
		gleich(avesmapsGaretienAuswahlHat("u"), false, "danach ist es abgewählt");
		gleich(avesmapsGaretienStageHat("u"), false, "und von der Stage");

		// 💣 UND OHNE ABLEHNUNG ENTLÄSST DERSELBE SENDER NICHTS -- gefahren, nicht gelesen.
		frischerStand();
		avesmapsGaretienAuswahlUmschalten("u", uebernommen);
		return api.garetienRuecknahmeSenden(501, 7, null, null).then(() => {
			gleich(avesmapsGaretienAuswahlHat("u"), true,
				"💣 eine gewöhnliche Rücknahme lässt die Auswahl stehen");
		});
	});
}
