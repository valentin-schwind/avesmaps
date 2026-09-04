"use strict";

// Die lokale Gebirgssimulation (V12) -- der Trichter UND die Malschleife, die ihn benutzt.
//
// 🔴 AUSGEFUEHRT, NICHT GELESEN. Ein Regex ueber den Quelltext kennt keinen Geltungsbereich: die
// Malschleife las nach dem Umbau `fields` und `stack` weiter, obwohl beide entfallen waren --
// `node --check` blieb gruen, und der ReferenceError kam erst zur Laufzeit, NACH `putImageData`.
// Die Folge war nicht ein fehlendes Bild, sondern ein Dialog, der gar nicht aufging. Gefunden hat
// das ein Pruefagent, der `redraw()` wirklich gefahren hat; dieselbe Lehre steht im Projekt schon
// beim Regressions-Popup vom 03.09.2026.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
let gehalten = 0;

function pruefe(name, fn) {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (error) {
		console.error("  FEHLER  " + name);
		throw error;
	}
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. DER TRICHTER -- die Invarianten, die das ganze Verfahren tragen
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const hydro = require(path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js"));

// Ein Quadrat mit zwei Gipfeln, einem Fluss quer hindurch und einem See.
const BOUNDS = { min_x: 0, min_y: 0, max_x: 20, max_y: 20 };
const IM_QUADRAT = (x, y) => x >= 1 && x <= 19 && y >= 1 && y <= 19;
const GIPFEL = [{ x: 6, y: 6, h: 3000 }, { x: 14, y: 14, h: 5000 }];
const SEE = { min_x: 9, min_y: 3, max_x: 12, max_y: 5 };
const IM_SEE = (i, x, y) => x >= SEE.min_x && x <= SEE.max_x && y >= SEE.min_y && y <= SEE.max_y;

function baue(extra) {
	return hydro.avesmapsGebirgsRasterBauen(Object.assign({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: GIPFEL,
		kurve: [[6, 6], [10, 10], [14, 14]],
		fluesse: [{ n: "Probefluss", dir: "forward", bach: false, p: [[2, 10], [10, 10], [18, 11]] }],
		seen: [{ n: "Probesee" }],
		istImSee: IM_SEE,
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2 },
		saat: 4711,
	}, extra || {}));
}

const ergebnis = baue();

pruefe("jeder Gipfel liest exakt seine eingetragene Zahl", () => {
	// 🔴 Die Invariante, an der das heutige Feld scheitert: dort lesen 27 von 49 Gipfeln zu hoch,
	// bis +5.820 Schritt, weil sich Buckel ADDIEREN. Hier sind die Kerne festgehalten.
	for (const p of GIPFEL) {
		const i = ergebnis.r.i(p.x);
		const j = ergebnis.r.j(p.y);
		const gelesen = ergebnis.h[(j * ergebnis.r.w) + i];
		assert.ok(Math.abs(gelesen - p.h) < 1,
			"Gipfel " + p.h + " liest " + gelesen.toFixed(1));
	}
});

pruefe("zwei benachbarte Gebirge teilen ein Rechengebiet -- an der Naht steht kein Tal", () => {
	// 🔴 Owner 04.09.2026: „wenn zwei gebirge aneinander angrenzen bzw. sich ueberlappen teilen sie
	// sich keine gemeinsame ausgangslage fuer die hoehe … kriegst du das wieder hin, dass das
	// resultierende hoehenmodell zweier gebirge ineinander uebergehen kann (max der beiden bei
	// ueberlappung)".
	//
	// 💣 DIE URSACHE STECKT IN EINER ZEILE: `sorDurchgang` liest eine Zelle ausserhalb des
	// Rechengebiets als 0 (`drin[k+1] ? h[k+1] : 0`) -- eine Dirichlet-Null am Flaechenrand. Jede
	// Flaeche fiel damit an IHRER Kante auf null, auch wenn dahinter das naechste Gebirge weitergeht.
	// Gemessen an zwei 2.600er Kaemmen: an der Naht ein Einschnitt auf 1.114 Schritt.
	const BREIT = { min_x: 0, min_y: 0, max_x: 60, max_y: 30 };
	const LINKS = (x, y) => Math.hypot(x - 20, y - 15) <= 13;
	const RECHTS = (x, y) => Math.hypot(x - 38, y - 15) <= 13;
	const GIPFEL_LINKS = [{ x: 14, y: 15, h: 3000 }, { x: 26, y: 15, h: 2600 }];
	const GIPFEL_RECHTS = [{ x: 32, y: 15, h: 2800 }, { x: 44, y: 15, h: 3200 }];
	const regler = { koernung: 8, maximalhoehe: 0, bergform: 2.5, rauschen: 0.2, sattel: 0.8,
		erosion: 2, stufen: 4 };
	const bau = (istDrin, verbund, peaks, kurve) => hydro.avesmapsGebirgsRasterBauen({
		bounds: BREIT, istDrin, istImVerbund: verbund, peaks, kurve, regler, saat: 3,
	});

	// Ohne Verbund: das Tal an der Naht.
	const allein = bau(LINKS, null, GIPFEL_LINKS, [[14, 15], [26, 15]]);
	// Mit Verbund: das Rechengebiet reicht hinueber, die Gipfel beider zaehlen.
	const gemeinsam = bau(LINKS, RECHTS, GIPFEL_LINKS.concat(GIPFEL_RECHTS), [[14, 15], [26, 15]]);
	const bei = (o, x) => o.h[(o.r.j(15) * o.r.w) + o.r.i(x)];
	// ⚠️ x = 28, nicht 26: bei 26 steht der GIPFEL der linken Flaeche, und der ist festgehalten --
	// dort misst man in beiden Faellen 2.600 und der Test waere blind. Die Naht liegt dahinter.
	assert.ok(bei(gemeinsam, 28) > bei(allein, 28) * 1.5,
		"an der Naht liegt das Gelaende mit Verbund nicht hoeher (" + bei(allein, 28).toFixed(0)
		+ " -> " + bei(gemeinsam, 28).toFixed(0) + ") -- das Rechengebiet reicht nicht hinueber");

	// 🔴 UND DIE ZWEI MASKEN SIND VERSCHIEDEN: gerechnet wird der Verbund, gespeichert die eigene
	// Flaeche. Wer beim Speichern `drin` nimmt, legt das Gelaende des Nachbarn ein zweites Mal ab.
	assert.ok(gemeinsam.r.drinN > gemeinsam.r.eigenN,
		"das Rechengebiet ist nicht groesser als das Speichergebiet (" + gemeinsam.r.drinN
		+ " gegen " + gemeinsam.r.eigenN + ")");
	// 🪤 UND ES MUESSEN ZWEI ARRAYS SEIN, nicht zwei Namen fuer eines. `eigen = drin` bestand die
	// Zaehlung darueber (die Zaehler laufen unabhaengig), haette beim Speichern aber das
	// Verbund-Gebiet abgelegt -- also das Gelaende des Nachbarn ein zweites Mal. Von einer
	// Mutationsprobe gefunden.
	assert.notStrictEqual(gemeinsam.r.eigen, gemeinsam.r.drin,
		"mit Verbund sind Rechen- und Speichergebiet DASSELBE Array -- beim Speichern landet dann "
		+ "das Gelaende des Nachbarn mit");
	let nurRechen = 0;
	for (let k = 0; k < gemeinsam.r.drin.length; k++) {
		if (gemeinsam.r.drin[k] && !gemeinsam.r.eigen[k]) { nurRechen++; }
	}
	assert.ok(nurRechen > 100,
		"nur " + nurRechen + " Zellen liegen im Rechen- und nicht im Speichergebiet -- der Verbund "
		+ "reicht kaum ueber die eigene Flaeche hinaus");
	assert.strictEqual(allein.r.eigen, allein.r.drin,
		"ohne Verbund muessen beide Masken DASSELBE Array sein -- ein Aufrufer ohne Nachbarn rechnet "
		+ "sonst anders als vorher");

	// ⭐ Beide Flaechen liefern im Ueberlappungsbereich fast denselben Wert -- deshalb ist MAX beim
	// Lesen richtig und die Summe waere rund das Doppelte.
	const andere = bau(RECHTS, LINKS, GIPFEL_LINKS.concat(GIPFEL_RECHTS), [[32, 15], [44, 15]]);
	const linksBei28 = bei(gemeinsam, 28);
	const rechtsBei28 = bei(andere, 28);
	assert.ok(Math.abs(linksBei28 - rechtsBei28) < Math.max(linksBei28, rechtsBei28) * 0.15,
		"die beiden Felder weichen an der Naht um mehr als 15 % ab (" + linksBei28.toFixed(0)
		+ " gegen " + rechtsBei28.toFixed(0) + ") -- dann gibt MAX eine sichtbare Kante");
});

pruefe("am Flaechenrand bleibt die Hoehe 0 -- daran haengt die Verschmelzung zweier Flaechen", () => {
	for (let k = 0; k < ergebnis.r.drin.length; k++) {
		if (!ergebnis.r.drin[k]) {
			assert.strictEqual(ergebnis.h[k], 0, "ausserhalb der Flaeche steht Hoehe");
		}
	}
});

pruefe("der Fluss fliesst bergab -- er steigt nirgends an", () => {
	// Fall #109 woertlich: „von jedem Punkt des Flusswegs geht rundum bergauf, ausser den Flussweg
	// hinab, dort geht es immer bergab."
	let anstieg = 0;
	for (const spur of ergebnis.fluss.spuren) {
		let vorher = null;
		for (const [x, y] of spur.p) {
			const i = ergebnis.r.i(x);
			const j = ergebnis.r.j(y);
			if (i < 0 || j < 0 || i >= ergebnis.r.w || j >= ergebnis.r.hh) { continue; }
			const v = ergebnis.h[(j * ergebnis.r.w) + i];
			if (vorher !== null && v > vorher) { anstieg += v - vorher; }
			vorher = v;
		}
	}
	assert.ok(anstieg < 1, "Anstieg entlang der Laeufe: " + anstieg.toFixed(1) + " Schritt");
});

pruefe("ein Fluss schneidet die ACHSE durch einen Gipfelkern -- die FLANKE nicht", () => {
	// 🔴 OWNER-ENTSCHEID 04.09.2026, auf die Frage, ob ein Fluss ueber einem Gipfel den Gipfel
	// einschneiden darf: „ja". Davor sprang ein Lauf ueber den Kern hinweg und STIEG dabei an -- beim
	// Finsterkamm waren das 100 % des gemessenen Anstiegs (1.479 -> 34 Schritt nach der Aenderung).
	//
	// 💣 UND DIE ERLAUBNIS TRENNT ACHSE VON FLANKE. Auf der Achse LIEGT der Fluss: eine gezeichnete
	// Angabe wie die Gipfelhoehe, und bei zwei widerspruechlichen Angaben gewinnt der Lauf. Der Abzug
	// daneben ist gerechnete FORM und verliert gegen die Messung.
	// 🪤 Die erste Fassung gab beides frei -- und trug das Wallspitzhorn um 1.517 Schritt ab, obwohl
	// der naechste Lauf 1,34 Zellen daran vorbeifliesst: die Talbreite ist 1,5 EINHEITEN, also SECHS
	// Zellen. Wer die zwei Masse verwechselt, gibt eine Reichweite von 6 frei und meint 1.
	const durchGipfel = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: [{ x: 10, y: 10, h: 4000 }],
		// Der Lauf geht MITTEN durch den Gipfel.
		fluesse: [{ n: "Querlauf", dir: "forward", bach: false, p: [[2, 10], [10, 10], [18, 10]] }],
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 0 },
		saat: 31,
	});
	const aufAchse = durchGipfel.h[(durchGipfel.r.j(10) * durchGipfel.r.w) + durchGipfel.r.i(10)];
	assert.ok(aufAchse < 4000 * 0.5,
		"die Achse liegt bei " + aufAchse.toFixed(0) + " Schritt und schneidet den Gipfel (4000) nicht "
		+ "ein -- der Kern-Riegel steht noch vor der Achse");

	// Und die Gegenprobe: derselbe Gipfel, der Lauf 1 Einheit DANEBEN (also innerhalb der Talbreite
	// von 1,5, aber nicht auf der Achse) -- er muss seine Zahl behalten.
	const daneben = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: [{ x: 10, y: 10, h: 4000 }],
		fluesse: [{ n: "Nebenlauf", dir: "forward", bach: false, p: [[2, 11], [10, 11], [18, 11]] }],
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 0 },
		saat: 31,
	});
	// 🪤 HIER STAND BIS ZUM 04.09.2026 DAS GEGENTEIL: „ein Fluss QUER ueber einen Gipfel widerlegt den
	// Gipfel nicht" -- mit der Begruendung, ein Lauf ueber einem Berg sei ein Datenwiderspruch, den das
	// Modell tragen und nicht entscheiden solle. Der Owner hat die Frage gestellt bekommen und mit
	// „ja" beantwortet: der Lauf gewinnt. Der alte Test war nicht falsch, er hielt die alte Regel --
	// und ist genau deshalb rot geworden, als sie sich aenderte. So soll es sein.
	const gipfel = daneben.h[(daneben.r.j(10) * daneben.r.w) + daneben.r.i(10)];
	assert.ok(Math.abs(gipfel - 4000) < 1,
		"der Gipfel liest " + gipfel.toFixed(0) + " statt 4000 -- die Talflanke eines Laufes, der 1 "
		+ "Einheit daneben liegt, hat ihn abgetragen");
});

