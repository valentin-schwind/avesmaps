// Der Kartendialog „Weg bearbeiten“ montiert das EINE Quellen-Bauteil -- ganz unten, mit dem Weg als Verteiler.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-wege-design.md (§3.3), Mockup docs/quellen-wege-mockup.html.
//
// 🪤 Arrays aus dem vm-Kontext tragen einen FREMDEN Array-Prototyp -- deepStrictEqual vergleicht ihn mit; deshalb
// werden sie vor dem Vergleich in den Testkontext kopiert (`[...x]`).
// 🔴 `mountPathEditFeatureSources(path)` wird hier AUSGEFUEHRT, gegen eine Dokument-Attrappe und einen
// gefaelschten Kartenbestand (`pathData`): Objektart `path`, Getter liest `#path-edit-public-id` bei jeder
// Anfrage, die Gruppe sind alle Abschnitte mit demselben `avesmapsWegGruppenSchluessel`, nicht fest.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-im-wegedialog.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");

// ---- 1. Das Markup: der Kasten ganz unten, „Andere Quelle“ weg ------------------------------------------
{
	const html = ohneHtmlKommentare(lies("index.html"));
	const dialog = html.indexOf('id="path-edit-dialog"');
	const ende = html.indexOf("</form>", dialog);
	const rumpf = html.slice(dialog, ende);
	const host = rumpf.indexOf('id="path-edit-feature-sources"');
	assert.ok(host > 0, "der Host path-edit-feature-sources steht im Dialog");
	const kasten = rumpf.lastIndexOf('<div class="label-edit-section"><div class="label-edit-section-title">Quellen</div>', host);
	assert.ok(kasten > 0, "der Host liegt in einem .label-edit-section „Quellen“");
	assert.ok(rumpf.slice(kasten, host).includes("Quellen wirken <b>sofort</b> — sie brauchen kein „Speichern“."), "der Hinweissatz ist zeichengleich");
	const stroemung = rumpf.indexOf('id="path-flow-factor"');
	const knoepfe = rumpf.indexOf('class="location-report-form__actions"');
	assert.ok(stroemung > 0 && stroemung < host && host < knoepfe, "der Kasten steht NACH der Stroemung und VOR der Knopfleiste -- ganz unten");
	["path-edit-other-source-section", "path-edit-other-source-url", "path-edit-other-source-label", "path-edit-other-source-preview"]
		.forEach((k) => assert.ok(!html.includes(k), "„Andere Quelle“ ist aus dem Wegedialog raus: " + k));
}

// ---- 2. Niemand liest oder schreibt „Andere Quelle“ fuer den Weg ------------------------------------------
{
	const js = ohneKommentare(lies("js/review/review-paths.js"));
	assert.ok(!js.includes('writeOtherSourceToForm("path-edit"'), "das Befuellen kennt das Feld nicht mehr");
	assert.ok(!js.includes('readOtherSourceFromForm("path-edit"'), "das Absenden liest es nicht mehr");
	assert.ok(!/other_source/.test(js), "kein other_source im Rumpf von update_path_details");
}

