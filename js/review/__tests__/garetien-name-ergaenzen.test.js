// „Quelle und Namen ergänzen" (Owner 15.09.2026) -- die Zielwahl `ergaenzen_name` im Client.
//
// Owner, wörtlich: „wenn ich "Quelle an „Wald-190" ergänzen" mach - ersetzt es dann auch den namen? …
// wenn nicht, kannst du - sofern solche fälle auftreten - die Option "Quelle und Namen ergänzen" machen?"
// Entscheide auf Rückfrage: die Option erscheint NUR bei Platzhalternamen, und ↩ nimmt Quelle UND Namen zurück.
//
// 🔴 DIE REGEL „IST DAS EIN PLATZHALTER?" STEHT AM SERVER (avesmapsGaretienNameIstPlatzhalter) -- dieser Test
// prüft, dass der Browser nur das Feld `platzhalter` liest, das die Liste je Abschnitt mitschickt, und daraus
// GENAU dann die Wahl anbietet, wenn ALLE Abschnitte der Ergänzung einen tragen. Die Serverseite (Regel,
// Übernahme, Rücknahme) prüft api/_internal/import/__tests__/garetien-name-ergaenzen-test.php.
//
// 💣 GEFAHREN, NICHT GELESEN: jede Zusicherung ruft die echten Funktionen des Importers, bis hin zum Rumpf,
// der beim Server ankommt.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-name-ergaenzen.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter(["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-sheet"]);

let n = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); n++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); n++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); n++; };

