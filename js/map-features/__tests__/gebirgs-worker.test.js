"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const hydroPath = path.resolve(__dirname, "../map-features-ecosystem-hydrologie.js");
const context = vm.createContext({
	...require("./gebirgs-worker-hilfe.cjs")(),
	document: { currentScript: { src: hydroPath } },
	console,
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, "../map-features-point-in-polygon.js"), "utf8"), context);
vm.runInContext(fs.readFileSync(hydroPath, "utf8"), context);

async function pruefen() {
	const geometry = { type: "Polygon", coordinates: [
		[[0, 0], [15, 0], [15, 15], [0, 15], [0, 0]],
		[[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
	] };
	const nachbar = { type: "Polygon", coordinates: [[[14, 0], [25, 0], [25, 15], [14, 15], [14, 0]]] };
	const eingabe = {
		bounds: { min_x: 0.13, min_y: 0.17, max_x: 20.13, max_y: 20.17 },
		geometry, nachbarn: [nachbar],
		seen: [{ g: geometry }], fluesse: [], peaks: [{ x: 10, y: 10, h: 3000 }],
		regler: { erosion: 1, maximalhoehe: 2000 }, saat: 42,
	};
	const erwartet = context.avesmapsGebirgsRasterBauen({
		...eingabe,
		istDrin: (x, y) => context.pointInGeometry([x, y], geometry),
		istImSee: (i, x, y) => context.pointInGeometry([x, y], eingabe.seen[i].g),
	});
	let heartbeat = false;
	const timer = setTimeout(() => { heartbeat = true; }, 0);
	const ergebnis = await context.avesmapsGebirgsRasterImWorker(eingabe);
	clearTimeout(timer);
	assert.ok(heartbeat, "Der Hauptthread bleibt während der Rechnung bedienbar.");
	assert.deepEqual(Array.from(ergebnis.h), Array.from(erwartet.h), "Alle Höhen bleiben identisch.");
	assert.deepEqual(Array.from(ergebnis.r.eigen), Array.from(erwartet.r.eigen));
	assert.equal(ergebnis.r.cell, 0.25);
	assert.equal(ergebnis.r.bounds.min_x, 0.13);
	const fremd = { ...eingabe, geometry: nachbar, peaks: [{ x: 16, y: 10, h: 9000 }], saat: 99 };
	const verbunden = await context.avesmapsGebirgsRasterImWorker({ ...eingabe, nachbarFelder: [fremd] });
	let geaendert = 0;
	for (let j = 0; j < ergebnis.r.hh; j++) {
		for (let i = 0; i < ergebnis.r.w; i++) {
			const k = j * ergebnis.r.w + i;
			const x = ergebnis.r.bounds.min_x + i * ergebnis.r.cell;
			const y = ergebnis.r.bounds.min_y + j * ergebnis.r.cell;
			if (context.pointInGeometry([x, y], geometry) && context.pointInGeometry([x, y], nachbar)) {
				if (context.avesmapsGebirgsVerbundProbe(verbunden, x, y).h > ergebnis.h[k]) { geaendert++; }
			} else {
				assert.equal(verbunden.h[k], ergebnis.h[k], "Außerhalb des Polygonschnitts bleibt jede Zelle unabhängig.");
			}
		}
	}
	assert.ok(geaendert > 0, "Nur im echten Schnitt wachsen die Felder zusammen.");
	assert.deepEqual(Array.from(verbunden.h), Array.from(ergebnis.h), "Eigenwerte bleiben getrennt gespeichert.");
	for (const x of [13.99, 14.01, 14.3]) {
		const y = 10.41;
		const eigenProbe = context.avesmapsGebirgsRasterProbe(ergebnis, x, y);
		const fremdProbe = context.avesmapsGebirgsRasterProbe(verbunden.nachbarRaster[0], x, y);
		const erwartet = Math.max(eigenProbe.h, fremdProbe?.h || 0);
		assert.equal(context.avesmapsGebirgsVerbundProbe(verbunden, x, y).h, erwartet,
			"Interpolation überschreitet keine zwischen Rasterknoten liegende Polygongrenze.");
	}
	assert.equal(context.avesmapsGebirgsVerbundProbe(verbunden, 2.01, 2.01), null, "Auch Polygonlöcher bleiben ausgespart.");
	let summe = 0;
	for (let k = 0; k < ergebnis.h.length; k++) { if (ergebnis.r.eigen[k]) { summe += ergebnis.h[k]; } }
	assert.ok(Math.abs(ergebnis.mittelhoehe - summe / ergebnis.r.drinN) < 1e-6);
	const controller = new AbortController();
	const lauf = context.avesmapsGebirgsRasterImWorker(eingabe, controller.signal);
	controller.abort();
	await assert.rejects(lauf, /abgebrochen/);
	await assert.rejects(context.avesmapsGebirgsRasterImWorker(eingabe, controller.signal), /abgebrochen/);
	await assert.rejects(context.avesmapsGebirgsRasterImWorker({
		...eingabe, bounds: { min_x: 0, min_y: 0, max_x: 1024, max_y: 1024 },
	}), /Rastergröße/);
	assert.throws(() => context.baueRaster({ min_x: 0, min_y: 0, max_x: Infinity, max_y: 2 }, 0.25, () => true), /Rastergröße/);
	console.log("OK: Worker-Parität, Hauptthread, Abbruch und Größenprüfung.");
}
pruefen().catch((error) => { console.error(error); process.exitCode = 1; });
