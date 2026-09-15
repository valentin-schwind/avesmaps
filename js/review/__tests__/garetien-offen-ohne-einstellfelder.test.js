// Aufgabe 10 des Bauplans „Garetien-Importer vereint" (14.09.2026): „Offen" ohne Einstellfelder.
// Entwurf: docs/superpowers/specs/2026-09-14-garetien-import-vereint-design.md §2, §3 (Block C)
// Mockup:  docs/garetien-import-vereint-mockup.html, Szene 2
//
// Owner 12.09.2026: „bei ‚offen' sollten bspw keine einstellungen am label vorgenommen werden" und
// „der Vorschlag ist sichtbar, geändert wird er erst auf der Stage".
//
// 💣 ZWEI HÄLFTEN, UND BEIDE MÜSSEN STEHEN. Das Markup (A) zeigt kein Feld mehr -- aber ein Feld, das
// noch im DOM steht (eine Ansicht, die vor dem Herunternehmen gezeichnet wurde), riefe
// garetienEingabenAendern trotzdem. Deshalb der Riegel dort (C), gefahren mit echten Ereignissen.
//
// 🔴 BESTAND (Owner 14.09.2026, Abschnitt D): ein übernommenes Objekt zeigt weiter, was es zeigte;
// eine abgelehnte Zeile behält „Wieder vorschlagen".
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-offen-ohne-einstellfelder.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
// Die Vorgabetafeln ECHT geladen -- ohne sie klafft ecosystem-display.js als blanker Bezeichner, sobald
// der Kasten einer Fläche auf der Stage wirklich gebaut wird (Vorbild: garetien-bloecke.test.js).
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" });
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" });
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const { ladeImporter } = require("./helfer/garetien-testumgebung.js");
const { api } = ladeImporter(["garetien-detailcol"]);

let n = 0;
const wahr = (b, w) => { assert.ok(b, w || ""); n++; };
const gleich = (i, s, w) => { assert.strictEqual(i, s, w || ""); n++; };
const tief = (i, s, w) => { assert.deepStrictEqual(i, s, w || ""); n++; };

// ---- Fixtures -- jede OHNE verbund-Felder, wie jeder Lauf vor dem Deploy ------------------------
function wald() {
	return { key: "ggp:Waelder:Wald:Garetien:Silker Heide!Silker Heide", stand: "offen", urteil: "neu",
		name: "Silker Heide", typ: "Wald", wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [2, 0], [2, 2], [0, 2]], abschnitte: [],
		quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
			license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
		items: [{ id: 61, change_type: "new", anlass: "", felder: ["quelle"] }] };
}
function natter() {
	return { key: "ggp:Gewaesser:Fluss:Garetien:Natter!Natter", stand: "offen", urteil: "ergaenzung",
		name: "Natter", typ: "Fluss", wiki: "ggp", ziel: "path", subtyp: "Flussweg",
		geometrie: [[1, 1], [2, 2]], abschnitte: [{ public_id: "Flussweg-1", name: "Natter" }],
		items: [
			{ id: 71, change_type: "changed", anlass: "ergaenzung", felder: ["quelle"], abschnitt: { public_id: "Flussweg-1" } },
			{ id: 72, change_type: "new", anlass: "zusatz", felder: [] },
		] };
}
function perz() {
	return { key: "ggp:Ortschaften:Dorf:Garetien:Perz!Perz", stand: "offen", urteil: "uebersprungen",
		name: "Perz", typ: "Dorf", ziel: "location", subtyp: "dorf", geometrie: [[5, 5]], abschnitte: [], items: [] };
}
function frisch() {
	api.garetienZielwahlVergessen();
	api.garetienZielWahlVergessen();
	api.garetienNameWahlVergessen();
	api.avesmapsGaretienStageLeeren();
}
function ereignis(feld, wert, typ) {
	return { target: {
		getAttribute: (name) => (name === "data-gi-feld" ? feld : null),
		hasAttribute: (name) => name === "data-gi-feld",
		value: wert, checked: wert === true, type: typ || "select-one",
	} };
}