pruefe("der Fluss liegt in einem TAL -- das Gelaende steigt quer zu ihm an", () => {
	// 🔴 DIE ANFORDERUNG DES OWNERS, woertlich: „Ein Fluss, der bereits durch ein Gebirge gezeichnet
	// ist, muss dort im Hoehenfeld plausibel in einem Tal liegen." Bis hierher pruefte KEINE
	// Zusicherung sie -- „der Fluss faellt bergab" ist entlang der Achse gemessen und waere von einer
	// Rampe ohne jedes Tal genauso erfuellt. Ein halbierter Talabzug ueberlebte die Tests.
	// Gemessen an dieser Fixture: die Achse liegt im Mittel 3.648 Schritt unter den Flanken 2,5
	// Einheiten seitlich, im ungünstigsten Querschnitt 1.173.
	const o = baue({
		fluesse: [{ n: "Probe", dir: "forward", bach: false, p: [[2, 10], [10, 10], [18, 10]] }],
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 3 },
	});
	let n = 0;
	let summe = 0;
	let flachster = Infinity;
	for (let x = 4; x <= 16; x += 0.5) {
		const i = o.r.i(x);
		const k = (o.r.j(10) * o.r.w) + i;
		const kn = (o.r.j(10 - 2.5) * o.r.w) + i;
		const ks = (o.r.j(10 + 2.5) * o.r.w) + i;
		if (!o.r.drin[k] || !o.r.drin[kn] || !o.r.drin[ks]) { continue; }
		const tiefe = ((o.h[kn] + o.h[ks]) / 2) - o.h[k];
		summe += tiefe;
		flachster = Math.min(flachster, tiefe);
		n++;
	}
	assert.ok(n > 5, "zu wenige Querschnitte zum Messen (" + n + ")");
	// ⚠️ JEDER Querschnitt, nicht nur der Mittelwert: ein Tal, das auf halber Strecke verschwindet,
	// ist bei gemitteltem Blick nicht von einem durchgehenden zu unterscheiden.
	assert.ok(flachster > 200,
		"an der flachsten Stelle liegt der Fluss nur " + flachster.toFixed(0) + " Schritt unter den "
		+ "Flanken -- dort ist kein Tal, sondern eine Rinne im Rauschen");
	assert.ok((summe / n) > 800,
		"der Fluss liegt im Mittel nur " + (summe / n).toFixed(0) + " Schritt unter den Flanken");

	// 💣 UND DIE FLANKE MUSS ANSTEIGEN, nicht senkrecht stehen. Die Messung oben (2,5 Einheiten
	// seitlich) liegt AUSSERHALB der Talbreite von 1,5 -- dort formt der Abzug nichts mehr, und ein
	// vollstaendig entfernter Talabzug ueberlebte sie. Das Tal entsteht dort naemlich trotzdem: die
	// Achse selbst wird als Zwang gesetzt. Ohne den Abzug waere sie aber eine KERBE von einer Zelle
	// Breite statt eines Tals -- und ein Reisender laeuft nicht in einer Kerbe.
	// Gemessen quer zur Achse bei x=10, ohne Erosion: 36 / 1.054 / 2.870 / 3.785 Schritt.
	const eben = baue({
		fluesse: [{ n: "Probe", dir: "forward", bach: false, p: [[2, 10], [10, 10], [18, 10]] }],
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 0 },
	});
	const bei = (dy) => eben.h[(eben.r.j(10 + dy) * eben.r.w) + eben.r.i(10)];
	const nah = bei(0.5);
	const rand = bei(1.5);
	assert.ok(rand > 500, "die Talflanke traegt keine Hoehe (" + rand.toFixed(0) + ")");
	// Auf halber Talbreite darf hoechstens die halbe Flankenhoehe stehen -- sonst ist die Flanke
	// senkrecht und der Abzug hat nur EINE Zellreihe erwischt.
	assert.ok(nah < rand * 0.5,
		"die Talflanke steht senkrecht: " + nah.toFixed(0) + " Schritt schon " + "0,5 Einheiten neben "
		+ "der Achse gegen " + rand.toFixed(0) + " bei 1,5 -- der Talabzug formt keine Flanke");
});

