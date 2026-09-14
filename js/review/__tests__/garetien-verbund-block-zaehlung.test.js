// Aufgabe 7 (Garetien-Importer vereint, 14.09.2026): „Auf die Stage“ nimmt die Fragmente mit, der
// Verbund-Knopf steht nur in Block B, und Fussknopf und Rueckfrage zaehlen, was ENTSTEHT.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 8, §4, §6.3, §6.5
// Mockup:  docs/garetien-import-vereint-mockup.html Szenen 2, 3, 4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-block-zaehlung.test.js
//
// 🔴 Gemessen am ECHTEN Modul und seinem Markup -- `zustand.objekte` entsteht ueber die echte Tuer
// (avesmapsGaretienListeHolen mit gefaelschtem `fetch`), wie in garetien-verbund-klick.test.js.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter(["garetien-apply", "garetien-apply-hint"]);

function fragment(nr, extra) {
	return Object.assign({
		key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, ebene: "Waelder", typ: "Wald",
		urteil: "neu", stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation",
		verbund_stamm: "Silker Hain", verbund_n: 4,
		geometrie: Array.from({ length: 5 + nr }, (_, i) => [i, i]),
		items: [{ id: 100 + nr, change_type: "new" }],
	}, extra || {});
}
// BESTAND: ein Objekt aus einem Lauf von vor der Verbund-Erkennung -- ohne verbund_stamm/verbund_n.
const heide = { key: "ggp:silkerheide", name: "Silker Heide", ebene: "Waelder", typ: "Heide", urteil: "neu",
	stand: "offen", ziel: "region", subtyp: "heide", items: [{ id: 200, change_type: "new" }] };

async function mitObjekten(objekte) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7, reiter: {} }) });
	};
	api.garetienReiterSetzen("offen");
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
}
function stageKlick(objekt, objekte) {
	const knopf = { disabled: false, getAttribute: (n) => ({ "data-handlung": "stage", "data-key": objekt.key })[n] || null };
	return api.garetienStageKlick({ target: { closest: () => knopf } }, objekte, function () { return true; });
}
function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
	api.__test.garetienVerbundWegeFreiSetzen(false);
}

["garetienStageZusammenfassung", "garetienVerbundBlockMarkup"].forEach((n) =>
	wahr(typeof api[n] === "function", n + " fehlt im Export"));

