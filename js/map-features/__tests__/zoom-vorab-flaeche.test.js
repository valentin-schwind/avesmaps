const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DIE GEGENRECHNUNG -- die riskanteste Stelle des ganzen Vorhabens, und der Grund, warum der
// Vorgaengerversuch (ed1e2e93) zurueckgebaut wurde: sie war dort von Hand geschrieben und NIE
// gesehen worden („mein Browser liefert 0 Bilder/s").
//
// Das Problem: eine Beschriftungsflaeche wird im `zoomanim` schon fuer die ZIELSTUFE gezeichnet,
// die Karte steht aber noch auf der Quellstufe. Die Flaeche muss deshalb DORT starten, wo die
// kuenftige linke obere Ecke JETZT liegt, auf 1/Massstab geschrumpft -- und von da auf ihren Platz
// nach dem Zoom animieren. Sitzt das falsch, gleiten die Namen aus der falschen Richtung oder in
// falscher Groesse herein.
//
// ⭐ Deshalb steht sie hier als EINE Funktion mit einem Test, statt zweimal von Hand in den beiden
// Overlays. Dieselbe Lehre wie bei der Kurve: was zweimal dasteht, laeuft auseinander.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoom-vorab-flaeche.test.js

// ---- Ein Leaflet-Ersatz mit nachrechenbarer Projektion ----------------------------------------
// Weltmodell: project(latLng, z) = [lng, lat] * 2^z. Damit ist jede Erwartung von Hand pruefbar.
const punkt = (x, y) => ({
	x, y,
	subtract(p) { return punkt(x - p.x, y - p.y); },
	add(p) { return punkt(x + p.x, y + p.y); },
	round() { return punkt(Math.round(x), Math.round(y)); },
});
global.L = { point: (x, y) => punkt(x, y), latLng: (lat, lng) => ({ lat, lng }) };

const karte = {
	_zoom: 4,
	getZoom() { return this._zoom; },
	getZoomScale(ziel) { return Math.pow(2, ziel - this._zoom); },
	getSize() { return { x: 800, y: 600 }; },
	project(ll, z) { return punkt(ll.lng * Math.pow(2, z), ll.lat * Math.pow(2, z)); },
	unproject(p, z) { return { lat: p.y / Math.pow(2, z), lng: p.x / Math.pow(2, z) }; },
	latLngToLayerPoint(ll) { return this.project(ll, this._zoom); },
	_latLngToNewLayerPoint(ll, z) { return this.project(ll, z); },
};

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"), { filename: "zoom-uebergang.js" });

// ---- Die Zielprojektion: zeichnet fuer eine Stufe, auf der die Karte noch nicht steht ----------
{
	const zielCenter = { lat: 100, lng: 200 };
	const proj = avesmapsZoomZielProjektion(karte, 5, zielCenter);
	// Der Mittelpunkt muss auf die Fenstermitte fallen -- egal auf welcher Stufe die Karte steht.
	const mitte = proj(zielCenter);
	assert.strictEqual(mitte.x, 400, "Das Zielzentrum liegt nicht in der Fenstermitte (x).");
	assert.strictEqual(mitte.y, 300, "Das Zielzentrum liegt nicht in der Fenstermitte (y).");
	// Ein Punkt eine Welteinheit oestlich liegt bei Zoom 5 um 2^5 = 32 px weiter rechts.
	const oestlich = proj({ lat: 100, lng: 201 });
	assert.strictEqual(oestlich.x - mitte.x, 32,
		"Die Zielprojektion rechnet nicht mit der ZIELstufe (erwartet 2^5 = 32 px je Welteinheit).");
	// 🔴 Und sie darf sich NICHT aendern, wenn die Karte inzwischen weiterspringt: sie ist fuer die
	// Zielstufe gebaut, nicht fuer den aktuellen Zustand.
	karte._zoom = 5;
	assert.strictEqual(avesmapsZoomZielProjektion(karte, 5, zielCenter)(zielCenter).x, 400);
	karte._zoom = 4;
}

