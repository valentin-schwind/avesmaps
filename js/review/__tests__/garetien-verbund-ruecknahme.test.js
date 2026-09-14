// Nachbesserung Runde 1 (14.09.2026), W-b: am übernommenen Verbund fehlen ↩ je Fragment in Block B
// und „Ganzen Verbund zurücknehmen (n)" in Block F (Entwurf §3, Mockup §6).
//
// 🔴 Ruling (Koordinator, bindend): kein neuer Endpunkt, kein neuer Rücknahmeweg. ↩ je Fragment
// löst DIESELBE Einzel-Rücknahme aus wie „Zurücknehmen" an einem Objekt (`data-handlung="ruecknahme"`,
// `garetienRuecknahmeKlick`) -- für genau dieses Fragment, ohne neuen Klick-Handler (der bestehende
// Verteiler matcht die Attribute unabhängig davon, wo der Knopf im Markup steht). „Ganzen Verbund
// zurücknehmen (n)" geht über den bestehenden MENGEN-Weg (`garetienRuecknahmeMengeAusfuehren`,
// derselbe Sender wie „Import zurücknehmen").
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-ruecknahme.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienVerbundBlockMarkup, garetienHandlungen, garetienHandlungsMarkup, garetienHandlungsRumpf,
	garetienVerbundSchluessel, garetienVerbundMitglieder, garetienVerbundPool,
} = mod;

let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }
function tief(ist, soll, was) { n++; assert.deepStrictEqual(ist, soll, was); }

// ---- Eine DOM-Attrappe, deren `closest` mehrere Alternativen versteht (Vorbild
// garetien-zurueck-nach-offen.test.js) -----------------------------------------------------------
function ziel(handlung, key) {
	const knoten = {
		disabled: false, textContent: "",
		getAttribute(a) {
			return a === "data-handlung" ? handlung : (a === "data-key" ? key : null);
		},
	};
	knoten.closest = function (auswahl) {
		const teile = String(auswahl).split(",").map((t) => t.trim());
		return teile.indexOf('[data-handlung="' + handlung + '"]') !== -1 ? knoten : null;
	};
	return knoten;
}

const QUELLE = { label: "Briefspiel (Garetien)" };
function fragment(nr, extra) {
	return Object.assign({
		key: "ggp:Waelder:Wald:Garetien:Silker Hain " + nr + "!Silker Hain " + nr,
		name: "Silker Hain " + nr, typ: "Wald", stand: "uebernommen", urteil: "neu", wiki: "ggp",
		ziel: "region", subtyp: "wald", kind: "vegetation", verbund_stamm: "Silker Hain", verbund_n: 3,
		geometrie: [[1, 1], [2, 1]], quelle: QUELLE, abschnitte: [],
		items: [{ id: 300 + nr, change_type: "new", anlass: null, apply_state: "done" }],
	}, extra || {});
}
const f1 = fragment(1);
const f2 = fragment(2);
const f3 = fragment(3);
const objekte = [f1, f2, f3];

// =================================================================================================
// 1. Block B: ↩ je übernommenem Fragment, statt reiner Anzeige
// =================================================================================================
const blockB = garetienVerbundBlockMarkup(f1, objekte);
pruefe(blockB !== "", "der Verbund-Block entsteht: " + blockB);
gleich((blockB.match(/data-handlung="ruecknahme"/g) || []).length, 3,
	"🔴 alle drei Fragmente tragen ein ↩ (dieselbe Handlung wie „Zurücknehmen“): " + blockB);
pruefe(blockB.includes('title="Nur dieses Fragment zurücknehmen"'),
	"…mit dem Titel des Mockups: " + blockB);
tief(
	(blockB.match(/data-handlung="ruecknahme" data-key="([^"]*)"/g) || [])
		.map((t) => t.replace(/^data-handlung="ruecknahme" data-key="/, "").replace(/"$/, "")),
	[f1.key, f2.key, f3.key],
	"je EIN ↩ mit dem Schlüssel SEINES EIGENEN Fragments"
);
pruefe(blockB.includes("jede Fläche einzeln rücknehmbar"),
	"🔴 die Notiz sagt, was der Knopf bedeutet (Mockup §6): " + blockB);
pruefe(!/\d+ Fragmente</.test(blockB.slice(0, blockB.indexOf("gi-seg"))),
	"…und nennt an dieser Stelle keine Fragmentzahl mehr");