pruefe("aus dem Kamm wird eine FLAECHE -- und ihre Kante folgt der Form des Randes", () => {
	// 🔴 Owner 04.09.2026: „oder du baust was womit aus dem kamm ne flaeche wird". Der erste Versuch
	// war ein KREISRADIUS um die Kammlinie, und der Owner hat ihn am Bild verworfen: „rechts sind die
	// waende ungleichmaessig, es sollte mit uebereinstimmung zum rand beginnen und immer mehr zum
	// kamm wandern". Ein Kreis kennt die Form der Flaeche nicht -- bei einem herzfoermigen Berg blieb
	// links eine schmale und rechts eine breite Wand.
	//
	// ⭐ Die Familie, die es leistet, ist die ABSTANDSKARTE zum Rand: ihre Isolinien sind
	// geschrumpfte Kopien des Randes, und ihr Maximum IST die Mittelachse, also der Kamm.
	const anteilOben = (plateau) => {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
			sattel: 0.75, erosion: 2, maximalhoehe: 3000, plateau } });
		let max = 0;
		let hoch = 0;
		let drin = 0;
		for (let k = 0; k < o.r.drin.length; k++) { if (o.r.drin[k] && o.h[k] > max) { max = o.h[k]; } }
		for (let k = 0; k < o.r.drin.length; k++) {
			if (!o.r.drin[k]) { continue; }
			drin++;
			if (o.h[k] > 0.6 * max) { hoch++; }
		}

		return drin ? hoch / drin : 0;
	};
	const kamm = anteilOben(1);
	const plateau = anteilOben(0.2);
	assert.ok(plateau > kamm * 1.5,
		"ein Plateau-Anteil von 0,2 hebt nicht mehr Flaeche als der blosse Kamm ("
		+ (100 * kamm).toFixed(1) + " % gegen " + (100 * plateau).toFixed(1) + " %)");

	// 💣 UND DIE FORM, nicht nur die MENGE. Eine Mutationsprobe hat gezeigt, dass die Abstandskarte
	// UMGEDREHT werden kann (`drin ? 0 : GROSS` statt `drin ? GROSS : 0`), ohne dass eine Zusicherung
	// bricht: dann ist `dmax` gleich 0, die Schwelle also auch, und JEDE Zelle wird gestempelt -- ein
	// Plateau ueber die ganze Flaeche, ohne Abbruchkante. Die Menge stimmt dabei sogar besser, und
	// genau deshalb faengt sie den Fehler nicht.
	// 🔴 Gemessen wird deshalb der RANDSTREIFEN: die Zellen mit einem Nachbarn ausserhalb duerfen
	// NIE Plateau werden -- dort steht die Wand, und daran haengt die Fusshoehen-Invariante.
	for (const stufe of [0.6, 0.35, 0.15]) {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
			sattel: 0.75, erosion: 2, maximalhoehe: 3000, plateau: stufe } });
		let gestempelt = 0;
		let rand = 0;
		for (let j = 1; j < o.r.hh - 1; j++) {
			for (let i = 1; i < o.r.w - 1; i++) {
				const k = (j * o.r.w) + i;
				if (!o.r.drin[k]) { continue; }
				const amRand = !o.r.drin[k - 1] || !o.r.drin[k + 1]
					|| !o.r.drin[k - o.r.w] || !o.r.drin[k + o.r.w];
				if (!amRand) { continue; }
				rand++;
				if (o.kammMaske[k]) { gestempelt++; }
			}
		}
		assert.ok(rand > 10, "zu wenige Randzellen zum Messen (" + rand + ")");
		assert.strictEqual(gestempelt, 0,
			"bei plateau=" + stufe + " reicht das Plateau bis an den Flaechenrand (" + gestempelt
			+ " von " + rand + " Randzellen) -- die Abstandskarte misst nicht zum Rand");
	}
});

pruefe("die Plateau-Vorgabe ist der KAMM -- sie aendert kein bestehendes Gebirge", () => {
	// 🔴 1 heisst „die Mittelachse", also genau das Verhalten vor dem 04.09.2026. Eine Flaeche, die
	// den Regler nie gesehen hat, muss Zeichen fuer Zeichen dasselbe Feld bekommen -- sonst haette
	// der Umbau jedes gespeicherte Gebirge veraendert.
	const ohne = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2 } });
	const mitEins = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2, plateau: 1 } });
	let groesste = 0;
	for (let k = 0; k < ohne.h.length; k++) { groesste = Math.max(groesste, Math.abs(ohne.h[k] - mitEins.h[k])); }
	assert.ok(groesste < 1e-9,
		"`plateau: 1` liefert ein anderes Feld als gar kein Wert (groesste Abweichung "
		+ groesste.toFixed(3) + ") -- die Vorgabe ist nicht mehr der Kamm");
	assert.strictEqual(hydro.ECOSYSTEM_HYDRO_PLATEAU_VORGABE, 1, "die Vorgabe ist nicht 1");
});

pruefe("auch mit Plateau waechst kein Punkt ueber den hoechsten Gipfel", () => {
	// 💣 GENAU HIER BRACH ES BEIM BAU. Die Plateauflaeche traegt die Kammmaske, und das RAUSCHEN
	// greift auf ihr -- multiplikativ, also am staerksten dort, wo es schon hoch ist. Gemessen an der
	// Roten Sichel: 7.924 Schritt gegen 6.650 eingetragen, waehrend derselbe Lauf mit `rauschen: 0`
	// exakt 6.650 ergab. So wurde die Ursache gefunden; der Deckel steht seither im Rauschzweig.
	// ⚠️ Ueber ALLE Stufen geprueft, nicht nur einer: bei `plateau: 1` liegt die schmale Kammlinie
	// ohnehin unter den Gipfeln, dort faellt der Fehler gar nicht auf.
	// 🪤 UND MIT HOHEM SOCKEL, sonst faellt der Fehler nicht auf. Die erste Fassung dieses Tests
	// pruefte nur `maximalhoehe: 0` -- dort liegt der Kamm zwischen zwei weit auseinanderstehenden
	// Gipfeln so tief, dass weder Rauschen noch Hebung ihn ueber den hoechsten Gipfel bringen, und
	// das Entfernen des Deckels ueberlebte die Probe. Erst ein Sockel dicht unter der Gipfelhoehe
	// (4.800 gegen 5.000) zeigt ihn: dann genuegen wenige Prozent, um darueber zu kommen.
	const hoechster = Math.max(...GIPFEL.map((p) => p.h));
	for (const sockel of [0, 4800]) {
		for (const plateau of [1, 0.6, 0.35, 0.15]) {
			const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.35,
				sattel: 0.75, erosion: 5, maximalhoehe: sockel, plateau } });
			let max = 0;
			for (let k = 0; k < o.r.drin.length; k++) {
				if (o.r.drin[k] && o.h[k] > max) { max = o.h[k]; }
			}
			assert.ok(max <= hoechster + 1,
				"bei plateau=" + plateau + " und Kammhoehe " + sockel + " liegt der hoechste Punkt bei "
				+ max.toFixed(0) + " statt hoechstens " + hoechster);
		}
	}
});

pruefe("ein Gipfel behaelt seine Zahl, auch wenn das Plateau ueber ihn hinwegzieht", () => {
	// Die Regel des Hauses: eine Messung schlaegt die gerechnete Form. Ein Gipfel ist `fest` und wird
	// vom Plateaustempel uebersprungen -- er ragt heraus, oder er steht in einer Mulde; beides ist
	// die Aussage der Daten.
	for (const plateau of [0.6, 0.15]) {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
			sattel: 0.75, erosion: 3, plateau } });
		for (const p of GIPFEL) {
			const gelesen = o.h[(o.r.j(p.y) * o.r.w) + o.r.i(p.x)];
			assert.ok(Math.abs(gelesen - p.h) < 1,
				"bei plateau=" + plateau + " liest der Gipfel " + p.h + " den Wert "
				+ gelesen.toFixed(0));
		}
	}
});