// ---- Die Gegenrechnung -------------------------------------------------------------------------
{
	const zielCenter = { lat: 100, lng: 200 };
	const g = avesmapsZoomVorabFlaeche(karte, 5, zielCenter);

	// Die kuenftige linke obere Ecke: Zielzentrum minus halbes Fenster, in ZIEL-Weltkoordinaten.
	//   project(center, 5) = (200*32, 100*32) = (6400, 3200); minus (400, 300) = (6000, 2900)
	//   unproject bei Zoom 5 -> lng 187.5, lat 90.625
	assert.ok(Math.abs(g.zielEcke.lng - 187.5) < 1e-9 && Math.abs(g.zielEcke.lat - 90.625) < 1e-9,
		"Die kuenftige Ecke ist falsch gerechnet: " + JSON.stringify(g.zielEcke));

	// START: wo diese Ecke JETZT liegt (Quellstufe 4) -> lng*16, lat*16 = (3000, 1450)
	assert.strictEqual(g.start.x, 3000, "Startversatz x falsch.");
	assert.strictEqual(g.start.y, 1450, "Startversatz y falsch.");
	// ENDE: wo sie nach dem Zoom liegt (Zielstufe 5) -> (6000, 2900)
	assert.strictEqual(g.ende.x, 6000, "Endversatz x falsch.");
	assert.strictEqual(g.ende.y, 2900, "Endversatz y falsch.");

	// 🔴 DER KERN: das Bild ist fuer die Zielstufe gezeichnet, also muss es bei 1/Massstab starten
	// und auf 1 wachsen. Ohne das stuenden die neuen Namen 250 ms lang in falscher Groesse.
	assert.strictEqual(g.massstab, 2, "Massstab beim Hineinzoomen ist nicht 2.");
	assert.strictEqual(g.startMassstab, 0.5, "Startmassstab ist nicht 1/Massstab.");

	// 💣 DIE PROBE, DIE EINEN VORZEICHENFEHLER FAENGT: der sichtbare Ort eines Weltpunkts muss zu
	// BEIDEN Zeitpunkten derselbe sein wie bei der normalen Projektion.
	// Am Anfang:  start + zielProjektion(p) * startMassstab  ==  Lage bei Quellzoom
	// Am Ende:    ende  + zielProjektion(p) * 1              ==  Lage bei Zielzoom
	const proj = avesmapsZoomZielProjektion(karte, 5, zielCenter);
	for (const p of [{ lat: 100, lng: 200 }, { lat: 90.625, lng: 187.5 }, { lat: 120, lng: 230 }]) {
		const gezeichnet = proj(p);
		const amAnfang = { x: g.start.x + gezeichnet.x * g.startMassstab, y: g.start.y + gezeichnet.y * g.startMassstab };
		const quelle = karte.latLngToLayerPoint(p);
		assert.ok(Math.abs(amAnfang.x - quelle.x) < 1e-6 && Math.abs(amAnfang.y - quelle.y) < 1e-6,
			"💣 Am ANFANG sitzt der Punkt " + JSON.stringify(p) + " bei " + JSON.stringify(amAnfang)
			+ " statt bei " + JSON.stringify({ x: quelle.x, y: quelle.y })
			+ " -- die Namen glitten aus der falschen Richtung herein.");
		const amEnde = { x: g.ende.x + gezeichnet.x, y: g.ende.y + gezeichnet.y };
		const ziel = karte._latLngToNewLayerPoint(p, 5);
		assert.ok(Math.abs(amEnde.x - ziel.x) < 1e-6 && Math.abs(amEnde.y - ziel.y) < 1e-6,
			"💣 Am ENDE sitzt der Punkt " + JSON.stringify(p) + " falsch.");
	}
}

// ---- Herauszoomen: derselbe Vertrag, Massstab 0,5 ----------------------------------------------
{
	const zielCenter = { lat: 100, lng: 200 };
	const g = avesmapsZoomVorabFlaeche(karte, 3, zielCenter);
	assert.strictEqual(g.massstab, 0.5, "Massstab beim Herauszoomen ist nicht 0,5.");
	assert.strictEqual(g.startMassstab, 2, "Startmassstab beim Herauszoomen ist nicht 2.");
	const proj = avesmapsZoomZielProjektion(karte, 3, zielCenter);
	const p = { lat: 110, lng: 210 };
	const gezeichnet = proj(p);
	const amAnfang = { x: g.start.x + gezeichnet.x * g.startMassstab, y: g.start.y + gezeichnet.y * g.startMassstab };
	const quelle = karte.latLngToLayerPoint(p);
	assert.ok(Math.abs(amAnfang.x - quelle.x) < 1e-6 && Math.abs(amAnfang.y - quelle.y) < 1e-6,
		"💣 Beim Herauszoomen sitzt der Anfang falsch.");
}

// ---- Schutzwerte -------------------------------------------------------------------------------
// 🔴 Fehlt Leaflets interne Methode (kuenftige Version), wird NICHT geraten, sondern null geliefert
// -- der Aufrufer faellt dann auf das Verhalten ohne Vorabzeichnen zurueck, statt falsch zu setzen.
assert.strictEqual(avesmapsZoomVorabFlaeche({ getSize: () => ({ x: 1, y: 1 }) }, 5, { lat: 0, lng: 0 }), null);
assert.strictEqual(avesmapsZoomVorabFlaeche(karte, NaN, { lat: 0, lng: 0 }), null);
assert.strictEqual(avesmapsZoomVorabFlaeche(karte, 5, null), null);

console.log("zoom-vorab-flaeche.test.js: alle Zusicherungen erfuellt");
