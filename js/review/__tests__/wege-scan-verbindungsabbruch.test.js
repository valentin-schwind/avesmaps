// 🔴 Ein Cursor-Lauf des Wege-Panels muss eine GERISSENE VERBINDUNG ueberleben -- und jede Meldung
// dieser Datei muss sagen, WELCHE Anfrage gestorben ist.
//
// Vorgeschichte (24.08.2026): Der Owner zeichnete eine derographische Flaeche; ueber der Wegeliste
// stand danach „Fehler: NetworkError when attempting to fetch resource." Die Liste selbst war intakt.
// Das Zeichnen fasst das Wege-Panel nicht an, und review-path-sync.js hat weder Timer noch Poll --
// es lief also ein Scan im Hintergrund weiter, dessen Verbindung mitten im Lauf abriss. Zwei Maengel
// steckten dahinter, beide hier festgenagelt:
//
//   1. 💣 Der Scan kannte STRATO nur halb. Fuer „Server hat sein Zeitbudget verbraucht" (Seite
//      kommt zurueck, aber der Cursor rueckt nicht vor) gab es drei Versuche mit Wartezeit. Fuer
//      eine ABGERISSENE VERBINDUNG gab es nichts: ein einziger Abbruch warf den ganzen Lauf weg --
//      auf einem Bestand, der Seite fuer Seite zu 50 Wegen laeuft und dessen Seiten serverseitig
//      15-25 Sekunden dauern duerfen, also nach Minuten Arbeit. Der Riegel sass auf dem falschen
//      Fehlerfall.
//   2. 💣 `pathSyncGet`/`pathSyncPost` machten `fetch(...).then(r => r.json())` -- ohne
//      `response.ok`, ohne Status, ohne Aktionsnamen. DREIZEHN Anfragestellen fielen damit auf
//      eine namenlose Meldung zusammen, und von aussen war nicht zu erkennen, welche es getroffen
//      hatte. Das Hausmuster steht nebenan in js/app/api-client.js und im Landschaften-Lader.
//
// ⭐ WARUM DIESER TEST DIE ECHTEN FUNKTIONEN FAEHRT statt den Quelltext zu lesen: review-path-sync.js
// ist ein Browser-Global-Skript (es ruft beim Laden `document.addEventListener` und
// `attachFilterMenu`). Es laesst sich aber in einem vm-Kontext mit gestellten Globals laden, und
// dann sind die `function`-Deklarationen als Sandbox-Globals greifbar. Eine Quelltextpruefung haette
// hier nur die Prosa zertifiziert -- die Falle, die AGENTS.md gleich mehrfach nennt.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/wege-scan-verbindungsabbruch.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-path-sync.js");

/**
 * Laedt review-path-sync.js in einen frischen vm-Kontext.
 *
 * `fetchStub` bekommt (url, init) und liefert entweder eine Antwort-Attrappe oder wirft.
 * Zurueck kommt die Sandbox: die `function`-Deklarationen der Datei liegen darin als Globals.
 *
 * 💣 `setTimeout` feuert hier SOFORT: die Wartezeiten des Laufs sind Sekunden, und ein Test, der
 * sie echt abwartet, wird entweder langsam oder (schlimmer) mit einem kuerzeren Wert gemessen als
 * dem, der live gilt.
 */
function ladeModul(fetchStub) {
	const statusFeld = { textContent: "" };
	const sandbox = {
		console,
		document: {
			addEventListener() {},
			getElementById(id) {
				return id === "path-sync-summary" ? statusFeld : null;
			},
			createElement() {
				return { textContent: "", innerHTML: "" };
			},
		},
		attachFilterMenu() {},
		apiErrorMessage: (daten, rueckfall) =>
			(daten && daten.error && daten.error.message) || rueckfall,
		SOURCE_FILTER_OPTIONS: [],
		pathData: [],
		showFeedbackToast() {},
		fetch: fetchStub,
		setTimeout: (fn) => {
			fn();
			return 0;
		},
		clearTimeout() {},
	};
	sandbox.window = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(fs.readFileSync(QUELLE, "utf8"), sandbox, { filename: "review-path-sync.js" });
	sandbox.__status = statusFeld;
	return sandbox;
}

/** Antwort-Attrappe mit JSON-Rumpf. */
function antwort(objekt, status = 200) {
	const text = JSON.stringify(objekt);
	return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) };
}

/** Antwort-Attrappe mit rohem (womoeglich leerem) Rumpf. */
function rohantwort(text, status) {
	return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) };
}

/** Der Wurf, den ein Browser bei gerissener Verbindung macht (Firefox-Wortlaut). */
function verbindungsabbruch() {
	return new TypeError("NetworkError when attempting to fetch resource.");
}

let bestanden = 0;
function pruefe(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => {
			bestanden += 1;
			console.log("  ok  " + name);
		})
		.catch((fehler) => {
			console.error("  FEHLGESCHLAGEN  " + name);
			console.error("      " + (fehler && fehler.message));
			process.exitCode = 1;
		});
}

