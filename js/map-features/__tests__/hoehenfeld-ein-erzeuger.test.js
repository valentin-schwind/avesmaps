"use strict";

/**
 * EIN Erzeuger für das gespeicherte Höhenfeld.
 *
 * 🔴 Seit V12 (04.09.2026) entsteht das Höhenfeld eines Gebirges in `avesmapsGebirgsRasterBauen`
 * -- Randwertaufgabe aus Gipfeln, Kamm, Flüssen und Seen, danach hydraulische Erosion -- und
 * gespeichert wird es an GENAU EINER Stelle: `gebirgsRasterHochladen` im Render-Modul der Karte.
 *
 * Vom 04.09. bis 14.09.2026 war der Sammellauf „Höhenraster" des Landschaften-Editors stillgelegt:
 * er rechnete noch die alte Bergsumme (`sampleEcosystemHeightField`) und schrieb sie über einen
 * EIGENEN `heightmap_put` in dieselbe Tabelle -- ein Klick hätte jedes V12-Raster überschrieben,
 * still. Seither rechnet er wieder, aber nicht selbst: er ruft je Gebirge den Speicherweg des
 * Hauptfensters. Damit gibt es EINEN Schreiber statt zweier, und der zweite kann nicht mehr
 * auseinanderlaufen, weil es ihn nicht mehr gibt.
 *
 * 💣 Genau diese Falle hat das Projekt bei der Verkehrsmittel-Sperre und beim Querfeldein-Ausstieg
 * schon zweimal bezahlt: eine Regel, die einen von zwei Erzeugern bindet, ist keine Regel.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie trägt CRLF, `actions/checkout` im Deploy-Tor LF.
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8").replace(/\r\n/g, "\n");
// ⚠️ Kommentare raus, BEVOR gesucht wird: dieser Test und der Kopf des Sammellaufs nennen die alten
// Funktionen beim Namen. Ein Quelltexttest, der seine eigene Warnung mitliest, schlägt auf sich an.
const ohneKommentare = (text) => text
	.replace(/<!--[\s\S]*?-->/g, "")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

let bestanden = 0;
const offen = [];
const pruefe = (name, fn) => {
	offen.push((async () => fn())().then(() => {
		bestanden++;
		console.log("  ok  " + name);
	}, (fehler) => {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}));
};

const EDITOR = lies("html/landschaften-editor.html");

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. DIE MENGE DER SCHREIBER
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("genau EINE Stelle im Repo ruft `heightmap_put` -- der Speicherweg der Karte", () => {
	// Gezählt wird über die ganze Oberfläche, nicht über eine Datei: ein zweiter Erzeuger wäre genau
	// der Fehler, den dieser Test verhindert, und er entstünde woanders.
	const dateien = [];
	const sammle = (verzeichnis) => {
		for (const eintrag of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
			const p = verzeichnis + "/" + eintrag.name;
			if (eintrag.isDirectory()) {
				if (eintrag.name === "__tests__" || eintrag.name === "third-party") { continue; }
				sammle(p);
			} else if (/\.(js|html)$/.test(eintrag.name)) {
				dateien.push(p);
			}
		}
	};
	sammle("js");
	sammle("html");
	const rufer = dateien.filter((p) => ohneKommentare(lies(p)).includes('"heightmap_put"'));
	assert.deepStrictEqual(rufer.sort(), [
		"js/map-features/map-features-ecosystem-height-render.js",
	], "die Menge der Schreiber des Höhenfelds hat sich geändert:\n    " + rufer.join("\n    "));
});

pruefe("der Editor rechnet das Höhenfeld nicht mehr selbst -- weder die alte Rasterung noch den Stapel", () => {
	const ohne = ohneKommentare(EDITOR);
	for (const alt of ["rasterizeEcosystemHeightField(", "sampleEcosystemHeightField(", "HOEHENRASTER_SAMMELLAUF_STILLGELEGT"]) {
		assert.ok(!ohne.includes(alt), "der Editor enthält noch `" + alt + "`");
	}
});

pruefe("der Knopf ist wieder scharf -- und sagt nicht mehr „stillgelegt“", () => {
	const knopf = (EDITOR.match(/<button[^>]*id="ecoHeightmap"[^>]*>[^<]*<\/button>/) || [])[0];
	assert.ok(knopf, "der Knopf `ecoHeightmap` wurde nicht gefunden");
	assert.ok(!/\sdisabled(\s|=|>)/.test(knopf), "der Knopf ist noch deaktiviert");
	assert.ok(!/\sdata-stillgelegt(\s|=|>)/.test(knopf), "der Knopf trägt noch `data-stillgelegt`");
	assert.ok(!/>\s*stillgelegt\s*</.test(knopf), "der Knopf ist noch mit „stillgelegt“ beschriftet");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DER SAMMELLAUF -- ausgeschnitten und GEFAHREN, nicht gelesen
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 🔴 Ein Regex über den Quelltext sähe „ruft hochladen" und wüsste nichts über Reihenfolge, Filter
// oder das, was nach einem Fehlschlag passiert. Deshalb wird die Funktion wirklich ausgeführt --
// mit dem Hauptfenster als Attrappe. 💣 KEIN Proxy als Attrappe: einer, der jeden Bezeichner
// beantwortet, verschluckt genau den ReferenceError, um dessentwillen ein solcher Test existiert.
function sammellaufQuelle() {
	const start = EDITOR.indexOf("async function runHeightmaps()");
	assert.ok(start > 0, "der Sammellauf `runHeightmaps` wurde nicht gefunden");
	const ende = EDITOR.indexOf("\n}\n", start);
	assert.ok(ende > start, "das Ende des Sammellaufs wurde nicht gefunden");

	return EDITOR.slice(start, ende + 2);
}

const BESTAND = [
	{ public_id: "g-a", kind: "topographie", region_type: "gebirge", region_name: "Amboss" },
	{ public_id: "s-1", kind: "topographie", region_type: "see", region_name: "Probesee" },
	{ public_id: "g-b", kind: "topographie", region_type: "gebirge", region_name: "Bruchkamm" },
	{ public_id: "w-1", kind: "vegetation", region_type: "wald", region_name: "Forst" },
	{ public_id: "g-c", kind: "topographie", region_type: "gebirge", region_name: "Flachstock" },
];

function fahreSammellauf({ hochladen, ohneKarte = false, staende = [BESTAND], vorbelegt = null }) {
	const protokoll = [];
	const knopf = { disabled: false };
	const zeile = { textContent: "" };
	let geladen = 0;
	const render = ohneKarte ? null : {
		hochladen: (area, optionen) => {
			protokoll.push({
				was: "hochladen", id: area.public_id, flaeche: area, bestand: optionen && optionen.bestand,
				knopfGesperrt: knopf.disabled, zeile: zeile.textContent,
			});

			return hochladen(area, optionen);
		},
	};
	const kontext = vm.createContext({
		Promise, Date, Number, String, Array, Object, Math, JSON, Error, Map, Set, Boolean, console,
		$: (id) => (id === "ecoHeightmap" ? knopf : (id === "ecoHeightmapInfo" ? zeile : null)),
		// Was die Seite schon im Speicher trägt -- womöglich vom Sitzungsbeginn.
		allAreas: vorbelegt,
		// Jeder Aufruf liefert den nächsten Stand. So lässt sich ein Regler „während des Laufs“ verstellen.
		loadAreas: async () => {
			const stand = staende[Math.min(geladen, staende.length - 1)];
			geladen++;
			protokoll.push({ was: "loadAreas" });

			return stand;
		},
		ecoPost: async (aktion) => {
			protokoll.push({ was: "post", aktion });

			return aktion === "heightmap_status" ? { area_count: 3, missing: 0, stale: 0 } : {};
		},
		setStatus: (text) => protokoll.push({ was: "status", text }),
		flashStatus: (text, ton) => protokoll.push({ was: "flash", text, ton }),
		heightmapStatus: null,
		heightmapRunNote: "",
		renderHeightmapTile: () => protokoll.push({ was: "kachel" }),
	});
	kontext.window = { parent: render ? { AvesmapsEcosystemHeightRender: render } : {} };
	vm.runInContext(sammellaufQuelle(), kontext, { filename: "runHeightmaps" });

	return kontext.runHeightmaps().then(() => ({ protokoll, knopf, zeile }));
}

const ALLES_GUT = async () => ({ hochgeladen: true, bytes: 2048, flach: false });

pruefe("gerechnet werden GENAU die Gebirge, in der Reihenfolge des Bestands", async () => {
	const { protokoll } = await fahreSammellauf({ hochladen: ALLES_GUT });
	const ids = protokoll.filter((e) => e.was === "hochladen").map((e) => e.id);
	assert.deepStrictEqual(ids, ["g-a", "g-b", "g-c"],
		"gerechnet wurden " + JSON.stringify(ids) + " -- ein See oder ein Wald ist kein Gebirge");
});

pruefe("jede Fläche bekommt den GANZEN Bestand mit -- samt der Seen ausserhalb des Kartenausschnitts", async () => {
	// 💣 Die Karte lädt Landschaftsflächen nur für ihren Ausschnitt. Ohne den Bestand fehlten einem
	// Gebirge ausserhalb des Bildes seine Seen, und sein Raster trüge eine Wasserfläche als Hang.
	const { protokoll } = await fahreSammellauf({ hochladen: ALLES_GUT });
	const aufrufe = protokoll.filter((e) => e.was === "hochladen");
	assert.strictEqual(aufrufe.length, 3);
	for (const aufruf of aufrufe) {
		assert.ok(Array.isArray(aufruf.bestand), aufruf.id + " bekam keinen Bestand");
		assert.ok(aufruf.bestand.some((a) => a.public_id === "s-1"),
			aufruf.id + " bekam einen Bestand ohne den See");
		assert.strictEqual(aufruf.bestand.length, BESTAND.length,
			aufruf.id + " bekam einen gefilterten Bestand -- die Seen sind KEINE Gebirge und müssen trotzdem mit");
	}
});

pruefe("der Editor räumt erst auf, rechnet dann -- und schreibt selbst NICHTS", async () => {
	const { protokoll } = await fahreSammellauf({ hochladen: ALLES_GUT });
	const aufraeumen = protokoll.findIndex((e) => e.was === "post" && e.aktion === "heightmap_cleanup");
	const erstesHochladen = protokoll.findIndex((e) => e.was === "hochladen");
	assert.ok(aufraeumen >= 0, "`heightmap_cleanup` wurde nicht gerufen");
	assert.ok(aufraeumen < erstesHochladen, "aufgeräumt wurde erst NACH dem ersten Raster");
	assert.ok(!protokoll.some((e) => e.was === "post" && e.aktion === "heightmap_put"),
		"der Editor schreibt das Raster selbst -- das ist der zweite Erzeuger");
});

pruefe("während gerechnet wird, ist der Knopf gesperrt und die Zeile zeigt den Fortschritt", async () => {
	// 🔴 An `disabled` hängt die Unterzeile des Sammelknopfs („Höhenraster rechnet …").
	const { protokoll, knopf } = await fahreSammellauf({ hochladen: ALLES_GUT });
	const aufrufe = protokoll.filter((e) => e.was === "hochladen");
	assert.ok(aufrufe.every((e) => e.knopfGesperrt), "der Knopf war während der Rechnung frei");
	assert.ok(/2\/3/.test(aufrufe[1].zeile) && aufrufe[1].zeile.includes("Bruchkamm"),
		"die Zeile zeigt beim zweiten Gebirge „" + aufrufe[1].zeile + "“ statt Zähler und Namen");
	assert.strictEqual(knopf.disabled, false, "nach dem Lauf bleibt der Knopf gesperrt");
});

pruefe("ein Gebirge, das scheitert, hält den Lauf NICHT an -- und wird beim Namen genannt", async () => {
	const { protokoll, knopf } = await fahreSammellauf({
		hochladen: async (area) => {
			if (area.public_id === "g-b") { throw new Error("Höhenberechnung abgebrochen."); }
			if (area.public_id === "g-c") { return { hochgeladen: true, bytes: 100, flach: true }; }

			return { hochgeladen: true, bytes: 2048, flach: false };
		},
	});
	const ids = protokoll.filter((e) => e.was === "hochladen").map((e) => e.id);
	assert.deepStrictEqual(ids, ["g-a", "g-b", "g-c"], "nach dem Fehlschlag wurde nicht weitergerechnet");

	const meldung = protokoll.filter((e) => e.was === "flash").pop();
	assert.ok(meldung, "am Ende steht keine Meldung");
	assert.strictEqual(meldung.ton, "bad", "ein gescheitertes Gebirge wird als Erfolg gemeldet");
	assert.ok(meldung.text.includes("Bruchkamm"), "das gescheiterte Gebirge wird nicht genannt: " + meldung.text);
	assert.ok(meldung.text.includes("Flachstock"), "das flach gebliebene Gebirge wird nicht genannt: " + meldung.text);

	// Danach wird der Stand neu gelesen und die Kachel gezeichnet -- sonst stünde „69 veraltet" weiter da.
	const letzterRaster = protokoll.map((e) => e.was).lastIndexOf("hochladen");
	const status = protokoll.findIndex((e) => e.was === "post" && e.aktion === "heightmap_status");
	assert.ok(status > letzterRaster, "der Rasterstatus wurde nicht NACH dem Lauf neu gelesen");
	assert.ok(protokoll.some((e) => e.was === "kachel"), "die Kachel wurde nicht neu gezeichnet");
	assert.strictEqual(knopf.disabled, false, "nach einem Fehlschlag bleibt der Knopf gesperrt");
});

pruefe("ein nicht gespeichertes Raster zählt NICHT als gespeichert", async () => {
	const { protokoll } = await fahreSammellauf({
		hochladen: async (area) => (area.public_id === "g-a"
			? { hochgeladen: false, grund: "leeres Raster" }
			: { hochgeladen: true, bytes: 10, flach: false }),
	});
	const meldung = protokoll.filter((e) => e.was === "flash").pop();
	assert.strictEqual(meldung.ton, "bad", "ein nicht gespeichertes Raster wird als Erfolg gemeldet");
	assert.ok(meldung.text.includes("Amboss") && meldung.text.includes("leeres Raster"),
		"Name und Grund fehlen in der Meldung: " + meldung.text);
});

pruefe("ohne Kartenfenster rechnet und löscht er NICHTS -- und sagt warum", async () => {
	// 💣 Aufgeräumt wird nur, wenn danach auch geschrieben werden kann: `heightmap_cleanup` löscht.
	let gerufen = 0;
	const { protokoll, knopf } = await fahreSammellauf({
		ohneKarte: true,
		hochladen: async () => { gerufen++; return { hochgeladen: true }; },
	});
	assert.strictEqual(gerufen, 0);
	assert.ok(!protokoll.some((e) => e.was === "post"), "ohne Karte wurde trotzdem der Server angefasst");
	const meldung = protokoll.filter((e) => e.was === "flash").pop();
	assert.ok(meldung && meldung.ton === "bad", "ohne Karte steht keine Fehlermeldung da");
	assert.strictEqual(knopf.disabled, false);
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DER STAND, MIT DEM GERECHNET WIRD -- und der, gegen den der Server stempelt
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

// 💣 Der Server stempelt jedes Raster mit den Reglern, die BEIM SCHREIBEN in der Datenbank stehen
// (`avesmapsTerrainAreaFingerprint`). Rechnet der Lauf mit einem älteren Stand, trägt das Raster das
// alte Gelände unter einem aktuellen Stempel: die Kachel sagt „aktuell", die Wegfindung rechnet mit
// dem Alten, und nichts meldet einen Fehler. Gefunden vom Prüfagenten am 14.09.2026, bevor der Lauf
// live ging -- und schlimmer als gemeldet: der erste Bau nahm `allAreas` aus dem Sitzungsbeginn.

const MIT = (id, felder) => BESTAND.map((area) => (area.public_id === id ? { ...area, ...felder } : area));

pruefe("der Bestand wird FRISCH geladen -- ein Stand vom Sitzungsbeginn rechnete mit alten Reglern", async () => {
	const alt = BESTAND.map((area) => ({ ...area, terrain_avg_height: 1000 }));
	const neu = BESTAND.map((area) => ({ ...area, terrain_avg_height: 3000 }));
	const { protokoll } = await fahreSammellauf({ hochladen: ALLES_GUT, vorbelegt: alt, staende: [neu] });
	const aufrufe = protokoll.filter((e) => e.was === "hochladen");
	assert.strictEqual(aufrufe.length, 3, "es wurden " + aufrufe.length + " Raster gerechnet statt 3");
	assert.ok(aufrufe.every((e) => e.flaeche.terrain_avg_height === 3000),
		"gerechnet wurde mit dem Stand aus dem Speicher, nicht mit dem frisch geladenen");
	assert.ok(aufrufe.every((e) => e.bestand.every((a) => a.terrain_avg_height === 3000)),
		"der mitgegebene Bestand ist der alte");
});

pruefe("ein WÄHREND des Laufs geändertes oder neues Gebirge wird mit dem neuen Stand nachgerechnet", async () => {
	const neuesGebirge = { public_id: "g-d", kind: "topographie", region_type: "gebirge", region_name: "Neustock" };
	const zweiter = [...MIT("g-b", { terrain_erosion: 5 }), neuesGebirge];
	const { protokoll } = await fahreSammellauf({ hochladen: ALLES_GUT, staende: [BESTAND, zweiter, zweiter] });
	const aufrufe = protokoll.filter((e) => e.was === "hochladen");
	assert.deepStrictEqual(aufrufe.map((e) => e.id), ["g-a", "g-b", "g-c", "g-b", "g-d"],
		"gerechnet wurden " + JSON.stringify(aufrufe.map((e) => e.id))
		+ " -- das geänderte und das neue Gebirge müssen nachgerechnet werden, die übrigen nicht");
	assert.strictEqual(aufrufe[3].flaeche.terrain_erosion, 5, "nachgerechnet wurde mit dem alten Stand");
	assert.ok(aufrufe[3].bestand === zweiter, "die Nachrechnung bekam nicht den neuen Bestand");

	const meldung = protokoll.filter((e) => e.was === "flash").pop();
	assert.strictEqual(meldung.ton, "ok", "eine gelungene Nachrechnung wird als Fehler gemeldet: " + meldung.text);
	assert.ok(meldung.text.startsWith("4 von 4"), "die Meldung zählt „" + meldung.text + "“ statt 4 von 4");
	const letzterRaster = protokoll.map((e) => e.was).lastIndexOf("hochladen");
	const status = protokoll.findIndex((e) => e.was === "post" && e.aktion === "heightmap_status");
	assert.ok(status > letzterRaster, "der Rasterstatus wurde vor der Nachrechnung gelesen");
});

pruefe("ändert es sich auch in der Nachrechnung, wird es GENANNT -- nie still als aktuell gestempelt", async () => {
	const { protokoll } = await fahreSammellauf({
		hochladen: ALLES_GUT,
		staende: [BESTAND, MIT("g-b", { terrain_erosion: 5 }), MIT("g-b", { terrain_erosion: 1 })],
	});
	const ids = protokoll.filter((e) => e.was === "hochladen").map((e) => e.id);
	assert.deepStrictEqual(ids, ["g-a", "g-b", "g-c", "g-b"], "es wurde nicht genau einmal nachgerechnet: " + JSON.stringify(ids));
	const meldung = protokoll.filter((e) => e.was === "flash").pop();
	assert.strictEqual(meldung.ton, "bad", "ein weiter veränderliches Gebirge wird als Erfolg gemeldet");
	assert.ok(meldung.text.includes("Bruchkamm"), "das weiter veränderliche Gebirge wird nicht genannt: " + meldung.text);
});

Promise.allSettled(offen).then(() => {
	if (!process.exitCode) {
		console.log("\n" + bestanden + " Zusicherungen gehalten.");
	}
});