pruefe("die Hypsometrie trifft ihr Ziel -- und laesst Gipfel, Rand und Gipfelhoehe stehen", () => {
	// 🔴 Das hypsometrische Integral (Strahler 1952): HI = (Mittel - Min) / (Max - Min). Bei uns ist
	// das Minimum 0 (Fusshoehen-Invariante), das HI ist also Mittelhoehe / Gipfelhoehe. Ueber 0,6
	// jugendlich, 0,35-0,6 reif, darunter Altersstadium. Live gemessen (04.09.2026): Rote Sichel
	// 0,276, Finsterkamm 0,233 -- beide im Altersstadium.
	// ⚠️ GEMESSEN WIRD AM GRUNDRELIEF (`o.hypso.erreicht`), nicht am fertigen Feld: Talabzug und
	// Erosion verschieben das HI danach noch, und der Regler zielt auf das, was er beeinflusst.
	// ⚠️ NUR ERREICHBARE ZIELE. Ueber einem gewissen HI saettigt der Regler: die Potenz steht dann an
	// ihrer unteren Klemme (0,2), und die schuetzt die Nahtstellen zweier ueberlappender Flaechen --
	// darunter wird aus dem Auslauf am Rand eine Wand. Gemessen an dieser Fixture liegt die Grenze bei
	// rund 0,61; die fruehere Hoehenfunktion nannte fuer ihre Variante 0,67. Wo genau, haengt am
	// Gebirge, deshalb steht die Saettigung im Hinweistext des Reglers statt als feste Zahl im Code.
	for (const ziel of [0.25, 0.45, 0.6]) {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
			sattel: 0.75, erosion: 3, hypsometrie: ziel } });
		assert.ok(o.hypso, "es wurde gar nicht gezogen");
		assert.ok(Math.abs(o.hypso.erreicht - ziel) < 0.02,
			"Ziel " + ziel + " verfehlt: erreicht " + o.hypso.erreicht.toFixed(3)
			+ " (Potenz " + o.hypso.potenz.toFixed(3) + ")");
		// Die drei Invarianten muessen stehen bleiben.
		for (const p of GIPFEL) {
			const gelesen = o.h[(o.r.j(p.y) * o.r.w) + o.r.i(p.x)];
			assert.ok(Math.abs(gelesen - p.h) < 1,
				"bei HI " + ziel + " liest der Gipfel " + p.h + " den Wert " + gelesen.toFixed(0));
		}
		let randVerletzt = 0;
		let max = 0;
		for (let k = 0; k < o.r.drin.length; k++) {
			if (!o.r.drin[k]) { continue; }
			if (o.h[k] > max) { max = o.h[k]; }
			if (!(o.relief[k] > 0) && o.h[k] > 0.5) { randVerletzt++; }
		}
		assert.strictEqual(randVerletzt, 0, "bei HI " + ziel + " traegt der Rand Hoehe");
		assert.ok(max <= Math.max(...GIPFEL.map((p) => p.h)) + 1,
			"bei HI " + ziel + " liegt der hoechste Punkt bei " + max.toFixed(0));
	}

	// 🔴 UND JENSEITS DER GRENZE WIRD SAUBER GESAETTIGT, nicht ueberschossen: die Potenz bleibt an der
	// Klemme stehen, das erreichte HI unter dem Ziel. Ein Regler, der still weiterliefe und dabei die
	// Klemme verletzte, braeche die Nahtstellen.
	const zuHoch = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
		sattel: 0.75, erosion: 3, hypsometrie: 0.8 } });
	assert.ok(zuHoch.hypso.potenz >= hydro.ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN - 1e-9,
		"die Potenz ist unter ihre Klemme gerutscht (" + zuHoch.hypso.potenz.toFixed(3) + ")");
	assert.ok(zuHoch.hypso.erreicht < 0.8,
		"ein unerreichbares Ziel wurde angeblich getroffen -- die Saettigung fehlt");
});

pruefe("die Hypsometrie ist multiplikativ und spart NUR die Gipfelkerne aus", () => {
	// 💣 EINE POTENZ IST NUR MONOTON, WENN SIE AUF ALLES WIRKT. Jede ausgesparte Zelle ist ein Sprung
	// gegen ihre Nachbarn -- und die Fluesse queren solche Stellen. Mit `fest` ausgespart (Gipfel UND
	// Kamm) stieg der gemessene Flussanstieg der Roten Sichel von 3.069 auf 5.166 Schritt bei HI 0,35
	// und auf 13.480 bei 0,65; nur die Gipfelkerne auszusparen haelt ihn bei 4.150 bzw. 3.160.
	// Der Kamm wird also MITgezogen: er ist gerechnete Form, kein Messwert.
	//
	// ⭐ Und sie ist MULTIPLIKATIV: `max * (h/max)^p` ist bei h = 0 exakt 0. Die Fusshoehen-Invariante
	// bleibt woertlich stehen, und mit ihr die Verschmelzung zweier ueberlappender Flaechen. Ein
	// additiver Sockel braeche beides, und zwar unsichtbar bis auf die Nahtstellen.
	// 🪤 UND HIER STEHT AUSNAHMSWEISE EIN QUELLTEXT-CHECK, mit Grund. Ein Verhaltenstest
	// braeuchte eine Flaeche, auf der Laeufe den KAMM mehrfach queren; an dieser Fixture ist der
	// gemessene Flussanstieg in BEIDEN Faellen exakt 0 -- gemessen, nicht vermutet (0 gegen 0 bei
	// HI 0, 0,35 und 0,55). Ein Test darauf waere Vakuum: er kann nicht rot werden. Der Effekt zeigt
	// sich erst am Livebestand, und eine Fixture, die ihn nachbaut, waere eine Kopie der Roten Sichel
	// im Testverzeichnis.
	// ⚠️ OHNE Kommentar-Stripping, und das ist hier sicher: gesucht wird ein AUFRUF mit seiner
	// vollen Argumentliste, und die schreibt kein Kommentar aus (nachgezaehlt: genau ein Vorkommen in
	// der Datei). Ein Test, der seine eigene Warnung mitliest, schlaegt sonst auf sich selbst an.
	const quelle = fs.readFileSync(
		path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js"), "utf8");
	assert.ok(quelle.includes("zieheAufHypsometrie(h, r.drin, kern, hypsoZiel)"),
		"die Hypsometrie spart nicht die GIPFELKERNE aus. Mit `fest` (Gipfel UND Kamm) bricht die "
		+ "Flussmonotonie: der Anstieg der Roten Sichel stieg von 3.069 auf 5.166 Schritt bei HI 0,35 "
		+ "und auf 13.480 bei 0,65, weil jede ausgesparte Zelle ein Sprung gegen ihre Nachbarn ist");

	// Die Klemme schuetzt die Nahtstellen: unter 0,2 wird aus dem Auslauf am Rand eine Wand.
	assert.strictEqual(hydro.ECOSYSTEM_HYDRO_HYPSO_POTENZ_MIN, 0.2, "die untere Klemme steht nicht auf 0,2");
	// Und bei h = 0 muss die Transformation 0 liefern -- ausgefuehrt, nicht behauptet.
	const feld = Float64Array.from([0, 500, 1000]);
	const drin = Uint8Array.from([1, 1, 1]);
	hydro.zieheAufHypsometrie(feld, drin, new Uint8Array(3), 0.5);
	assert.strictEqual(feld[0], 0, "eine Zelle auf 0 wurde angehoben -- die Fusshoehen-Invariante bricht");
});

pruefe("ohne Hypsometrie-Wert bleibt das Feld unberuehrt", () => {
	// 0 heisst „nicht gesetzt". Eine Flaeche, die den Regler nie gesehen hat, muss dasselbe Feld
	// bekommen wie vor dem Umbau.
	const ohne = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2 } });
	const null0 = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2, hypsometrie: 0 } });
	let groesste = 0;
	for (let k = 0; k < ohne.h.length; k++) { groesste = Math.max(groesste, Math.abs(ohne.h[k] - null0.h[k])); }
	assert.ok(groesste < 1e-9, "`hypsometrie: 0` veraendert das Feld (" + groesste.toFixed(3) + ")");
	assert.strictEqual(ohne.hypso, null, "ohne Wert wurde trotzdem gezogen");
	assert.strictEqual(hydro.ECOSYSTEM_HYDRO_HYPSOMETRIE_VORGABE, 0, "die Vorgabe ist nicht 0");
});

