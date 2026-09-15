"use strict";
// Kartendialog „Weg bearbeiten": der Kasten „Wiki-Weg" mit Anhang, am Abschnitt wie bisher; fuer die ganze Strasse seit Lieferung 2
// (Owner 15.09.2026, „Gleiche zusammenfassen" + „Je Zeile bearbeitbar") eine Zeile je Hauptzuweisung, die GENAU ihre Abschnitte
// schreibt (js/ui/wiki-weg-zeilen.js); wiki_uebernommen im Sammel-Speichern (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md
// §9.5, §9.6). AUSGEFUEHRT gegen Attrappen bzw. -- fuer die Zeilen -- gegen die echten Dateien.
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
const QUELLE = lies("js/review/review-path-wiki.js");

const pfad = (id) => ({ properties: { public_id: id, wiki_path: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" } } });
const rs7 = pfad("rs-7");

function kontextBauen() {
	const log = { post: [], fragen: [], mounts: [], angewendet: [] };
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
		avesmapsWikiAssignMount: (host, opts) => { log.mounts.push({ host, opts }); return { zerstoeren() {} }; },
		avesmapsWikiAssignWegTreffer: W.avesmapsWikiAssignWegTreffer,
		avesmapsWikiAssignWegZuweisungsKoerper: W.avesmapsWikiAssignWegZuweisungsKoerper,
		avesmapsWikiAssignWegAntwortPruefen: W.avesmapsWikiAssignWegAntwortPruefen,
		pathWikiWeitereAnhang: () => anhang,
	});
	kontext.window.confirm = (text) => { log.fragen.push(String(text)); return log.antwort !== false; };
	kontext.confirm = kontext.window.confirm;
	vm.runInContext(["renderPathWikiReference", "pathWikiZuweisen", "pathWikiLoesen"].map((name) => funktion(QUELLE, name)).join("\n"), kontext);
	return { kontext, log, anhang, rufe: (name) => vm.runInContext(name, kontext) };
}

// ---- Fuer die Zeilen der ganzen Strasse: die echten Dateien, der Kasten als DOM-Attrappe --------------------------------------
function attrappe(name) {
	return {
		id: name, innerHTML: "", textContent: "", value: "", dataset: {}, zuhoerer: {},
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; }, removeEventListener() {},
		appendChild() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return attrappe("q"); }, querySelectorAll() { return []; },
		focus() {}, contains() { return true; },
	};
}
function zeilenHost() {
	const b = attrappe("path-wiki-assign-host");
	b.details = [];
	b.anhangPlatz = null;
	b._html = "";
	b.querySelectorAll = (sel) => (sel === "[data-wiki-weg-zeile]" ? b.details : []);
	b.querySelector = (sel) => (sel === "[data-wiki-weg-zeilen-anhang]" ? b.anhangPlatz : null);
	b.removeEventListener = function (typ, fn) { if (this.zuhoerer[typ] === fn) { delete this.zuhoerer[typ]; } };
	Object.defineProperty(b, "innerHTML", {
		get() { return this._html; },
		set(wert) {
			this._html = String(wert);
			this.details = [...this._html.matchAll(/<details class="wiki-weg-zeile" data-wiki-weg-zeile="(\d+)"( open)?>/g)].map((m) => {
				const platz = attrappe("platz-" + m[1]);
				return {
					open: Boolean(m[2]), platz, zuhoerer: {},
					getAttribute: (n) => (n === "data-wiki-weg-zeile" ? m[1] : null),
					addEventListener(typ, fn) { this.zuhoerer[typ] = fn; }, removeEventListener() {},
					querySelector: (sel) => (sel === "[data-wiki-weg-zeile-host]" ? platz : null),
				};
			});
			this.anhangPlatz = this._html.includes("data-wiki-weg-zeilen-anhang") ? { kinder: [], appendChild(kind) { this.kinder.push(kind); } } : null;
		},
	});
	return b;
}
const aufklappen = (details) => { details.open = true; details.zuhoerer.toggle({ target: details }); };

const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/RS2" };
const BAER = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const kartenPfad = (id, wiki, weitere) => ({ properties: { public_id: id, display_name: "Reichsstraße 2", wiki_path: wiki,
	wiki_path_weitere: weitere || [] } });

