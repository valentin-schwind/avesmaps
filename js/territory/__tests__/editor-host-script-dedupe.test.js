// Der Editor-Host laedt kein Skript nach, das die Seite schon hat.
//
// 💣 filter-menu.js stand zweimal im Dokument: einmal aus index.html mit dem Deploy-Stempel
// (js/ui/filter-menu.js?v=<hash>), einmal vom Editor-Host mit ?v=ASSET_VERSION. Zwei verschiedene
// Adressen -- und loadScriptOnce erkannte bis dahin NUR die eigenen Skripte (Marker
// data-avesmaps-editor-src). Die zweite Ausfuehrung brach mit "Identifier 'AVM_FILTER_ICON' has
// already been declared" ab; folgenlos, weil die erste alles definiert hatte, aber bei jedem
// Oeffnen des Editors ein roter Konsolenfehler.
//
// 🔴 Verglichen wird der PFAD, nicht die Adresse. Die Abfrage darf weder am Stempel scheitern
// (?v=... unterscheidet sich immer) noch an relativ gegen absolut geschrieben ("js/ui/..." aus
// index.html gegen "/js/ui/..." aus dem Host).
//
// ⚠️ Eigene, noch LADENDE Skripte duerfen davon nicht erfasst werden -- die haben ihren Marker und
// werden weiter oben abgewartet. Wer sie hier mitnaehme, loeste das Versprechen auf, bevor das
// Skript ausgefuehrt ist.
//
// Run: node js/territory/__tests__/editor-host-script-dedupe.test.js

"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const quelle = fs.readFileSync(path.join(__dirname, "..", "territory-editor-inline-host.js"), "utf8");
const context = {
	console,
	window: {},
	document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {}, scripts: [] },
	location: { search: "" },
	URL,
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(quelle, context);

const pruefe = context.avesmapsEditorHostScriptAlreadyPresent;
let fehler = 0;
function gleich(ist, soll, warum) {
	if (ist !== soll) { console.error(`FAIL: ${warum} (war ${ist}, erwartet ${soll})`); fehler += 1; }
}

const BASIS = "https://avesmaps.de/";
const fremd = (src) => ({ src, dataset: {} });
const eigenes = (src, marker) => ({ src, dataset: { avesmapsEditorSrc: marker } });

// ---- Der gemeldete Fall -------------------------------------------------------------------------
gleich(
	pruefe([fremd("https://avesmaps.de/js/ui/filter-menu.js?v=b1c2d3")], "/js/ui/filter-menu.js", BASIS),
	true,
	"index.html hat filter-menu.js schon geladen -- der Host laedt es nicht nochmal",
);

// Relativ geschrieben ist derselbe Pfad. (In index.html steht "js/ui/filter-menu.js" ohne Schraegstrich.)
gleich(
	pruefe([fremd("https://avesmaps.de/js/ui/filter-menu.js")], "js/ui/filter-menu.js", BASIS),
	true,
	"relativ gegen absolut -- derselbe Pfad",
);

// ---- Was NICHT als vorhanden gelten darf ---------------------------------------------------------
gleich(
	pruefe([fremd("https://avesmaps.de/js/ui/dialog-drag.js?v=aa11")], "/js/ui/filter-menu.js", BASIS),
	false,
	"ein anderes Skript ist kein Treffer",
);
gleich(pruefe([], "/js/ui/filter-menu.js", BASIS), false, "leeres Dokument -> nichts vorhanden");
gleich(
	pruefe([{ src: "", dataset: {} }], "/js/ui/filter-menu.js", BASIS),
	false,
	"ein Inline-Skript ohne src zaehlt nicht",
);

// 💣 Das eigene, moeglicherweise noch ladende Skript: NICHT hier abfangen. Dafuer gibt es den
// Marker-Zweig darueber, der auf das load-Ereignis wartet.
gleich(
	pruefe(
		[eigenes("https://avesmaps.de/js/ui/filter-menu.js?v=20260815a", "/js/ui/filter-menu.js")],
		"/js/ui/filter-menu.js",
		BASIS,
	),
	false,
	"ein eigenes Skript wird hier uebergangen -- es wird oben abgewartet",
);

// Gemischt: das fremde zaehlt, auch wenn ein eigenes danebensteht.
gleich(
	pruefe(
		[
			eigenes("https://avesmaps.de/js/ui/dialog-drag.js?v=20260815a", "/js/ui/dialog-drag.js"),
			fremd("https://avesmaps.de/js/ui/filter-menu.js?v=b1c2d3"),
		],
		"/js/ui/filter-menu.js",
		BASIS,
	),
	true,
	"das fremde Skript entscheidet",
);

// ---- Robustheit ---------------------------------------------------------------------------------
gleich(pruefe(null, "/js/ui/filter-menu.js", BASIS), false, "keine Skriptliste -> false");
gleich(pruefe([fremd("https://avesmaps.de/x.js")], "", BASIS), false, "ohne Ziel -> false");
gleich(
	pruefe([fremd("http://[kaputt")], "/js/ui/filter-menu.js", BASIS),
	false,
	"eine unlesbare Adresse wirft nicht, sie zaehlt nur nicht",
);

if (fehler > 0) { console.error(`${fehler} Zusicherung(en) rot.`); process.exit(1); }
console.log("editor-host-script-dedupe: alle Zusicherungen gruen.");
