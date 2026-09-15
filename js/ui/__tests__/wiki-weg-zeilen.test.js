"use strict";
// Der Kasten „Wiki-Weg" der GANZEN Strasse: eine Zeile je Hauptzuweisung, jede fuer genau ihre Abschnitte bearbeitbar
// (Owner 15.09.2026, „Gleiche zusammenfassen" + „Je Zeile bearbeitbar"). EIN Bauteil fuer die Weg-Ebene des Wege-Editors
// (Huelle „dt") und den Gruppendialog der Karte (Huelle „label-wiki"). AUSGEFUEHRT: die echten Dateien in einem Sandkasten,
// der Zeilen-Behaelter ist eine kleine DOM-Attrappe, die das gezeichnete Markup wirklich liest.
// Aus der Wurzel: node js/ui/__tests__/wiki-weg-zeilen.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const DATEIEN = ["js/pages/wege-editor-model.js", "js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
	"js/ui/wiki-assign-weg.js", "js/ui/wiki-weg-zeilen.js"];
const warten = () => new Promise((fertig) => setTimeout(fertig, 0));

function sandkasten() {
	const kasten = { console, setTimeout, clearTimeout, Promise, JSON, Math, Date, Number, String, Array, Object, Boolean, RegExp, Error,
		Map, Set, isFinite, isNaN, encodeURIComponent, decodeURIComponent, parseInt, gemounted: [] };
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	DATEIEN.forEach((datei) => vm.runInContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), kasten, { filename: datei }));
	// Das geteilte Bauteil wird nur AUFGEZEICHNET -- sein eigener Vertrag steht in wiki-assign.test.js.
	vm.runInContext("avesmapsWikiAssignMount = function (behaelter, opts) {"
		+ " const eintrag = { behaelter: behaelter, opts: opts, zerstoert: 0 }; gemounted.push(eintrag);"
		+ " return { bereit: true, zerstoeren: function () { eintrag.zerstoert += 1; } }; };", kasten);
	return kasten;
}

/** Eine <details>-Attrappe: `open`, Zuhoerer, der Platz fuer das Bauteil. */
function detailsAttrappe(index, offen) {
	const platz = { name: "platz-" + index, innerHTML: "" };
	return {
		index, open: offen, platz, zuhoerer: {},
		getAttribute: (n) => (n === "data-wiki-weg-zeile" ? String(index) : null),
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ, fn) { if (this.zuhoerer[typ] === fn) { delete this.zuhoerer[typ]; } },
		querySelector: (sel) => (sel === "[data-wiki-weg-zeile-host]" ? platz : null),
	};
}

/** Der Behaelter: liest beim Zeichnen die <details> und den Anhang-Platz aus dem Markup. */
function behaelterAttrappe() {
	const b = {
		zuhoerer: {}, details: [], anhangPlatz: null, _html: "", zeichnungen: 0,
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ, fn) { if (this.zuhoerer[typ] === fn) { delete this.zuhoerer[typ]; } },
		querySelectorAll: (sel) => (sel === "[data-wiki-weg-zeile]" ? b.details : []),
		querySelector: (sel) => (sel === "[data-wiki-weg-zeilen-anhang]" ? b.anhangPlatz : null),
	};
	Object.defineProperty(b, "innerHTML", {
		get() { return this._html; },
		set(wert) {
			this._html = String(wert);
			this.zeichnungen += 1;
			this.details = [...this._html.matchAll(/<details class="wiki-weg-zeile[^"]*" data-wiki-weg-zeile="(\d+)"( open)?>/g)]
				.map((m) => detailsAttrappe(Number(m[1]), Boolean(m[2])));
			this.anhangPlatz = this._html.includes("data-wiki-weg-zeilen-anhang")
				? { kinder: [], appendChild(kind) { this.kinder.push(kind); return kind; } } : null;
		},
	});
	return b;
}

const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/wiki/Reichsstra%C3%9Fe_2" };
const BAER = { wiki_key: "b-renpfad", name: "Bärenpfad <i>", wiki_url: "https://x/B" };
function reichsstrasse(k) {
	const ohne = new Set([2, 9]);
	const segmente = [];
	for (let nr = 1; nr <= 9; nr++) {
		segmente.push({ public_id: "rs-" + nr, wiki_path: ohne.has(nr) ? null : RS2, wiki_path_weitere: [3, 4].includes(nr) ? [BAER] : [] });
	}
	return vm.runInContext("wpGruppeZuweisungsZeilen", k)(segmente);
}

