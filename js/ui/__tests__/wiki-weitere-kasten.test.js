"use strict";
// Der Kasten „Weitere Wiki-Zuweisungen" (Entwurf 2026-09-14 §2.3, §3.5). Die reinen Teile und der
// Schreibablauf werden AUSGEFUEHRT, nicht gelesen.
// Aus der Wurzel: node js/ui/__tests__/wiki-weitere-kasten.test.js
//
// Erste Pruefrunde (Aufgabe 7, Fixrunde 1): sechs Funde -- 1) applied:0 wurde als Erfolg gemeldet,
// 2) Suchantworten koennen die Reihenfolge tauschen, 3) ein Doppelklick loeste zwei Schreibvorgaenge
// aus, 4) die Trennlinie ueber dem Kasten fehlte, 5) Treffer waren <button> statt Listenzeilen,
// 6) das ✕ erbte die Seiten-Knopfhoehe (reine CSS-Frage, siehe css/components/wiki-weitere-kasten.css),
// 7) nur die Weg-Ebene darf die Hauptzuweisung zeigen (siehe js/pages/wege-editor.js). Die Abschnitte
// 7-13 unten decken 1, 2, 3, 4, 5.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const K = require("../wiki-weitere-kasten.js");

const SKIN = { titel: "t", hinweis: "h", link: "l", trefferListe: "tl", treffer: "tr", trefferName: "tn", trefferMeta: "tm" };
const bp = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const abschnitte = [
	{ public_id: "rs-6", label: "Abschnitt 6: Ginsterfeld – Silkwiesen", wiki_path_weitere: [] },
	{ public_id: "rs-7", label: "Abschnitt 7: Silkwiesen – Wieha", wiki_path_weitere: [bp] },
];

// Ein einfacher, aber VOLLSTAENDIGER Host-Stumpf fuer alle folgenden Mount-Proben: eigenes
// Zuhoerer-Register, eigener `querySelector`-Speicher (persistiert je Selektor), optional ein
// `classList` mit Set-Semantik.
function neuerHost(mitClassList) {
	const stuecke = new Map();
	const host = {
		innerHTML: "",
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		querySelector(sel) {
			if (!stuecke.has(sel)) {
				stuecke.set(sel, sel === "[data-weitere-suche]"
					? { value: "", matches: (s) => s === "[data-weitere-suche]" }
					: { textContent: "", innerHTML: "", hidden: true });
			}
			return stuecke.get(sel);
		},
	};
	if (mitClassList) {
		const klassen = new Set();
		host.classList = {
			add(name) { klassen.add(name); },
			remove(name) { klassen.delete(name); },
			contains(name) { return klassen.has(name); },
		};
	}
	return host;
}
const warten = (ms) => new Promise((fertig) => setTimeout(fertig, ms));