// =================================================================================================
// A. „Offen": der Vorschlag als Text -- und kein einziges Einstellfeld
// =================================================================================================
frisch();
{
	const o = wald();
	const mk = api.garetienEingefuegtWirdMarkup(o);
	wahr(mk.includes('<p class="gi-insert__row"><span>Ziel:</span> <span class="gi-insert__val">Auf die Karte</span></p>'),
		"Ziel als Text: " + mk);
	wahr(mk.includes('<p class="gi-insert__row"><span>Form:</span> <span class="gi-insert__val">Fläche</span></p>'),
		"Form als Text");
	wahr(mk.includes('<p class="gi-insert__row"><span>Art:</span> <span class="gi-insert__val">Wald</span> '
		+ '<span class="gi-insert__hint">aus „Wald“ (garetien.de)</span></p>'),
		"Art als Text, mit ihrer Herkunft (Mockup §2)");
	wahr(mk.includes('<p class="gi-why">Erst auf der Stage einstellbar.</p>'), "…und der Satz, wo man es ändert");
	gleich(/data-gi-feld=/.test(mk), false, "🔴 kein data-gi-feld im Kasten: " + mk);
	gleich(/<select|<input/.test(mk), false, "🔴 kein Auswahlfeld, kein Eingabefeld");
	gleich(mk.indexOf("Darstellung sowie Wiki"), -1, "der alte Hinweis auf Block D/E ist ersetzt");

	const spalte = api.garetienDetailMarkup(o, null, false);
	gleich((spalte.match(/data-gi-feld=/g) || []).length, 0,
		"🔴 die GANZE rechte Spalte trägt auf „Offen\" kein data-gi-feld (Entwurf §9, erste Zeile)");
	wahr(spalte.includes("Erst auf der Stage einstellbar."), "…und der Vorschlag steht darin");
	wahr(spalte.includes('data-gi-umkreis="naehe"'),
		"⚠️ Block G bleibt bedienbar -- der Umkreis wählt ZEILEN aus, er stellt nichts am Objekt ein");
}
frisch();
{
	const mk = api.garetienEingefuegtWirdMarkup(natter());
	wahr(mk.includes('<span>Ziel:</span> <span class="gi-insert__val">Quelle an „Natter“ ergänzen</span>'),
		"eine Ergänzung nennt ihr Ziel -- auch ohne Neu-Item steht der Kasten da: " + mk);
	gleich(mk.indexOf("<span>Form:</span>"), -1, "⚠️ …ohne Form: eine Ergänzung baut kein Objekt");
	const mp = api.garetienEingefuegtWirdMarkup(perz());
	wahr(mp.includes('<span>Ziel:</span> <span class="gi-insert__val">Nichts — nur ansehen</span>'),
		"ohne Vorschlag: „Nichts — nur ansehen\"");
}

// =================================================================================================
// B. „Stage": dasselbe Objekt, jetzt aufgelegt -- die Felder sind zurück
// =================================================================================================
frisch();
{
	const o = wald();
	api.avesmapsGaretienStageHinzufuegen([o]);
	const mk = api.garetienEingefuegtWirdMarkup(o);
	wahr(/data-gi-feld="zielForm"/.test(mk) && !/data-gi-feld="zielForm"[^>]* disabled/.test(mk),
		"auf der Stage ist die Form bedienbar");
	gleich(mk.indexOf("Erst auf der Stage einstellbar."), -1, "…und der Satz ist weg");
	// Seit Aufgabe 11 (14.09.2026) ist „Wiki und Quellen" der Block E „Wiki & Quellen".
	wahr(mk.includes('<span class="gi-block__zahl">E</span>Wiki &amp; Quellen'), "…und Block E steht da");
}

