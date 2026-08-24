// 🔴 Die HANDLUNGS-Verben des Wege-Panels muessen einen Verbindungsabbruch ueberleben -- genauso
// wie die Laeufe daneben es seit dem 24.08.2026 tun.
//
// Vorgeschichte: b0f897d2 reparierte an dieser Datei den DIAGNOSEweg (pathSyncRequest benennt
// Aktion und HTTP-Status, pathSyncScanSeite wiederholt eine gerissene Seite). Drei Verben waren
// bewusst nicht Teil jenes Auftrags und blieben unberuehrt -- `approveOutlier`, `detachOutlier` und
// `reopenOutlier` hatten KEIN try/catch um ihren `await pathSyncPost(...)`.
//
// 💣 WARUM DAS SCHLIMMER IST ALS EIN FEHLENDER FEHLERTEXT: alle drei werden mit `void verb(...)`
// aus dem Klick-Handler gerufen. Ein Wurf wird damit zu einer unbehandelten Promise-Ablehnung --
// sie landet in der Browser-Konsole und NIRGENDWO SONST. Die Statuszeile `#path-sync-summary`
// bleibt unberuehrt, die Liste bleibt stehen, und der Editor klickt „gehoert zum Weg" bzw. „wieder
// oeffnen", sieht keinerlei Widerspruch und haelt es fuer erledigt. Geschrieben wurde nichts.
// Der `!result || result.ok !== true`-Zweig darunter meldete von Anfang an sauber -- es fehlte
// genau der Fall, in dem die Anfrage GAR NICHT ERST ZURUECKKOMMT.
//
// 💣 Und bei `detachOutlier` kostet der Wurf mehr als die Meldung. Seine Schleife loest Segment fuer
// Segment (nacheinander, nie parallel -- der generische Name wird frisch aus der Datenbank gelesen).
// Reisst die Verbindung beim ZWEITEN von drei, dann IST das erste geloest; der Wurf sprang aber ueber
// den ganzen Rest der Funktion -- ueber den Toast, der den halben Stand nennt, UND ueber das
// `loadOutliers()`, das die Liste auf diesen halben Stand zieht. Der Editor sah die alte Liste und
// haette die Loesung ein zweites Mal ausgeloest. Genau diese Zusicherung traegt der `!ok`-Zweig
// bereits ausdruecklich („Abbrechen, aber NICHT zurueckkehren"), und der Wurf umging sie.
//
// ⭐ WARUM DIESER TEST DIE ECHTEN FUNKTIONEN FAEHRT statt den Quelltext zu lesen: review-path-sync.js
// ist ein Browser-Global-Skript, laesst sich aber in einem vm-Kontext mit gestellten Globals laden --
// dann sind seine `function`-Deklarationen als Sandbox-Globals greifbar. Dieselbe Bauform wie
// wege-scan-verbindungsabbruch.test.js nebenan. Eine Quelltextpruefung auf „steht da ein try?"
// haette nur die Prosa zertifiziert (AGENTS.md nennt die Falle mehrfach) -- und sie haette den
// halben Stand von `detachOutlier` ueberhaupt nicht messen koennen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/wege-verben-verbindungsabbruch.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const QUELLE = path.join(ROOT, "js", "review", "review-path-sync.js");

/**
 * Laedt review-path-sync.js in einen frischen vm-Kontext.
 *
 * `fetchStub` bekommt (url, init) und liefert eine Antwort-Attrappe oder wirft.
 * Zurueck kommt die Sandbox; zusaetzlich haengen daran `__status` (die Statuszeile) und
 * `__toasts` (alles, was showFeedbackToast bekommen hat).
 *
 * 💣 `setTimeout` feuert SOFORT: die Wartezeiten der Laeufe sind Sekunden, und ein Test, der sie
 * echt abwartet, wird entweder langsam oder (schlimmer) mit einem kuerzeren Wert gemessen als dem,
 * der live gilt.
 */
