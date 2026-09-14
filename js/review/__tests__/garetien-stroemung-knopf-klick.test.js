"use strict";

/*
 * DER STRÖMUNGS-KNOPF WIRD GEKLICKT, NICHT GETIPPT
 * ================================================
 * Befund 14.09.2026, live an „Alffe" gemessen: Klick auf „wie die Quelle ⇄" → Beschriftung bleibt,
 * die Karte wird kein einziges Mal gezeichnet. Dasselbe Element als `input`-Ereignis → „umgekehrt ⇄"
 * und Dreiecke in Gegenrichtung.
 *
 * 💣 Die Ursache war die Verdrahtung, nicht der Schreiber: `garetienEingabenAendern` ist der EINE
 * Schreiber von `flowDir`, und sein einziger Aufrufer war der `input`-Zuhörer der Detailspalte. Ein
 * `<button>` löst kein `input` aus. Der Knopf bestand seit dem 02.09.2026 und tat nie etwas.
 *
 * 🪤 Warum das kein Test sah: garetien-endkreuzung-stroemung.test.js setzt
 * `garetienEingabenZustandZu(o).flowDir = "reverse"` DIREKT und klickt den Knopf nie. Dieser Test
 * fährt deshalb den ECHTEN Klick-Zuhörer, den `bindFenster` an `#garetien-detailcol` hängt, mit
 * einem Knopf, der aus dem GERENDERTEN Markup gebaut ist -- kein Aufruf der Schreibfunktion von Hand.
 *
 * Ausfuehren, vom Repo-Wurzelverzeichnis:
 *   node js/review/__tests__/garetien-stroemung-knopf-klick.test.js
 */

const assert = require("node:assert");
const path = require("node:path");

global.AVESMAPS_LABEL_ART_NAMEN =
	require(path.resolve(__dirname, "..", "..", "ui", "label-arten.js")).AVESMAPS_LABEL_ART_NAMEN;
global.avesmapsLabelArtName =
	require(path.resolve(__dirname, "..", "..", "ui", "label-arten.js")).avesmapsLabelArtName;

// ⚠️ Der Detailaufbau fragt nebenbei „Nähe" und „Wiki-Landschaft" beim Server. Eine Zusage, die nie
// eingelöst wird, hält das still: keine echte Netzanfrage, und keine späte Antwort, die die Spalte
// nach den Zusicherungen noch einmal neu baut.
global.fetch = function () { return new Promise(function () {}); };

const { ladeImporter } = require("./helfer/garetien-testumgebung.js");
const { api, dom } = ladeImporter(["garetien-detailcol"]);

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum); checks++; }

// ---- Ein Element aus dem gerenderten Markup ------------------------------------------------------
// 🔴 Gebaut wird aus dem, was `garetienDetailRendern` WIRKLICH in die Spalte schreibt -- nicht aus
// einer abgeschriebenen Attributliste. Ändert sich die Bauform des Knopfes, merkt es dieser Test.
function attributeAus(roh) {
	const attr = {};
	const muster = /([a-zA-Z-]+)(?:="([^"]*)")?/g;
	let t;
	while ((t = muster.exec(roh)) !== null) { attr[t[1]] = t[2] === undefined ? "" : t[2]; }
	return attr;
}