pruefe("die Seeflaeche ist ein EBENER Wasserspiegel", () => {
	let min = Infinity;
	let max = -Infinity;
	for (let j = 0; j < ergebnis.r.hh; j++) {
		for (let i = 0; i < ergebnis.r.w; i++) {
			const k = (j * ergebnis.r.w) + i;
			if (!ergebnis.r.drin[k] || !IM_SEE(0, ergebnis.r.x(i), ergebnis.r.y(j))) { continue; }
			min = Math.min(min, ergebnis.h[k]);
			max = Math.max(max, ergebnis.h[k]);
		}
	}
	assert.ok(isFinite(min), "der See liegt gar nicht im Raster");
	assert.ok(max - min < 1, "Spanne ueber der Wasserflaeche: " + (max - min).toFixed(1) + " Schritt");
});

pruefe("die Zellweite ist NIE feiner als die Schranke des Speichers", () => {
	// 💣 `avesmapsTerrainGuardRasterShape` weist alles feiner als 0,25 ab. Mit einer festen Zellzahl
	// traf das am Livebestand 41 der 69 Gebirge -- und zwar erst beim SPEICHERN, nicht beim Rechnen.
	assert.ok(ergebnis.r.cell >= hydro.ECOSYSTEM_HYDRO_ZELLWEITE - 1e-9,
		"Zelle " + ergebnis.r.cell);
	// Auch eine winzige Flaeche darf nicht darunter fallen.
	const klein = hydro.avesmapsGebirgsRasterBauen({
		bounds: { min_x: 0, min_y: 0, max_x: 3, max_y: 3 },
		istDrin: () => true,
		peaks: [{ x: 1.5, y: 1.5, h: 2000 }],
		regler: { erosion: 0 },
	});
	assert.ok(klein.r.cell >= hydro.ECOSYSTEM_HYDRO_ZELLWEITE - 1e-9,
		"kleine Flaeche: Zelle " + klein.r.cell);
});

pruefe("die Maximalhoehe hebt den Kamm -- auch wenn Gipfel sie ueberragen", () => {
	// 🔴 SIE WAR WIRKUNGSLOS, SOBALD EIN GIPFEL IN DER FLAECHE STAND. `kammPunkte` waehlte entweder
	// die Gipfel ODER die Kurve auf Maximalhoehe -- mit Gipfeln gewannen immer die Gipfel, und der
	// Regler bewegte nichts. Am Livebestand gemessen: 500 oder 12.000 eingestellt ergaben an der Roten
	// Sichel Zeichen fuer Zeichen dasselbe Feld (Mittel 1837, Max 10709 in beiden Faellen).
	// Owner 04.09.2026: „maximalhoehe wird durch gipfelhoehe uebertroffen aber die wirkung wirkt auf
	// die ausgangsmap des gebirges oder" -- genau so; sie ist der SOCKEL des Kamms.
	//
	// 💣 Ein Regler, dessen Wert nirgends gilt, ist von einem kaputten Formular nicht zu
	// unterscheiden -- dieselbe Lehre wie beim Zoomband der Gipfel (AGENTS.md §11, 04.09.2026).
	const mittel = (maximalhoehe) => {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3,
			sattel: 0.75, erosion: 2, maximalhoehe } });
		let summe = 0;
		let n = 0;
		for (let k = 0; k < o.r.drin.length; k++) {
			if (!o.r.drin[k]) { continue; }
			summe += o.h[k];
			n++;
		}

		return summe / n;
	};
	// Die Fixture traegt Gipfel von 3.000 und 5.000 -- ein Sockel darueber muss das Feld heben.
	const ohne = mittel(0);
	const hoch = mittel(9000);
	assert.ok(hoch > ohne * 1.2,
		"die Maximalhoehe hebt nichts: " + ohne.toFixed(0) + " -> " + hoch.toFixed(0)
		+ " Schritt im Mittel -- der Regler ist wirkungslos, sobald Gipfel da sind");

	// ⚠️ UND SIE SENKT NIE. Ein Sockel UNTER der Kammhoehe, die die Gipfel ohnehin erzwingen, darf
	// das Feld nicht veraendern -- sonst waere „Maximalhoehe" in Wahrheit eine Deckelung, und ein
	// Editor, der sie kleiner stellt, verloere sein Gebirge.
	const niedrig = mittel(200);
	assert.ok(Math.abs(niedrig - ohne) < 1,
		"ein Sockel von 200 Schritt hat das Feld veraendert (" + ohne.toFixed(0) + " -> "
		+ niedrig.toFixed(0) + ") -- die Maximalhoehe senkt, statt nur zu heben");
});

pruefe("ohne Gipfel UND ohne Kurve traegt die MITTELACHSE den Kamm", () => {
	// 💣 LIVE GEMELDET AM 04.09.2026: „ich seh halt nix". Die Flaeche hatte keinen Gipfel, und ihr
	// Label keine gerechnete Beschriftungskurve -- die entsteht erst durch „Kurven rechnen" im
	// Landschaften-Editor. Damit war `kammPunkte` leer, `stempleKamm` lief gar nicht, und die
	// Randwertaufgabe loeste ein Feld ohne einen einzigen Zwang: ueberall exakt 0.
	// ⚠️ Und es sah nicht nach einem Fehler aus, sondern nach einer kaputten Anzeige -- die Regler
	// reagierten, der Dialog meldete nichts, nur das Bild blieb leer.
	// ⭐ Die Achse ist ohnehin da: das Maximum der Abstandskarte zum Rand IST die Mittelachse.
	const ohneAlles = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: [],
		kurve: null,
		regler: { koernung: 12, maximalhoehe: 3200, bergform: 0.5, rauschen: 0.15,
			sattel: 0.95, erosion: 1, stufen: 3 },
		saat: 1,
	});
	let max = 0;
	for (let k = 0; k < ohneAlles.r.drin.length; k++) {
		if (ohneAlles.r.drin[k] && ohneAlles.h[k] > max) { max = ohneAlles.h[k]; }
	}
	assert.ok(max > 1000,
		"ohne Gipfel und ohne Kurve bleibt das Feld bei " + max.toFixed(0) + " Schritt -- der "
		+ "Mittelachsen-Rueckfall fehlt, und der Editor sieht eine einfarbige Flaeche");
	assert.strictEqual(ohneAlles.kamm.quelle, "mittelachse",
		"der Kamm kam nicht aus der Mittelachse, sondern aus `" + ohneAlles.kamm.quelle + "`");

	// 🔴 UND DIE ALTE REGEL BLEIBT: ohne Gipfel UND ohne Kammhoehe ist die Flaeche flach. Ein Gebirge
	// ganz ohne Stuetzpunkt zu erfinden waere das „erfundene Gelaendedetail". Hier IST einer da, er
	// heisst nur Kammhoehe statt Gipfel.
	const garnichts = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks: [], kurve: null,
		regler: { koernung: 12, maximalhoehe: 0 }, saat: 1,
	});
	let hoechster = 0;
	for (let k = 0; k < garnichts.h.length; k++) {
		if (garnichts.r.drin[k] && garnichts.h[k] > hoechster) { hoechster = garnichts.h[k]; }
	}
	assert.strictEqual(hoechster, 0,
		"ohne Gipfel UND ohne Kammhoehe ist ein Gebirge entstanden (" + hoechster.toFixed(0) + ")");

	// ⚠️ Und der Rand bleibt 0 -- daran haengt die Verschmelzung zweier Flaechen.
	let randVerletzt = 0;
	for (let k = 0; k < ohneAlles.r.drin.length; k++) {
		if (ohneAlles.r.drin[k] && !(ohneAlles.relief[k] > 0) && ohneAlles.h[k] > 0.5) { randVerletzt++; }
	}
	assert.strictEqual(randVerletzt, 0, "der Mittelachsen-Kamm hat den Flaechenrand angehoben");
});

