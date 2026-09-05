// „Innerorts einfügen (Stadt)" -- der zweite Knopf neben „Neu einfügen" im Garetien Importer.
// Entwurf: docs/superpowers/specs/2026-09-02-innerorts-import-design.md §4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-innerorts-knopf.test.js
//
// 🔴 Geprueft werden die REINEN Haelften (Befund-Leser, Knopfleiste, Tooltip, Listenzeile, Hinweis)
// UND der Klickverteiler garetienNeuKlick mit einer fetch-Attrappe -- gemessen am ERGEBNIS, an der
// Folge der Anfragen, die wirklich hinausgehen (dieselbe Bauform wie garetien-handlungen.test.js).

"use strict";

const path = require("path");
const assert = require("assert");

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

["garetienInnerortsOrt", "garetienHandlungen", "garetienHandlungTitel", "garetienNeuKlick",
	"garetienNeuIstZusatz", "garetienZeileMarkup", "garetienEingefuegtWirdUebernommenHinweis",
].forEach((name) => wahr(typeof mod[name] === "function", name + " fehlt im Export"));

const namen = (objekt) => mod.garetienHandlungen(objekt).map((k) => k.name);
const knopf = (objekt, name) => mod.garetienHandlungen(objekt).filter((k) => k.name === name)[0];

// Ein Tempel, fuer den der Server beim „Holen & Rechnen" einen Befund mitgeschickt hat.
const mitBefund = {
	key: "ggp:Bauwerke:Tempel:Garetien:Wandlether Rondratempel", name: "Wandlether Rondratempel",
	typ: "Tempel", urteil: "neu", grund: 'nächstes "Wandleth" nur 0,1 Meilen entfernt, aber anderer Name',
	abschnitte: [], innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.09 },
	items: [{ id: 41, change_type: "new", selected: 1 }],
};
// Derselbe Vorschlag ohne Befund -- die PHP-Leerform ist `[]`, kein `null`.
const ohneBefund = Object.assign({}, mitBefund, {
	key: "ggp:Bauwerke:Tempel:Garetien:Ferner Tempel", name: "Ferner Tempel", innerorts: [],
});
// Ein Lauf von vor dem 02.09.2026 kennt das Feld gar nicht.
const altLauf = Object.assign({}, mitBefund, { key: "alt", name: "Alt" });
delete altLauf.innerorts;

// =================================================================================================
// A. Der Befund-Leser -- gelesen, nicht gerechnet
// =================================================================================================
gleich(mod.garetienInnerortsOrt(mitBefund), "Wandleth", "der Ortsname kommt aus dem Befund");
gleich(mod.garetienInnerortsOrt(ohneBefund), "",
	"💣 die PHP-Leerform `[]` ist in JS ein Objekt ohne Namen -- kein Ort, kein Fehler");
gleich(mod.garetienInnerortsOrt(altLauf), "", "ein alter Lauf ohne das Feld: kein Ort");
gleich(mod.garetienInnerortsOrt(null), "", "nichts: kein Ort");
gleich(mod.garetienInnerortsOrt({ innerorts: { name: "  " } }), "", "ein leerer Name zaehlt nicht");

// =================================================================================================
// B. Die Knopfleiste
// =================================================================================================
tief(namen(mitBefund), ["neu", "innerorts", "ablehnen"],
	"🔴 direkt NEBEN „neu\", als dessen Alternative -- nicht am Ende der Leiste");
tief(namen(ohneBefund), ["neu", "ablehnen"],
	"🔴 ohne Befund steht der Knopf GAR NICHT da -- kein dauerhaft ausgegrauter Zwilling");
tief(namen(altLauf), ["neu", "ablehnen"], "ein alter Lauf: auch nicht");
const k = knopf(mitBefund, "innerorts");
wahr(k.beschriftung.startsWith("Innerorts einfügen (Wandleth)"),
	"der Ortsname steht IM Knopf, nicht im Hilfetext: " + k.beschriftung);
