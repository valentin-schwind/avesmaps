"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../map-features-ecosystem-properties.js"), "utf8").replace(/\r\n/g, "\n");
function funktion(name) {
	const start = source.search(new RegExp("\\t(?:async )?function " + name + "\\("));
	assert.ok(start >= 0);
	return source.slice(start, source.indexOf("\n\t}", start) + 3);
}
function umgebung(post, upload) {
	const toast = [];
	let invalidierungen = 0;
	const button = { textContent: "Höhenfeld erzeugen", disabled: false };
	const context = vm.createContext({
		currentPropertiesArea: () => ({ public_id: "probe", region_name: "Probe" }),
		propertiesElement: () => button,
		postEcosystemEdit: post,
		renderTerrainControls() {}, setTerrainStatus() {},
		showFeedbackToast: (text, status) => toast.push({ text, status }),
		avesmapsLandschaftDialogSichtbar() {},
		window: { AvesmapsEcosystemHeightRender: {
			hochladen: upload, abbrechen() {}, setSolid() {},
			invalidate() { invalidierungen++; }, redraw() {},
		} },
	});
	vm.runInContext(`let terrainSaving = false, terrainSaveGeneration = 0, terrainTouched = {};
		const TERRAIN_FIELDS = []; let propertiesSourcePublicId, pendingWikiRegion, wikiSchnappschuss,
		regionKeinArtikel, regionFieldOrigins, wikiUebernommen, wikiAssign;
		${funktion("saveTerrainSettings")}
		${funktion("buildTerrainRaster")}
		${funktion("closeEcosystemPropertiesDialog")}`, context);
	return { context, toast, button, invalidierungen: () => invalidierungen };
}
async function pruefen() {
	const ok = umgebung(async () => ({}), async () => ({ hochgeladen: true, bytes: 100 }));
	await ok.context.buildTerrainRaster();
	assert.equal(ok.toast[0].status, "ok");
	assert.match(ok.toast[0].text, /gespeichert/);
	assert.equal(ok.invalidierungen(), 1, "Nur eine Vorschauinvalidierung.");
	assert.equal(ok.button.disabled, false);
	for (const upload of [async () => { throw new Error("Upload kaputt"); }, async () => ({ hochgeladen: false })]) {
		const fail = umgebung(async () => ({}), upload);
		await fail.context.buildTerrainRaster();
		assert.equal(fail.toast[0].status, "error", "Kein Erfolg bei fehlendem Upload.");
	}
	let resolveSave;
	let uploads = 0;
	let writes = 0;
	const delayed = umgebung(() => { writes++; return new Promise((resolve) => { resolveSave = resolve; }); },
		async () => { uploads++; return { hochgeladen: true }; });
	const lauf = delayed.context.saveTerrainSettings(false);
	assert.equal((await delayed.context.saveTerrainSettings(true)).hochgeladen, false);
	assert.equal(writes, 1, "Reset startet keine konkurrierende Speicherung.");
	delayed.context.closeEcosystemPropertiesDialog();
	resolveSave({});
	assert.equal((await lauf).hochgeladen, false);
	assert.equal(uploads, 0, "Schließen vor Serverantwort verhindert den Workerstart.");
	console.log("OK: Erzeugen, Uploadfehler, Invalidierung, Reset und Schließen.");
}
pruefen().catch((error) => { console.error(error); process.exitCode = 1; });