// ---- 3. mountPathEditFeatureSources, ausgefuehrt --------------------------------------------------------------
function dokument(werte) {
	const elemente = new Map();
	function element(id) {
		if (elemente.has(id)) return elemente.get(id);
		const el = { id, value: werte[id] || "", cloneNode() { const k = element("__klon:" + id); k.id = id; return k; }, replaceWith(neu) { elemente.set(id, neu); } };
		elemente.set(id, el);
		return el;
	}
	return { getElementById: (id) => element(id), element };
}
function fahre(quelle, pfad, bestand, werte) {
	const aufrufe = [];
	const document = dokument(werte);
	const context = { console, document, window: {}, pathData: bestand,
		mountFeatureSourceEditor: (ziel, art, getter, opts) => { aufrufe.push({ ziel, art, getter, opts }); },
		escapeHtml: (s) => String(s),
		avesmapsWegGruppenSchluessel: (p) => { const q = (p && p.properties) || {}; const wk = q.wiki_path && q.wiki_path.wiki_key; return wk ? "wiki:" + wk : "name:" + (q.feature_subtype || "") + ":" + (q.name || ""); },
	};
	context.window = context; context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(quelle, context);
	for (let versuch = 0; versuch < 60; versuch += 1) {
		try { vm.runInContext("mountPathEditFeatureSources(" + JSON.stringify(pfad) + ");", context); return { aufrufe, document }; }
		catch (fehler) { const t = /^(\w+) is not defined$/.exec(fehler.message); if (!t) throw fehler; context[t[1]] = function () { return ""; }; }
	}
	throw new Error("mountPathEditFeatureSources laeuft nicht durch");
}
const quelle = lies("js/review/review-paths.js");
const weg = (id, key) => ({ properties: { public_id: id, feature_type: "path", feature_subtype: "Reichsstrasse", name: "Reichsstraße 2", wiki_path: key ? { wiki_key: key } : null } });
{
	const bestand = [weg("rs2-a", "reichsstrasse-2"), weg("rs2-b", "reichsstrasse-2"), weg("rs3-a", "reichsstrasse-3"), weg("rs2-c", "reichsstrasse-2")];
	const { aufrufe, document } = fahre(quelle, weg("rs2-b", "reichsstrasse-2"), bestand, { "path-edit-public-id": "rs2-b" });
	assert.strictEqual(aufrufe.length, 1, "genau EIN Mount je Befuellen");
	assert.strictEqual(aufrufe[0].art, "path", "Objektart path -- die Zeilen, die die Karte liest");
	assert.strictEqual(aufrufe[0].getter(), "rs2-b", "der Getter liest #path-edit-public-id");
	assert.strictEqual(aufrufe[0].ziel, document.element("path-edit-feature-sources"), "montiert wird auf den Klon, der den Host ersetzt hat");
	const gruppe = aufrufe[0].opts.gruppe;
	assert.ok(gruppe && typeof gruppe.publicIds === "function", "die Gruppe reist als Funktion mit");
	assert.deepStrictEqual([...gruppe.publicIds()].sort(), ["rs2-a", "rs2-b", "rs2-c"], "die Gruppe sind alle Abschnitte desselben Wiki-Wegs -- der fremde bleibt draussen");
	assert.strictEqual(gruppe.fest, false, "am Abschnitt ist nichts fest -- die Wahl gehoert dem Editor");
	// Der Getter liest bei JEDER Anfrage.
	document.element("path-edit-public-id").value = "rs2-c";
	assert.strictEqual(aufrufe[0].getter(), "rs2-c", "nach einem Dialogwechsel gilt die neue Kennung");
	// 💣 Und die Gruppe wird beim Lesen aus dem AKTUELLEN Bestand gebildet.
	bestand.push(weg("rs2-d", "reichsstrasse-2"));
	assert.deepStrictEqual([...gruppe.publicIds()].sort(), ["rs2-a", "rs2-b", "rs2-c", "rs2-d"], "ein nachgeladener Abschnitt gehoert dazu");
}
{
	// Ohne Wiki-Zuweisung: der Namensschluessel als Rueckfall -- exakt wie im Wege-Editor.
	const bestand = [weg("w-1", null), weg("w-2", null), Object.assign(weg("w-3", null), { properties: { public_id: "w-3", feature_type: "path", feature_subtype: "Pfad", name: "Reichsstraße 2" } })];
	const { aufrufe } = fahre(quelle, weg("w-1", null), bestand, { "path-edit-public-id": "w-1" });
	assert.deepStrictEqual([...aufrufe[0].opts.gruppe.publicIds()].sort(), ["w-1", "w-2"], "gleicher Name UND gleiche Wegart bilden die Gruppe; ein Pfad gleichen Namens nicht");
}
{
	// Ein Abschnitt ohne Geschwister: die Gruppe hat einen Eintrag -- das Bauteil zeigt dann keine Wahl.
	const { aufrufe } = fahre(quelle, weg("solo", "solo-weg"), [weg("solo", "solo-weg")], { "path-edit-public-id": "solo" });
	assert.deepStrictEqual([...aufrufe[0].opts.gruppe.publicIds()], ["solo"], "ein einteiliger Weg liefert genau sich selbst");
}
{
	// 💣 Kein Stapeln: das zweite Befuellen loest die Vorschlagsliste des ersten und ersetzt den Host erneut.
	const document = dokument({ "path-edit-public-id": "rs2-a" });
	let geloest = 0;
	document.element("path-edit-feature-sources").__fsDetachAutocomplete = () => { geloest += 1; };
	const aufrufe = [];
	const context = { console, document, window: {}, pathData: [], mountFeatureSourceEditor: (ziel) => aufrufe.push(ziel), escapeHtml: String, avesmapsWegGruppenSchluessel: () => "k" };
	context.window = context; context.globalThis = context;
	vm.createContext(context); vm.runInContext(quelle, context);
	const p = JSON.stringify(weg("rs2-a", "x"));
	for (let versuch = 0; versuch < 60; versuch += 1) {
		try { vm.runInContext("mountPathEditFeatureSources(" + p + "); mountPathEditFeatureSources(" + p + ");", context); break; }
		catch (fehler) { const t = /^(\w+) is not defined$/.exec(fehler.message); if (!t) throw fehler; context[t[1]] = function () { return ""; }; }
	}
	assert.strictEqual(aufrufe.length, 2); assert.notStrictEqual(aufrufe[0], aufrufe[1], "jeder Mount bekommt einen frischen Host");
	assert.strictEqual(geloest, 1, "die Vorschlagsliste des ersten Mounts wurde geloest");
}

