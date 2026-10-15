const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Run: node js/map-features/__tests__/kreuzung-alt-einrasten.test.js
//
// Alt+Ziehen einer Kreuzung rastet an der Ecke einer SICHTBAREN Landschaftsfläche ein (Discord
// 2026-10-15: „Mündungen exakt mit dem Meer oder Seen verbinden"). Der Test FÄHRT den Ablauf --
// scharfstellen, Taste, Ziehen, Loslassen, Speichern -- mit den ECHTEN Dateien:
//   * map-features-location-editing.js  (der Trichter saveMovedLocationMarker)
//   * map-features-location-snap-edit.js (die Alt-Taste)
//   * map-features-ecosystem-edit.js     (die EINE Schnapp-Regel: Reichweite, Ecke vor Kante, Ring)
//   * map-features-location-detach-edit.js (Strg -- muss unabhängig bleiben)
// Nachgebaut wird nur, was ein Browser liefert: Leaflet, die Karte, das Dokument, der Server.

const repoRoot = path.join(__dirname, "../../..");
const ladeBrowserSkript = (relativerPfad) => {
	const absolut = path.join(repoRoot, relativerPfad);
	vm.runInThisContext(fs.readFileSync(absolut, "utf8"), { filename: absolut });
};

// --- Dokument und Fenster: die Zuhörer werden gesammelt, damit der Test Tasten DRÜCKEN kann -----
const dokumentZuhoerer = {};
const fensterZuhoerer = {};
// ⚠️ `globalThis`, kein eigenes Objekt: die Module hängen ihre Schnittstelle an `window.…` und der
// Trichter ruft sie als BLANKE Namen. Im Browser ist das dasselbe; gegen ein leeres Objekt sähe der
// Trichter das Einrasten nie, und der Test prüfte einen Zusammenhang, den er gar nicht herstellt.
global.window = globalThis;
globalThis.location = { search: "?edit=1" };
globalThis.addEventListener = (name, fn) => { (fensterZuhoerer[name] ||= []).push(fn); };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener: (name, fn) => { (dokumentZuhoerer[name] ||= []).push(fn); },
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };
global.getComputedStyle = () => ({ getPropertyValue: () => "#123456" });

const taste = (art, key) => {
	const ereignis = { key, verhindert: false, preventDefault() { this.verhindert = true; } };
	(dokumentZuhoerer[art] || []).forEach((fn) => fn(ereignis));
	return ereignis;
};
const fensterVerliertFokus = () => (fensterZuhoerer.blur || []).forEach((fn) => fn({}));

// --- Leaflet und Karte: 4 Bildschirmpixel je Karteneinheit, also 10 px Reichweite = 2,5 Einheiten ----
const latLng = (a, b) => {
	if (Array.isArray(a)) return { lat: Number(a[0]), lng: Number(a[1]) };
	if (a && typeof a === "object") return { lat: Number(a.lat), lng: Number(a.lng) };
	return { lat: Number(a), lng: Number(b) };
};
global.L = {
	latLng,
	point: (x, y) => ({ x, y }),
	circleMarker: (ll, optionen) => ({
		ll: latLng(ll),
		optionen,
		addTo(karte) { karte.ringe.push(this); return this; },
	}),
};
const PIXEL_JE_EINHEIT = 4;
global.map = {
	ringe: [],
	latLngToContainerPoint: (ll) => ({ x: ll.lng * PIXEL_JE_EINHEIT, y: -ll.lat * PIXEL_JE_EINHEIT }),
	containerPointToLatLng: (p) => ({ lat: -p.y / PIXEL_JE_EINHEIT, lng: p.x / PIXEL_JE_EINHEIT }),
	hasLayer(layer) { return this.ringe.includes(layer); },
	removeLayer(layer) { this.ringe = this.ringe.filter((r) => r !== layer); },
	getZoom: () => 5,
};

// --- der Server und die übrigen Nachbarn des Trichters ----------------------------------------
const anfragen = [];
global.submitMapFeatureEdit = async (rumpf) => {
	anfragen.push(rumpf);
	return { feature: { revision: 2 } };
};
const meldungen = [];
global.showFeedbackToast = (text, ton) => { meldungen.push({ text, ton }); };
global.isWithinMapBounds = () => true;
global.updateRevisionFromEditResponse = () => {};
global.applyMapFeatureEditResult = () => {};
global.syncLocationNameLabelVisibility = () => {};
global.refreshPlannerAfterFeatureChange = () => {};
global.acquireFeatureSoftLock = async () => {};
global.releaseFeatureSoftLock = async () => {};
global.escapeHtml = (s) => String(s);
global.getPathDisplayName = () => "Fluss";
global.startPathGeometryEdit = () => {};