// =================================================================================================
// Die Lage: ein Wald von garetien.de deckt sich mit ZWEI unserer Flächen-Abschnitte. Je Abschnitt ein
// Ergänzungs-Item, dazu das Zusatz-Item („trotzdem neu anlegen") -- dieselbe Form wie die Natter in
// garetien-zielwahl-ziele.test.js.
// `abschnittFlag`: was am ITEM steht (undefined = das Item trägt nur die public_id), `objektFlag`: was in
// `objekt.abschnitte` steht.
// =================================================================================================
function wald(abschnitte, name) {
	const liste = [];
	const items = [];
	abschnitte.forEach((a, i) => {
		const pid = "00000000-0000-4000-8000-00000000019" + i;
		liste.push({ public_id: pid, name: a.name, platzhalter: a.objektFlag });
		const amItem = { public_id: pid };
		if (a.abschnittFlag !== undefined) {
			amItem.name = a.name;
			amItem.platzhalter = a.abschnittFlag;
		}
		items.push({ id: 81 + i, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"], abschnitt: amItem });
	});
	items.push({ id: 89, change_type: "new", anlass: "zusatz", felder: [] });
	return { key: "ggp:Waelder:Wald:Garetien:Alkenwald!" + (name || "Alkenwald"), stand: "offen", urteil: "ergaenzung",
		name: name || "Alkenwald", typ: "Wald", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: liste, items: items };
}
const zweiGriffe = () => wald([
	{ name: "Wald-190", objektFlag: true, abschnittFlag: true },
	{ name: "Wald-190", objektFlag: true, abschnittFlag: true },
]);
const einEchter = () => wald([
	{ name: "Wald-190", objektFlag: true, abschnittFlag: true },
	{ name: "Alter Forst", objektFlag: false, abschnittFlag: false },
]);
// Ein Bauwerk ohne jede Ergänzung -- es hat nichts zu ergänzen, also auch keinen Namen.
function burg() {
	return { key: "ggp:Bauwerke:Burg:Garetien:Burg Finster!Burg Finster", stand: "offen", urteil: "neu",
		name: "Burg Finster", typ: "Burg", ziel: "location", subtyp: "gebaeude", kind: "",
		geometrie: [[100, 100]], abschnitte: [], items: [{ id: 21, change_type: "new", anlass: "", felder: ["quelle"] }] };
}

const ids = (o) => api.garetienStageItems(o).map((i) => i.id).sort((a, b) => a - b);
const jeItem = (o) => api.garetienStageEinstellungenJeItem([o]);
function frisch() {
	api.garetienZielwahlVergessen();
	api.garetienZielWahlVergessen();
	api.garetienInnerortsWahlVergessen();
	api.garetienNameWahlVergessen();
	api.avesmapsGaretienStageLeeren();
}
function feldEreignis(feld, wert) {
	return { target: {
		getAttribute: (name) => (name === "data-gi-feld" ? feld : null),
		hasAttribute: (name) => name === "data-gi-feld",
		value: wert, checked: true, type: feld === "zielwahl" ? "radio" : "select-one",
	} };
}

// =================================================================================================
// A. Der Wert und sein Platz
// =================================================================================================
wahr(typeof api.garetienErgaenzungAllePlatzhalter === "function", "garetienErgaenzungAllePlatzhalter ist exportiert");
gleich(api.AVESMAPS_GARETIEN_ZIELE.indexOf("ergaenzen_name"), api.AVESMAPS_GARETIEN_ZIELE.indexOf("ergaenzen") + 1,
	"„ergaenzen_name\" steht direkt hinter „ergaenzen\"");

// =================================================================================================
// B. WANN es die Wahl gibt -- nur, wenn ALLE Abschnitte der Ergänzung einen Platzhalter tragen
// =================================================================================================
frisch();
tief(api.garetienZieleMoeglich(zweiGriffe()), ["ergaenzen", "ergaenzen_name", "karte", "zusaetzlich", "nichts"],
	"zwei Platzhalter: die Wahl steht direkt unter der Vorbelegung „ergaenzen\"");
tief(api.garetienZieleMoeglich(einEchter()), ["ergaenzen", "karte", "zusaetzlich", "nichts"],
	"🔴 ein echter Name unter zwei Abschnitten: KEINE Wahl -- sie schriebe an „Alter Forst\" vorbei");
tief(api.garetienZieleMoeglich(burg()), ["karte", "nichts"], "ohne Ergänzungs-Items gibt es nichts zu ergänzen");
gleich(api.garetienErgaenzungAllePlatzhalter(burg()), false, "…und die Regel sagt dasselbe");
gleich(api.garetienErgaenzungAllePlatzhalter(wald([
	{ name: "Wald-190", objektFlag: true, abschnittFlag: undefined },
	{ name: "Wald-190", objektFlag: true, abschnittFlag: undefined },
])), true, "⚠️ trägt das Item nur die public_id, gilt der Befund aus `objekt.abschnitte`");
gleich(api.garetienErgaenzungAllePlatzhalter(wald([
	{ name: "Wald-190", objektFlag: true, abschnittFlag: false },
])), false, "…aber der Befund AM ITEM gewinnt, wenn er dasteht");
gleich(api.garetienErgaenzungAllePlatzhalter(wald([
	{ name: "Wald-190", objektFlag: "true", abschnittFlag: undefined },
])), false, "💣 nur ein echtes `true` zählt, keine Zeichenkette");
gleich(api.garetienErgaenzungAllePlatzhalter(wald([{ name: "Wald-190" }])), false,
	"ein Abschnitt ganz ohne Befund zählt nicht als Platzhalter");
{
	const o = zweiGriffe();
	o.items[0].abschnitt = {};
	gleich(api.garetienErgaenzungAllePlatzhalter(o), false, "⚠️ ein Item ohne Abschnittskennung macht die Antwort `false`");
}

// =================================================================================================
// C. Keine Automatik -- und eine unmögliche Wahl zählt nie
// =================================================================================================
frisch();
gleich(api.garetienZielwahlZu(zweiGriffe()), "ergaenzen", "🔴 die Vorbelegung bleibt „ergaenzen\" (keine Automatik)");
{
	const o = einEchter();
	api.garetienZielwahlSetzen(o, "ergaenzen_name");
	gleich(api.garetienZielwahlZu(o), "ergaenzen", "💣 ohne Platzhalter fällt eine gesetzte Wahl auf die Vorbelegung");
	const g = zweiGriffe();
	api.garetienZielwahlSetzen(g, "ergaenzen_name");
	gleich(api.garetienZielwahlZu(g), "ergaenzen_name", "Gegenprobe: mit Platzhaltern hält sie");
}

// =================================================================================================
// D. Was beim Server ankommt -- die Items und der Rumpf je Item
// =================================================================================================
frisch();
{
	const o = zweiGriffe();
	api.garetienZielwahlSetzen(o, "ergaenzen");
	tief(ids(o), [81, 82], "ergaenzen: die zwei Ergänzungs-Items");
	tief(jeItem(o), {}, "🔴 ergaenzen: KEIN Rumpf -- also auch kein `name_ergaenzen`");

	api.garetienZielwahlSetzen(o, "ergaenzen_name");
	tief(ids(o), [81, 82], "ergaenzen_name: DIESELBEN Items -- ohne das Zusatz-Item");
	tief(jeItem(o), {
		"81": { name_ergaenzen: true, name: "Alkenwald" },
		"82": { name_ergaenzen: true, name: "Alkenwald" },
	}, "💣 ergaenzen_name: jedes Item trägt den Auftrag UND den Namen -- auch wenn er dem Importwert gleicht, "
		+ "und NIE `ziel` (der formte das bestehende Objekt um)");
	tief(api.garetienStageUebernahmeIds([o]).sort((a, b) => a - b), [81, 82], "der Schreibumfang folgt der Wahl");

	api.garetienNameWahlSetzen(o, "Alkenhain");
	gleich(jeItem(o)["81"].name, "Alkenhain", "ein von Hand geänderter Name reist mit");

	api.garetienZielwahlSetzen(o, "zusaetzlich");
	tief(jeItem(o)["81"], { beides: true }, "Gegenprobe: „zusätzlich\" trägt am Ergänzungs-Item weiter NUR den Riegel");
}
frisch();
{
	// Der Namensvorschlag des Importers gilt auch hier: „Dorf Tannweiler" heißt „Tannweiler".
	const o = wald([{ name: "Fläche-048", objektFlag: true, abschnittFlag: true }], "Dorf Tannweiler");
	api.garetienZielwahlSetzen(o, "ergaenzen_name");
	tief(jeItem(o), { "81": { name_ergaenzen: true, name: "Tannweiler" } },
		"der Name ist der, den das Namensfeld zeigt (garetienNameFuerImport)");
}

// =================================================================================================
// E. Die Texte, das Namensfeld und die Zeile auf der Stage
// =================================================================================================
frisch();
{
	const o = zweiGriffe();
	tief(api.garetienZielwahlTexte(o, "ergaenzen_name"), {
		t1: "Quelle und Namen an „Wald-190“ ergänzen",
		t2: "An 2 Abschnitte. „Wald-190“ ist ein Platzhalter und heißt danach wie im Namensfeld.",
		warn: false,
	}, "die Zeile nennt Ziel, Zahl und Folge");
	api.avesmapsGaretienStageHinzufuegen([o]);
	const mk = api.garetienZielwahlMarkup(o);
	wahr(mk.includes('value="ergaenzen_name"') && mk.includes("Quelle und Namen an „Wald-190“ ergänzen"),
		"auf der Stage steht die Wahl: " + mk);
	wahr(/value="ergaenzen" data-gi-feld="zielwahl" checked/.test(mk) && !/value="ergaenzen_name"[^>]* checked/.test(mk),
		"🔴 vorgewählt bleibt „Quelle an X ergänzen\"");

	const nameAus = api.garetienZielNameZeile(o);
	wahr(nameAus.includes("gi-insert__row--aus") && /data-gi-feld="einfuegeName"[^>]* disabled/.test(nameAus),
		"bei „ergaenzen\" ist das Namensfeld abgeblendet: " + nameAus);
	gleich(api.garetienStageZeile2(o, true), "Quelle an „Wald-190“ (2 Abschnitte)", "Stage-Zeile bei „ergaenzen\"");

	api.garetienZielwahlSetzen(o, "ergaenzen_name");
	const nameAn = api.garetienZielNameZeile(o);
	wahr(!nameAn.includes("gi-insert__row--aus") && !/data-gi-feld="einfuegeName"[^>]* disabled/.test(nameAn),
		"🔴 bei „ergaenzen_name\" ist das Namensfeld bedienbar: " + nameAn);
	wahr(nameAn.includes('value="Alkenwald"'), "…und zeigt den Namen, der geschrieben wird");
	api.garetienNameWahlSetzen(o, "Alkenhain");
	wahr(api.garetienZielNameZeile(o).includes('data-gi-zuruecksetzen="name"'),
		"…mit Importwert-Zeile und ↺, sobald der Name vom Import abweicht");
	gleich(api.garetienStageZeile2(o, true), "Quelle + Name an „Wald-190“ (2 Abschnitte)", "Stage-Zeile bei „ergaenzen_name\"");
	gleich(api.garetienZielwahlAusGrund(o), "gilt nicht für eine Ergänzung", "Form, Art und Darstellung bleiben abgeblendet");

	const kasten = api.garetienEingefuegtWirdMarkup(o);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten) && kasten.includes("gilt nicht für eine Ergänzung"),
		"⚠️ die Form bleibt gesperrt, mit Grund: " + kasten);
	gleich((kasten.match(/data-gi-feld="einfuegeName"/g) || []).length, 1, "das Namensfeld steht genau einmal da");
}

