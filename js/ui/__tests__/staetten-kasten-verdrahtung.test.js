// Der Einbau des Kastens „Stätten" (mountStaettenKasten, js/ui/staetten-kasten.js) an seinen
// zwei Montagestellen: dem Dialog „Ort bearbeiten" (index.html + js/review/review-locations.js)
// und dem Ortseditor (html/wiki-sync-settlement-editor.html). Task 5 des Plans
// docs/superpowers/plans/2026-09-26-staetten-loeschen-umhaengen.md.
//
// ⚠️ Zeilenendenneutral: index.html, review-locations.js und der Ortseditor tragen CRLF, dieser
// Test faehrt \r\n vorher auf \n zurueck (AGENTS.md §9).
//
// 🔴 GESUCHT WIRD IM AUSSCHNITT, NICHT IN DER GANZEN DATEI -- derselbe Grund wie in
// editor-abschnittsreihenfolge.test.js: eine Nadel ohne ihren Rahmen fände sonst irgendeinen
// zweiten Treffer und pruefte etwas anderes, als sie zu pruefen behauptet.
//
// Aus der Wurzel des Repos:  node js/ui/__tests__/staetten-kasten-verdrahtung.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
const ohneJsKommentare = (js) => js
	.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
	.replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");

let geprueft = 0;
const pruefe = (bedingung, meldung) => {
	assert.ok(bedingung, meldung);
	geprueft += 1;
};

// ── 1. index.html: die Sektion ────────────────────────────────────────────────────────────────
{
	const roh = lies("index.html");
	const html = ohneHtmlKommentare(roh);
	const staettenNadel = 'id="location-edit-staetten-sektion"';
	const staettenStelle = html.indexOf(staettenNadel);
	pruefe(staettenStelle > 0, "die Staetten-Sektion steht in index.html");

	// Die Sektion selbst: hidden, traegt den Host-Behaelter, Titel „Stätten".
	const sektionAnfang = html.lastIndexOf('<div class="label-edit-section"', staettenStelle);
	pruefe(sektionAnfang > 0 && sektionAnfang <= staettenStelle, "die Sektion beginnt mit .label-edit-section");
	const sektionEnde = html.indexOf("</div></div>", staettenStelle) + "</div></div>".length;
	const sektionRumpf = html.slice(sektionAnfang, sektionEnde);
	pruefe(/\shidden(?:[\s>]|$)/.test(sektionRumpf.slice(0, sektionRumpf.indexOf(">") + 1)),
		"die Sektion ist anfangs hidden");
	pruefe(sektionRumpf.includes('<div class="label-edit-section-title">Stätten</div>'), "Titel „Stätten“");
	pruefe(sektionRumpf.includes('<div id="location-edit-staetten">'), "Host-Behaelter #location-edit-staetten");

	// Steht VOR der Quellen-Sektion desselben Dialogs (Ort bearbeiten) -- Owner-Regel „Quellen immer
	// ganz unten" (AGENTS.md §11). Gesucht wird die naechste Quellen-Sektion NACH der Staetten-Sektion.
	const quellenStelle = html.indexOf(
		'<div class="label-edit-section"><div class="label-edit-section-title">Quellen</div>', staettenStelle);
	pruefe(quellenStelle > staettenStelle, "die Staetten-Sektion steht VOR der Quellen-Sektion im selben Dialog");
	pruefe(html.slice(staettenStelle, quellenStelle).indexOf("</label>") === -1,
		"zwischen Staetten- und Quellen-Sektion steht kein anderes Formularfeld");

	// Das Skript nur fuer Editoren, direkt nach der Vorlage von review-feature-sources.js.
	const roheZeile = roh; // hier zaehlen echte Zeilenenden nicht, nur die Reihenfolge im Text
	const fsVorlage = '<template data-nur-editor><script src="js/review/review-feature-sources.js"></script></template><script>avesmapsNurEditorSkripte()</script>';
	const fsStelle = roheZeile.indexOf(fsVorlage);
	pruefe(fsStelle > 0, "die Vorlage von review-feature-sources.js steht wie erwartet in index.html");
	const staettenVorlage = '<template data-nur-editor><script src="js/ui/staetten-kasten.js"></script></template><script>avesmapsNurEditorSkripte()</script>';
	const staettenVorlageStelle = roheZeile.indexOf(staettenVorlage, fsStelle);
	pruefe(staettenVorlageStelle > fsStelle, "die Vorlage von staetten-kasten.js steht direkt danach");
	pruefe(roheZeile.slice(fsStelle + fsVorlage.length, staettenVorlageStelle).trim() === "",
		"zwischen beiden Vorlagen steht nur Leerraum -- „direkt danach“");
	pruefe(roheZeile.indexOf('src="js/ui/staetten-kasten.js"') === roheZeile.indexOf('src="js/ui/staetten-kasten.js"', 0),
		"staetten-kasten.js wird nicht doppelt eingebunden (triviale Selbstprobe)");
	pruefe((roheZeile.match(/src="js\/ui\/staetten-kasten\.js"/g) || []).length === 1,
		"staetten-kasten.js steht genau einmal in index.html");
}

