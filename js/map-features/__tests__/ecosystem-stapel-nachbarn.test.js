// Greift das Stapel-Modul nur nach Namen, die es WIRKLICH gibt?
//
// 💣 DIE FEHLERKLASSE, GEGEN DIE DIESER TEST STEHT (20.08.2026, vom Owner gemeldet: „das
// eigenschaftsfenster geht nicht auf"). Das Modul rief `openEcosystemPropertiesDialog` — hinter dem
// üblichen `typeof … === "function"`-Riegel. Die Funktion ist aber PRIVAT in ihrer Datei, also war
// der Riegel für immer falsch, und der Knopf tat still gar nichts: kein Fehler, keine Meldung, nur
// ein Klick ins Leere. Das ist der teuerste Riegel im Haus, weil er im Fehlerfall SCHWEIGT.
//
// ⚠️ Und die Prüfseite war grün, weil sie den fehlenden Namen als globale Attrappe selbst erfunden
// hatte. Eine Probe, die ihren Treffer vorbelegt, beweist nichts — deshalb prüft dieser Test nicht
// gegen Attrappen, sondern gegen die AUSGELIEFERTEN Dateien.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");
const modul = fs.readFileSync(
	path.join(wurzel, "js/map-features/map-features-ecosystem-stapel.js"),
	"utf8"
);

// Alle Dateien, die index.html lädt, sind der Namensraum. Hier genügt `js/` -- was dort nirgends
// deklariert wird, gibt es im Browser auch nicht.
function alleQuellen(verzeichnis) {
	const gefunden = [];
	fs.readdirSync(verzeichnis, { withFileTypes: true }).forEach((eintrag) => {
		const voll = path.join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			if (eintrag.name === "__tests__" || eintrag.name === "third-party") {
				return;
			}
			gefunden.push(...alleQuellen(voll));
			return;
		}
		if (eintrag.name.endsWith(".js")) {
			gefunden.push(voll);
		}
	});

	return gefunden;
}

const quellen = alleQuellen(path.join(wurzel, "js")).map((datei) => fs.readFileSync(datei, "utf8"));

// Ist `name` im Browser wirklich erreichbar? Entweder als Deklaration ganz links (dann steht sie im
// globalen Namensraum -- diese Dateien sind schlichte <script>-Tags ohne Modulsystem), oder
// ausdrücklich an `window` gehängt.
//
// 🔴 Eine EINGERÜCKTE Deklaration zählt NICHT. Genau das war der Fehler: `\tasync function
// openEcosystemPropertiesDialog(` sieht im Editor aus wie jede andere, steht aber in einer IIFE.
function istErreichbar(name) {
	const global = new RegExp(`^(async\\s+)?function\\s+${name}\\s*\\(`, "m");
	const variable = new RegExp(`^(const|let|var)\\s+${name}\\b`, "m");
	// runtime-state.js listet viele Globale in EINER Deklaration, je Zeile eine mit Einrückung.
	const inListe = new RegExp(`^\\s*${name}\\s*=\\s*`, "m");
	const amFenster = new RegExp(`window\\.${name}\\s*=`);

	return quellen.some((quelle) => global.test(quelle) || variable.test(quelle)
		|| amFenster.test(quelle) || inListe.test(quelle));
}

// Die Namen, die das Modul hinter einem `typeof`-Riegel oder direkt anspricht. Der Riegel ist genau
// die Stelle, an der ein falscher Name lautlos wird.
//
// ⚠️ Zwei Sorten fallen heraus, und beide mit Grund:
//   - Was der BROWSER mitbringt (`document`, `window`, …) -- das steht in keiner Datei dieses Repos
//     und wäre sonst ein Dauer-Rot.
//   - Was das Modul SELBST deklariert. Ein `typeof`-Riegel um eine eigene Variable ist zwar selten,
//     kommt aber vor (eine Zuweisung, die scheitern durfte), und die ist per Definition erreichbar.
const EINGEBAUT = new Set([
	"document", "window", "module", "console", "navigator", "localStorage", "globalThis",
	"MouseEvent", "DragEvent", "DataTransfer", "Map", "Set", "Promise", "fetch",
]);

const selbstDeklariert = new Set(
	[...modul.matchAll(/(?:^|\s)(?:const|let|var)\s+([A-Za-z_$][\w$]*)|function\s+([A-Za-z_$][\w$]*)\s*\(/g)]
		.flatMap((treffer) => [treffer[1], treffer[2]])
		.filter(Boolean)
);

const gefragt = new Set();
[...modul.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*[=!]==\s*"(function|undefined)"/g)]
	.forEach((treffer) => {
		const name = treffer[1];
		if (!EINGEBAUT.has(name) && !selbstDeklariert.has(name)) {
			gefragt.add(name);
		}
	});

assert.ok(gefragt.size >= 5,
	`Nur ${gefragt.size} Nachbarnamen gefunden -- das Suchmuster passt nicht mehr auf die Datei, und `
		+ "ein Test, der nichts findet, ist gruen und wertlos.");

const fehlend = [...gefragt].filter((name) => !istErreichbar(name));
assert.deepStrictEqual(
	fehlend,
	[],
	`Diese Namen werden angesprochen, existieren im Browser aber nicht: ${fehlend.join(", ")}.\n`
		+ "  Hinter einem `typeof … === \"function\"`-Riegel schweigt das: der Knopf tut dann gar nichts,\n"
		+ "  ohne Fehler und ohne Meldung. Ist die Funktion privat in ihrer Datei, muss sie ueber die\n"
		+ "  Fensteroberflaeche ihres Moduls gerufen werden (window.Avesmaps…), nicht ueber ihren Namen."
);

// ---- Und der konkrete Fall, namentlich ------------------------------------------------------------
//
// 🔴 Er steht zusaetzlich einzeln da, damit die Meldung sagt, worum es geht, falls jemand den bequemen
// Weg zurueckbaut. Der Dialog wird ueber `window.AvesmapsEcosystemProperties.open` geoeffnet.
assert.ok(
	!/typeof\s+openEcosystemPropertiesDialog/.test(modul),
	"Das Modul greift wieder nach `openEcosystemPropertiesDialog` -- die Funktion ist PRIVAT in "
		+ "map-features-ecosystem-properties.js. Der Knopf taete still gar nichts."
);
assert.ok(
	modul.includes("AvesmapsEcosystemProperties?.open"),
	"Der Eigenschaften-Dialog wird nicht mehr ueber die Fensteroberflaeche seines Moduls geoeffnet."
);

// Gegenprobe, damit `istErreichbar` nicht einfach immer `true` sagt: ein erfundener Name muss
// durchfallen. Ohne diese Zeile waere der Test gruen, auch wenn die Pruefung kaputt ist.
assert.strictEqual(istErreichbar("dieseFunktionGibtEsNicht42"), false,
	"istErreichbar haelt selbst erfundene Namen fuer vorhanden -- die Pruefung ist wirkungslos.");

console.log(`ok - ecosystem-stapel-nachbarn (${gefragt.size} Nachbarnamen geprueft)`);
