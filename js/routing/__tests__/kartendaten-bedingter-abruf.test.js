// Der bedingte Abruf der Kartennutzlast -- loadRouteDataFromApi, wirklich ausgefuehrt.
//
// 🔴 WARUM NICHT NUR QUELLTEXT: die drei Wege dieser Funktion unterscheiden sich nicht in den
// Woertern, sondern im ABLAUF -- kalt (voll), warm (304 aus dem Speicher) und der Rueckfall, wenn
// der gemerkte Tag auf eine Nutzlast zeigt, die es nicht mehr gibt. Genau dieser dritte Weg ist der
// gefaehrliche: er ruft `abrufen` ein zweites Mal, und ohne den Riegel darin waere das ein Kreis.
// Ein Quelltext-Test sieht so etwas nie.
//
// 💣 UND EINE ZAEHLUNG IST TRAGEND: es darf in JEDEM Fall genau EINE Anfrage an map-features.php
// geben. Zwei waeren schlechter als der Zustand vor dem ganzen Umbau (die Nutzlast reist doppelt),
// und im warmen Fall traegt genau eine davon den `If-None-Match`.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/kartendaten-bedingter-abruf.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: Arbeitskopie CRLF, Deploy-Tor LF.
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const NUTZLAST = JSON.stringify({
	type: "FeatureCollection",
	revision: 92791,
	features: [{ id: "a" }, { id: "b" }, { id: "c" }],
});
const TAG = 'W/"mf-17-92791-c8c2259337"';

// Eine Antwort, wie fetch sie liefert.
function antwort(status, koepfe, rumpf) {
	const k = new Map(Object.entries(koepfe || {}));
	return {
		status,
		ok: status >= 200 && status < 300,
		headers: { get: (n) => (k.has(n) ? k.get(n) : null) },
		text: () => Promise.resolve(rumpf || ""),
	};
}

// Die Funktion in einer Umgebung fahren, die wir vollstaendig in der Hand haben.
function fahre(lage) {
	const anfragen = [];
	const abgelegt = [];
	const vergessen = [];
	const zusammenhang = {
		console: { info() {} },
		URL,
		Promise,
		Error,
		JSON,
		Array,
		window: { location: { href: "https://avesmaps.de/" } },
		MAP_FEATURES_API_URL: "api/app/map-features.php",
		IS_EDIT_MODE: lage.editModus === true,
		avesmapsKartendatenTagLesen: () => lage.gemerkterTag || "",
		avesmapsKartendatenLesen: (tag) => Promise.resolve(lage.imSpeicher && lage.imSpeicher[tag] ? JSON.parse(lage.imSpeicher[tag]) : null),
		avesmapsKartendatenVergessen: () => { vergessen.push(true); return Promise.resolve(true); },
		avesmapsKartendatenSpaeterAblegen: (tag, text) => abgelegt.push({ tag, laenge: text.length }),
		fetch: (adresse, optionen) => {
			anfragen.push({ adresse, kopf: (optionen && optionen.headers && optionen.headers["If-None-Match"]) || null });
			return Promise.resolve(lage.antworten.shift());
		},
	};
	zusammenhang.globalThis = zusammenhang;
	vm.createContext(zusammenhang);
	vm.runInContext(schnitt(lies("js/routing/routing.js"), "function loadRouteDataFromApi", "}"), zusammenhang);
	return { lauf: zusammenhang.loadRouteDataFromApi(), anfragen, abgelegt, vergessen };
}

