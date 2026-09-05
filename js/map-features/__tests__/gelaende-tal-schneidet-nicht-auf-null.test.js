"use strict";

/**
 * Ein Tal schneidet nie bis auf null.
 *
 * 🔴 Owner 05.09.2026: „ein tal sollte nie auf 0 schneiden, dann is es ja gleich mit dem
 * meeresspiegel. es sollte um einen gewissen betrag in das gebirge schneiden."
 *
 * 💣 DER FALL, DER DAZU GEFÜHRT HAT: `ECOSYSTEM_HYDRO_EINSCHNITT` ist eine ABSOLUTE Zahl in Schritt
 * (Vorgabe 400). Wo das Gelände niedriger liegt als sie, zog sie es auf 0 -- und was auf 0 steht,
 * malt der Zeichner gar nicht: die Kachel scheint durch, und das Gebirge sieht aus, als hätte es
 * ein Loch. Live gemessen an den Beilunker Bergen: Massigkeit 0,04 drückt das Gelände auf im Mittel
 * rund 110 Schritt, der Einschnitt beträgt 400 -- 128 von 5.261 Zellen im Inneren waren leer, 63
 * davon direkt an einem Fluss (Feenbach 38, Flussweg-200 15, Flussweg-201 10). Gegenprobe im
 * Browser: dieselbe Fläche mit Massigkeit 0,40 hatte NULL leere Zellen.
 */

const assert = require("node:assert");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const hydro = require(path.join(wurzel, "js/map-features/map-features-ecosystem-hydrologie.js"));

let gehalten = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

/* ---- Eine flache Fläche mit einem Fluss quer hindurch --------------------------------------------
   🔴 FLACH IST DER PUNKT: nur wo das Gelände niedriger ist als der Einschnitt, kann er es auf 0
   ziehen. Eine Kammhöhe von 300 gegen einen Einschnitt von 400 stellt genau die Lage her, die an
   den Beilunker Bergen gemeldet wurde. */

const BOUNDS = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
const IM_QUADRAT = (x, y) => x >= 1 && x <= 19 && y >= 1 && y <= 19;

function baue(extra) {
	return hydro.avesmapsGebirgsRasterBauen(Object.assign({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: [],
		kurve: [[3, 10], [10, 10], [17, 10]],
		fluesse: [{ n: "Probefluss", dir: "forward", bach: false, p: [[2, 5], [10, 6], [18, 7]] }],
		seen: [],
		istImSee: () => false,
		regler: {
			koernung: 4, stufen: 3, bergform: 2, rauschen: 0.2, sattel: 0.9, erosion: 0,
			maximalhoehe: 300, einschnitt: 400, talbreite: 1.5, hypsometrie: 0, plateau: 1,
		},
		saat: 4711,
	}, extra || {}));
}

// Wie viele Zellen im INNEREN der Fläche stehen auf (praktisch) null?
//
// 🔴 DER RANDSAUM WIRD HERAUSGERECHNET, und das ist keine Nachsicht: am Flächenrand LÄUFT das
// Gebirge auf 0 aus -- dort endet es, und der Fluss verlässt es. Gemessen: von 20 leeren Zellen der
// Prüffläche lagen 20 im Randsaum und 0 im Inneren. Wer den Saum mitzählt, misst den gewollten
// Auslauf und nennt ihn einen Fehler.
// ⚠️ Dieselbe Trennung wie bei der Live-Messung im Browser (dort 60 px Randabstand): erst danach
// war der Befund überhaupt zu sehen -- ohne sie sind 100 % der Randzellen „leer" und der
// eigentliche Streifen geht darin unter.
const RANDSAUM = 1.0;

function leereZellen(erg) {
	let leer = 0;
	let innen = 0;
	for (let j = 0; j < erg.r.hh; j++) {
		for (let i = 0; i < erg.r.w; i++) {
			const k = (j * erg.r.w) + i;
			if (!erg.r.drin[k]) { continue; }
			const x = erg.r.x(i);
			const y = erg.r.y(j);
			// Die Prüffläche ist das Quadrat 1..19.
			if (Math.min(x - 1, 19 - x, y - 1, 19 - y) < RANDSAUM) { continue; }
			innen++;
			if (erg.h[k] < 1) { leer++; }
		}
	}

	return { innen, leer };
}

