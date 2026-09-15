"use strict";
// Kartendialog „Weg bearbeiten": EIN Kasten „Wiki-Weg" mit Anhang, Zuweisen/Entfernen fuer die ganze Strasse, wiki_uebernommen
// im Sammel-Speichern (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.5, §9.6). AUSGEFUEHRT gegen Attrappen.
// Aus der Wurzel: node js/review/__tests__/weg-dialog-wiki-kasten.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const funktion = (text, name) => {
	let a = text.indexOf("\nasync function " + name + "(");
	if (a < 0) { a = text.indexOf("\nfunction " + name + "("); }
	assert.ok(a >= 0, "Funktion fehlt: " + name);
	const e = text.indexOf("\n}\n", a);
	return text.slice(a, e + 3);
};
const W = require(path.join(WURZEL, "js/ui/wiki-assign-weg.js"));
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));

const pfad = (id) => ({ properties: { public_id: id, wiki_path: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" } } });
const rs6 = pfad("rs-6");
const rs7 = pfad("rs-7");
const rs8 = pfad("rs-8");

function kontextBauen() {
	const log = { post: [], fragen: [], nachGruppe: 0, poll: 0, mounts: [], angewendet: [] };
	const anhang = { name: "anhang" };
	const kontext = vm.createContext({
		console, window: {}, Promise, JSON, Array, String, Number,
		pathEditFeature: rs7, pathEditGruppe: null, pathWikiAssign: null,
		pathWikiPost: async (rumpf) => {
			log.post.push(rumpf);
			if (rumpf.action === "clear_assign" && rumpf.dry_run === true) { return { ok: true, segments: 1, name: "Reichsstraße 2" }; }
			return { ok: true, type_ok: true, applied: 3, segments: 3, wiki_name: "Reichsstraße 2", segments_updated: [] };
		},
		pathWikiElement: () => ({ id: "path-wiki-assign-host" }),
		pathWikiCurrentFeaturePublicId: () => "rs-7",
		pathWikiCurrentAssignment: () => ({ wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" }),
		pathWikiSyncNachbarn: () => {}, pathWikiZustand: () => ({}), pathWikiSyncUebernehmen: () => {}, pathWikiZeichneAbweichungen: () => {},
		renderPathFlowSection: () => {}, showFeedbackToast: () => {}, apiErrorMessage: (d, f) => f,
		applyWikiPathSegmentsUpdate: (liste) => { log.angewendet.push(liste); },
		getPathPublicId: (p) => p.properties.public_id,
		avesmapsWikiAssignMount: (host, opts) => { log.mounts.push({ host, opts }); return { zerstoeren() {} }; },
		avesmapsWikiAssignWegTreffer: W.avesmapsWikiAssignWegTreffer,
		avesmapsWikiAssignWegZuweisungsKoerper: W.avesmapsWikiAssignWegZuweisungsKoerper,
		avesmapsWikiAssignWegAntwortPruefen: W.avesmapsWikiAssignWegAntwortPruefen,
		avesmapsWikiAssignWegGruppenIds: W.avesmapsWikiAssignWegGruppenIds,
		avesmapsWikiAssignWegLoesenKoerper: W.avesmapsWikiAssignWegLoesenKoerper,
		avesmapsWikiAssignWegGruppeLoesenFrage: W.avesmapsWikiAssignWegGruppeLoesenFrage,
		avesmapsWikiAssignWegGruppeZuweisenFrage: W.avesmapsWikiAssignWegGruppeZuweisenFrage,
		wpGruppeHauptzuweisungen: M.wpGruppeHauptzuweisungen,
		pathWikiWeitereAnhang: () => anhang,
		pathEditGruppeNachWikiSchreiben: () => { log.nachGruppe += 1; },
		pollLiveMapUpdates: () => { log.poll += 1; return Promise.resolve(); },
	});
	kontext.window.confirm = (text) => { log.fragen.push(String(text)); return log.antwort !== false; };
	kontext.confirm = kontext.window.confirm;
	const quelle = lies("js/review/review-path-wiki.js");
	vm.runInContext(["renderPathWikiReference", "pathWikiGruppenIds", "pathWikiNachGruppenSchreiben", "pathWikiZuweisen", "pathWikiLoesen"]
		.map((name) => funktion(quelle, name)).join("\n"), kontext);
	return { kontext, log, anhang, rufe: (name) => vm.runInContext(name, kontext) };
}

(async () => {
	// ---- 1. Der Kasten „Wiki-Weg“ bekommt den Anhang --------------------------------------------------------------
	{
		const k = kontextBauen();
		k.rufe("renderPathWikiReference")();
		assert.strictEqual(k.log.mounts.length, 1);
		assert.strictEqual(k.log.mounts[0].opts.anhang, k.anhang, "die weiteren Zuweisungen haengen im Kasten „Wiki-Weg“");
	}

	// ---- 2. Abschnitt: wie bisher, ohne public_ids ------------------------------------------------------------------
	{
		const k = kontextBauen();
		await k.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2" });
		assert.ok(!("public_ids" in k.log.post[0]), "am Abschnitt keine public_ids");
		assert.strictEqual(k.log.nachGruppe, 0);
		await k.rufe("pathWikiLoesen")();
		assert.strictEqual(k.log.post[1].dry_run, true, "am Abschnitt misst das Entfernen weiter zuerst seine Reichweite");
	}

	// ---- 3. Gruppendialog: Zuweisen auf genau die Abschnitte, danach Stand neu und Live-Abgleich ----------------------
	{
		const k = kontextBauen();
		k.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		await k.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2" });
		assert.deepStrictEqual([...k.log.post[0].public_ids], ["rs-7", "rs-6", "rs-8"], "der geklickte Abschnitt vorn");
		assert.strictEqual(k.log.nachGruppe, 1, "der Vergleichsstand wird neu gerechnet");
		assert.strictEqual(k.log.poll, 1, "Gruppen und Traeger-Index haengen an der Kartenrevision");
		assert.strictEqual(k.log.fragen.length, 0, "eine einige Strasse fragt vor dem Zuweisen nicht");
	}

	// ---- 3b. Owner 15.09.2026: die Strasse ist der NAME und kann GEMISCHT sein -- dann fragt Zuweisen, ein Nein schreibt nichts --
	{
		const ohne = { properties: { public_id: "rs-9", wiki_path: null } };
		const k = kontextBauen();
		k.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8, ohne], stand: {} };
		k.log.antwort = false;
		let abgelehnt = null;
		await k.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" }).catch((fehler) => { abgelehnt = fehler; });
		assert.strictEqual(k.log.fragen.length, 1, "eine gemischte Strasse fragt vor dem Zuweisen");
		assert.ok(k.log.fragen[0].includes("verschiedene Wiki-Zuordnungen") && k.log.fragen[0].includes("allen 4 Abschnitten"), k.log.fragen[0]);
		assert.ok(abgelehnt && abgelehnt.message === "Abgebrochen.", "abgebrochen ist abgelehnt");
		assert.strictEqual(k.log.post.length, 0, "ein Nein schreibt nichts");

		const k2 = kontextBauen();
		k2.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8, ohne], stand: {} };
		await k2.rufe("pathWikiZuweisen")({ wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" });
		assert.strictEqual(k2.log.fragen.length, 1);
		assert.deepStrictEqual([...k2.log.post[0].public_ids], ["rs-7", "rs-6", "rs-8", "rs-9"], "ein Ja schreibt auf alle Abschnitte");
	}

	// ---- 4. Gruppendialog: Entfernen mit EINER Frage, ohne Trockenlauf, abbrechbar ------------------------------------
	{
		const k = kontextBauen();
		k.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		await k.rufe("pathWikiLoesen")();
		assert.strictEqual(k.log.fragen.length, 1);
		assert.ok(k.log.fragen[0].includes("allen 3 Abschnitten"), k.log.fragen[0]);
		assert.strictEqual(k.log.post.length, 1, "kein Trockenlauf mit „nur dieses Segment?“");
		assert.strictEqual(k.log.post[0].action, "clear_assign");
		assert.deepStrictEqual([...k.log.post[0].public_ids], ["rs-7", "rs-6", "rs-8"]);
		assert.strictEqual(k.log.nachGruppe, 1);

		const k2 = kontextBauen();
		k2.kontext.pathEditGruppe = { pfade: [rs6, rs7, rs8], stand: {} };
		k2.log.antwort = false;
		let abgelehnt = null;
		await k2.rufe("pathWikiLoesen")().catch((fehler) => { abgelehnt = fehler; });
		assert.ok(abgelehnt && abgelehnt.message === "Abgebrochen.", "abgebrochen ist abgelehnt -- das Bauteil laesst die Zuweisung stehen");
		assert.strictEqual(k2.log.post.length, 0);
	}

	// ---- 5. Das Sammel-Speichern schickt wiki_uebernommen -----------------------------------------------------------
	{
		const gesendet = [];
		const stand = M.wpGroupFieldStates([
			{ public_id: "rs-6", name: "Reichsstraße 2", show_label: true, feature_subtype: "Strasse", allowed_transports: ["caravan"] },
			{ public_id: "rs-7", name: "Reichsstraße 2", show_label: true, feature_subtype: "Strasse", allowed_transports: ["caravan"] },
		], ["caravan"]);
		const s = vm.createContext({
			console, Promise, Number,
			pathEditGruppe: { pfade: [rs6, rs7], stand },
			wpGroupRumpf: M.wpGroupRumpf,
			readPathGruppeEntwurf: () => ({ name: "Reichsstraße 2", show_label: null, feature_subtype: "Reichsstrasse", transports: { caravan: "an" } }),
			getPathPublicId: (p) => p.properties.public_id,
			getPathWikiUebernommenPayload: () => ["feature_subtype"],
			setPathEditStatus: () => {}, setPathEditSubmitPending: () => {}, loadChangeLog: () => {}, setPathEditDialogOpen: () => {},
			showFeedbackToast: () => {},
			submitMapFeatureEdit: async (rumpf) => { gesendet.push(rumpf); return { ok: true, written: 2 }; },
			pollLiveMapUpdates: async () => {},
		});
		vm.runInContext(funktion(lies("js/review/review-editor-submit.js"), "handlePathGroupEditSubmit"), s);
		await vm.runInContext("handlePathGroupEditSubmit", s)();
		assert.strictEqual(gesendet.length, 1);
		assert.deepStrictEqual([...gesendet[0].fields], ["feature_subtype"]);
		assert.deepStrictEqual([...gesendet[0].wiki_uebernommen], ["feature_subtype"], "ohne das stempelte der Server die Uebernahme als „von uns“");
	}

	// ---- 6. index.html: der zweite Kasten ist gefallen ---------------------------------------------------------------
	const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	assert.ok(!seite.includes('id="path-wiki-weitere-host"'), "kein zweiter Kasten mehr im Dialog");
	assert.ok(seite.includes('<div id="path-wiki-assign-host"></div>'), "der Kasten „Wiki-Weg“ bleibt");

	console.log("weg-dialog-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
