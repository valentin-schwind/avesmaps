// Die Größe einer Fläche zum Speichern (Owner 09.10.2026: „kannst du den leuten anzeigen, wenn sie
// zuviel punkte gemalt und KB produziert haben" -- „bau 1-3, prüfhaken auch").
//
//   1. Der Riegel im Schreibkanal: zu groß geht gar nicht erst hinaus.
//   2. Der Streifen: ab 75 % gelb, darüber rot, mit „Fläche vereinfachen".
//   3. Die Leiste im Fenster „Fläche vereinfachen".
//   4. Der Prüfhaken „Zu große Flächen".
//
// ⭐ AUSGEFÜHRT, NICHT GELESEN: jede der vier Stellen läuft hier in einem vm-Kontext mit der echten
// Datei, und gemessen wird, was sie tut.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-groesse.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8");
let pruefungen = 0;
const pruefe = (bedingung, text) => { pruefungen++; assert.ok(bedingung, text); };

const G = require("../ecosystem-groesse.js");
const GRENZE = G.AVESMAPS_SPEICHER_GRENZE_BYTES;

// Eine Fläche mit n Punkten (Ring geschlossen) -- Kreis um (500, 500), drei Nachkommastellen wie gespeichert.
const flaeche = (n, r = 100) => {
	const ring = [];
	for (let i = 0; i < n; i += 1) {
		const t = (2 * Math.PI * i) / n;
		ring.push([+(500 + r * Math.cos(t)).toFixed(3), +(500 + r * Math.sin(t)).toFixed(3)]);
	}
	ring.push(ring[0].slice());
	return { type: "Polygon", coordinates: [ring] };
};
// Eine Fläche, deren geschätzte Grösse knapp bei `zielBytes` liegt.
const flaecheMitBytes = (zielBytes) => {
	let n = 50;
	while (G.avesmapsEcosystemFlaechenGroesse(flaeche(n)).bytes < zielBytes) {
		n += 50;
	}
	return flaeche(n);
};

// ---- A. Die Regel ---------------------------------------------------------------------------------
pruefe(GRENZE === 131072, "die Grenze ist die des Webservers: 128 KiB (live gemessen 09.10.2026)");
pruefe(G.avesmapsEcosystemGroesseStufe(GRENZE * 0.74) === "ok", "unter 75 % ist alles gut");
pruefe(G.avesmapsEcosystemGroesseStufe(GRENZE * 0.75) === "gross", "ab 75 % warnt der Editor");
pruefe(G.avesmapsEcosystemGroesseStufe(GRENZE) === "gross", "genau auf der Grenze wird noch gespeichert");
pruefe(G.avesmapsEcosystemGroesseStufe(GRENZE + 1) === "zu_gross", "ein Byte darüber nicht mehr");

const multi = { type: "MultiPolygon", coordinates: [flaeche(10).coordinates, flaeche(20).coordinates] };
pruefe(G.avesmapsEcosystemPunkte(flaeche(10)) === 10 && G.avesmapsEcosystemPunkte(multi) === 30,
	"🔴 Punkte zählen OHNE den Schlusspunkt je Ring -- dieselbe Zählung wie im Fenster „Fläche vereinfachen“");

pruefe(G.avesmapsEcosystemKb(GRENZE + 100) === 129 && G.avesmapsEcosystemKb(GRENZE - 100) === 127,
	"🪤 gerundet wird in Richtung der Stufe: knapp darüber nie „128 von 128“, knapp darunter nie „129“");
pruefe(G.avesmapsEcosystemGroesseText(9963, 182000) === "9.963 Punkte · 178 von 128 KB",
	"der Text: deutsche Tausenderpunkte, Punkte und KB -- " + G.avesmapsEcosystemGroesseText(9963, 182000));
pruefe(G.avesmapsUtf8Bytes("Ä") === 2 && G.avesmapsUtf8Bytes("a") === 1, "gezählt wird in UTF-8-Bytes, nicht in Zeichen");

// ---- B. Der Riegel im Schreibkanal ----------------------------------------------------------------
function schreibkanal() {
	const gesendet = [];
	const gemeldet = [];
	const k = {
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise, Map, Set, Error, TextEncoder, URL,
		ECOSYSTEM_EDIT_API_URL: "api/edit/map/ecosystem.php",
		location: { href: "https://avesmaps.de/", origin: "https://avesmaps.de" },
		readJsonResponse: async (antwort) => antwort.json(),
		apiErrorMessage: (d, f) => f,
		avesmapsEcosystemGroesseMelden: (m) => gemeldet.push(m),
		ecosystemLayers: new Map([["f-1", { _ecosystemArea: { public_id: "f-1", region_name: "Windhagberge" } }]]),
	};
	k.fetch = async (url, opt) => {
		gesendet.push({ url, opt });
		return { ok: true, status: 200, json: async () => ({ ok: true, revision: 7, area: { public_id: "neu-1" } }) };
	};
	k.window = k;
	k.globalThis = k;
	vm.createContext(k);
	vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
	vm.runInContext(lies("js/app/json-umschlag.js"), k);   // umhüllt k.fetch -- genau wie auf der Seite
	vm.runInContext(lies("js/map-features/map-features-ecosystem-region-store.js"), k);
	return { k, gesendet, gemeldet };
}

