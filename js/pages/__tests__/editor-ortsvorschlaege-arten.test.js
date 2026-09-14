const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Ortsvorschlaege der Editorseiten Kartensammlung und Literatur zeigen nur Treffer, die sich als Ort
// SPEICHERN lassen -- also genau die, fuer die mapSearchKind ein Ziel kennt (settlement | territory |
// region | path, dieselbe Viererliste wie AVESMAPS_CITYMAP_PLACE_KINDS und avesmapsAddGameLiteraturePlace).
//
// 💣 Hier stand ein AUSSCHLUSS (`x.kind !== "powerline"`), und die Kartensuche liefert laengst mehr Arten
// als die vier Ziele, unter anderem Landschaften (seit 14.09.2026), Innerorts-Objekte und die angehaengten
// Abschnitte Kartensammlung, Literatur, Vorkommen und „nicht auf der Karte". Live gemessen 14.09.2026:
//   - „Ceälan · Insel" (Landschaft) -> beim Hinzufuegen nur eine lose Namenszeile, nicht die Insel;
//   - „Tannwald": 5 von 8 Vorschlaegen ohne Ziel (die Wald-Landschaft und vier Vorkommen);
//   - im Ortsfilter der Literatur setzt „Borkenbär" den Wiki-Schluessel `borkenb-r` als Ort -> Liste leer.
// Dieselbe Falle, die api/_internal/app/game-literature.php (avesmapsGameLiteratureLinkPlaceFromSource)
// schon einmal bezahlt hat: eine Verneinung nimmt jede kuenftige Art stillschweigend auf.
//
// ⭐ Deshalb wird nicht nachgezaehlt, welche Arten der Server liefert, sondern mit einer ERFUNDENEN Art
// geprueft: faellt sie heraus, ist die Liste positiv.
//
// Die Seiten haben kein Modul; die Funktionen werden aus der ausgelieferten Seite AUSGESCHNITTEN und
// AUSGEFUEHRT (gegen ein gefaelschtes fetch), nicht als Text gelesen.
//
// Run (from repo root):  node js/pages/__tests__/editor-ortsvorschlaege-arten.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
let checks = 0;

function lies(datei) {
	return fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
}

// Funktionen stehen in beiden Seiten mit zwei Leerzeichen Einzug; die schliessende Klammer auf genau
// diesem Einzug beendet die Deklaration (dieselbe Regel wie citymap-editor-search.test.js).
function ausschneiden(html, datei, name) {
	const treffer = html.match(new RegExp("\\n  (?:async )?function " + name + "\\([\\s\\S]*?\\n  \\}"));
	assert.ok(treffer, `${name}() nicht in ${datei} gefunden -- umbenannt? Test anpassen, nicht loeschen`);
	return treffer[0].trim();
}

function ladeSeite(datei, mitOrtsfilter) {
	const html = lies(datei);
	const namen = ["mapSearchKind", "runAcSearch"].concat(mitOrtsfilter ? ["fOrtSearch"] : []);
	const quelle = namen.map((name) => ausschneiden(html, datei, name)).join("\n");
	const kontext = {
		AbortController,
		encodeURIComponent,
		__treffer: [],
		__abrufe: [],
	};
	kontext.fetch = async (adresse) => {
		kontext.__abrufe.push(String(adresse));
		return { json: async () => ({ ok: true, results: kontext.__treffer }) };
	};
	vm.createContext(kontext);
	vm.runInContext(`
		let acAbort = null, acItems = [], acActive = -1;
		function renderAc() {}
		let fOrtItems = [], fOrtActive = -1, fOrtAbort = null;
		function fOrtRender() {}
		${quelle}
		globalThis.__api = {
			mapSearchKind,
			vorschlaege: async (q) => { await runAcSearch(q); return acItems; },
			${mitOrtsfilter ? "ortsfilter: async (q) => { await fOrtSearch(q); return fOrtItems; }," : ""}
		};
	`, kontext);
	return {
		api: kontext.__api,
		quelleMapSearchKind: ausschneiden(html, datei, "mapSearchKind"),
		setzeTreffer: (liste) => { kontext.__treffer = liste; },
		abrufe: kontext.__abrufe,
	};
}

