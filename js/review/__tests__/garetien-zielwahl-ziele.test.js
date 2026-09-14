// Aufgabe 9 des Bauplans „Garetien-Importer vereint" (14.09.2026): die ZIELWAHL im Client.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §5
// Mockup:  docs/garetien-import-vereint-mockup.html, Szenen 3 und 5
//
// 🔴 ERSETZT garetien-einfuege-haken.test.js. Die zwei Häkchen „Als Quelle einfügen" / „Neu
// einfügen" sind Werte EINER Liste geworden; ihre Zusicherungen (Vorbelegung, der Schreibumfang
// folgt der Anzeige, vor der Stage steht nichts) stehen hier gegen die Zielwahl.
//
// 💣 DIE KERNZUSICHERUNG (Abschnitt C): für JEDEN der sechs Zielwerte, welche Item-IDs
// `garetienStageItems` liefert und welcher `einstellungen_je_item`-Rumpf daraus entsteht -- an drei
// Objekten, die die drei Lagen eines Laufs abbilden. GEFAHREN, nicht gelesen: in diesem Vorhaben
// war eine Quelltext-Zusicherung viermal ein Vakuum.
//
// 🔴 BESTAND (Owner 14.09.2026, Abschnitt I): der Importer ist live. Ein übernommenes und ein
// abgelehntes Objekt zeigen weiter, was sie vorher zeigten -- und KEINE Zielwahl.
//
// ⚠️ Abschnitt G und H setzen Aufgabe 6 voraus (`garetienVerbundZusammenlegbar`, die
// `…Vergessen`-Aufrufe in `avesmapsGaretienStageLeeren`).
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-zielwahl-ziele.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter(["garetien-apply", "garetien-apply-hint", "garetien-listcol", "garetien-sheet"]);

let n = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); n++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); n++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); n++; };

