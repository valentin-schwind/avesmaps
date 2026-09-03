// Die EINE Weiche „wo liegen die Quellen einer Beschriftung“ -- und dass alle Leser und Schreiber sie rufen.
//
// Schritt 5 des Quellen-Umbaus (docs/superpowers/specs/2026-09-03-quellen-landschaften-design.md): die Flaeche traegt
// die Quellen, die Beschriftung zeigt sie. Gebunden -> ecosystem:<Flaeche>, frei -> region:<Label>, nie beides.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-quellen-schluessel.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
const ohneHtmlKommentare = (html) => html.replace(/<!--[\s\S]*?-->/g, "");
function rumpfVon(js, kopf) {
	const start = js.indexOf(kopf);
	assert.ok(start >= 0, kopf + " gibt es");
	let tiefe = 0; let ende = -1;
	// ⚠️ Ab dem LETZTEN Zeichen des Kopfes suchen: ein `{}` in der Parameterliste (options = {}) ist sonst die erste Klammer.
	for (let i = js.indexOf("{", start + kopf.length - 1); i < js.length; i += 1) { if (js[i] === "{") tiefe += 1; else if (js[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i; break; } } }
	return js.slice(start, ende);
}

// ---- 1. Die Weiche, ausgefuehrt --------------------------------------------------------------------------
const { avesmapsLabelQuellenSchluessel } = require(path.join(WURZEL, "js/map-features/label-quellen-schluessel.js"));
assert.deepStrictEqual(avesmapsLabelQuellenSchluessel({ publicId: "l-1", ecosystemRegionPublicId: "f-1" }), { type: "ecosystem", id: "f-1" }, "gebunden (normalisiert): die Flaeche");
assert.deepStrictEqual(avesmapsLabelQuellenSchluessel({ publicId: "l-1", ecosystemRegionPublicId: "" }), { type: "region", id: "l-1" }, "frei (normalisiert): das Label");
assert.deepStrictEqual(avesmapsLabelQuellenSchluessel({ properties: { public_id: "l-2", ecosystem_region_public_id: " f-2 " } }), { type: "ecosystem", id: "f-2" }, "gebunden (roh): getrimmt");
assert.deepStrictEqual(avesmapsLabelQuellenSchluessel({ properties: { public_id: "l-2" } }), { type: "region", id: "l-2" }, "frei (roh)");
assert.deepStrictEqual(avesmapsLabelQuellenSchluessel(null), { type: "region", id: "" }, "nichts: kein Wurf");

// ---- 2. Die Datenbox und das Kanon-Etikett der Beschriftung fragen die Weiche ---------------------------
{
	const js = ohneKommentare(lies("js/map-features/map-features-labels.js"));
	assert.ok(!/renderFeatureSourceLine\("region", label\.publicId/.test(js), "die Datenbox liest nicht mehr fest region:<Label>");
	assert.ok(!/renderFeatureKanonBadge\("region", label\.publicId/.test(js), "das Kanon-Etikett auch nicht");
	assert.ok(/avesmapsLabelQuellenSchluessel\(label\)/.test(js), "beide fragen die Weiche");
	assert.ok(/renderFeatureSourceLine\(quellenSchluessel\.type, quellenSchluessel\.id,/.test(js) && /renderFeatureKanonBadge\(quellenSchluessel\.type, quellenSchluessel\.id\)/.test(js),
		"… und reichen Typ UND Kennung durch -- ein zweiter Schluessel waere die Divergenz");
}

// ---- 3. Der Beschriftungsdialog: frei montiert auf region, gebunden zeigt zur Flaeche -------------------
{
	const quelle = lies("js/review/review-labels.js");
	const js = ohneKommentare(quelle);
	const rumpf = rumpfVon(js, "function openLabelEditDialog(options = {}) {");
	assert.ok(/avesmapsLabelQuellenSchluessel\(labelEditEntry\?\.label \|\| \{\}\)/.test(rumpf), "der Dialog fragt die Weiche mit der geladenen Beschriftung");
	assert.ok(/quellenZiel\.type === "ecosystem"/.test(rumpf) && /frisch\.hidden = true;/.test(rumpf), "gebunden: der Kasten der Beschriftung bleibt verborgen");
	assert.ok(/mountFeatureSourceEditor\(\s*frisch,\s*"region",/.test(rumpf), "frei: Mount auf region wie bisher");
	assert.ok(!/mountFeatureSourceEditor\(\s*frisch,\s*"ecosystem"/.test(rumpf), "der Beschriftungsdialog montiert NIE auf ecosystem -- das tut der Kasten der Flaeche");
	assert.ok(rumpf.includes("label-edit-feature-sources-wohin"), "… und sagt, wo die Quellen stehen");
}

// ---- 4. Der Flaechendialog montiert auf die Flaeche, der Landschaften-Editor auch --------------------------
{
	const eco = ohneKommentare(lies("js/map-features/map-features-ecosystem-properties.js"));
	const mount = rumpfVon(eco, "function mountEcosystemAreaSources(");
	assert.ok(/mountFeatureSourceEditor\(frisch, "ecosystem", \(\) => kennung,/.test(mount), "der Flaechendialog montiert auf ecosystem + public_id der Flaeche");
	assert.ok(/__fsDetachAutocomplete/.test(mount) && /cloneNode\(false\)/.test(mount), "… mit Klon-Ersatz und geloester Vorschlagsliste (kein Stapeln)");
	assert.ok(/mountEcosystemAreaSources\(area\.region_public_id\)/.test(eco), "… gerufen mit der Kennung der Flaeche");
	const editor = ohneHtmlKommentare(lies("html/landschaften-editor.html"));
	assert.ok(/mountFeatureSourceEditor\(sourceHost, "ecosystem", \(\) => String\(region\.public_id \|\| ""\),/.test(editor), "der Landschaften-Editor montiert auf ecosystem + public_id -- auch ohne Beschriftung");
	assert.ok(!/mountFeatureSourceEditor\(sourceHost, "region"/.test(editor), "… und nicht mehr auf das Schild");
}

// ---- 5. index.html: Weiche vor den Lesern, Host der Flaeche als Letztes vor den Knoepfen -------------------
{
	const html = ohneHtmlKommentare(lies("index.html"));
	const weiche = html.indexOf('src="js/map-features/label-quellen-schluessel.js"');
	assert.ok(weiche > 0, "die Weiche wird geladen");
	assert.ok(weiche < html.indexOf('src="js/map-features/map-features-labels.js"') && weiche < html.indexOf('src="js/review/review-labels.js"'), "… vor beiden Lesern");
	const host = html.indexOf('id="ecosystem-properties-sources"');
	// ⚠️ Dieselbe Klasse traegt ein frueherer Dialog -- gesucht wird die Knopfleiste NACH dem Host, im Flaechenformular.
	const formular = html.indexOf('id="ecosystem-properties-form"');
	const knoepfe = html.indexOf('class="ecosystem-properties-dialog__actions"', host);
	assert.ok(formular > 0 && host > formular && knoepfe > host && html.indexOf("</form>", host) > knoepfe, "der Host der Flaeche steht im Flaechenformular vor dessen Knoepfen");
	assert.ok(html.lastIndexOf('id="ecosystem-properties-peaks"', host) > 0, "… nach den Gipfeln -- als Letztes");
	assert.ok(html.includes('id="label-edit-feature-sources-wohin"'), "der Beschriftungsdialog hat die Zeile, die zur Flaeche zeigt");
}

console.log("label-quellen-schluessel: alle Zusicherungen erfuellt");