// Ein minimaler `closest` für EIN Element ohne Eltern: Tag, `.klasse`, `[attr]`, `[attr="wert"]`,
// kommagetrennt. 💣 Was er nicht versteht, WIRFT -- ein stilles `null` auf einen Selektor mit
// Kombinator liesse einen Verteiler vorbeilaufen, der im Browser zugreifen würde.
function macheKnoten(tag, attr, text) {
	const klassen = String(attr.class || "").split(/\s+/).filter(Boolean);
	const knoten = {
		tagName: tag.toUpperCase(),
		textContent: text,
		disabled: Object.prototype.hasOwnProperty.call(attr, "disabled"),
		type: attr.type || (tag === "button" ? "submit" : ""),
		checked: Object.prototype.hasOwnProperty.call(attr, "checked"),
		value: attr.value || "",
		getAttribute(n) { return Object.prototype.hasOwnProperty.call(attr, n) ? attr[n] : null; },
		hasAttribute(n) { return Object.prototype.hasOwnProperty.call(attr, n); },
		closest(selektor) {
			const passt = String(selektor).split(",").some(function (teil) {
				const s = teil.trim();
				const m = /^([a-z]*)((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/.exec(s);
				if (!m) { throw new Error("Selektor versteht der Test nicht: " + s); }
				if (m[1] && m[1] !== tag) { return false; }
				const stuecke = m[2].match(/\.[\w-]+|\[[^\]]+\]/g) || [];
				return stuecke.every(function (st) {
					if (st[0] === ".") { return klassen.indexOf(st.slice(1)) !== -1; }
					const a = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(st);
					if (!Object.prototype.hasOwnProperty.call(attr, a[1])) { return false; }
					return a[2] === undefined || attr[a[1]] === a[2];
				});
			});
			return passt ? knoten : null;
		},
	};
	return knoten;
}

function stroemungsKnopf() {
	const html = dom.html("#garetien-detailcol").replace(/\r\n/g, "\n");
	const m = /<button([^>]*data-gi-feld="flowDir"[^>]*)>([^<]*)<\/button>/.exec(html);
	return m ? macheKnoten("button", attributeAus(m[1]), m[2]) : null;
}

const detailcol = dom.el("#garetien-detailcol");
function klicke(ziel) { (detailcol._hoerer.click || []).forEach(function (fn) { fn({ target: ziel }); }); }

// ---- Die Karte als Messsonde -----------------------------------------------------------------------
const kartenRufe = [];
global.window.avesmapsGaretienKarteZeigen = function (objekte) { kartenRufe.push(objekte || []); };
function letzteRichtung(key) {
	const letzte = kartenRufe[kartenRufe.length - 1] || [];
	const o = letzte.filter(function (x) { return x && x.key === key; })[0];
	return o ? o.flowDir : undefined;
}

// =================================================================================================
// A. Der Aufbau: ein Flussweg liegt auf der Stage und ist geöffnet
// =================================================================================================
wahr((detailcol._hoerer.click || []).length >= 1,
	"bindFenster hängt einen Klick-Zuhörer an die Detailspalte -- sonst misst der Rest nichts");

const fluss = {
	key: "ggp:Gewaesser:Bach:Garetien:Probe!Probe", name: "Probe", typ: "Fluss", ziel: "path",
	subtyp: "Flussweg", kind: "", wiki: "ggp", stand: "offen", abschnitte: [],
	geometrie: [[10, 10], [12, 12], [14, 14]],
	items: [{ id: 1, change_type: "new", anlass: null }],
};
api.avesmapsGaretienStageHinzufuegen([fluss]);
// 🔴 Über den Stage-Reiter: nur `avesmapsGaretienListeHolen` füllt `zustand.objekte`, und genau
// diese Liste reicht der Zuhörer an die Schreibfunktion weiter.
api.garetienReiterSetzen("stage");
api.avesmapsGaretienListeHolen();
gleich(api.avesmapsGaretienFensterZustand().objekte.length, 1, "die Stage-Liste trägt den Fluss");

api.garetienDetailWaehlen(fluss.key, api.avesmapsGaretienFensterZustand().objekte);
const vorher = stroemungsKnopf();
wahr(vorher !== null, "die Detailspalte zeigt den Strömungs-Knopf: " + dom.html("#garetien-detailcol"));
gleich(vorher.textContent, "wie die Quelle ⇄", "vorbelegt auf die Richtung der Quelle");
gleich(api.garetienEingabenZustandZu(fluss).flowDir, "forward", "und der Zustand ebenso");

// =================================================================================================
// B. DER KLICK dreht die Richtung -- Zustand, Knopf, Karte, Server-Rumpf
// =================================================================================================
const rufeVorKlick = kartenRufe.length;
klicke(vorher);
gleich(api.garetienEingabenZustandZu(fluss).flowDir, "reverse",
	"🔴 ein Klick auf „wie die Quelle ⇄“ kehrt die Richtung um -- vor dem 14.09.2026 blieb sie stehen");
const nachher = stroemungsKnopf();
gleich(nachher.textContent, "umgekehrt ⇄", "die Beschriftung zeigt den neuen Zustand");
gleich(nachher.getAttribute("data-gi-wert"), "forward", "und der Knopf trägt den nächsten");
gleich(kartenRufe.length - rufeVorKlick, 1, "die Karte wird GENAU einmal neu gezeichnet");
gleich(letzteRichtung(fluss.key), "reverse", "und die Dreiecke bekommen die gedrehte Richtung");
gleich(api.garetienEingabenFuerServer(fluss).flow_dir, "reverse", "und so reist sie an den Server");

// Und zurück -- der NEU gerenderte Knopf hängt an derselben Delegation.
klicke(nachher);
gleich(api.garetienEingabenZustandZu(fluss).flowDir, "forward", "ein zweiter Klick dreht zurück");
gleich(stroemungsKnopf().textContent, "wie die Quelle ⇄", "samt Beschriftung");
gleich(letzteRichtung(fluss.key), "forward", "und Karte");

// =================================================================================================
// C. Die Riegel
// =================================================================================================
// ⚠️ Ein gesperrter Knopf (übernommenes Objekt) tut nichts -- das Attribut ist die Anzeige, der
// Riegel steht im Zuhörer (dieselbe Trennung wie bei den übrigen Verteilern der Spalte).
const gesperrt = macheKnoten("button",
	{ type: "button", "data-gi-feld": "flowDir", "data-gi-wert": "reverse", disabled: "" }, "x");
const rufeVorGesperrt = kartenRufe.length;
klicke(gesperrt);
gleich(api.garetienEingabenZustandZu(fluss).flowDir, "forward", "ein gesperrter Knopf dreht nichts");
gleich(kartenRufe.length, rufeVorGesperrt, "und zeichnet nichts");

// 🔴 NUR KNÖPFE. Häkchen und Zahlenfelder schreibt weiterhin der `input`-Zuhörer; liefe ein Klick
// auf ein Häkchen zusätzlich hier durch, hätte dasselbe Feld zwei Schreibwege.
const haken = macheKnoten("input",
	{ type: "checkbox", "data-gi-feld": "endpointCrossings" }, "");
klicke(haken);
gleich(api.garetienEingabenZustandZu(fluss).endpointCrossings, true,
	"ein Klick auf ein Häkchen schreibt über den Klick-Zuhörer nichts");

console.log("garetien-stroemung-knopf-klick: " + checks + " Pruefungen bestanden.");