(async () => {
	// ---- 1. Das Markup: zwei Zeilen, zugeklappt, jede mit Artikel, Anzahl, Nummern und weiteren ---------------------------------
	{
		const k = sandkasten();
		const markup = vm.runInContext("avesmapsWikiWegZeilenMarkup", k);
		const skin = vm.runInContext("avesmapsWikiAssignSkin", k)("dt");
		const zeilen = reichsstrasse(k);
		assert.strictEqual(zeilen.length, 2, "Vorbedingung: gemischte Strasse");
		const html = markup(zeilen, skin, []);
		assert.strictEqual((html.match(/<details class="wiki-weg-zeile/g) || []).length, 2, "zwei Zeilen");
		assert.ok(!/<details[^>]* open>/.test(html), "mehr als eine Zeile: alle zugeklappt");
		assert.ok(html.startsWith('<div class="avm-wiki-assign wiki-weg-zeilen">'), "die Huelle des Wirts: " + html.slice(0, 80));
		assert.ok(html.includes('<div class="dt-grp">') && html.includes(">Wiki-Weg<"), "die Ueberschrift der Huelle, Name aus dem Register");
		const [mit, keine] = html.split('<details class="wiki-weg-zeile').slice(1);
		assert.ok(/<summary[^>]*>/.test(mit), "die Zusammenfassung ist ein natives <summary>");
		assert.ok(mit.includes('<a class="dt-link" href="https://x/wiki/Reichsstra%C3%9Fe_2" target="_blank" rel="noopener">Reichsstraße 2 ↗</a>'),
			"der Artikel ist ein Link mit ↗: " + mit.slice(0, 300));
		assert.ok(mit.includes("7 Abschnitte") && mit.includes("Abschnitt 1, 3–8"), "Anzahl und kompakte Nummern: " + mit.slice(0, 500));
		assert.ok(mit.includes("Bärenpfad &lt;i&gt; auf 2"), "weitere Zuweisung mit „auf K“, maskiert");
		assert.ok(mit.includes('data-wiki-weg-zeile-host'), "der Platz fuer das Bauteil");
		assert.ok(mit.includes('data-wiki-weg-weitere="b-renpfad"'), "✕ fuer die weitere Zuweisung dieser Zeile");
		assert.ok(keine.includes(">keine<") && keine.includes("2 Abschnitte") && keine.includes("Abschnitt 2, 9"), keine.slice(0, 400));
		assert.ok(!keine.includes("<a "), "„keine“ ist kein Link");
		assert.ok(!keine.includes("data-wiki-weg-weitere"), "ohne weitere Zuweisungen kein ✕");
		assert.ok(html.includes("data-wiki-weg-zeilen-anhang"), "der Platz fuer den Kasten der weiteren Zuweisungen der ganzen Strasse");
		assert.ok(html.indexOf("data-wiki-weg-zeilen-anhang") > html.lastIndexOf("</details>"), "… EINMAL, unter der Zeilenliste");

		// Alle Abschnitte einer Zeile tragen den weiteren Artikel: dann ohne „auf K“.
		const alle = vm.runInContext("wpGruppeZuweisungsZeilen", k)([{ public_id: "a", wiki_path: RS2, wiki_path_weitere: [BAER] },
			{ public_id: "b", wiki_path: RS2, wiki_path_weitere: [BAER] }]);
		const einzeln = markup(alle, skin, []);
		assert.ok(/<details class="wiki-weg-zeile[^"]*" data-wiki-weg-zeile="0" open>/.test(einzeln), "EINE Zeile ist von Anfang an aufgeklappt");
		assert.ok(einzeln.includes("Bärenpfad &lt;i&gt;") && !einzeln.includes(" auf 2"), "an allen Abschnitten: ohne „auf K“");
		assert.ok(!einzeln.includes("Eine Zeile je Wiki-Zuweisung"), "der Hinweis steht nur bei mehreren Zeilen");
		assert.ok(html.includes("Eine Zeile je Wiki-Zuweisung"), "… und dort steht er");

		// Die Kartendialog-Huelle: dieselben Zeilen, andere Klassen.
		const lw = markup(zeilen, vm.runInContext("avesmapsWikiAssignSkin", k)("label-wiki"), ["reichsstrasse-2"]);
		assert.ok(lw.startsWith('<div class="label-wiki-reference wiki-weg-zeilen">') && lw.includes("label-wiki-reference__title"), lw.slice(0, 200));
		assert.ok(/<details class="wiki-weg-zeile[^"]*" data-wiki-weg-zeile="0" open>/.test(lw), "eine offen gemerkte Zeile bleibt offen");
		assert.ok(lw.includes('class="label-wiki-reference__link"'), "der Link traegt die Klasse seiner Huelle");
		assert.ok(markup([], skin, []).includes("Keine Abschnitte"), "leer: ein Satz statt eines leeren Kastens");
	}

	// ---- 2. Montieren: eine Zeile ist offen und traegt das Bauteil sofort ------------------------------------------------------
	{
		const k = sandkasten();
		const b = behaelterAttrappe();
		const anhang = { name: "anhang" };
		const datenwege = [];
		const einig = vm.runInContext("wpGruppeZuweisungsZeilen", k)([{ public_id: "p", wiki_path: RS2 }, { public_id: "q", wiki_path: RS2 }]);
		const st = vm.runInContext("avesmapsWikiWegZeilenMount", k)(b, {
			skin: "dt", zeilen: () => einig, anhang,
			datenweg: (zeile) => { const dw = { laden: () => ({}), zuweisen: () => Promise.resolve(), loesen: () => Promise.resolve(), syncUebernehmen: () => {} }; datenwege.push([zeile, dw]); return dw; },
			weitereEntfernen: () => Promise.resolve(),
		});
		assert.strictEqual(k.gemounted.length, 1, "die einzige Zeile ist offen -- ihr Bauteil haengt sofort");
		const g = k.gemounted[0];
		assert.strictEqual(g.behaelter, b.details[0].platz, "im Platz DIESER Zeile");
		assert.strictEqual(g.opts.subject, "weg");
		assert.strictEqual(g.opts.skin, "dt");
		assert.strictEqual(g.opts.laden, datenwege[0][1].laden, "laden aus dem Datenweg der Zeile");
		assert.strictEqual(g.opts.zuweisen, datenwege[0][1].zuweisen);
		assert.strictEqual(g.opts.loesen, datenwege[0][1].loesen);
		assert.strictEqual(g.opts.syncUebernehmen, datenwege[0][1].syncUebernehmen);
		assert.strictEqual(g.opts.trefferAufbereiten, vm.runInContext("avesmapsWikiAssignWegTreffer", k), "kein eigener Suchbaustein");
		assert.deepStrictEqual([...datenwege[0][0].public_ids], ["p", "q"], "der Datenweg bekommt seine Zeile");
		assert.deepStrictEqual(b.anhangPlatz.kinder, [anhang], "der Anhang haengt unter den Zeilen");
		st.zerstoeren();
		assert.strictEqual(g.zerstoert, 1, "Zerstoeren baut das Bauteil der Zeile ab");
		assert.strictEqual(b.innerHTML, "");
		assert.ok(!b.zuhoerer.click, "und loest den Klick-Zuhoerer");
	}

	// ---- 3. Zwei Zeilen: erst beim Aufklappen montiert, beim Zuklappen abgebaut; „keine" ohne Entfernen ---------------------------
	{
		const k = sandkasten();
		const b = behaelterAttrappe();
		let zeilen = reichsstrasse(k);
		const entfernt = [];
		let freigeben = null;
		let datenwegLoesen = 0;
		const st = vm.runInContext("avesmapsWikiWegZeilenMount", k)(b, {
			skin: "label-wiki", zeilen: () => zeilen,
			datenweg: () => ({ laden: () => ({}), zuweisen: () => Promise.resolve(), loesen: () => { datenwegLoesen += 1; return Promise.resolve(); } }),
			weitereEntfernen: (zeile, eintrag) => { entfernt.push([zeile, eintrag]); return new Promise((fertig) => { freigeben = fertig; }); },
		});
		assert.strictEqual(k.gemounted.length, 0, "zugeklappt: nichts montiert (lazy)");
		assert.strictEqual(b.details.length, 2);
		const [mitDetails, keineDetails] = b.details;
		keineDetails.open = true;
		keineDetails.zuhoerer.toggle({ target: keineDetails });
		assert.strictEqual(k.gemounted.length, 1, "Aufklappen montiert das Bauteil");
		assert.strictEqual(k.gemounted[0].behaelter, keineDetails.platz);
		// 🔴 Die Zeile „keine“ hat kein Entfernen -- und ein Aufruf LEHNT AB: ein fehlender Rueckruf loeste im Bauteil auf.
		let keineGeloest = false;
		await k.gemounted[0].opts.loesen().then(() => { keineGeloest = true; }, () => {});
		assert.strictEqual(keineGeloest, false, "die Zeile „keine“ loest nie auf");
		assert.strictEqual(datenwegLoesen, 0, "… und schreibt nichts");
		assert.strictEqual(k.gemounted[0].opts.skin, "label-wiki");
		keineDetails.open = false;
		keineDetails.zuhoerer.toggle({ target: keineDetails });
		assert.strictEqual(k.gemounted[0].zerstoert, 1, "Zuklappen baut es ab -- keine Waisen");
		mitDetails.open = true;
		mitDetails.zuhoerer.toggle({ target: mitDetails });
		assert.strictEqual(typeof k.gemounted[1].opts.loesen, "function", "die zugewiesene Zeile hat Entfernen");

		// ✕ an einer weiteren Zuweisung: GENAU diese Zeile, GENAU dieser Eintrag; ein zweiter Klick waehrend des Schreibens tut nichts.
		const knopf = { getAttribute: (n) => (n === "data-wiki-weg-weitere" ? "b-renpfad" : null), closest: (sel) => (sel === "[data-wiki-weg-zeile]" ? mitDetails : null) };
		let verhindert = 0;
		const klick = { target: { closest: (sel) => (sel === "[data-wiki-weg-weitere]" ? knopf : null) }, preventDefault() { verhindert += 1; } };
		b.zuhoerer.click(klick);
		b.zuhoerer.click(klick);
		assert.strictEqual(entfernt.length, 1, "ein zweiter Klick waehrend des Schreibens schickt nichts");
		assert.strictEqual(verhindert, 2, "das ✕ klappt die Zeile nicht auf oder zu");
		assert.strictEqual(entfernt[0][0].wiki_key, "reichsstrasse-2");
		assert.deepStrictEqual([...entfernt[0][1].public_ids], ["rs-3", "rs-4"], "der Eintrag nennt seine Abschnitte in dieser Zeile");
		freigeben();
		await warten();
		b.zuhoerer.click(klick);
		assert.strictEqual(entfernt.length, 2, "danach geht es wieder");

		// Neu zeichnen: die Zeilen werden NEU gebildet, offene bleiben offen, alte Bauteile gehen.
		const vorher = k.gemounted.length;
		zeilen = vm.runInContext("wpGruppeZuweisungsZeilen", k)([{ public_id: "rs-1", wiki_path: RS2 }, { public_id: "rs-2", wiki_path: RS2 }]);
		st.neuZeichnen();
		assert.strictEqual(k.gemounted[vorher - 1].zerstoert, 1, "das Bauteil der offenen Zeile ist abgebaut");
		assert.strictEqual(b.details.length, 1, "die Abschnitte sind in EINE Zeile gewandert");
		assert.strictEqual(k.gemounted.length, vorher + 1, "… und die ist offen und traegt ein frisches Bauteil");
		assert.strictEqual(k.gemounted[k.gemounted.length - 1].behaelter, b.details[0].platz);
		st.zerstoeren();
	}

	// ---- 4. Ohne geteiltes Bauteil: ein erkennbarer Satz statt eines leeren Kastens ----------------------------------------------
	{
		const k = sandkasten();
		vm.runInContext("avesmapsWikiAssignMount = undefined;", k);
		const b = behaelterAttrappe();
		b.textContent = "";
		vm.runInContext("avesmapsWikiWegZeilenMount", k)(b, { skin: "dt", zeilen: () => [], datenweg: () => ({}) });
		assert.ok(String(b.textContent).includes("js/ui/wiki-assign.js"), "der Satz nennt die Datei: " + b.textContent);
	}

	console.log("wiki-weg-zeilen.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