// --- Gegenprobe: auf der Stage bleibt es beim ✕ (unverändert) ------------------------------------
const stageF1 = fragment(1, { stand: "offen" });
const stageF2 = fragment(2, { stand: "offen" });
// `avesmapsGaretienStageHat` liegt in dieser Testumgebung nicht am echten Modulzustand -- die
// STAGE-Gegenprobe steht deshalb in garetien-verbund-klick.test.js (Aufgabe 7/11), hier nur die
// ÜBERNOMMEN-Seite. Stattdessen: ein „offen"-Verbund bekommt gar kein ↩.
const blockBOffen = garetienVerbundBlockMarkup(stageF1, [stageF1, stageF2, fragment(3, { stand: "offen" })]);
gleich((blockBOffen.match(/data-handlung="ruecknahme"/g) || []).length, 0,
	"ein NICHT übernommener Verbund bekommt kein ↩: " + blockBOffen);
pruefe(!blockBOffen.includes("jede Fläche einzeln rücknehmbar"),
	"…und nicht die Übernommen-Notiz: " + blockBOffen);

// =================================================================================================
// 2. Block F: „Ganzen Verbund zurücknehmen (n)"
// =================================================================================================
const namen = (o, os) => garetienHandlungen(o, os).map((k) => k.name);
tief(namen(f1, objekte), ["ruecknahme", "verbund_ruecknahme", "ruecknahme_ablehnen"],
	"🔴 der neue Knopf steht neben „Zurücknehmen“: " + namen(f1, objekte));

const knopf = garetienHandlungen(f1, objekte).filter((k) => k.name === "verbund_ruecknahme")[0];
gleich(knopf.beschriftung, "Ganzen Verbund zurücknehmen (3)", "…mit der Zahl der Fragmente");
tief(knopf.ids.slice().sort((a, b) => a - b), [301, 302, 303],
	"…und den ids ALLER drei Fragmente, nicht nur des angezeigten");

const markup = garetienHandlungsMarkup(f1, objekte);
pruefe(/data-handlung="verbund_ruecknahme"/.test(markup), "der Knopf steht im Markup: " + markup);
pruefe(/btn--danger[^>]*data-handlung="verbund_ruecknahme"/.test(markup)
	|| /data-handlung="verbund_ruecknahme"[^>]*class="[^"]*btn--danger/.test(markup)
	|| markup.slice(markup.indexOf('data-handlung="verbund_ruecknahme"') - 80,
		markup.indexOf('data-handlung="verbund_ruecknahme"')).includes("btn--danger"),
	"🔴 in Gefahrenfarbe wie „Zurücknehmen“ -- er löscht auch Kartenobjekte: " + markup);

// --- Einzelobjekt übernommen -> kein „Ganzen Verbund"-Knopf, kein ↩ in B (B fehlt) ----------------
const einzel = {
	key: "ggp:solo", name: "Solo", stand: "uebernommen", urteil: "neu",
	geometrie: [[1, 1]], abschnitte: [], items: [{ id: 900, change_type: "new", apply_state: "done" }],
};
gleich(namen(einzel, [einzel]).indexOf("verbund_ruecknahme"), -1,
	"ein Einzelobjekt bekommt keinen „Ganzen Verbund“-Knopf: " + namen(einzel, [einzel]));
gleich(garetienVerbundBlockMarkup(einzel, [einzel]), "", "…und Block B fehlt ganz (kein Verbund)");

// =================================================================================================
// 3. Der Klickverteiler -- am ERGEBNIS gemessen (echter Klickweg, gefälschte Tür)
// =================================================================================================
const { garetienVerbundRuecknahmeKlick, garetienVerbundRuecknahmeFragmente } = mod;
pruefe(typeof garetienVerbundRuecknahmeKlick === "function", "der Verteiler ist exportiert");

tief(garetienVerbundRuecknahmeFragmente(f1, objekte).map((o) => o.key), [f1.key, f2.key, f3.key],
	"die Fragmente, ueber die der Knopf geht -- dieselbe Menge wie Block B");

let gesendet = [];
const senden = (ids, runId) => { gesendet.push([ids.slice().sort((a, b) => a - b), runId]); return "geschickt"; };
let gefragt = [];
const bestaetigt = (text) => { gefragt.push(text); return true; };