(async () => {
	// 1. Zuordnungen: eine Teilmenge nennt ihre Abschnitte, alle Abschnitte heissen „ganze Straße"
	const teil = K.avesmapsWikiWeitereZuordnungen(abschnitte, "ganze Straße");
	assert.deepStrictEqual(teil.map((z) => [z.wiki_key, z.wo, z.publicIds]), [["b-renpfad", "Abschnitt 7: Silkwiesen – Wieha", ["rs-7"]]]);
	const alle = K.avesmapsWikiWeitereZuordnungen(abschnitte.map((a) => ({ ...a, wiki_path_weitere: [bp] })), "ganze Straße");
	assert.strictEqual(alle[0].wo, "ganze Straße");
	assert.strictEqual(K.avesmapsWikiWeitereZuordnungen([abschnitte[1]], "ganze Straße")[0].wo, "Abschnitt 7: Silkwiesen – Wieha",
		"ein einzelner Abschnitt heisst nie „ganze Straße");


	// 2. Rumpf und Filter
	assert.deepStrictEqual(K.avesmapsWikiWeitereKoerper("add", "b-renpfad", ["rs-6"]),
		{ action: "add_weitere", wiki_key: "b-renpfad", public_ids: ["rs-6"], dry_run: false, confirm: "apply" });
	assert.strictEqual(K.avesmapsWikiWeitereKoerper("remove", "b-renpfad", ["rs-7"]).action, "remove_weitere");
	assert.deepStrictEqual(K.avesmapsWikiWeitereTrefferFiltern(
		[{ wiki_key: "reichsstrasse-2" }, { wiki_key: "b-renpfad" }, { wiki_key: "geronsgang" }, null], "reichsstrasse-2", ["b-renpfad"]
	).map((z) => z.wiki_key), ["geronsgang"], "weder die Hauptzuweisung noch vorhandene Artikel werden angeboten");

	// 3. Markup
	const ohneHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "", umfang: "diesen Abschnitt", zuordnungen: [] }, SKIN);
	assert.ok(ohneHaupt.includes("Erst eine Wiki-Zuweisung setzen") && !ohneHaupt.includes("data-weitere-suche"),
		"ohne Hauptzuweisung kein Suchfeld (§2.2 Nr. 1)");
	const mit = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "Abschnitt 7: <b>", zuordnungen: teil }, SKIN);
	assert.ok(mit.includes('data-weitere-weg="b-renpfad"'), "jede Zuordnung hat ihr ✕");
	assert.ok(mit.includes("Weitere Wiki-Zuweisung für Abschnitt 7: &lt;b&gt;"), "der Umfang wird maskiert");
	assert.ok(mit.includes("data-weitere-suche") && mit.includes("ändert den Wegnamen nie"));
	// Fund-Item 5 der ersten Pruefrunde: die Trefferliste ist ein role=listbox, kein nacktes <div>.
	assert.ok(mit.includes('data-weitere-treffer role="listbox"'), "die Trefferliste traegt role=listbox");
	// Entwurf §3.5: die Liste nennt die Hauptzuweisung zuerst (ohne ✕), dann jede weitere mit „weitere" und ✕
	const mitHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "die ganze Straße", zuordnungen: teil,
		haupt: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/R" }, hauptWo: "ganze Straße · Perz – Helmdahl" }, SKIN);
	const hauptStelle = mitHaupt.indexOf("Hauptzuweisung");
	assert.ok(hauptStelle > 0 && hauptStelle < mitHaupt.indexOf('data-weitere-weg="b-renpfad"'), "die Hauptzuweisung steht vor den weiteren");
	assert.ok(mitHaupt.includes("ganze Straße · Perz – Helmdahl") && mitHaupt.includes("reichsstrasse-2"));
	assert.ok(!/data-weitere-weg="reichsstrasse-2"/.test(mitHaupt), "die Hauptzuweisung hat kein ✕ -- geloest wird sie im Kasten „Wiki-Weg");
	assert.ok(/weitere\s*<button[^>]*data-weitere-weg="b-renpfad"/.test(mitHaupt), "eine weitere Zuweisung heisst „weitere");
	assert.ok(!mit.includes("Hauptzuweisung"), "ohne `haupt` keine Hauptzeile");
	// Fund-Item 5: ein Treffer ist eine Listenzeile (role=option, tabindex=0), kein <button> mehr --
	// js/ui/wiki-assign.js (avesmapsWikiAssignTrefferMarkup) ist die Referenzform.
	const trefferMarkup = K.avesmapsWikiWeitereTrefferMarkup([{ wiki_key: "geronsgang", name: "Geronsgang", art: "Pilgerweg" }], SKIN);
	assert.ok(trefferMarkup.includes('data-weitere-hinzu="geronsgang"'));
	assert.ok(trefferMarkup.includes('role="option"') && trefferMarkup.includes('tabindex="0"') && !trefferMarkup.includes("<button"),
		"ein Treffer ist role=option mit tabindex=0, kein <button> (Fund-Item 5)");

	// 4. Ablauf: ✕ nimmt den Artikel von genau den Abschnitten, die ihn tragen; danach meldet der Kasten dem Wirt
	const gesendet = [];
	let geschrieben = null;
	const host = neuerHost();
	const kasten = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN,
		hauptKey: () => "reichsstrasse-2",
		abschnitte: () => abschnitte,
		umfangText: () => "die ganze Straße",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async (url, init) => { gesendet.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, applied: 1, skipped: [] }) }; },
	});
	assert.ok(host.innerHTML.includes('data-weitere-weg="b-renpfad"'), "der Kasten zeichnet sich beim Einbau");
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-weg]" ? { dataset: { weitereWeg: "b-renpfad" } } : null) } });
	await warten(0);
	assert.strictEqual(gesendet.length, 1);
	assert.deepStrictEqual(JSON.parse(gesendet[0].init.body),
		{ action: "remove_weitere", wiki_key: "b-renpfad", public_ids: ["rs-7"], dry_run: false, confirm: "apply" });
	assert.deepStrictEqual(geschrieben, { ok: true, applied: 1, skipped: [] }, "der Wirt erfaehrt vom Schreiben");

	// 5. Hinzufuegen gilt ALLEN Abschnitten des Kastens
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "geronsgang" } } : null) } });
	await warten(0);
	assert.deepStrictEqual(JSON.parse(gesendet[1].init.body).public_ids, ["rs-6", "rs-7"]);

	// 6. Ein abgelehnter Schreibvorgang steht im Status und ruft den Wirt NICHT
	geschrieben = null;
	const k2 = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "x",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: { code: "invalid_request", message: "Wiki-Weg nicht im Staging: x" } }) }),
	});
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "x" } } : null) } });
	await warten(0);
	assert.strictEqual(geschrieben, null);
	assert.ok(host.querySelector("[data-weitere-status]").textContent.includes("Wiki-Weg nicht im Staging"));
	kasten.zerstoeren();
	k2.zerstoeren();

	// 7. Fund-Item 1 (rein): applied=0 sagt nie „zugewiesen"/„entfernt", ein unbekannter Grund-Code bleibt roh
	assert.strictEqual(K.avesmapsWikiWeitereErgebnisText("add", { applied: 3, skipped: [] }, []), "An 3 Abschnitten zugewiesen.");
	assert.strictEqual(K.avesmapsWikiWeitereErgebnisText("remove", { applied: 2, skipped: [] }, []), "Von 2 Abschnitten entfernt.");
	assert.strictEqual(K.avesmapsWikiWeitereErgebnisText("add", { applied: 1, skipped: [] }, []), "An 1 Abschnitt zugewiesen.",
		"die Einzahl bei genau einem Abschnitt");
	const ergebnisText = K.avesmapsWikiWeitereErgebnisText("add", { applied: 0, skipped: [{ public_id: "rs-7", grund: "schon_da" }] }, abschnitte);
	assert.ok(ergebnisText.includes("Übersprungen") && ergebnisText.includes("Abschnitt 7: Silkwiesen – Wieha") && ergebnisText.includes("steht dort schon"),
		"uebersprungene Abschnitte nennen ihr Label und den deutschen Grundtext");
	assert.ok(!ergebnisText.includes("zugewiesen"), "bei applied=0 steht nie „zugewiesen");
	const unbekannterGrund = K.avesmapsWikiWeitereErgebnisText("add", { applied: 0, skipped: [{ public_id: "zzz", grund: "raetselhaft" }] }, []);
	assert.ok(unbekannterGrund.includes("raetselhaft") && unbekannterGrund.includes("zzz"),
		"ein unbekannter Grund-Code faellt auf sich selbst zurueck (roh, nicht verschluckt)");

	// 8. Fund-Item 1 (Ablauf): applied=0 zeigt „Übersprungen" IM KASTEN, nie einen behaupteten Erfolg
	{
		let geschrieben8 = null;
		const host8 = neuerHost();
		const kasten8 = K.avesmapsWikiWeitereKastenMount(host8, {
			skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "y",
			geschrieben: (antwort) => { geschrieben8 = antwort; },
			fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, applied: 0, skipped: [{ public_id: "rs-7", grund: "schon_da" }] }) }),
		});
		host8.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "b-renpfad" } } : null) } });
		await warten(0);
		assert.deepStrictEqual(geschrieben8, { ok: true, applied: 0, skipped: [{ public_id: "rs-7", grund: "schon_da" }] },
			"der Wirt erfaehrt auch ein applied=0-Ergebnis");
		const statusText = host8.querySelector("[data-weitere-status]").textContent;
		assert.ok(statusText.includes("Übersprungen") && statusText.includes("Abschnitt 7: Silkwiesen – Wieha"),
			"der Kasten zeigt selbst, was uebersprungen wurde");
		assert.ok(!statusText.includes("zugewiesen"), "der Kasten behauptet nie einen Erfolg, den es nicht gab");
		kasten8.zerstoeren();
	}

	// 9. Fund-Item 2: zwei Suchen, deren Antworten in umgekehrter Reihenfolge eintreffen -- nur die
	// JUENGERE Anfrage darf die Liste setzen.
	{
		const host9 = neuerHost();
		const wartend = [];
		const kasten9 = K.avesmapsWikiWeitereKastenMount(host9, {
			skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "x",
			fetchImpl: (url) => new Promise((geloest) => { wartend.push({ url, geloest }); }),
		});
		const suchfeld = host9.querySelector("[data-weitere-suche]");
		suchfeld.value = "bär";
		host9.zuhoerer.input({ target: suchfeld });
		await warten(220); // die Tipp-Pause (180ms) abwarten -- die erste Anfrage ist unterwegs
		suchfeld.value = "geron";
		host9.zuhoerer.input({ target: suchfeld });
		await warten(220); // die zweite Anfrage ist unterwegs, die erste noch unbeantwortet
		assert.strictEqual(wartend.length, 2, "beide Suchanfragen sind unterwegs");
		// Die JUENGERE (zweite) Anfrage antwortet ZUERST -- ihr Ergebnis muss stehen bleiben.
		wartend[1].geloest({ ok: true, status: 200, json: async () => ({ rows: [{ wiki_key: "geronsgang", name: "Geronsgang" }] }) });
		await warten(0);
		// Die AELTERE (erste) Anfrage antwortet ZULETZT -- sie darf die Liste nicht mehr ueberschreiben.
		wartend[0].geloest({ ok: true, status: 200, json: async () => ({ rows: [{ wiki_key: "baerenpfad-zwilling", name: "Bärenpfad-Zwilling" }] }) });
		await warten(0);
		const trefferListe = host9.querySelector("[data-weitere-treffer]");
		assert.ok(trefferListe.innerHTML.includes("geronsgang"), "die juengere Anfrage hat die Liste gesetzt");
		assert.ok(!trefferListe.innerHTML.includes("baerenpfad-zwilling"),
			"die aeltere, zuletzt eingetroffene Antwort ueberschreibt das juengere Ergebnis NICHT");
		kasten9.zerstoeren();
	}

	// 10. Fund-Item 3: ein zweiter Klick vor der ersten Antwort loest KEINE zweite Anfrage aus; nach
	// Abschluss ist ein neuer Schreibvorgang wieder moeglich.
	{
		const host10 = neuerHost();
		const angefragt = [];
		let freigeben = null;
		const kasten10 = K.avesmapsWikiWeitereKastenMount(host10, {
			skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "die ganze Straße",
			fetchImpl: (url, init) => { angefragt.push({ url, init }); return new Promise((geloest) => { freigeben = geloest; }); },
		});
		const klickEreignis = { target: { closest: (sel) => (sel === "[data-weitere-weg]" ? { dataset: { weitereWeg: "b-renpfad" } } : null) } };
		host10.zuhoerer.click(klickEreignis);
		host10.zuhoerer.click(klickEreignis);
		await warten(0);
		assert.strictEqual(angefragt.length, 1, "ein zweiter Klick vor der ersten Antwort loest keine zweite Anfrage aus");
		freigeben({ ok: true, status: 200, json: async () => ({ ok: true, applied: 1, skipped: [] }) });
		await warten(0);
		host10.zuhoerer.click(klickEreignis);
		await warten(0);
		assert.strictEqual(angefragt.length, 2, "nach Abschluss ist ein neuer Schreibvorgang wieder moeglich");
		kasten10.zerstoeren();
	}

	// 11. Fund-Item 4: die Huelle bekommt beim Einbau ihre Klasse und verliert sie beim Zerstoeren
	// (die Trennlinien-Regel ueber dem Kasten haengt in editor-page.css an genau dieser Klasse).
	{
		const host11 = neuerHost(true);
		const kasten11 = K.avesmapsWikiWeitereKastenMount(host11, {
			skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "die ganze Straße",
		});
		assert.ok(host11.classList.contains("wiki-weitere-kasten"), "der Kasten traegt seine Huellenklasse (Fund-Item 4)");
		kasten11.zerstoeren();
		assert.ok(!host11.classList.contains("wiki-weitere-kasten"), "und verliert sie wieder beim Zerstoeren");
	}
	// Quelltext-Gegenprobe: dieselbe Trennlinien-Regel traegt jetzt BEIDE Huellen in EINER
	// Selektorliste -- keine zweite Regel mit abgeschriebenen Werten (die Divergenz-Falle, die dieses
	// Haus in AGENTS.md §11/§12 mehrfach bezahlt hat).
	{
		const wurzel = path.join(__dirname, "..", "..", "..");
		const css = fs.readFileSync(path.join(wurzel, "css", "components", "editor-page.css"), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "");
		assert.ok(/\.avm-wiki-assign\s*>\s*\.dt-grp:first-child\s*,\s*\r?\n\s*\.wiki-weitere-kasten\s*>\s*\.dt-grp:first-child\s*\{/.test(css),
			"die Trennlinien-Regel traegt beide Huellen in EINER Selektorliste, nicht als zweite Regel");
	}

	// 12. Fund-Item 5: Enter/Leertaste auf einem Treffer schreiben genau wie ein Klick; Leertaste
	// bekommt preventDefault (sonst scrollt die Seite), Enter nicht; andere Tasten tun nichts.
	{
		const host12 = neuerHost();
		const angefragt12 = [];
		const kasten12 = K.avesmapsWikiWeitereKastenMount(host12, {
			skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "x",
			fetchImpl: async (url, init) => { angefragt12.push(init); return { ok: true, status: 200, json: async () => ({ ok: true, applied: 2, skipped: [] }) }; },
		});
		const trefferZiel = { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "geronsgang" } } : null) };
		const leerEreignis = { key: " ", target: trefferZiel, verhindert: false, preventDefault() { this.verhindert = true; } };
		host12.zuhoerer.keydown(leerEreignis);
		await warten(0);
		assert.strictEqual(angefragt12.length, 1, "Leertaste auf einem Treffer schreibt wie ein Klick");
		assert.ok(leerEreignis.verhindert, "Leertaste bekommt preventDefault (sonst scrollt die Seite)");
		const enterEreignis = { key: "Enter", target: trefferZiel, verhindert: false, preventDefault() { this.verhindert = true; } };
		host12.zuhoerer.keydown(enterEreignis);
		await warten(0);
		assert.strictEqual(angefragt12.length, 2, "Enter auf einem Treffer schreibt ebenfalls");
		assert.ok(!enterEreignis.verhindert, "Enter bekommt KEIN preventDefault");
		const tabEreignis = { key: "Tab", target: trefferZiel, verhindert: false, preventDefault() { this.verhindert = true; } };
		host12.zuhoerer.keydown(tabEreignis);
		await warten(0);
		assert.strictEqual(angefragt12.length, 2, "eine andere Taste loest nichts aus");
		kasten12.zerstoeren();
	}

	console.log("wiki-weitere-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
