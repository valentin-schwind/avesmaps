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

pruefe("ohne Gipfel UND ohne Maximalhoehe bleibt die Flaeche flach", () => {
	// Ein Gebirge ohne jeden Stuetzpunkt zu erfinden waere das „erfundene Gelaendedetail",
	// vor dem oekosystem-instruction.md §4.1 warnt -- dieselbe Regel wie in V8.
	const leer = hydro.avesmapsGebirgsRasterBauen({
		bounds: BOUNDS, istDrin: IM_QUADRAT, peaks: [], regler: {},
	});
	assert.strictEqual(leer.leer, true);
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
	// Gemessen an dieser Fixture: ohne Erosion 83,9 -- mit Erosion 173,4. Die Erosion VERDOPPELT die
	// Rauheit, weil sie Rinnen einschneidet und Ruecken stehenlaesst.
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
	assert.ok(faktor > 1.5,
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

pruefe("die Hoehen-Pane liegt UNTER Fluessen und Seen", () => {
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
	assert.ok(eigener < seen, "liegt ueber den Seen (" + eigener + " >= " + seen + ")");
	assert.ok(eigener > politisch, "liegt unter den politischen Fuellungen");
});

console.log("\n" + gehalten + " Zusicherungen gehalten.");
