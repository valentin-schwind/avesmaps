const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Run: node js/map-features/__tests__/ortsraster.test.js
//
// ⭐ DAS ORTSRASTER DARF NICHTS AENDERN AUSSER DER ZEIT. getLocationAtPathEndpoint entscheidet, an
// welchem Ort ein Wegende haengt -- fuer den Router, „Unverbunden", „Kreuzungen mit 2 Wegen" und
// „Offene Wegenden". Ohne Raster ging sie fuer jedes Wegende alle Orte durch; mit eingeschalteten
// Pruefhaken fror „Weg teilen" den Editor dadurch 13-18 s ein (gemessen 23.09.2026, 8.083 Wege,
// 6.923 Orte). Mit Raster fragt DIESELBE Regel nur die Nachbarzellen.
// Dieser Test haelt alt gegen neu, OBJEKT FUER OBJEKT -- ein gleicher Name reicht nicht, zwei Orte
// koennen gleich heissen. Und er fuehrt die zwei Massenaufrufer aus, statt ihren Quelltext zu lesen.

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../map-features-line-catmull.js");
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../map-features-path-domain.js");
loadBrowserScript("../map-features-location-editing.js");
loadBrowserScript("../../routing/route-graph-core.js");
loadBrowserScript("../../routing/route-graph-routing.js");

// locationData speichert [lat, lng] = [y, x]; die Weggeometrie [x, y]. Immer bewusst tauschen.
const ort = (name, x, y) => ({ publicId: `pid-${name}`, name, coordinates: [y, x], locationType: "dorf" });
const mitRaster = (punkt) => getLocationAtPathEndpoint(punkt, avesmapsOrtsRaster());