const zeile = (x) => `${x.kind}:${x.name}`;
const zeilen = (liste) => Array.from(liste, zeile);

// Je ein Treffer jeder Art, die die Kartensuche heute liefert -- in der Form der Live-Antwort vom 14.09.2026
// (api/app/map-search.php samt landscape-, in-settlement-, citymap-, game-literature-, lore- und
// offmap-search.php). Die Reihenfolge mischt Ziele und Nicht-Ziele, damit ein Filter, der die Ordnung
// zerstoert, auffaellt.
const ALLE_ARTEN = [
	{ kind: "landscape", public_id: "8bb7ebeb-187d-4dd1-9eb6-b42654ee89bc", name: "Ceälan", type_label: "Insel", feature_subtype: "insel", ecosystem_kind: "topographie" },
	{ kind: "location", public_id: "33933a95-ef5e-4b4a-ac2c-4d9b86878549", name: "Tannwald", type_label: "Ort", feature_subtype: "dorf" },
	{ kind: "in_settlement", public_id: "33933a95-ef5e-4b4a-ac2c-4d9b86878549", name: "Rahja-Tempel", type_label: "Rahja-Tempel in Tannwald", feature_subtype: "dorf" },
	{ kind: "label", public_id: "53022cbf-74ba-4e05-9110-18ff0e3067a0", name: "Ceälan", type_label: "Vulkan", feature_subtype: "vulkan" },
	{ kind: "powerline", public_id: "kraftlinie-1", name: "Tannwalder Linie", type_label: "Kraftlinie", feature_subtype: "" },
	{ kind: "region", public_id: "8f5e11e3-d9ef-47a5-922e-3ec1ec69cd4d", name: "Baronie Tannwald", type_label: "Herrschaftsgebiet", feature_subtype: "political_territory" },
	{ kind: "region", public_id: "altes-regionspolygon", name: "Altes Land", type_label: "Politisches Land", feature_subtype: "" },
	{ kind: "path", public_id: "weg-segment-1", name: "Tannwalder Weg", type_label: "Weg", feature_subtype: "Weg" },
	{ kind: "citymap", public_id: "karte-1", name: "Stadtplan von Tannwald", type_label: "Stadtplan · Tannwald", feature_subtype: "citymap", not_on_map: true },
	{ kind: "adventure", public_id: "werk-1", name: "Im Tannwald", type_label: "Abenteuer", feature_subtype: "adventure", not_on_map: true },
	{ kind: "lore", public_id: "borkenb-r", name: "Borkenbär", type_label: "Fauna", feature_subtype: "fauna", not_on_map: true },
	{ kind: "offmap", public_id: "", name: "Burg Tannwald", type_label: "Burg", feature_subtype: "building", not_on_map: true },
	// ⭐ Die Art, die es noch nicht gibt: der eigentliche Beweis fuer die positive Liste.
	{ kind: "neue_art_die_es_noch_nicht_gibt", public_id: "zukunft-1", name: "Tannwald der Zukunft", type_label: "?", feature_subtype: "" },
];
const NUR_ZIELE = ["location:Tannwald", "label:Ceälan", "region:Baronie Tannwald", "path:Tannwalder Weg"];

// „Tannwald" lieferte live 9 Treffer. Kaeme die Kappung auf 8 vor dem Filter, fraessen zehn Vorkommen den
// einen Ort -- geprueft an BEIDEN Listen.
const ZEHN_VORKOMMEN_UND_EIN_ORT = Array.from({ length: 10 }, (_, i) => ({ kind: "lore", public_id: "ware-" + i, name: "Ware " + i }))
	.concat([{ kind: "location", public_id: "ort-1", name: "Hinterdorf", feature_subtype: "dorf" }]);