// Ansicht und sichtbare Ebenen -- gehören der Ebenenwahl, die hier nicht geladen wird.
let ansichtLandschaften = true;
let sichtbareEbenen = new Set(["topographie"]);
global.isEcosystemLayerModeActive = () => ansichtLandschaften;
global.isEcosystemKindVisible = (art) => sichtbareEbenen.has(art);

ladeBrowserSkript("js/map-features/map-features-line-catmull.js");
ladeBrowserSkript("js/config.js");
ladeBrowserSkript("js/app/runtime-state.js");
ladeBrowserSkript("js/map-features/map-features-path-domain.js");
ladeBrowserSkript("js/map-features/map-features-location-editing.js");
ladeBrowserSkript("js/map-features/map-features-ecosystem-geometry.js");
ladeBrowserSkript("js/map-features/map-features-ecosystem-edit.js");
ladeBrowserSkript("js/map-features/map-features-location-detach-edit.js");
ladeBrowserSkript("js/map-features/map-features-location-snap-edit.js");

assert.strictEqual(IS_EDIT_MODE, true, "Vorbedingung: Bearbeiten-Modus");

// --- die Welt: ein Meer, eine Flussmündung, ein ferner Wald und ein zweiter Fluss ---------------
// GeoJSON [x, y]; Leaflet [lat, lng] = [y, x].
const flaeche = (art, ring) => ({ _ecosystemArea: { kind: art, geometry: { type: "Polygon", coordinates: [ring] } } });
ecosystemLayers.set("meer", flaeche("topographie", [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]));
ecosystemLayers.set("wald", flaeche("vegetation", [[400, 400], [450, 400], [450, 450], [400, 450], [400, 400]]));

const MUENDUNG = [99, 98]; // [lat, lng] -- das Flussende, knapp neben der Meeresecke (100, 100)
const fluss = { geometry: { coordinates: [[50, 50], [98, 99]] }, properties: { public_id: "fluss-1", feature_subtype: "Flussweg" } };
// Ein zweiter Fluss weit weg vom Meer: ein Schnappziel für eine Flächenecke, für eine Kreuzung NICHT.
const andererFluss = { geometry: { coordinates: [[300, 300], [300, 340]] }, properties: { public_id: "fluss-2", feature_subtype: "Flussweg" } };

function neueWelt() {
	pathData = [
		{ ...fluss, geometry: { coordinates: fluss.geometry.coordinates.map((p) => [...p]) } },
		andererFluss,
	];
	anfragen.length = 0;
	meldungen.length = 0;
	map.ringe = [];
	ansichtLandschaften = true;
	sichtbareEbenen = new Set(["topographie"]);
}

function machMarker(ll) {
	const handler = {};
	const marker = {
		_latlng: latLng(ll),
		getLatLng() { return this._latlng; },
		setLatLng(neu) { this._latlng = latLng(neu); return this; },
		on(name, fn) { (handler[name] ||= []).push(fn); return this; },
		fire(name, daten = {}) { (handler[name] || []).forEach((fn) => fn(daten)); },
		dragging: { enable() {}, disable() {} },
		closePopup() {},
		getElement: () => null,
	};
	return marker;
}

function machKreuzung() {
	const location = { publicId: "kreuzung-1", name: "Kreuzung-1", coordinates: [...MUENDUNG], locationType: "crossing" };
	return { marker: machMarker(MUENDUNG), name: location.name, publicId: location.publicId, locationType: "crossing", location };
}

// Ein Zug, wie ihn Leaflet feuert, und dann das Loslassen, wie es BEIDE dragend-Handler tun.
async function zieheUndLasseLos(eintrag, ziel, { altAmZeiger = false } = {}) {
	eintrag.marker.fire("dragstart");
	eintrag.marker.setLatLng(ziel);
	eintrag.marker.fire("drag", { originalEvent: { altKey: altAmZeiger } });
	const ringBeimLoslassen = map.ringe[map.ringe.length - 1] || null;
	const gespeichert = await saveMovedLocationMarker(eintrag, eintrag.marker.getLatLng());
	setLocationEditActive(eintrag, false);
	return { gespeichert, ringBeimLoslassen };
}