// ---------------------------------------------------------------------------
// 1. Der Scan uebersteht einen Abbruch mitten im Lauf -- und verliert dabei nichts.
// ---------------------------------------------------------------------------
async function scanUeberstehtAbbruch() {
	const gerufen = [];
	let seiteZweiSchonGescheitert = false;
	const sandbox = ladeModul((url) => {
		gerufen.push(String(url));
		if (url.includes("cursor=0")) {
			return Promise.resolve(
				antwort({ ok: true, cases: [{ wiki_key: "a" }], scanned: 50, next_cursor: 50, complete: false })
			);
		}
		if (url.includes("cursor=50") && !seiteZweiSchonGescheitert) {
			seiteZweiSchonGescheitert = true;
			return Promise.reject(verbindungsabbruch());
		}
		return Promise.resolve(
			antwort({ ok: true, cases: [{ wiki_key: "b" }], scanned: 30, next_cursor: 80, complete: true })
		);
	});

	await sandbox.loadVerlaufCases();

	assert.strictEqual(
		sandbox.__status.textContent,
		"Verlauf-Prüfung abgeschlossen: 80 Wege geprüft, 2 Fälle.",
		"Der Lauf muss durchlaufen und BEIDE Seiten behalten haben -- gemeldet wurde: " +
			sandbox.__status.textContent
	);

	// 💣 Wiederholt wird DIESELBE Seite. Wer stattdessen mit `next_cursor` weitermacht, ueberspringt
	// die Seite, deren Antwort verloren ging -- der Lauf laeuft dann gruen durch und ist lueckenhaft.
	assert.deepStrictEqual(
		gerufen.map((u) => u.replace(/^.*cursor=/, "cursor=").replace(/&limit=\d+$/, "")),
		["cursor=0", "cursor=50", "cursor=50"],
		"Nach dem Abbruch muss cursor=50 ein zweites Mal geholt werden, nicht cursor=80."
	);
}

// ---------------------------------------------------------------------------
// 2. Wiederholt wird begrenzt -- ein dauerhaft toter Server haengt den Lauf nicht auf.
// ---------------------------------------------------------------------------
async function abbruchWirdNichtEndlosWiederholt() {
	// 💣 Die Notbremse ist kein Beiwerk. Faellt der Deckel im Quellcode weg, wiederholt der Lauf
	// ewig -- und der Test HINGE dann, statt zu melden (gemessen in der Mutationsprobe). Ein
	// haengender Test ist fast so schlecht wie ein gruener: die CI laeuft in ihr Zeitlimit und
	// niemand sieht, welche Zusicherung gebrochen ist.
	const NOTBREMSE = 12;
	let versuche = 0;
	const sandbox = ladeModul(() => {
		versuche += 1;
		// 🪤 Und sie darf nicht WERFEN: jeder Wurf aus `fetch` gilt dem Riegel als Transportfehler
		// und wird brav wiederholt -- die Bremse verschwaende dann im Geraet, das sie pruefen soll.
		// Sie beendet den Lauf stattdessen mit einer leeren, vollstaendigen Seite; die Zusicherung
		// auf die Versuchszahl unten schlaegt dann an.
		if (versuche > NOTBREMSE) {
			return Promise.resolve(antwort({ ok: true, cases: [], scanned: 0, next_cursor: 0, complete: true }));
		}
		return Promise.reject(verbindungsabbruch());
	});

	await sandbox.loadVerlaufCases();

	assert.ok(versuche >= 2, "Es muss mindestens einmal wiederholt werden, gezaehlt: " + versuche);
	assert.ok(versuche <= 5, "Die Wiederholung muss gedeckelt sein, gezaehlt: " + versuche);
	assert.ok(
		/^Fehler: /.test(sandbox.__status.textContent),
		"Nach dem Deckel muss der Lauf sich geschlagen geben: " + sandbox.__status.textContent
	);
	assert.ok(
		/[Vv]erbindung/.test(sandbox.__status.textContent),
		"Die Meldung muss den Verbindungsabbruch benennen, nicht nur den Browsertext: " +
			sandbox.__status.textContent
	);
}

// ---------------------------------------------------------------------------
// 3. Ein Transportfehler nennt die Aktion, die ihn ausgeloest hat.
// ---------------------------------------------------------------------------
async function transportfehlerNenntDieAktion() {
	const sandbox = ladeModul(() => Promise.reject(verbindungsabbruch()));
	await assert.rejects(
		() => sandbox.pathSyncGet("?action=outliers"),
		(fehler) => {
			assert.ok(
				fehler.message.includes("outliers"),
				"Die Meldung muss die Aktion nennen: " + fehler.message
			);
			return true;
		}
	);

	// Und dasselbe fuer den Schreibweg -- er hat die Aktion im Rumpf, nicht in der Adresse.
	await assert.rejects(
		() => sandbox.pathSyncPost({ action: "assign", wiki_key: "wiki:x" }),
		(fehler) => {
			assert.ok(
				fehler.message.includes("assign"),
				"Auch POST muss seine Aktion nennen: " + fehler.message
			);
			return true;
		}
	);
}

