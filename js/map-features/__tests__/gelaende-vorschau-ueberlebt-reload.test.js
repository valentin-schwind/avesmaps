"use strict";

/**
 * Was der Editor eingestellt und noch nicht gespeichert hat, überlebt ein Nachladen der Flächen.
 *
 * 💣 DER FEHLER, DEN DIESER TEST FESTNAGELT (gemeldet 05.09.2026: „während ich ein gebirge einstelle
 * setzt es aus heiterem himmel die einstellungen plötzlich während der bearbeitung zurück und das
 * höhenbild wird wieder wie zuvor. es sind 2 editoren online. es passiert auch ohne dass ich
 * klicke").
 *
 * 🔴 DER DIALOG HAT KEINE EIGENE KOPIE. `currentPropertiesArea()` liest bei JEDEM Zugriff
 * `ecosystemLayers.get(id)._ecosystemArea`, und ein Reglerzug schreibt seine Vorschau genau dorthin
 * (`area[feld.key] = …`, ausdrücklich als Vorschau, ohne zu speichern). `applyEcosystemAreaPayload`
 * ersetzte dieses Objekt bei jedem Nachladen durch die frische Serverzeile -- und damit war alles
 * weg, was noch nicht in der Datenbank stand.
 *
 * 🔴 UND NACHGELADEN WIRD OFT: bei jedem `moveend`/`zoomend` (also jedem Schwenk und jedem
 * Zoomschritt), nach jedem eigenen Schreibvorgang mit `immediate`, und über den Rückweg der
 * Beschriftungen auch dann, wenn ein ZWEITER Editor irgendwo etwas speichert. Genau das meint „es
 * passiert auch ohne dass ich klicke".
 *
 * ⚠️ Es gewinnt die ungespeicherte Vorschau, nicht der Server -- aber NUR für die eine Fläche, die
 * offen im Fenster steht. Jede andere übernimmt die frischen Werte wie bisher; sonst sähe man die
 * Arbeit des zweiten Editors nie.
 */

const assert = require("node:assert");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const loader = require(path.join(wurzel, "js/map-features/map-features-ecosystem-loader.js"));

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

const bewahre = loader.avesmapsEcosystemGelaendeVorschauBewahren;

// Die Fläche im Speicher: der Editor hat Körnung, Kammhöhe und eine Vorlage eingestellt.
const IM_SPEICHER = () => ({
	public_id: "f-1",
	region_name: "Prüfgebirge",
	kind: "topographie",
	region_type: "gebirge",
	geometry_revision: 7,
	terrain_grain: 18,
	terrain_avg_height: 1750,
	terrain_hypsometrie: 0,
	terrain_preset_morph: "karst",
	terrain_ridge_line: [[1, 1], [2, 2]],
});

// Dieselbe Fläche, wie der Server sie kennt: von den Einstellungen weiss er nichts.
const VOM_SERVER = () => ({
	public_id: "f-1",
	region_name: "Prüfgebirge — inzwischen umbenannt",
	kind: "topographie",
	region_type: "gebirge",
	geometry_revision: 7,
	terrain_grain: null,
	terrain_avg_height: null,
	terrain_hypsometrie: null,
	terrain_preset_morph: null,
	terrain_ridge_line: null,
});

pruefe("die offene Fläche behält ihre ungespeicherten Geländewerte", () => {
	const raus = bewahre(IM_SPEICHER(), VOM_SERVER(), "f-1");
	assert.strictEqual(raus.terrain_grain, 18, "die eingestellte Körnung wurde überschrieben");
	assert.strictEqual(raus.terrain_avg_height, 1750, "die eingestellte Kammhöhe wurde überschrieben");
	assert.strictEqual(raus.terrain_preset_morph, "karst", "die gemerkte Vorlage ging verloren");
	assert.deepStrictEqual(raus.terrain_ridge_line, [[1, 1], [2, 2]],
		"die gerechnete Kammlinie ging verloren -- „Gebirgszug ermitteln\" schreibt sie zuerst in den "
		+ "Speicher, gespeichert wird sie erst mit dem Gelände");
});

