// Aufgabe 6 (Garetien-Importer vereint, 14.09.2026): der Verbund lebt am STAGE-EINTRAG.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §1 Widerspruch 2,
//          Fehler 6 und 10, §6.3, §6.4
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-verbund-stage-eintrag.test.js
//
// 💣 DER BEFUND (K1): die Entscheidung „zusammengelegt" lag in einem losen `Set` von Verbundschluesseln.
// Sie ueberlebte „Stage leeren" und neue Laeufe und verschmolz spaeter EINZELN aufgelegte Fragmente
// still -- und „Verbund auflösen" liess die Einstellungen des Verbunds liegen (Fehler 10).
// 🔴 Gemessen wird ueber das ECHTE Modul, nie am Quelltext.

"use strict";

const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum || ""); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }

const { api } = ladeImporter();

function fragment(nr, punkte, extra) {
	return Object.assign({
		key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, ebene: "Waelder", typ: "Wald",
		urteil: "neu", stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation",
		verbund_stamm: "Silker Hain", verbund_n: 4,
		geometrie: Array.from({ length: punkte }, (_, i) => [i, i]),
		items: [{ id: 100 + nr, change_type: "new" }],
	}, extra || {});
}
function zuruecksetzen() {
	api.avesmapsGaretienStageLeeren();
	api.__test.garetienVerbundWegeFreiSetzen(api.__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI);
}
// Dieselbe winzige DOM-Attrappe wie in garetien-verbund-klick.test.js.
function ziel(attribute) {
	const knoten = {
		disabled: false,
		getAttribute(name) { return Object.prototype.hasOwnProperty.call(attribute, name) ? attribute[name] : null; },
	};
	knoten.closest = (auswahl) => ((auswahl === '[data-handlung="verbund"]' && attribute["data-handlung"] === "verbund")
		|| (auswahl === "[data-verbund-weg]" && "data-verbund-weg" in attribute) ? knoten : null);
	return knoten;
}

["garetienVerbundGroesstes", "garetienVerbundZusammenlegbar"].forEach((n) =>
	wahr(typeof api[n] === "function", n + " fehlt im Export"));
gleich(api.__test.AVESMAPS_GARETIEN_VERBUND_WEGE_FREI, false,
	"🔴 Wege-Verbuende sind ab Werk NICHT freigegeben -- die Freigabe nach dem Owner-Blick ist genau diese Zeile");

// =================================================================================================
// A. Zusammenlegen legt NICHT auf -- es markiert die Eintraege, die schon auf der Stage liegen.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgelegt ist nicht zusammengelegt");
	gleich(api.garetienVerbundZusammenlegen(s, [m1, m2, m3]), 2,
		"Rueckgabe = Zahl der Mitglieder AUF DER STAGE -- m3 liegt nicht dort");
	gleich(api.avesmapsGaretienStageHat(m3.key), false, "💣 Zusammenlegen legt nichts auf");
	gleich(api.garetienVerbundIstZusammen(s), true, "zwei markierte Eintraege sind ein zusammengelegter Verbund");

	// Ein NEU aufgelegtes Mitglied traegt `zusammen = false` -- der Verbund ist damit nicht mehr ganz zusammen.
	api.avesmapsGaretienStageHinzufuegen([m3]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"ein spaeter aufgelegtes Fragment ist nicht still verschmolzen: nicht JEDER Eintrag traegt `zusammen`");
	gleich(api.garetienVerbundZusammenlegen(s, []), 3, "erneutes Zusammenlegen nimmt es mit");
	gleich(api.garetienVerbundIstZusammen(s), true, "jetzt wieder zusammen");
}

// Weniger als zwei auf der Stage: nichts zu legen.
zuruecksetzen();
{
	const m1 = fragment(1, 11);
	api.avesmapsGaretienStageHinzufuegen([m1]);
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), [m1, fragment(2, 6)]), 0,
		"ein einzelnes Fragment auf der Stage legt nichts zusammen");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(m1)), false, "und gilt nicht als zusammen");
	gleich(api.garetienVerbundZusammenlegen("", [m1]), 0, "ein leerer Schluessel legt nichts zusammen");
}