(async function () {
	// =============================================================================================
	// A. „Auf die Stage“ an einem Fragment: EIN Knopf, die Unterzeile sagt, wie viele mitkommen.
	// =============================================================================================
	const [f1, f2, f3, f4] = [fragment(1), fragment(2, { urteil: "widerspruch" }), fragment(3, { urteil: "zweifel" }), fragment(4)];
	// 💣 Ein deckt_sich-Fragment gleichen Stammes ist KEIN Mitglied (Owner 09.09./2) -- der Server
	// schickt es seit Aufgabe 1 nicht mehr als Mitglied; der Client prueft es trotzdem.
	const deckt = fragment(5, { urteil: "deckt_sich" });
	const alle = [f1, f2, f3, f4, deckt, heide];
	// ⚠️ Block B zeigt, was der SERVER als Mitglied schickt -- seit Aufgabe 1 nie ein deckt_sich-Fragment.
	const ohneDeckt = [f1, f2, f3, f4, heide];
	zuruecksetzen();
	await mitObjekten(alle);

	gleich(api.garetienStageKnopfBauen(f1).zeile2, "mit 3 weiteren Fragmenten",
		"vier erzeugende Fragmente: das angeklickte und drei weitere -- das deckt_sich-Fragment zaehlt nicht");
	gleich(api.garetienStageKnopfBauen(heide).zeile2, "", "BESTAND: ein Objekt ohne Verbund-Felder hat keine Unterzeile");
	wahr(api.garetienHandlungen(f1).every((k) => k.name !== "verbund"),
		"🔴 der Knopf „verbund“ steht nicht mehr in der Handlungsleiste: " + api.garetienHandlungen(f1).map((k) => k.name).join(","));

	const ergebnis = stageKlick(f1, alle);
	gleich(ergebnis.handlung, "stage", "der Klick legt auf");
	gleich(ergebnis.weitere, 3, "und meldet die drei mitgenommenen Fragmente");
	gleich([f1, f2, f3, f4].every((f) => api.avesmapsGaretienStageHat(f.key)), true, "alle vier liegen auf der Stage");
	gleich(api.avesmapsGaretienStageHat(deckt.key), false, "💣 das deckt_sich-Fragment wird nicht mit aufgelegt");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(f1)), false,
		"🔴 zusammengelegt wird dabei NICHTS (Owner 09.09./1, 12.09./5)");
	gleich(api.garetienStageKnopfBauen(f2).zeile2, "", "auf der Stage traegt der Knopf („Von der Stage nehmen“) keine Unterzeile");

	// Schon aufgelegte Mitglieder zaehlen nicht als „weitere“ -- die Unterzeile sagt, was DAZUKOMMT.
	api.avesmapsGaretienStageEntfernen([f1.key, f2.key]);
	gleich(api.garetienStageKnopfBauen(f1).zeile2, "mit 1 weiteren Fragment",
		"f3 und f4 liegen schon da, nur f2 kaeme dazu -- und die Einzahl stimmt");

	// =============================================================================================
	// B. Block B: der Knopf erscheint erst mit ZWEI Fragmenten auf der Stage.
	// =============================================================================================
	zuruecksetzen();
	gleich(api.garetienVerbundBlockMarkup(f1, ohneDeckt).indexOf('data-handlung="verbund"'), -1,
		"auf „Offen“ ohne Fragment auf der Stage: kein Knopf");
	gleich(api.garetienVerbundBlockMarkup(f1, ohneDeckt).indexOf("gi-seg__weg"), -1,
		"und kein ✕ -- es gibt nichts von der Stage zu nehmen (Block B ist dort nur Anzeige)");
	gleich(api.garetienVerbundBlockMarkup(heide, ohneDeckt), "", "BESTAND: ohne Verbund-Felder kein Block");

	api.avesmapsGaretienStageHinzufuegen([f1]);
	const einer = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	gleich(einer.indexOf('data-handlung="verbund"'), -1, "ein Fragment auf der Stage: noch kein Knopf");
	gleich((einer.match(/data-verbund-weg="/g) || []).length, 1, "aber sein ✕");

	api.avesmapsGaretienStageHinzufuegen([f2]);
	const zwei = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	wahr(/<button class="btn btn--accent" type="button" data-handlung="verbund" data-key="ggp:silkerhain:1">Zusammenlegen \(2\)<\/button>/.test(zwei),
		"zwei Fragmente auf der Stage: „Zusammenlegen (2)“, Akzentrahmen, bedienbar: " + zwei);
	wahr(api.garetienDetailMarkup(f1, null, false).indexOf('data-handlung="verbund"') !== -1,
		"und der Knopf steht in der echten Detailspalte");

	// Zusicherung des Koordinators (§3): Block B zaehlt seine Mitglieder AUF DER STAGE ueber die
	// STAGE selbst (garetienVerbundPool), nie ueber die hereingereichte -- auf dem Reiter „Stage"
	// seit Aufgabe 5 gefilterte -- `objekte`-Liste. f2 liegt auf der Stage, aber ein aktiver
	// Such-/Filter-Treffer blendet ihn hier aus `objekte` aus -- die Zahl bleibt trotzdem „(2)".
	const gefiltertOhneF2 = [f1];
	const zweiGefiltert = api.garetienVerbundBlockMarkup(f1, gefiltertOhneF2);
	wahr(/Zusammenlegen \(2\)/.test(zweiGefiltert),
		"ein Stage-Filter, der ein Fragment ausblendet, aendert die Zahl in „Zusammenlegen (n)“ nicht: "
		+ zweiGefiltert);

	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(f1), []);
	const zusammen = api.garetienVerbundBlockMarkup(f1, ohneDeckt);
	wahr(zusammen.indexOf(">Verbund auflösen (2)</button>") !== -1, "zusammengelegt: „Verbund auflösen (2)“");
	wahr(zusammen.indexOf("zusammengelegt · 4 Fragmente") !== -1, "und die Notiz sagt es");

	// Gesperrt MIT Grundzeile: ein Weg, solange Wege-Verbuende nicht freigegeben sind.
	zuruecksetzen();
	const [w1, w2] = [1, 2].map((nr) => fragment(nr, { key: "ggp:weg:" + nr, ebene: "Wege", typ: "Pfad", ziel: "path", subtyp: "Pfad" }));
	api.avesmapsGaretienStageHinzufuegen([w1, w2]);
	const weg = api.garetienVerbundBlockMarkup(w1, [w1, w2]);
	wahr(/data-handlung="verbund"[^>]*disabled/.test(weg), "ein Weg: der Knopf ist gesperrt");
	wahr(weg.indexOf('<p class="gi-acts__grund"><span>Wege-Verbünde sind noch nicht freigegeben.</span></p>') !== -1,
		"und der Grund steht SICHTBAR darunter, nicht nur im title: " + weg);

	// =============================================================================================
	// C. Die Zaehlung: ein zusammengelegter Verbund ist EIN Objekt.
	// =============================================================================================
	zuruecksetzen();
	const ohneVorschlag = { key: "ggp:leer", name: "Leer", items: [] };
	gleich(JSON.stringify(api.garetienStageZusammenfassung([f1, f2, f3, f4, heide])),
		JSON.stringify({ objekte: 5, zeilen: 5, verbuende: [] }),
		"nicht zusammengelegt: fuenf Objekte -- ehrlich, wer jetzt importiert, bekommt vier Waelder");
	api.avesmapsGaretienStageHinzufuegen([f1, f2, f3, f4, heide, ohneVorschlag]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(f1), []);
	gleich(JSON.stringify(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe())),
		JSON.stringify({ objekte: 2, zeilen: 5, verbuende: [{ name: "Silker Hain", teile: 4 }] }),
		"zusammengelegt: 2 Objekte aus 5 Zeilen -- das Objekt ohne Vorschlag zaehlt nirgends");
	api.garetienNameWahlSetzen(f1, "Silker Forst");
	gleich(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe()).verbuende[0].name, "Silker Forst",
		"der Verbund heisst, wie er importiert wird -- mit Handnamen");

	const knopf = api.garetienUebernahmeKnopfZustand(api.avesmapsGaretienStageListe());
	gleich(knopf.beschriftung, "Stage importieren · 2 Objekte aus 5 Zeilen", "der Fussknopf zaehlt, was entsteht");
	gleich(knopf.anzahl, 5, "`anzahl` bleibt die Zahl der importierten Zeilen");
	gleich(api.garetienUebernahmeKnopfZustand([f1, f2, f3, f4]).beschriftung, "Stage importieren · 1 Objekt aus 4 Zeilen",
		"ein Verbund allein: 1 Objekt aus 4 Zeilen");
	gleich(api.garetienUebernahmeKnopfZustand([heide]).beschriftung, "Stage importieren · 1 Objekt", "ohne Verbund keine Zeilenangabe");
	gleich(api.garetienUebernahmeKnopfZustand([]).beschriftung, "Stage importieren · nichts auf der Stage", "leer");
	gleich(api.garetienUebernahmeKnopfZustand([ohneVorschlag]).beschriftung, "Stage importieren · nichts zu importieren",
		"auf der Stage, aber nichts, was entstuende");

	// =============================================================================================
	// D. Die Rueckfrage nennt den Verbund beim Namen -- und die Warnung bleibt.
	// =============================================================================================
	const text = api.garetienEinfuegenRueckfrageText(api.garetienStageZusammenfassung(api.avesmapsGaretienStageListe()));
	wahr(text.indexOf("Wirklich 2 Objekte aus 5 Zeilen von der Stage in die Karte einfügen?") === 0, "der Hauptsatz zaehlt Objekte: " + text);
	wahr(text.indexOf("Zusammengelegt: „Silker Forst“ mit 4 Teilen.") !== -1, "und nennt den Verbund beim Namen: " + text);
	wahr(text.indexOf("Für Änderungen an bestehenden Objekten (Name, Quelle, Geometrie) gibt es keinen Rückweg.") !== -1,
		"🔴 die Warnung vor der unumkehrbaren Handlung bleibt (Schadensfall 30.08.2026)");
	gleich(api.garetienEinfuegenRueckfrageText({ objekte: 1, zeilen: 1, verbuende: [] }).indexOf("Zusammengelegt"), -1,
		"ohne Verbund kein Verbund-Satz");

	// Der Fussknopf fragt mit GENAU dieser Zusammenfassung.
	let gefragt = "";
	await api.garetienFussknopfEinfuegenKlick(7, function (satz) { gefragt = satz; return false; });
	gleich(gefragt, text, "der Fussknopf reicht die Zusammenfassung der Stage an die Rueckfrage");

	zuruecksetzen();
	console.log(`garetien-verbund-block-zaehlung: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