function zeilenKontext(pfade) {
	const log = { post: [], fragen: [], nachGruppe: 0, poll: 0, toasts: [], uebernommen: [], antwort: true };
	const host = zeilenHost();
	const anhang = { name: "anhang" };
	const finde = (id) => pfade.find((p) => p.properties.public_id === id) || null;
	const k = { console, Promise, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error, Map, Set, isFinite, isNaN,
		parseInt, setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, gemounted: [] };
	k.window = k;
	k.globalThis = k;
	vm.createContext(k);
	["js/pages/wege-editor-model.js", "js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js", "js/ui/wiki-weitere-kasten.js", "js/ui/wiki-weg-zeilen.js"].forEach((datei) => {
		vm.runInContext(lies(datei), k, { filename: datei });
	});
	vm.runInContext("var echterMount = avesmapsWikiAssignMount;"
		+ "avesmapsWikiAssignMount = function (b, o) { gemounted.push({ host: b, opts: o }); return echterMount(b, o); };", k);
	Object.assign(k, {
		pathEditFeature: pfade[0], pathEditGruppe: { pfade, stand: {} }, pathWikiAssign: null,
		confirm: (text) => { log.fragen.push(String(text)); return log.antwort; },
		pathWikiElement: (id) => (id === "path-wiki-assign-host" ? host : { value: "Reichsstrasse" }),
		// Der Server, wie assign_to/clear_assign/remove_weitere ihn beantworten -- samt segments_updated.
		pathWikiPost: async (rumpf) => {
			log.post.push(rumpf);
			const ids = Array.isArray(rumpf.public_ids) ? rumpf.public_ids : [];
			if (rumpf.action === "assign_to") {
				return { ok: true, type_ok: true, applied: ids.length, wiki_name: "Via Ferra", segments_updated: ids.map((id) => ({ public_id: id, revision: 2,
					name: "Via Ferra", display_name: "Via Ferra", wiki_path: { wiki_key: rumpf.wiki_key, name: "Via Ferra", wiki_url: "https://x/V" } })) };
			}
			if (rumpf.action === "clear_assign") {
				return { ok: true, applied: ids.length, segments: ids.length, segments_updated: ids.map((id, i) => ({ public_id: id, revision: 2,
					name: "Strasse-" + (90 + i), display_name: "Strasse-" + (90 + i), wiki_path: null })) };
			}
			if (rumpf.action === "remove_weitere") {
				return { ok: true, applied: ids.length, skipped: [], segments_updated: ids.map((id) => ({ public_id: id, wiki_path_weitere: [] })) };
			}
			return { ok: true };
		},
		applyWikiPathSegmentsUpdate: (liste) => {
			(liste || []).forEach((segment) => {
				const p = finde(segment.public_id);
				if (!p) { return; }
				p.properties.display_name = segment.display_name;
				if (segment.wiki_path) { p.properties.wiki_path = segment.wiki_path; } else { delete p.properties.wiki_path; }
			});
		},
		pathWikiWeitereUebernehmen: (daten) => {
			log.uebernommen.push(daten);
			(daten.segments_updated || []).forEach((e) => { const p = finde(e.public_id); if (p) { p.properties.wiki_path_weitere = e.wiki_path_weitere; } });
		},
		getPathPublicId: (p) => p.properties.public_id,
		pathWikiSyncNachbarn: () => {}, pathWikiSyncUebernehmen: () => {},
		showFeedbackToast: (text) => { log.toasts.push(String(text)); },
		pathWikiWeitereAnhang: () => anhang,
		pathEditGruppeNachWikiSchreiben: () => { log.nachGruppe += 1; },
		pollLiveMapUpdates: () => { log.poll += 1; return Promise.resolve(); },
	});
	vm.runInContext(["renderPathWikiGruppenZeilen", "pathWikiGruppenZeilenNeuZeichnen", "pathWikiGruppenZeilen", "pathWikiZeileZustand",
		"pathWikiZeileZuweisen", "pathWikiZeileLoesen", "pathWikiZeileWeitereEntfernen", "pathWikiNachZeilenSchreiben"]
		.map((name) => funktion(QUELLE, name)).join("\n"), k);
	return { k, log, host, anhang, rufe: (name) => vm.runInContext(name, k) };
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
		await k.rufe("pathWikiLoesen")();
		assert.strictEqual(k.log.post[1].dry_run, true, "am Abschnitt misst das Entfernen weiter zuerst seine Reichweite");
		// 🔴 Die Gruppenzweige aus Lieferung 1 sind gefallen: ein Gruppendialog schreibt ueber seine Zeilen, nie ueber diese zwei.
		assert.ok(!/pathEditGruppe/.test(funktion(QUELLE, "pathWikiZuweisen")) && !/pathEditGruppe/.test(funktion(QUELLE, "pathWikiLoesen")),
			"pathWikiZuweisen/pathWikiLoesen kennen die ganze Strasse nicht mehr");
	}

	// ---- 3. Gruppendialog, GEMISCHTE Strasse: zwei Zeilen; jede schreibt GENAU ihre Abschnitte ------------------------------------
	{
		const pfade = [kartenPfad("rs-6", RS2), kartenPfad("rs-7", null), kartenPfad("rs-8", RS2), kartenPfad("rs-9", null, [BAER])];
		const z = zeilenKontext(pfade);
		z.rufe("renderPathWikiGruppenZeilen")();
		assert.strictEqual(z.host.details.length, 2, "zwei Zeilen sichtbar");
		assert.ok(z.host.details.every((d) => !d.open), "beide zugeklappt");
		assert.ok(z.host.innerHTML.startsWith('<div class="label-wiki-reference wiki-weg-zeilen">'), "die Huelle des Kartendialogs: " + z.host.innerHTML.slice(0, 80));
		assert.ok(z.host.innerHTML.includes("2 Abschnitte · Abschnitt 1, 3") && z.host.innerHTML.includes("2 Abschnitte · Abschnitt 2, 4"),
			"die Nummern kommen aus der Reihenfolge der Strasse: " + z.host.innerHTML);
		assert.deepStrictEqual(z.host.anhangPlatz.kinder, [z.anhang], "der Kasten der weiteren Zuweisungen der ganzen Strasse EINMAL darunter");
		assert.strictEqual(z.k.gemounted.length, 0, "zugeklappt: nichts montiert");

		// ✕ an der weiteren Zuweisung der Zeile „keine": GENAU rs-9.
		const knopf = { getAttribute: (n) => (n === "data-wiki-weg-weitere" ? "b-renpfad" : null), closest: () => z.host.details[1] };
		z.host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-wiki-weg-weitere]" ? knopf : null) }, preventDefault() {} });
		await new Promise((fertig) => setTimeout(fertig, 0));
		assert.deepStrictEqual(z.log.post.map((r) => [r.action, r.wiki_key, [...r.public_ids]]), [["remove_weitere", "b-renpfad", ["rs-9"]]]);
		assert.strictEqual(z.log.uebernommen.length, 1, "die neue Liste landet in den Kartendaten");
		assert.ok(!z.host.innerHTML.includes("Bärenpfad"), "die Zeilen sind neu gezeichnet");

		// Aufklappen der Zeile „keine" montiert das Bauteil.
		aufklappen(z.host.details[1]);
		assert.strictEqual(z.k.gemounted.length, 1, "Aufklappen montiert das Bauteil");
		const gk = z.k.gemounted[0];
		assert.strictEqual(gk.host, z.host.details[1].platz);
		assert.strictEqual(gk.opts.skin, "label-wiki");
		assert.strictEqual(gk.opts.laden().artikel, null, "der Stand des ersten Abschnitts der Zeile");

		// Zuweisen in „keine": GENAU rs-7, rs-9, ohne Rueckfrage.
		z.log.post.length = 0;
		await gk.opts.zuweisen({ wiki_key: "via-ferra", name: "Via Ferra" });
		assert.strictEqual(z.log.post.length, 1);
		assert.strictEqual(z.log.post[0].action, "assign_to");
		assert.deepStrictEqual([...z.log.post[0].public_ids], ["rs-7", "rs-9"], "GENAU die Abschnitte der Zeile");
		assert.strictEqual(z.log.post[0].public_id, "rs-7", "Anker ist ihr erster");
		assert.strictEqual(z.log.fragen.length, 0, "keine Rueckfrage „gemischte Strasse“ mehr");
		assert.strictEqual(z.log.nachGruppe, 2, "der Vergleichsstand wird nach jedem Schreiben neu gerechnet");
		assert.ok(z.log.poll >= 1, "Gruppen und Traeger-Index haengen an der Kartenrevision");
		assert.strictEqual(z.host.details.length, 2, "neu gebildet");
		assert.ok(z.host.innerHTML.includes("Via Ferra") && !z.host.innerHTML.includes(">keine<"), "die Abschnitte sind in die Zeile „Via Ferra“ gewandert");

		// Entfernen in der Zeile „Reichsstraße 2": fragt mit der Zahl DIESER Zeile; Nein schreibt nichts, Ja GENAU rs-6, rs-8.
		aufklappen(z.host.details[0]);
		const gr = z.k.gemounted[z.k.gemounted.length - 1];
		assert.strictEqual(gr.opts.laden().artikel.wiki_key, "reichsstrasse-2", "Reichsstraße 2 steht vor Via Ferra (gleich viele, alphabetisch)");
		z.log.post.length = 0;
		z.log.antwort = false;
		let abgelehnt = null;
		await gr.opts.loesen().catch((fehler) => { abgelehnt = fehler; });
		assert.ok(abgelehnt && abgelehnt.message === "Abgebrochen.", "abgebrochen ist abgelehnt -- das Bauteil laesst die Zuweisung stehen");
		assert.strictEqual(z.log.post.length, 0, "ein Nein schreibt nichts");
		assert.ok(z.log.fragen[0].includes("2 der 4 Abschnitte"), z.log.fragen[0]);
		z.log.antwort = true;
		await gr.opts.loesen();
		assert.deepStrictEqual(z.log.post.map((r) => [r.action, [...r.public_ids]]), [["clear_assign", ["rs-6", "rs-8"]]], "GENAU die Abschnitte der Zeile");
		assert.strictEqual(z.log.fragen.length, 2, "Entfernen fragt jedes Mal");
		assert.ok(z.host.innerHTML.includes(">keine<") && z.host.innerHTML.includes("Via Ferra"), "neu gebildet: Via Ferra und keine");
	}

	// ---- 4. Gruppendialog, EINIGE Strasse: EINE Zeile, offen, Bauteil sofort; Entfernen „von allen N“ ------------------------------
	{
		const z = zeilenKontext([kartenPfad("rs-6", RS2), kartenPfad("rs-7", RS2), kartenPfad("rs-8", RS2)]);
		z.rufe("renderPathWikiGruppenZeilen")();
		assert.strictEqual(z.host.details.length, 1, "eine Zeile");
		assert.strictEqual(z.host.details[0].open, true, "von Anfang an aufgeklappt");
		assert.strictEqual(z.k.gemounted.length, 1, "… mit dem Bauteil darin");
		const g = z.k.gemounted[0];
		assert.strictEqual(g.host, z.host.details[0].platz);
		assert.strictEqual(g.opts.laden().artikel.wiki_key, "reichsstrasse-2");
		await g.opts.loesen();
		assert.ok(z.log.fragen.length === 1 && z.log.fragen[0].includes("allen 3 Abschnitten") && z.log.fragen[0].includes("zerfällt"), JSON.stringify(z.log.fragen));
		assert.deepStrictEqual(z.log.post.map((r) => [r.action, [...r.public_ids]]), [["clear_assign", ["rs-6", "rs-7", "rs-8"]]]);
	}

	// ---- 5. Das Sammel-Speichern schickt wiki_uebernommen -----------------------------------------------------------
	{
		const gesendet = [];
		const rs6 = pfad("rs-6");
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

	// ---- 6. index.html: der zweite Kasten ist gefallen, das Zeilen-Bauteil liegt bei der Wiki-Zuweisung --------------------
	const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	assert.ok(!seite.includes('id="path-wiki-weitere-host"'), "kein zweiter Kasten mehr im Dialog");
	assert.ok(seite.includes('<div id="path-wiki-assign-host"></div>'), "der Kasten „Wiki-Weg“ bleibt");
	const zeilenTag = seite.indexOf('<script src="js/ui/wiki-weg-zeilen.js"></script>');
	assert.ok(zeilenTag > seite.indexOf('<script src="js/ui/wiki-assign-weg.js"></script>')
		&& zeilenTag < seite.indexOf('<script src="js/review/review-path-wiki.js"></script>'),
		"index.html laedt js/ui/wiki-weg-zeilen.js nach dem Datenweg des Wegs und vor dem Kartendialog");
	const populate = funktion(lies("js/review/review-paths.js"), "populatePathEditFormGruppe");
	assert.ok(populate.indexOf("renderPathWikiGruppenZeilen()") > populate.indexOf("populatePathEditForm(path)"),
		"der Gruppendialog ersetzt den Kasten des Abschnitts durch die Zeilen -- nach dem Grundstand");

	console.log("weg-dialog-wiki-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