// ---------------------------------------------------------------------------
// 4. Ein leerer Rumpf ist der Fingerabdruck eines PHP-Abbruchs -- er muss den Status nennen.
//    (Genau diese Sorte kostete am 19.08.2026 einen Deploy: „Unexpected end of JSON input".)
// ---------------------------------------------------------------------------
async function leererRumpfNenntDenStatus() {
	const sandbox = ladeModul(() => Promise.resolve(rohantwort("", 500)));
	await assert.rejects(
		() => sandbox.pathSyncGet("?action=match&limit=5000"),
		(fehler) => {
			assert.ok(fehler.message.includes("500"), "Der HTTP-Status muss drinstehen: " + fehler.message);
			assert.ok(fehler.message.includes("match"), "Die Aktion muss drinstehen: " + fehler.message);
			return true;
		}
	);
}

// ---------------------------------------------------------------------------
// 5. 🔴 Der Riegel darf die GUTE Servermeldung nicht ueberschreiben.
//    Ein 401 traegt sauberes JSON („Du bist fuer diese Aktion nicht angemeldet.") -- wer hier auf
//    `response.ok` wirft, ersetzt einen lesbaren Satz durch „HTTP 401" und macht es schlechter.
// ---------------------------------------------------------------------------
async function serverMeldungUeberlebtDenRiegel() {
	const abgemeldet = {
		ok: false,
		error: { code: "unauthenticated", message: "Du bist fuer diese Aktion nicht angemeldet." },
	};
	const sandbox = ladeModul(() => Promise.resolve(antwort(abgemeldet, 401)));

	// ⚠️ Feldweise, nicht deepStrictEqual: der Datensatz entsteht per JSON.parse INNERHALB des
	// vm-Kontexts und traegt dessen Object.prototype -- ein Realm-Unterschied, kein Befund.
	const daten = await sandbox.pathSyncGet("?action=match&limit=5000");
	assert.strictEqual(
		daten && daten.ok,
		false,
		"Eine abgelaufene Sitzung muss als Datensatz durchkommen, damit apiErrorMessage sie lesen kann."
	);
	assert.strictEqual(daten.error.message, abgemeldet.error.message, "Die Servermeldung muss unveraendert ankommen.");

	// Und der Lauf daneben macht daraus die Meldung des Servers, nicht eine Statuszahl.
	await sandbox.loadPathWikiSync();
	assert.strictEqual(
		sandbox.__status.textContent,
		"Fehler: Du bist fuer diese Aktion nicht angemeldet.",
		"gemeldet wurde: " + sandbox.__status.textContent
	);
}

// ---------------------------------------------------------------------------
// 6. ⭐ EINE Umsetzung, zwei Nutzer. Die beiden Cursor-Laeufe der Datei sind Zwillinge; eine
//    Wiederholung, die nur in einem steht, ist keine Regel (AGENTS.md nennt genau diesen Fehler
//    mehrfach). Der Knopf des zweiten ist derzeit ausgebaut -- der Kommentar an seiner Klickstelle
//    warnt aber ausdruecklich davor, ihn ohne Nacharbeit wieder anzuhaengen.
// ---------------------------------------------------------------------------
function beideLaeufeTeilenDieWiederholung() {
	const quelle = fs
		.readFileSync(QUELLE, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((zeile) => !/^\s*\/\//.test(zeile))
		.join("\n");

	const helferName = "pathSyncScanSeite";
	const treffer = quelle.split(helferName + "(").length - 1;
	assert.ok(
		treffer >= 3,
		`Beide Cursor-Laeufe muessen ueber ${helferName}() gehen (Definition + zwei Aufrufe), gezaehlt: ${treffer}`
	);

	// Und keiner von beiden darf die Seite noch roh holen.
	assert.ok(
		!/const page = await pathSync(Get|Post)\(/.test(quelle),
		"Ein Cursor-Lauf holt seine Seite nicht mehr direkt -- sonst haengt er wieder am ersten Abbruch."
	);
}

(async () => {
	console.log("wege-scan-verbindungsabbruch");
	await pruefe("Scan uebersteht einen Abbruch und verliert nichts", scanUeberstehtAbbruch);
	await pruefe("Wiederholung ist gedeckelt und benennt sich", abbruchWirdNichtEndlosWiederholt);
	await pruefe("Transportfehler nennt die Aktion", transportfehlerNenntDieAktion);
	await pruefe("Leerer Rumpf nennt HTTP-Status und Aktion", leererRumpfNenntDenStatus);
	await pruefe("Servermeldung ueberlebt den Riegel", serverMeldungUeberlebtDenRiegel);
	await pruefe("Beide Cursor-Laeufe teilen die Wiederholung", beideLaeufeTeilenDieWiederholung);
	if (!process.exitCode) {
		console.log(`\n${bestanden} Zusicherungen bestanden.`);
	}
})();