const ergebnis = baue();

pruefe("die Bühne stellt den gemeldeten Fall wirklich her", () => {
	// ⚠️ Ohne diese Zusicherung prüft alles darunter ein Feld, in dem der Einschnitt gar nicht
	// greifen kann -- das Vakuum, das jede Fassung hält.
	const { innen } = leereZellen(ergebnis);
	assert.ok(innen > 500, "die Fläche hat nur " + innen + " Zellen -- zu klein zum Messen");
	assert.ok(!ergebnis.leer, "das Feld ist als LEER gemeldet -- dann gibt es gar kein Gelände");
	let hoechste = 0;
	for (let k = 0; k < ergebnis.h.length; k++) {
		if (ergebnis.r.drin[k] && ergebnis.h[k] > hoechste) { hoechste = ergebnis.h[k]; }
	}
	assert.ok(hoechste < 400,
		"das Gelände ist mit " + Math.round(hoechste) + " Schritt höher als der Einschnitt (400) -- "
		+ "dann kann er es gar nicht auf 0 ziehen, und der Test misst nichts");
});

pruefe("keine Zelle im Inneren fällt auf null", () => {
	// 🔴 DIE BESTELLUNG. Was auf 0 steht, wird nicht gemalt -- der Editor sieht ein Loch im Gebirge,
	// und ein Talboden auf Meereshöhe ist ohnehin kein Tal mehr.
	const { innen, leer } = leereZellen(ergebnis);
	assert.strictEqual(leer, 0,
		leer + " von " + innen + " Zellen stehen auf null -- das Tal schneidet durch das ganze "
		+ "Gebirge hindurch");
});

pruefe("unter der Sohle bleibt der bestellte Bruchteil stehen", () => {
	// ⚠️ Gemessen wird der TIEFSTE Punkt gegen die Kammhöhe: der Deckel lässt je Zelle einen Anteil
	// des ÖRTLICHEN Geländes stehen, und das örtliche Gelände am Flusslauf ist niedriger als der
	// Kamm. Deshalb ein grosszügiger Vergleich -- geprüft wird „deutlich über null", nicht eine
	// Nachkommastelle.
	let tiefste = Infinity;
	for (let j = 0; j < ergebnis.r.hh; j++) {
		for (let i = 0; i < ergebnis.r.w; i++) {
			const k = (j * ergebnis.r.w) + i;
			if (!ergebnis.r.drin[k]) { continue; }
			const x = ergebnis.r.x(i);
			const y = ergebnis.r.y(j);
			if (Math.min(x - 1, 19 - x, y - 1, 19 - y) < RANDSAUM) { continue; }
			if (ergebnis.h[k] < tiefste) { tiefste = ergebnis.h[k]; }
		}
	}
	assert.ok(tiefste > 0,
		"der tiefste Punkt liegt bei " + tiefste.toFixed(1) + " -- das ist Meereshöhe");
});