function ladeModul(fetchStub, options = {}) {
	const statusFeld = { textContent: "" };
	const toasts = [];
	const sandbox = {
		console,
		document: {
			addEventListener() {},
			getElementById(id) {
				return id === "path-sync-summary" ? statusFeld : null;
			},
			querySelector() {
				return null;
			},
			querySelectorAll() {
				return [];
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
		showFeedbackToast(text, art) {
			toasts.push({ text: String(text), art });
		},
		// Beide Rueckfragen von detachOutlier (und die von applyVerlaufCase/assignPathWiki) werden
		// bejaht -- geprueft wird, was NACH dem Ja passiert.
		confirm: () => (options.confirm === undefined ? true : options.confirm),
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
	sandbox.__toasts = toasts;
	// 🪤 `let`/`const` auf oberster Ebene werden im vm-Kontext KEINE Eigenschaften der Sandbox --
	// nur Funktionsdeklarationen. Modulzustand laesst sich deshalb nur von INNEN setzen.
	sandbox.__setze = (ausdruck) => vm.runInContext(ausdruck, sandbox);
	return sandbox;
}

/** Antwort-Attrappe mit JSON-Rumpf. */
function antwort(objekt, status = 200) {
	const text = JSON.stringify(objekt);
	return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) };
}

/** Der Wurf, den ein Browser bei gerissener Verbindung macht (Firefox-Wortlaut). */
function verbindungsabbruch() {
	return new TypeError("NetworkError when attempting to fetch resource.");
}

/** Was in einem POST-Rumpf als `action` steht. */
function aktionAus(init) {
	try {
		return JSON.parse(String((init && init.body) || "{}")).action || "";
	} catch (fehler) {
		return "";
	}
}

/** Warten, bis die per `void` angestossenen Nachlaeufe durch sind. */
function tickAbwarten() {
	return new Promise((resolve) => setImmediate(resolve));
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
// 1. „gehoert zum Weg" bei gerissener Verbindung: kein stiller Wurf, sondern eine Meldung.
// ---------------------------------------------------------------------------
async function approveMeldetDenAbbruch() {
	let gefragt = 0;
	const sandbox = ladeModul(() => {
		gefragt += 1;
		return Promise.reject(verbindungsabbruch());
	});

	// 💣 DIE ZUSICHERUNG: die Zusage darf nicht ABLEHNEN. Der Klick-Handler ruft
	// `void approveOutlier(...)` -- eine Ablehnung waere von aussen unsichtbar.
	await assert.doesNotReject(
		() => sandbox.approveOutlier("wiki:eisenstrasse", "fp-1", "Eisenstraße"),
		"approveOutlier darf bei gerissener Verbindung nicht unbehandelt werfen -- der Klick-Handler ruft sie mit `void`."
	);

	// ⚠️ Gegenprobe gegen die trivial erfuellte Zusicherung: die Funktion muss ueberhaupt gefragt
	// haben. Waere sie an einem Riegel frueh zurueckgekehrt, waere „lehnt nicht ab" wertlos.
	assert.strictEqual(gefragt, 1, "Es muss genau eine Anfrage versucht worden sein, gezaehlt: " + gefragt);

	assert.ok(
		/^Fehler: /.test(sandbox.__status.textContent),
		"Die Statuszeile muss den Fehlschlag tragen, sie sagt: " + sandbox.__status.textContent
	);
	assert.ok(
		/[Vv]erbindung/.test(sandbox.__status.textContent),
		"Die Meldung muss den Verbindungsabbruch benennen: " + sandbox.__status.textContent
	);
	assert.ok(
		sandbox.__status.textContent.includes("approve_outlier"),
		"Und sie muss die Aktion nennen, wie jede andere Meldung dieser Datei: " + sandbox.__status.textContent
	);
}

// ---------------------------------------------------------------------------
// 2. „wieder oeffnen" -- dieselbe Zusicherung. Zwei Verben, eine Regel.
// ---------------------------------------------------------------------------
async function reopenMeldetDenAbbruch() {
	let gefragt = 0;
	const sandbox = ladeModul(() => {
		gefragt += 1;
		return Promise.reject(verbindungsabbruch());
	});

	await assert.doesNotReject(
		() => sandbox.reopenOutlier("fp-1"),
		"reopenOutlier darf bei gerissener Verbindung nicht unbehandelt werfen."
	);
	assert.strictEqual(gefragt, 1, "Es muss genau eine Anfrage versucht worden sein, gezaehlt: " + gefragt);
	assert.ok(
		/^Fehler: .*[Vv]erbindung/.test(sandbox.__status.textContent),
		"Die Statuszeile muss den Verbindungsabbruch tragen: " + sandbox.__status.textContent
	);
	assert.ok(
		sandbox.__status.textContent.includes("reopen_outlier"),
		"Und die Aktion nennen: " + sandbox.__status.textContent
	);
}

// ---------------------------------------------------------------------------
// 3. „gehoert nicht zum Weg", Abbruch beim ERSTEN Segment: nichts geloest, gemeldet.
// ---------------------------------------------------------------------------
async function detachMeldetDenAbbruch() {
	let gefragt = 0;
	const sandbox = ladeModul((url, init) => {
		if (aktionAus(init) === "clear_assign") {
			gefragt += 1;
			return Promise.reject(verbindungsabbruch());
		}
		return Promise.resolve(antwort({ ok: true, outliers: [] }));
	});

	await assert.doesNotReject(
		() => sandbox.detachOutlier("wiki:eisenstrasse", "pfad-1", "Eisenstraße", false),
		"detachOutlier darf bei gerissener Verbindung nicht unbehandelt werfen."
	);
	assert.strictEqual(gefragt, 1, "Genau ein Loesungsversuch, gezaehlt: " + gefragt);
	assert.ok(
		/^Fehler: .*[Vv]erbindung/.test(sandbox.__status.textContent),
		"Die Statuszeile muss den Verbindungsabbruch tragen: " + sandbox.__status.textContent
	);
	// Nichts ist geloest -> es darf auch kein Erfolgs-Toast erscheinen.
	assert.deepStrictEqual(
		sandbox.__toasts.map((t) => t.art),
		[],
		"Ohne ein einziges geloestes Segment darf kein Erfolgs-Toast kommen: " + JSON.stringify(sandbox.__toasts)
	);
}

// ---------------------------------------------------------------------------
// 4. 💣 DER TEURE FALL: Abbruch beim ZWEITEN von drei Segmenten.
//    Das erste IST geloest. Der Wurf sprang ueber Toast UND Neuladen -- der Editor sah die alte
//    Liste und haette dasselbe Segment ein zweites Mal geloest. Der `!ok`-Zweig daneben traegt
//    diese Zusicherung ausdruecklich („Abbrechen, aber NICHT zurueckkehren"); der Abbruch umging sie.
// ---------------------------------------------------------------------------
async function detachZeigtDenHalbenStand() {
	const geloest = [];
	let neuGeladen = 0;
	const sandbox = ladeModul((url, init) => {
		if (aktionAus(init) === "clear_assign") {
			if (geloest.length === 1) {
				// Die Verbindung reisst NACH dem ersten, VOR dem zweiten.
				return Promise.reject(verbindungsabbruch());
			}
			geloest.push(JSON.parse(String(init.body)).public_id);
			return Promise.resolve(antwort({ ok: true, generic_name: "Straße-417" }));
		}
		if (String(url).includes("action=outliers")) {
			neuGeladen += 1;
			return Promise.resolve(antwort({ ok: true, outliers: [] }));
		}
		return Promise.resolve(antwort({ ok: true }));
	});

	await assert.doesNotReject(
		() => sandbox.detachOutlier("wiki:eisenstrasse", "pfad-1,pfad-2,pfad-3", "Eisenstraße", false),
		"detachOutlier darf auch mitten in der Schleife nicht unbehandelt werfen."
	);

	assert.deepStrictEqual(geloest, ["pfad-1"], "Genau das erste Segment ist geloest, gezaehlt: " + JSON.stringify(geloest));
	assert.ok(
		/^Fehler: .*[Vv]erbindung/.test(sandbox.__status.textContent),
		"Der Abbruch muss gemeldet sein: " + sandbox.__status.textContent
	);
	// 💣 Und der halbe Stand muss SICHTBAR werden -- sonst haelt der Editor „nichts passiert" fuer wahr.
	assert.deepStrictEqual(
		sandbox.__toasts.map((t) => t.art),
		["success"],
		"Der halbe Stand braucht seinen Toast: " + JSON.stringify(sandbox.__toasts)
	);
	assert.ok(
		/Straße-417/.test(sandbox.__toasts[0].text),
		"Der Toast nennt den neuen generischen Namen des geloesten Segments: " + sandbox.__toasts[0].text
	);

	await tickAbwarten();
	assert.strictEqual(
		neuGeladen,
		1,
		"Die Liste muss auf den halben Stand nachgezogen werden, sonst zeigt sie den alten -- gezaehlt: " + neuGeladen
	);
}

// ---------------------------------------------------------------------------
// 5. `assignPathWikiToTarget` hat seinen Catch bereits -- hier festgenagelt, damit ihn niemand
//    „aufraeumt". Sie meldet ueber den Toast, nicht ueber die Statuszeile: sie laeuft aus dem
//    Karten-Klick heraus, wo die Statuszeile des Panels ausser Sicht sein kann.
// ---------------------------------------------------------------------------
async function assignZuZielMeldetUeberToast() {
	let gefragt = 0;
	const sandbox = ladeModul(() => {
		gefragt += 1;
		return Promise.reject(verbindungsabbruch());
	});

	await assert.doesNotReject(
		() => sandbox.assignPathWikiToTarget("wiki:eisenstrasse", "pfad-1"),
		"assignPathWikiToTarget darf nicht unbehandelt werfen."
	);
	assert.strictEqual(gefragt, 1, "Es muss genau eine Anfrage versucht worden sein, gezaehlt: " + gefragt);
	assert.strictEqual(sandbox.__toasts.length, 1, "Genau ein Toast: " + JSON.stringify(sandbox.__toasts));
	assert.strictEqual(sandbox.__toasts[0].art, "error", "und zwar ein Fehler-Toast.");
	assert.ok(
		/[Vv]erbindung/.test(sandbox.__toasts[0].text),
		"Er muss den Verbindungsabbruch benennen: " + sandbox.__toasts[0].text
	);
}

// ---------------------------------------------------------------------------
// 6. ⭐ DER RUNDUMSCHLAG. AGENTS.md nennt an einem halben Dutzend Stellen dieselbe Lehre: eine
//    Regel, die einen von mehreren Erzeugern bindet, ist keine Regel. Also wird JEDES Verb dieser
//    Datei, das eine Anfrage abwartet, gegen einen toten Server gefahren -- und muss dabei
//    (a) seine Zusage einloesen statt abzulehnen und (b) den Abbruch irgendwo BENENNEN.
//
//    ⚠️ Gegen die trivial erfuellte Zusicherung: jedes Verb muss nachweislich GEFRAGT haben. Ein
//    Verb, das an einem Riegel frueh zurueckkehrt, bekaeme „lehnt nicht ab" sonst geschenkt.
// ---------------------------------------------------------------------------
const VERBEN = [
	{ name: "loadPathWikiSync", fahren: (s) => s.loadPathWikiSync() },
	{ name: "loadOutliers", fahren: (s) => s.loadOutliers() },
	{ name: "loadVerlaufCases", fahren: (s) => s.loadVerlaufCases() },
	{ name: "approveOutlier", fahren: (s) => s.approveOutlier("wiki:x", "fp-1", "Weg") },
	{ name: "detachOutlier", fahren: (s) => s.detachOutlier("wiki:x", "pfad-1", "Weg", false) },
	{ name: "reopenOutlier", fahren: (s) => s.reopenOutlier("fp-1") },
	{ name: "applyVerlaufCase", fahren: (s) => s.applyVerlaufCase("wiki:x") },
	{ name: "setVerlaufCaseStatus", fahren: (s) => s.setVerlaufCaseStatus("wiki:x", "defer_verlauf_case") },
	{
		name: "applyAllCleanVerlaufCases",
		vorbereiten: (s) => s.__setze('verlaufCases = [{ status: "open", clean: true, wiki_key: "wiki:x", name: "X" }];'),
		fahren: (s) => s.applyAllCleanVerlaufCases(),
	},
	{ name: "assignPathWiki", fahren: (s) => s.assignPathWiki("wiki:x") },
	{ name: "assignPathWikiToTarget", fahren: (s) => s.assignPathWikiToTarget("wiki:x", "pfad-1") },
];

async function jedesVerbUeberlebtDenTotenServer() {
	const kaputt = [];
	for (const verb of VERBEN) {
		let gefragt = 0;
		const sandbox = ladeModul(() => {
			gefragt += 1;
			return Promise.reject(verbindungsabbruch());
		});
		assert.strictEqual(
			typeof sandbox[verb.name],
			"function",
			`${verb.name} gibt es nicht (mehr) -- die Liste dieses Tests ist veraltet.`
		);
		if (verb.vorbereiten) {
			verb.vorbereiten(sandbox);
		}

		let abgelehnt = null;
		try {
			await verb.fahren(sandbox);
		} catch (fehler) {
			abgelehnt = fehler;
		}
		await tickAbwarten();

		const gemeldet = [sandbox.__status.textContent, ...sandbox.__toasts.map((t) => t.text)].join(" | ");
		if (abgelehnt) {
			kaputt.push(`${verb.name}: hat ABGELEHNT (${abgelehnt.message}) -- als void-Ruf waere das eine unbehandelte Ablehnung.`);
		} else if (gefragt === 0) {
			kaputt.push(`${verb.name}: hat gar nicht erst gefragt -- die Zusicherung waere trivial erfuellt.`);
		} else if (!/[Vv]erbindung/.test(gemeldet)) {
			kaputt.push(`${verb.name}: hat den Abbruch verschluckt, gemeldet wurde: ${gemeldet}`);
		}
	}
	assert.deepStrictEqual(kaputt, [], "\n  - " + kaputt.join("\n  - "));
}

(async () => {
	console.log("wege-verben-verbindungsabbruch");
	await pruefe("approveOutlier meldet den Abbruch", approveMeldetDenAbbruch);
	await pruefe("reopenOutlier meldet den Abbruch", reopenMeldetDenAbbruch);
	await pruefe("detachOutlier meldet den Abbruch beim ersten Segment", detachMeldetDenAbbruch);
	await pruefe("detachOutlier zeigt den halben Stand", detachZeigtDenHalbenStand);
	await pruefe("assignPathWikiToTarget meldet ueber den Toast", assignZuZielMeldetUeberToast);
	await pruefe("Jedes Verb ueberlebt den toten Server", jedesVerbUeberlebtDenTotenServer);
	if (!process.exitCode) {
		console.log(`\n${bestanden} Zusicherungen bestanden.`);
	}
})();