pruefe("ohne Gipfel UND ohne Maximalhoehe bleibt die Flaeche flach", () => {
	// Ein Gebirge ohne jeden Stuetzpunkt zu erfinden waere das „erfundene Gelaendedetail",
	// vor dem oekosystem-instruction.md §4.1 warnt -- dieselbe Regel wie in V8.
	const leer = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks: [], regler: {},
	});
	assert.strictEqual(leer.leer, true);
});

pruefe("Erosionsstufe und Detailstufen wirken UNABHAENGIG voneinander", () => {
	// 🔴 SIE WAREN BIS ZUM 04.09.2026 EINE SPALTE. `reglerFuer` gab `terrain_levels` als `stufen` UND
	// als `erosion` weiter -- die Oktaven des fraktalen Grundrauschens (1..8) und die Erosionsstufe
	// (0..5, uebersetzt in [0, 40, 90, 150, 240, 360] Schritte) lasen denselben Wert. Wer die Erosion
	// hochzog, verstellte lautlos die Detailtiefe mit. Owner: „terrain_levels trenn die beiden!"
	//
	// 💣 Zwei Groessen, die zufaellig denselben Wertebereich haben, sind deshalb noch lange nicht
	// dieselbe Groesse -- und der Fehler war STILL: beide Regler bewegten das Bild, nur eben beide.
	const feld = (stufen, erosion) => baue({
		regler: { koernung: 4, bergform: 2, rauschen: 0.3, sattel: 0.75, stufen, erosion },
	}).h;
	const gleich = (a, b) => {
		let groesste = 0;
		for (let k = 0; k < a.length; k++) { groesste = Math.max(groesste, Math.abs(a[k] - b[k])); }

		return groesste;
	};

	// Nur die Erosion bewegt sich: das Feld MUSS sich aendern.
	assert.ok(gleich(feld(3, 1), feld(3, 5)) > 1,
		"die Erosionsstufe bewegt gar nichts -- sie kommt nicht am Trichter an");
	// Nur die Detailstufen bewegen sich: das Feld MUSS sich ebenfalls aendern.
	assert.ok(gleich(feld(2, 3), feld(6, 3)) > 1,
		"die Detailstufen bewegen gar nichts -- sie kommen nicht am Trichter an");

	// 🔴 UND DIE GEGENPROBE, die die Kopplung wirklich ausschliesst: dasselbe Paar zweimal, einmal
	// ueber Kreuz. Waeren die beiden noch EIN Wert, muesste das Feld bei (3,5) und (5,5) gleich sein
	// -- der zweite Parameter wuerde den ersten ja mitziehen.
	assert.ok(gleich(feld(3, 5), feld(5, 5)) > 1,
		"bei gleicher Erosionsstufe aendern die Detailstufen nichts -- die beiden haengen noch "
		+ "aneinander");
	assert.ok(gleich(feld(5, 1), feld(5, 5)) > 1,
		"bei gleichen Detailstufen aendert die Erosion nichts -- die beiden haengen noch aneinander");
});

pruefe("die Erosionsstufe ist eine Zahl von Schritten, keine Iteration", () => {
	assert.strictEqual(hydro.avesmapsHydroErosionsSchritte(0), 0);
	assert.strictEqual(hydro.avesmapsHydroErosionsSchritte(3), 150);
	// Ausserhalb der Skala wird geklemmt, nicht gerechnet.
	assert.strictEqual(hydro.avesmapsHydroErosionsSchritte(99),
		hydro.ECOSYSTEM_HYDRO_EROSIONSSTUFEN[hydro.ECOSYSTEM_HYDRO_EROSIONSSTUFEN.length - 1]);
	// Ein fehlender Wert faellt auf die Vorgabe, nicht auf 0 -- sonst erodiert nichts und niemand
	// merkt es.
	assert.strictEqual(hydro.avesmapsHydroErosionsSchritte(undefined), 150);
});

pruefe("derselbe Aufruf liefert dasselbe Feld -- kein Math.random", () => {
	// Echter Zufall lieferte bei jedem Neuberechnen andere Reisezeiten und verschoebe Routen lautlos.
	const a = baue();
	const b = baue();
	for (let k = 0; k < a.h.length; k += 97) {
		assert.strictEqual(a.h[k], b.h[k], "Zelle " + k + " weicht ab");
	}
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1b. DAS FREIE GELAENDE -- was zwischen den festgehaltenen Zellen liegt
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 🔴 DIE ZUSICHERUNGEN OBEN PRUEFEN AUSSCHLIESSLICH FESTGEHALTENE ZELLEN -- Gipfel, Rand, Achse,
// Spiegel. Was DAZWISCHEN liegt, also das eigentliche Gebirge, misst keine von ihnen.
// 💣 Ein Pruefagent hat das am 04.09.2026 vorgefuehrt: nimmt man den HEBUNGSTERM heraus, faellt die
// Durchschnittshoehe auf ein Sechstel (1.836 -> 510) und die Rauheit auf ein Viertel -- das Gebirge
// wird zur Platte -- und **alle elf Zusicherungen bleiben gruen**. Von vierzehn Mutationen fingen
// die Tests damals vier.

pruefe("kein Punkt waechst ueber den hoechsten eingetragenen Gipfel", () => {
	// 🔴 DIE OWNER-REGEL, woertlich: „Die vorhandene Geographie soll das Gelaende formen. Nicht die
	// Simulation soll anschliessend zufaellig eine andere Geographie erzeugen." Ein Gipfel, den
	// niemand eingetragen hat und der hoeher ist als alle echten, ist genau das.
	//
	// 💣 GENAU DAS TAT DIE HEBUNG. Sie verteilte den Abtrag nach dem STARTRELIEF -- hob also dort am
	// meisten, wo es schon hoch war -- und weil die Gipfel `festEro` sind und nicht teilnehmen, wuchs
	// der Kamm um sie herum ueber sie hinweg. Gemessen an der Roten Sichel: hoechster Punkt 10.995
	// Schritt gegen 6.650 eingetragen (+65 %), fuenf Zellen neben der Adlerspitze; Finsterkamm +62 %.
	// Seit dem 04.09.2026 hebt sie gleichmaessig, und der hoechste Punkt ist wieder der hoechste
	// Gipfel -- an beiden Livegebirgen auf den Schritt genau.
	//
	// ⚠️ Gemessen wird mit VOLLER Erosion (Stufe 5 = 360 Schritte): der Effekt waechst mit der Zahl
	// der Schritte, eine milde Einstellung sagt darueber nichts.
	const o = baue({
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 5 },
	});
	const hoechsterGipfel = Math.max(...GIPFEL.map((p) => p.h));
	let max = 0;
	let wo = -1;
	for (let k = 0; k < o.r.drin.length; k++) {
		if (o.r.drin[k] && o.h[k] > max) { max = o.h[k]; wo = k; }
	}
	assert.ok(max <= hoechsterGipfel + 1,
		"der hoechste Punkt liegt bei " + max.toFixed(0) + " Schritt, der hoechste eingetragene Gipfel "
		+ "bei " + hoechsterGipfel + " (+" + (100 * ((max / hoechsterGipfel) - 1)).toFixed(0) + " %) "
		+ "bei Zelle " + wo + " -- die Simulation hat einen Berg erfunden, den niemand eingetragen hat");
});

pruefe("die Hebung haelt die Durchschnittshoehe -- ohne sie wird das Gebirge zur Platte", () => {
	const mit = baue({ regler: Object.assign({}, {
		koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 3,
	}) });
	let vorher = 0;
	let nachher = 0;
	let n = 0;
	for (let k = 0; k < mit.r.drin.length; k++) {
		if (!mit.r.drin[k]) { continue; }
		vorher += mit.relief[k];
		nachher += mit.h[k];
		n++;
	}
	const mittelVorher = vorher / n;
	const mittelNachher = nachher / n;
	assert.ok(mittelVorher > 100, "das Probegebirge ist zu flach zum Messen");
	// Der Hebungsterm hebt genau so viel, wie abgetragen wurde. Ohne ihn traegt die Erosion das
	// Gebirge ab; gemessen am Livebestand auf ein Sechstel.
	const anteil = mittelNachher / mittelVorher;
	assert.ok(anteil > 0.7,
		"die Erosion hat das Gelaende auf " + Math.round(anteil * 100) + " % abgetragen -- "
		+ "der Hebungsterm fehlt oder wirkt nicht");
});

pruefe("die Erosion FURCHT das freie Gelaende -- sie glaettet es nicht und zerlegt es nicht", () => {
	// 🔴 DIE EINZIGE ZAHL HIER, DIE ETWAS UEBER DIE FLAECHE ZWISCHEN DEN ZWAENGEN SAGT.
	// Rauheit = mittlere Hoehendifferenz einer Zelle zu ihren vier Nachbarn.
	// 💣 Und sie wird als VERHAELTNIS gemessen, nicht als absolute Zahl: eine Spanne wie „zwischen 1
	// und 2000" ist von jeder Fixture erfuellt und laesst genau die Mutationen durch, um die es geht.
	// Gemessen an dieser Fixture: ohne Erosion 96,7 -- mit Erosion 133,0, Faktor 1,37.
	// 🪤 Die Schwelle stand bei 1,5 und ist am 04.09.2026 auf 1,25 gefallen -- NICHT weil der Test zu
	// streng war, sondern weil die Hebung an diesem Tag von hoehenproportional auf gleichmaessig
	// umgestellt wurde (Owner am Bild). Die alte hob die hohen Stellen zusaetzlich an und uebertrieb
	// damit die Rauheit; an den echten Gebirgen kostet der Wechsel fast nichts (Rote Sichel 174 ->
	// 167), an der kleinen Fixture faellt er staerker aus. Wer die Schwelle wieder anhebt, ohne die
	// Hebung anzufassen, macht den Test rot ohne einen Fehler.
	const rauheit = (erosion) => {
		const o = baue({ regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion } });
		let summe = 0;
		let m = 0;
		for (let j = 1; j < o.r.hh - 1; j++) {
			for (let i = 1; i < o.r.w - 1; i++) {
				const k = (j * o.r.w) + i;
				if (!o.r.drin[k] || !o.r.drin[k - 1] || !o.r.drin[k + 1]
					|| !o.r.drin[k - o.r.w] || !o.r.drin[k + o.r.w]) {
					continue;
				}
				summe += Math.abs(o.h[k] - o.h[k - 1]) + Math.abs(o.h[k] - o.h[k + 1])
					+ Math.abs(o.h[k] - o.h[k - o.r.w]) + Math.abs(o.h[k] - o.h[k + o.r.w]);
				m += 4;
			}
		}

		return m ? summe / m : 0;
	};
	const ohne = rauheit(0);
	const mit = rauheit(3);
	assert.ok(ohne > 1, "das Ausgangsfeld ist voellig glatt (" + ohne.toFixed(1) + ")");
	// ⚠️ ZWEI Grenzen, und beide tragen: der Abtrag (Stream Power) furcht, das Kriechen (Diffusion)
	// glaettet. Faellt der Abtrag aus, bleibt das Verhaeltnis bei 1; faellt das Kriechen aus, laeuft
	// es davon. Eine Zusicherung nur nach oben oder nur nach unten liesse je eine Haelfte durch.
	const faktor = mit / ohne;
	assert.ok(faktor > 1.25,
		"die Erosion hat nichts gefurcht -- Rauheit " + ohne.toFixed(1) + " -> " + mit.toFixed(1)
		+ " (Faktor " + faktor.toFixed(2) + "); der Abtrag fehlt oder wirkt nicht");
	assert.ok(faktor < 4,
		"die Erosion zerlegt das Gelaende -- Rauheit " + ohne.toFixed(1) + " -> " + mit.toFixed(1)
		+ " (Faktor " + faktor.toFixed(2) + "); das Kriechen fehlt oder wirkt nicht");
});

