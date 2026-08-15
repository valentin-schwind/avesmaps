const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Jede Oberflaeche, die einen Ort speichert, muss „Verborgen" mitfuehren.
//
// 💣 DER GRUND, WARUM ES DIESEN TEST GIBT: am 15.08.2026 war der Haken nur im Siedlungseditor
// gebaut, und der Owner meldete „da is noch nix" -- er benutzt die Form auf der KARTE. Die Haken
// „Ort ist ein Nodix" / „Ruine/zerstört" stehen an DREI Stellen, nicht an einer:
//   1. html/wiki-sync-settlement-editor.html  (dtEditIs*)          -- der Siedlungseditor
//   2. index.html  (location-edit-is-*)                            -- „Ort bearbeiten" auf der Karte
//   3. index.html  (wiki-sync-resolve-is-*)                        -- das Loesen eines Sync-Falls
//
// 🔴 (3) BRAUCHT das Feld nicht, und das ist gemessen, nicht vermutet: dieser Weg laeuft ueber
// avesmapsWikiSyncBuildLocationProperties (api/_internal/wiki/locations.php), das auf den
// VORHANDENEN Eigenschaften aufbaut und nur die genannten Schluessel ueberschreibt -- is_hidden
// ueberlebt dort unangetastet.
//
// 💣 (1) und (2) senden dagegen an `update_point`, und avesmapsUpdatePointFeatureDetails liest
// `$payload['is_hidden'] ?? false`. Ein Speichern OHNE das Feld hebt das Verbergen also still
// wieder auf. Genau diese beiden bewacht der Test.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/review/__tests__/verborgen-editorformen.test.js

const lies = (...teile) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...teile), "utf8");

const indexHtml = lies("index.html");
const kartenform = lies("js", "review", "review-locations.js");
const siedlungseditor = lies("html", "wiki-sync-settlement-editor.html");

// --- 1. Der Siedlungseditor ------------------------------------------------------------------
assert.ok(
	/id="dtEditIsHidden"/.test(siedlungseditor),
	"dem Siedlungseditor fehlt der Haken (dtEditIsHidden)",
);
assert.ok(
	/is_hidden: Boolean\(\$\("dtEditIsHidden"\)\?\.checked\)/.test(siedlungseditor),
	"der Siedlungseditor sendet is_hidden nicht mit -- update_point wuerde es auf false setzen",
);

// --- 2. „Ort bearbeiten" auf der Karte --------------------------------------------------------
assert.ok(
	/id="location-edit-is-hidden"[^>]*name="is_hidden"/.test(indexHtml),
	"der Kartenform fehlt das Eingabefeld (location-edit-is-hidden / name=is_hidden)",
);
assert.ok(
	/getElementById\("location-edit-is-hidden"\)\.checked = Boolean\(location\.isHidden\)/.test(kartenform),
	"die Kartenform fuellt den Haken beim Oeffnen nicht -- er staende immer leer da",
);
assert.ok(
	/is_hidden: formData\.get\("is_hidden"\) === "on"/.test(kartenform),
	"die Kartenform sendet is_hidden nicht mit -- ein Speichern hoebe das Verbergen auf",
);

// --- 3. Beschriftung: EIN Wort auf allen Oberflaechen -----------------------------------------
// 🔴 „Verborgen", nicht „Versteckt" (Owner 15.08.2026). Vier Beschriftungen tragen es; die
// KENNUNGEN darunter (is_hidden, toggleHidden, spotlight.hidden) heissen unveraendert weiter.
assert.ok(/<span>Verborgen<\/span>/.test(indexHtml), "die Kartenform beschriftet den Haken nicht mit „Verborgen“");
assert.ok(/>Verborgene Orte</.test(indexHtml), "dem Auge-Menue fehlt „Verborgene Orte“");
assert.ok(/> Verborgen<\/label>/.test(siedlungseditor), "dem Siedlungseditor fehlt die Beschriftung „Verborgen“");
assert.ok(
	!/<span>Versteckt<\/span>|>Versteckte Orte</.test(indexHtml),
	"in index.html steht noch eine Beschriftung „Versteckt“ -- es gilt EIN Wort",
);

console.log("verborgen-editorformen: alle Faelle ok");
