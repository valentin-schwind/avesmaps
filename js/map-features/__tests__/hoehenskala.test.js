// js/map-features/__tests__/hoehenskala.test.js
//
// Die Höhenskala im Topographie-Dialog (Fall #79). Aus dem Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/hoehenskala.test.js
// Exit 0 = alle Zusicherungen gehalten.
//
// Geprüft wird der REINE Rechner. Was er nicht entscheidet — Kürzen, Malen, Messen —, gehört dem
// Dialog; was er entscheidet, sind genau die Regeln, an denen der Entwurf hängt
// (docs/superpowers/specs/2026-08-18-hoehenskala-legende-design.md §4).
"use strict";

const assert = require("assert");
const skala = require("../ecosystem-hoehenskala.js");

let bestanden = 0;
function pruefe(was, fn) {
	fn();
	bestanden++;
	console.log("  ok  " + was);
}

// ---- Der Platzhalter --------------------------------------------------------------------------
pruefe("ein Gipfel ohne Höhe zählt als 5.000 — wie im Feldbau, sonst steht er woanders als gemalt", () => {
	assert.strictEqual(skala.avesmapsHoehenskalaGipfelhoehe({ name: "X" }), 5000);
	assert.strictEqual(skala.avesmapsHoehenskalaGipfelhoehe({ name: "X", hoehe: null }), 5000);
	assert.strictEqual(skala.avesmapsHoehenskalaGipfelhoehe({ name: "X", hoehe: 0 }), 5000);
	assert.strictEqual(skala.avesmapsHoehenskalaGipfelhoehe({ name: "X", hoehe: 2600 }), 2600);
});

// ---- Marken ------------------------------------------------------------------------------------
const raschtulswall = [
	{ name: "Djer Tulam", hoehe: 9000 },
	{ name: "Raschtul Kandscharot", hoehe: 5000 },
	{ name: "Thron des Greifen", hoehe: 5000 },
	{ name: "Sturmspitze", hoehe: 6318 },
];

pruefe("exakt gleich hohe Gipfel teilen sich EINE Marke (der Normalfall, nicht der Sonderfall)", () => {
	const marken = skala.avesmapsHoehenskalaMarken(raschtulswall, 9000);
	assert.strictEqual(marken.length, 3, "vier Gipfel, aber drei verschiedene Höhen");
	const fuenftausend = marken.find((m) => m.schritt === 5000);
	assert.strictEqual(fuenftausend.namen.length, 2);
	assert.strictEqual(fuenftausend.gruppe, true);
	assert.strictEqual(marken.find((m) => m.schritt === 9000).gruppe, false);
});

pruefe("die Marke sitzt bei höhe/weisspunkt — linear, wie die Karte malt", () => {
	const marken = skala.avesmapsHoehenskalaMarken(raschtulswall, 9000);
	const beiHoehe = (h) => marken.find((m) => m.schritt === h).prozent;
	assert.strictEqual(Math.round(beiHoehe(9000)), 100);
	assert.strictEqual(Math.round(beiHoehe(6318) * 10) / 10, 70.2);
	assert.strictEqual(Math.round(beiHoehe(5000) * 10) / 10, 55.6);
});

pruefe("ein Gipfel über dem Weisspunkt wird geklemmt, nicht neben den Balken gemalt", () => {
	const marken = skala.avesmapsHoehenskalaMarken([{ name: "Zu hoch", hoehe: 20000 }], 9000);
	assert.strictEqual(marken[0].prozent, 100);
});

pruefe("ohne Weisspunkt gibt es keine Skala — statt einer Division durch null", () => {
	assert.deepStrictEqual(skala.avesmapsHoehenskalaMarken(raschtulswall, 0), []);
	assert.deepStrictEqual(skala.avesmapsHoehenskalaAchse(null), []);
});