const punktAnfrage = () => anfragen.find((a) => a.action === "move_point");
const wegAnfrage = () => anfragen.find((a) => a.action === "update_path_geometry");

(async () => {
	// ---- 1. Der Fall aus Discord: Alt + Ziehen setzt die Mündung GENAU auf die Meeresecke ----------
	neueWelt();
	let kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	assert.match(meldungen[0].text, /mit Alt rastet er an Landschaftsflächen ein/, "der Hinweis beim Scharfstellen nennt Alt");
	let ergebnis = await zieheUndLasseLos(kreuzung, [99.4, 99.2], { altAmZeiger: true });
	assert.strictEqual(ergebnis.gespeichert, true);
	assert.deepStrictEqual(ergebnis.ringBeimLoslassen.ll, { lat: 100, lng: 100 }, "der Ring zeigt VOR dem Loslassen auf die Ecke");
	assert.strictEqual(ergebnis.ringBeimLoslassen.optionen.radius, 11, "Ecke: der feste, große Ring");
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [100, 100], "gespeichert wird die Ecke, nicht die Mausposition");
	assert.deepStrictEqual(kreuzung.marker.getLatLng(), { lat: 100, lng: 100 }, "der Marker steht auf der Ecke");
	// 🔴 Der eigentliche Zweck: das Flussende geht MIT -- sonst wäre die Mündung wieder nicht am Meer.
	const flussNeu = wegAnfrage();
	assert.ok(flussNeu, "der angeschlossene Fluss wird mitverschoben");
	assert.deepStrictEqual(flussNeu.coordinates[flussNeu.coordinates.length - 1], [100, 100], "das Flussende liegt jetzt auf der Meeresecke");
	assert.match(meldungen[meldungen.length - 1].text, /^Kreuzung-1 eingerastet, gespeichert und 1 angeschlossener Weg mitverschoben\.$/);
	assert.strictEqual(map.ringe.length, 0, "nach dem Loslassen ist der Ring weg");

	// ---- 2. Ohne Alt rastet nichts ein ----------------------------------------------------------------
	neueWelt();
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	ergebnis = await zieheUndLasseLos(kreuzung, [99.4, 99.2]);
	assert.strictEqual(ergebnis.ringBeimLoslassen, null, "ohne Alt kein Ring");
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "ohne Alt: die freie Position");
	assert.doesNotMatch(meldungen[meldungen.length - 1].text, /eingerastet/);

	// ---- 3. Kantenpunkt, wenn keine Ecke in Reichweite liegt -----------------------------------------
	neueWelt();
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	ergebnis = await zieheUndLasseLos(kreuzung, [98.5, 150], { altAmZeiger: true });
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [100, 150], "auf die Umrisslinie projiziert");
	assert.strictEqual(ergebnis.ringBeimLoslassen.optionen.radius, 8, "Kante: der kleinere Ring");
	assert.strictEqual(ergebnis.ringBeimLoslassen.optionen.dashArray, "4 4", "Kante: gestrichelt");

	// ---- 4. Ein Fluss ist für eine KREUZUNG kein Ziel -------------------------------------------------
	// Für eine Flächenecke schon (Gegenprobe gleich darunter) -- das ist der Schalter mitFluessen.
	neueWelt();
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	ergebnis = await zieheUndLasseLos(kreuzung, [320, 301], { altAmZeiger: true });
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [320, 301], "neben einem Fluss rastet eine Kreuzung NICHT ein");
	assert.strictEqual(ergebnis.ringBeimLoslassen?.ll ?? null, null, "und es steht kein Ring");
	const eckeAmFluss = ecosystemEditSnapTarget(latLng(320, 301), "");
	assert.deepStrictEqual(eckeAmFluss && eckeAmFluss.latLng, { lat: 320, lng: 300 },
		"Gegenprobe: eine FLÄCHENECKE rastet dort weiterhin am Fluss ein (Vorgabe mitFluessen = true)");

	// ---- 5. Nur, was man SIEHT -----------------------------------------------------------------------
	// a) eine andere Ansicht: der Flächenspeicher ist voll, die Flächen aber unsichtbar.
	neueWelt();
	ansichtLandschaften = false;
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	meldungen.length = 0;
	kreuzung.marker.fire("dragstart");
	kreuzung.marker.setLatLng([99.4, 99.2]);
	kreuzung.marker.fire("drag", { originalEvent: { altKey: true } });
	kreuzung.marker.fire("drag", { originalEvent: { altKey: true } });
	assert.strictEqual(map.ringe.length, 0, "außerhalb der Landschaften kein Ring");
	const hinweise = meldungen.filter((m) => /nur in der Ansicht Landschaften/.test(m.text));
	assert.strictEqual(hinweise.length, 1, "Alt läuft nicht wortlos ins Leere -- und der Hinweis kommt EINMAL je Zug");
	await saveMovedLocationMarker(kreuzung, kreuzung.marker.getLatLng());
	setLocationEditActive(kreuzung, false);
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "und gespeichert wird die freie Position");

	// b) Landschaften offen, aber die Ebene mit dem Meer ist ausgeblendet.
	neueWelt();
	sichtbareEbenen = new Set(["vegetation"]);
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	await zieheUndLasseLos(kreuzung, [99.4, 99.2], { altAmZeiger: true });
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "eine ausgeblendete Ebene ist kein Ziel");
	assert.ok(!meldungen.some((m) => /nur in der Ansicht Landschaften/.test(m.text)),
		"es SIND Flächen sichtbar (der Wald) -- nur keine in Reichweite, also kein Hinweis");

	// ---- 6. Die Taste: entschieden wird beim Loslassen, und der Browser behält sein Alt ---------------
	neueWelt();
	const ohneMarker = taste("keydown", "Alt");
	assert.strictEqual(ohneMarker.verhindert, false, "ohne scharfgestellten Marker gehört Alt dem Browser");
	taste("keyup", "Alt");

	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	kreuzung.marker.fire("dragstart");
	kreuzung.marker.setLatLng([99.4, 99.2]);
	kreuzung.marker.fire("drag", { originalEvent: { altKey: false } });
	assert.strictEqual(map.ringe.length, 0);
	const runter = taste("keydown", "Alt");
	assert.strictEqual(runter.verhindert, true, "mit scharfgestelltem Marker schluckt Alt das Browsermenü");
	assert.strictEqual(map.ringe.length, 1, "der Ring kommt mit dem Drücken, nicht erst mit der nächsten Mausbewegung");
	const hoch = taste("keyup", "Alt");
	assert.strictEqual(hoch.verhindert, true, "und das keyup, dessen keydown wir geschluckt haben");
	assert.strictEqual(map.ringe.length, 0, "Alt losgelassen: der Ring geht");
	await saveMovedLocationMarker(kreuzung, kreuzung.marker.getLatLng());
	setLocationEditActive(kreuzung, false);
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "Alt vor der Maus losgelassen: freie Position");

	// Ein Fensterwechsel verschluckt das keyup -- Alt darf danach nicht hängen bleiben.
	neueWelt();
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	taste("keydown", "Alt");
	fensterVerliertFokus();
	kreuzung.marker.fire("dragstart");
	kreuzung.marker.setLatLng([99.4, 99.2]);
	await saveMovedLocationMarker(kreuzung, kreuzung.marker.getLatLng());
	setLocationEditActive(kreuzung, false);
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "nach dem Fokusverlust rastet nichts ungefragt ein");

	// ---- 7. Der Weg über eine Änderungsmeldung zieht nichts -- dort rastet nichts ein ----------------
	neueWelt();
	kreuzung = machKreuzung();
	taste("keydown", "Alt");
	await saveMovedLocationMarker(kreuzung, latLng(99.4, 99.2));
	taste("keyup", "Alt");
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [99.4, 99.2], "ohne Ziehen kein Einrasten, auch bei gedrücktem Alt");

	// ---- 8. Strg und Alt sind unabhängig: einrasten UND Wege liegen lassen -----------------------------
	neueWelt();
	kreuzung = machKreuzung();
	setLocationEditActive(kreuzung, true);
	taste("keydown", "Control");
	ergebnis = await zieheUndLasseLos(kreuzung, [99.4, 99.2], { altAmZeiger: true });
	taste("keyup", "Control");
	assert.deepStrictEqual([punktAnfrage().lat, punktAnfrage().lng], [100, 100], "Strg+Alt: eingerastet");
	assert.strictEqual(wegAnfrage(), undefined, "Strg+Alt: der Fluss bleibt liegen");
	assert.match(meldungen[meldungen.length - 1].text, /^Kreuzung-1 eingerastet — 1 Wegende blieb liegen \(Strg\)\.$/);

	console.log("kreuzung-alt-einrasten: alle Zusicherungen grün");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