// =================================================================================================
// C. DER RIEGEL -- ein Feld eines nicht aufgelegten Objekts wird ignoriert
// =================================================================================================
frisch();
{
	const o = wald();
	let karteGezeichnet = 0;
	global.window.avesmapsGaretienKarteZeigen = function () { karteGezeichnet++; };
	api.garetienDetailWaehlen(o.key, [o]);
	// ⚠️ Das Auswählen zeichnet die Karte SELBST (Zentrieren/Hervorheben) -- gezählt wird erst danach.
	karteGezeichnet = 0;
	// 🔴 ANKERABWEICHUNG (R-h, Bericht): `garetienVorschauNachziehen` prueft seit der Nachbesserung
	// Runde 1 (W3, bereits vor dieser Aufgabe im Worktree) `zustand.offen` -- ein Kartenlauf fuer ein
	// GESCHLOSSENES Fenster waere sonst ein Ausfall der Oeffentlichen Karte (Riegel 2 von 2, siehe
	// avesmapsGaretienFensterSchliessen). Der Brief-Text kennt diesen Riegel noch nicht und oeffnet das
	// Fenster nie -- ohne den Testzugang bliebe die Gegenprobe unten IMMER bei 0, auch wenn der Riegel
	// dieser Aufgabe laengst durchlaesst, und wuerde damit nichts mehr belegen. `garetienFensterOffenSetzen`
	// ist genau dafuer da (Testzugang ohne DOM-/Netz-Nebenwirkungen, siehe __test-Export).
	api.__test.garetienFensterOffenSetzen(true);

	api.garetienEingabenAendern(ereignis("zielForm", "label"), [o]);
	gleich(api.garetienZielWahlZu(o).ziel, "region", "💣 „Offen\": die Form bleibt, wie sie vorgeschlagen ist");
	api.garetienEingabenAendern(ereignis("zielwahl", "nichts", "radio"), [o]);
	gleich(api.garetienZielwahlZu(o), "karte", "💣 „Offen\": die Zielwahl bleibt");
	api.garetienEingabenAendern(ereignis("einfuegeName", "Silker Forst", "text"), [o]);
	gleich(api.garetienNameWahlZu(o), "", "💣 „Offen\": kein Name");
	api.garetienEingabenAendern(ereignis("size", "30", "number"), [o]);
	gleich(karteGezeichnet, 0, "💣 …und die Vorschau auf der Karte zieht NICHT nach");
	api.garetienEingabenAendern(ereignis("isLocked", true, "checkbox"), [o]);
	gleich(api.garetienEingabenZustandZu(o).isLocked, false, "💣 …und kein Häkchen");
	gleich(api.garetienEingabenZustandZu(o).size !== 30, true, "💣 …und keine Zahl");

	// Gegenprobe -- sonst wäre jede Zeile darüber auch mit einem Handler grün, der gar nichts tut.
	api.avesmapsGaretienStageHinzufuegen([o]);
	api.garetienEingabenAendern(ereignis("zielForm", "label"), [o]);
	gleich(api.garetienZielWahlZu(o).ziel, "label", "Gegenprobe Stage: die Form ändert sich");
	wahr(karteGezeichnet > 0, "Gegenprobe Stage: …und die Vorschau zieht nach");
	api.garetienEingabenAendern(ereignis("einfuegeName", "Silker Forst", "text"), [o]);
	gleich(api.garetienNameWahlZu(o), "Silker Forst", "Gegenprobe Stage: der Name hält");
	delete global.window.avesmapsGaretienKarteZeigen;
	api.garetienDetailWaehlen(null, []);
	api.__test.garetienFensterOffenSetzen(false);
}