pruefe("ein Fluss DURCH einen See laesst dessen Spiegel eben", () => {
	// 🔴 Auch dieser Fall fehlte: die erste Fixture legte den Fluss bei y=10 und den See bei y=3..5.
	// Am Livebestand durchqueren Laeufe fuenf der sieben Seen der Roten Sichel, und der Fluss trug
	// seinen kumulativen Talboden (mit Einschnitt) unter den Spiegel -- vier Seen waren nicht eben.
	const o = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS,
		istDrin: IM_QUADRAT,
		peaks: [{ x: 5, y: 16, h: 4000 }],
		// Der Lauf kommt von oben (hoch) und geht mitten durch den See.
		fluesse: [{ n: "Durchlauf", dir: "forward", bach: false, p: [[5, 15], [10, 4], [18, 3]] }],
		seen: [{ n: "Probesee" }],
		istImSee: IM_SEE,
		regler: { koernung: 4, stufen: 3, bergform: 2, rauschen: 0.3, sattel: 0.75, erosion: 2 },
		saat: 77,
	});
	let min = Infinity;
	let max = -Infinity;
	for (let j = 0; j < o.r.hh; j++) {
		for (let i = 0; i < o.r.w; i++) {
			const k = (j * o.r.w) + i;
			if (!o.r.drin[k] || !IM_SEE(0, o.r.x(i), o.r.y(j))) { continue; }
			min = Math.min(min, o.h[k]);
			max = Math.max(max, o.h[k]);
		}
	}
	assert.ok(isFinite(min), "der See liegt nicht im Raster");
	assert.ok(max - min < 1,
		"die Wasserflaeche ist um " + (max - min).toFixed(0) + " Schritt geneigt -- ein Lauf hat "
		+ "seinen Talboden hineingestempelt");
});

pruefe("die Zellweiten-Klemme wird wirklich gefragt", () => {
	// 💣 Kein Test uebergab je `zellweite` -- die Klemme war unerreicht, und ihre Mutation ueberlebte.
	// Ohne sie liefert `zellweite: 0.1` ein Raster, das `avesmapsTerrainGuardRasterShape` abweist.
	const fein = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks: GIPFEL,
		zellweite: 0.1,
		regler: { erosion: 0 },
	});
	assert.ok(fein.r.cell >= hydro.ECOSYSTEM_HYDRO_ZELLWEITE - 1e-9,
		"eine ausdrueckliche Zellweite von 0,1 wurde nicht auf 0,25 geklemmt (" + fein.r.cell + ")");
});

pruefe("der Rand-Riegel gilt den Zellen INNERHALB mit Relief 0, nicht nur denen ausserhalb", () => {
	// 🪤 DIE FALSCHE MESSUNG. „Rand 0" hiess in der ersten Fassung „ausserhalb der Flaeche" -- und
	// die ist trivial erfuellt, weil dort nie etwas geschrieben wird. Die richtige Frage sind die
	// Zellen INNERHALB, deren initiales Relief 0 ist: dorthin schiebt die Diffusion Material.
	// Gemessen ohne den Riegel: 759 solche Zellen tragen danach Hoehe.
	const o = baue();
	let verletzt = 0;
	let groesste = 0;
	for (let k = 0; k < o.r.drin.length; k++) {
		if (!o.r.drin[k] || o.relief[k] > 0) { continue; }
		if (o.h[k] > 0.5) { verletzt++; groesste = Math.max(groesste, o.h[k]); }
	}
	assert.strictEqual(verletzt, 0,
		verletzt + " Innenzellen mit Relief 0 tragen Hoehe, bis " + groesste.toFixed(0) + " Schritt");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE MALSCHLEIFE -- wirklich gefahren
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("redraw() laeuft ohne Wurf durch -- der ganze Anstrich, nicht nur bis putImageData", () => {
	const quelle = fs.readFileSync(
		path.join(WURZEL, "js/map-features/map-features-ecosystem-height-render.js"), "utf8");

	// Ein Kartendoppel: nur, was der Zeichner wirklich anfasst.
	const flaeche = {
		public_id: "probe", region_name: "Probegebirge", kind: "topographie",
		region_type: "gebirge", geometry_revision: 1, bounds: BOUNDS,
		geometry: { type: "Polygon", coordinates: [[[1, 1], [19, 1], [19, 19], [1, 19], [1, 1]]] },
		terrain_grain: 4, terrain_levels: 2, terrain_avg_height: 4000,
	};
	const gemalt = { putImageData: 0 };
	const ctx2d = {
		setTransform() {}, clearRect() {},
		createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
		putImageData() { gemalt.putImageData++; },
	};
	const canvas = {
		width: 0, height: 0, style: {}, classList: { add() {}, toggle() {} },
		getContext: () => ctx2d,
	};
	const pane = { style: {}, appendChild() {} };
	const karte = {
		createPane: () => pane,
		getPane: () => pane,
		getSize: () => ({ x: 200, y: 160 }),
		containerPointToLayerPoint: () => ({ x: 0, y: 0 }),
		containerPointToLatLng: (p) => ({ lat: BOUNDS.min_y + (p[1] * 0.1), lng: BOUNDS.min_x + (p[0] * 0.1) }),
		on() {}, off() {},
	};

	// 🔴 ATTRAPPEN OHNE PROXY. Ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau den
	// ReferenceError, um dessen willen dieser Test existiert (Lehre vom 03.09.2026).
	const ctx = {
		console: { log() {}, warn() {}, error() {} },
		Math, Number, String, Array, Object, JSON, Float64Array, Uint8Array, Uint8ClampedArray,
		Infinity, NaN, isFinite, Map, Set, Date,
		performance: { now: () => 0 },
		setTimeout: () => 0,
		requestAnimationFrame: () => 0,
		devicePixelRatio: 1,
		map: karte,
		L: { DomUtil: { setPosition() {} } },
		document: { createElement: () => canvas },
		ecosystemLayers: new Map([["probe", { _ecosystemArea: flaeche }]]),
		labelData: [],
		pathData: [],
		isEcosystemLayerModeActive: () => true,
		getActiveEcosystemLayerKind: () => "topographie",
		getComputedStyle: () => ({ getPropertyValue: () => "" }),
	};
	ctx.window = ctx;
	ctx.globalThis = ctx;
	vm.createContext(ctx);

	for (const datei of [
		"js/map-features/map-features-point-in-polygon.js",
		"js/map-features/map-features-ecosystem-geometry.js",
		"js/map-features/map-features-ecosystem-height-field.js",
		"js/map-features/map-features-ecosystem-hydrologie.js",
	]) {
		ctx.module = { exports: {} };
		vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), ctx, { filename: datei });
	}
	ctx.module = { exports: {} };
	vm.runInContext(quelle, ctx, { filename: "height-render.js" });

	const zeichner = ctx.window.AvesmapsEcosystemHeightRender;
	assert.ok(zeichner && typeof zeichner.setSolid === "function", "der Zeichner ist nicht da");

	// 💣 GENAU DER ABLAUF, DER GEBROCHEN WAR: Dialog auf -> voller Anstrich.
	zeichner.setSolid(true, "probe");
	zeichner.redraw();
	assert.ok(gemalt.putImageData > 0, "es wurde gar nicht gemalt -- der Anstrich kam nie an");

	// Und der Weg zurueck: Dialog zu.
	zeichner.setSolid(false);
	zeichner.redraw();
});