// ── 2. styles.css importiert die Datei ────────────────────────────────────────────────────────
{
	const css = lies("css/styles.css");
	pruefe(css.includes('@import url("components/staetten-kasten.css");'), "styles.css importiert staetten-kasten.css");
	pruefe(fs.existsSync(path.join(WURZEL, "css/components/staetten-kasten.css")), "die importierte Datei existiert");
}

// ── 3. mountLocationEditStaetten, ausgefuehrt ─────────────────────────────────────────────────
// Die Funktion wird aus review-locations.js ausgeschnitten und mit einer Dokument-Attrappe
// gefahren -- dieselbe Rezeptur wie quellen-im-herrschaftsgebiet-dialog.test.js.
{
	const roh = lies("js/review/review-locations.js");
	pruefe(/mountLocationEditFeatureSources\(\);\s*mountLocationEditStaetten\(\);/.test(roh),
		"mountLocationEditStaetten wird direkt nach mountLocationEditFeatureSources gerufen");

	const start = roh.indexOf("function mountLocationEditStaetten()");
	pruefe(start > 0, "mountLocationEditStaetten ist definiert");
	// Naechste Top-Level-Funktion als Ende des Ausschnitts.
	const ende = roh.indexOf("\nfunction ", start + 1);
	pruefe(ende > start, "das Ende der Funktion ist auffindbar");
	const quelle = roh.slice(start, ende);

	function element(id, werte, klone) {
		const el = {
			id,
			value: werte[id] !== undefined ? werte[id] : "",
			hidden: false,
			addEventListener() {},
		};
		klone.set(id, el);
		return el;
	}

	function fahre(werte) {
		const aufrufe = [];
		const klone = new Map();
		const document = {
			getElementById: (id) => (klone.has(id) ? klone.get(id) : element(id, werte, klone)),
		};
		const context = {
			console,
			document,
			mountStaettenKasten: (host, opts) => { aufrufe.push({ host, opts }); },
			escapeHtml: (s) => String(s),
		};
		vm.createContext(context);
		// Wie im Browser optional verkettet (`?.value`) -- Node ab 14 kennt das, kein Transpile noetig.
		vm.runInContext(quelle, context);
		vm.runInContext("mountLocationEditStaetten();", context);
		return { aufrufe, klone };
	}

	// a) Ohne Kennung (neu angelegter, noch nicht gespeicherter Ort): Sektion bleibt verborgen,
	// das Bauteil wird nicht gerufen.
	{
		const { aufrufe, klone } = fahre({ "location-edit-public-id": "", "location-edit-name": "Neuer Ort" });
		pruefe(aufrufe.length === 0, "ohne public_id wird mountStaettenKasten nicht gerufen");
		pruefe(klone.get("location-edit-staetten-sektion").hidden === true, "die Sektion bleibt verborgen");
	}

	// b) Mit Kennung: die Sektion wird zuerst verborgen (dann ggf. vom Bauteil wieder eingeblendet --
	// das ist Sache von mountStaettenKasten, nicht dieser Funktion), und der Kasten wird mit Name +
	// Kennung gerufen.
	{
		const { aufrufe, klone } = fahre({
			"location-edit-public-id": "ort-42",
			"location-edit-name": "Warunk",
		});
		pruefe(aufrufe.length === 1, "mit public_id wird mountStaettenKasten genau einmal gerufen");
		const { host, opts } = aufrufe[0];
		pruefe(host === klone.get("location-edit-staetten"), "montiert wird auf #location-edit-staetten");
		pruefe(opts.ortPublicId === "ort-42", "die Kennung wird durchgereicht");
		pruefe(opts.ortName === "Warunk", "der Ortsname wird durchgereicht");
		pruefe(opts.sektion === klone.get("location-edit-staetten-sektion"), "die Sektion wird durchgereicht");
		pruefe(typeof opts.escape === "function", "escape wird durchgereicht");
	}

	// c) typeof-Schutz: fehlt mountStaettenKasten (Besucher -- die Datei ist eine nur-editor-Vorlage),
	// bleibt die Sektion verborgen und es wird nichts gerufen, statt zu werfen.
	{
		const klone = new Map();
		const werte = { "location-edit-public-id": "ort-42", "location-edit-name": "Warunk" };
		const document = { getElementById: (id) => (klone.has(id) ? klone.get(id) : element(id, werte, klone)) };
		const context = { console, document, escapeHtml: (s) => String(s) }; // kein mountStaettenKasten
		vm.createContext(context);
		vm.runInContext(quelle, context);
		vm.runInContext("mountLocationEditStaetten();", context);
		pruefe(klone.get("location-edit-staetten-sektion").hidden === true,
			"ohne mountStaettenKasten (Besucher) bleibt die Sektion verborgen, kein Fehler");
	}
}