// =================================================================================================
// D. BESTAND -- übernommen und abgelehnt
// =================================================================================================
frisch();
{
	// Ein übernommenes Objekt liegt nicht auf der Stage -- es zeigt, was es vor dem Umbau zeigte.
	const uebernommen = Object.assign(wald(), { key: "ggp:Waelder:Wald:Garetien:Alter Forst!Alter Forst",
		name: "Alter Forst", stand: "uebernommen", innerorts_uebernommen: false,
		items: [{ id: 81, change_type: "new", anlass: "", felder: ["quelle"], selected: 1, apply_state: "done",
			apply_note: "Wald-1234" }] });
	// 🔴 SEIT AUFGABE 11 (14.09.2026, Bestand, Owner): KEIN Einstellblock mehr -- die Blöcke C bis E fehlen,
	// der Satz, wo es liegt und ob es zurückgeht, steht in Block A.
	const mk = api.garetienEingefuegtWirdMarkup(uebernommen);
	gleich(mk, "", "🔴 übernommen: kein Einstellblock, auch nicht gesperrt: " + mk);
	const spalteUeb = api.garetienDetailMarkup(uebernommen, null, false);
	gleich(spalteUeb.indexOf("Erst auf der Stage einstellbar."), -1, "…und NICHT als Vorschlag");
	wahr(spalteUeb.includes("Liegt bereits auf der Karte"), "…und mit seinem Satz, in Block A");
	gleich(api.garetienHandlungen(uebernommen)[0].name, "ruecknahme", "…und seiner Rücknahme");

	// Eine abgelehnte Zeile: „Wieder vorschlagen" bleibt; Auswahlfelder hatte sie nie wirksam.
	const abgelehnt = Object.assign(wald(), { key: "ggp:Waelder:Wald:Garetien:Abgewiesen!Abgewiesen",
		name: "Abgewiesen", stand: "abgelehnt" });
	tief(api.garetienHandlungen(abgelehnt).map((k) => k.name), ["wieder"], "🔴 abgelehnt: genau „Wieder vorschlagen\"");
	const ma = api.garetienEingefuegtWirdMarkup(abgelehnt);
	gleich(/data-gi-feld=/.test(ma), false, "⚠️ abgelehnt: der Vorschlag als Text statt wirkungsloser Felder");
	wahr(ma.includes("Erst auf der Stage einstellbar."), "…mit demselben Satz wie auf „Offen\"");
}

// =================================================================================================
// E. RULING R-f -- ein zusammengelegter Verbund liegt PER DEFINITION auf der Stage; der Riegel
// verwirft also nichts, und der Aufloesen-Hook (garetienVerbundEinstellungSchreiben) laeuft
// unveraendert durch die neue Riegel-Zeile hindurch.
// =================================================================================================
frisch();
{
	function fragment(nr, punkte) {
		return { key: "ggp:silkerhain:" + nr, name: "Silker Hain " + nr, typ: "Wald",
			stand: "offen", urteil: "neu", ziel: "region", subtyp: "wald", kind: "vegetation",
			verbund_stamm: "Silker Hain", verbund_n: 2,
			geometrie: Array.from({ length: punkte }, (_, i) => [i, i]), abschnitte: [],
			items: [{ id: 200 + nr, change_type: "new" }] };
	}
	const [m1, m2] = [fragment(1, 11), fragment(2, 6)];
	api.avesmapsGaretienStageHinzufuegen([m1, m2]);
	const s = api.garetienVerbundSchluessel(m1);
	gleich(api.garetienVerbundZusammenlegen(s, []), 2, "Vorbedingung: zusammengelegt");

	api.garetienDetailWaehlen(m1.key, [m1, m2]);
	api.garetienEingabenAendern(ereignis("zielForm", "label"), [m1, m2]);
	gleich(api.garetienVerbundIstZusammen(s), false,
		"R-f: die Reihenfolge Riegel -> Aufloesen-Hook bricht nichts -- beide Mitglieder liegen auf der "
		+ "Stage, der Riegel laesst also durch, und der Verbund loest sich weiter auf, wie vor dieser Aufgabe");
	gleich(api.garetienZielWahlZu(m1).ziel, "label", "…und die neue Form ueberlebt an BEIDEN vormaligen Mitgliedern");
	gleich(api.garetienZielWahlZu(m2).ziel, "label", "…auch am zweiten (W1/W2 bleiben unberuehrt)");
	api.garetienDetailWaehlen(null, [m1, m2]);
}

console.log("OK -- garetien-offen-ohne-einstellfelder: " + n + " Zusicherungen");