gleich(
	garetienVerbundRuecknahmeKlick({ target: ziel("verbund_ruecknahme", f1.key) }, objekte, 7, senden, bestaetigt),
	"geschickt", "der Klick schickt und reicht sein Ergebnis durch"
);
tief(gesendet[0], [[301, 302, 303], 7], "mit ALLEN drei ids und der Lauf-Nummer");
gleich(gefragt.length, 1, "🔴 mit Rückfrage -- dieselbe Form wie die Mengen-Rücknahme");

// --- Abgebrochen: nichts gesendet -----------------------------------------------------------------
gesendet = [];
gefragt = [];
const abgebrochen = () => { gefragt.push("nein"); return false; };
const ergebnisAbbruch = garetienVerbundRuecknahmeKlick(
	{ target: ziel("verbund_ruecknahme", f1.key) }, objekte, 7, senden, abgebrochen
);
gleich(gesendet.length, 0, "🔴 bei Abbruch wird NICHTS gesendet: " + JSON.stringify(gesendet));
pruefe(ergebnisAbbruch !== null, "…aber der Klick gilt als behandelt (kein Fall-Through)");

// --- Ein fremder Knopf lässt ihn kalt --------------------------------------------------------------
gesendet = [];
gleich(
	garetienVerbundRuecknahmeKlick({ target: ziel("ruecknahme", f1.key) }, objekte, 7, senden, bestaetigt),
	null, "ein Klick auf „Zurücknehmen“ gehört dem anderen Verteiler"
);
gleich(gesendet.length, 0, "und schickt hier nichts");

// --- Klick auf ↩ EINES Fragments -- geht ueber garetienRuecknahmeKlick, EXAKT wie „Zurücknehmen" ---
const { garetienRuecknahmeKlick } = mod;
let einzelGesendet = [];
const einzelSenden = (ids) => { einzelGesendet.push(ids); return "ok"; };
gleich(
	garetienRuecknahmeKlick({ target: ziel("ruecknahme", f2.key) }, objekte, 7, einzelSenden, bestaetigt),
	"ok", "das ↩ von Fragment 2 laeuft ueber DENSELBEN Verteiler wie „Zurücknehmen“"
);
tief(einzelGesendet, [302], "…und nimmt GENAU das Item von Fragment 2, keines der anderen");

// --- Nie über die geteilte Tür hinaus --------------------------------------------------------------
gleich(garetienHandlungsRumpf("verbund_ruecknahme", f1, 7), null,
	"„Ganzen Verbund zurücknehmen“ hat hier keinen Rumpf -- es hat seine eigene Tür");

// =================================================================================================
// 4. Die eigene Tür -- verdrahtet, ohne neuen Zuhörer
// =================================================================================================
const quelle = ohneKommentare(lies("js", "review", "review-garetien-importer.js"));
wahrQuelle(/function garetienVerbundRuecknahmeSenden/.test(quelle),
	"der Sender existiert im Quelltext");
wahrQuelle(/garetienRuecknahmeMengeAusfuehren\(/.test(
	quelle.slice(quelle.indexOf("function garetienVerbundRuecknahmeSenden"),
		quelle.indexOf("function garetienVerbundRuecknahmeSenden") + 600)),
	"…und ruft den BESTEHENDEN Mengen-Weg, keinen neuen");
wahrQuelle(/garetienVerbundRuecknahmeKlick\(ereignis, zustand\.objekte, zustand\.planRunId,\s*garetienVerbundRuecknahmeSenden/
	.test(quelle), "der Klickverteiler ist im bestehenden Zuhörer von #garetien-detailcol verdrahtet");
// 🔴 KEIN NEUER `addEventListener` auf der Detailspalte -- gezählt wird die Zahl der
// `detailEl.addEventListener`-Aufrufe, sie bleibt bei genau einem (derselbe Zuhörer wie für die
// übrigen Verteiler).
gleich((quelle.match(/detailEl\.addEventListener\("click"/g) || []).length, 1,
	"genau EIN Klick-Zuhörer auf der Detailspalte -- kein neuer Zuhörer für diesen Knopf");

function wahrQuelle(b, warum) { n++; assert.ok(b, warum); }

console.log("OK -- garetien-verbund-ruecknahme (" + n + " Zusicherungen)");