// Reproduzierbarer Zufall (mulberry32): ein roter Lauf muss sich nachfahren lassen.
function zufall(saat) {
	let s = saat >>> 0;
	return function () {
		s = (s + 0x6D2B79F5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- 1. Die drei Livefaelle aus location-at-path-endpoint.test.js, durch das Raster -------------
locationData = [ort("Alarasruh", 574.5, 499.5), ort("Tolakstein", 574.09126, 499.97011)];
assert.strictEqual(mitRaster([574.091, 499.97]).name, "Tolakstein", "der exakte Treffer schlaegt den frueheren Kastentreffer auch mit Raster");
locationData = [ort("Kreuzung-599", 713.07, 640.016), ort("Fischbach", 713.047, 640.008)];
assert.strictEqual(mitRaster([713.047, 640.008]).name, "Fischbach", "Fischbach behaelt seine Wegenden auch mit Raster");
locationData = [ort("Erster", 200.4, 200), ort("Zweiter", 200.1, 200)];
assert.strictEqual(mitRaster([200.2, 200]).name, "Erster",
	"💣 ohne exakten Treffer entscheidet weiter die ARRAY-Reihenfolge -- ein Raster, das nach Zellen ordnet, kippte das");
locationData = [ort("Loses Ende", 100, 100)];
assert.strictEqual(mitRaster([100.3, 100.2]).name, "Loses Ende", "der 0,5-Kasten faengt lose Enden weiterhin");
assert.strictEqual(mitRaster([100.8, 100]), null, "jenseits von 0,5 weiterhin niemand");

// --- 2. Alt gegen neu, Objekt fuer Objekt ------------------------------------------------------
// Der Bestand ist so gebaut, dass jede Weiche der Regel wirklich faellt: Haufen (mehrere Orte im
// Kasten), Orte exakt auf Zellgrenzen (Vielfache von 0,5), deckungsgleiche Orte (Gleichstand beim
// exakten Treffer), negative Koordinaten. Die Anfragepunkte treffen Orte exakt, liegen im Kasten,
// knapp innerhalb und ausserhalb seines Randes, auf Zellgrenzen und im Nirgendwo.
function baueBestand(r, anzahl) {
	const orte = [];
	const haufen = Array.from({ length: 40 }, () => [r() * 1000, r() * 1000]);
	for (let i = 0; i < anzahl; i++) {
		const [hx, hy] = haufen[Math.floor(r() * haufen.length)];
		const art = r();
		let x;
		let y;
		if (art < 0.1) {
			x = Math.round((hx + (r() - 0.5) * 4) * 2) / 2;
			y = Math.round((hy + (r() - 0.5) * 4) * 2) / 2;
		} else if (art < 0.2 && orte.length > 0) {
			const vorbild = orte[Math.floor(r() * orte.length)];
			[y, x] = vorbild.coordinates;
		} else {
			x = hx + (r() - 0.5) * 6;
			y = hy + (r() - 0.5) * 6;
		}
		orte.push(ort(`o${i}`, x, y));
	}
	orte.push(ort("west", -0.3, -0.2), ort("west2", -0.6, 0.1), ort("west3", -0.75, -0.5));
	return orte;
}

function baueAnfragen(r, orte, anzahl) {
	const punkte = [];
	const endlich = orte.filter((o) => Number.isFinite(o.coordinates[0]) && Number.isFinite(o.coordinates[1]));
	endlich.forEach((o) => punkte.push([o.coordinates[1], o.coordinates[0]]));
	for (let i = 0; i < anzahl; i++) {
		const [lat, lng] = endlich[Math.floor(r() * endlich.length)].coordinates;
		const art = r();
		const rand = () => (r() < 0.5 ? -1 : 1) * (0.49 + r() * 0.02);
		if (art < 0.25) {
			punkte.push([lng + (r() - 0.5) * 0.02, lat + (r() - 0.5) * 0.02]);
		} else if (art < 0.5) {
			punkte.push([lng + (r() - 0.5), lat + (r() - 0.5)]);
		} else if (art < 0.75) {
			punkte.push([lng + rand(), lat + rand()]);
		} else {
			punkte.push([Math.round(lng * 2) / 2, Math.round(lat * 2) / 2 + (r() < 0.5 ? 0 : 1e-9)]);
		}
	}
	punkte.push([5000, 5000], [-0.5, 0], [0, -0.5]);
	return punkte;
}

function vergleiche(bezeichnung, punkte) {
	const raster = avesmapsOrtsRaster();
	const bilanz = { geprueft: 0, exakt: 0, nurKasten: 0, keiner: 0, reihenfolgeEntschied: 0 };
	punkte.forEach((punkt) => {
		const alt = getLocationAtPathEndpoint(punkt);
		const neu = getLocationAtPathEndpoint(punkt, raster);
		bilanz.geprueft += 1;
		if (alt !== neu) {
			assert.fail(`${bezeichnung}: Wegende ${JSON.stringify(punkt)} -- ohne Raster ${alt && alt.name}, mit Raster ${neu && neu.name}`);
		}
		if (!alt) {
			bilanz.keiner += 1;
			return;
		}
		const [lat, lng] = alt.coordinates;
		if (Math.hypot(lng - punkt[0], lat - punkt[1]) < LOCATION_ENDPOINT_EXACT_HIT) {
			bilanz.exakt += 1;
			return;
		}
		bilanz.nurKasten += 1;
		// Lag ein anderer Ort NAEHER im Kasten? Dann hat die Reihenfolge entschieden, nicht der Abstand --
		// genau der Fall, den ein falsch geordnetes Raster kippen wuerde.
		const naeher = locationData.some((o) => o !== alt
			&& Math.abs(o.coordinates[0] - punkt[1]) < THRESHOLD && Math.abs(o.coordinates[1] - punkt[0]) < THRESHOLD
			&& Math.hypot(o.coordinates[1] - punkt[0], o.coordinates[0] - punkt[1]) < Math.hypot(lng - punkt[0], lat - punkt[1]));
		if (naeher) {
			bilanz.reihenfolgeEntschied += 1;
		}
	});
	return bilanz;
}

{
	const r = zufall(20260923);
	locationData = baueBestand(r, 4000);
	const bilanz = vergleiche("Bestand", baueAnfragen(r, locationData, 6000));
	// 💣 Ohne diese Zaehlung waere „0 Abweichungen" auch dann gruen, wenn die Anfragen nie eine Weiche
	// erreichen -- dann prueft der Vergleich nichts. Jede Weiche muss wirklich gefallen sein.
	assert.ok(bilanz.exakt > 1000, `genug exakte Treffer gefragt (${bilanz.exakt})`);
	assert.ok(bilanz.nurKasten > 1000, `genug reine Kastentreffer gefragt (${bilanz.nurKasten})`);
	assert.ok(bilanz.keiner > 100, `genug Wegenden ohne Ort gefragt (${bilanz.keiner})`);
	assert.ok(bilanz.reihenfolgeEntschied > 100,
		`genug Faelle, in denen die Array-Reihenfolge gegen den Abstand entschied (${bilanz.reihenfolgeEntschied})`);
	console.log("Ortsraster, Bestand:", JSON.stringify(bilanz));

	// 💣 GLEICHE ERGEBNISSE BELEGEN NICHT, DASS DAS RASTER WIRKT. Eine Suche, die das Raster annimmt
	// und trotzdem alle Orte durchgeht, antwortet genauso richtig -- und friert den Editor genauso ein.
	// Deshalb: das Raster muss die Kandidaten wirklich eingrenzen, und die Suche muss es wirklich fragen.
	const raster = avesmapsOrtsRaster();
	const [lat, lng] = locationData[0].coordinates;
	const kandidaten = avesmapsOrtsRasterKandidaten(raster, lng, lat);
	assert.ok(kandidaten.includes(locationData[0]), "ein Ort ist Kandidat fuer ein Wegende auf ihm selbst");
	assert.ok(kandidaten.length < locationData.length / 20,
		`das Raster grenzt ein: ${kandidaten.length} Kandidaten statt ${locationData.length} Orte`);
	const echteKandidaten = globalThis.avesmapsOrtsRasterKandidaten;
	let kandidatenFragen = 0;
	globalThis.avesmapsOrtsRasterKandidaten = function (...argumente) {
		kandidatenFragen += 1;
		return echteKandidaten.apply(this, argumente);
	};
	getLocationAtPathEndpoint([lng, lat], raster);
	getLocationAtPathEndpoint([lng, lat]);
	globalThis.avesmapsOrtsRasterKandidaten = echteKandidaten;
	assert.strictEqual(kandidatenFragen, 1, "mit Raster fragt die Suche das Raster, ohne Raster nicht");
}

// ⚠️ Ein Ort ohne endliche Koordinaten: der Durchlauf ohne Raster laesst ihn durch den Kasten
// (NaN >= THRESHOLD ist false) -- er faengt jedes lose Ende, vor dem er in der Liste steht. Das ist
// seltsam, aber es ist die geltende Regel; das Raster muss dasselbe antworten, nicht eine bessere.
{
	const r = zufall(7);
	const orte = baueBestand(r, 1500);
	orte.splice(600, 0, { publicId: "pid-kaputt", name: "kaputt", coordinates: [NaN, NaN], locationType: "dorf" });
	locationData = orte;
	const bilanz = vergleiche("mit kaputtem Ort", baueAnfragen(r, orte, 2000));
	assert.ok(bilanz.geprueft > 3000, "der Durchgang mit kaputtem Ort hat wirklich gefragt");
}

// Ein nicht endlicher ANFRAGEPUNKT geht am Raster vorbei in den Durchlauf -- dort antwortet die Regel,
// wie sie immer geantwortet hat.
locationData = [ort("A", 1, 1), ort("B", 2, 2)];
assert.strictEqual(getLocationAtPathEndpoint([NaN, 1], avesmapsOrtsRaster()), getLocationAtPathEndpoint([NaN, 1]),
	"ein NaN-Wegende bekommt mit Raster dieselbe Antwort wie ohne");

// --- 3. Ein veraltetes Raster antwortet nicht --------------------------------------------------
// 💣 Ein Raster ist eine Momentaufnahme. Wer es ueber eine Aenderung hinweg benutzt, bekaeme STILL
// den alten Stand -- der neue Ort wuerde nie gefunden, und kein Fehler sagte es.
locationData = [ort("Alt", 10, 10)];
const altesRaster = avesmapsOrtsRaster();
locationData.push(ort("Neu", 50, 50));
assert.strictEqual(getLocationAtPathEndpoint([50, 50], altesRaster).name, "Neu",
	"ein gewachsener Bestand faellt auf den Durchlauf zurueck statt den neuen Ort zu uebersehen");
locationData = [ort("Getauscht", 90, 90)];
assert.strictEqual(getLocationAtPathEndpoint([90, 90], altesRaster).name, "Getauscht",
	"ein ausgetauschter Bestand ebenso");

// --- 4. Die Massenaufrufer bauen EIN Raster je Lauf und reichen es durch -----------------------
// Ausgefuehrt, nicht gelesen: gezaehlt wird am echten createGraph.
const echteSuche = globalThis.getLocationAtPathEndpoint;
const echterBau = globalThis.avesmapsOrtsRaster;
let rasterBauten = 0;
let fragenMitRaster = 0;
let fragenOhneRaster = 0;
globalThis.avesmapsOrtsRaster = function () {
	rasterBauten += 1;
	return echterBau();
};
globalThis.getLocationAtPathEndpoint = function (punkt, raster) {
	if (raster) {
		fragenMitRaster += 1;
	} else {
		fragenOhneRaster += 1;
	}
	return echteSuche(punkt, raster);
};

locationData = [ort("A", 0, 0), ort("B", 10, 0), ort("C", 20, 0)];
pathData = [
	{ geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] }, properties: { id: "p1", feature_subtype: "Weg" } },
	{ geometry: { type: "LineString", coordinates: [[10, 0], [20, 0]] }, properties: { id: "p2", feature_subtype: "Weg" } },
];
const verbunden = createGraph({}, { skipSyntheticConnections: true, transports: "all" });
assert.strictEqual(rasterBauten, 1, "der Konnektivitaets-Graph baut EIN Raster, nicht eins je Weg");
assert.strictEqual(fragenMitRaster, 4, "und fragt jedes der vier Wegenden damit");
assert.strictEqual(fragenOhneRaster, 0, "keine Frage geht am Raster vorbei");
assert.ok(Object.keys(verbunden.B).length === 2, "und das Ergebnis ist der gewohnte Graph: B haengt an A und C");

rasterBauten = 0;
fragenMitRaster = 0;
// Der Routing-Zweig fragt die Wegenden, BEVOR er nach dem Verkehrsmittel fragt -- das Verkehrsmittel
// selbst (route-costs.js) braucht dieser Test nicht; ohne Treffer steigt der Zweig nach den Fragen aus.
if (typeof getTransportOptionForRouteType !== "function") {
	globalThis.getTransportOptionForRouteType = () => null;
}
const warnung = console.warn;
console.warn = () => {};
try {
	createGraph({}, { skipSyntheticConnections: true });
} finally {
	console.warn = warnung;
}
assert.strictEqual(rasterBauten, 1, "auch der Routing-Graph baut EIN Raster");
assert.strictEqual(fragenMitRaster, 4, "und fragt beide Enden beider Wege damit");
assert.strictEqual(fragenOhneRaster, 0, "auch dort geht keine Frage am Raster vorbei");

globalThis.getLocationAtPathEndpoint = echteSuche;
globalThis.avesmapsOrtsRaster = echterBau;

console.log("ortsraster tests passed");
