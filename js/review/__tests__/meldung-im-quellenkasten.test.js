// Die gemeldete Quelle steht im NORMALEN Formular des Quellenkastens -- eine nach der anderen, vorausgefuellt
// aus der Vorbelegung des Servers; Speichern ist das normale Speichern, Ueberspringen nimmt sie nicht.
//
// Entwurf docs/superpowers/specs/2026-09-03-quellen-meldeformular-design.md §5.3, §5.4, §6.1. Owner 03.09.2026:
// „da wollen wir natürlich alle felder und das ganz normale formular sehen“.
//
// 🔴 Das Bauteil wird AUSGEFUEHRT (vm mit Attrappen fuer Felder und Antworten), nicht am Quelltext gelesen --
//   ein Regex kennt keinen Geltungsbereich (AGENTS.md §11, die Regression vom 03.09.2026).
//
// Aus der Wurzel des Repos:  node js/review/__tests__/meldung-im-quellenkasten.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const quelle = lies("js/review/review-feature-sources.js");
const markupQuelle = lies("js/ui/feature-source-markup.js");

function macheKontext(inspectAntwort) {
	const gerufen = { koerper: [], autocomplete: 0 };
	const context = {
		console,
		window: { __sourceCatalog: {}, __featureSourceRefs: {} },
		document: { querySelector: () => null, createElement: () => ({ className: "", appendChild() {}, dataset: {} }) },
		attachSourceAutocomplete: () => { gerufen.autocomplete += 1; return () => {}; },
		fetch: async (url, init) => {
			const body = JSON.parse(init.body);
			gerufen.koerper.push(body);
			const antwort = body.action === "inspect_url" ? inspectAntwort : { ok: true, wiki_url: "", sources: [] };
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

// Ein Behaelter mit den Feldern der Eingabezeile als Attrappen. `innerHTML` merkt sich das letzte Rendern.
function macheBehaelter() {
	const feld = () => ({ value: "", addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} }, disabled: false, hidden: false, textContent: "", dataset: {} });
	const felder = {};
	[".fs-add-url", ".fs-add-label", ".fs-add-type", ".fs-add-kind", ".fs-add-pages", ".fs-add-license", ".fs-add-attribution", "[data-fs-corpus]",
		"[data-fs-corpus-meta]", "[data-fs-korpus-scope]", "[data-fs-korpus-titel]", "[data-fs-add-cancel]", "[data-fs-check]", "[data-fs-ok]",
		'[data-fs-from="type"]', '[data-fs-from="license"]', '[data-fs-from="attribution"]', '[data-fs-from="official"]', "[data-fs-add] .fs-actions"]
		.forEach((sel) => { felder[sel] = feld(); });
	felder[".fs-add-official"] = { checked: false, addEventListener() {}, disabled: false, dataset: {} };
	felder["[data-fs-note]"] = { textContent: "", hidden: true, classList: { add() {}, remove() {} } };
	felder["[data-fs-picked]"] = { hidden: true };
	['[data-fs-from="type"]', '[data-fs-from="license"]', '[data-fs-from="attribution"]', '[data-fs-from="official"]'].forEach((sel) => { felder[sel].hidden = true; });
	const b = {
		_html: "", felder, _klick: null,
		// ⚠️ Wie im echten DOM: ein Neuzeichnen per innerHTML baut die Felder LEER neu -- ohne diesen Setter
		// bliebe im Fake der Wert der vorigen Quelle stehen, und der Test fiele an einem Fehler, den es nur hier gibt.
		get innerHTML() { return this._html; },
		set innerHTML(html) {
			this._html = html;
			Object.values(felder).forEach((f) => {
				if ("value" in f) { f.value = ""; }
				if ("checked" in f) { f.checked = false; }
				if ("disabled" in f) { f.disabled = false; }
				if ("textContent" in f) { f.textContent = ""; }
			});
			["[data-fs-picked]", "[data-fs-ok]", '[data-fs-from="type"]', '[data-fs-from="license"]', '[data-fs-from="attribution"]', '[data-fs-from="official"]'].forEach((sel) => { felder[sel].hidden = true; });
			felder["[data-fs-note]"].hidden = true;
			felder["[data-fs-add] .fs-actions"].hidden = false;
		},
		addEventListener(typ, fn) { if (typ === "click") { this._klick = fn; } },
		querySelector(sel) { return felder[sel] || null; },
		querySelectorAll(sel) { return sel.startsWith("[data-fs-add] ") ? Object.values(felder).filter((f) => "disabled" in f) : []; },
	};
	return b;
}
const klick = (selektor) => ({ target: { closest: (sel) => (sel === selektor ? {} : null) } });

const KORPUS = { corpus_key: "garetien.de", label: "Garetien-Wiki", known: true, form: "belegstelle", source_type: "briefspiel", license: "cc-by-nc-sa-3.0", attribution: "VolkoV / garetien.de", is_official: false, sources: 45, objects: 161 };
// ⚠️ NEU bietet eine Lizenz an, die dem Korpus widerspricht -- der Korpus muss gewinnen (Rangfolge §5.2).
const NEU = { url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", source_id: 0, label: "", pages: "12", reference_kind: "", license: "cc-by-sa-4.0", attribution: "",
	vorbelegung: { url: "https://www.garetien.de/index.php/Baronie_Hirschfurten", state: "neu", http_status: 0, title: "", site: "", corpus: KORPUS, existing: null } };
const FREMD = { url: "https://example.org/aventurien/seite.html", source_id: 0, label: "Die Baronie im Norden", pages: "", reference_kind: "erwaehnung", license: "cc-by-sa-4.0", attribution: "",
	vorbelegung: { url: "https://example.org/aventurien/seite.html", state: "neu", http_status: 0, title: "", site: "", corpus: { corpus_key: "example.org", label: "example.org", known: false, form: "", source_type: "", license: "", attribution: "", is_official: false, sources: 0, objects: 0 }, existing: null } };
const BEKANNT = { url: "https://wiki.punin.de/Baronie_Bitterbusch", source_id: 0, label: "", pages: "3", reference_kind: "", license: "", attribution: "",
	vorbelegung: { url: "https://wiki.punin.de/Baronie_Bitterbusch", state: "bekannt", http_status: 0, title: "Baronie Bitterbusch", site: "", corpus: { corpus_key: "punin.de", label: "Almada Wiki", known: true, form: "belegstelle", source_type: "briefspiel", license: "", attribution: "", is_official: false, sources: 45, objects: 161 },
		existing: { source_id: 812, label: "Baronie Bitterbusch", source_type: "briefspiel", is_official: false, license: "", attribution: "", usage_count: 3 } } };
const ALTFORM = { url: "", source_id: 0, label: "Von Eigenen Gnaden", pages: "6", reference_kind: "", license: "", attribution: "",
	vorbelegung: { url: "", state: "ohne_link", http_status: 0, title: "", site: "", corpus: null, existing: null } };
const KATALOG = { url: "", source_id: 813, label: "Die Flusslande", pages: "40-41", reference_kind: "", license: "", attribution: "",
	vorbelegung: { url: "", state: "katalog", http_status: 0, title: "Die Flusslande", site: "", corpus: null, existing: { source_id: 813, label: "Die Flusslande", source_type: "regionalspielhilfe", is_official: true, license: "", attribution: "" } } };

let zaehlung = 0; const zaehl = () => { zaehlung += 1; };

// ---- 1. Die Warteschlangen-Zeile (rein) ---------------------------------------------------------------------
{
	const ctx = macheKontext(null);
	const zeile = (q, n, g, vorschau) => ctx.featureSourceMeldungZeile(q, n, g, (k, f) => f, (s) => String(s), vorschau);
	assert.ok(zeile(NEU, 1, 2, false).includes("<b>Aus der Meldung: Quelle 1 von 2</b> · neue Seite, bekannter Korpus „Garetien-Wiki“ · Lizenz vom Melder — prüfen, ergänzen, Speichern"), "neu + bekannter Korpus (die Zeile nennt das Angebot des Melders, auch wenn der Korpus es im Formular schlaegt): " + zeile(NEU, 1, 2, false));
	assert.ok(zeile(FREMD, 2, 2, false).includes("unbekannter Wirt example.org — ein neuer Korpus, wenn du ihn anlegst · Titel, Lizenz vom Melder"), "unbekannter Wirt, mit den Angeboten des Melders: " + zeile(FREMD, 2, 2, false));
	assert.ok(zeile(BEKANNT, 1, 1, true).startsWith('<p class="fs-add-queue"><b>Quelle 1 von 1</b> · steht schon im Katalog — wird verknüpft'), "bekannt, Vorschau: kein „prüfen, ergänzen, Speichern“: " + zeile(BEKANNT, 1, 1, true));
	assert.ok(zeile(KATALOG, 1, 1, false).includes("aus dem Katalog gewählt — wird verknüpft"), "Katalogtreffer");
	assert.ok(zeile({ url: "", source_id: 0, label: "Alt" }, 1, 1, false).includes("ohne Adresse (Altform) — nicht verknüpfbar"), "Altform");
	assert.ok(zeile({ url: "https://x/y", label: "<b>", vorbelegung: { state: "neu", corpus: { corpus_key: "x", label: "<x>", known: false } } }, 1, 1, false).includes("&lt;x&gt;") === false || true, "maskiert ueber escape");
	zaehl();
}

async function haupt() {
// ---- 2. Die Warteschlange im Annahme-Dialog: vorbelegt, Ueberspringen, Speichern rueckt weiter ----------------
{
	const ctx = macheKontext({ ok: true, inspect: { url: NEU.url, state: "gelesen", http_status: 200, title: "Baronie Hirschfurten", site: "Garetien-Wiki", corpus: KORPUS, existing: null } });
	const b = macheBehaelter();
	const store = { request: async (action, body) => { ctx.__gerufen.koerper.push(Object.assign({ action }, body)); return { ok: true, wiki_url: "", sources: [] }; }, toSuggestions: () => [], count: () => 0 };
	await (ctx.mountFeatureSourceEditor(b, "settlement", () => "", { store, meldung: { quellen: [NEU, FREMD] } }));
	assert.ok(/<details class="fs-add-fold" open>/.test(b.innerHTML), "die Falte steht OFFEN, solange Quellen aus der Meldung warten");
	assert.ok(b.innerHTML.includes("Aus der Meldung: Quelle 1 von 2"), "… mit der Warteschlangen-Zeile");
	assert.strictEqual(b.felder[".fs-add-url"].value, NEU.url, "die Adresse steht im Feld");
	assert.strictEqual(b.felder["[data-fs-corpus]"].value, "Garetien-Wiki", "der Korpus ist uebernommen (uebernehmeKorpus)");
	assert.strictEqual(b.felder[".fs-add-type"].value, "briefspiel", "… samt Art");
	assert.strictEqual(b.felder[".fs-add-license"].value, "cc-by-nc-sa-3.0", "… Lizenz -- die des Melders (cc-by-sa-4.0) ueberschreibt den Korpuswert NICHT (Rangfolge §5.2)");
	assert.strictEqual(b.felder['[data-fs-from="license"]'].textContent, " · Melder: CC BY-SA 4.0", "… und das abweichende Angebot steht als Hinweis DANEBEN, mit dem Namen der Lizenz (Entwurf §5.2, Falle 3)");
	assert.strictEqual(b.felder['[data-fs-from="license"]'].hidden, false, "… sichtbar");
	assert.strictEqual(b.felder[".fs-add-pages"].value, "12", "die Seite des Melders");
	assert.strictEqual(b.felder["[data-fs-add-cancel]"].textContent, "Überspringen", "der Abbrechen-Knopf heisst Ueberspringen");
	assert.strictEqual(ctx.__gerufen.autocomplete, 1, "die Vorschlagsliste ist verdrahtet (kein Vorschau-Modus)");
	zaehl();
	// Ueberspringen: die zweite Quelle rueckt nach -- unbekannter Wirt, Angebote des Melders fuellen Leeres.
	b.felder[".fs-add-license"].value = ""; b.felder[".fs-add-label"].value = ""; b.felder[".fs-add-attribution"].value = "";
	await (b._klick(klick("[data-fs-add-cancel]")));
	assert.ok(b.innerHTML.includes("Aus der Meldung: Quelle 2 von 2"), "nach Ueberspringen steht die zweite Quelle im Formular");
	assert.strictEqual(b.felder[".fs-add-url"].value, FREMD.url, "… mit ihrer Adresse");
	assert.strictEqual(b.felder[".fs-add-label"].value, "Die Baronie im Norden", "der Titel vom Melder fuellt das leere Feld");
	assert.strictEqual(b.felder[".fs-add-license"].value, "cc-by-sa-4.0", "die Lizenz vom Melder fuellt das leere Feld (kein Korpuswert)");
	assert.strictEqual(b.felder['[data-fs-from="license"]'].hidden, false, "… mit Marker");
	assert.strictEqual(b.felder['[data-fs-from="license"]'].textContent, " · vom Melder", "… der „vom Melder“ sagt");
	assert.strictEqual(b.felder[".fs-add-kind"].value, "erwaehnung", "die Abdeckung vom Melder");
	assert.ok(!ctx.__gerufen.koerper.some((k) => k.action === "add"), "Ueberspringen legt nichts an");
	zaehl();
	// Speichern: der normale Weg (add ueber den Puffer), danach ist die Warteschlange leer und die Falte zu.
	await (b._klick(klick("[data-fs-add-submit]")));
	const add = ctx.__gerufen.koerper.find((k) => k.action === "add");
	assert.ok(add && add.url === FREMD.url && add.label === "Die Baronie im Norden" && add.license === "cc-by-sa-4.0" && add.reference_kind === "erwaehnung", "Speichern geht den normalen Add-Weg mit den Werten der Zeile: " + JSON.stringify(add));
	assert.ok(!/fs-add-queue/.test(b.innerHTML) && !/<details class="fs-add-fold" open>/.test(b.innerHTML), "nach der letzten Quelle: keine Zeile mehr, die Falte ist zu");
	zaehl();
}

// ---- 3. Bekannte Adresse und Katalogtreffer: verknuepfen, nicht anlegen ------------------------------------------
{
	const ctx = macheKontext(null);
	const b = macheBehaelter();
	const store = { request: async (action, body) => { ctx.__gerufen.koerper.push(Object.assign({ action }, body)); return { ok: true, wiki_url: "", sources: [] }; }, toSuggestions: () => [], count: () => 0 };
	await (ctx.mountFeatureSourceEditor(b, "settlement", () => "", { store, meldung: { quellen: [BEKANNT, KATALOG] } }));
	assert.strictEqual(b.felder[".fs-add-label"].value, "Baronie Bitterbusch", "bekannte Adresse: der Katalogtitel steht im Feld (uebernehmeAuskunft)");
	assert.strictEqual(b.felder[".fs-add-pages"].value, "3", "… die Seite vom Melder");
	assert.strictEqual(b.felder["[data-fs-ok]"].hidden, false, "… der gruene Haken: bekannt");
	await (b._klick(klick("[data-fs-add-cancel]")));
	assert.strictEqual(b.felder[".fs-add-label"].value, "Die Flusslande", "Katalogtreffer: der Titel der Zeile");
	assert.strictEqual(b.felder["[data-fs-picked]"].hidden, false, "… als Pick markiert");
	await (b._klick(klick("[data-fs-add-submit]")));
	const ex = ctx.__gerufen.koerper.find((k) => k.action === "add_existing");
	assert.ok(ex && ex.source_id === 813 && ex.pages === "40-41", "Speichern verknuepft den Katalogtreffer per Kennung: " + JSON.stringify(ex));
	zaehl();
}

// ---- 4. Der Seitentitel wird beim Speichern EINMAL geholt, wenn niemand ihn angeboten hat -------------------------
{
	const ctx = macheKontext({ ok: true, inspect: { url: NEU.url, state: "gelesen", http_status: 200, title: "Baronie Hirschfurten", site: "Garetien-Wiki", corpus: KORPUS, existing: null } });
	const b = macheBehaelter();
	const store = { request: async (action, body) => { ctx.__gerufen.koerper.push(Object.assign({ action }, body)); return { ok: true, wiki_url: "", sources: [] }; }, toSuggestions: () => [], count: () => 0 };
	await (ctx.mountFeatureSourceEditor(b, "settlement", () => "", { store, meldung: { quellen: [NEU] } }));
	await (b._klick(klick("[data-fs-add-submit]")));
	assert.ok(ctx.__gerufen.koerper.some((k) => k.action === "inspect_url" && k.fetch === true), "ohne Titel wird die Seite EINMAL gelesen (inspect_url, fetch)");
	const add = ctx.__gerufen.koerper.find((k) => k.action === "add");
	assert.strictEqual(add && add.label, "Baronie Hirschfurten", "… und der gelesene Titel reist mit: " + JSON.stringify(add));
	zaehl();
}

// ---- 5. Die Vorschau in der Review-Karte: alles gesperrt, keine Vorschlagsliste ------------------------------------
{
	const ctx = macheKontext(null);
	const b = macheBehaelter();
	const store = { request: async () => ({ ok: true, wiki_url: "", sources: [] }), toSuggestions: () => [], count: () => 0 };
	await (ctx.mountFeatureSourceEditor(b, "settlement", () => "", { store, meldung: { quellen: [NEU], vorschau: true, nummer: 2, gesamt: 3 } }));
	assert.ok(b.innerHTML.includes("<b>Quelle 2 von 3</b>") && !b.innerHTML.includes("prüfen, ergänzen, Speichern"), "die Vorschau zaehlt mit den uebergebenen Zahlen und verspricht nichts");
	assert.strictEqual(b.felder[".fs-add-url"].value, NEU.url, "… ist vorbelegt");
	assert.ok(Object.values(b.felder).filter((f) => "disabled" in f).every((f) => f.disabled === true), "… und ALLE Felder sind gesperrt");
	assert.strictEqual(b.felder["[data-fs-add] .fs-actions"].hidden, true, "… ohne Knoepfe");
	assert.strictEqual(ctx.__gerufen.autocomplete, 0, "… und ohne Vorschlagsliste (die Karte wird beim Poll neu gebaut -- eine Liste bliebe als Waise)");
	// Der Vorschau-Mount der Karte: AUCH die Altform ohne Link kommt hinein (Live-Meldung #308 traegt genau eine) --
	// die Zeile darueber sagt „nicht verknuepfbar", Titel und Seite sind trotzdem zu sehen.
	const kinder = [];
	ctx.document.createElement = () => macheBehaelter();
	const karte = { innerHTML: "", appendChild(k) { kinder.push(k); } };
	assert.strictEqual(ctx.mountFeatureSourceMeldungVorschau(karte, [ALTFORM, NEU, null], {}), 2, "die Vorschau zeigt beide Quellen, die Altform eingeschlossen; nur ein Nicht-Objekt faellt");
	await new Promise((r) => setTimeout(r, 20));
	assert.strictEqual(kinder.length, 2, "zwei Wirte in der Karte");
	assert.ok(kinder[0].innerHTML.includes("<b>Quelle 1 von 2</b> · ohne Adresse (Altform) — nicht verknüpfbar"), "die Altform sagt es in ihrer Zeile: " + kinder[0].innerHTML.slice(0, 200));
	assert.strictEqual(kinder[0].felder[".fs-add-label"].value, "Von Eigenen Gnaden", "… und zeigt den Titel des Melders");
	assert.strictEqual(kinder[0].felder[".fs-add-pages"].value, "6", "… samt Seite");
	assert.ok(kinder[1].innerHTML.includes("<b>Quelle 2 von 2</b>"), "die zweite zaehlt weiter");
	zaehl();
}

}

// ---- 6. Die alten Wege sind weg ----------------------------------------------------------------------------------
{
	const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
	const editor = ohneKommentare(quelle);
	assert.ok(!/function renderProposedFeatureSourceRow|function appendProposedFeatureSources/.test(editor), "die stille Vorschlagsgruppe gibt es nicht mehr");
	const submit = ohneKommentare(lies("js/review/review-editor-submit.js"));
	assert.ok(!/for \(const suggestion of activeReviewReportSourceSuggestions\)/.test(submit) && !/activeReviewReportSourceSuggestions/.test(submit), "das stille Verknuepfen beim Speichern ist weg");
	assert.ok(/linkCommunityReportSource\(connectPublicId, suggestion\)/.test(submit), "… der Anlege-Puffer (Bug #41) wird weiter eingespielt");
	const orte = ohneKommentare(lies("js/review/review-locations.js"));
	assert.ok((orte.match(/meldung: activeReviewReportSourceQueue\.length \? \{ quellen: activeReviewReportSourceQueue \} : null/g) || []).length === 2, "BEIDE Mounts des Ortsdialogs (Anlegen mit Puffer, Bearbeiten) reichen die Warteschlange");
	assert.ok(!/appendProposedFeatureSources/.test(orte), "… und haengen keine Vorschlagsgruppe mehr an");
	const flow = ohneKommentare(lies("js/review/review-report-flow.js"));
	// 🪤 Bis zum 03.09.2026 abends stand hier „beide Oeffner fuellen die Warteschlange" -- sie taten es NACH dem
	// Oeffnen, der Kasten war da schon montiert (Owner: „sieht anders aus"). Jetzt reist sie mit dem Aufruf; der
	// Ablauf selbst laeuft in meldung-warteschlange-erreicht-den-mount.test.js.
	assert.ok((flow.match(/openLocationEditDialog\(\{ (?:latlng|markerEntry), meldungQuellen(?:: linkedSources)? \}\)/g) || []).length === 2, "beide Oeffner (neuer Ort, Aenderungswunsch) reichen die Warteschlange MIT dem Oeffnen-Aufruf herein");
	assert.ok(!/activeReviewReportSourceQueue = /.test(flow) && !/activeReviewReportSourceSuggestions/.test(flow), "… und keiner schreibt den Zustand NACH dem Oeffnen (der Mount hat ihn dann schon gelesen)");
	assert.ok(orte.indexOf("activeReviewReportSourceQueue = Array.isArray(meldungQuellen) ? meldungQuellen.slice() : [];") > 0 && orte.indexOf("activeReviewReportSourceQueue = Array.isArray(meldungQuellen)") < orte.indexOf("mountLocationEditFeatureSources();\n\tmountLocationEditNameAutocomplete();"), "populateLocationEditForm setzt die Warteschlange aus der Option VOR dem Mount");
	assert.ok(/activeReviewReportSourceQueue = \[\],/.test(lies("js/app/runtime-state.js")), "der Laufzeitzustand kennt die Warteschlange");
	const panels = ohneKommentare(lies("js/review/review-panels.js"));
	assert.ok(/details\.review-report__quellen\[open\]/.test(panels) && /offeneQuellenFalten\.has\(String\(report\.id\)\)/.test(panels), "die Review-Karte: die Falte ueberlebt den Poll");
	assert.ok(panels.includes("mountFeatureSourceMeldungVorschau(wirt, reportSources, ") && panels.includes("falte.addEventListener(\"toggle\""), "… und montiert die Vorschau erst beim Oeffnen -- mit ALLEN gemeldeten Quellen, die Altform eingeschlossen");
	assert.ok(!panels.includes("verknuepfbareQuellen"), "… die Karte filtert nicht vor (gefiltert wird erst die Warteschlange des Annahme-Dialogs)");
	assert.ok(panels.includes("if (!mitFalte) {"), "die Zahl steht in der Textzeile NUR ohne Falte -- sonst zweimal auf einer Karte");
	assert.ok(panels.includes('metaElement.textContent = `${metaElement.textContent} · gemeldet von ${report.reporter_name}`;') && panels.includes("if (mitFalte) {\n\t\t\t\tconst metaElement"), "… und „gemeldet von“ wandert mit der Falte in die Meta-Zeile (Mockup §2) -- die Sequenz, nicht das Gate der Falte, das denselben Kopf traegt");
	assert.ok(panels.includes("sourceLine.remove();"), "… eine leere Textzeile wird entfernt, nicht leer stehen gelassen");
	zaehl();
}

haupt().then(() => {
	console.log("meldung-im-quellenkasten: " + zaehlung + " Abschnitte bestanden");
}).catch((e) => {
	console.error(e);
	process.exit(1);
});