// =================================================================================================
// F. Die Rückfrage vor ↩ sagt, dass der Name zurückgeht
// =================================================================================================
{
	const uebernommen = (mitName) => ({ key: "ggp:Waelder:Wald:Garetien:Alkenwald!Alkenwald" + (mitName ? "" : "2"),
		stand: "uebernommen", name: "Alkenwald", ziel: "region", geometrie_typ: "Polygon", abschnitte: [],
		items: [{ id: mitName ? 91 : 92, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"],
			apply_state: "done", name_ergaenzt: mitName }] });
	const mit = api.garetienRuecknahmeRueckfrageText(uebernommen(true), false);
	wahr(mit.includes("fällt auf den Platzhalter zurück") && !mit.includes("bleibt unverändert"),
		"🔴 mit Namens-Vermerk verspricht die Rückfrage NICHT „bleibt unverändert\": " + mit);
	const ohne = api.garetienRuecknahmeRueckfrageText(uebernommen(false), false);
	wahr(ohne.includes("bleibt unverändert auf der Karte") && !ohne.includes("Platzhalter"),
		"Gegenprobe: ohne Namens-Vermerk bleibt der Satz, wie er war: " + ohne);
	const menge = api.garetienRuecknahmeMengeRueckfrageText([uebernommen(true), uebernommen(false)]);
	wahr(menge.includes("bei 1 Objekt werden Quellenangabe und ergänzter Name zurückgenommen")
		&& menge.includes("wird nur die Quellenangabe entfernt"),
		"die Mengen-Rückfrage zählt beide Sorten getrennt: " + menge);
	gleich(api.garetienItemIstQuelleNur(uebernommen(true).items[0]), true,
		"⚠️ die Felder bleiben ['quelle'] -- der Riegel der Rücknahme gilt unverändert");
}

