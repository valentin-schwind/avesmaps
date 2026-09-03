// Der VERTEILER im Quellen-Bauteil: ein Weg liegt in Abschnitten, die Quelle haengt am Abschnitt.
//
// Entwurf: docs/superpowers/specs/2026-09-03-quellen-wege-design.md (§2, §3.2), Mockup docs/quellen-wege-mockup.html.
//
// 🔴 `opts.gruppe = { publicIds: () => string[], fest: boolean }` -- die Liste wird bei JEDER Anfrage gelesen.
//   · N > 1, nicht fest (Abschnittsebene): der dritte Rahmen heisst „An diesem Weg“ und traegt die Wahl
//     „alle N Abschnitte dieses Weges“ (Vorgabe) / „nur dieser Abschnitt“. NUR `add`/`add_existing` tragen
//     dann `entity_public_ids`, und nur bei „alle“. `list`, `remove`, `update` bleiben Sache des Abschnitts.
//   · fest (Weg-Ebene): kein Radio, Titel „An allen N Abschnitten dieses Weges“, JEDE Anfrage traegt die Liste.
//   · N = 1 oder keine Gruppe: nichts aendert sich („Nur an diesem Objekt“, keine Liste).
// 💣 ✕ und ✎ am Abschnitt gelten dem Abschnitt -- die Wahl steht in einer zugeklappten Falte, und ein
//   Loeschen, das an einer unsichtbaren Auswahl haengt, ist eine Falle.
// 🔴 Die Marke „12 von 56 Abschnitten“ NUR bei einer Teilmenge (`segments < segments_of`); an allen
//   Abschnitten steht nichts -- das ist der Normalfall (2.347 von 2.511, live gemessen).
// 🔴 `by_entity` in der Antwort zieht den Kartenspeicher JE KENNUNG nach, nie die Vereinigung an alle.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-verteiler.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(WURZEL, "js/review/review-feature-sources.js"), "utf8");
const markupQuelle = fs.readFileSync(path.join(WURZEL, "js/ui/feature-source-markup.js"), "utf8");

