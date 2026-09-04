"use strict";

/**
 * Die Vorlagen: „Morphologie" und „Höhenstufe".
 *
 * 🔴 Owner 04.09.2026: zehn Geländeformen und fünf Höhenstufen als Auswahlfeld, statt zwölf
 * einzelner Zahlen von Hand. Eine Vorlage ist eine AKTION, kein Zustand: sie schreibt Werte in die
 * Regler und ist danach vergessen. Gespeichert werden die Zahlen, nie der Name.
 *
 * 🔴 Die zehn sind die GEOMORPHOLOGISCHE SYSTEMATIK, und die Zahlen darin sind die des Owners
 * (04.09.2026, gegen Copernicus-DEM-Graustufen und das amtliche BKG-DGM1 abgeglichen). Wer einen
 * Wert ändert, ändert eine Messung -- nicht einen Geschmack.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
const hydro = require(path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js"));

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

const markup = lies("index.html");
const properties = lies("js/map-features/map-features-ecosystem-properties.js");

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. DIE TABELLEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("beide Tabellen sind vollständig und tragen die bestellten Namen", () => {
	// 🔴 Die Namen sind die des Owners, wörtlich. Wer einen umbenennt, benennt eine Geländeform um,
	// die ein Editor im Fenster wiedererkennen soll.
	assert.deepStrictEqual(
		hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.map((v) => v.name),
		["Kammgebirge", "Gratgebirge", "Kettengebirge", "Kuppengebirge", "Massengebirge",
			"Plateaugebirge", "Rumpfgebirge", "Schild", "Inselberg", "Karst"],
		"die Morphologien stimmen nicht mit der Bestellung überein");
	assert.deepStrictEqual(
		hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN.map((v) => v.name),
		["Tiefland", "Hügelland", "Vorgebirge", "Mittelgebirge", "Hochgebirge"],
		"die Höhenstufen stimmen nicht mit der Bestellung überein");
});

pruefe("die zehn Vorlagen tragen die gemessenen Werte des Owners", () => {
	// 🔴 DAS SIND MESSUNGEN, KEIN GESCHMACK. Der Owner hat sie am 04.09.2026 gegen die
	// Graustufen-Höhenmodelle des Copernicus DEM und die Beschreibung des amtlichen BKG-DGM1
	// abgeglichen (Taunus, Riesengebirge, Harz, Frankenwald, Schwäbische Alb) und ausdrücklich
	// mitgegeben: „die Zahlen darin sind eine Herleitung und werden durch die ersetzt, die ich dir
	// hier mitgebe". Wer eine ändert, ändert eine Messung -- das ist eine Entscheidung, kein
	// Aufräumen, und sie gehört in denselben Commit wie diese Zeile.
	// 💣 Ohne diese Zusicherung fällt eine Rücknahme durch JEDEN anderen Test: eine
	// Mutationsprobe hat `hypsometrie` des Kettengebirges von 0,40 auf die verworfene Herleitung
	// 0,50 zurückgedreht, und das ganze Testfeld blieb grün.
	// ⚠️ „Kammhöhe" steht bewusst NICHT hier -- sie ist die Frage der Höhenstufe, nicht der Form
	// (Owner: „Sie ist ein separates Höhenstufen-Preset und beschreibt nicht die Gebirgsform").
	const soll = {
		//                koernung bergform rauschen sattel talbreite einschnitt erosion hypso plateau stufen
		kammgebirge:    [14,   2,   0.25, 0.95, 1.6,  550, 3, 0.45, 0.9,  3],
		gratgebirge:    [5,    2,   0.45, 0.88, 0.9,  800, 5, 0.4,  1,    6],
		kettengebirge:  [9,    2.5, 0.5,  0.92, 1.1, 1100, 5, 0.4,  1,    4],
		kuppengebirge:  [9,    3.5, 0.3,  0.55, 1.6,  450, 4, 0.33, 1,    4],
		massengebirge:  [10,   4,   0.35, 0.8,  1.5,  500, 3, 0.47, 0.75, 4],
		plateaugebirge: [12,   0.5, 0.15, 0.95, 1.5,  500, 1, 0.6,  0.25, 3],
		rumpfgebirge:   [16,   2,   0.3,  0.8,  2,    400, 5, 0.3,  0.85, 5],
		schild:         [20,   0.3, 0.12, 0.95, 3,    200, 5, 0.7,  0.15, 2],
		inselberg:      [14,   8,   0.2,  0.3,  2.5,  550, 5, 0.15, 1,    3],
		karst:          [23.6, 2.5, 0.35, 0.75, 1.5,  400, 5, 0,    1,    5],
	};
	const spalten = ["koernung", "bergform", "rauschen", "sattel", "talbreite", "einschnitt",
		"erosion", "hypsometrie", "plateau", "stufen"];
	assert.deepStrictEqual(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.map((v) => v.key), Object.keys(soll),
		"Schlüssel oder Reihenfolge der Morphologien weichen von der Bestellung ab");
	for (const v of hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN) {
		assert.deepStrictEqual(Object.keys(v.werte).sort(), spalten.slice().sort(),
			"„" + v.name + "\" setzt nicht genau die zehn Formregler");
		spalten.forEach((sp, n) => {
			assert.strictEqual(v.werte[sp], soll[v.key][n],
				"„" + v.name + "\": " + sp + " ist " + v.werte[sp] + ", der Owner hat " + soll[v.key][n]
				+ " gemessen");
		});
	}
});

pruefe("die zwei Tabellen fassen einander NICHT an", () => {
	// 💣 ZWEI FRAGEN, ZWEI TABELLEN. Die Morphologie sagt, welche FORM das Gelände hat, die
	// Höhenstufe, wie hoch es liegt -- ein Kuppengebirge gibt es im Hügelland wie im Hochgebirge.
	// Griffe eine Morphologie an die Kammhöhe, überschriebe die Wahl einer Form still die Höhe,
	// und der Editor müsste die Reihenfolge kennen, in der er die zwei Felder bedient.
	for (const v of hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN) {
		assert.ok(!("maximalhoehe" in v.werte),
			"die Morphologie „" + v.name + "\" setzt die Kammhöhe -- das ist die Aufgabe der Höhenstufe");
	}
	for (const v of hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN) {
		assert.deepStrictEqual(Object.keys(v.werte), ["maximalhoehe"],
			"die Höhenstufe „" + v.name + "\" setzt mehr als die Kammhöhe");
	}
});

pruefe("jeder Vorlagenwert liegt in den Schranken seines Reglers", () => {
	// 💣 Die Schranken stehen an DREI Stellen (Regler im Markup, Klemme im Server, Klemme im
	// Trichter). Eine Vorlage, die darüber hinausgeht, wird beim Speichern still gekappt -- und das
	// gespeicherte Gebirge ist dann ein anderes als das gezeigte.
	// 🔴 GELESEN, NICHT ABGESCHRIEBEN. Hier stand die Tabelle als Zahlen im Test -- eine zweite
	// Wahrheit neben `index.html`, die beim nächsten Umbau der Regler stumm veraltet: der Test hätte
	// dann gegen Schranken geprüft, die es nicht mehr gibt.
	// 🚩 Und genau diese Frage war am 04.09.2026 zweimal falsch beantwortet: „Schild" trug
	// `hypsometrie` 0,72 bei `max="0.7"`, „Inselberg" `sattel` 0,2 bei `min="0.3"`. Eine Vorlage
	// schreibt ihre Werte mit `regler.value = ...` in den Schieber, und der KLEMMT beim Zuweisen --
	// der Editor sähe 0,7 bzw. 0,3, während die Vorgabemarke auf 0,72 bzw. 0,2 zeigt und das ↺
	// nicht mehr weggeht, ohne dass jemand etwas verstellt hat.
	// ⚠️ `stufen` und `maximalhoehe` heißen im Markup anders als im Trichter.
	const reglerId = {
		koernung: "grain", stufen: "levels", erosion: "erosion", plateau: "plateau",
		hypsometrie: "hypsometrie", bergform: "bergform", rauschen: "rauschen", sattel: "sattel",
		talbreite: "talbreite", einschnitt: "einschnitt", maximalhoehe: "avgheight",
	};
	const grenzen = {};
	for (const [schluessel, id] of Object.entries(reglerId)) {
		const treffer = markup.match(new RegExp("id=\"ecosystem-properties-" + id
			+ "\" type=\"range\" min=\"([\\d.]+)\" max=\"([\\d.]+)\""));
		assert.ok(treffer, "der Regler `" + id + "` steht nicht mehr im Markup");
		grenzen[schluessel] = [Number(treffer[1]), Number(treffer[2])];
	}
	const alle = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.concat(hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN);
	for (const v of alle) {
		for (const [schluessel, wert] of Object.entries(v.werte)) {
			const spanne = grenzen[schluessel];
			assert.ok(spanne, "„" + v.name + "\" setzt den unbekannten Regler `" + schluessel + "`");
			assert.ok(wert >= spanne[0] && wert <= spanne[1],
				"„" + v.name + "\": " + schluessel + " = " + wert + " liegt ausserhalb ["
				+ spanne[0] + ", " + spanne[1] + "]");
		}
	}
});

pruefe("die Vorlagen liefern eine KOPIE, keine Referenz", () => {
	// 💣 Gäbe sie die Tabellenzeile selbst heraus, veränderte der erste Aufrufer, der einen Wert
	// anfasst, die Vorlage für alle folgenden -- und zwar für die Laufzeit des ganzen Tabs.
	const a = hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "massengebirge");
	a.plateau = 0.999;
	const b = hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "massengebirge");
	assert.notStrictEqual(b.plateau, 0.999, "die Vorlage wurde vom Aufrufer verändert");
	assert.strictEqual(hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, "gibtsnicht"), null,
		"ein unbekannter Schlüssel liefert nicht null");
});

pruefe("jeder ALTE Vorlagen-Schlüssel findet einen heutigen", () => {
	// 💣 EINE FLAECHE SPEICHERT NUR IHRE ZEHN ZAHLEN, der Vorlagenname ist Herkunftsangabe. Traegt
	// sie `massiv`, aendert die Umbenennung an ihrem GELAENDE nichts -- ohne diese Uebersetzung
	// staende im Editor aber ploetzlich kein Name mehr in der Falte, es gaebe keine Vorgabemarken
	// und keine ↺, obwohl niemand etwas angefasst hat.
	const heute = new Set(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.map((v) => v.key));
	for (const [alt, neu] of Object.entries(hydro.ECOSYSTEM_HYDRO_MORPH_ALTNAMEN)) {
		assert.ok(heute.has(neu),
			"der alte Schlüssel `" + alt + "` zeigt auf `" + neu + "`, das es nicht gibt");
		assert.ok(!heute.has(alt),
			"`" + alt + "` steht in der Übersetzung UND in der Tabelle -- dann übersetzt sie ihn weg");
		assert.ok(hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN,
			hydro.avesmapsHydroMorphSchluessel(alt)),
			"`" + alt + "` findet nach der Übersetzung keine Werte");
	}
	// Unbekanntes kommt unverändert zurück -- der Aufrufer entscheidet, was das heißt.
	assert.strictEqual(hydro.avesmapsHydroMorphSchluessel("gibtsnicht"), "gibtsnicht");
	assert.strictEqual(hydro.avesmapsHydroMorphSchluessel("karst"), "karst",
		"ein heutiger Schlüssel darf nicht übersetzt werden");
	// ⚠️ Leeres bleibt leer: `undefined` heißt „keine Vorlage gemerkt", nicht „unbekannte Vorlage".
	assert.strictEqual(hydro.avesmapsHydroMorphSchluessel(undefined), "");
	assert.strictEqual(hydro.avesmapsHydroMorphSchluessel(null), "");
	// 🚩 Die fünf, die es wirklich gab -- eine gekürzte Liste würde eine Fläche stillschweigend
	// verwaisen lassen, und niemand zählt nach.
	assert.deepStrictEqual(Object.keys(hydro.ECOSYSTEM_HYDRO_MORPH_ALTNAMEN).sort(),
		["haertling", "karstrelief", "kegelberge", "massiv", "plateau"],
		"die Übersetzung deckt nicht mehr genau die fünf abgelösten Schlüssel ab");
});

pruefe("die Oberfläche liest den gespeicherten Schlüssel DURCH die Übersetzung", () => {
	// 💣 AUSGEFÜHRT, NICHT GELESEN. Ein Regex kennt keinen Geltungsbereich: er findet
	// `morphSchluessel(area)` auch dann, wenn die Funktion daneben gar nicht mehr existiert oder
	// etwas anderes zurückgibt. Der Block wird deshalb ausgeschnitten und wirklich gefahren.
	const vm = require("vm");
	const von = properties.indexOf("\tfunction morphSchluessel(area) {");
	const marke = "\tfunction vorlagenName(liste, key) {";
	const bis = properties.indexOf("\n\t}", properties.indexOf(marke));
	assert.ok(von > 0 && bis > von, "der Leseblock steht nicht mehr da, wo er stand");
	const block = properties.slice(von, bis + 3);

	const kontext = {
		avesmapsHydroMorphSchluessel: hydro.avesmapsHydroMorphSchluessel,
		avesmapsHydroVorlage: hydro.avesmapsHydroVorlage,
		ECOSYSTEM_HYDRO_MORPHOLOGIEN: hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN,
		ECOSYSTEM_HYDRO_HOEHENSTUFEN: hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN,
		// Nur die zwei Schlüssel, die der Test wirklich abfragt -- die volle Tabelle steht im Code.
		VORLAGEN_FELDER: { plateau: "terrain_plateau", sattel: "terrain_sattel" },
	};
	vm.createContext(kontext);
	vm.runInContext(block
		+ "\n;this.__w = vorlagenWerte; this.__n = vorlagenName; this.__m = morphSchluessel;", kontext);

	// Eine Fläche, die `massiv` gespeichert hat, bekommt die Werte des Massengebirges.
	const alt = kontext.__w({ terrain_preset_morph: "massiv" });
	const neu = kontext.__w({ terrain_preset_morph: "massengebirge" });
	assert.deepStrictEqual(alt, neu,
		"`massiv` liefert nicht dieselben Vorgaben wie `massengebirge` -- die Übersetzung fehlt im Lesepfad");
	assert.ok(Object.keys(alt).length > 0, "der Lesepfad liefert überhaupt keine Vorgaben");
	// 💣 UND DER TITEL DER FALTE AN SEINER EIGENEN AUFRUFSTELLE. Hier stand zuerst
	// `__n(..., avesmapsHydroMorphSchluessel("haertling"))` -- der Test wandte die Übersetzung
	// SELBST an und prüfte damit nur `vorlagenName`. Eine Mutationsprobe hat es gezeigt: nimmt man
	// dem Titel-Block seine Übersetzung, blieb der Test grün. Ein VAKUUM, dieselbe Klasse wie
	// `includes("fn(data)")`, das die Definitionszeile mittrifft.
	const tvon = properties.indexOf("\t\tconst titel = propertiesElement(\"foldtitle\");");
	const tbis = properties.indexOf("\n\t\t}", tvon);
	assert.ok(tvon > 0 && tbis > tvon, "der Titel-Block steht nicht mehr da, wo er stand");
	const tblock = properties.slice(tvon, tbis + 4);
	let geschrieben = null;
	const tkontext = Object.assign({}, kontext, {
		propertiesElement: () => ({ set textContent(v) { geschrieben = v; } }),
		vorlagenName: kontext.__n,
		morphSchluessel: kontext.__m,
		area: { terrain_preset_morph: "haertling", terrain_preset_hoehe: "hochgebirge" },
	});
	vm.createContext(tkontext);
	vm.runInContext(tblock, tkontext);
	assert.ok(geschrieben && geschrieben.includes("Inselberg"),
		"der Titel der Falte nennt für `haertling` nicht „Inselberg“ (gelesen: " + geschrieben + ")");
	assert.ok(geschrieben.includes("Hochgebirge"),
		"der Titel nennt die Höhenstufe nicht mehr -- die zweite Hälfte ist verlorengegangen");
	// ⚠️ Und eine Fläche ohne gemerkte Vorlage bleibt ohne Vorgaben -- sonst hätte plötzlich jede
	// Fläche Marken und ↺, die auf eine Vorlage zeigen, die niemand gewählt hat.
	// 🪟 Ein Objekt aus dem vm-Kontext trägt einen FREMDEN `Object.prototype` --
	// `deepStrictEqual` gegen ein Host-`{}` fällt bei gleichem Inhalt („same structure but not
	// reference-equal"). Vor dem Vergleich in den eigenen Realm heben, wie bei den Arrays im
	// Quellen-Umbau. Der Vergleich `alt`/`neu` darüber ist davon frei: beide kommen von dort.
	assert.deepStrictEqual({ ...kontext.__w({}) }, {});

	// 🔴 DER SCHREIBWEG DARF NICHT ÜBERSETZEN. Er speichert, was der Editor gewählt hat, und das
	// ist immer schon ein heutiger Schlüssel; übersähe er das, schriebe ein bloßes Öffnen und
	// Speichern die Herkunftsangabe einer fremden Fläche um.
	assert.ok(properties.includes("payload.terrain_preset_morph = reset ? \"\" : String(area.terrain_preset_morph || \"\")"),
		"der Schreibweg sieht anders aus als erwartet -- übersetzt er jetzt?");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. SIE MÜSSEN UNTERSCHIEDLICHE GELÄNDE ERGEBEN
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("jede Morphologie ergibt ein eigenes Gelände", () => {
	// 🔴 DIE EIGENTLICHE ZUSICHERUNG. Neun Namen, die dasselbe Feld liefern, sind neun Lügen -- und
	// genau das ist beim ersten Entwurf passiert: „Massiv" und „Plateau" lagen bei 42,3 % gegen
	// 43,9 % Fläche auf Gipfelhöhe, also praktisch gleich. Erst die zweite Runde trennte sie.
	// ⚠️ Gemessen wird das hypsometrische Integral, weil es die Form beschreibt und nicht die Höhe.
	const MX = 25, MY = 25, R = 18;
	const istDrin = (x, y) => {
		const dx = x - MX, dy = y - MY, w = Math.atan2(dy, dx);

		return Math.hypot(dx, dy) <= R * (1 + (0.13 * Math.sin(3 * w)) + (0.07 * Math.cos((5 * w) + 1)));
	};
	// 🪤 SIEBEN GIPFEL, NICHT DREI. Mit drei war „Karst" von „Härtling" nicht zu trennen (HI 0,272
	// gegen 0,257) -- obwohl ihre Regler weit auseinanderliegen: Bergform 2,5 gegen 7, Sattel 0,75
	// gegen 0,35. Die BERGFORM braucht Berge, um sich zu zeigen; an drei Gipfeln misst man sie kaum.
	// Mit sieben: HI 0,308 gegen 0,221, also der fünffache Abstand.
	// ⭐ Die Lehre ist dieselbe wie bei der vierten Kennzahl weiter unten: wer eine Zusicherung nicht
	// erfüllen kann, prüft zuerst, ob sie das Richtige MISST -- und ob die Fixture den Unterschied
	// überhaupt zeigen kann.
	const gipfel = [
		{ x: MX - 11, y: MY - 5, h: 2600 },
		{ x: MX - 5, y: MY - 1, h: 3400 },
		{ x: MX, y: MY + 1, h: 4000 },
		{ x: MX + 6, y: MY + 3, h: 2900 },
		{ x: MX + 11, y: MY + 5, h: 3100 },
		{ x: MX - 3, y: MY + 7, h: 2400 },
		{ x: MX + 4, y: MY - 6, h: 2700 },
	];
	// 💣 UND SIE BRAUCHT EIN TALNETZ, SONST SIND ZWEI DER ZEHN REGLER TOT. `talbreite` und
	// `einschnitt` wirken NUR an Fluessen -- ohne `fluesse` rechnet der Trichter sie gar nicht erst.
	// Gemessen am 04.09.2026: nimmt man dieser Fixture die Fluesse und aendert NUR `einschnitt`
	// 550 -> 1100 und `talbreite` 1,6 -> 1,1, betraegt die Summe aller Hoehenunterschiede exakt
	// 0,0 -- mit Fluessen 3.895.151. Die Fixture war damit blind fuer ein Fuenftel dessen, was eine
	// Vorlage ueberhaupt einstellt.
	// 🚩 Genau daran ist der Test beim Wechsel auf die zehn Formen gescheitert: „Kammgebirge"
	// und „Kettengebirge" unterscheiden sich am staerksten im `einschnitt` (550 gegen 1100 -- die
	// tiefen alpinen Laengstaeler), und das war die eine Zahl, die die Fixture nicht sehen konnte.
	// Ohne Fluesse lagen sie auf ALLEN VIER Achsen zusammen, mit Fluessen trennt sie die Rauheit.
	// ⭐ Die Lehre steht schon zweimal in dieser Datei: wer eine Zusicherung nicht erfuellen kann,
	// prueft zuerst, ob die Fixture den Unterschied ueberhaupt ZEIGEN kann -- und aendert nicht die
	// Werte, bis die Namen nicht mehr zu ihren Formen passen.
	// ⚠️ Ein Laengstal am Kamm und drei Quertaeler, wie eine echte Gebirgsflaeche sie traegt.
	// `tiefe` und `bachAnteil` werden NICHT gesetzt: beide haben im Trichter eine Vorgabe, und die
	// Fixture soll nur das setzen, was eine Morphologie wirklich sagt.
	const fluesse = [
		{ n: "Längstal", dir: "forward", bach: false,
			p: [[MX - 13, MY - 7], [MX - 6, MY - 3], [MX + 1, MY + 1], [MX + 8, MY + 4], [MX + 13, MY + 7]] },
		{ n: "Quertal 1", dir: "forward", bach: false,
			p: [[MX - 7, MY - 2], [MX - 9, MY + 5], [MX - 11, MY + 12]] },
		{ n: "Quertal 2", dir: "forward", bach: false,
			p: [[MX + 2, MY + 2], [MX + 4, MY - 5], [MX + 6, MY - 12]] },
		{ n: "Quertal 3", dir: "forward", bach: true,
			p: [[MX + 9, MY + 5], [MX + 11, MY + 11]] },
	];
	const werte = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.map((v) => {
		const o = hydro.avesmapsGebirgsRasterBauen({
			bounds: { min_x: 0, min_y: 0, max_x: 50, max_y: 50 },
			istDrin,
			peaks: gipfel,
			kurve: [[MX - 11, MY - 4], [MX, MY], [MX + 10, MY + 4]],
			fluesse,
			seen: [],
			regler: Object.assign({ maximalhoehe: 0 },
				hydro.avesmapsHydroVorlage(hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN, v.key)),
			saat: 4242,
		});

		// 💣 DREI KENNZAHLEN, NICHT EINE. Das HI allein reicht nicht: „Massiv" und „Gratgebirge"
		// duerfen dieselbe Hoehenverteilung haben und trotzdem verschieden aussehen -- der eine hat
		// einen breiten Kern, der andere einen scharfen Grat. Gemessen werden deshalb Verteilung
		// (HI), Flaechenanteil auf Gipfelhoehe (das Plateau) und Rauheit (die Zerfurchung).
		let hoch = 0;
		let drin = 0;
		let max = 0;
		let rau = 0;
		let m = 0;
		for (let k = 0; k < o.h.length; k++) { if (o.r.drin[k] && o.h[k] > max) { max = o.h[k]; } }
		for (let k = 0; k < o.h.length; k++) {
			if (!o.r.drin[k]) { continue; }
			drin++;
			if (o.h[k] > 0.8 * max) { hoch++; }
		}
		for (let j = 1; j < o.r.hh - 1; j++) {
			for (let i = 1; i < o.r.w - 1; i++) {
				const k = (j * o.r.w) + i;
				if (!o.r.drin[k] || !o.r.drin[k - 1]) { continue; }
				rau += Math.abs(o.h[k] - o.h[k - 1]);
				m++;
			}
		}

		// 💣 UND EINE VIERTE, DIE DIE SKALA MISST. Drei Aggregate ueber die ganze Flaeche trennen
		// „Kuppengebirge" und „Karstrelief" nicht -- ihre Hoehenverteilung ist aehnlich, ihr
		// Unterschied ist die KOERNUNG (9 gegen 2). Gemessen wird deshalb das Verhaeltnis der Rauheit
		// auf kurzer zu der auf langer Distanz: ein feinkoerniges Relief hat viel Struktur schon
		// zwischen Nachbarzellen, ein grobwelliges erst ueber acht.
		// 🪤 Ohne diese Zahl habe ich beim Bau dreimal die Vorlagenwerte verschoben, um einen Test zu
		// befriedigen, der den Unterschied gar nicht sehen konnte -- und dabei die Namen von ihren
		// Formen entfernt. Wer eine Zusicherung nicht erfuellen kann, prueft zuerst, ob sie das
		// Richtige misst.
		let fern = 0;
		let fm = 0;
		for (let j = 8; j < o.r.hh - 8; j++) {
			for (let i = 8; i < o.r.w - 8; i++) {
				const k = (j * o.r.w) + i;
				if (!o.r.drin[k] || !o.r.drin[k - 8]) { continue; }
				fern += Math.abs(o.h[k] - o.h[k - 8]);
				fm++;
			}
		}
		const nah = m ? rau / m : 0;
		const weit = fm ? fern / fm : 0;

		return {
			name: v.name,
			hi: hydro.hypsometrischesIntegral(o.h, o.r.drin),
			plateau: drin ? hoch / drin : 0,
			rauheit: m ? (rau / m) / max : 0,
			koernigkeit: weit > 0 ? nah / weit : 0,
		};
	});
	// 🪤 UND DIE SCHWELLE IST NIEDRIG, MIT GRUND. Acht Formen leben in EINEM stetigen Raum -- sie
	// sind zwangsläufig Nachbarn, und „Gratgebirge" neben „Massiv" ist kein Fehler, sondern die
	// Wirklichkeit (HI 0,534 gegen 0,560). Die erste Fassung setzte 0,04 und zog damit die Werte
	// künstlich auseinander, bis die Namen nicht mehr zu ihren Formen passten. Was dieser Test
	// verhindern soll, ist echte DOPPLUNG: zwei Vorlagen, die dasselbe Feld liefern.
	// 🚩 DREI PAARE HAENGEN AN EINER EINZIGEN ACHSE, gemessen 04.09.2026 (Abstand geteilt durch
	// Schwelle): Gratgebirge/Kettengebirge x1,01 (HI) · Rumpfgebirge/Karst x1,12 (Koernigkeit) ·
	// Kammgebirge/Kettengebirge x1,89 (Rauheit). Wer hier rot wird, hat nicht zwangslaeufig etwas
	// kaputtgemacht -- die drei linienfoermigen Formen sind im Modell echte Nachbarn.
	// 🔴 DER GRUND IST BEKANNT UND VOM OWNER BENANNT (04.09.2026): das Werkzeug hat nur EINE
	// Kammfuehrung. Ein Kettengebirge mit mehreren echten Parallelketten laesst sich damit ueber
	// Rauschen nur annaehern, nicht konstruieren -- es liegt zwangslaeufig zwischen Kamm und Grat.
	// Eine zweite Kammlinie waere die Abhilfe, und das ist ein eigenes Stueck Arbeit.
	// ⚠️ Die Messdistanz 8 der vierten Kennzahl ist dafuer NICHT der Hebel: ueber 4, 6, 8, 10, 12,
	// 16, 20 und 24 Zellen durchgemessen, trennt 8 dieses Paar am zweitbesten (10 waere x1,02).
	for (let a = 0; a < werte.length; a++) {
		for (let b = a + 1; b < werte.length; b++) {
			const x = werte[a];
			const y = werte[b];
			const getrennt = Math.abs(x.hi - y.hi) > 0.02
				|| Math.abs(x.plateau - y.plateau) > 0.04
				|| Math.abs(x.rauheit - y.rauheit) > 0.004
				|| Math.abs(x.koernigkeit - y.koernigkeit) > 0.02;
			assert.ok(getrennt,
				"„" + x.name + "\" und „" + y.name + "\" ergeben dasselbe Gelände: HI "
				+ x.hi.toFixed(3) + "/" + y.hi.toFixed(3)
				+ ", Plateau " + (100 * x.plateau).toFixed(1) + "/" + (100 * y.plateau).toFixed(1) + " %"
				+ ", Rauheit " + x.rauheit.toFixed(4) + "/" + y.rauheit.toFixed(4)
				+ ", Koernigkeit " + x.koernigkeit.toFixed(3) + "/" + y.koernigkeit.toFixed(3));
		}
	}
});

pruefe("keine zwei Vorlagen tragen dieselben Werte", () => {
	// 🔴 DAS IST DIE HARTE FRAGE, und sie braucht keine Toleranz: zwei Eintraege mit identischen
	// Zahlen sind zwei Namen fuer eine Sache, ganz gleich wie das Feld aussieht. Der Test darueber
	// misst das ERGEBNIS und muss Nachbarschaft erlauben; dieser misst die ABSICHT.
	const alle = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN;
	for (let a = 0; a < alle.length; a++) {
		for (let b = a + 1; b < alle.length; b++) {
			assert.notDeepStrictEqual(alle[a].werte, alle[b].werte,
				"„" + alle[a].name + "\" und „" + alle[b].name + "\" tragen dieselben Werte");
		}
	}
	const schluessel = alle.map((v) => v.key)
		.concat(hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN.map((v) => v.key));
	assert.strictEqual(new Set(schluessel).size, schluessel.length,
		"ein Vorlagen-Schluessel kommt doppelt vor -- `avesmapsHydroVorlage` faende dann immer den ersten");
});

pruefe("die Höhenstufen steigen streng an", () => {
	const hoehen = hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN.map((v) => v.werte.maximalhoehe);
	for (let n = 1; n < hoehen.length; n++) {
		assert.ok(hoehen[n] > hoehen[n - 1],
			"„" + hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN[n].name + "\" ist nicht höher als die Stufe davor");
	}
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DIE VERDRAHTUNG
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("die Auswahlfelder stehen im Markup und werden aus den TABELLEN gefüllt", () => {
	assert.ok(markup.includes('id="ecosystem-properties-morphologie"'), "das Morphologie-Feld fehlt");
	assert.ok(markup.includes('id="ecosystem-properties-hoehenstufe"'), "das Höhenstufen-Feld fehlt");
	// 💣 KEINE `<option>` im Markup: eine Liste von Hand wäre beim nächsten Tabelleneintrag still
	// unvollständig, und niemand zählt nach.
	const ohneKommentare = markup.replace(/<!--[\s\S]*?-->/g, "");
	for (const id of ["morphologie", "hoehenstufe"]) {
		const start = ohneKommentare.indexOf('id="ecosystem-properties-' + id + '"');
		const ende = ohneKommentare.indexOf("</select>", start);
		assert.ok(start > 0 && ende > start, "das Feld " + id + " hat kein schliessendes Tag");
		assert.ok(!ohneKommentare.slice(start, ende).includes("<option"),
			"das Feld " + id + " trägt Einträge im Markup -- sie gehören in die Tabelle");
	}
	assert.ok(properties.includes("ECOSYSTEM_HYDRO_MORPHOLOGIEN")
		&& properties.includes("ECOSYSTEM_HYDRO_HOEHENSTUFEN"),
		"die Oberfläche liest die Tabellen nicht");
});

pruefe("jeder Vorlagen-Schlüssel findet einen Regler -- sonst schreibt er ins Leere", () => {
	// 💣 Die Vorlagen sprechen die Sprache des Trichters (`plateau`, `koernung` …), die Formularfelder
	// die der Datenbank (`terrain_plateau` …). Fehlt eine Übersetzung, schreibt die Vorlage lautlos
	// ins Leere: ein unbekannter Schlüssel findet einfach kein Feld, und es gibt keine Fehlermeldung.
	const block = properties.slice(properties.indexOf("const VORLAGEN_FELDER = {"),
		properties.indexOf("};", properties.indexOf("const VORLAGEN_FELDER = {")));
	const alle = hydro.ECOSYSTEM_HYDRO_MORPHOLOGIEN.concat(hydro.ECOSYSTEM_HYDRO_HOEHENSTUFEN);
	const schluessel = new Set();
	for (const v of alle) { Object.keys(v.werte).forEach((k) => schluessel.add(k)); }
	for (const k of schluessel) {
		assert.ok(new RegExp("\\b" + k + ":").test(block),
			"der Vorlagen-Schlüssel `" + k + "` hat keine Übersetzung in VORLAGEN_FELDER");
	}
	// Und jedes ZIEL muss ein echtes Feld sein.
	const felder = properties.slice(properties.indexOf("const TERRAIN_FIELDS = ["),
		properties.indexOf("];", properties.indexOf("const TERRAIN_FIELDS = [")));
	for (const treffer of block.matchAll(/"(terrain_[a-z_]+)"/g)) {
		assert.ok(felder.includes('"' + treffer[1] + '"'),
			"VORLAGEN_FELDER zeigt auf `" + treffer[1] + "`, das es in TERRAIN_FIELDS nicht gibt");
	}
});

pruefe("eine Vorlage SPEICHERT nicht -- sie setzt nur die Regler", () => {
	// 🔴 Der Editor sieht das Ergebnis und entscheidet dann. Dieselbe Trennung wie bei jedem anderen
	// Regler, und sie ist der Grund, warum „Auf Automatik zurück" daneben noch etwas bedeutet.
	const start = properties.indexOf("function wendeVorlageAn(");
	const ende = properties.indexOf("\n\t}", start);
	assert.ok(start > 0 && ende > start, "wendeVorlageAn wurde nicht gefunden");
	const rumpf = properties.slice(start, ende);
	assert.ok(!rumpf.includes("saveTerrainSettings") && !rumpf.includes("postEcosystemEdit"),
		"das Anwenden einer Vorlage schreibt in die Datenbank");
	assert.ok(rumpf.includes("schedulePreviewRedraw"),
		"nach dem Anwenden wird das Bild nicht neu gezeichnet");
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
