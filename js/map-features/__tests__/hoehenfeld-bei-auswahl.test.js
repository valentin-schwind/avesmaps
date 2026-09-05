"use strict";

/**
 * EIN KLICK AUF EIN GEBIRGE ZEIGT SEIN RELIEF (Owner 05.09.2026).
 *
 * 🔴 AUSGEFÜHRT, NICHT GELESEN -- und zwar BEIDES: die Regel selbst und der Trichter, der sie ruft.
 * Ein Regex über `setSelectedEcosystemArea` sagt nichts darüber, ob der Aufruf im Geltungsbereich
 * steht; genau daran ist am 03.09.2026 ein Bauer zwei Stunden lang öffentlich zerbrochen.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
let gehalten = 0;

function pruefe(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => { gehalten++; console.log("  ok  " + name); })
		.catch((error) => { console.error("  FEHLER  " + name); throw error; });
}

// Ein Aufbau je Fall -- der Modulzustand (Bestandsliste, eigene Anzeige) darf nicht überlaufen.
function aufbau(o) {
	const anrufe = { setSolid: [], status: 0 };
	let ausgewaehlt = o.ausgewaehlt === undefined ? "" : o.ausgewaehlt;
	const ctx = {
		console: { log() {}, warn() {}, error() {} },
		Promise, Date, Set, String, Object, Number, Boolean,
		canEditEcosystemOnMap: () => o.editor !== false,
		isEcosystemLayerModeActive: () => o.ebeneAktiv !== false,
		getActiveEcosystemLayerKind: () => (o.kind === undefined ? "topographie" : o.kind),
		getSelectedEcosystemAreaPublicId: () => ausgewaehlt,
		postEcosystemEdit: (aktion) => {
			anrufe.status++;
			assert.equal(aktion, "heightmap_status", "es wird eine andere Aktion gerufen");

			// 🪤 DIE ATTRAPPE MUSS DIE ECHTE FORM HABEN: `heightmap_status` liefert JEDE aktive
			// Gebirgsfläche, die ohne Raster mit `has_raster: false`. Eine Attrappe, die nur die
			// Fläche mit Raster zurückgibt, kann den Unterschied gar nicht zeigen -- und genau
			// daran hat eine Mutationsprobe die erste Fassung dieses Tests entlarvt: „`has_raster`
			// wird ignoriert" blieb grün, weil in der Liste ohnehin nur Treffer standen.
			const mit = (o.mitRaster || []).map((id) => ({ public_id: id, has_raster: true }));
			const ohne = (o.ohneRaster || ["berg-2", "berg-3", "berg-9"])
				.filter((id) => !(o.mitRaster || []).includes(id))
				.map((id) => ({ public_id: id, has_raster: false }));

			return (o.antwort || Promise.resolve({ areas: mit.concat(ohne) }));
		},
	};
	ctx.window = ctx;
	ctx.globalThis = ctx;
	ctx.AvesmapsEcosystemHeightRender = {
		setSolid: (an, id) => { anrufe.setSolid.push([an, id === undefined ? null : id]); },
	};
	vm.createContext(ctx);
	ctx.module = { exports: {} };
	vm.runInContext(
		fs.readFileSync(path.join(WURZEL, "js/map-features/hoehenfeld-bei-auswahl.js"), "utf8"),
		ctx, { filename: "hoehenfeld-bei-auswahl.js" },
	);

	return {
		anrufe,
		waehle(id) { ausgewaehlt = String(id || ""); ctx.avesmapsHoehenfeldBeiAuswahl(ausgewaehlt); },
		// Ohne die Auswahl mitzuziehen -- fuer den Wettlauf.
		rufeNur(id) { ctx.avesmapsHoehenfeldBeiAuswahl(String(id || "")); },
		setzeAuswahl(id) { ausgewaehlt = String(id || ""); },
		ruhe: () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0))),
	};
}

async function alles() {
	await pruefe("ein Gebirge MIT gespeichertem Höhenfeld zeigt sein Relief", async () => {
		const a = aufbau({ mitRaster: ["berg-1"] });
		a.waehle("berg-1");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [[true, "berg-1"]],
			"das Relief wurde nicht eingeschaltet: " + JSON.stringify(a.anrufe.setSolid));
	});

	await pruefe("eine Fläche OHNE gespeichertes Höhenfeld zeigt nichts", async () => {
		// 🔴 Owner-Entscheid 05.09.2026: „nur mit gespeichertem Höhenfeld" -- nicht „rechne mal und
		// schau, ob was kommt". Ein Rechenlauf kostet rund 1,5 s, und zwar VOR der Antwort.
		const a = aufbau({ mitRaster: ["berg-1"] });
		a.waehle("berg-2");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [],
			"eine Fläche ohne Höhenfeld hat die Leinwand angefasst");
	});

	await pruefe("was der DIALOG eingeschaltet hat, schaltet ein Klick nicht aus", async () => {
		// 💣 Zwei Besitzer, eine Leinwand. Ohne diese Regel nimmt ein Klick auf eine Fläche ohne
		// Höhenfeld dem offenen Eigenschaften-Dialog sein Bild weg, während seine Regler stehen
		// bleiben -- und das sieht wie ein kaputter Dialog aus, nicht wie eine Auswahl.
		const a = aufbau({ mitRaster: [] });
		a.waehle("berg-2");
		await a.ruhe();
		a.waehle("");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [],
			"das Modul hat etwas ausgeschaltet, das es nie eingeschaltet hat");
	});

	await pruefe("die eigene Anzeige geht beim Abwählen wieder aus", async () => {
		const a = aufbau({ mitRaster: ["berg-1"] });
		a.waehle("berg-1");
		await a.ruhe();
		a.waehle("");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [[true, "berg-1"], [false, null]],
			"Abwählen loescht das Relief nicht: " + JSON.stringify(a.anrufe.setSolid));
	});

	await pruefe("ausserhalb der Topographie-Ebene passiert nichts", async () => {
		// 🔴 Owner-Entscheid 05.09.2026: nur dort. In „Alle" laege das Relief ueber Wald und Wasser.
		for (const kind of ["vegetation", "hydrologie", "klima", "alle"]) {
			const a = aufbau({ mitRaster: ["berg-1"], kind });
			a.waehle("berg-1");
			await a.ruhe();
			assert.deepEqual(a.anrufe.setSolid, [], "in der Ebene " + kind + " wurde gezeichnet");
			assert.equal(a.anrufe.status, 0, "in der Ebene " + kind + " wurde sogar gefragt");
		}
	});

	await pruefe("ein Besucher ohne Bearbeitungsrecht bekommt nichts", async () => {
		const a = aufbau({ mitRaster: ["berg-1"], editor: false });
		a.waehle("berg-1");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [], "einem Nur-Leser wurde das Relief gezeigt");
		assert.equal(a.anrufe.status, 0, "fuer einen Nur-Leser wurde der Bestand geholt");
	});

	await pruefe("die Bestandsliste wird nicht bei jedem Klick geholt", async () => {
		// ⚠️ Ein Fehltreffer darf sie erneuern (eine gerade erzeugte Flaeche steht noch nicht drin),
		// aber nicht bei jedem Klick -- sonst kostet jede raster-lose Flaeche eine Anfrage.
		const a = aufbau({ mitRaster: ["berg-1"] });
		a.waehle("berg-2");
		await a.ruhe();
		a.waehle("berg-3");
		await a.ruhe();
		a.waehle("berg-1");
		await a.ruhe();
		assert.equal(a.anrufe.status, 1, "der Bestand wurde " + a.anrufe.status + "-mal geholt");
		assert.deepEqual(a.anrufe.setSolid, [[true, "berg-1"]]);
	});

	await pruefe("eine späte Antwort malt nicht für eine längst verlassene Auswahl", async () => {
		// 💣 Die Anfrage laeuft, der Editor klickt weiter. Ohne die Gegenprobe leuchtet das Relief
		// einer Flaeche auf, die niemand mehr ausgewaehlt hat.
		let loese;
		const a = aufbau({
			mitRaster: ["berg-1"],
			antwort: new Promise((r) => { loese = r; }),
		});
		a.rufeNur("berg-1");
		a.setzeAuswahl("berg-9");
		loese({ areas: [{ public_id: "berg-1", has_raster: true }] });
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [],
			"die Antwort wurde auf eine verlassene Auswahl angewandt");
	});

	await pruefe("ein Fehlschlag der Anfrage faellt OFFEN aus", async () => {
		const a = aufbau({ mitRaster: [], antwort: Promise.reject(new Error("kaputt")) });
		a.waehle("berg-1");
		await a.ruhe();
		assert.deepEqual(a.anrufe.setSolid, [], "ein Fehlschlag hat die Leinwand angefasst");
	});

	/* ── Die Verdrahtung: der Trichter ruft die Regel wirklich ───────────────────────────────── */

	await pruefe("setSelectedEcosystemArea ruft die Regel -- beim Waehlen UND beim Abwaehlen", () => {
		const quelle = fs.readFileSync(
			path.join(WURZEL, "js/map-features/map-features-ecosystem-rendering.js"), "utf8",
		).replace(/\r\n/g, "\n");
		const start = quelle.indexOf("function setSelectedEcosystemArea(publicId) {");
		assert.ok(start >= 0, "der Trichter heisst nicht mehr setSelectedEcosystemArea");
		const ende = quelle.indexOf("\n}\n", start);
		const rumpf = quelle.slice(start, ende + 3);

		const gerufen = [];
		const ctx = {
			selectedEcosystemAreaPublicId: "",
			ecosystemLayers: new Map(),
			applyEcosystemSelectionClass() {},
			syncEcosystemGeometryEdit() {},
			syncEcosystemDoubleClickZoom() {},
			avesmapsHoehenfeldBeiAuswahl: (id) => { gerufen.push(id); },
			String, Map,
		};
		vm.createContext(ctx);
		vm.runInContext(rumpf + "\nthis.setSelectedEcosystemArea = setSelectedEcosystemArea;", ctx);
		ctx.setSelectedEcosystemArea("berg-1");
		ctx.setSelectedEcosystemArea("");
		assert.deepEqual(gerufen, ["berg-1", ""],
			"der Trichter meldet die Auswahl nicht weiter: " + JSON.stringify(gerufen));
	});

	console.log("OK: " + gehalten + " Zusicherungen -- der Klick zeigt das Relief, und nur das.");
}

alles().catch((error) => { console.error(error); process.exitCode = 1; });
