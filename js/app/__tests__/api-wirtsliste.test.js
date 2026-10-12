"use strict";

// Die Wirtsliste der API-Adressen -- und warum dieser Test den Block AUSFUEHRT.
//
// 💣 DER ANLASS (12.10.2026). Die alte Anwendung ist auf `legacy.avesmaps.de` gezogen, waehrend
// `avesmaps.de` seither Avesmaps3D traegt. `SQL_MAP_HOSTS` kannte den neuen Wirt nicht, und daran
// haengen NEUN Konstanten plus die zwei Formular-Bauer: jede faellt bei einem unbekannten Wirt auf
// den LEEREN String, der Lader
// bricht mit „Keine Map-Features-API fuer diese Umgebung konfiguriert" ab -- und damit laden Orte,
// Gebiete, Beschriftungen, Suche und Landschaften nicht. Der Server war die ganze Zeit heil
// (map-features.php antwortete mit 200 und 30,9 MB); es fragte nur niemand.
//
// ⭐ Darum wird hier AUSGEFUEHRT, nicht gelesen: ein Regex „steht legacy in der Datei?" waere fuer
// einen Eintrag im falschen Set oder hinter einer anderen Bedingung gruen, und dieselbe Lehre steht
// in AGENTS.md §11 zweimal (das Ansichts-Popup der Beschriftungen, der Zustandsbauer des Menuebands).
//
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, die CI LF (AGENTS.md §9).

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(WURZEL, "js", "config.js"), "utf8").replace(/\r\n/g, "\n");

// Der Block zwischen den beiden Ankern traegt die Wirtsliste und alle Konstanten, die sie lesen.
// Geschnitten wird auf GANZE Zeilen -- ein festes Zeichenfenster misst die Kommentarlaenge.
const ANFANG = "const STRATO_MAP_HOST";
const ENDE = "const MAP_SEARCH_API_URL";
const von = quelle.indexOf(ANFANG);
assert.ok(von >= 0, `Anker „${ANFANG}" nicht in js/config.js gefunden`);
const bis = quelle.indexOf("\n", quelle.indexOf(ENDE, von));
assert.ok(bis > von, `Anker „${ENDE}" nicht hinter „${ANFANG}" gefunden`);
const block = quelle.slice(von, bis);

// ⚠️ `const` auf oberster Ebene landet in einem vm-Kontext NICHT am Kontextobjekt (anders als
// `var`) -- die Werte werden deshalb als Ausdruck hinter dem Block zurueckgegeben.
function ladeFuerWirt(hostname, namen) {
	const location = { hostname, protocol: "https:", search: "", href: `https://${hostname}/` };
	const z = { window: { location }, location, console, URLSearchParams, URL };
	z.globalThis = z;
	vm.createContext(z);
	const felder = ["SQL_MAP_HOSTS", "PUBLIC_API_HOST", "getDefaultContactEndpointUrl", "getDefaultLocationReportEndpointUrl", ...namen];
	return vm.runInContext(`${block}
;({ ${felder.join(", ")} })`, z);
}

// Die Konstanten, die an der Wirtsliste haengen. Die Liste wird aus dem Block GERECHNET, nie
// abgeschrieben: eine abgeschriebene Liste verliert die naechste neue Konstante lautlos -- und eine
// ZAHL hier liest sich wie eine vollstaendige Liste (AGENTS.md §11, zweimal bezahlt).
// ⚠️ Die Untergrenze ist KEINE Inventarliste, sondern der Riegel gegen ein Vakuum: bricht das
// Muster, findet es null, und jede Zusicherung darunter laeuft dann durch eine leere Schleife.
const GEBUNDENE = [...block.matchAll(/^const ([A-Z0-9_]+) = window\.[A-Z0-9_]+ \|\| \(SQL_MAP_HOSTS\.has/gm)].map((m) => m[1]);
assert.ok(GEBUNDENE.length >= 9, `Erwartet mindestens 9 wirtsgebundene Konstanten, gefunden ${GEBUNDENE.length}`);

// § A -- legacy.avesmaps.de ist der Wirt der alten Anwendung und bekommt JEDE Adresse.
{
	const z = ladeFuerWirt("legacy.avesmaps.de", GEBUNDENE);
	assert.ok(z.SQL_MAP_HOSTS.has("legacy.avesmaps.de"), "legacy.avesmaps.de fehlt in SQL_MAP_HOSTS");
	for (const name of GEBUNDENE) {
		assert.ok(
			typeof z[name] === "string" && z[name] !== "",
			`${name} ist auf legacy.avesmaps.de leer -- der Lader bricht dann mit „Keine Map-Features-API" ab`
		);
		assert.ok(!/^https?:/i.test(z[name]), `${name} muss ein relativer Pfad sein, ist aber „${z[name]}"`);
	}
}

// § B -- GEGENPROBE: ein fremder Wirt bekommt weiter NICHTS. Ohne diese Zusicherung ueberlebt die
// Mutation „alle Wirte erlauben", und dann holt eine beliebige Kopie der Seite die Daten von sich
// selbst statt gar nicht -- 404 statt einer klaren Meldung.
{
	const z = ladeFuerWirt("example.com", GEBUNDENE);
	assert.ok(!z.SQL_MAP_HOSTS.has("example.com"), "Die Wirtsliste darf keinen fremden Wirt enthalten");
	for (const name of GEBUNDENE) {
		assert.strictEqual(z[name], "", `${name} muss auf einem fremden Wirt leer bleiben`);
	}
}

// § C -- Die RUECKFALL-Adresse zeigt auf den Wirt, der die API wirklich traegt. `PUBLIC_API_HOST`
// bedient die beiden Formular-Endpunkte auf einem Wirt AUSSERHALB der Liste (etwa der Werkstatt).
// 🔴 Seit dem Umzug traegt `avesmaps.de` Avesmaps3D und hat kein `api/` mehr -- gemessen am
// 12.10.2026: map-features.php, session.php und /api/locations/ antworten dort mit 404 bzw. dem
// SPA-Rueckfall. Ein Rueckfall dorthin zeigt also ins Leere.
{
	const z = ladeFuerWirt("werkstatt.example", GEBUNDENE);
	assert.strictEqual(z.PUBLIC_API_HOST, "legacy.avesmaps.de", "PUBLIC_API_HOST muss auf den Wirt zeigen, der api/ wirklich traegt");
	for (const bauer of ["getDefaultContactEndpointUrl", "getDefaultLocationReportEndpointUrl"]) {
		const url = z[bauer]();
		assert.ok(
			url.startsWith("https://legacy.avesmaps.de/api/"),
			`${bauer}() zeigt auf „${url}" statt auf den API-Wirt`
		);
	}
}

console.log("api-wirtsliste: OK");