pruefe("eine ausdrücklich gewählte 0 überlebt genauso", () => {
	// 💣 `?? null` oder `|| server` würden die 0 als „nichts\" lesen. Die Hypsometrie 0 IST eine
	// Entscheidung („nicht vorgeben\"), und der Karst setzt sie.
	const raus = bewahre(IM_SPEICHER(), VOM_SERVER(), "f-1");
	assert.strictEqual(raus.terrain_hypsometrie, 0, "die gewählte 0 wurde als „nichts\" gelesen");
});

pruefe("alles ANDERE kommt frisch vom Server", () => {
	// ⚠️ Der Schutz gilt dem GELÄNDE, nicht der ganzen Zeile. Wer nebenan die Region umbenennt oder
	// die Art ändert, muss das sehen -- sonst wäre aus dem Schutz ein Einfrieren geworden.
	const raus = bewahre(IM_SPEICHER(), VOM_SERVER(), "f-1");
	assert.strictEqual(raus.region_name, "Prüfgebirge — inzwischen umbenannt",
		"der Schutz greift zu weit: die Fläche friert komplett ein");
});

pruefe("jede ANDERE Fläche übernimmt die frischen Werte", () => {
	// 🔴 Ohne diese Grenze sähe man die Arbeit des zweiten Editors nie mehr.
	const raus = bewahre(IM_SPEICHER(), VOM_SERVER(), "eine-andere");
	assert.strictEqual(raus.terrain_grain, null,
		"eine Fläche, die gar nicht offen ist, hält ihre alten Werte fest");
});

pruefe("ohne offenes Fenster gilt der Server", () => {
	// ⚠️ Kein offener Dialog -> nichts zu schützen. Ein leerer Bezeichner darf nicht als „passt auf
	// alles" durchgehen.
	assert.strictEqual(bewahre(IM_SPEICHER(), VOM_SERVER(), "").terrain_grain, null);
	assert.strictEqual(bewahre(IM_SPEICHER(), VOM_SERVER(), null).terrain_grain, null);
	assert.strictEqual(bewahre(IM_SPEICHER(), VOM_SERVER(), undefined).terrain_grain, null);
});

pruefe("eine neu dazugekommene Fläche geht unverändert durch", () => {
	// Kein Vorgänger = nichts zu bewahren. 💣 Und die frische Zeile muss DIESELBE bleiben, nicht eine
	// Kopie: der Aufrufer vergleicht sie danach mit `!==` gegen den Vorgänger.
	const frisch = VOM_SERVER();
	assert.strictEqual(bewahre(null, frisch, "f-1"), frisch);
	assert.strictEqual(bewahre(undefined, frisch, "f-1"), frisch);
});

pruefe("der Vorgänger wird nicht verändert", () => {
	// 💣 Die Fläche im Speicher ist das Objekt, an dem der offene Dialog hängt. Sie zu verändern
	// hiesse, ihm den Boden unter den Füssen wegzuziehen.
	const vorher = IM_SPEICHER();
	bewahre(vorher, VOM_SERVER(), "f-1");
	assert.strictEqual(vorher.region_name, "Prüfgebirge", "der Vorgänger wurde angefasst");
});