(async () => {
	const seiten = [
		{ datei: "html/citymap-editor.html", mitOrtsfilter: false },
		{ datei: "html/game-literature-editor.html", mitOrtsfilter: true },
	];
	const geladen = seiten.map((seite) => ({ ...seite, ...ladeSeite(seite.datei, seite.mitOrtsfilter) }));

	// ---- EINE Regel: beide Seiten tragen dieselbe Abschrift von mapSearchKind -------------------------------
	// Sie steht zweimal da (zwei eigenstaendige Seiten ohne gemeinsames Skript). Laeuft sie auseinander,
	// zeigen die zwei Vorschlagslisten fuer dieselbe Suche verschiedene Orte.
	const ohneLeerraum = (text) => text.replace(/\s+/g, " ");
	assert.strictEqual(ohneLeerraum(geladen[0].quelleMapSearchKind), ohneLeerraum(geladen[1].quelleMapSearchKind),
		"mapSearchKind ist in den zwei Editorseiten auseinandergelaufen"); checks++;

	for (const seite of geladen) {
		const { datei, api } = seite;

		// ---- DIE EIGENTLICHE REGEL: nur Treffer mit Ziel, in der Reihenfolge der Suche ------------------
		seite.setzeTreffer(ALLE_ARTEN);
		const vorschlaege = await api.vorschlaege("Tannwald");
		assert.deepStrictEqual(zeilen(vorschlaege), NUR_ZIELE, `💣 ${datei}, Ort hinzufuegen: ${zeilen(vorschlaege).join(" | ")}`); checks++;
		for (const treffer of vorschlaege) {
			assert.notStrictEqual(api.mapSearchKind(treffer), "", `${datei}: ${zeile(treffer)} hat kein Ziel`); checks++;
		}

		// ---- gefiltert wird VOR dem Kappen auf 8 --------------------------------------------------------
		seite.setzeTreffer(ZEHN_VORKOMMEN_UND_EIN_ORT);
		assert.deepStrictEqual(zeilen(await api.vorschlaege("dorf")), ["location:Hinterdorf"], `${datei}: Kappung vor dem Filter`); checks++;

		// ---- nur Nicht-Ziele -> keine Vorschlaege (die Freitext-Zeile zeichnet renderAc trotzdem) --------
		seite.setzeTreffer(ALLE_ARTEN.filter((x) => api.mapSearchKind(x) === ""));
		assert.deepStrictEqual(zeilen(await api.vorschlaege("Archipel der Perlen")), [], `${datei}: nur Nicht-Ziele`); checks++;

		// Die Abfrage selbst bleibt unangetastet (edit_mode haelt spotlight-unsichtbare-beschriftung.test.js).
		assert.ok(seite.abrufe.every((adresse) => adresse.startsWith("/api/app/map-search.php?")), `${datei}: ${seite.abrufe.join(" | ")}`); checks++;

		if (!seite.mitOrtsfilter) {
			continue;
		}

		// ---- Ortsfilter der Literatur: dieselbe Regel, sonst setzt ein Nicht-Ziel eine fremde Kennung -----
		seite.setzeTreffer(ALLE_ARTEN);
		const ortsfilter = await api.ortsfilter("Tannwald");
		assert.deepStrictEqual(zeilen(ortsfilter), NUR_ZIELE, `💣 ${datei}, Ortsfilter: ${zeilen(ortsfilter).join(" | ")}`); checks++;

		seite.setzeTreffer(ZEHN_VORKOMMEN_UND_EIN_ORT);
		assert.deepStrictEqual(zeilen(await api.ortsfilter("dorf")), ["location:Hinterdorf"], `${datei}: Ortsfilter, Kappung vor dem Filter`); checks++;

		// Ohne Kennung kein Filter -- die bestehende Bedingung bleibt neben der neuen stehen.
		seite.setzeTreffer([{ kind: "location", public_id: "", name: "Ohne Kennung", feature_subtype: "dorf" }]);
		assert.deepStrictEqual(zeilen(await api.ortsfilter("Ohne")), [], `${datei}: Ortsfilter ohne Kennung`); checks++;
	}

	console.log(`editor-ortsvorschlaege-arten.test: OK (${checks} checks)`);
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