// =================================================================================================
// B. 💣 K1: „Stage leeren" nimmt die Entscheidung MIT -- einzeln wieder aufgelegt ist nicht zusammen.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(s, [m1, m2]);
	api.avesmapsGaretienStageLeeren();
	api.avesmapsGaretienStageHinzufuegen([m1]);
	api.avesmapsGaretienStageHinzufuegen([m2]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"💣 nach „Stage leeren\" einzeln aufgelegte Fragmente sind NICHT zusammengelegt");
	gleich(api.garetienEingabenFuerServer(m1) && api.garetienEingabenFuerServer(m1).verbund, undefined,
		"und der Rumpf traegt deshalb auch keinen `verbund` -- der Server legt keine gemeinsame Region an");
}

// =================================================================================================
// C. Herunternehmen: der Rest bleibt zusammen -- unter zwei ist der Verbund aufgeloest.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2, m3]);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
	api.avesmapsGaretienStageEntfernen([m2.key]);
	gleich(api.garetienVerbundIstZusammen(s), true, "zwei verbliebene Mitglieder bleiben zusammen");
	gleich(api.garetienNameWahlZu(m1), "Silker Forst", "und behalten die Einstellungen des Verbunds");
	api.avesmapsGaretienStageEntfernen([m3.key]);
	gleich(api.garetienVerbundIstZusammen(s), false, "unter zwei ist der Verbund aufgeloest");
	api.avesmapsGaretienStageHinzufuegen([m2, m3]);
	gleich(api.garetienVerbundIstZusammen(s), false, "wieder aufgelegte Fragmente sind nicht zusammengelegt");
	api.garetienVerbundZusammenlegen(s, []);
	gleich(api.garetienNameWahlZu(m1), "",
		"💣 der Fall unter zwei loest in der TUER auf -- samt Einstellungen, nicht nur am ✕-Knopf");
}

// =================================================================================================
// D. Fehler 10: „Verbund auflösen" nimmt die Einstellungen des Verbunds mit.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(s, []);
	api.garetienNameWahlSetzen(m1, "Silker Forst");
	gleich(api.garetienNameWahlZu(m2), "Silker Forst", "Vorbedingung: die Wahl gehoert dem Verbund");
	gleich(api.garetienVerbundAufloesen(s), undefined, "garetienVerbundAufloesen gibt nichts zurueck (void)");
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgeloest");
	gleich(api.avesmapsGaretienStageHat(m1.key) && api.avesmapsGaretienStageHat(m2.key), true,
		"die Fragmente bleiben auf der Stage");
	api.garetienVerbundZusammenlegen(s, []);
	gleich(api.garetienNameWahlZu(m1), "",
		"💣 wer danach wieder zusammenlegt, findet den alten Namen NICHT mehr vor");
}

// =================================================================================================
// E. Fehler 6: die Vorbelegung kommt aus dem GROESSTEN Fragment, nie aus dem zuerst beruehrten.
// =================================================================================================
zuruecksetzen();
{
	const klein = fragment(1, 3, { ebene: "Berge", typ: "Huegel", ziel: "label", subtyp: "berggipfel", kind: "" });
	const gross = fragment(2, 20, { ebene: "Berge", typ: "Huegel", ziel: "region", subtyp: "huegel", kind: "topographie" });
	const gleichGross = fragment(0, 20, { ebene: "Berge", typ: "Huegel", ziel: "region", subtyp: "huegel", kind: "topographie" });
	const s = api.garetienVerbundSchluessel(klein);

	gleich(api.garetienVerbundGroesstes(s, [klein, gross]).key, gross.key, "das Mitglied mit den meisten Punkten");
	gleich(api.garetienVerbundGroesstes(s, [klein, gross, gleichGross]).key, gleichGross.key,
		"Gleichstand: der kleinste Schluessel");
	gleich(api.garetienVerbundGroesstes(s, []), null, "ohne Mitglieder: null");

	gleich(api.garetienZielWahlZu(klein).ziel, "label", "Vorbedingung: das kleine Fragment allein waere ein Gipfel");
	api.avesmapsGaretienStageHinzufuegen([klein, gross]);
	gleich(api.garetienVerbundZusammenlegen(s, []), 2, "zusammengelegt");
	gleich(api.garetienZielWahlZu(klein).ziel, "region",
		"💣 der zusammengelegte Verbund wird eine Flaeche -- vorbelegt aus dem GROESSTEN, obwohl das kleine zuerst beruehrt wurde");
	gleich(api.garetienZielWahlZu(klein).subtyp, "huegel", "samt Art");
}