pruefe("beim Schliessen des Dialogs zeichnet die Leinwand NICHTS mehr", () => {
	// „nur ein gebirge gleichzeitig" heisst auch: keins, wenn keiner offen ist.
	const quelle = fs.readFileSync(
		path.join(WURZEL, "js/map-features/map-features-ecosystem-height-render.js"), "utf8");
	assert.ok(/shouldDraw\(\)[\s\S]{0,200}!!aktiveFlaeche/.test(quelle),
		"shouldDraw() haengt nicht an der aktiven Flaeche");
});

pruefe("der Zeichner meldet die Durchschnittshoehe -- ueber die Zellen INNERHALB", () => {
	// 🔴 Owner 04.09.2026: „einfach die durchschnittshöhe in der höhenskala unten anzeigen". Sie
	// beantwortet die Frage, die ein Editor mit einer Quellenangabe wirklich hat: „steht da 1500?".
	// Der Regler nimmt ein Verhaeltnis, das Wiki nennt eine Hoehe -- und die Umrechnung haengt am
	// Gebirge (1.500 Schritt sind an der Roten Sichel 0,226, am Finsterkamm 0,300).
	//
	// 💣 GEMITTELT WIRD ueber die Zellen INNERHALB der Flaeche. Ausserhalb steht 0, und die zoegen
	// den Schnitt beliebig weit herunter -- je nachdem, wie eckig die bbox um die Flaeche sitzt.
	// Zwei gleich hohe Gebirge haetten dann verschiedene „Durchschnittshoehen", und die Zahl waere
	// als Vergleich mit dem Wiki wertlos.
	const o = baue();
	let summe = 0;
	let drin = 0;
	let alle = 0;
	for (let k = 0; k < o.r.drin.length; k++) {
		alle++;
		if (!o.r.drin[k]) { continue; }
		summe += o.h[k];
		drin++;
	}
	assert.ok(drin > 0 && drin < alle, "die Fixture fuellt das ganze Raster -- der Fehler waere unsichtbar");
	const innen = summe / drin;
	const ueberAlles = summe / alle;
	assert.ok(innen > ueberAlles * 1.1,
		"innen und ueber alles sind fast gleich (" + innen.toFixed(0) + " gegen "
		+ ueberAlles.toFixed(0) + ") -- diese Fixture kann den Fehler nicht zeigen");

	// Und der Zeichner muss ueber `drinN` mitteln, nicht ueber die Rasterlaenge.
	const quelle = fs.readFileSync(
		path.join(WURZEL, "js/map-features/map-features-ecosystem-height-render.js"), "utf8");
	const start = quelle.indexOf("mittelhoehe: () => {");
	assert.ok(start > 0, "der Zeichner meldet keine Durchschnittshoehe");
	const rumpf = quelle.slice(start, start + 600);
	// 🪤 DIE DIVISION SELBST, nicht bloss der Name. Die erste Fassung suchte `hydroRaster.r.drinN`
	// irgendwo im Rumpf -- und fand es im WAECHTER eine Zeile darueber, waehrend die Rechnung schon
	// durch `hydroRaster.h.length` ersetzt war. Die Mutation ueberlebte.
	assert.ok(rumpf.includes("summe / hydroRaster.r.drinN"),
		"gemittelt wird nicht ueber die Zellen INNERHALB -- die Nullen ausserhalb ziehen den Schnitt "
		+ "herunter, und die Zahl ist als Vergleich mit einer Quellenangabe wertlos");
	assert.ok(rumpf.includes("hydroRaster.r.drin[k]"),
		"summiert wird ohne den Innen-Filter");
});

pruefe("die Hoehen-Pane liegt UNTER den Fluessen und UEBER den Flaechenfuellungen", () => {
	const render = fs.readFileSync(
		path.join(WURZEL, "js/map-features/map-features-ecosystem-height-render.js"), "utf8");
	const bootstrap = fs.readFileSync(path.join(WURZEL, "js/app/bootstrap.js"), "utf8");
	const eigener = Number((/created\.style\.zIndex = (\d+)/.exec(render) || [])[1]);
	// 🔴 Beide Zahlen aus dem CODE lesen, keine erwartete festschreiben -- wer eine Pane verschiebt,
	// nimmt das Hoehenfeld mit.
	const wege = Number((/getPane\("roadsPane"\)\.style\.zIndex = (\d+)/.exec(bootstrap) || [])[1]);
	const seen = Number((/getPane\("ecosystemPaneTopographie"\)\.style\.zIndex = (\d+)/.exec(bootstrap) || [])[1]);
	const politisch = Number((/getPane\("regionsPane"\)\.style\.zIndex = (\d+)/.exec(bootstrap) || [])[1]);
	assert.ok(eigener < wege, "liegt ueber den Fluessen (" + eigener + " >= " + wege + ")");
	assert.ok(eigener > politisch, "liegt unter den politischen Fuellungen");
	// 💣 HIER STAND `eigener < seen`, UND DAS WAR LIVE EINE UNSICHTBARE KARTE. Seen und
	// Gebirgsflaechen liegen in DERSELBEN Pane (`ecosystemPaneTopographie`): unter den Seen zu liegen
	// heisst zwangslaeufig, unter der gefuellten Gebirgsflaeche zu liegen -- und die verdeckt das
	// Hoehenfeld vollstaendig. Am 04.09.2026 live gemeldet („ich sehe das gebirge gar nicht wenn ich
	// es editiere"), gemessen als 249 gegen 250.
	// 🔴 Die Zusicherung ist deshalb umgedreht: das Hoehenfeld liegt UEBER den Flaechenfuellungen.
	// Der halbe Owner-Wunsch, der bleibt, ist der wichtigere -- die FLUESSE liegen darueber.
	// ⭐ Wer beide Haelften will, schaltet die Fuellung der gezeigten Flaeche durchsichtig, statt an
	// der Stapelung zu drehen.
	assert.ok(eigener > seen,
		"liegt unter den Flaechenfuellungen (" + eigener + " <= " + seen + ") -- die gefuellte "
		+ "Gebirgsflaeche verdeckt dann das Hoehenfeld, und der Editor sieht gar nichts");
});

console.log("\n" + gehalten + " Zusicherungen gehalten.");
