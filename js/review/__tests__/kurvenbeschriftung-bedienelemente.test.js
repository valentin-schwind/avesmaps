// Die zwei Bedienelemente der Kurvenbeschriftung im Beschriftungsdialog (Entwurf §2).
//
// 💣 DIE TRAGENDE ZUSICHERUNG IST „NUR WENN ANGEFASST". Der Wert gehoert der REGION und steht an
// ZWEI Oberflaechen; ein Dialog, der ihn bei jedem Speichern mitschickt, nimmt die Aenderung des
// anderen wortlos zurueck -- derselbe Fehler wie in avesmapsUpsertGameLiterature.
//
// ⚠️ Geprueft wird die ECHTE Datei im vm-Sandkasten, kein Nachbau: ein Nachbau prueft den Nachbau.
//
// Run: node js/review/__tests__/kurvenbeschriftung-bedienelemente.test.js

"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;

function baueElement(id) {
	return { id, value: "", checked: false, disabled: false, hidden: false, textContent: "" };
}

function baueSandkasten() {
	const els = {};
	for (const id of ["label-edit-curve", "label-edit-curve-max", "label-edit-curve-max-range", "label-edit-curve-hint"]) {
		els[id] = baueElement(id);
	}
	const document = {
		getElementById: (id) => els[id] || null,
		addEventListener: () => {},
		querySelectorAll: () => [],
		querySelector: () => null,
	};
	const sandkasten = {
		document,
		window: { addEventListener: () => {} },
		console,
		els,
	};
	sandkasten.globalThis = sandkasten;
	vm.createContext(sandkasten);
	const quelle = fs.readFileSync(path.join(wurzel, "js/review/review-labels.js"), "utf8");
	vm.runInContext(quelle, sandkasten, { filename: "review-labels.js" });
	return sandkasten;
}

const s = baueSandkasten();
const { els } = s;

// ---- ohne Flaeche: verriegelt, begruendet, und es wird NICHTS genannt -------------------------
s.syncLabelCurveControls(null);
assert.strictEqual(els["label-edit-curve"].disabled, true, "ohne Region muss der Haken verriegelt sein");
assert.strictEqual(els["label-edit-curve-max"].disabled, true);
assert.strictEqual(els["label-edit-curve-max-range"].disabled, true);
assert.strictEqual(els["label-edit-curve-hint"].hidden, false, "der Grund muss sichtbar sein");
assert.ok(els["label-edit-curve-hint"].textContent.includes("Mittelachse"), "der Hinweis muss den Grund nennen");
checks += 5;

// 💣 Und er darf nichts schicken: ein aus dem verriegelten Haken abgeleitetes „aus" schaltete die
// Kurve einer Region ab, sobald jemand irgendein flaechenloses Label speichert.
assert.strictEqual(s.getLabelCurvePayload(), null, "ohne Flaeche darf NICHTS genannt werden");
// 💣 Und zwar UNABHAENGIG vom Widget-Wert. Massgeblich ist der gemerkte Stand (`null` = nicht
// bedienbar), nicht das Haekchen: wer stattdessen den Haken abliest, schickt beim Speichern eines
// flaechenlosen Labels ein „aus" an die Region -- und schaltet deren Kurve ab, ohne dass jemand
// etwas bedient hat. Genau diese Mutation hat die erste Fassung dieses Tests ueberlebt.
els["label-edit-curve"].checked = true;
els["label-edit-curve-max"].value = "3";
assert.strictEqual(s.getLabelCurvePayload(), null, "der verriegelte Zustand schlaegt den Widget-Wert");
els["label-edit-curve"].checked = false;
els["label-edit-curve-max"].value = "1";
checks += 2;

// Eine Region OHNE Flaeche ist derselbe Fall wie gar keine Region.
s.syncLabelCurveControls({ area_count: 0, curve_label: true, curve_label_max: 3 });
assert.strictEqual(els["label-edit-curve"].disabled, true, "eine Region ohne Flaeche hat keine Achse");
assert.strictEqual(s.getLabelCurvePayload(), null);
checks += 2;

// ---- mit Flaeche: gefuellt aus der REGIONSZEILE -----------------------------------------------
s.syncLabelCurveControls({ area_count: 2, curve_label: true, curve_label_max: 2 });
assert.strictEqual(els["label-edit-curve"].disabled, false);
assert.strictEqual(els["label-edit-curve"].checked, true, "der Haken kommt aus der Regionszeile");
assert.strictEqual(els["label-edit-curve-max"].value, "2");
assert.strictEqual(els["label-edit-curve-max-range"].value, "2", "der Regler muss mitgezogen werden");
assert.strictEqual(els["label-edit-curve-hint"].hidden, true);
checks += 5;

// Unveraendert -> es wird NICHTS genannt.
assert.strictEqual(s.getLabelCurvePayload(), null, "unveraendert darf nichts genannt werden");
checks += 1;

// Haken umgelegt -> BEIDE Werte reisen (der Server schreibt nur Genanntes).
// ⚠️ Kein deepStrictEqual: das Ergebnis entsteht IM Sandkasten und traegt dessen Object-Prototyp --
// strukturgleich, aber nicht realm-gleich. Verglichen werden deshalb die Felder.
els["label-edit-curve"].checked = false;
let r = s.getLabelCurvePayload();
assert.strictEqual(r.curve_label, false);
assert.strictEqual(r.curve_label_max, 2, "der unveraenderte Wert reist MIT -- der Server schreibt nur Genanntes");
checks += 2;