gleich(k.ton, "", "🔴 NEUTRAL -- gruen kodiert „legt etwas auf der Karte an\", und genau das tut er nicht");
gleich(knopf(mitBefund, "neu").ton, "go", "(der Nachbar „neu\" bleibt gruen)");
gleich(k.disabled, false, "und er ist scharf");
tief(k.ids, knopf(mitBefund, "neu").ids,
	"🔴 DIESELBE MENGE wie „neu\" -- ein anderer ZIELORT fuer denselben Vorschlag, nicht ein anderer Vorschlag");
tief(k.ids, [41], "naemlich das new-Item");
const titel = mod.garetienHandlungTitel("innerorts", mitBefund);
wahr(titel.includes("Wandleth") && titel.includes("OHNE Position"),
	"der Tooltip nennt die Stadt und sagt, dass kein Kartenpunkt entsteht: " + titel);
// Ein Ergaenzungsfall traegt zwar „neu" (trotzdem anlegen), aber der Server schickt dort keinen Befund.
const ergaenzung = {
	key: "e", name: "Wandlether Rahjatempel", urteil: "ergaenzung", innerorts: [],
	abschnitte: [{ public_id: "g-1", name: "Wandlether Rahjatempel" }],
	items: [
		{ id: 50, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0,
			abschnitt: { public_id: "g-1", name: "Wandlether Rahjatempel" } },
		{ id: 51, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
	],
};
wahr(namen(ergaenzung).includes("neu") && !namen(ergaenzung).includes("innerorts"),
	"ohne Befund kein Angebot, auch wenn „neu\" (trotzdem anlegen) dasteht");

// =================================================================================================
// C. Der Klick: EIN Weg mit „neu", und genau EIN anderer Wert
// =================================================================================================
function kette(knoten) {
	const kandidaten = knoten.map((k2) => Object.assign({
		getAttribute(name) {
			return Object.prototype.hasOwnProperty.call(k2.attribute || {}, name)
				? k2.attribute[name] : null;
		},
	}, k2));
	// Ehrlicher `closest`: eine Auswahl kann MEHRERE, kommagetrennte Alternativen tragen.
	kandidaten[0].closest = function (auswahl) {
		const teile = String(auswahl).split(",").map(function (t) { return t.trim(); });
		for (const kand of kandidaten) {
			for (const teil of teile) {
				if ((kand.passt || []).indexOf(teil) !== -1) { return kand; }
			}
		}
		return null;
	};
	return kandidaten[0];
}
function ziel(handlung, key, options) {
	return kette([Object.assign({
		passt: ['[data-handlung="' + handlung + '"]', "[data-handlung]", "[data-key]"],
		attribute: { "data-handlung": handlung, "data-key": key },
	}, options || {})]);
}

async function pruefeKlick() {
	const echtesFetch = global.fetch;
	const gestellt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		gestellt.push({ pfad: String(pfad), rumpf: rumpf });
		let roh;
		if (rumpf.action === "apply") {
			roh = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1,
				remaining: 0, skipped: 0, declined: 0 };
		} else if (rumpf.action === "liste" && rumpf.stand === "uebernommen") {
			roh = { ok: true, objekte: [] };
		} else {
			roh = { ok: true, plan_run_id: 7, gesamt: 0, objekte: [], bilanz: {}, reiter: {}, facetten: {} };
		}
		return Promise.resolve({ json: () => Promise.resolve(roh) });
	};
	try {
		const gefragt = [];
		const nein = (text) => { gefragt.push(text); return false; };

		const knopfDom = ziel("innerorts", mitBefund.key);
		const lauf = mod.garetienNeuKlick({ target: knopfDom }, [mitBefund], 7, nein);
		wahr(lauf && typeof lauf.then === "function", "der Klick wird uebernommen und wirklich ausgefuehrt");
		gleich(knopfDom.disabled, true, "der Knopf sperrt sich sofort, synchron");
		await lauf;
		tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste", "liste"],
			"derselbe Ablauf wie „Neu einfuegen\": anhaken, uebernehmen, Nachlese, Liste");
		tief(gestellt[0].rumpf.ids, [41], "mit dem new-Item");
		tief(gestellt[1].rumpf.einstellungen, { innerorts: true },
			"🔴 GENAU EIN anderer Wert: die Handeingabe ist `{innerorts:true}` -- nicht der Kasten „Eingefuegt wird\"");
		gleich(gefragt.length, 0, "und KEINE Rueckfrage");

		// Die Rueckfrage vor „trotzdem neu anlegen" gilt NUR „neu": eine Staette kollidiert mit keinem
		// Kartenobjekt, es gibt nichts, wovor zu warnen waere.
		gestellt.length = 0;
		const kollision = Object.assign({}, mitBefund, {
			key: "koll", urteil: "ergaenzung",
			abschnitte: [{ public_id: "g-2", name: "Nachbar" }],
			items: [
				{ id: 60, anlass: "ergaenzung", felder: ["quelle"], change_type: "changed", selected: 0,
					abschnitt: { public_id: "g-2", name: "Nachbar" } },
				{ id: 61, anlass: "zusatz", felder: [], change_type: "new", selected: 0 },
			],
		});
		wahr(mod.garetienNeuIstZusatz(kollision) === true, "(die Attrappe IST eine Kollision)");
		gleich(mod.garetienNeuKlick({ target: ziel("neu", kollision.key) }, [kollision], 7, nein), true,
			"„neu\" fragt -- und ein Nein zaehlt als uebernommen (nichts geht hinaus)");
		gleich(gefragt.length, 1, "genau eine Rueckfrage");
		gleich(gestellt.length, 0, "nichts hinausgeschickt");
		const laufI = mod.garetienNeuKlick({ target: ziel("innerorts", kollision.key) }, [kollision], 7, nein);
		wahr(laufI && typeof laufI.then === "function",
			"⚠️ „innerorts\" fragt NICHT -- es entsteht kein zweites Kartenobjekt, die Kollision kann es nicht geben");
		await laufI;
		gleich(gefragt.length, 1, "keine weitere Rueckfrage");
		tief(gestellt.map((a) => a.rumpf.action), ["select", "apply", "liste", "liste"], "und der Ablauf ist derselbe");
		gleich(gestellt[1].rumpf.einstellungen.innerorts, true, "mit innerorts");
	} finally {
		global.fetch = echtesFetch;
	}
}