// =================================================================================================
// F. Zusammenlegbar: nur „auf die Karte" als Flaeche oder Weg -- und Wege erst nach der Freigabe.
// =================================================================================================
zuruecksetzen();
{
	const [f1, f2] = [fragment(1, 11), fragment(2, 6)];
	gleich(JSON.stringify(api.garetienVerbundZusammenlegbar(f1)), JSON.stringify({ ok: true, grund: "" }),
		"eine Flaeche ist zusammenlegbar");

	// ⚠️ EIGENE SCHLUESSEL: die Zielwahl wird je Schluessel zwischengespeichert, und ein Weg unter dem
	// Schluessel der Flaeche darueber laese deren Wahl.
	const weg = (nr) => fragment(nr, 8, { key: "ggp:weg:" + nr, ebene: "Wege", typ: "Pfad", ziel: "path", subtyp: "Pfad", kind: "" });
	const [w1, w2] = [weg(1), weg(2)];
	const gesperrt = api.garetienVerbundZusammenlegbar(w1);
	gleich(gesperrt.ok, false, "🔴 ein Weg ist gesperrt, solange die Konstante `false` ist");
	gleich(gesperrt.grund, "Wege-Verbünde sind noch nicht freigegeben.", "und sagt warum");
	api.avesmapsGaretienStageHinzufuegen([w1, w2]);
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(w1), []), 0,
		"💣 der Riegel steht im Zusammenlegen selbst -- `disabled` ist nur die Anzeige");
	api.__test.garetienVerbundWegeFreiSetzen(true);
	gleich(api.garetienVerbundZusammenlegbar(w1).ok, true, "mit freigegebenen Wegen ist der Weg zusammenlegbar");
	gleich(api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(w1), []), 2, "und wird zusammengelegt");
	zuruecksetzen();

	const gipfel = (nr) => fragment(nr, 3, { key: "ggp:gipfel:" + nr, ebene: "Berge", typ: "Berg", ziel: "label", subtyp: "berggipfel", kind: "" });
	const g = api.garetienVerbundZusammenlegbar(gipfel(1));
	gleich(g.ok, false, "ein Verbund, der als Punkt ankaeme, ist keiner");
	wahr(g.grund.indexOf("Fläche oder ein Weg") !== -1 && g.grund.indexOf("berggipfel") !== -1,
		"der Grund nennt Regel und gewaehlte Form: " + g.grund);
	gleich(api.garetienVerbundZusammenlegbar({ key: "x", name: "Weidicht" }).ok, false, "ohne Verbund: nicht zusammenlegbar");
	void f2;
}