// Nur die Zahl geaendert -> ebenfalls beide.
els["label-edit-curve"].checked = true;
els["label-edit-curve-max"].value = "3";
r = s.getLabelCurvePayload();
assert.strictEqual(r.curve_label, true);
assert.strictEqual(r.curve_label_max, 3);
checks += 2;

// Der Deckel gilt auch im Browser -- 1..3, wie der Server.
els["label-edit-curve-max"].value = "9";
assert.strictEqual(s.getLabelCurvePayload().curve_label_max, 3, "ueber 3 wird gedeckelt");
els["label-edit-curve-max"].value = "0";
assert.strictEqual(s.getLabelCurvePayload().curve_label_max, 1, "unter 1 wird gedeckelt");
els["label-edit-curve-max"].value = "keine Zahl";
assert.strictEqual(s.getLabelCurvePayload().curve_label_max, 1, "Unsinn faellt auf 1");
checks += 3;

// ---- ein AUSgeschaltete Region fuellt korrekt -------------------------------------------------
s.syncLabelCurveControls({ area_count: 1, curve_label: false, curve_label_max: 1 });
assert.strictEqual(els["label-edit-curve"].checked, false);
assert.strictEqual(s.getLabelCurvePayload(), null);
checks += 2;

// ---- VERDRAHTUNG: die Bruecke muss den Rumpf auch mitnehmen -----------------------------------
// 💣 Ein gruener Test beweist nichts ohne Verdrahtung. getLabelCurvePayload darf nicht bloss
// existieren -- die Writeback-Bruecke (der EINZIGE update_region-Weg des Beschriftungsdialogs) muss
// sie rufen und beide Schluessel setzen.
const bruecke = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-label-writeback.js"), "utf8");
assert.ok(bruecke.includes("getLabelCurvePayload("), "die Bruecke ruft getLabelCurvePayload nicht");
assert.ok(bruecke.includes("payload.curve_label ") || bruecke.includes("payload.curve_label ="), "curve_label wird nicht in den Rumpf gelegt");
assert.ok(bruecke.includes("payload.curve_label_max"), "curve_label_max wird nicht in den Rumpf gelegt");
checks += 3;

// Und das Markup: „Rotation" ist als Bedienelement weg, das Feld aber als hidden erhalten.
const html = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
assert.ok(html.includes('id="label-edit-curve"'), "der Haken fehlt im Dialog");
assert.ok(html.includes('id="label-edit-curve-max"'), "die Anzahl fehlt im Dialog");
assert.ok(!html.includes('id="label-edit-rotation-range"'), "der Rotationsregler muss weg sein");
// 💣 OHNE das hidden-Feld schriebe jedes Speichern eine 0 ueber den gespeicherten Winkel --
// buildLabelEditPayload liest formData.get("rotation"). Entwurf §8 verlangt seinen Erhalt.
assert.ok(/id="label-edit-rotation"[^>]*type="hidden"/.test(html), "das Rotationsfeld muss als hidden erhalten bleiben");
checks += 4;

// ---- DIE ZWEITE OBERFLAECHE: der Flaechendialog ------------------------------------------------
// 🔴 Derselbe Wert an ZWEI Oberflaechen (Entwurf §2). Der Flaechendialog liegt in einer IIFE und
// laesst sich nicht wie oben ausfuehren -- geprueft wird deshalb STRUKTURELL, dass er dieselbe Regel
// baut. ⚠️ Das ist schwaecher als der Lauf oben und hier bewusst so benannt.
const props = fs.readFileSync(path.join(wurzel, "js/map-features/map-features-ecosystem-properties.js"), "utf8");
assert.ok(props.includes("function syncPropertiesCurve("), "der Flaechendialog fuellt die Bedienelemente nicht");
assert.ok(props.includes("function getPropertiesCurvePayload("), "der Flaechendialog kennt die Nur-wenn-angefasst-Regel nicht");
assert.ok(props.includes("syncPropertiesCurve(regionAreaCount > 0"), "ohne Flaeche muss verriegelt werden");
assert.ok(props.includes("payload.curve_label = kurve.curve_label"), "curve_label kommt nicht in den Rumpf");
assert.ok(props.includes("payload.curve_label_max = kurve.curve_label_max"), "curve_label_max kommt nicht in den Rumpf");
// 💣 Die gefaehrlichste Regel, auch hier: kein gemerkter Stand => nichts nennen.
assert.ok(/kurveGeladen = bedienbar \? \{/.test(props), "der gemerkte Stand muss bei Unbedienbarkeit auf null fallen");
checks += 6;

// Und das Markup der zweiten Oberflaeche.
assert.ok(html.includes('id="ecosystem-properties-curve"'), "der Haken fehlt im Flaechendialog");
assert.ok(html.includes('id="ecosystem-properties-curve-max"'), "die Anzahl fehlt im Flaechendialog");
checks += 2;

// 🔴 Und der LESEWEG: ohne ihn stuende der Haken bei jedem Oeffnen leer da. list_regions ist der
// einzige Weg, der ihn herausgibt -- die Flaechenzeile des Kartenpayloads traegt ihn nicht.
const eco = fs.readFileSync(path.join(wurzel, "api/_internal/app/ecosystem.php"), "utf8");
assert.ok(eco.includes("'curve_label' => $kurve['enabled']"), "list_regions gibt die Einstellung nicht heraus");
assert.ok(eco.includes("'curve_label_max' => $kurve['max_labels']"), "list_regions gibt die Anzahl nicht heraus");
checks += 2;

console.log("kurvenbeschriftung-bedienelemente: " + checks + " checks passed");