// =================================================================================================
// D. „Uebernommen · innerorts" (Entwurf §4) -- die Zeile und der Hinweis sagen, WO das Objekt liegt
// =================================================================================================
function pruefeUebernommen() {
	const uebernommenKarte = Object.assign({}, mitBefund, {
		stand: "uebernommen", innerorts_uebernommen: false,
		items: [{ id: 41, change_type: "new", selected: 1, apply_state: "done" }],
	});
	const uebernommenStaette = Object.assign({}, uebernommenKarte, { innerorts_uebernommen: true });

	wahr(!mod.garetienZeileMarkup(uebernommenKarte).includes("innerorts"),
		"eine auf die KARTE uebernommene Zeile sagt nichts von innerorts");
	wahr(mod.garetienZeileMarkup(uebernommenStaette).includes("· innerorts"),
		"🔴 Entwurf §4: „Uebernommen · innerorts\" -- die Zeile sagt, wo das Objekt liegt");
	wahr(!mod.garetienZeileMarkup(Object.assign({}, mitBefund, { innerorts_uebernommen: true })).includes("· innerorts"),
		"...aber nur an einer UEBERNOMMENEN Zeile (das Feld allein, ohne Stand, ist keine Aussage)");

	const hinweisKarte = mod.garetienEingefuegtWirdUebernommenHinweis(uebernommenKarte);
	wahr(hinweisKarte.includes("Liegt bereits auf der Karte"), "auf der Karte: der bisherige Satz");
	const hinweisStaette = mod.garetienEingefuegtWirdUebernommenHinweis(uebernommenStaette);
	wahr(hinweisStaette.includes("Liegt als Stätte in „Wandleth\"") && !hinweisStaette.includes("Liegt bereits auf der Karte"),
		"als Staette: der Satz nennt die Stadt und behauptet keinen Kartenpunkt: " + hinweisStaette);
	wahr(hinweisStaette.includes("ohne Position auf der Karte"),
		"und er sagt ausdruecklich, dass es keine Position gibt -- sonst sucht ein Editor den Punkt vergebens");
	wahr(hinweisStaette.includes("Zurücknehmen"), "und die Ruecknahme wird weiter angeboten");
}

pruefeKlick().then(() => {
	pruefeUebernommen();
	console.log("OK: " + checks + " Pruefungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