function macheKontext(antworten) {
	const gerufen = { koerper: [] };
	const context = {
		console,
		window: { __sourceCatalog: {}, __featureSourceRefs: {} },
		document: { querySelector: () => null },
		attachSourceAutocomplete: () => () => {},
		fetch: async (url, init) => {
			gerufen.koerper.push(JSON.parse(init.body));
			const antwort = antworten.length ? antworten.shift() : { ok: true, wiki_url: "", sources: [] };
			return { json: async () => JSON.parse(JSON.stringify(antwort)) };
		},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(markupQuelle, context);
	vm.runInContext(quelle, context);
	context.__gerufen = gerufen;
	return context;
}

// Ein Behaelter, der die Felder der Eingabezeile und die Wahlzeile als Attrappen liefert.
function macheBehaelter(wahl) {
	const felder = {};
	[".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind", ".fs-add-pages", ".fs-add-license", ".fs-add-attribution", "[data-fs-corpus]"]
		.forEach((sel) => { felder[sel] = { value: "", addEventListener() {}, classList: { add() {}, remove() {} }, disabled: false, hidden: false, textContent: "" }; });
	felder[".fs-add-official"] = { checked: false, addEventListener() {}, disabled: false };
	felder["[data-fs-note]"] = { textContent: "", hidden: true, classList: { add() {}, remove() {} } };
	felder["[data-fs-picked]"] = { hidden: true };
	felder[".fs-add-url"].value = "https://www.westlande.de/index.php?title=Reichsstra%C3%9Fe_2";
	felder[".fs-add-label"].value = "Reichsstraße 2";
	const b = {
		innerHTML: "",
		felder,
		_klick: null,
		wahl,
		addEventListener(typ, fn) { if (typ === "click") { this._klick = fn; } },
		querySelector(sel) {
			if (sel === "[data-fs-scope-choice] input:checked") { return b.wahl ? { value: b.wahl } : null; }
			return felder[sel] || null;
		},
		querySelectorAll() { return []; },
	};
	return b;
}
const KLICK_HINZU = { target: { closest: (sel) => (sel === "[data-fs-add-submit]" ? {} : null) } };
const KLICK_WEG = (id) => ({ target: { closest: (sel) => (sel === "[data-remove-source-id]" ? { getAttribute: () => String(id) } : null) } });
const IDS = ["seg-1", "seg-2", "seg-3"];
const ZEILE = { source_id: 7, url: "https://x/7", label: "Aventurischer Atlas", type: "regionalspielhilfe", official: true, origin: "wiki_publication" };

let zaehlung = 0; const zaehl = () => { zaehlung += 1; };

// ---- 1. Reines Rendern: die drei Formen des dritten Rahmens ----------------------------------------
{
	const ctx = macheKontext([]);
	const render = (opts) => ctx.renderFeatureSourceEditorHtml({ wiki_url: "", sources: [] }, opts);
	const ohne = render({});
	assert.ok(ohne.includes('<span class="fs-scope__title">Nur an diesem Objekt</span>'), "ohne Gruppe: „Nur an diesem Objekt“");
	assert.ok(!ohne.includes("fs-scope__choice"), "ohne Gruppe keine Wahlzeile"); zaehl();
	const einer = render({ wegGruppe: { anzahl: 1, fest: false } });
	assert.ok(einer.includes("Nur an diesem Objekt") && !einer.includes("fs-scope__choice"), "N = 1: nichts aendert sich"); zaehl();
	const wahl = render({ wegGruppe: { anzahl: 56, fest: false } });
	assert.ok(wahl.includes('<span class="fs-scope__title">An diesem Weg</span>'), "N > 1: Titel „An diesem Weg“");
	assert.ok(/<div class="fs-scope__choice" data-fs-scope-choice>/.test(wahl), "… mit der Wahlzeile");
	assert.ok(/<input type="radio" name="[^"]+" value="alle" checked> alle 56 Abschnitte dieses Weges/.test(wahl), "„alle 56 Abschnitte dieses Weges“ ist vorgewaehlt");
	assert.ok(/<input type="radio" name="[^"]+" value="einer"> nur dieser Abschnitt/.test(wahl), "„nur dieser Abschnitt“ steht daneben");
	const name = /name="([^"]+)" value="alle"/.exec(wahl)[1];
	assert.ok(new RegExp('name="' + name + '" value="einer"').test(wahl), "beide Knoepfe teilen einen Namen -- sonst sind es zwei unabhaengige Haken");
	zaehl();
	// Die Wahlzeile steht IM dritten Rahmen, vor Seite(n)/Abdeckung.
	const rahmen = wahl.indexOf("An diesem Weg");
	assert.ok(wahl.indexOf("fs-scope__choice", rahmen) < wahl.indexOf("fs-add-pages", rahmen), "die Wahl steht vor Seite(n) und Abdeckung"); zaehl();
	const fest = render({ wegGruppe: { anzahl: 56, fest: true } });
	assert.ok(fest.includes('<span class="fs-scope__title">An allen 56 Abschnitten dieses Weges</span>'), "fest: „An allen 56 Abschnitten dieses Weges“");
	assert.ok(!fest.includes("fs-scope__choice"), "fest: keine Wahl -- auf der Weg-Ebene gilt alles allen"); zaehl();
	// Das ✎-Formular sagt auf der Weg-Ebene, dass es an alle schreibt -- sonst verspricht es „Nur an diesem
	// Objekt“ und ueberschreibt wortlos 56 Seitenangaben.
	const bearbeitenFest = ctx.renderFeatureSourceEditPanel(ZEILE, (s) => String(s), (k, f) => f, { anzahl: 56, fest: true });
	assert.ok(bearbeitenFest.includes("An allen 56 Abschnitten dieses Weges") && !bearbeitenFest.includes("Nur an diesem Objekt"), "✎ auf der Weg-Ebene: „An allen 56 Abschnitten dieses Weges“");
	const bearbeitenAbschnitt = ctx.renderFeatureSourceEditPanel(ZEILE, (s) => String(s), (k, f) => f, { anzahl: 56, fest: false });
	assert.ok(bearbeitenAbschnitt.includes("Nur an diesem Objekt"), "✎ am Abschnitt: dort gilt das Bearbeiten nur dem Abschnitt");
	assert.ok(ctx.renderFeatureSourceEditPanel(ZEILE, (s) => String(s), (k, f) => f).includes("Nur an diesem Objekt"), "✎ ohne Gruppe: wie bisher"); zaehl();
	// Zwei Mounts auf einer Seite duerfen sich die Radioknoepfe nicht teilen.
	const wahl2 = render({ wegGruppe: { anzahl: 3, fest: false } });
	assert.notStrictEqual(/name="([^"]+)" value="alle"/.exec(wahl2)[1], name, "jeder Aufbau bekommt einen eigenen Radionamen"); zaehl();
}