(async () => {
	// --- 1) KALT: kein gemerkter Tag -> eine Anfrage OHNE Kopfzeile, 200, Nutzlast wird abgelegt --
	{
		const l = fahre({ gemerkterTag: "", antworten: [antwort(200, { "X-Avesmaps-ETag": TAG }, NUTZLAST)] });
		const data = await l.lauf;
		assert.strictEqual(l.anfragen.length, 1, "💣 Kalt darf es genau EINE Anfrage geben.");
		assert.strictEqual(l.anfragen[0].kopf, null,
			"🔴 Ohne gemerkten Tag darf KEINE eigene Kopfzeile mitreisen -- sonst verfehlt sie den Vorabruf.");
		assert.strictEqual(data.features.length, 3, "die Nutzlast kommt durch");
		assert.strictEqual(data.avesmapsSource.label, "SQL", "und traegt ihre Herkunft");
		assert.strictEqual(data.avesmapsSource.revision, 92791, "samt Revision");
		assert.deepStrictEqual(l.abgelegt, [{ tag: TAG, laenge: NUTZLAST.length }],
			"die volle Nutzlast wird unter ihrem Tag abgelegt");
	}

	// --- 2) WARM: gemerkter Tag -> eine bedingte Anfrage, 304, Hydrierung aus dem Speicher --------
	{
		const l = fahre({
			gemerkterTag: TAG,
			imSpeicher: { [TAG]: NUTZLAST },
			antworten: [antwort(304, { "X-Avesmaps-ETag": TAG }, "")],
		});
		const data = await l.lauf;
		assert.strictEqual(l.anfragen.length, 1, "💣 Warm darf es ebenfalls genau EINE Anfrage geben.");
		assert.strictEqual(l.anfragen[0].kopf, TAG, "und sie traegt den gemerkten Tag als If-None-Match");
		assert.strictEqual(data.features.length, 3, "die Karte baut aus dem Speicher");
		assert.strictEqual(data.revision, 92791, "mit derselben Revision wie die 200");
		assert.strictEqual(data.avesmapsSource.featureCount, 3,
			"und durch DENSELBEN Auswerter -- die Statuszeile darf nicht zwei Fassungen haben");
		assert.deepStrictEqual(l.abgelegt, [], "eine 304 legt nichts neu ab");
		assert.deepStrictEqual(l.vergessen, [], "und wirft nichts weg");
	}

	// --- 3) 🪤 WARM, ABER DER SPEICHER IST LEER -------------------------------------------------
	// localStorage und IndexedDB koennen auseinanderlaufen. Dann ist der gemerkte Tag eine Luege:
	// die 304 kommt, aber es gibt nichts zu hydrieren. Der Rueckfall muss den Tag wegwerfen und voll
	// holen -- und dabei GENAU EINMAL nachfassen, nicht im Kreis laufen.
	{
		const l = fahre({
			gemerkterTag: TAG,
			imSpeicher: {},
			antworten: [antwort(304, {}, ""), antwort(200, { "X-Avesmaps-ETag": TAG }, NUTZLAST)],
		});
		const data = await l.lauf;
		assert.strictEqual(l.anfragen.length, 2, "eine bedingte Anfrage, dann genau ein Vollabruf");
		assert.strictEqual(l.anfragen[0].kopf, TAG, "die erste war bedingt");
		assert.strictEqual(l.anfragen[1].kopf, null, "🪤 Die zweite darf NICHT wieder bedingt sein -- das waere ein Kreis.");
		assert.deepStrictEqual(l.vergessen, [true], "der luegende Tag wird weggeworfen");
		assert.strictEqual(data.features.length, 3, "und die Karte baut trotzdem");
	}

	// --- 4) 💣 Eine 304 auf eine UNbedingte Anfrage bricht ab, statt zu kreisen -------------------
	// Der Fall darf es nicht geben. Gaebe es ihn doch (ein Zwischenspeicher, der sich vertut), waere
	// der Rueckfall aus 3) ohne Riegel endlos -- und ein endloser Abruf der 3-MB-Nutzlast ist
	// schlimmer als jeder Fehler.
	{
		const l = fahre({ gemerkterTag: "", antworten: [antwort(304, {}, "")] });
		await assert.rejects(l.lauf, /304 ohne bedingte Anfrage/, "💣 Eine 304 ohne Tag muss werfen.");
		assert.strictEqual(l.anfragen.length, 1, "und darf nicht nachfassen");
	}

	// --- 5) Fehler bleiben Fehler ----------------------------------------------------------------
	{
		const l = fahre({ gemerkterTag: "", antworten: [antwort(503, {}, "")] });
		await assert.rejects(l.lauf, /HTTP 503/, "ein Serverfehler wird gemeldet, nicht verschluckt");
	}
	{
		// Eine 200 ohne den X-Kopf (Zwischenschicht raeumt ihn doch einmal weg): die Karte baut,
		// es wird nur nichts abgelegt. Fail-open, wie ueberall auf diesem Weg.
		const l = fahre({ gemerkterTag: "", antworten: [antwort(200, {}, NUTZLAST)] });
		const data = await l.lauf;
		assert.strictEqual(data.features.length, 3, "ohne Tag baut die Karte trotzdem");
		assert.deepStrictEqual(l.abgelegt, [], "aber ohne Tag wird nichts abgelegt -- er waere nicht einloesbar");
	}

	// --- 6) 🔴 Bearbeiten-Modus: kein gemerkter Tag, keine Ablage ---------------------------------
	// Dort holt der Live-Abgleich staendig Deltas; ein zurueckgehaltener Editor-Stand ist genau die
	// Stoerung („meine Aenderung kommt nicht an"), die dieses Projekt schon mehrfach bezahlt hat.
	{
		const l = fahre({
			editModus: true,
			gemerkterTag: TAG,
			imSpeicher: { [TAG]: NUTZLAST },
			antworten: [antwort(200, { "X-Avesmaps-ETag": TAG }, NUTZLAST)],
		});
		await l.lauf;
		assert.strictEqual(l.anfragen[0].kopf, null, "🔴 Im Bearbeiten-Modus reist kein If-None-Match mit.");
		assert.ok(l.anfragen[0].adresse.includes("edit_mode=1"), "...und edit_mode=1 bleibt an der Adresse");
		assert.deepStrictEqual(l.abgelegt, [], "🔴 ...und es wird nichts abgelegt.");
	}

	// --- 7) ⚠️ Fehlt der Speicher ganz, laedt die Karte wie vorher --------------------------------
	// Der Riegel in routing.js ist ein typeof-Test. Ohne ihn faellt die ganze Karte aus, wenn
	// js/app/kartendaten-speicher.js einmal nicht geladen wurde.
	{
		const quelle = schnitt(lies("js/routing/routing.js"), "function loadRouteDataFromApi", "}");
		const anfragen = [];
		const z = {
			console: { info() {} }, URL, Promise, Error, JSON, Array,
			window: { location: { href: "https://avesmaps.de/" } },
			MAP_FEATURES_API_URL: "api/app/map-features.php",
			IS_EDIT_MODE: false,
			fetch: (adresse, optionen) => {
				anfragen.push({ adresse, kopf: (optionen && optionen.headers && optionen.headers["If-None-Match"]) || null });
				return Promise.resolve(antwort(200, { "X-Avesmaps-ETag": TAG }, NUTZLAST));
			},
		};
		z.globalThis = z;
		vm.createContext(z);
		vm.runInContext(quelle, z);
		const data = await z.loadRouteDataFromApi();
		assert.strictEqual(data.features.length, 3, "⚠️ Ohne den Speicher muss die Karte trotzdem laden.");
		assert.strictEqual(anfragen[0].kopf, null, "und zwar unbedingt, also mit Vorabruf");
	}

	console.log("OK: bedingter Abruf (kalt, warm, leerer Speicher, Kreis-Riegel, Fehler, Bearbeiten-Modus, ohne Speicher).");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
