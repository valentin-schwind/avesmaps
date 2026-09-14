"use strict";
// Der Kasten „Weitere Wiki-Zuweisungen" (Entwurf 2026-09-14 §2.3, §3.5). Die reinen Teile und der
// Schreibablauf werden AUSGEFUEHRT, nicht gelesen.
// Aus der Wurzel: node js/ui/__tests__/wiki-weitere-kasten.test.js
const assert = require("assert");
const K = require("../wiki-weitere-kasten.js");

const SKIN = { titel: "t", hinweis: "h", link: "l", trefferListe: "tl", treffer: "tr", trefferName: "tn", trefferMeta: "tm" };
const bp = { wiki_key: "b-renpfad", name: "Bärenpfad", wiki_url: "https://x/B" };
const abschnitte = [
	{ public_id: "rs-6", label: "Abschnitt 6: Ginsterfeld – Silkwiesen", wiki_path_weitere: [] },
	{ public_id: "rs-7", label: "Abschnitt 7: Silkwiesen – Wieha", wiki_path_weitere: [bp] },
];

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
	// Entwurf §3.5: die Liste nennt die Hauptzuweisung zuerst (ohne ✕), dann jede weitere mit „weitere" und ✕
	const mitHaupt = K.avesmapsWikiWeitereMarkup({ hauptKey: "reichsstrasse-2", umfang: "die ganze Straße", zuordnungen: teil,
		haupt: { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2", wiki_url: "https://x/R" }, hauptWo: "ganze Straße · Perz – Helmdahl" }, SKIN);
	const hauptStelle = mitHaupt.indexOf("Hauptzuweisung");
	assert.ok(hauptStelle > 0 && hauptStelle < mitHaupt.indexOf('data-weitere-weg="b-renpfad"'), "die Hauptzuweisung steht vor den weiteren");
	assert.ok(mitHaupt.includes("ganze Straße · Perz – Helmdahl") && mitHaupt.includes("reichsstrasse-2"));
	assert.ok(!/data-weitere-weg="reichsstrasse-2"/.test(mitHaupt), "die Hauptzuweisung hat kein ✕ -- geloest wird sie im Kasten „Wiki-Weg");
	assert.ok(/weitere\s*<button[^>]*data-weitere-weg="b-renpfad"/.test(mitHaupt), "eine weitere Zuweisung heisst „weitere");
	assert.ok(!mit.includes("Hauptzuweisung"), "ohne `haupt` keine Hauptzeile");
	assert.ok(K.avesmapsWikiWeitereTrefferMarkup([{ wiki_key: "geronsgang", name: "Geronsgang", art: "Pilgerweg" }], SKIN)
		.includes('data-weitere-hinzu="geronsgang"'));

	// 4. Ablauf: ✕ nimmt den Artikel von genau den Abschnitten, die ihn tragen; danach meldet der Kasten dem Wirt
	const gesendet = [];
	let geschrieben = null;
	const stuecke = new Map();
	const host = {
		innerHTML: "",
		zuhoerer: {},
		addEventListener(typ, fn) { this.zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete this.zuhoerer[typ]; },
		querySelector(sel) { if (!stuecke.has(sel)) stuecke.set(sel, { textContent: "", innerHTML: "", hidden: true }); return stuecke.get(sel); },
	};
	const kasten = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN,
		hauptKey: () => "reichsstrasse-2",
		abschnitte: () => abschnitte,
		umfangText: () => "die ganze Straße",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async (url, init) => { gesendet.push({ url, init }); return { ok: true, status: 200, json: async () => ({ ok: true, applied: 1 }) }; },
	});
	assert.ok(host.innerHTML.includes('data-weitere-weg="b-renpfad"'), "der Kasten zeichnet sich beim Einbau");
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-weg]" ? { dataset: { weitereWeg: "b-renpfad" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.strictEqual(gesendet.length, 1);
	assert.deepStrictEqual(JSON.parse(gesendet[0].init.body),
		{ action: "remove_weitere", wiki_key: "b-renpfad", public_ids: ["rs-7"], dry_run: false, confirm: "apply" });
	assert.deepStrictEqual(geschrieben, { ok: true, applied: 1 }, "der Wirt erfaehrt vom Schreiben");

	// 5. Hinzufuegen gilt ALLEN Abschnitten des Kastens
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "geronsgang" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.deepStrictEqual(JSON.parse(gesendet[1].init.body).public_ids, ["rs-6", "rs-7"]);

	// 6. Ein abgelehnter Schreibvorgang steht im Status und ruft den Wirt NICHT
	geschrieben = null;
	const k2 = K.avesmapsWikiWeitereKastenMount(host, {
		skin: SKIN, hauptKey: () => "reichsstrasse-2", abschnitte: () => abschnitte, umfangText: () => "x",
		geschrieben: (antwort) => { geschrieben = antwort; },
		fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: { code: "invalid_request", message: "Wiki-Weg nicht im Staging: x" } }) }),
	});
	host.zuhoerer.click({ target: { closest: (sel) => (sel === "[data-weitere-hinzu]" ? { dataset: { weitereHinzu: "x" } } : null) } });
	await new Promise((fertig) => setTimeout(fertig, 0));
	assert.strictEqual(geschrieben, null);
	assert.ok(host.querySelector("[data-weitere-status]").textContent.includes("Wiki-Weg nicht im Staging"));
	kasten.zerstoeren();
	k2.zerstoeren();

	console.log("wiki-weitere-kasten.test.js: ok");
})().catch((fehler) => { console.error(fehler); process.exit(1); });
