// Der Ablageort der Kartennutzlast -- und die Weiche im Kopf von index.html, die an ihm haengt.
//
// 🔴 WAS HIER WIRKLICH GEPRUEFT WIRD: nicht, ob die Datei die richtigen Woerter enthaelt, sondern
// ob der Speicher sich richtig VERHAELT. Er wird deshalb mit einem gefaelschten IndexedDB wirklich
// ausgefuehrt -- inklusive der beiden Faelle, die im Ernstfall wehtun (volles Kontingent, und die
// zwei Speicher laufen auseinander). Ein Quelltext-Test haette beide nie gesehen.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/kartendaten-speicher.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: Arbeitskopie CRLF, Deploy-Tor LF.
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);

// --- Ein IndexedDB, das man kaputtgehen lassen kann ----------------------------------------------
function baueFakeIndexedDb(optionen) {
	const einstellungen = optionen || {};
	const inhalt = new Map();
	const spaeter = (fn) => setTimeout(fn, 0);
	return {
		inhalt,
		open() {
			if (einstellungen.oeffnenScheitert) {
				const a = {};
				spaeter(() => { if (a.onerror) { a.onerror(); } });
				return a;
			}
			const db = {
				close() { db.geschlossen = true; },
				transaction(name, modus) {
					const g = {};
					const auftraege = [];
					g.objectStore = () => ({
						get(k) {
							const q = {};
							spaeter(() => { q.result = inhalt.get(k); if (q.onsuccess) { q.onsuccess(); } });
							return q;
						},
						put(v, k) {
							auftraege.push(() => inhalt.set(k, v));
							return {};
						},
						delete(k) {
							auftraege.push(() => inhalt.delete(k));
							return {};
						},
					});
					if (modus === "readwrite") {
						spaeter(() => {
							if (einstellungen.kontingentVoll) {
								if (g.onabort) { g.onabort(); }
								return;
							}
							auftraege.forEach((fn) => fn());
							if (g.oncomplete) { g.oncomplete(); }
						});
					}
					return g;
				},
			};
			const a = { result: db };
			spaeter(() => {
				if (a.onupgradeneeded) { a.onupgradeneeded(); }
				if (a.onsuccess) { a.onsuccess(); }
			});
			return a;
		},
	};
}

function baueFakeLocalStorage(kaputt) {
	const m = new Map();
	return {
		m,
		getItem(k) { if (kaputt) { throw new Error("verweigert"); } return m.has(k) ? m.get(k) : null; },
		setItem(k, v) { if (kaputt) { throw new Error("verweigert"); } m.set(k, String(v)); },
		removeItem(k) { if (kaputt) { throw new Error("verweigert"); } m.delete(k); },
	};
}

// Das Modul frisch laden, mit austauschbarer Umgebung.
function ladeSpeicher(umgebung) {
	const zusammenhang = {
		console,
		setTimeout,
		module: { exports: {} },
		indexedDB: umgebung.indexedDB,
		localStorage: umgebung.localStorage,
	};
	zusammenhang.globalThis = zusammenhang;
	vm.createContext(zusammenhang);
	vm.runInContext(lies("js/app/kartendaten-speicher.js"), zusammenhang);
	return zusammenhang.module.exports;
}

const NUTZLAST = JSON.stringify({ type: "FeatureCollection", revision: 92791, features: [{ id: "a" }, { id: "b" }] });

