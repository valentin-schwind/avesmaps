"use strict";
// Die KETTE der Abschnitte eines Weges -- und was beim Drehen eines Abschnitts passiert.
//
// 🔴 DIE ZUSICHERUNG, UM DIE ES GEHT, IST DAS PAARWEISE TAUSCHEN. Die vier Zahlen je Wegstueck
// sind `[Anstieg, Abstieg, steiler Anstieg, steiler Abstieg]` in Speicherrichtung. Wer beim Drehen
// nur die Liste umkehrt, bekommt eine Kurve, die bergauf laeuft, wo der Weg bergab geht -- und die
// Summen darunter stimmen trotzdem, weil sie sich beim Drehen nicht aendern. Es faellt also nicht
// auf, und deshalb steht es hier.
//
// Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md §6

const assert = require("node:assert/strict");
const {
	wpReversePiece,
	wpReverseProfile,
	wpChainSegments,
	wpChainCurve
} = require("../wege-editor-model.js");

assert.throws(() => assert.equal(1, 2), "assert ist wirkungslos");

// ── 1) Ein gedrehtes Wegstueck tauscht PAARWEISE ─────────────────────────────────────────────
{
	// bergauf 100, bergab 10, davon kein steiler Anstieg, 5 steiler Abstieg
	assert.deepEqual(wpReversePiece([100, 10, 0, 5]), [10, 100, 5, 0],
		"aus Anstieg wird Abstieg UND aus steilem Anstieg steiler Abstieg");

	// 💣 Eine Zeile aus der Zeit vor dem 30.07.2026 (Paare aus zwei) wird unveraendert
	// durchgereicht -- eine halbe Drehung waere eine erfundene Zahl.
	assert.deepEqual(wpReversePiece([100, 10]), [100, 10]);
	assert.deepEqual(wpReversePiece(null), null);
}

// ── 2) Das ganze Profil: Reihenfolge UND Paare ───────────────────────────────────────────────
{
	const profil = [[100, 0, 0, 0], [0, 60, 0, 20]];
	assert.deepEqual(wpReverseProfile(profil), [[60, 0, 20, 0], [0, 100, 0, 0]],
		"das letzte Stueck kommt zuerst, und jedes ist gedreht");
	// Die Gegenprobe: zweimal gedreht ist das Original.
	assert.deepEqual(wpReverseProfile(wpReverseProfile(profil)), profil);
}

// ── 3) Eine geschlossene Kette aus drei Abschnitten ──────────────────────────────────────────
{
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] } },
		{ public_id: "b", ends: { from: [10, 0], to: [20, 0] } },
		{ public_id: "c", ends: { from: [20, 0], to: [30, 0] } }
	];
	const ketten = wpChainSegments(segmente);
	assert.equal(ketten.length, 1, "drei aneinanderhaengende Abschnitte sind EINE Kette");
	assert.deepEqual(ketten[0].map((g) => g.index), [0, 1, 2]);
	assert.deepEqual(ketten[0].map((g) => g.gedreht), [false, false, false]);
}

// ── 4) 🔴 EIN RUECKWAERTS GEZEICHNETER ABSCHNITT WIRD ERKANNT ────────────────────────────────
{
	// Der mittlere Abschnitt ist von Osten nach Westen gezeichnet.
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] } },
		{ public_id: "b", ends: { from: [20, 0], to: [10, 0] } },
		{ public_id: "c", ends: { from: [20, 0], to: [30, 0] } }
	];
	const ketten = wpChainSegments(segmente);
	assert.equal(ketten.length, 1, "die Zeichenrichtung darf die Kette nicht zerreissen");
	assert.deepEqual(ketten[0].map((g) => g.index), [0, 1, 2]);
	assert.deepEqual(ketten[0].map((g) => g.gedreht), [false, true, false],
		"der mittlere Abschnitt liegt rueckwaerts in der Kette");
}

// ── 5) Eine LUECKE gibt zwei Ketten, keine erfundene Verbindung ──────────────────────────────
{
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] } },
		{ public_id: "b", ends: { from: [10, 0], to: [20, 0] } },
		// weit weg -- kein gemeinsamer Punkt
		{ public_id: "c", ends: { from: [500, 500], to: [510, 500] } }
	];
	const ketten = wpChainSegments(segmente);
	assert.equal(ketten.length, 2, "eine Luecke wird gezeigt, nicht ueberbrueckt");
	assert.deepEqual(ketten[0].map((g) => g.index), [0, 1], "die laengste Kette steht vorn");
	assert.deepEqual(ketten[1].map((g) => g.index), [2]);
}