// =================================================================================================
// G. Die zwei Klick-Verteiler.
// =================================================================================================
zuruecksetzen();
{
	const [m1, m2, m3] = [fragment(1, 11), fragment(2, 6), fragment(3, 14)];
	const s = api.garetienVerbundSchluessel(m1);
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const e1 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e1.handlung, "verbund_zusammengelegt", "erster Klick legt zusammen");
	gleich(e1.anzahl, 2, "mit den zwei Mitgliedern auf der Stage");
	gleich(api.avesmapsGaretienStageHat(m3.key), false, "und legt m3 NICHT auf");
	const e2 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e2.handlung, "verbund_aufgeloest", "zweiter Klick loest auf");
	gleich(api.garetienVerbundIstZusammen(s), false, "aufgeloest");

	api.avesmapsGaretienStageEntfernen([m2.key]);
	const e3 = api.garetienVerbundKlick({ target: ziel({ "data-handlung": "verbund", "data-key": m1.key }) }, [m1, m2, m3]);
	gleich(e3.handlung, "verbund_gesperrt", "mit nur einem Fragment auf der Stage ist nichts zusammenzulegen");
	wahr(e3.grund !== "", "und der Verteiler nennt den Grund: " + e3.grund);

	api.avesmapsGaretienStageHinzufuegen([m2]);
	api.garetienVerbundZusammenlegen(s, []);
	const weg = api.garetienVerbundWegKlick({ target: ziel({ "data-verbund-weg": m2.key }) }, [m1, m2, m3]);
	gleich(weg.aufgeloest, true, "der ✕ des vorletzten Fragments loest den Verbund auf");
	gleich(api.garetienVerbundIstZusammen(s), false, "und die Entscheidung ist fort");
}

// =================================================================================================
// I. Name = Stamm, Beschriftungs-Vorschau und Kurvenbeschreibung -- bei einem ZUSAMMENGELEGTEN Verbund
// (Entwurf §6.3, §6.6, §10). Gemessen am FELD (das Markup, das der Editor sieht), am RUMPF (was der
// Server bekommt) UND an der VORSCHAU (was die Karte zeigt) -- alle drei muessen dasselbe sagen.
// Getippt wird ueber den ECHTEN Zuhoerer garetienEingabenAendern.
// ⚠️ Als async-Funktion, weil die Vorschau dem getippten Namen ENTPRELLT folgt; gerufen am Anfang
// des async-Laufs von Abschnitt H.
// =================================================================================================
function feldWert(markup, feld) {
	const eingabe = (markup.match(new RegExp('<input[^>]*data-gi-feld="' + feld + '"[^>]*>')) || [""])[0];
	if (eingabe === "") { return null; }
	if (/type="checkbox"/.test(eingabe)) { return / checked/.test(eingabe); }
	return (eingabe.match(/value="([^"]*)"/) || [null, ""])[1];
}
function eingabeEreignis(feld, werte) {
	return { target: Object.assign({
		getAttribute: (n) => (n === "data-gi-feld" ? feld : null),
		hasAttribute: (n) => n === "data-gi-feld",
	}, werte) };
}
const namensfeld = (o) => feldWert(api.garetienEinfuegeHakenMarkup(o), "einfuegeName");
// Die Vorschau: die REINE Regel wird geladen wie in index.html (vor dem Zeichnen), der Stempel laeuft im Fenster.
const vorschauRegel = require("../review-garetien-label-vorschau.js");
const VORSCHAU = api.AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL;
function vorschau(menge) {
	return (menge || []).filter((o) => o && o[VORSCHAU])
		.map((o) => o.key + "=" + o[VORSCHAU].text + "@" + o[VORSCHAU].punkt[0]).join(" | ");
}