// ── 4. Der Ortseditor: Link, Skript, form.staetten vor form.sources, Montage im Rennwaechter ────
{
	const roh = lies("html/wiki-sync-settlement-editor.html");
	const ohneKommentare = roh.replace(/<!--[\s\S]*?-->/g, "");

	pruefe(ohneKommentare.includes('<link rel="stylesheet" href="/css/components/staetten-kasten.css" />'),
		"der Ortseditor bindet staetten-kasten.css ein");
	pruefe(ohneKommentare.includes('<script src="/js/ui/staetten-kasten.js"></script>'),
		"der Ortseditor bindet staetten-kasten.js ein");
	const fsSkriptStelle = ohneKommentare.indexOf('<script src="/js/review/review-feature-sources.js"></script>');
	const staettenSkriptStelle = ohneKommentare.indexOf('<script src="/js/ui/staetten-kasten.js"></script>');
	pruefe(fsSkriptStelle > 0 && staettenSkriptStelle > fsSkriptStelle,
		"staetten-kasten.js laedt NACH review-feature-sources.js");
	const sourceAutocompleteStelle = ohneKommentare.indexOf('<script src="/js/ui/source-autocomplete.js"></script>');
	pruefe(sourceAutocompleteStelle > 0 && sourceAutocompleteStelle < staettenSkriptStelle,
		"source-autocomplete.js (attachTypeahead) laedt VOR staetten-kasten.js");

	// buildSettlementEditFormHtml: das Feld `staetten` existiert nur bei detail.on_map === true.
	const formStart = ohneKommentare.indexOf("function buildSettlementEditFormHtml(detail) {");
	pruefe(formStart > 0, "buildSettlementEditFormHtml ist definiert");
	const formEnde = ohneKommentare.indexOf("\nfunction ", formStart + 1);
	const formQuelle = ohneJsKommentare(ohneKommentare.slice(formStart, formEnde));
	pruefe(/detail\.on_map === true\s*\n?\s*\?\s*`<div id="dtStaettenSektion" hidden>/.test(formQuelle),
		"das Feld `staetten` steht nur bei detail.on_map === true (sonst \"\")");
	pruefe(formQuelle.includes('<div class="dt-grp">Stätten</div><div id="dtStaetten"></div>'),
		"Titel „Stätten“ und Host-Behaelter #dtStaetten");
	pruefe(/staetten:\s*staettenRow,/.test(formQuelle), "das Feld heisst `staetten` im zurueckgegebenen Objekt");

	// Die Zusammensetzung (buildSettlementDetailHtml): form.staetten steht VOR form.sources.
	const zusammensetzungStart = ohneKommentare.indexOf("function buildSettlementDetailHtml(detail) {");
	pruefe(zusammensetzungStart > 0, "buildSettlementDetailHtml ist definiert");
	const zusammensetzungEnde = ohneKommentare.indexOf("\n// ---- Territorium", zusammensetzungStart);
	const zusammensetzungQuelle = ohneJsKommentare(ohneKommentare.slice(zusammensetzungStart, zusammensetzungEnde));
	const staettenIndex = zusammensetzungQuelle.indexOf("form.staetten");
	const sourcesIndex = zusammensetzungQuelle.indexOf("form.sources");
	pruefe(staettenIndex > 0 && sourcesIndex > staettenIndex, "form.staetten steht VOR form.sources in der Zusammensetzung");

	// renderSettlementDetail: die Montage steht direkt nach mountFeatureSourceEditor, unter
	// DEMSELBEN Rennwaechter (selectedPublicId).
	const renderStart = ohneKommentare.indexOf("async function renderSettlementDetail(publicId) {");
	pruefe(renderStart > 0, "renderSettlementDetail ist definiert");
	const renderEnde = ohneKommentare.indexOf("\n} catch (error) {", renderStart);
	const renderQuelle = ohneJsKommentare(ohneKommentare.slice(renderStart, renderEnde));
	const fsMountIndex = renderQuelle.indexOf('mountFeatureSourceEditor($("dtFeatureSources")');
	const staettenMountIndex = renderQuelle.indexOf('mountStaettenKasten($("dtStaetten")');
	pruefe(fsMountIndex > 0 && staettenMountIndex > fsMountIndex,
		"mountStaettenKasten wird NACH mountFeatureSourceEditor gerufen");
	pruefe(/if \(typeof mountStaettenKasten === "function" && \$\("dtStaetten"\) && selectedPublicId\) \{/.test(renderQuelle),
		"derselbe Rennwaechter (typeof-Schutz + Host + selectedPublicId) wie beim Quellen-Editor");
	pruefe(/ortPublicId:\s*selectedPublicId,/.test(renderQuelle), "die Kennung kommt aus selectedPublicId");
	pruefe(/sektion:\s*\$\("dtStaettenSektion"\),/.test(renderQuelle), "die Sektion wird durchgereicht");
	pruefe(/escape:\s*settlementEscape,/.test(renderQuelle.slice(staettenMountIndex)),
		"escape wird durchgereicht (settlementEscape wie beim Quellen-Editor)");
}

console.log("staetten-kasten-verdrahtung: " + geprueft + " Zusicherungen erfuellt");