(async () => {
	{
		const { k, gesendet, gemeldet } = schreibkanal();
		const zuGross = flaecheMitBytes(GRENZE + 4000);
		let fehler = null;
		try {
			await k.postEcosystemEdit("update_area_geometry", { public_id: "f-1", expected_revision: 3, geometry_geojson: zuGross });
		} catch (e) {
			fehler = e;
		}
		pruefe(fehler && fehler.code === "zu_gross" && fehler.status === 413,
			"💣 eine zu große Fläche wird abgelehnt -- mit eigenem Code, damit kein Aufrufer sie für einen Konflikt hält");
		pruefe(gesendet.length === 0, "🔴 und sie geht GAR NICHT erst hinaus -- der Pinsel schickte sonst nach jedem Strich 130 KB");
		pruefe(/Zu groß zum Speichern: [\d.]+ Punkte · \d+ von 128 KB\. Gespeichert wurde nichts/.test(fehler.message),
			"die Meldung nennt Punkte, KB und dass nichts gespeichert wurde: " + fehler.message);
		pruefe(gemeldet.length === 1 && gemeldet[0].publicId === "f-1" && gemeldet[0].name === "Windhagberge"
			&& gemeldet[0].punkte === G.avesmapsEcosystemPunkte(zuGross) && gemeldet[0].bytes > GRENZE,
			"der Streifen bekommt Fläche, Name, Punkte und die WIRKLICH gesendeten Bytes");
	}
	{
		const { k, gesendet, gemeldet } = schreibkanal();
		const nah = flaecheMitBytes(GRENZE * 0.8);
		await k.postEcosystemEdit("update_area_geometry", { public_id: "f-1", expected_revision: 3, geometry_geojson: nah });
		pruefe(gesendet.length === 1, "eine Fläche bei 80 % wird gespeichert");
		pruefe(JSON.parse(gesendet[0].opt.body).avesmaps_umschlag, "und zwar im Umschlag -- sie trägt weit mehr als 1000 Werte");
		const bytesAufDerLeitung = G.avesmapsUtf8Bytes(gesendet[0].opt.body);
		pruefe(gemeldet.length === 1 && gemeldet[0].bytes === bytesAufDerLeitung,
			"💣 gemessen wird der Rumpf, wie er WIRKLICH hinausgeht (verpackt), nicht eine Schätzung");
		pruefe(G.avesmapsEcosystemGroesseStufe(gemeldet[0].bytes) === "gross", "der Streifen meldet „groß“ nach dem Speichern");
	}
	{
		const { k, gemeldet } = schreibkanal();
		await k.postEcosystemEdit("create_area", { region_public_id: "r-1", geometry_geojson: flaeche(20) });
		pruefe(gemeldet.length === 1 && gemeldet[0].publicId === "neu-1",
			"eine NEUE Fläche meldet sich mit der Kennung, die der Server ihr gegeben hat -- so kann der Streifen „Vereinfachen“ anbieten");
	}
	{
		const { k, gesendet, gemeldet } = schreibkanal();
		await k.postEcosystemEdit("list_regions", { kind: "topographie" });
		pruefe(gesendet.length === 1 && gemeldet.length === 0, "eine Anfrage ohne Geometrie meldet nichts an den Streifen");
	}

	// ---- C. Der Streifen ----------------------------------------------------------------------------
	function streifen() {
		const knoten = {};
		const neu = (id) => {
			const zuhoerer = {};
			knoten[id] = { id, hidden: true, dataset: {}, textContent: "", addEventListener: (t, f) => { zuhoerer[t] = f; }, klick: () => zuhoerer.click && zuhoerer.click() };
		};
		["ecosystem-groesse-note", "ecosystem-groesse-text", "ecosystem-groesse-vereinfachen", "ecosystem-groesse-schliessen"].forEach(neu);
		const geoeffnet = [];
		const k = {
			console, JSON, Math, Number, String, Boolean, Array, Object, Map, TextEncoder,
			document: { getElementById: (id) => knoten[id] || null },
			ecosystemLayers: new Map([["f-1", {}]]),
			AvesmapsEcosystemSimplify: { open: (id) => geoeffnet.push(id) },
		};
		k.window = k;
		vm.createContext(k);
		vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
		vm.runInContext(lies("js/map-features/map-features-ecosystem-groesse-hinweis.js"), k);
		return { k, knoten, geoeffnet };
	}
	{
		const { k, knoten, geoeffnet } = streifen();
		const note = knoten["ecosystem-groesse-note"];
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "Windhagberge", punkte: 5400, bytes: GRENZE * 0.8 });
		pruefe(!note.hidden && note.dataset.stufe === "gross", "ab 75 % steht der Streifen, gelb");
		pruefe(/„Windhagberge“ wird groß: 5\.400 Punkte · \d+ von 128 KB – bald vereinfachen\./.test(knoten["ecosystem-groesse-text"].textContent),
			"der Satz: " + knoten["ecosystem-groesse-text"].textContent);
		pruefe(!knoten["ecosystem-groesse-vereinfachen"].hidden, "„Fläche vereinfachen“ steht da, weil die Fläche geladen ist");
		knoten["ecosystem-groesse-vereinfachen"].klick();
		pruefe(geoeffnet[0] === "f-1", "der Knopf öffnet das Fenster „Fläche vereinfachen“ für GENAU diese Fläche");

		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "Windhagberge", punkte: 9000, bytes: GRENZE + 50000 });
		pruefe(note.dataset.stufe === "zu_gross" && /ist zu groß zum Speichern: .* Gespeichert wurde nichts\./.test(knoten["ecosystem-groesse-text"].textContent),
			"darüber wird er rot und sagt, dass nichts gespeichert wurde");

		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "Windhagberge", punkte: 900, bytes: 30000 });
		pruefe(note.hidden, "nach dem Vereinfachen (wieder unter 75 %) geht er von selbst weg");

		k.avesmapsEcosystemGroesseMelden({ publicId: "andere", name: "Meer", punkte: 1, bytes: 30000 });
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "Windhagberge", punkte: 5400, bytes: GRENZE * 0.8 });
		k.avesmapsEcosystemGroesseMelden({ publicId: "andere", name: "Meer", punkte: 1, bytes: 30000 });
		pruefe(!note.hidden, "eine KLEINE andere Fläche nimmt den Hinweis über diese nicht weg");
	}
	{
		const { k, knoten } = streifen();
		const note = knoten["ecosystem-groesse-note"];
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 5000, bytes: 100000 });
		knoten["ecosystem-groesse-schliessen"].klick();
		pruefe(note.hidden, "× schliesst ihn");
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 5010, bytes: 100500 });
		pruefe(note.hidden, "💣 und der nächste Pinselstrich holt ihn NICHT sofort zurück");
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 5500, bytes: 100000 + 9000 });
		pruefe(!note.hidden, "erst wenn die Fläche um mehr als 8 KB gewachsen ist");
		// Knapp unter der Grenze weggeklickt, dann 2 KB darüber: weniger als 8 KB gewachsen, aber die
		// Stufe ist gekippt -- und „nicht gespeichert“ darf nie hinter einem weggeklickten „groß“ verschwinden.
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 8000, bytes: GRENZE - 2000 });
		knoten["ecosystem-groesse-schliessen"].klick();
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 8100, bytes: GRENZE + 10 });
		pruefe(!note.hidden && note.dataset.stufe === "zu_gross", "oder wenn die Stufe kippt -- „nicht gespeichert“ wird nie verschluckt");
	}
	{
		const { k, knoten } = streifen();
		k.avesmapsEcosystemGroesseMelden({ publicId: "f-9", name: "Nicht geladen", punkte: 9000, bytes: GRENZE + 10 });
		pruefe(knoten["ecosystem-groesse-vereinfachen"].hidden,
			"eine Fläche, die nicht (mehr) geladen ist, bekommt kein „Vereinfachen“ -- das Fenster fände sie nicht");
	}
	{
		const { k, knoten } = streifen();
		k.ecosystemLayers = new Map();
		k.avesmapsEcosystemGroesseMelden({ publicId: "", name: "", punkte: 9000, bytes: GRENZE + 10 });
		pruefe(/^Die neue Fläche ist zu groß/.test(knoten["ecosystem-groesse-text"].textContent)
			&& knoten["ecosystem-groesse-vereinfachen"].hidden,
			"eine neue, nicht gespeicherte Fläche: kein „Vereinfachen“ -- es gibt sie auf dem Server noch nicht");
	}

	// ---- D. Die Leiste im Fenster „Fläche vereinfachen" --------------------------------------------
	{
		const knoten = {};
		const el = (id) => (knoten[id] = knoten[id] || {
			id, hidden: true, value: "0", dataset: {}, textContent: "", style: { props: {}, setProperty(n, v) { this.props[n] = v; } },
			classList: { toggle() {} }, focus() {},
			zuhoerer: {}, addEventListener(t, f) { this.zuhoerer[t] = f; },
		});
		["ecosystem-simplify-overlay", "ecosystem-simplify-strength", "ecosystem-simplify-count", "ecosystem-simplify-error",
			"ecosystem-simplify-groesse", "ecosystem-simplify-groesse-text", "ecosystem-simplify-form",
			"ecosystem-simplify-cancel", "ecosystem-simplify-close"].forEach(el);
		const gross = flaecheMitBytes(GRENZE + 30000);
		const k = {
			console, JSON, Math, Number, String, Boolean, Array, Object, Map, TextEncoder,
			document: { getElementById: (id) => knoten[id] || null, addEventListener() {}, readyState: "complete" },
			getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
			ecosystemLayers: new Map([["f-1", { _ecosystemArea: { public_id: "f-1", geometry: gross }, getElement: () => ({ classList: { toggle() {} } }) }]]),
			map: { hasLayer: () => false, removeLayer() {} },
			L: {
				point: (x, y) => ({ x, y }),
				// Douglas-Peucker-Ersatz: je grösser die Toleranz, desto weniger Punkte -- mehr braucht die Suche nicht.
				LineUtil: { simplify: (pts, tol) => pts.filter((_, i) => i % Math.max(1, Math.round(tol * 4)) === 0) },
				polygon: () => ({ addTo() { return this; } }),
			},
		};
		k.window = k;
		vm.createContext(k);
		vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
		vm.runInContext(lies("js/map-features/map-features-ecosystem-simplify.js"), k);
		k.AvesmapsEcosystemSimplify.open("f-1");
		const box = knoten["ecosystem-simplify-groesse"];
		pruefe(box.dataset.stufe === "zu_gross" && /^\d+ von 128 KB – zu groß zum Speichern$/.test(knoten["ecosystem-simplify-groesse-text"].textContent),
			"beim Öffnen zeigt die Leiste die heutige Grösse -- rot: " + knoten["ecosystem-simplify-groesse-text"].textContent);
		pruefe(box.style.props["--ecosystem-groesse-anteil"] === "1", "über der Grenze ist die Leiste voll (Anteil gekappt auf 1)");
		pruefe(knoten["ecosystem-simplify-count"].textContent.startsWith(`${G.avesmapsEcosystemPunkte(gross)} Punkte`),
			"🔴 das Fenster zählt mit DERSELBEN Funktion wie der Streifen");

		// Regler hoch: die Leiste zeigt das ERGEBNIS -- der echte input-Zuhörer wird gefahren.
		const regler = knoten["ecosystem-simplify-strength"];
		regler.value = "95";
		regler.zuhoerer.input();
		const erwartet = G.avesmapsEcosystemFlaechenGroesse(k.AvesmapsEcosystemSimplify.simplifyGeometry(gross, 95)).bytes;
		pruefe(erwartet < GRENZE * 0.75, "Vorbedingung: 95 % bringen die Fläche unter 75 % der Grenze");
		pruefe(/^\d+ → \d+ von 128 KB$/.test(knoten["ecosystem-simplify-groesse-text"].textContent),
			"mit Regler zeigt sie vorher → nachher: " + knoten["ecosystem-simplify-groesse-text"].textContent);
		pruefe(knoten["ecosystem-simplify-groesse-text"].textContent.endsWith(`→ ${G.avesmapsEcosystemKb(erwartet)} von 128 KB`),
			"🔴 und das NACHHER ist das Ergebnis des Reglers, nicht die heutige Grösse");
		pruefe(box.dataset.stufe === "ok" && Number(box.style.props["--ecosystem-groesse-anteil"]) < 0.75,
			"die Stufe folgt dem Ergebnis -- man sieht beim Ziehen, ab wann die Fläche wieder speicherbar ist");
	}

	// ---- E. Der Prüfhaken ---------------------------------------------------------------------------
	{
		let haken = true;
		const k = {
			console, JSON, Math, Number, String, Boolean, Array, Object, Map, TextEncoder,
			IS_EDIT_MODE: true, map: {},
			$: () => ({ is: () => haken }),
			document: { documentElement: {} },
			getComputedStyle: () => ({ getPropertyValue: (n) => (n === "--color-check-area-size" ? "#ff6d00" : "") }),
		};
		k.window = k;
		vm.createContext(k);
		vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
		vm.runInContext(lies("js/map-features/map-features-ecosystem-groesse-check.js"), k);
		const marke = (geom, extra = {}) => k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "a", geometry_revision: 1, kind: "topographie", geometry: geom, ...extra });
		pruefe(marke(flaecheMitBytes(GRENZE + 10)) === "zu_gross", "eine Fläche über der Grenze wird markiert");
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "b", geometry_revision: 1, kind: "vegetation", geometry: flaecheMitBytes(GRENZE * 0.8) }) === "gross",
			"eine Fläche ab 75 % in der zweiten Stufe");
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "c", geometry_revision: 1, kind: "topographie", geometry: flaeche(20) }) === "",
			"eine kleine Fläche bleibt unmarkiert");
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "d", geometry_revision: 1, kind: "klima", geometry: flaecheMitBytes(GRENZE + 10) }) === "",
			"ein Klimaband nie -- es ist abgeleitet, niemand speichert es von Hand");
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "a", geometry_revision: 2, kind: "topographie", geometry: flaeche(20) }) === "",
			"nach einem Speichern (neue Geometrie-Revision) wird neu gerechnet, nicht der alte Befund behalten");
		pruefe(k.avesmapsEcosystemGroesseFarbe("zu_gross") === "#ff6d00" && k.avesmapsEcosystemGroesseFarbe("gross") === "#ff6d00",
			"🔴 EIN Ton für beide Stufen, aus dem Token");
		pruefe(k.avesmapsEcosystemGroesseStrich("zu_gross") === 5 && k.avesmapsEcosystemGroesseStrich("gross") === 3,
			"💣 die Stufe sagt die STRICHSTÄRKE -- die sieht auch, wer Orange und Gold nicht trennt");
		haken = false;
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "e", geometry_revision: 1, kind: "topographie", geometry: flaecheMitBytes(GRENZE + 10) }) === "",
			"Haken aus: nichts markiert");
		k.IS_EDIT_MODE = false;
		haken = true;
		pruefe(k.avesmapsEcosystemGroesseMarkeFlaeche({ public_id: "f", geometry_revision: 1, kind: "topographie", geometry: flaecheMitBytes(GRENZE + 10) }) === "",
			"💣 ein Besucher mit ?toggleBigAreas=1 im Link sieht nichts -- der Riegel steht im Modul");
	}

	// Die Kontur: ecosystemAreaStyle wird AUSGESCHNITTEN und ausgeführt -- Grösse schlägt Wiki-Marke.
	{
		const quelle = lies("js/map-features/map-features-ecosystem-rendering.js");
		const start = quelle.indexOf("function ecosystemAreaStyle(");
		const ende = quelle.indexOf("\n}", start) + 2;
		const k = {
			console, JSON, Math, Number, String, Map, TextEncoder,
			document: { documentElement: {} },
			getComputedStyle: () => ({ getPropertyValue: (n) => (n === "--color-check-area-size" ? "#ff6d00" : "") }),
			ecosystemAreaContourColor: () => "#111111", ecosystemAreaColor: () => "#222222",
			avesmapsWikiZuweisungMarkeFlaeche: () => "no-wiki", avesmapsWikiZuweisungFarbe: () => "#a01029",
		};
		k.window = k;
		vm.createContext(k);
		// Farbe und Strich aus dem ECHTEN Prüfhaken-Modul, nur die Marke wird gestellt.
		vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
		vm.runInContext(lies("js/map-features/map-features-ecosystem-groesse-check.js"), k);
		k.avesmapsEcosystemGroesseMarkeFlaeche = (a) => a.marke;
		vm.runInContext(quelle.slice(start, ende), k);
		const zu = k.ecosystemAreaStyle("topographie", "meer", { marke: "zu_gross" });
		const nah = k.ecosystemAreaStyle("topographie", "meer", { marke: "gross" });
		const nur = k.ecosystemAreaStyle("topographie", "meer", { marke: "" });
		pruefe(zu.color === "#ff6d00" && zu.weight === 5, "zu groß: orange, 5 px -- und es schlägt die Wiki-Marke");
		pruefe(nah.color === "#ff6d00" && nah.weight === 3, "nah an der Grenze: derselbe Ton, 3 px");
		pruefe(zu.weight !== nur.weight && nah.weight !== nur.weight && nah.weight > 2,
			"beide Stufen dicker als die Grundkontur (2 px) und nie gleich dick wie die Wiki-Marke (3,5 px)");
		pruefe(nur.color === "#a01029", "ohne Grössenbefund bleibt die Wiki-Marke");
	}

	// ---- G. Was der Konsistenzprüfer fand (09.10.2026) -----------------------------------------------

	// G1. Nur FLÄCHEN reden mit dem Streifen -- eine Trennlinie trägt auch `geometry_geojson`.
	{
		const { k, gemeldet } = schreibkanal();
		await k.postEcosystemEdit("climate_save_divider", { geometry_geojson: { type: "LineString", coordinates: [[0, 0], [1, 1]] } });
		pruefe(gemeldet.length === 0, "💣 eine Trennlinie meldet nichts -- sie bekäme sonst „Die neue Fläche wird groß“ und räumte fremde Hinweise weg");
	}
	// G2. Der Riegel gilt JEDER Aktion (die Grenze sitzt vor PHP und kennt keine Aktion) -- aber nur Flächen
	//     bekommen den Streifen, und der Satz sagt dort nicht „Fläche".
	{
		const { k, gesendet, gemeldet } = schreibkanal();
		let fehler = null;
		try {
			await k.postEcosystemEdit("heightmap_put", { samples: "A".repeat(GRENZE + 10) });
		} catch (e) {
			fehler = e;
		}
		pruefe(fehler && fehler.code === "zu_gross" && gesendet.length === 0 && gemeldet.length === 0,
			"ein Höhenraster über 128 KiB geht nicht hinaus -- und bedient den Flächen-Streifen nicht");
		pruefe(/^Die Änderung ist zu groß für den Server: \d+ \/ 128 KB\. Gespeichert wurde nichts\.$/.test(fehler.message),
			"und der Satz spricht nicht von einer Fläche: " + fehler.message);
	}
	// G3. Eine abgelehnte NEUE Fläche, danach eine erfolgreich gespeicherte -- der rote Streifen geht.
	{
		const { k: kanal } = schreibkanal();
		const s = streifen();
		kanal.avesmapsEcosystemGroesseMelden = s.k.avesmapsEcosystemGroesseMelden;
		try {
			await kanal.postEcosystemEdit("create_area", { region_public_id: "r-1", geometry_geojson: flaecheMitBytes(GRENZE + 10) });
		} catch (e) { /* erwartet */ }
		pruefe(!s.knoten["ecosystem-groesse-note"].hidden && /^Die neue Fläche ist zu groß/.test(s.knoten["ecosystem-groesse-text"].textContent),
			"Vorbedingung: die abgelehnte neue Fläche steht rot da");
		await kanal.postEcosystemEdit("create_area", { region_public_id: "r-1", geometry_geojson: flaeche(30) });
		pruefe(s.knoten["ecosystem-groesse-note"].hidden,
			"💣 nach dem erfolgreichen Speichern steht NICHT mehr „Gespeichert wurde nichts“ -- obwohl die Kennung jetzt eine andere ist");
	}
	// G4. Die Schätzung des Prüfhakens liegt NIE unter dem, was wirklich hinausgeht -- und nicht weit darüber.
	{
		const { k, gesendet } = schreibkanal();
		for (const n of [600, 3000, 7000]) {
			const geom = flaeche(n);
			await k.postEcosystemEdit("update_area_geometry", { public_id: "eco-0123456789abcdef", expected_revision: 123456, geometry_geojson: geom });
			const echt = G.avesmapsUtf8Bytes(gesendet[gesendet.length - 1].opt.body);
			const geschaetzt = G.avesmapsEcosystemFlaechenGroesse(geom).bytes;
			pruefe(geschaetzt >= echt && geschaetzt - echt < 400,
				`🔴 Schätzung ${geschaetzt} gegen echten Rumpf ${echt} bei ${n} Punkten -- vorsichtig, aber nah`);
		}
	}
	// G5. Zerschneiden und Herauslösen prüfen BEIDE Teile, bevor irgendetwas geschrieben wird.
	{
		const { k, gesendet, gemeldet } = schreibkanal();
		let fehler = null;
		try {
			k.ecosystemGroesseVorabPruefen([flaeche(20), flaecheMitBytes(GRENZE + 10)], { public_id: "f-1", region_name: "Windhagberge" });
		} catch (e) {
			fehler = e;
		}
		pruefe(fehler && fehler.code === "zu_gross" && gesendet.length === 0 && gemeldet[0]?.publicId === "f-1",
			"ist das ZWEITE Stück zu groß, wird das erste gar nicht erst geschrieben");
		let still = true;
		try { k.ecosystemGroesseVorabPruefen([flaeche(20), flaeche(40)], {}); } catch (e) { still = false; }
		pruefe(still, "kleine Teile laufen durch");
		const ops = lies("js/map-features/map-features-ecosystem-geometry-ops.js").replace(/\r\n/g, "\n");
		for (const name of ["completeSplit", "runExtract"]) {
			const start = ops.indexOf(`async function ${name}(`);
			const rumpf = ops.slice(start, ops.indexOf("\n\t}", start));
			const pruefung = rumpf.indexOf("ecosystemGroesseVorabPruefen(");
			pruefe(pruefung > 0 && pruefung < rumpf.indexOf("await saveGeometry("),
				`${name}: die Vorabprüfung steht VOR dem ersten Schreiben`);
		}
	}
	// G6. Der Pinsel verwirft einen abgelehnten Strich -- sonst schickte jeder weitere „alter Stand + Strich".
	{
		const quelle = lies("js/map-features/map-features-ecosystem-brush.js").replace(/\r\n/g, "\n");
		const start = quelle.indexOf("\tasync function speichereJetzt(");
		const rumpf = quelle.slice(start, quelle.indexOf("\n\t}\n", start) + 3);
		const gespeichert = flaeche(20);
		const lauf = async (fehler) => {
			const gesagt = [];
			const gemalt = [];
			const k = {
				console, Number, String, JSON, Date, tr: (s, d) => d,
				brushDirty: true, brushSaving: false, brushAreaPublicId: "f-1", brushMode: "brush", brushErsteAenderungMs: 5,
				brushWorkingGeometry: flaeche(9000),
				areaByPublicId: () => ({ public_id: "f-1", geometry_revision: 3, geometry_geojson: gespeichert }),
				areaGeometry: (a) => a?.geometry_geojson || null,
				withEcosystemOperation: async (n, f) => f(),
				postEcosystemEdit: async () => { throw fehler; },
				say: (m, t) => gesagt.push([m, t]),
				zeichnePinselflaeche: (g) => gemalt.push(g),
				updateBrushPreview: () => {},
			};
			vm.createContext(k);
			vm.runInContext(rumpf + "\nthis.speichereJetzt = speichereJetzt;", k);
			await k.speichereJetzt();
			return { k, gesagt, gemalt };
		};
		const zu = Object.assign(new Error("Zu groß zum Speichern: 9.000 Punkte · 140 von 128 KB. Gespeichert wurde nichts."), { code: "zu_gross" });
		const a = await lauf(zu);
		pruefe(a.k.brushDirty === false && a.k.brushWorkingGeometry === gespeichert && a.gemalt[0] === gespeichert,
			"💣 zu groß: der Pinsel springt auf den GESPEICHERTEN Stand zurück und zeichnet ihn");
		pruefe(/verworfen/.test(a.gesagt[0][0]) && a.gesagt[0][1] === "warning", "und sagt, dass die Striche verworfen sind: " + a.gesagt[0][0]);
		const b = await lauf(new Error("Netzwerkfehler"));
		pruefe(b.k.brushDirty === true && b.gemalt.length === 0,
			"ein GEWÖHNLICHER Fehler verwirft nichts -- der Editor kann es erneut versuchen");
	}
	// G7. Der Ecken-Editor ebenso: zurück auf den gespeicherten Stand, Rückgängig-Stapel geleert.
	{
		const quelle = lies("js/map-features/map-features-ecosystem-edit.js").replace(/\r\n/g, "\n");
		const start = quelle.indexOf("async function flushEcosystemGeometrySave(");
		const rumpf = quelle.slice(start, quelle.indexOf("\n}\n", start) + 3);
		const lauf = async (fehler) => {
			const gesagt = [];
			const aufrufe = [];
			const gespeichert = JSON.stringify(flaeche(20));
			const session = { publicId: "f-1", revision: 3, geometry: flaeche(9000), savedGeometryJson: gespeichert, undoStack: [1, 2], saving: false };
			const k = {
				console, Number, String, JSON, tr: (s, d) => d, window: { clearTimeout() {} },
				activeEcosystemGeometryEdit: session, ecosystemGeometrySaveTimeoutId: null,
				postEcosystemEdit: async () => { throw fehler; },
				applyEcosystemEditGeometryToLayer: (s) => aufrufe.push(["layer", JSON.stringify(s.geometry)]),
				refreshEcosystemEditHandles: () => aufrufe.push(["griffe"]),
				sayEcosystemEdit: (m, t) => gesagt.push([m, t]),
				closeEcosystemGeometryEdit: () => aufrufe.push(["zu"]),
			};
			vm.createContext(k);
			vm.runInContext(rumpf + "\nthis.flush = flushEcosystemGeometrySave;", k);
			await k.flush();
			return { session, gesagt, aufrufe, gespeichert };
		};
		const a = await lauf(Object.assign(new Error("Zu groß zum Speichern: …"), { code: "zu_gross" }));
		pruefe(JSON.stringify(a.session.geometry) === a.gespeichert && a.session.undoStack.length === 0,
			"💣 zu groß: die Ecken springen auf den gespeicherten Stand, der Stapel geht mit");
		pruefe(a.aufrufe.some(([w, g]) => w === "layer" && g === a.gespeichert) && a.aufrufe.some(([w]) => w === "griffe"),
			"und Fläche UND Griffe werden neu gezeichnet");
		pruefe(/wie zuletzt gespeichert/.test(a.gesagt[0][0]), "mit Satz: " + a.gesagt[0][0]);
		const b = await lauf(new Error("Netzwerkfehler"));
		pruefe(b.session.geometry.coordinates[0].length === 9001 && b.session.undoStack.length === 2,
			"ein GEWÖHNLICHER Fehler lässt die Sitzung stehen");
	}
	// G8. Im Vereinfachen-Fenster heisst „zu groß" nicht „bitte vereinfachen", sondern „weiter schieben".
	{
		const knoten = {};
		const el = (id) => (knoten[id] = knoten[id] || {
			id, hidden: true, value: "0", dataset: {}, textContent: "", style: { setProperty() {} },
			classList: { toggle() {} }, focus() {}, zuhoerer: {}, addEventListener(t, f) { this.zuhoerer[t] = f; },
		});
		["ecosystem-simplify-overlay", "ecosystem-simplify-strength", "ecosystem-simplify-count", "ecosystem-simplify-error",
			"ecosystem-simplify-groesse", "ecosystem-simplify-groesse-text", "ecosystem-simplify-form",
			"ecosystem-simplify-cancel", "ecosystem-simplify-close"].forEach(el);
		const gross = flaecheMitBytes(GRENZE + 30000);
		const k = {
			console, JSON, Math, Number, String, Boolean, Array, Object, Map, TextEncoder,
			document: { getElementById: (id) => knoten[id] || null, addEventListener() {}, readyState: "complete" },
			getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
			ecosystemLayers: new Map([["f-1", { _ecosystemArea: { public_id: "f-1", geometry_revision: 2, geometry: gross }, getElement: () => ({ classList: { toggle() {} } }) }]]),
			map: { hasLayer: () => false, removeLayer() {} },
			L: { point: (x, y) => ({ x, y }), LineUtil: { simplify: (pts, tol) => pts.filter((_, i) => i % Math.max(1, Math.round(tol * 4)) === 0) }, polygon: () => ({ addTo() { return this; } }) },
			postEcosystemEdit: async () => { throw Object.assign(new Error("Zu groß zum Speichern: … bitte die Fläche vereinfachen"), { code: "zu_gross" }); },
		};
		k.window = k;
		vm.createContext(k);
		vm.runInContext(lies("js/map-features/ecosystem-groesse.js"), k);
		vm.runInContext(lies("js/map-features/map-features-ecosystem-simplify.js"), k);
		k.AvesmapsEcosystemSimplify.open("f-1");
		knoten["ecosystem-simplify-strength"].value = "10";
		await knoten["ecosystem-simplify-form"].zuhoerer.submit({ preventDefault() {} });
		const text = knoten["ecosystem-simplify-error"].textContent;
		pruefe(/^Noch zu groß zum Speichern \(\d+ von 128 KB\) – den Regler weiter nach rechts schieben\.$/.test(text) && !/vereinfachen/.test(text),
			"der Rat passt zum Fenster: " + text);
	}
	// G9. „Fläche vereinfachen" im Streifen beendet zuerst Pinsel und Ecken-Editor -- sie halten einen
	//     eigenen Stand, das Fenster vereinfacht den gespeicherten.
	{
		const s = streifen();
		const reihenfolge = [];
		s.k.AvesmapsEcosystemBrush = { stop: () => reihenfolge.push("pinsel") };
		s.k.closeEcosystemGeometryEdit = (o) => reihenfolge.push("ecken:" + (o && o.flush));
		s.k.AvesmapsEcosystemSimplify = { open: (id) => reihenfolge.push("fenster:" + id) };
		s.k.avesmapsEcosystemGroesseMelden({ publicId: "f-1", name: "W", punkte: 9000, bytes: GRENZE + 10 });
		s.knoten["ecosystem-groesse-vereinfachen"].klick();
		pruefe(reihenfolge.join(" ") === "pinsel ecken:true fenster:f-1", "erst die Werkzeuge, dann das Fenster: " + reihenfolge.join(" "));
	}

	// ---- F. Verdrahtung --------------------------------------------------------------------------------
	const index = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
	const pos = (s) => index.indexOf(s);
	pruefe(pos('src="js/map-features/ecosystem-groesse.js"') > 0
		&& pos('src="js/map-features/ecosystem-groesse.js"') < pos('src="js/map-features/map-features-ecosystem-region-store.js"')
		&& pos('src="js/map-features/ecosystem-groesse.js"') < pos('src="js/map-features/map-features-ecosystem-simplify.js"'),
		"die Regel lädt VOR dem Schreibkanal und dem Fenster, die sie rufen");
	pruefe(pos('src="js/map-features/map-features-ecosystem-groesse-hinweis.js"') > 0
		&& pos('src="js/map-features/map-features-ecosystem-groesse-check.js"') > 0, "Streifen und Prüfhaken sind eingebunden");
	pruefe(pos('id="ecosystem-groesse-note"') > 0 && pos('id="ecosystem-simplify-groesse"') > 0 && pos('id="toggleBigAreas"') > 0,
		"Streifen, Leiste und Haken stehen im Markup");
	pruefe(/toggleBigAreas: false/.test(lies("js/config.js")), "der Haken hat seine Vorgabe");
	const zustand = lies("js/map-features/map-features-layer-state.js");
	pruefe(/searchParams\.get\("toggleBigAreas"\)/.test(zustand) && /searchParams\.set\("toggleBigAreas"/.test(zustand),
		"er reist im geteilten Link mit, wie seine Nachbarn");
	pruefe(/toggleBigAreasControl"\)\?\.removeAttribute\("hidden"\)/.test(lies("js/app/bootstrap.js")), "Editoren sehen die Zeile");
	pruefe(/\$\("#toggleBigAreas"\)\.change\(/.test(lies("js/map-features/map-features.js")), "Umlegen zeichnet neu");
	// Der Ton wird gegen die Tafel GEMESSEN, nicht gegen eine abgeschriebene Liste: jede Flächenfüllung der
	// drei Ebenen, die eine Kontur tragen, jede andere Flächen- und Prüfmarke. Eine neue Füllung, die dem
	// Orange zu nahe kommt, macht diesen Test rot -- eine abgeschriebene Liste sähe sie nie.
	const tokens = lies("css/base/tokens.css");
	const tafel = {};
	for (const m of tokens.matchAll(/--(color-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
		if (!(m[1] in tafel)) tafel[m[1]] = m[2].toLowerCase();
	}
	const ton = tafel["color-check-area-size"];
	pruefe(ton === "#ff6d00", "der Ton steht als Token");
	pruefe(!/--color-check-area-(too-)?big:/.test(tokens) && !/check-area-(too-)?big/.test(index),
		"🔴 der zweite Ton (dunkles Gold) ist weg -- er war zugleich --color-warning und verschwamm mit Kulturland");
	const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
	const abstand = (a, b) => Math.hypot(...hex(a).map((v, i) => v - hex(b)[i]));
	const gemessen = Object.keys(tafel).filter((n) =>
		/^color-ecosystem-(derographisch|topographie|vegetation)(-[a-z-]+)?$/.test(n)
		|| /^color-check-(no-wiki|free-label|duplicate-label)$/.test(n)
		|| /^color-(marker-(waypoint|settlement|settlement-site|active|unconnected-ring|sparse-crossing-ring)|path-open-end|import-(hover|outline)|ecosystem-target-active|warning)$/.test(n));
	pruefe(gemessen.length >= 40, `die Messliste ist die Tafel, nicht eine Handvoll (${gemessen.length})`);
	gemessen.forEach((n) => pruefe(abstand(ton, tafel[n]) >= 76, `--${n} liegt nur ${abstand(ton, tafel[n]).toFixed(1)} vom Größen-Orange (< 76)`));
	// ⚠️ Die EINE benannte Ausnahme: der Ring „Offene Wegenden" (Punkt, gestrichelt, weisser Innenring) --
	// die Form trennt, nicht der Ton. Steht der Abstand je über 76, ist die Ausnahme überflüssig.
	pruefe(abstand(ton, tafel["color-marker-open-path-end-ring"]) < 76 && /Offene Wegenden[\s\S]{0,200}35/.test(tokens),
		"die Ausnahme ist benannt und mit ihrer Zahl am Token begründet");

	// Jeder Satz der Größenanzeige hat seine englische Zeile -- gezählt aus dem CODE, nicht aus dieser Datei.
	const en = lies("js/app/i18n-en.js");
	const schluessel = new Set();
	["js/map-features/ecosystem-groesse.js", "js/map-features/map-features-ecosystem-groesse-hinweis.js",
		"js/map-features/map-features-ecosystem-simplify.js", "js/map-features/map-features-ecosystem-region-store.js"]
		.forEach((rel) => { for (const m of lies(rel).matchAll(/avesmapsGroesseTr\("([a-zA-Z.]+)"/g)) schluessel.add(m[1]); });
	pruefe(schluessel.size >= 12, `die Sätze laufen durch tr() (${schluessel.size} Schlüssel)`);
	schluessel.forEach((s) => pruefe(en.includes(`"${s}":`), `englische Zeile fehlt: ${s}`));
	pruefe(/"display\.check\.bigAreas"/.test(en) && /"ecosystem\.size\.simplify"/.test(en), "die englischen Beschriftungen fehlen nicht");

	console.log(`ok - ecosystem-groesse (${pruefungen} Prüfungen)`);
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