// ---- 2. Die Marke nur bei einer Teilmenge ---------------------------------------------------------------
{
	const ctx = macheKontext([]);
	const html = ctx.renderFeatureSourceEditorHtml({ wiki_url: "", sources: [
		Object.assign({}, ZEILE, { segments: 56, segments_of: 56 }),
		Object.assign({}, ZEILE, { source_id: 8, label: "Geographia Aventurica", segments: 12, segments_of: 56 }),
		Object.assign({}, ZEILE, { source_id: 9, label: "Ohne Zaehler" }),
	] }, {});
	const zeile = (id) => html.slice(html.indexOf('data-source-id="' + id + '"'), html.indexOf("</div>", html.indexOf('data-source-id="' + id + '"')));
	assert.ok(!zeile(7).includes("fs-row__segments"), "an allen 56 Abschnitten: keine Marke");
	assert.ok(zeile(8).includes('<span class="fs-row__segments"'), "12 von 56: die Marke steht");
	assert.ok(zeile(8).includes("12 von 56 Abschnitten"), "… und sagt die Zahl");
	assert.ok(/title="[^"]*12 von 56 Abschnitten[^"]*"/.test(zeile(8)), "… mit Satz im title");
	assert.ok(zeile(8).indexOf("fs-row__segments") < zeile(8).indexOf("</a>"), "die Marke steht IM Titel-Feld, hinter dem Link -- keine achte Rasterspalte");
	assert.ok(!zeile(9).includes("fs-row__segments"), "ohne Zaehler (Abschnittsliste): keine Marke");
	assert.ok(zeile(8).includes('<a class="fs-row__link fs-row__link--marke"'), "mit Marke darf der Link umbrechen (Modifikator) -- sonst steht die Marke hinter den drei Punkten des ellipsierten Titels");
	assert.ok(zeile(7).includes('<a class="fs-row__link" href=') && !zeile(7).includes("fs-row__link--marke"), "ohne Marke bleibt das Markup zeichengleich zu vorher");
	zaehl();
}