// =================================================================================================
// G. Der Klickweg bis zum Server -- asynchron
// =================================================================================================
async function pruefeImport() {
	const echtesFetch = global.fetch;
	const angefragt = [];
	global.fetch = function (pfad, optionen) {
		const rumpf = JSON.parse((optionen && optionen.body) || "{}");
		angefragt.push(rumpf);
		let daten = { ok: true, objekte: [], gesamt: 0, bilanz: {}, reiter: {}, facetten: {} };
		if (rumpf.action === "select") { daten = { ok: true }; }
		if (rumpf.action === "apply") {
			daten = { ok: true, done: true, applied: 2, deleted: 0, stale: 0, processed: 2, remaining: 0,
				skipped: 0, declined: 0, fehler: [] };
		}
		return Promise.resolve({ json: () => Promise.resolve(daten) });
	};
	try {
		frisch();
		const o = zweiGriffe();
		api.avesmapsGaretienStageHinzufuegen([o]);
		api.garetienDetailWaehlen(o.key, [o]);
		api.garetienEingabenAendern(feldEreignis("zielwahl", "ergaenzen_name"), [o]);
		gleich(api.garetienZielwahlZu(o), "ergaenzen_name", "der Klick auf das Radio setzt die Wahl");
		gleich(dom.el("#garetien-apply").disabled, false, "der Fußknopf ist bedienbar");

		const gefragt = [];
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return true; });
		gleich(gefragt.length, 1, "nur die allgemeine Rückfrage -- „ergaenzen_name\" legt kein zweites Objekt an");
		const apply = angefragt.filter((a) => a.action === "apply")[0];
		wahr(apply && apply.einstellungen_je_item, "der apply-Rumpf trägt einstellungen_je_item: " + JSON.stringify(apply));
		tief(apply.ids.slice().sort((a, b) => a - b), [81, 82], "💣 genau die zwei Ergänzungs-Items, nie das Zusatz-Item");
		tief(apply.einstellungen_je_item, {
			"81": { name_ergaenzen: true, name: "Alkenwald" },
			"82": { name_ergaenzen: true, name: "Alkenwald" },
		}, "🔴 der Auftrag ERREICHT den Server, mit genau diesem Rumpf");
	} finally {
		global.fetch = echtesFetch;
		api.garetienDetailWaehlen(null, []);
		frisch();
	}
}

pruefeImport().then(() => {
	console.log("OK -- garetien-name-ergaenzen: " + n + " Zusicherungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});
