// Ein Sperr-Timer entsteht nur fuer eine Sperre, die es beim Eintreffen der Antwort noch gibt --
// und er stoppt, wenn das Objekt weg ist oder jemand anders es haelt.
//
// 💣 Bestaetigt 03.09.2026 im Editor: acquireFeatureSoftLock(id) + sofort releaseFeatureSoftLock(id)
// liess den 45-s-Wecker fuer immer stehen (der Eintrag in activeFeatureLocks kam erst NACH dem await).
// Jeder Tick war ein POST mit zwei CREATE TABLE IF NOT EXISTS. Der Test FAEHRT beide Funktionen.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/sperr-timer-race.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};
const tick = () => new Promise((r) => setImmediate(r));

const quelle = lies("js/map-features/map-features-feature-state.js");

// --- Umgebung -----------------------------------------------------------------------------------
global.IS_EDIT_MODE = true;
global.isSqlMapFeatureId = () => true;
global.activeFeatureLocks = new Map();
global.showFeedbackToast = () => {};
const warnungen = [];
global.console = { warn: (m) => warnungen.push(String(m)), log: console.log, error: console.error };
const timer = [];
const geloescht = [];
global.window = {
	setInterval: (fn, ms) => { timer.push({ fn, ms }); return timer.length; },
	clearInterval: (id) => { geloescht.push(id); },
};
const anfragen = [];
global.submitMapFeatureEdit = (payload) => new Promise((res, rej) => { anfragen.push({ payload, res, rej }); });
const letzte = () => anfragen[anfragen.length - 1];

vm.runInThisContext(schnitt(quelle, "function avesmapsFeatureLockIstVerloren", "}"));
vm.runInThisContext(schnitt(quelle, "async function acquireFeatureSoftLock", "}"));
vm.runInThisContext(schnitt(quelle, "async function releaseFeatureSoftLock", "}"));

(async () => {
	// 1) Die Race: freigeben, waehrend die Anfrage laeuft.
	void acquireFeatureSoftLock("a");
	assert.strictEqual(activeFeatureLocks.has("a"), true, "der Platzhalter steht VOR dem await");
	assert.strictEqual(activeFeatureLocks.get("a"), null, "und er ist ein Platzhalter, kein Timer");
	void releaseFeatureSoftLock("a");
	assert.strictEqual(activeFeatureLocks.has("a"), false, "das Freigeben nimmt den Platzhalter");
	assert.strictEqual(anfragen.length, 1, "das Freigeben schickt waehrend der Anfrage NICHTS -- acquire loest selbst");
	letzte().res({ ok: true });
	await tick(); await tick();
	assert.strictEqual(timer.length, 0, "kein Wecker fuer eine schon freigegebene Sperre");
	assert.strictEqual(anfragen.length, 2, "die Serversperre wird nach der Antwort geloest");
	assert.strictEqual(letzte().payload.action, "release_lock");
	letzte().res({ ok: true });
	await tick();

	// 2) Der Normalfall: Wecker kommt, Freigeben loescht ihn und loest die Serversperre.
	void acquireFeatureSoftLock("b");
	letzte().res({ ok: true });
	await tick(); await tick();
	assert.strictEqual(timer.length, 1, "ein Wecker");
	assert.strictEqual(timer[0].ms, 45000, "alle 45 s");
	assert.strictEqual(activeFeatureLocks.get("b"), 1, "die Kennung steht in der Liste");
	void releaseFeatureSoftLock("b");
	assert.deepStrictEqual(geloescht, [1], "clearInterval mit der Kennung");
	assert.strictEqual(letzte().payload.action, "release_lock");
	assert.strictEqual(letzte().payload.public_id, "b");
	letzte().res({ ok: true });
	await tick();

	// 3) Ein fehlgeschlagenes Anfordern raeumt den Platzhalter und wirft weiter.
	let geworfen = null;
	const p = acquireFeatureSoftLock("c").catch((e) => { geworfen = e; });
	letzte().rej(new Error("Dieses Objekt ist gerade gesperrt."));
	await p;
	assert.ok(geworfen, "der Fehler kommt beim Aufrufer an");
	assert.strictEqual(activeFeatureLocks.has("c"), false, "kein Platzhalter nach dem Fehlschlag");

	// 4) Der Wecker stoppt, wenn das Objekt weg ist ...
	void acquireFeatureSoftLock("d");
	letzte().res({ ok: true });
	await tick(); await tick();
	const weckerD = timer[timer.length - 1];
	const kennungD = activeFeatureLocks.get("d");
	weckerD.fn();
	letzte().rej(new Error("Das Kartenobjekt wurde nicht gefunden."));
	await tick(); await tick();
	assert.ok(geloescht.includes(kennungD), "Wecker geloescht: das Objekt gibt es nicht mehr");
	assert.strictEqual(activeFeatureLocks.has("d"), false, "und aus der Liste genommen");

	// 5) ... und wenn jemand anders sie haelt ...
	void acquireFeatureSoftLock("e");
	letzte().res({ ok: true });
	await tick(); await tick();
	const kennungE = activeFeatureLocks.get("e");
	timer[timer.length - 1].fn();
	letzte().rej(new Error("Dieses Kartenobjekt wird gerade von Nottel bearbeitet."));
	await tick(); await tick();
	assert.ok(geloescht.includes(kennungE), "Wecker geloescht: die Sperre gehoert jemand anderem");

	// 6) ... aber NICHT bei einem Netzfehler (der naechste Tick darf es wieder versuchen).
	void acquireFeatureSoftLock("f");
	letzte().res({ ok: true });
	await tick(); await tick();
	const kennungF = activeFeatureLocks.get("f");
	timer[timer.length - 1].fn();
	letzte().rej(new Error("Failed to fetch"));
	await tick(); await tick();
	assert.ok(!geloescht.includes(kennungF), "Netzfehler -> Wecker bleibt");
	assert.strictEqual(activeFeatureLocks.get("f"), kennungF, "und die Sperre bleibt gemerkt");

	// 7) Der reine Helfer.
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Das Kartenobjekt wurde nicht gefunden.")), true);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Dieses Kartenobjekt wird gerade von X bearbeitet.")), true);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(new Error("Failed to fetch")), false);
	assert.strictEqual(avesmapsFeatureLockIstVerloren(null), false);

	console.log("OK sperr-timer-race (7 Abschnitte)");
})().catch((error) => { console.error(error); process.exit(1); });