// ---- Beschriftungen ----------------------------------------------------------------------------
pruefe("Beschriftungen fassen nach PLATZ zusammen, nicht nach Gleichheit", () => {
	// Zwei Gipfel 100 Schritt auseinander: bei Weisspunkt 9.000 und 409 px Balken sind das
	// 100/9000*409 = 4,5 px -- weit unter den 18 px Mindestabstand.
	const eng = skala.avesmapsHoehenskala(
		[{ name: "Wachtfels", hoehe: 2500 }, { name: "Grauer Zahn", hoehe: 2600 }], 9000, 409);
	assert.strictEqual(eng.marken.length, 2, "zwei Marken bleiben — sie kollidieren erst unter 8 px");
	assert.strictEqual(eng.beschriftungen.length, 1, "aber nur EINE Beschriftung");
	assert.strictEqual(eng.beschriftungen[0].name, "2 Gipfel");
});

pruefe("eine Gruppe verschieden hoher Gipfel nennt eine SPANNE, nie eine einzelne Zahl", () => {
	const eng = skala.avesmapsHoehenskala(
		[{ name: "Wachtfels", hoehe: 2450 }, { name: "Grauer Zahn", hoehe: 2600 }], 9000, 409);
	assert.strictEqual(eng.beschriftungen[0].zahl, "2.450–2.600");
});

pruefe("eine Gruppe gleich hoher Gipfel nennt die EINE Zahl, ohne Spanne", () => {
	const wall = skala.avesmapsHoehenskala(raschtulswall, 9000, 409);
	const fuenf = wall.beschriftungen.find((b) => b.zahl === "5.000");
	assert.ok(fuenf, "die 5.000er stehen als eine Zeile da");
	assert.strictEqual(fuenf.name, "2 Gipfel");
});

pruefe("kein bevorzugter Name in einer Gruppe — beide stehen im Tooltip", () => {
	const wall = skala.avesmapsHoehenskala(raschtulswall, 9000, 409);
	const fuenf = wall.beschriftungen.find((b) => b.zahl === "5.000");
	assert.strictEqual(fuenf.name.indexOf("Raschtul"), -1, "kein Name gewinnt");
	assert.strictEqual(fuenf.name.indexOf("Thron"), -1);
	assert.ok(fuenf.titel.indexOf("Raschtul Kandscharot · 5.000") >= 0);
	assert.ok(fuenf.titel.indexOf("Thron des Greifen · 5.000") >= 0);
});

pruefe("weit auseinanderliegende Gipfel behalten JEDER seinen Namen", () => {
	const wall = skala.avesmapsHoehenskala(raschtulswall, 9000, 409);
	assert.strictEqual(wall.beschriftungen.length, 3);
	assert.ok(wall.beschriftungen.some((b) => b.name === "Djer Tulam"));
	assert.ok(wall.beschriftungen.some((b) => b.name === "Sturmspitze"));
});

pruefe("eine Kette knapper Nachbarn reisst nicht willkürlich ab — gemessen wird gegen den VORGÄNGER", () => {
	// Fünf Gipfel, je 4 px auseinander: das ist EINE Zeile, nicht zwei oder drei.
	const kette = [2000, 2100, 2200, 2300, 2400].map((h, i) => ({ name: "G" + i, hoehe: h }));
	const gebaut = skala.avesmapsHoehenskala(kette, 9000, 409);
	assert.strictEqual(gebaut.marken.length, 5);
	assert.strictEqual(gebaut.beschriftungen.length, 1);
	assert.strictEqual(gebaut.beschriftungen[0].name, "5 Gipfel");
	assert.strictEqual(gebaut.beschriftungen[0].zahl, "2.000–2.400");
});