async function abschnittI() {
	global.garetienVorschauLabelAus = vorschauRegel.garetienVorschauLabelAus;
	global.AVESMAPS_GARETIEN_VORSCHAU_ARTEN = vorschauRegel.AVESMAPS_GARETIEN_VORSCHAU_ARTEN;
	let gezeichnet = null;
	global.window.avesmapsGaretienKarteZeigen = function (menge) { gezeichnet = menge; };

	zuruecksetzen();
	{
		// m1: 11 Punkte, Mittelpunkt x=5, Item 101 -- der Anfuehrer. m2: 6 Punkte, x=2.5, Item 102.
		const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
		const alle = [m1, m2];
		const s = api.garetienVerbundSchluessel(m1);
		api.avesmapsGaretienStageHinzufuegen(alle);
		gleich(namensfeld(m1), "Silker Hain 1", "Gegenprobe: nicht zusammengelegt traegt jedes Fragment seinen Namen");
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain 1@5 | ggp:silkerhain:2=Silker Hain 2@2.5",
			"Gegenprobe: nicht zusammengelegt zwei Beschriftungen -- es entstehen zwei Objekte");

		// Lage 1: zusammengelegt, nichts getippt.
		api.garetienVerbundZusammenlegen(s, []);
		gleich(namensfeld(m1), "Silker Hain", "💣 zusammengelegt zeigt das Namensfeld den STAMM");
		gleich(namensfeld(m2), "Silker Hain", "an jedem Fragment");
		const rumpf1 = api.garetienEingabenFuerServer(m1);
		gleich("name" in rumpf1, false,
			"💣 die Vorgabe reist NICHT als Handname -- sonst naehme der Server sie und nie den Stamm: " + JSON.stringify(rumpf1));
		gleich(rumpf1.verbund, "Silker Hain", "der Rumpf traegt den Verbund, der Server setzt den Stamm");
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain@5",
			"🔴 die Vorschau zeigt EINE Beschriftung mit dem Stamm -- am Anfuehrer (kleinste Item-Nummer), auf SEINEM Mittelpunkt");

		// Lage 2: der Editor tippt einen Namen -- er gewinnt, am ganzen Verbund, und die Karte folgt.
		api.garetienDetailWaehlen(m1.key, alle);
		gezeichnet = null;
		api.garetienEingabenAendern(eingabeEreignis("einfuegeName", { type: "text", value: "Silker Forst" }), alle);
		gleich(namensfeld(m2), "Silker Forst", "ein getippter Name gewinnt und gilt dem ganzen Verbund");
		gleich(api.garetienEingabenFuerServer(m2).name, "Silker Forst", "und reist als Handname");
		await new Promise((fertig) => setTimeout(fertig, 300));
		wahr(gezeichnet !== null, "💣 die Karte zieht nach dem Tippen nach (entprellt) -- sonst zeigte sie den alten Namen");
		gleich(vorschau(gezeichnet), "ggp:silkerhain:1=Silker Forst@5", "und ihre Beschriftung traegt den getippten Namen");

		// Lage 3: aufgeloest -- jedes Fragment zeigt wieder seinen eigenen Namen, und es gibt wieder zwei Beschriftungen.
		api.garetienVerbundAufloesen(s);
		gleich(namensfeld(m1), "Silker Hain 1", "nach „Verbund auflösen\" wieder der eigene Name");
		gleich(namensfeld(m2), "Silker Hain 2", "an jedem Fragment");
		const rumpf3 = api.garetienEingabenFuerServer(m2);
		gleich(rumpf3 && ("name" in rumpf3 || "verbund" in rumpf3), false,
			"und der Rumpf traegt weder Namen noch Verbund: " + JSON.stringify(rumpf3));
		gleich(vorschau(api.avesmapsGaretienAufDerKarte(alle)), "ggp:silkerhain:1=Silker Hain 1@5 | ggp:silkerhain:2=Silker Hain 2@2.5",
			"und die Vorschau zeigt wieder beide eigenen Namen");
		api.garetienDetailWaehlen(null, alle);
	}

	zuruecksetzen();
	{
		const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
		// BESTAND: ein Einzelobjekt ohne Verbund-Felder.
		const einzeln = { key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", urteil: "neu",
			stand: "offen", ziel: "region", subtyp: "wald", kind: "vegetation", geometrie: [[0, 0], [1, 1]],
			items: [{ id: 300, change_type: "new" }] };
		const alle = [m1, m2, einzeln];
		api.avesmapsGaretienStageHinzufuegen(alle);
		api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);

		gleich(api.garetienEingabenZustandZu(m1).curveLabel, false, "🔴 die Kurvenbeschreibung eines Verbunds startet aus");
		gleich(feldWert(api.garetienEingefuegtWirdMarkup(m1), "curveLabel"), false, "und das Haekchen im Kasten steht aus");
		gleich(api.garetienEingabenFuerServer(m1).curve_label, false, "und der Rumpf sagt es");
		gleich(api.garetienEingabenZustandZu(einzeln).curveLabel, api.garetienEingabenGrundwerte(einzeln).curveLabel,
			"ein Einzelobjekt behaelt die unveraenderte Vorgabe");

		api.garetienDetailWaehlen(m1.key, alle);
		api.garetienEingabenAendern(eingabeEreignis("curveLabel", { type: "checkbox", checked: true }), alle);
		gleich(feldWert(api.garetienEingefuegtWirdMarkup(m2), "curveLabel"), true,
			"ein Haekchen des Editors gewinnt -- am ganzen Verbund");
		gleich(api.garetienEingabenFuerServer(m2).curve_label, true, "und reist mit");
		api.garetienDetailWaehlen(null, alle);
	}
	delete global.window.avesmapsGaretienKarteZeigen;
}

