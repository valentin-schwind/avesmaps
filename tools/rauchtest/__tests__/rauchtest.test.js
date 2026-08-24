// Der Rauchtest: jeder Endpunkt wird EINMAL wirklich angefragt. Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/rauchtest/__tests__/rauchtest.test.js
//
// 🪤 WARUM ES IHN GIBT. Das Testfeld hatte am 24.08.2026 511 gruene Tests -- und NICHT EINER rief
// je einen Endpunkt auf. Zweimal binnen einer Woche ging deshalb ein Fatal live, und beide Male
// war das Fehlerbild dasselbe: HTTP 500 mit einem LEEREN RUMPF, im Browser als „Unexpected end of
// JSON input". Das liest sich wie ein Netzfehler und ist keiner. Gefunden hat es beide Male der
// Owner beim ersten Handgriff.
//
// 💣 WAS ER FAENGT -- und die Grenze gehoert hierher, damit ihn niemand fuer mehr haelt:
//   ✔ alles, was VOR oder BEIM Antworten stirbt: Parse-Fehler, fehlendes `require`, undefinierte
//     Funktion (der opcache-Fensterfall), `const` nach Benutzung, doppelte Deklaration. Gemessen:
//     alle drei ergeben HTTP 500 mit 0 Bytes, und `php -l` sieht davon nur den ersten.
//   ✘ einen LAUFZEITfehler INNERHALB des try-Blocks eines Endpunkts. Der Ausfall vom 24.08.
//     (map-features.php, HTTP 500 fuer jeden Besucher) lieferte laut Revert-Botschaft eine saubere
//     Huelle `{"code":"server_error"}` -- dieser Test haette ihn NICHT gefangen. Dafuer braucht es
//     eine echte Datenbank und die Zusicherung `ok:true`; das ist Stufe 1b in
//     docs/strukturbefund-2026-08-24.md.
//
// 🔴 OHNE DATENBANK, und das ist Absicht. `api/config.local.php` ist gitignoriert, existiert in CI
// also nicht -- die meisten Endpunkte antworten dann mit 500/503 und einer Fehlerhuelle. Genau das
// wird geprueft: nicht DASS sie arbeiten, sondern DASS sie ueberhaupt antworten koennen. Ein
// Endpunkt, der ohne Konfiguration einen leeren Rumpf liefert, liefert ihn auch, wenn die
// Konfiguration auf dem Server einmal fehlt -- und dann ohne jeden Hinweis.
//
// 🔧 WENN 1b KOMMT (echte Datenbank in CI): dann laufen diese Endpunkte weiter als heute, und
// zwei Dinge sind vorher zu pruefen -- ob einer von ihnen VOR `avesmapsRequireUserWithCapability`
// Arbeit verrichtet (dann darf er nicht blind angefragt werden), und ob `api/edit/wiki/dump.php`
// dabei anfaengt, einen 40-MB-Dump zu holen.
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { starteServer, frage, WURZEL } = require("../php-server.js");

/**
 * 🔴 Die Liste wird ENTDECKT, nicht gepflegt. Eine handgefuehrte Liste veraltet beim ersten neuen
 * Endpunkt, und dann ist der Test gruen, weil er das Neue gar nicht kennt -- dieselbe Klasse wie
 * ein Kreis, der nur leer sein kann.
 */
function sammleEndpunkte() {
	const gefunden = [];

	const lauf = (verzeichnis) => {
		const voll = path.join(WURZEL, verzeichnis);
		if (!fs.existsSync(voll)) { return; }
		for (const eintrag of fs.readdirSync(voll, { withFileTypes: true })) {
			const relativ = path.posix.join(verzeichnis, eintrag.name);
			if (eintrag.isDirectory()) {
				// ⚠️ `_internal` und `__tests__` sind keine Endpunkte: das eine ist per .htaccess
				// gesperrte Bibliothek, das andere Testcode.
				if (eintrag.name === "__tests__" || eintrag.name === "_internal") { continue; }
				lauf(relativ);
			} else if (eintrag.name.endsWith(".php")) {
				gefunden.push("/" + relativ);
			}
		}
	};

	lauf("api/app");
	lauf("api/route");
	lauf("api/locations");
	lauf("api/edit");
	gefunden.push("/api/svg-export.php");

	return gefunden.sort();
}

/**
 * ⚠️ Die einzige dokumentierte Ausnahme von „antwortet JSON". `api/app/coat.php` ist ein
 * Bild-Proxy und sagt das in seiner eigenen Kopfzeile: „Liefert Bild-Bytes (kein JSON)". Sein
 * Fehlerfall ist deshalb ein Klartextsatz. Er wird trotzdem angefragt -- auf leeren Rumpf und
 * ausgelaufene PHP-Meldungen, nur nicht auf die Huelle.
 *
 * 🔴 Wer hier etwas ergaenzt, begruendet es. Eine Ausnahmeliste ist die bequemste Art, einen
 * Test gruen zu halten, der etwas gefunden hat.
 */
const KEINE_JSON_HUELLE = new Set(["/api/app/coat.php"]);

/**
 * 💣 Wonach gesucht wird, wenn PHP seine Innereien in den Rumpf schreibt. Ein halber Fatal --
 * einer, bei dem die Ausgabe schon begonnen hatte -- liefert gueltiges JSON MIT einer
 * Fehlermeldung davor oder dahinter, und das faellt sonst niemandem auf.
 */