// =================================================================================================
// Die drei Lagen eines Laufs -- jede OHNE `verbund_stamm`/`verbund_n`, so wie jeder Lauf vor dem
// Deploy (Bestand).
// =================================================================================================
// 1. Ein Fluss, der sich mit sechs unserer Abschnitte deckt: sechs Ergänzungs-Items + ein Zusatz-Item
//    (Mockup §5 rechts). ⚠️ Am Item steht nur die `public_id` des Abschnitts -- der Name kommt aus
//    `objekt.abschnitte`, wie in der echten Listenantwort.
function natter() {
	const abschnitte = [];
	const items = [];
	for (let i = 0; i < 6; i++) {
		const abschnitt = { public_id: "Flussweg-44" + i, name: "Natter" };
		abschnitte.push(abschnitt);
		items.push({ id: 11 + i, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"],
			abschnitt: { public_id: abschnitt.public_id } });
	}
	items.push({ id: 17, change_type: "new", anlass: "zusatz", felder: [] });
	return { key: "ggp:Gewaesser:Fluss:Garetien:Natter!Natter", stand: "offen", urteil: "ergaenzung",
		name: "Natter", typ: "Fluss", ziel: "path", subtyp: "Flussweg", kind: "",
		geometrie: [[1, 1], [2, 2]], abschnitte: abschnitte, items: items };
}
// 2. Ein neues Bauwerk mit zwei Siedlungen im Umkreis (Mockup §5 links).
function burg() {
	return { key: "ggp:Bauwerke:Burg:Garetien:Burg Finster!Burg Finster", stand: "offen", urteil: "neu",
		name: "Burg Finster", typ: "Burg", ziel: "location", subtyp: "gebaeude", kind: "",
		geometrie: [[100, 100]], abschnitte: [],
		innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8,
			kandidaten: [
				{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8, nennt_name: false },
				{ public_id: "dorf-rallerfurt", name: "Rallerfurt", meilen: 2.1, nennt_name: false },
			] },
		items: [{ id: 21, change_type: "new", anlass: "", felder: ["quelle"] }] };
}
// 3. Ein Objekt ohne jeden Vorschlag.
function perz() {
	return { key: "ggp:Ortschaften:Dorf:Garetien:Perz!Perz", stand: "offen", urteil: "uebersprungen",
		name: "Perz", typ: "Dorf", ziel: "location", subtyp: "dorf", geometrie: [[5, 5]],
		abschnitte: [], items: [] };
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
// A. Die Konstante, die Namen -- und was gefallen ist
// =================================================================================================
tief(api.AVESMAPS_GARETIEN_ZIELE, ["karte", "staette", "nur_quelle", "ergaenzen", "zusaetzlich", "nichts"],
	"die sechs Zielwerte des Vertrags, in dieser Reihenfolge");
frisch();
gleich(typeof api.garetienZielwahlZu(natter()), "string",
	"💣 garetienZielwahlZu (kleines w) ist das ZIEL und liefert eine Zeichenkette");
gleich(typeof api.garetienZielWahlZu(natter()), "object",
	"💣 …garetienZielWahlZu (großes W) bleibt die FORM und liefert ein Objekt -- zwei Funktionen");
["garetienEinfuegeWahl", "garetienEinfuegeWahlSetzen", "garetienEinfuegeWahlVergessen",
	"garetienEinfuegeHakenMarkup", "garetienNeuMoeglich", "garetienQuelleMoeglich", "garetienNeuItems",
	"garetienNeuKlick",
].forEach((name) => gleich(api[name], undefined, "🔴 " + name + " ist gefallen"));

// =================================================================================================
// B. Was zur Wahl steht -- und die Vorbelegung
// =================================================================================================
frisch();
tief(api.garetienZieleMoeglich(natter()), ["ergaenzen", "karte", "zusaetzlich", "nichts"],
	"Natter (deckt sich): die Vorbelegung vorne, wie im Mockup §5 rechts");
tief(api.garetienZieleMoeglich(burg()), ["karte", "staette", "nur_quelle", "nichts"],
	"Burg Finster (Bauwerk, zwei Siedlungen): wie im Mockup §5 links");
tief(api.garetienZieleMoeglich(perz()), ["nichts"],
	"🔴 ohne Vorschlag gibt es nur „Nichts\" -- „Auf die Karte\" täte hier still nichts");
gleich(api.garetienZielwahlZu(natter()), "ergaenzen", "deckt sich -> „Quelle an X ergänzen\"");
gleich(api.garetienZielwahlZu(burg()), "karte",
	"💣 eine gefundene Stadt ist KEINE Vorbelegung -- sonst legte der Import still ~350 Stätten an");
gleich(api.garetienZielwahlZu(perz()), "nichts", "ohne Vorschlag: „Nichts\"");

// 💣 Eine unmögliche Wahl zählt nie.
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "staette");
	gleich(api.garetienZielwahlZu(o), "ergaenzen", "💣 „Stätte\" gibt es beim Fluss nicht -> Vorbelegung");
	const b = burg();
	api.garetienZielwahlSetzen(b, "quatsch");
	gleich(api.garetienZielwahlZu(b), "karte", "ein unbekannter Wert wird verworfen");
	api.garetienZielwahlSetzen(b, "staette");
	gleich(api.garetienZielwahlZu(b), "staette", "Gegenprobe: am Bauwerk hält „Stätte\"");
	const form = api.garetienZielWahlZu(b);
	form.ziel = "region"; form.subtyp = "wald"; form.kind = "vegetation";
	gleich(api.garetienZielwahlZu(b), "karte",
		"💣 mit der Form „Fläche\" gibt es keine Stätte mehr -- die stehengebliebene Wahl zählt nicht");
}

