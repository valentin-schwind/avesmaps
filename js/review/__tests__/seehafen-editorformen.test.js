const assert = require("assert");
const fs = require("fs");
const path = require("path");

// „Seehafen" (Owner 26.09.2026): ein viertes Merkmal am Ort, neben Nodix, Ruine und Verborgen.
// Es hat noch KEINE Wirkung -- die kommt spaeter. Diese Runde legt nur den Weg: Haken in beiden
// Speicher-Formen, Server-Lese- und Schreibpfad, Marker und locationData.
// 🔴 Nachtrag (Owner, selber Tag): mit Seeweg-Anbindung ist der Haken automatisch gesetzt und gesperrt,
// ohne setzen Editoren ihn von Hand. Die Anbindung beantwortet avesmapsOrtHatSeewegAnbindung, ausgefuehrt
// in js/routing/__tests__/seeweg-anbindung.test.js; hier steht nur die Verdrahtung der zwei Formen.
//
// 💣 Dieselben zwei Formen wie in verborgen-editorformen.test.js, denn beide senden an `update_point`:
//   1. html/wiki-sync-settlement-editor.html  (dtEditIsSeaport)   -- der Siedlungseditor
//   2. index.html  (location-edit-is-seaport)                     -- „Ort bearbeiten" auf der Karte
// Der Haken steht jeweils UEBER „Ort ist ein Nodix" (Owner).
//
// 🔴 Anders als bei is_nodix/is_ruined/is_hidden liest der Server is_seaport per array_key_exists:
// ein Aufrufer, der das Feld nicht kennt, laesst den Wert stehen, statt ihn auf false zu setzen.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/review/__tests__/seehafen-editorformen.test.js

const lies = (...teile) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...teile), "utf8");

const indexHtml = lies("index.html");
const kartenform = lies("js", "review", "review-locations.js");
const siedlungseditor = lies("html", "wiki-sync-settlement-editor.html");
const server = lies("api", "_internal", "map", "features.php");
const marker = lies("js", "map-features", "map-features-location-editing.js");
const kartendaten = lies("js", "routing", "routing.js");

// --- 1. Der Siedlungseditor ------------------------------------------------------------------
assert.ok(/id="dtEditIsSeaport"\$\{seewegAnbindung \|\| props\.is_seaport \? " checked" : ""\}\$\{seewegAnbindung \? " disabled" : ""\}> Seehafen/.test(siedlungseditor),
	"dem Siedlungseditor fehlt der Haken „Seehafen“ -- gesetzt und gesperrt bei Seeweg-Anbindung");
assert.ok(/const seewegAnbindung = dtSeewegAnbindung\(/.test(siedlungseditor), "der Siedlungseditor fragt die Seeweg-Anbindung nicht");
assert.ok(/window\.parent\.avesmapsOrtHatSeewegAnbindung/.test(siedlungseditor), "der Siedlungseditor muss den Index der Karte fragen");
assert.ok(
	/\$\{seaportRow\}\$\{nodixRow\}/.test(siedlungseditor),
	"im Siedlungseditor steht „Seehafen“ nicht direkt über „Ort ist ein Nodix“",
);
assert.ok(
	/is_seaport: Boolean\(\$\("dtEditIsSeaport"\)\?\.checked\)/.test(siedlungseditor),
	"der Siedlungseditor sendet is_seaport nicht mit",
);

// --- 2. „Ort bearbeiten" auf der Karte --------------------------------------------------------
assert.ok(
	/id="location-edit-is-seaport" name="is_seaport" type="checkbox" \/>\s*<span>Seehafen <span id="location-edit-seaport-auto"[^>]*hidden>[^<]*<\/span><\/span>\s*<\/label>\s*<label[^>]*>\s*<input id="location-edit-is-nodix"/.test(indexHtml),
	"der Kartenform fehlt der Haken „Seehafen“ direkt über „Ort ist ein Nodix“",
);
assert.ok(
	/seehafenHaken\.checked = seewegAnbindung \|\| Boolean\(location\.isSeaport\)/.test(kartenform),
	"die Kartenform fuellt den Haken beim Oeffnen nicht -- er staende immer leer da",
);
assert.ok(/seehafenHaken\.disabled = seewegAnbindung;/.test(kartenform), "die Kartenform sperrt den Haken bei Seeweg-Anbindung nicht");
assert.ok(
	/is_seaport: Boolean\(formElement\.elements\?\.namedItem\?\.\("is_seaport"\)\?\.checked\)/.test(kartenform),
	"die Kartenform muss is_seaport am ELEMENT lesen -- ein gesperrtes Feld fehlt in FormData",
);
assert.ok(!/formData\.get\("is_seaport"\)/.test(kartenform), "is_seaport aus FormData gelesen -- ein gesperrter Hafen kaeme als false an");

// --- 3. Server und Rueckweg ------------------------------------------------------------------
assert.ok(
	/if \(array_key_exists\('is_seaport', \$payload\)\) \{\s*\$properties\['is_seaport'\] = avesmapsReadBoolean\(\$payload\['is_seaport'\]\);/.test(server),
	"update_point schreibt is_seaport nicht (oder nicht per array_key_exists)",
);
assert.ok(
	/'is_seaport' => avesmapsReadBoolean\(\$payload\['is_seaport'\] \?\? false\)/.test(server),
	"create_point legt is_seaport nicht an -- ein neuer Ort startet ohne Feld",
);
assert.ok(
	/'is_seaport' => !empty\(\$properties\['is_seaport'\]\),\s*\/\/ Ortsart -- der Editor liest sie hier zurueck/.test(server),
	"die Punkt-Antwort traegt is_seaport nicht -- der Marker verloere den Wert nach dem Speichern",
);
assert.strictEqual((marker.match(/isSeaport: Boolean\(feature\.is_seaport\)/g) || []).length, 2, "beide Marker-Erzeuger muessen isSeaport setzen");
assert.ok(/is_seaport: Boolean\(properties\.is_seaport\)/.test(marker), "der Live-Abgleich verliert is_seaport");
assert.ok(/isSeaport: Boolean\(feature\.properties\.is_seaport\)/.test(kartendaten), "locationData traegt isSeaport nicht");

console.log("seehafen-editorformen: alle Faelle ok");