// ── 6) Eine VERZWEIGUNG schliesst die Kette ──────────────────────────────────────────────────
{
	// Drei Abschnitte treffen sich in einem Punkt -- welcher Arm der „richtige" waere, kann
	// niemand wissen.
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] } },
		{ public_id: "b", ends: { from: [10, 0], to: [20, 0] } },
		{ public_id: "c", ends: { from: [10, 0], to: [10, 20] } }
	];
	const ketten = wpChainSegments(segmente);
	assert.equal(ketten.length, 3, "an einer Verzweigung endet jede Kette");
	ketten.forEach((kette) => { assert.equal(kette.length, 1); });
}

// ── 7) Jeder Abschnitt kommt GENAU EINMAL vor ────────────────────────────────────────────────
{
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] } },
		{ public_id: "b", ends: { from: [20, 0], to: [10, 0] } },
		{ public_id: "c", ends: { from: [20, 0], to: [30, 0] } },
		{ public_id: "d", ends: { from: [900, 900], to: [910, 900] } },
		{ public_id: "e", ends: null }
	];
	const alle = wpChainSegments(segmente).reduce((sammlung, kette) => sammlung.concat(kette.map((g) => g.index)), []);
	alle.sort((x, y) => x - y);
	assert.deepEqual(alle, [0, 1, 2, 3, 4],
		"ein Abschnitt faellt aus der Darstellung oder steht zweimal drin");
}

// ── 8) Die Kurve: ein gedrehter Abschnitt laeuft in die richtige Richtung ────────────────────
{
	// Zwei Abschnitte, beide steigen in Speicherrichtung um 100. Der zweite ist rueckwaerts
	// gezeichnet -- gefahren wird er also BERGAB.
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] }, length_units: 10, piece_lengths: [10],
		  terrain: { profile: [[100, 0, 0, 0]] } },
		{ public_id: "b", ends: { from: [20, 0], to: [10, 0] }, length_units: 10, piece_lengths: [10],
		  terrain: { profile: [[100, 0, 0, 0]] } }
	];
	const ketten = wpChainSegments(segmente);
	const kurve = wpChainCurve(ketten[0], segmente);

	assert.equal(kurve[0].y, 0, "die Kurve beginnt am frei gewaehlten Nullpunkt");
	assert.equal(kurve[1].y, 100, "der erste Abschnitt steigt um 100");
	assert.equal(kurve[2].y, 0,
		"🔴 der gedrehte Abschnitt muss FALLEN. Steht hier 200, wurde beim Drehen nur die Liste "
		+ "umgekehrt und nicht das Paar getauscht -- die Kurve laeuft dann bergauf, wo der Weg "
		+ "bergab geht, und die Summen darunter stimmen trotzdem");
	// 1 Karteneinheit = 3 Meilen.
	assert.equal(kurve[2].x, 60, "die x-Achse zaehlt beide Abschnitte in Meilen");
}

// ── 9) Ein Abschnitt OHNE Profil unterbricht die Kurve nicht, er wird uebersprungen ──────────
{
	const segmente = [
		{ public_id: "a", ends: { from: [0, 0], to: [10, 0] }, length_units: 10, piece_lengths: [10],
		  terrain: { profile: [[100, 0, 0, 0]] } },
		{ public_id: "b", ends: { from: [10, 0], to: [20, 0] }, length_units: 5, piece_lengths: [5],
		  terrain: null },
		{ public_id: "c", ends: { from: [20, 0], to: [30, 0] }, length_units: 10, piece_lengths: [10],
		  terrain: { profile: [[0, 40, 0, 0]] } }
	];
	const ketten = wpChainSegments(segmente);
	const kurve = wpChainCurve(ketten[0], segmente);
	const letzter = kurve[kurve.length - 1];
	assert.equal(letzter.y, 60, "100 hinauf, 40 hinunter -- das Stueck ohne Profil aendert die Hoehe nicht");
	assert.equal(letzter.x, 75, "seine LAENGE zaehlt trotzdem mit (10 + 5 + 10 Einheiten = 75 Meilen)");
}

console.log("wege-gruppe-kette.test.js: alle Zusicherungen gruen");