// =================================================================================================
// C. DER KERN -- sechs Zielwerte × drei Lagen: Item-IDs und `einstellungen_je_item`
// =================================================================================================
// ---- karte ----------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "karte");
	tief(ids(o), [17], "karte · Natter: NUR das Zusatz-Item -- 💣 nie zugleich die sechs Ergänzungen");
	const r = jeItem(o);
	tief(Object.keys(r), ["17"], "karte · Natter: ein Rumpf, am Zusatz-Item: " + JSON.stringify(r));
	gleich(r["17"].ziel, "path", "…mit der gewählten Form");
	gleich(r["17"].subtyp, "Flussweg", "…und Art");
	gleich("beides" in r["17"], false, "🔴 ohne „zusätzlich\" kein `beides`");
	gleich("innerorts" in r["17"], false, "…und kein innerorts");

	const b = burg();
	api.garetienZielwahlSetzen(b, "karte");
	tief(ids(b), [21], "karte · Burg: das Neu-Item");
	const rb = jeItem(b);
	tief(Object.keys(rb), ["21"]);
	gleich(rb["21"].ziel, "location", "karte · Burg: ein Kartenpunkt");
	gleich("innerorts" in rb["21"], false, "💣 eine gefundene Stadt macht aus „Auf die Karte\" keine Stätte");

	const p = perz();
	api.garetienZielwahlSetzen(p, "karte");
	tief(ids(p), [], "karte · Perz: unmöglich -> nichts");
	tief(jeItem(p), {}, "…und kein Rumpf");
}
// ---- staette --------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "staette");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "staette · Natter: unmöglich -> die Vorbelegung (Ergänzung)");
	tief(jeItem(o), {}, "…und eine Ergänzung trägt keinen Rumpf, wie bisher");

	const b = burg();
	api.garetienZielwahlSetzen(b, "staette");
	tief(ids(b), [21], "staette · Burg: dasselbe Neu-Item -- ein anderer Zielort, kein anderer Vorschlag");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth" } },
		"💣 staette · Burg: GENAU diese zwei Werte -- kein `ziel`, sonst formte der Server die Geometrie "
		+ "für ein Ziel um, das nie gebaut wird");

	const p = perz();
	api.garetienZielwahlSetzen(p, "staette");
	tief(ids(p), [], "staette · Perz: nichts");
}
// ---- nur_quelle -----------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "nur_quelle");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "nur_quelle · Natter: unmöglich -> Vorbelegung");

	const b = burg();
	api.garetienZielwahlSetzen(b, "nur_quelle");
	api.garetienNameWahlSetzen(b, "Burg Finsterstein");
	tief(ids(b), [21], "nur_quelle · Burg: das Neu-Item trägt den Auftrag");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth", innerorts_nur_quelle: true } },
		"🔴 nur_quelle · Burg: innerorts UND innerorts_nur_quelle -- und ⚠️ KEIN Name aus einer früheren Wahl");

	const p = perz();
	api.garetienZielwahlSetzen(p, "nur_quelle");
	tief(ids(p), [], "nur_quelle · Perz: nichts");
}
// ---- ergaenzen ------------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "ergaenzen");
	tief(ids(o), [11, 12, 13, 14, 15, 16], "ergaenzen · Natter: die sechs Ergänzungs-Items, OHNE das Zusatz-Item");
	tief(jeItem(o), {},
		"💣 ergaenzen · Natter: kein Rumpf -- mit `ziel` formte der Server ein BESTEHENDES Objekt um");

	const b = burg();
	api.garetienZielwahlSetzen(b, "ergaenzen");
	tief(ids(b), [21], "ergaenzen · Burg: unmöglich -> Vorbelegung (Karte)");

	const p = perz();
	api.garetienZielwahlSetzen(p, "ergaenzen");
	tief(ids(p), [], "ergaenzen · Perz: nichts");
}
// ---- zusaetzlich ----------------------------------------------------------------------------------
frisch();
{
	const o = natter();
	api.garetienZielwahlSetzen(o, "zusaetzlich");
	tief(ids(o), [11, 12, 13, 14, 15, 16, 17], "zusaetzlich · Natter: Zusatz- UND Ergänzungs-Items");
	const r = jeItem(o);
	tief(Object.keys(r).sort(), ["11", "12", "13", "14", "15", "16", "17"],
		"🔴 zusaetzlich · Natter: JEDES der sieben Items trägt einen Eintrag: " + JSON.stringify(r));
	gleich(r["17"].beides, true, "…das Zusatz-Item bestätigt `beides`");
	gleich(r["17"].ziel, "path", "…und trägt seine Form");
	[11, 12, 13, 14, 15, 16].forEach((id) => {
		tief(r[String(id)], { beides: true },
			"💣 zusaetzlich · Ergänzung " + id + ": NUR der Riegel -- nie `ziel`, nie `name`");
	});
	tief(api.garetienStageUebernahmeIds([o]).sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17],
		"der Schreibumfang folgt der Wahl");
	tief(api.garetienStageAnhakenIds([o]).sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17],
		"💣 …und das Anhaken auch -- ein nie angehaktes Item erreicht `apply` nie");

	const b = burg();
	api.garetienZielwahlSetzen(b, "zusaetzlich");
	tief(ids(b), [21], "zusaetzlich · Burg: unmöglich -> Karte");
	gleich("beides" in (jeItem(b)["21"] || {}), false, "…ohne `beides`");

	const p = perz();
	api.garetienZielwahlSetzen(p, "zusaetzlich");
	tief(ids(p), [], "zusaetzlich · Perz: nichts");
}
// ---- nichts ---------------------------------------------------------------------------------------
frisch();
[natter(), burg(), perz()].forEach((o) => {
	api.garetienZielwahlSetzen(o, "nichts");
	tief(ids(o), [], "nichts · " + o.name + ": keine Items");
	tief(jeItem(o), {}, "nichts · " + o.name + ": kein Rumpf");
	tief(api.garetienStageUebernahmeIds([o]), [], "nichts · " + o.name + ": nicht im Schreibumfang");
});