pruefe("die Feldliste deckt ALLE Geländespalten ab", () => {
	// 💣 Was hier fehlt, geht beim nächsten Schwenk lautlos verloren -- dieselbe Aufzählungsfalle wie
	// bei `ecosystemHeightRelevantChange`, wo die fünf V12-Regler zuerst nicht darin standen.
	// 🔴 GEGEN DEN DIALOG GEHALTEN, nicht gegen eine Liste im Test: `TERRAIN_FIELDS` in
	// map-features-ecosystem-properties.js ist die einzige Quelle dafür, welche Regler es gibt.
	const fs = require("node:fs");
	const properties = fs.readFileSync(
		path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8");
	const block = properties.slice(properties.indexOf("const TERRAIN_FIELDS = ["));
	const felder = [];
	const muster = /\{ key: "(terrain_[a-z_]+)"/g;
	let treffer;
	while ((treffer = muster.exec(block.slice(0, block.indexOf("\n\t];")))) !== null) {
		felder.push(treffer[1]);
	}
	assert.ok(felder.length >= 11, "TERRAIN_FIELDS wurde nicht gelesen -- der Test prüft nichts");
	const fehlen = felder.filter((f) => !loader.ECOSYSTEM_TERRAIN_VORSCHAU_FELDER.includes(f));
	assert.deepStrictEqual(fehlen, [],
		"diese Regler stehen im Dialog, aber nicht in der Bewahrung -- ihre Vorschau verschwindet beim "
		+ "nächsten Schwenk: " + fehlen.join(", "));
	// Und die zwei Vorlagen-Schlüssel plus die Kammlinie, die keine Regler sind.
	for (const zusatz of ["terrain_preset_morph", "terrain_preset_hoehe", "terrain_ridge_line"]) {
		assert.ok(loader.ECOSYSTEM_TERRAIN_VORSCHAU_FELDER.includes(zusatz),
			zusatz + " fehlt in der Bewahrung");
	}
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   DIE NAHT -- der Reload-Pfad wird WIRKLICH GEFAHREN
   ══════════════════════════════════════════════════════════════════════════════════════════════

   💣 Die Zusicherungen darüber prüfen eine reine Funktion. Ob `applyEcosystemAreaPayload` sie auch
   RUFT, sagen sie nicht -- und genau diese Lücke ist in diesem Haus schon mehrfach als „beide
   Hälften grün, die Naht ungeprüft" bezahlt worden. Ein Suchmuster wäre hier besonders schwach:
   der Aufruf muss VOR beiden Zweigen stehen (billige Abzweigung UND Neubau), und das sieht man
   einem Regex nicht an. Also wird der Payload durch den echten Loader geschickt.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

{
	const fs = require("node:fs");
	const vm = require("node:vm");

	const schichten = new Map();
	const kontext = {
		console: { log() {}, warn() {}, error() {} },
		Map, Set, Array, Number, String, Boolean, Object, JSON, Math,
		module: { exports: {} },
		setTimeout, clearTimeout,
		ecosystemLayers: schichten,
		// Der Dialog sagt, welche Fläche offen steht -- hier: „f-1".
		window: {
			AvesmapsEcosystemProperties: { offeneFlaeche: () => "f-1" },
			AvesmapsEcosystemHeightRender: {
				betrifftAnzeige: () => true,
				invalidate() {}, redraw() {}, invalidateArea() {},
			},
		},
		// Nur die Nachbarn, die der billige Zweig wirklich anfasst.
		formatEcosystemAreaTooltip: () => "",
		ecosystemAreaStyle: () => ({}),
		applyEcosystemAreaDeckkraft: () => {},
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(
		fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-loader.js"), "utf8"),
		kontext
	);

	// Die Fläche liegt schon auf der Karte, mit den ungespeicherten Werten des Editors daran.
	const imSpeicher = IM_SPEICHER();
	schichten.set("f-1", { _ecosystemArea: imSpeicher, setTooltipContent() {}, setStyle() {} });
	// Dazu eine zweite, die NICHT offen ist -- an ihr muss der Server gewinnen.
	const fremdImSpeicher = Object.assign(IM_SPEICHER(), { public_id: "f-2" });
	schichten.set("f-2", { _ecosystemArea: fremdImSpeicher, setTooltipContent() {}, setStyle() {} });

	kontext.applyEcosystemAreaPayload({
		revision: 1,
		cascade_enabled: false,
		areas: [VOM_SERVER(), Object.assign(VOM_SERVER(), { public_id: "f-2" })],
	});

	pruefe("NAHT: der echte Reload lässt die Werte der offenen Fläche stehen", () => {
		const danach = schichten.get("f-1")._ecosystemArea;
		assert.strictEqual(danach.terrain_grain, 18,
			"`applyEcosystemAreaPayload` hat die Vorschau überschrieben -- die Bewahrung wird auf dem "
			+ "Reload-Pfad gar nicht gerufen, egal wie grün die Zusicherungen darüber sind");
		assert.strictEqual(danach.terrain_avg_height, 1750, "die Kammhöhe ging beim Reload verloren");
		assert.strictEqual(danach.region_name, "Prüfgebirge — inzwischen umbenannt",
			"der frische Name kam nicht durch -- der Schutz friert die ganze Zeile ein");
	});

	pruefe("NAHT: an jeder anderen Fläche gewinnt der Server", () => {
		assert.strictEqual(schichten.get("f-2")._ecosystemArea.terrain_grain, null,
			"eine Fläche, die nicht offen ist, hält ihre alten Werte fest -- dann sieht man die Arbeit "
			+ "des zweiten Editors nie");
	});
}

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