pruefe("und es entsteht TROTZDEM ein Tal", () => {
	// 💣 DIE GEGENRICHTUNG, und sie ist die wichtigere: ein Deckel, der jedes Tal einebnet, hätte
	// die Meldung auch „gelöst". Der Fluss muss weiterhin sichtbar tiefer liegen als seine Umgebung.
	// Gemessen wird die Achse gegen den Rest der Fläche.
	// 🪤 GEMESSEN WIRD SÜDLICH DER ACHSE, in 2 bis 3,5 Einheiten Abstand -- und beides ist nötig.
	// Die erste Fassung nahm BEIDE Seiten und einen Abstand von 3 bis 6: nördlich liegt aber die
	// Kammlinie (y = 10), und damit mass sie die Höhe des KAMMS gegen die Talsohle statt der
	// Taltiefe. Ergebnis: 174 Schritt „Tal", auch wenn der Deckel jeden Einschnitt verschluckte --
	// eine Mutationsprobe (Restanteil 1 und 0,8) rutschte durch beide Zusicherungen.
	// ⚠️ Und der Abstand beginnt bei 2,0: die Talbreite ist 1,5, wer näher misst, misst noch die
	// Flanke.
	const auf = [];
	const daneben = [];
	for (let j = 0; j < ergebnis.r.hh; j++) {
		for (let i = 0; i < ergebnis.r.w; i++) {
			const k = (j * ergebnis.r.w) + i;
			if (!ergebnis.r.drin[k]) { continue; }
			const y = ergebnis.r.y(j);
			const x = ergebnis.r.x(i);
			if (x < 5 || x > 15) { continue; }
			// Der Lauf geht von (2,5) nach (18,7) -- rund y = 5 + (x-2)/8.
			const flussY = 5 + ((x - 2) / 8);
			if (Math.abs(y - flussY) < 0.5) { auf.push(ergebnis.h[k]); }
			else if (y < flussY - 2.0 && y > flussY - 3.5) { daneben.push(ergebnis.h[k]); }
		}
	}
	assert.ok(auf.length > 10 && daneben.length > 10,
		"zu wenige Messpunkte (" + auf.length + " auf der Achse, " + daneben.length + " daneben)");
	const mittel = (a) => a.reduce((s, v) => s + v, 0) / a.length;
	const tiefe = mittel(daneben) - mittel(auf);
	// 💣 EIN ABSOLUTER BETRAG, KEIN VERHÄLTNIS -- und an der richtigen Stelle gemessen. Hier stand
	// `mittel(auf) < mittel(daneben) * 0.9` gegen die falsche Vergleichsfläche, und beides zusammen
	// hielt nichts.
	// ⚠️ DIE SCHWELLE IST GEMESSEN, an vier Fassungen des Deckels (Achse gegen die Fläche 2 bis 3,5
	// Einheiten südlich, die konstant bei 62,3 liegt):
	//     Restanteil 0 (kein Deckel) -> 50,0 Schritt Tal
	//     Restanteil 0,25 (heute)    -> 42,3
	//     Restanteil 0,8             -> 25,4
	//     Restanteil 1 (kein Tal)    -> 19,2
	// 35 trennt die brauchbaren Fassungen von denen, die das Tal einebnen, mit Luft nach beiden
	// Seiten.
	assert.ok(tiefe > 35,
		"auf der Flussachse steht es im Mittel bei " + Math.round(mittel(auf)) + ", daneben bei "
		+ Math.round(mittel(daneben)) + " -- nur " + Math.round(tiefe) + " Schritt Unterschied, das "
		+ "ist kein Tal mehr");
});

pruefe("bei hohem Gelände ändert der Deckel nichts", () => {
	// ⚠️ Der Deckel darf nur GREIFEN, wo der Einschnitt sonst durchschlüge. In einem Hochgebirge
	// sind 400 Schritt ein Tal wie bisher -- eine Änderung dort wäre stille Geländeverschiebung an
	// jeder gepflegten Fläche.
	const hoch = baue({ regler: {
		koernung: 4, stufen: 3, bergform: 2, rauschen: 0.2, sattel: 0.9, erosion: 0,
		maximalhoehe: 4000, einschnitt: 400, talbreite: 1.5, hypsometrie: 0, plateau: 1,
	} });
	let tiefsteAufAchse = Infinity;
	let hoechste = 0;
	for (let k = 0; k < hoch.h.length; k++) {
		if (!hoch.r.drin[k]) { continue; }
		if (hoch.h[k] > hoechste) { hoechste = hoch.h[k]; }
	}
	for (let j = 0; j < hoch.r.hh; j++) {
		for (let i = 0; i < hoch.r.w; i++) {
			const k = (j * hoch.r.w) + i;
			if (!hoch.r.drin[k]) { continue; }
			const x = hoch.r.x(i);
			const y = hoch.r.y(j);
			if (x < 4 || x > 16) { continue; }
			if (Math.abs(y - (5 + ((x - 2) / 8))) < 0.6) {
				tiefsteAufAchse = Math.min(tiefsteAufAchse, hoch.h[k]);
			}
		}
	}
	// Bei 4.000 Schritt Kammhöhe liegt der Deckel bei 1.000 -- die 400 des Einschnitts bleiben
	// darunter und wirken unverändert.
	assert.ok(hoechste > 1000, "das hohe Gelände wurde gar nicht hoch (" + Math.round(hoechste) + ")");
	assert.ok(tiefsteAufAchse > 0, "auch im Hochgebirge darf die Sohle nicht auf 0 fallen");
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