const PHP_MELDUNG = /(Fatal error|Parse error|Warning:|Notice:|Deprecated:|Uncaught \w+|<br \/>\n<b>)/;

(async () => {
	const endpunkte = sammleEndpunkte();
	assert.ok(
		endpunkte.length > 60,
		`der Sammler findet Endpunkte (gefunden: ${endpunkte.length}) -- sonst prueft dieser Test nichts`
	);
	assert.ok(endpunkte.includes("/api/app/map-features.php"), "der wichtigste Endpunkt ist dabei");
	assert.ok(endpunkte.includes("/api/route/index.php"), "der stabile Vertrag ist dabei");

	const server = await starteServer();
	const befunde = [];
	let protokollText = "";
	let geprueft = 0;

	try {
		for (const pfad of endpunkte) {
			let antwort;
			try {
				antwort = await frage(server.port, pfad);
			} catch (fehler) {
				befunde.push({ pfad, text: `${pfad}\n    ${fehler.message}` });
				continue;
			}
			geprueft += 1;

			// 1. Ein leerer Rumpf ist das Fatal-Merkmal schlechthin.
			//
			// ⭐ Die eigentliche Diagnose steht im Protokoll von `php -S` (dort nennt PHP die
			// Ausnahme samt Datei und Zeile). Sie wird ERST NACH dem Lauf angehaengt: waehrend
			// der Schleife ist die Zeile oft noch nicht durchgereicht, und ein leeres
			// „Serverprotokoll:" waere schlimmer als keins -- es sieht aus, als haette PHP
			// nichts zu sagen gehabt.
			if (antwort.rumpf.length === 0) {
				befunde.push({
					pfad,
					text:
						`${pfad}\n    HTTP ${antwort.status} mit LEEREM RUMPF.\n` +
						`    Das ist die Signatur eines Fatal Errors -- im Browser „Unexpected end of JSON input".\n` +
						`    Meist ein bar aufgerufenes avesmapsLoadApiConfig(), eine undefinierte Funktion\n` +
						`    oder eine const nach ihrer Benutzung.`,
				});
				continue;
			}

			// 2. Kein 404: ein Endpunkt, den es nicht mehr gibt, ist ein gebrochener Vertrag --
			//    und der Deploy loescht nie, also merkt es sonst niemand.
			if (antwort.status === 404) {
				befunde.push({ pfad, text: `${pfad}\n    HTTP 404 -- die Datei ist weg oder umbenannt.` });
				continue;
			}

			// 3. Keine ausgelaufenen PHP-Meldungen im Rumpf.
			if (PHP_MELDUNG.test(antwort.rumpf)) {
				befunde.push({ pfad, text:
					`${pfad}\n    HTTP ${antwort.status}, aber im Rumpf steht eine PHP-Meldung:\n` +
					`    ${antwort.rumpf.slice(0, 200).replace(/\n/g, " ")}` });
				continue;
			}

			if (KEINE_JSON_HUELLE.has(pfad)) { continue; }

			// 4. Die Huelle des Vertrags (api/README.md): ok:true, oder ok:false MIT error.code.
			let nutzlast;
			try {
				nutzlast = JSON.parse(antwort.rumpf);
			} catch {
				befunde.push({ pfad, text:
					`${pfad}\n    HTTP ${antwort.status}, aber der Rumpf ist kein JSON:\n` +
					`    ${antwort.rumpf.slice(0, 200).replace(/\n/g, " ")}` });
				continue;
			}
			if (typeof nutzlast?.ok !== "boolean") {
				befunde.push({ pfad, text: `${pfad}\n    HTTP ${antwort.status}: die Antwort hat kein boolesches "ok".` });
				continue;
			}
			if (nutzlast.ok === false && typeof nutzlast?.error?.code !== "string") {
				befunde.push({ pfad, text:
					`${pfad}\n    HTTP ${antwort.status}: ok:false ohne error.code.\n` +
					`    Der Vertrag (api/README.md) verlangt { ok:false, error:{ code, message } }.` });
			}
		}
		// Dem Protokoll einen Moment geben, bevor es gelesen wird.
		if (befunde.length > 0) { await new Promise((f) => setTimeout(f, 250)); }
	} finally {
		if (befunde.length > 0) { protokollText = server.protokoll(); }
		server.stop();
	}

	if (befunde.length > 0) {
		const protokollZu = (pfad) => protokollText
			.split("\n")
			.filter((zeile) => zeile.includes(pfad) && /error|Uncaught|Fatal/i.test(zeile))
			.slice(-1)[0];

		process.stderr.write(
			`\nRAUCHTEST: ${befunde.length} von ${endpunkte.length} Endpunkten antworten nicht sauber.\n\n` +
			befunde.map((b) => {
				const zeile = protokollZu(b.pfad);
				return "  " + b.text + (zeile ? `\n    php -S sagt: ${zeile.replace(/^\[[^\]]*\] /, "").trim()}` : "");
			}).join("\n\n") + "\n\n"
		);
		process.exit(1);
	}

	console.log(`rauchtest ok (${geprueft} Endpunkte angefragt, alle mit Rumpf und Huelle)`);
})().catch((fehler) => {
	process.stderr.write(`\nRAUCHTEST konnte nicht laufen:\n${fehler.stack || fehler.message}\n\n`);
	process.exit(1);
});