// =================================================================================================
// H. „Stage leeren" und ein neuer Lauf vergessen die Einstellungen AM OBJEKT -- und nie, was dem
//    FENSTER gehoert: der Umkreis bleibt (Entscheid 14.09.2026, sonst stellt der Editor ihn nach
//    jedem Import neu ein).
// =================================================================================================
function einstellungenSetzen(o) {
	api.garetienNameWahlSetzen(o, "Handname");
	api.garetienUmkreisSetzen("naehe", 12);
	api.garetienZielWahlZu(o).subtyp = "sumpf";
	api.garetienInnerortsWahlSetzen(o, "stadt-1");
	api.garetienEinfuegeWahlSetzen(o, "quelle", false);
}
function einstellungenSindVergessen(o, wo) {
	gleich(api.garetienNameWahlZu(o), "", wo + ": Name vergessen");
	gleich(api.garetienUmkreisZu("naehe"), 12, wo + ": 🔴 der Umkreis gehoert dem FENSTER und bleibt stehen");
	gleich(api.garetienZielWahlZu(o).subtyp, "wald", wo + ": Zielwahl vergessen");
	gleich(api.garetienInnerortsWahlZu(o), "", wo + ": Innerorts-Wahl vergessen");
	gleich(api.garetienEinfuegeWahl(o).quelle, true, wo + ": Haekchen-Wahl vergessen");
}
const einzeln = {
	key: "ggp:weidicht", name: "Weidicht", ebene: "Waelder", typ: "Wald", ziel: "region", subtyp: "wald",
	innerorts: { kandidaten: [{ public_id: "stadt-1", name: "Wandleth", meilen: 1 }] },
	items: [{ id: 1, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"] }],
};
zuruecksetzen();
einstellungenSetzen(einzeln);
gleich(api.garetienNameWahlZu(einzeln), "Handname", "Vorbedingung: gesetzt");
gleich(api.garetienInnerortsWahlZu(einzeln), "stadt-1", "Vorbedingung: Innerorts gesetzt");
gleich(api.garetienEinfuegeWahl(einzeln).quelle, false, "Vorbedingung: Haekchen gesetzt");
api.avesmapsGaretienStageLeeren();
einstellungenSindVergessen(einzeln, "Stage leeren");

(async function () {
	await abschnittI();
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	api.garetienVerbundZusammenlegen(api.garetienVerbundSchluessel(m1), []);
	einstellungenSetzen(einzeln);
	await api.garetienLaufStarten(
		function () { return Promise.resolve({ run_id: 0, fehler: [] }); },
		["ggp:Gewaesser"], function () {}, function () { return Promise.resolve(null); }
	);
	einstellungenSindVergessen(einzeln, "neuer Lauf");
	gleich(api.garetienVerbundIstZusammen(api.garetienVerbundSchluessel(m1)), false,
		"ein neuer Lauf nimmt die Entscheidung „zusammengelegt\" mit");
	gleich(api.avesmapsGaretienStageHat(m1.key), true, "die Stage selbst bleibt liegen -- sie wird nachgeschlagen");

	api.garetienUmkreisVergessen();
	zuruecksetzen();
	console.log(`garetien-verbund-stage-eintrag: ${checks} Pruefungen bestanden.`);
})().catch((fehler) => { console.error(fehler); process.exit(1); });