// ---- 4. Beide Befueller montieren -- AUSGEFUEHRT, nicht am Quelltext gelesen -------------------------
// 🪤 Ein Quelltext-Test („die Funktion enthaelt den Aufruf“) ueberlebt ein `if (false)` um den Aufruf; nur
// das Ausfuehren beweist, dass der Kasten auf BEIDEN Wegen in den Dialog kommt (neu gezeichnet UND
// frisch gezeichnet mit uebernommenen Einstellungen).
{
	const quelleLoesung = lies("js/review/review-paths.js");
	["populatePathEditForm", "populatePathEditFormFromLastSettings"].forEach((kopf) => {
		const aufrufe = [];
		const element = () => ({ value: "", checked: false, disabled: false, hidden: false, closest: () => null,
			cloneNode() { return element(); }, replaceWith() {}, querySelectorAll: () => [] });
		const context = { console, window: {}, pathData: [],
			document: { getElementById: () => element(), querySelectorAll: () => [] },
			mountFeatureSourceEditor: (ziel, art) => aufrufe.push(art),
			getPathEditFormElement: () => ({ querySelectorAll: () => [] }),
			normalizePathSubtype: (s) => String(s || "Weg"), lastPathEditSettings: { feature_subtype: "Weg" },
			acquireFeatureSoftLock: () => {}, getPathDisplayName: () => "X", getNextPathDisplayName: () => "X",
			shouldPathNameBeDisplayed: () => false, syncPathTransportOptions: () => {}, syncPathAutoNameControls: () => {},
			renderPathWikiReference: () => {}, renderPathFlowSection: () => {}, resetPathWikiUebernommen: () => {},
			pathWikiCurrentAssignment: () => null, pathIstBach: () => false, avesmapsWegGruppenSchluessel: () => "k", escapeHtml: String };
		context.window = context; context.globalThis = context;
		vm.createContext(context); vm.runInContext(quelleLoesung, context);
		const pfad = JSON.stringify(weg("p-1", "k"));
		let gelaufen = false;
		for (let versuch = 0; versuch < 80; versuch += 1) {
			try { vm.runInContext(kopf + "(" + pfad + ");", context); gelaufen = true; break; }
			catch (fehler) { const t = /^(\w+) is not defined$/.exec(fehler.message); if (!t) throw new Error(kopf + ": " + fehler.message); context[t[1]] = function () { return ""; }; }
		}
		assert.ok(gelaufen, kopf + " laeuft durch");
		assert.deepStrictEqual([...aufrufe], ["path"], kopf + " montiert das Quellen-Bauteil genau einmal -- sonst fehlt der Kasten auf einem der zwei Wege in den Dialog");
	});
}

console.log("quellen-im-wegedialog: alle Zusicherungen erfuellt");