pruefe("der gemessene Grenzfall: 18 px trennen, 17 px fassen zusammen", () => {
	const proSchritt = 9000 / 409;                       // Schritt je px
	const knappGetrennt = [
		{ name: "A", hoehe: 3000 },
		{ name: "B", hoehe: 3000 + Math.ceil(19 * proSchritt) },
	];
	const knappZusammen = [
		{ name: "A", hoehe: 3000 },
		{ name: "B", hoehe: 3000 + Math.floor(17 * proSchritt) },
	];
	assert.strictEqual(skala.avesmapsHoehenskala(knappGetrennt, 9000, 409).beschriftungen.length, 2);
	assert.strictEqual(skala.avesmapsHoehenskala(knappZusammen, 9000, 409).beschriftungen.length, 1);
});

// ---- Die Namensbreite ---------------------------------------------------------------------------
pruefe("rechts am Balken darf der Name seine volle Breite haben", () => {
	const platz = skala.avesmapsHoehenskalaNamensbreite(100, 409, 34);
	assert.strictEqual(platz.gekippt, false);
	assert.strictEqual(platz.breitePx, skala.HOEHENSKALA_NAME_BREITE_PX);
});

pruefe("links am Balken wird der NAME kürzer — die Zahl bleibt unangetastet", () => {
	// Marke bei 17,3 %: 70,8 px vom linken Rand, also 70,8/cos(52°) = 115 px Textlänge,
	// minus Zahl (34) und Lücke (4) = 77 -> die Vorgabe deckelt auf 76.
	const weitLinks = skala.avesmapsHoehenskalaNamensbreite(10, 409, 34);
	assert.strictEqual(weitLinks.gekippt, false);
	assert.ok(weitLinks.breitePx < skala.HOEHENSKALA_NAME_BREITE_PX,
		"bei 10 % ist weniger Platz als die Vorgabe");
	assert.ok(weitLinks.breitePx >= 24, "aber genug für einen erkennbaren Rest");
});

pruefe("ganz links kippt die Zeile, statt aus dem Fenster zu laufen", () => {
	const amRand = skala.avesmapsHoehenskalaNamensbreite(2, 409, 34);
	assert.strictEqual(amRand.gekippt, true);
});

// ---- Die Achse -----------------------------------------------------------------------------------
pruefe("die Achse rundet auf 50 — die Auflösung der Regler", () => {
	const achse = skala.avesmapsHoehenskalaAchse(9000);
	assert.deepStrictEqual(achse.map((a) => a.text), ["0", "2.250", "4.500", "6.750", "9.000"]);
});

pruefe("der oberste Wert ist der Weisspunkt SELBST, ungerundet", () => {
	// 🪤 11.437 gerundet wäre 11.450 — und ausgerechnet die eine Zahl, um die es geht, wäre falsch.
	const achse = skala.avesmapsHoehenskalaAchse(11437);
	assert.strictEqual(achse[4].text, "11.437");
	assert.strictEqual(achse[2].text, "5.700", "die Zwischenwerte runden weiter auf 50");
});

pruefe("Tausenderpunkte ohne toLocaleString — sonst sähe der Prüfstand anders aus als live", () => {
	assert.strictEqual(skala.avesmapsHoehenskalaZahl(9000), "9.000");
	assert.strictEqual(skala.avesmapsHoehenskalaZahl(950), "950");
	assert.strictEqual(skala.avesmapsHoehenskalaZahl(11437), "11.437");
	assert.strictEqual(skala.avesmapsHoehenskalaZahl(0), "0");
});

// ---- Der Mindestabstand hängt am Winkel ----------------------------------------------------------
pruefe("Mindestabstand und Winkel sind EIN Wert in zwei Formeln", () => {
	const erwartet = Math.ceil(skala.HOEHENSKALA_ZEILENHOEHE_PX
		/ Math.sin(skala.HOEHENSKALA_WINKEL_GRAD * Math.PI / 180));
	assert.strictEqual(skala.HOEHENSKALA_MIN_ABSTAND_PX, erwartet);
	assert.strictEqual(skala.HOEHENSKALA_MIN_ABSTAND_PX, 18, "live gemessen 18.08.2026");
});

console.log("\n" + bestanden + " Zusicherungen gehalten.");