// =================================================================================================
// D. Die Zählung -- „Stätte in X" wird gezählt
// =================================================================================================
frisch();
{
	const b = burg();
	api.garetienZielwahlSetzen(b, "staette");
	const stand = api.garetienUebernahmeKnopfZustand([b]);
	gleich(stand.anzahl, 1, "💣 „Stätte in X\" wird vom Fußknopf gezählt -- bis zum 14.09.2026 stand dort „0 von 1\"");
	gleich(stand.gesperrt, false, "…und er ist bedienbar");
	api.garetienZielwahlSetzen(b, "nichts");
	gleich(api.garetienUebernahmeKnopfZustand([b]).anzahl, 0, "„Nichts\" wird nicht gezählt");
}

// =================================================================================================
// F. Das Markup und der Klick -- ausgeführt, wie im Browser
// =================================================================================================
frisch();
{
	const b = burg();
	gleich(api.garetienZielwahlMarkup(b), "", "🔴 vor der Stage steht keine Zielwahl");
	api.avesmapsGaretienStageHinzufuegen([b]);
	let mk = api.garetienZielwahlMarkup(b);
	wahr(mk.includes('<div class="gi-ziel" role="radiogroup" aria-label="Was daraus wird">'),
		"auf der Stage: die Radio-Liste des Mockups: " + mk);
	gleich((mk.match(/class="gi-ziel__option/g) || []).length, 4, "vier Optionen");
	wahr(/value="karte" data-gi-feld="zielwahl" checked/.test(mk), "vorgewählt ist „Auf die Karte\"");
	wahr(/gi-ziel__option is-gewaehlt"><input type="radio"[^>]*value="karte"/.test(mk),
		"…und die gewählte Option trägt is-gewaehlt");
	wahr(mk.includes('<span class="gi-ziel__t1">Stätte in „Wandleth“</span>'), "„Stätte in X\" nennt X");
	wahr(mk.includes('<span class="gi-ziel__t2">0,80 Meilen · nicht auf der Karte, gelistet in der Infobox des Ortes.</span>'),
		"…mit Entfernung und Folge");
	wahr(mk.includes('<span class="gi-ziel__t1">Nur Quelle + Artikel an „Wandleth“</span>'), "„Nur Quelle + Artikel an X\"");
	wahr(!mk.includes("gi-ziel__option--warn"), "keine Warnung am Bauwerk");
	wahr(mk.includes('data-gi-feld="innerorts"') && mk.includes('data-gi-umkreis="innerorts"'),
		"Siedlung und Umkreis stehen darunter");
	wahr(mk.includes('class="gi-insert__row gi-insert__row--aus">Siedlung'),
		"⚠️ solange „Auf die Karte\" gilt, ist die Siedlung ABGEBLENDET, nicht ausgeblendet");
	gleich(mk.indexOf("— auf die Karte —"), -1, "🔴 „— auf die Karte —\" gibt es im Siedlungsfeld nicht mehr");

	api.garetienDetailWaehlen(b.key, [b]);
	api.garetienEingabenAendern(feldEreignis("zielwahl", "nichts"), [b]);
	gleich(dom.el("#garetien-apply").disabled, true, "„Nichts\": der Fußknopf sperrt sich sofort");
	api.garetienEingabenAendern(feldEreignis("zielwahl", "staette"), [b]);
	gleich(api.garetienZielwahlZu(b), "staette", "der Klick auf das Radio setzt die Wahl");
	gleich(dom.el("#garetien-apply").disabled, false,
		"💣 …und der Fußknopf zählt SOFORT neu -- sonst stünde „0 von 1\" neben „Stätte in X\"");
	mk = api.garetienZielwahlMarkup(b);
	wahr(/gi-ziel__option is-gewaehlt"><input type="radio"[^>]*value="staette"/.test(mk), "…und die Liste zeigt sie");
	wahr(mk.includes('class="gi-insert__row">Siedlung'), "…und die Siedlung ist jetzt bedienbar");

	api.garetienEingabenAendern(feldEreignis("innerorts", "dorf-rallerfurt"), [b]);
	wahr(api.garetienZielwahlMarkup(b).includes("Stätte in „Rallerfurt“"), "die Siedlung wechselt X in der Zielwahl");
	tief(jeItem(b), { "21": { innerorts: true, innerorts_public_id: "dorf-rallerfurt" } },
		"⭐ …und die gewählte Siedlung reist mit");
	gleich(api.garetienStageZeile2(b, true), "Stätte in „Rallerfurt“", "die Ziel-Marke sagt dasselbe");

	const leiste = api.garetienHandlungsMarkup(b);
	wahr(!leiste.includes("einfuegeNeu") && !leiste.includes("einfuegeQuelle"), "🔴 die zwei Häkchen sind weg");
	wahr(leiste.indexOf('class="gi-ziel"') !== -1 && leiste.indexOf('class="gi-ziel"') < leiste.indexOf("gi-acts__knoepfe"),
		"die Zielwahl steht über der Knopfzeile");
	tief(api.garetienHandlungen(b).map((k) => k.name), ["entstagen", "ablehnen"],
		"🔴 kein „Innerorts einfügen\" mehr -- auch nicht mit Befund");
	const nameId = "gi-feld-" + b.key + "-einfuegeName";
	wahr(leiste.includes('gi-insert__row" for="' + nameId + '"'), "bei „Stätte\" ist der Name bedienbar");

	api.avesmapsGaretienStageHinzufuegen([b]);
	const kasten = api.garetienEingefuegtWirdMarkup(b);
	wahr(kasten.includes('class="gi-insert__row gi-insert__row--aus">Form') && kasten.includes("gilt nicht für eine Stätte"),
		"⚠️ Form und Art werden bei „Stätte\" abgeblendet, mit Grund: " + kasten);
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten), "…und gesperrt");
	wahr(/data-gi-feld="isRuined"[^>]* disabled/.test(kasten),
		"⚠️ …und die Darstellung des Ortes ebenso -- eine Stätte steht nicht auf der Karte");
	gleich(kasten.indexOf('data-gi-feld="innerorts"'), -1,
		"💣 die Siedlung steht NICHT noch einmal im Kasten -- zwei Felder trügen dieselbe id");
}
frisch();
{
	const o = natter();
	api.avesmapsGaretienStageHinzufuegen([o]);
	const mk = api.garetienZielwahlMarkup(o);
	wahr(mk.includes('<span class="gi-ziel__t1">Quelle an „Natter“ ergänzen</span>'), "⭐ die Zeile nennt das Ziel: " + mk);
	wahr(mk.includes("An 6 Abschnitte."), "⭐ …und die Zahl");
	wahr(mk.indexOf('value="ergaenzen"') < mk.indexOf('value="karte"'), "die Vorbelegung steht vorne");
	wahr(/gi-ziel__option gi-ziel__option--warn"><input type="radio"[^>]*value="zusaetzlich"/.test(mk),
		"💣 „zusätzlich\" trägt die Warnung");
	wahr(mk.includes("Auf die Karte — zusätzlich zu „Natter“"), "…und nennt, wozu zusätzlich");
	const name = api.garetienZielNameZeile(o);
	wahr(name.includes("gi-insert__row--aus") && name.includes(" disabled"),
		"⚠️ bei einer Ergänzung ist der Name abgeblendet, nicht ausgeblendet: " + name);
	gleich(api.garetienStageZeile2(o, true), "Quelle an „Natter“ (6 Abschnitte)", "Ziel-Marke: Ziel und Zahl");
	api.garetienZielwahlSetzen(o, "zusaetzlich");
	gleich(api.garetienStageZeile2(o, true), "zusätzlich als Weg · Flussweg", "Ziel-Marke bei „zusätzlich\"");
	api.garetienZielwahlSetzen(o, "karte");
	gleich(api.garetienStageZeile2(o, false), "als Weg · Flussweg", "Ziel-Marke bei „Auf die Karte\"");
}
frisch();
{
	const p = perz();
	api.avesmapsGaretienStageHinzufuegen([p]);
	const mk = api.garetienZielwahlMarkup(p);
	gleich((mk.match(/class="gi-ziel__option/g) || []).length, 1, "ohne Vorschlag: eine Option");
	wahr(mk.includes("Nichts — nur ansehen") && /value="nichts" data-gi-feld="zielwahl" checked/.test(mk),
		"🔴 „nur Ansicht\" bleibt gesagt -- als gewählte Option");
	gleich(api.garetienZielNameZeile(p), "", "ohne Vorschlag kein Namensfeld");
	gleich(api.garetienStageZeile2(p, true), "nur Ansicht");
}

// =================================================================================================
// G. (Aufgabe 6) Zusammenlegen geht nur mit „Auf die Karte"
// =================================================================================================
frisch();
{
	const fragment = (key, id) => ({ key: key, stand: "offen", urteil: "neu", name: key, ebene: "ggp:Waelder",
		typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation", verbund_stamm: "Silker Hain",
		verbund_n: 2, geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: [],
		items: [{ id: id, change_type: "new", anlass: "", felder: ["quelle"] }] });
	const m1 = fragment("sh1", 31);
	const m2 = fragment("sh2", 32);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	gleich(api.garetienVerbundZusammenlegbar(m1).ok, true, "Auf die Karte + Fläche: zusammenlegbar");
	api.garetienZielwahlSetzen(m1, "nichts");
	const z = api.garetienVerbundZusammenlegbar(m1);
	gleich(z.ok, false, "💣 mit „Nichts\" ist ein Verbund nicht zusammenlegbar");
	wahr(z.grund.includes("Nichts — nur ansehen") && !z.grund.includes(" bei „"),
		"…und der Grund nennt die Wahl: " + z.grund);
	api.garetienZielwahlSetzen(m1, "karte");
	api.garetienZielwahlSetzen(m2, "nichts");
	const z2 = api.garetienVerbundZusammenlegbar(m1);
	gleich(z2.ok, false,
		"💣 auch ein ANDERES Mitglied mit „Nichts\" sperrt -- nach dem Zusammenlegen fiele seine Wahl still auf „Auf die Karte\"");
	wahr(z2.grund.includes("Nichts — nur ansehen") && z2.grund.includes("bei „sh2“"),
		"…und der Grund nennt das Fragment, an dem es hängt: " + z2.grund);
}

// =================================================================================================
// G2. Ruling R-a: eine Zielwahl ungleich „karte" löst einen ZUSAMMENGELEGTEN Verbund AKTIV auf --
// dieselbe Stelle/Funktion wie das Umstellen von Ziel/Form (garetienVerbundAufloesen), kein
// zweiter Weg. Die Schreibstelle ist garetienZielwahlSetzen selbst.
// =================================================================================================
frisch();
{
	const fragment = (key, id) => ({ key: key, stand: "offen", urteil: "neu", name: key, ebene: "ggp:Waelder",
		typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation", verbund_stamm: "Silker Hain",
		verbund_n: 2, geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: [],
		items: [{ id: id, change_type: "new", anlass: "", felder: ["quelle"] }] });
	const m1 = fragment("sh1", 31);
	const m2 = fragment("sh2", 32);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const schluessel = api.garetienVerbundSchluessel(m1);
	api.garetienVerbundZusammenlegen(schluessel, [m1, m2]);
	wahr(api.garetienVerbundIstZusammen(schluessel), "Testaufbau: zusammengelegt");
	tief(api.garetienEingabenFuerServer(m1).verbund, "Silker Hain", "Testaufbau: der Rumpf trägt den Stamm");

	api.garetienZielwahlSetzen(m1, "nichts");
	gleich(api.garetienVerbundIstZusammen(schluessel), false,
		"🔴 „Nichts\" an einem Mitglied löst den zusammengelegten Verbund AUF -- kein zweiter Weg");
	wahr(!("verbund" in (api.garetienEingabenFuerServer(m1) || {})),
		"…und der Rumpf trägt danach KEIN `verbund` mehr: " + JSON.stringify(api.garetienEingabenFuerServer(m1)));
	wahr(!("verbund" in (api.garetienEingabenFuerServer(m2) || {})),
		"…am zweiten Mitglied ebenso");
}

// =================================================================================================
// H. (Aufgabe 6) Die Wahl stirbt mit „Stage leeren" -- nicht mit dem Herunternehmen
// =================================================================================================
frisch();
{
	const b = burg();
	api.avesmapsGaretienStageHinzufuegen([b]);
	api.garetienZielwahlSetzen(b, "staette");
	api.avesmapsGaretienStageEntfernen([b.key]);
	gleich(api.garetienZielwahlZu(b), "staette", "⚠️ die Wahl überlebt das Herunternehmen");
	api.avesmapsGaretienStageHinzufuegen([b]);
	api.avesmapsGaretienStageLeeren();
	gleich(api.garetienZielwahlZu(b), "karte", "🔴 …aber nicht „Stage leeren\" (Entwurf §6.4)");
}

// =================================================================================================
// I. BESTAND -- übernommen und abgelehnt bleiben, wie sie sind
// =================================================================================================
frisch();
{
	// Ein übernommenes Einzelobjekt mit altem, nacktem Vermerk -- ohne verbund-Felder.
	const uebernommen = { key: "ggp:Waelder:Wald:Garetien:Alter Forst!Alter Forst", stand: "uebernommen",
		urteil: "neu", name: "Alter Forst", typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [1, 0], [1, 1]], abschnitte: [], innerorts_uebernommen: false,
		items: [{ id: 41, change_type: "new", anlass: "", felder: ["quelle"], selected: 1, apply_state: "done",
			apply_note: "Wald-1234" }] };
	api.avesmapsGaretienStageHinzufuegen([uebernommen]);
	gleich(api.garetienZielwahlMarkup(uebernommen), "", "🔴 ein übernommenes Objekt bekommt keine Zielwahl");
	gleich(api.garetienZielNameZeile(uebernommen), "", "…und kein Namensfeld");
	gleich(api.garetienHandlungen(uebernommen)[0].name, "ruecknahme", "…und behält seine Rücknahme");
	wahr(api.garetienEingefuegtWirdUebernommenHinweis(uebernommen).includes("Liegt bereits auf der Karte"),
		"…und seinen Satz");
	const kasten = api.garetienEingefuegtWirdMarkup(uebernommen);
	gleich(kasten.indexOf("gi-insert__row--aus"), -1, "⚠️ der Kasten bleibt gesperrt OHNE Abblend-Zeile");
	wahr(/data-gi-feld="zielForm"[^>]* disabled/.test(kasten), "…aber gesperrt wie vorher");

	// Eine abgelehnte Zeile -- auch wenn sie noch auf der Stage läge.
	const abgelehnt = { key: "ggp:Waelder:Wald:Garetien:Abgewiesen!Abgewiesen", stand: "abgelehnt",
		urteil: "neu", name: "Abgewiesen", ziel: "region", subtyp: "wald", geometrie: [[0, 0], [1, 0], [1, 1]],
		abschnitte: [], items: [{ id: 51, change_type: "new", anlass: "", felder: ["quelle"] }] };
	api.avesmapsGaretienStageHinzufuegen([abgelehnt]);
	tief(api.garetienHandlungen(abgelehnt).map((k) => k.name), ["wieder"], "🔴 abgelehnt: genau „Wieder vorschlagen\"");
	gleich(api.garetienZielwahlMarkup(abgelehnt), "", "…und keine Zielwahl");
}

// =================================================================================================
// E. Die Rückfrage vor „zusätzlich" -- und der Rumpf, der beim Server ankommt (asynchron)
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
			daten = { ok: true, done: true, applied: 1, deleted: 0, stale: 0, processed: 1, remaining: 0,
				skipped: 0, declined: 0, fehler: [] };
		}
		return Promise.resolve({ json: () => Promise.resolve(daten) });
	};
	try {
		frisch();
		const o = natter();
		api.avesmapsGaretienStageHinzufuegen([o]);
		api.garetienZielwahlSetzen(o, "zusaetzlich");
		const text = api.garetienZusaetzlichRueckfrageText([o]);
		wahr(text.startsWith("Zusätzlich anlegen?"), "die Rückfrage fragt: " + text);
		wahr(text.includes("Neues Objekt „Natter“ anlegen UND die Garetien-Quelle an „Natter“ (6 Abschnitte) hängen."),
			"💣 …und nennt beides beim Namen, mit Zahl: " + text);
		tief(api.garetienZusaetzlichObjekte([o, burg(), perz()]).map((x) => x.name), ["Natter"],
			"nur die „zusätzlich\"-Objekte");

		const gefragt = [];
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return false; });
		tief(gefragt, [text], "🔴 vor dem Import wird GENAU diese Frage gestellt");
		gleich(angefragt.length, 0, "💣 ein „Abbrechen\" schickt NICHTS");
		await api.garetienFussknopfEinfuegenKlick(4711);
		gleich(angefragt.length, 0, "💣 ohne Rückfragemöglichkeit wird „zusätzlich\" nicht importiert");

		gefragt.length = 0;
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return true; });
		gleich(gefragt.length, 2, "mit „OK\": erst „zusätzlich\", dann die allgemeine Rückfrage");
		gleich(gefragt[0], text, "…in dieser Reihenfolge");
		const apply = angefragt.filter((a) => a.action === "apply")[0];
		wahr(apply && apply.einstellungen_je_item, "der apply-Rumpf trägt einstellungen_je_item: " + JSON.stringify(apply));
		gleich(apply.einstellungen_je_item["17"].beides, true, "🔴 das Zusatz-Item bestätigt `beides` beim Server");
		tief(apply.einstellungen_je_item["11"], { beides: true }, "🔴 …und das Ergänzungs-Item ebenso");
		tief(apply.ids.slice().sort((a, b) => a - b), [11, 12, 13, 14, 15, 16, 17], "…mit allen sieben Items");

		// Ohne „zusätzlich" gibt es keine zweite Frage -- und die Stätte kommt an.
		frisch();
		angefragt.length = 0;
		const b = burg();
		api.avesmapsGaretienStageHinzufuegen([b]);
		api.garetienZielwahlSetzen(b, "staette");
		gefragt.length = 0;
		await api.garetienFussknopfEinfuegenKlick(4711, (t) => { gefragt.push(t); return true; });
		gleich(gefragt.length, 1, "ohne „zusätzlich\" nur die allgemeine Rückfrage");
		const applyB = angefragt.filter((a) => a.action === "apply")[0];
		tief(applyB.ids, [21], "💣 „Stätte in X\" ERREICHT den Server");
		tief(applyB.einstellungen_je_item, { "21": { innerorts: true, innerorts_public_id: "stadt-wandleth" } },
			"…mit genau diesem Rumpf");
	} finally {
		global.fetch = echtesFetch;
		frisch();
	}
}

pruefeImport().then(() => {
	console.log("OK -- garetien-zielwahl-ziele: " + n + " Zusicherungen");
}).catch((fehler) => {
	console.error(fehler);
	process.exitCode = 1;
});
