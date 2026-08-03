// Jede Pane, die bootstrap.js EINSTELLT, muss dort auch ANGELEGT werden.
//
// 💣 DER FEHLER, DEN DIESER TEST FÄNGT (2026-08-03, live aufgetreten): `map.getPane(name)` legt nichts
// an -- es liefert `this._panes[name]`, also `undefined` für eine Pane, die nie durch `createPane` ging.
// Das darauffolgende `.style.zIndex = …` wirft dann einen TypeError, und weil bootstrap.js ein flaches
// Skript ohne try/catch ist, ist ALLES DARUNTER TOT: Zoom-Control, `setMaxBounds`, die Zoom-Handler --
// und der Editor. Symptom beim Owner war nicht „die neue Ebene fehlt", sondern „das Editorpanel ist
// verschwunden", also etwas fünfzig Zeilen weiter unten, das mit der Ursache nichts zu tun hat.
//
// 🔴 Statisch geprüft, nicht im Browser: dafür braucht es weder Leaflet noch eine Karte, und genau
// deshalb greift es auch für die nächste Pane, die jemand hinzufügt. Die Datei wird als TEXT gelesen --
// bootstrap.js baut beim Laden eine echte Karte auf und ist nicht require-bar.
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "bootstrap.js"), "utf8");

const angelegt = new Set([...source.matchAll(/createPane\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
const benutzt = new Set([...source.matchAll(/getPane\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));

// Leaflets eigene Panes gibt es ohne createPane -- sie entstehen mit der Karte.
const VON_LEAFLET = new Set(["mapPane", "tilePane", "overlayPane", "shadowPane", "markerPane", "tooltipPane", "popupPane"]);

let failures = 0;
benutzt.forEach((name) => {
	if (VON_LEAFLET.has(name) || angelegt.has(name)) {
		return;
	}
	console.error(`FAIL: bootstrap.js stellt die Pane "${name}" ein, legt sie aber nie an. `
		+ "getPane() liefert dann undefined und die Zeile wirft -- alles danach in der Datei laeuft nicht mehr.");
	failures += 1;
});

// Gegenprobe, damit der Test nicht still leerlaeuft: die vier Landschaften-Panes MÜSSEN vorkommen.
// Ohne diese Zeile wuerde ein kaputtes Suchmuster oben als „alles in Ordnung" durchgehen.
["ecosystemPaneDerographisch", "ecosystemPaneVegetation", "ecosystemPaneTopographie", "ecosystemPaneKlima"]
	.forEach((name) => {
		if (!benutzt.has(name)) {
			console.error(`FAIL: die Pane "${name}" kommt in bootstrap.js gar nicht vor -- prueft der Test noch das Richtige?`);
			failures += 1;
		}
	});

if (failures > 0) {
	console.error(`bootstrap-panes.test: ${failures} Fehlschlag/Fehlschlaege`);
	process.exit(1);
}
console.log(`bootstrap-panes.test: OK (${angelegt.size} angelegt, ${benutzt.size} eingestellt)`);