(async () => {
	// --- 1) Der Normalfall: ablegen, Tag merken, zurueckholen ------------------------------------
	{
		const ls = baueFakeLocalStorage(false);
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb(), localStorage: ls });
		assert.strictEqual(s.avesmapsKartendatenTagLesen(), "", "kalt gibt es keinen Tag");

		const abgelegt = await s.avesmapsKartendatenAblegen('W/"mf-17-92791"', NUTZLAST);
		assert.strictEqual(abgelegt, true, "das Ablegen muss gelingen");
		assert.strictEqual(s.avesmapsKartendatenTagLesen(), 'W/"mf-17-92791"', "und der Tag muss gemerkt sein");

		const zurueck = await s.avesmapsKartendatenLesen('W/"mf-17-92791"');
		assert.ok(zurueck && zurueck.type === "FeatureCollection", "die Nutzlast kommt geparst zurueck");
		assert.strictEqual(zurueck.features.length, 2, "vollstaendig");
		assert.strictEqual(zurueck.revision, 92791, "mit ihrer Revision");
	}

	// --- 2) 💣 Die zwei Speicher laufen auseinander ----------------------------------------------
	// localStorage und IndexedDB sind zwei Speicher. Wird nur einer geraeumt, zeigt der gemerkte Tag
	// auf eine Nutzlast, die zu einem ANDEREN Stand gehoert. Ohne den Vergleich haengte eine 304 fuer
	// Tag A die Nutzlast von Tag B in die Karte -- ein stiller falscher Weltstand.
	{
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb(), localStorage: baueFakeLocalStorage(false) });
		await s.avesmapsKartendatenAblegen('W/"mf-17-92791"', NUTZLAST);
		const fremd = await s.avesmapsKartendatenLesen('W/"mf-17-99999"');
		assert.strictEqual(fremd, null, "💣 Ein fremder Tag darf NIE die abgelegte Nutzlast einloesen.");
	}

	// --- 3) 🔴 Kontingent voll: der Tag darf NICHT gesetzt werden ---------------------------------
	// Die tragende Reihenfolge. Der Kopf von index.html schliesst allein aus diesem Tag „ich habe
	// eine Kopie, ich brauche keinen Vorabruf". Stuende er da, ohne dass die Nutzlast liegt, entfiele
	// der Vorabruf UND die bedingte Anfrage liefe ins Leere -- der schlechteste aller Faelle.
	{
		const ls = baueFakeLocalStorage(false);
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb({ kontingentVoll: true }), localStorage: ls });
		const abgelegt = await s.avesmapsKartendatenAblegen('W/"mf-17-92791"', NUTZLAST);
		assert.strictEqual(abgelegt, false, "ein abgebrochenes Geschaeft ist kein Erfolg");
		assert.strictEqual(s.avesmapsKartendatenTagLesen(), "",
			"🔴 Der Tag steht in localStorage, obwohl die Nutzlast nie abgelegt wurde.");
	}

	// --- 4) ⚠️ Fail-open: ohne IndexedDB faellt nichts um ----------------------------------------
	{
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb({ oeffnenScheitert: true }), localStorage: baueFakeLocalStorage(false) });
		assert.strictEqual(await s.avesmapsKartendatenAblegen('W/"x"', NUTZLAST), false, "Ablegen faellt offen aus");
		assert.strictEqual(await s.avesmapsKartendatenLesen('W/"x"'), null, "Lesen faellt offen aus");
	}
	{
		// Gar kein indexedDB (privates Fenster, abgeschaltete Speicherung).
		const s = ladeSpeicher({ indexedDB: undefined, localStorage: baueFakeLocalStorage(false) });
		assert.strictEqual(await s.avesmapsKartendatenLesen('W/"x"'), null, "kein indexedDB -> null, kein Wurf");
		assert.strictEqual(await s.avesmapsKartendatenAblegen('W/"x"', NUTZLAST), false, "kein indexedDB -> false, kein Wurf");
	}
	{
		// Und ein localStorage, das jeden Zugriff verweigert.
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb(), localStorage: baueFakeLocalStorage(true) });
		assert.strictEqual(s.avesmapsKartendatenTagLesen(), "", "verweigertes localStorage -> leerer Tag");
		assert.strictEqual(await s.avesmapsKartendatenAblegen('W/"x"', NUTZLAST), false, "und kein gemeldeter Erfolg");
	}

	// --- 5) Ein beschaedigter Eintrag wird weggeworfen, nicht gereicht ----------------------------
	{
		const idb = baueFakeIndexedDb();
		const s = ladeSpeicher({ indexedDB: idb, localStorage: baueFakeLocalStorage(false) });
		await s.avesmapsKartendatenAblegen('W/"mf-17-92791"', NUTZLAST);
		// Halber Eintrag -- Kontingent waehrend des Schreibens erschoepft, Abbruch mitten im JSON.
		idb.inhalt.set("map-features", { form: 1, tag: 'W/"mf-17-92791"', text: NUTZLAST.slice(0, 30) });
		const kaputt = await s.avesmapsKartendatenLesen('W/"mf-17-92791"');
		assert.strictEqual(kaputt, null, "ein halber Eintrag ist kein Treffer");
		await new Promise((r) => setTimeout(r, 20));
		assert.strictEqual(s.avesmapsKartendatenTagLesen(), "",
			"...und sein Tag wird weggeworfen, sonst wird er bei JEDEM Start erneut gelesen");
	}

	// --- 5b) Eine ALTE Eintragsform gilt als Fehlschlag, nicht als Treffer ------------------------
	// Die Nutzlast ist ueber den Tag versioniert (die Payload-Version steckt darin); was `form`
	// abfaengt, ist der andere Fall: wenn diese Datei je etwas ANDERES ablegt als { tag, text }.
	// Ohne den Vergleich reichte ein Eintrag aus einer frueheren Fassung seinen Inhalt weiter, und
	// der passt dann zu gar nichts.
	{
		const idb = baueFakeIndexedDb();
		const s = ladeSpeicher({ indexedDB: idb, localStorage: baueFakeLocalStorage(false) });
		idb.inhalt.set("map-features", { form: 0, tag: 'W/"mf-17-92791"', text: NUTZLAST });
		assert.strictEqual(await s.avesmapsKartendatenLesen('W/"mf-17-92791"'), null,
			"💣 Ein Eintrag aus einer anderen Ablageform darf nicht eingeloest werden.");
	}

	// --- 6) 💣 Der Schluessel steht ZWEIMAL -- hier und im Kopf von index.html --------------------
	// Das Vorabruf-Skript dort entscheidet SYNCHRON und kann die Konstante nicht lesen. Laufen die
	// beiden Zeichenketten auseinander, meldet der Kopf weiter einen Vorabruf an, den die bedingte
	// Anfrage danach verfehlt -- und die Nutzlast reist ZWEIMAL, schlechter als vor dem ganzen Umbau.
	{
		const s = ladeSpeicher({ indexedDB: baueFakeIndexedDb(), localStorage: baueFakeLocalStorage(false) });
		const schluessel = s.AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL;
		assert.ok(typeof schluessel === "string" && schluessel !== "", "der Schluessel ist eine Zeichenkette");
		const indexQuelle = lies("index.html");
		assert.ok(
			indexQuelle.includes('window.localStorage.getItem("' + schluessel + '")'),
			"💣 Der Kopf von index.html liest einen ANDEREN Schluessel als der Speicher schreibt."
		);
	}

	// --- 7) 🔴 Die Weiche im Kopf von index.html, wirklich ausgefuehrt ----------------------------
	// Kalt (kein Tag) MUSS der Vorabruf kommen -- sonst faellt die Beschleunigung vom 27.08. weg.
	// Warm (Tag da) darf er NICHT kommen -- sonst reisen die 3 MB zweimal.
	{
		const indexQuelle = lies("index.html");
		const marke = indexQuelle.indexOf("mapFeaturesWarmerTag");
		assert.notStrictEqual(marke, -1, "der Vorabruf-Block ist da");
		const anfang = indexQuelle.lastIndexOf("<script>", marke) + "<script>".length;
		const schluss = indexQuelle.indexOf("</script>", marke);
		const kopfSkript = indexQuelle.slice(anfang, schluss);
		assert.ok(kopfSkript.includes("mapFeaturesPreload.rel"), "und er enthaelt die Anmeldung");

		const fahre = (suche, gemerkterTag) => {
			const angemeldet = [];
			const z = {
				window: { location: { search: suche }, localStorage: baueFakeLocalStorage(false) },
				document: {
					createElement: () => ({}),
					head: { appendChild: (n) => angemeldet.push(n) },
				},
				URLSearchParams,
				String,
			};
			if (gemerkterTag) { z.window.localStorage.setItem("avesmaps.kartendaten.etag", gemerkterTag); }
			vm.createContext(z);
			vm.runInContext(kopfSkript, z);
			return angemeldet.length;
		};

		assert.strictEqual(fahre("", ""), 1, "🔴 Kalt muss der Vorabruf angemeldet werden.");
		assert.strictEqual(fahre("?perftrace=1", ""), 1, "auch mit anderen Parametern");
		assert.strictEqual(fahre("", 'W/"mf-17-92791"'), 0,
			"💣 Mit gemerktem Tag darf KEIN Vorabruf angemeldet werden -- sonst reisen die 3 MB zweimal.");
		assert.strictEqual(fahre("?edit=1", ""), 0, "und im Bearbeiten-Modus wie bisher gar keiner");
	}

	// --- 8) 💣 Der Tag kommt aus `X-Avesmaps-ETag`, NIE aus `ETag` --------------------------------
	// Live gemessen (27.08.2026, `cache: "no-store"`): die 200 traegt keinen `ETag`, STRATOs
	// Zwischenschicht entfernt ihn aus jeder Antwort mit Rumpf. Ein darauf gebauter Riegel waere fuer
	// immer wirkungslos -- und er sieht trotzdem manchmal richtig aus, weil eine aus dem BROWSER-Cache
	// beantwortete Anfrage den Tag einer frueheren 304 mitfuehrt.
	{
		const routing = lies("js/routing/routing.js");
		const ohneKommentare = routing.split(ZE).filter((z) => !z.trim().startsWith("//")).join(ZE);
		assert.ok(
			ohneKommentare.includes('response.headers.get("X-Avesmaps-ETag")'),
			"der Tag wird aus dem X-Kopf gelesen"
		);
		assert.ok(
			!/headers\.get\("ETag"\)/.test(ohneKommentare),
			'💣 Es wird `headers.get("ETag")` gelesen -- der ist live immer null.'
		);
		// Und die bedingte Anfrage muss den Tag wirklich mitschicken.
		assert.ok(
			ohneKommentare.includes('{ headers: { "If-None-Match": tag } }'),
			"der gemerkte Tag reist als If-None-Match mit"
		);
		// 💣 Der Rueckfall bei leerem Speicher darf kein Kreis werden: eine 304 ohne mitgeschickten
		// Tag muss werfen, sonst ruft sich abrufen("") endlos selbst.
		assert.ok(
			/if \(!tag\) \{\s*\n\s*throw new Error/.test(ohneKommentare),
			"💣 Eine 304 ohne bedingte Anfrage bricht den Rueckfall nicht ab -- das ist ein Kreis."
		);
		// 🔴 Im Bearbeiten-Modus wird weder gelesen noch abgelegt.
		assert.ok(
			/IS_EDIT_MODE \|\| typeof avesmapsKartendatenTagLesen !== "function" \? "" : avesmapsKartendatenTagLesen\(\)/.test(ohneKommentare),
			"🔴 Im Bearbeiten-Modus darf kein gemerkter Tag benutzt werden."
		);
		assert.ok(
			/if \(tag && !IS_EDIT_MODE && typeof avesmapsKartendatenSpaeterAblegen === "function"\)/.test(ohneKommentare),
			"🔴 ...und im Bearbeiten-Modus darf nichts abgelegt werden."
		);
	}

	// --- 9) Das Modul laedt VOR routing.js --------------------------------------------------------
	{
		const indexQuelle = lies("index.html");
		const speicherAt = indexQuelle.indexOf('src="js/app/kartendaten-speicher.js"');
		const routingAt = indexQuelle.indexOf('src="js/routing/routing.js"');
		assert.notStrictEqual(speicherAt, -1, "der Speicher ist eingebunden");
		assert.notStrictEqual(routingAt, -1, "routing.js ist eingebunden");
		assert.ok(speicherAt < routingAt, "🔴 Der Speicher muss VOR routing.js geladen werden.");
	}

	console.log("OK: Kartendaten-Speicher (Normalfall, Drift, Kontingent, fail-open, halber Eintrag, Schluessel-Parität, Vorabruf-Weiche, X-Kopf, Ladereihenfolge).");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
