// Jede Pane, die bootstrap.js EINSTELLT, muss dort auch ANGELEGT werden -- und (seit Fix-Runde 6,
// Befund 5) die Markierungs-Pane muss UEBER der Label-Pane liegen.
//
// 💣 DER FEHLER, DEN DER ERSTE TEIL FÄNGT (2026-08-03, live aufgetreten): `map.getPane(name)` legt
// nichts an -- es liefert `this._panes[name]`, also `undefined` für eine Pane, die nie durch
// `createPane` ging. Das darauffolgende `.style.zIndex = …` wirft dann einen TypeError, und weil
// bootstrap.js ein flaches Skript ohne try/catch ist, ist ALLES DARUNTER TOT: Zoom-Control,
// `setMaxBounds`, die Zoom-Handler -- und der Editor. Symptom beim Owner war nicht „die neue Ebene
// fehlt", sondern „das Editorpanel ist verschwunden", also etwas fünfzig Zeilen weiter unten, das
// mit der Ursache nichts zu tun hat.
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

// ---------------------------------------------------------------- DIE MARKIERUNG UEBER DEN LABELS -
// 🔴 Owner-Befund 15.08.2026 (fuenfter Befund, per Bildschirmabzug gemeldet): die gesetzte Markierung
// (setSharePin, map-features-share-pin.js) landete ohne eigene `pane`-Angabe in Leaflets Standard-
// `markerPane` (600) -- UNTER labelsPane (650) -- und verschwand halb hinter Kartenlabeln wie
// „AVENTURIEN". `sharePinPane` muss daher ueber `labelsPane` liegen.
//
// ⚠️ BEIDE Zahlen werden aus bootstrap.js GELESEN und gegeneinander gehalten, keine ist hier fest
// erwartet: ein Test, der nur "sharePinPane === 700" prueft, faellt nicht auf, wenn jemand
// labelsPane spaeter auf 750 anhebt und sharePinPane vergisst -- genau das Fehlerbild, das der
// Befund war, waere mit einem Quelltest ueber einen einzigen Wert unsichtbar geblieben.
const zIndexWerte = new Map(
	[...source.matchAll(/getPane\(\s*"([^"]+)"\s*\)\.style\.zIndex\s*=\s*(\d+)/g)]
		.map((m) => [m[1], Number(m[2])])
);
const labelsZIndex = zIndexWerte.get("labelsPane");
const sharePinZIndex = zIndexWerte.get("sharePinPane");
if (typeof labelsZIndex !== "number") {
	console.error('FAIL: "labelsPane" hat keinen lesbaren zIndex-Wert in bootstrap.js -- prueft der Test noch das Richtige?');
	failures += 1;
}
if (typeof sharePinZIndex !== "number") {
	console.error('FAIL: "sharePinPane" hat keinen lesbaren zIndex-Wert in bootstrap.js -- prueft der Test noch das Richtige?');
	failures += 1;
}
if (typeof labelsZIndex === "number" && typeof sharePinZIndex === "number" && sharePinZIndex <= labelsZIndex) {
	console.error(`FAIL: sharePinPane (${sharePinZIndex}) liegt nicht UEBER labelsPane (${labelsZIndex}) -- `
		+ "die Markierung verschwindet wieder halb hinter den Kartenlabeln.");
	failures += 1;
}

if (failures > 0) {
	console.error(`bootstrap-panes.test: ${failures} Fehlschlag/Fehlschlaege`);
	process.exit(1);
}
console.log(`bootstrap-panes.test: OK (${angelegt.size} angelegt, ${benutzt.size} eingestellt, `
	+ `sharePinPane ${sharePinZIndex} > labelsPane ${labelsZIndex})`);