// ---- 3. Ausgefuehrt, Abschnittsebene: nur das Eintragen verteilt, und nur bei „alle“ ------------------
(async () => {
	{
		const ctx = macheKontext([]);
		const b = macheBehaelter("alle");
		await ctx.mountFeatureSourceEditor(b, "path", () => "seg-1", { gruppe: { publicIds: () => IDS.slice(), fest: false } });
		const liste = ctx.__gerufen.koerper[0];
		assert.strictEqual(liste.action, "list");
		assert.strictEqual(liste.entity_public_id, "seg-1");
		assert.ok(!("entity_public_ids" in liste), "die Liste am Abschnitt ist die des Abschnitts -- keine Kennungen");
		assert.ok(b.innerHTML.includes("alle 3 Abschnitte dieses Weges"), "die Wahl nennt die Zahl der Gruppe"); zaehl();
		await b._klick(KLICK_HINZU);
		const hinzu = ctx.__gerufen.koerper[1];
		assert.strictEqual(hinzu.action, "add");
		assert.deepStrictEqual(hinzu.entity_public_ids, IDS, "„alle“: das Eintragen traegt alle drei Kennungen");
		assert.strictEqual(hinzu.entity_public_id, "seg-1", "… und behaelt den Anker"); zaehl();
		b.wahl = "einer";
		await b._klick(KLICK_HINZU);
		const einer = ctx.__gerufen.koerper[2];
		assert.ok(!("entity_public_ids" in einer), "„nur dieser Abschnitt“: keine Kennungen"); zaehl();
		b.wahl = "alle";
		await b._klick(KLICK_WEG(7));
		const weg = ctx.__gerufen.koerper[3];
		assert.strictEqual(weg.action, "remove");
		assert.ok(!("entity_public_ids" in weg), "✕ am Abschnitt gilt dem Abschnitt -- auch bei gewaehltem „alle“"); zaehl();
	}
	// ---- 4. Ausgefuehrt, Weg-Ebene (fest): jede Anfrage traegt die Liste ---------------------------------
	{
		const ctx = macheKontext([]);
		const b = macheBehaelter(null);
		await ctx.mountFeatureSourceEditor(b, "path", () => "seg-1", { gruppe: { publicIds: () => IDS.slice(), fest: true } });
		const liste = ctx.__gerufen.koerper[0];
		assert.deepStrictEqual(liste.entity_public_ids, IDS, "fest: schon die Liste traegt alle Kennungen");
		assert.ok(b.innerHTML.includes("An allen 3 Abschnitten dieses Weges"), "fest: der Titel sagt es");
		assert.ok(!b.innerHTML.includes("fs-scope__choice"), "fest: keine Wahl"); zaehl();
		await b._klick(KLICK_HINZU);
		assert.deepStrictEqual(ctx.__gerufen.koerper[1].entity_public_ids, IDS, "fest: das Eintragen verteilt");
		await b._klick(KLICK_WEG(7));
		assert.deepStrictEqual(ctx.__gerufen.koerper[2].entity_public_ids, IDS, "fest: ✕ nimmt die Quelle von allen Abschnitten"); zaehl();
	}
	// ---- 5. Die Gruppe wird bei JEDER Anfrage gelesen ------------------------------------------------------
	{
		const ctx = macheKontext([]);
		const b = macheBehaelter(null);
		let kennungen = ["a-1", "a-2"];
		await ctx.mountFeatureSourceEditor(b, "path", () => "a-1", { gruppe: { publicIds: () => kennungen.slice(), fest: true } });
		kennungen = ["b-1", "b-2", "b-3"];
		await b._klick(KLICK_HINZU);
		assert.deepStrictEqual(ctx.__gerufen.koerper[1].entity_public_ids, ["b-1", "b-2", "b-3"], "nach einem Wechsel der Auswahl gilt die NEUE Gruppe -- nichts ist eingefroren"); zaehl();
	}
	// ---- 6. Ohne Gruppe oder mit einem einzigen Abschnitt: wie bisher ---------------------------------------
	{
		const ctx = macheKontext([]);
		const b = macheBehaelter("alle");
		await ctx.mountFeatureSourceEditor(b, "path", () => "solo", { gruppe: { publicIds: () => ["solo"], fest: false } });
		await b._klick(KLICK_HINZU);
		assert.ok(!("entity_public_ids" in ctx.__gerufen.koerper[1]), "ein einteiliger Weg verteilt nichts");
		assert.ok(!b.innerHTML.includes("fs-scope__choice"), "… und zeigt keine Wahl"); zaehl();
	}
	// ---- 7. by_entity zieht den Kartenspeicher je Kennung nach --------------------------------------------
	{
		const ctx = macheKontext([]);
		ctx.syncFeatureSourcesToClientCache("path", "seg-1", [Object.assign({}, ZEILE), Object.assign({}, ZEILE, { source_id: 8, label: "Geographia" })], {
			"seg-1": [{ source_id: 7, pages: "", reference_kind: "" }, { source_id: 8, pages: "S. 1", reference_kind: "ergaenzend" }],
			"seg-2": [{ source_id: 7, pages: "", reference_kind: "" }],
		});
		const refs = ctx.window.__featureSourceRefs;
		assert.deepStrictEqual([...refs["path:seg-1"]].map((r) => r.source_id), [7, 8], "seg-1 traegt beide");
		assert.deepStrictEqual([...refs["path:seg-2"]].map((r) => r.source_id), [7], "seg-2 nur die eine -- nie die Vereinigung");
		assert.strictEqual(refs["path:seg-1"][1].pages, "S. 1", "die Seiten reisen je Kennung mit");
		assert.ok(ctx.window.__sourceCatalog[8], "der Katalog kennt beide Zeilen"); zaehl();
		ctx.syncFeatureSourcesToClientCache("path", "seg-9", [Object.assign({}, ZEILE)]);
		assert.deepStrictEqual([...ctx.window.__featureSourceRefs["path:seg-9"]].map((r) => r.source_id), [7], "ohne by_entity wie bisher: der Anker"); zaehl();
	}
	console.log("quellen-verteiler: alle Zusicherungen erfuellt (" + zaehlung + " Bloecke)");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
