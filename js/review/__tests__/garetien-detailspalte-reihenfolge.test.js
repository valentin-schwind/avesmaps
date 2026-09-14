// Die Einzelansicht in sieben Bloecken (Bauplan 2026-09-14, Aufgabe 11; Entwurf §3, Mockup §2 bis §6).
//
// 🔴 GEMESSEN WIRD DAS ERGEBNIS, NICHT DER QUELLTEXT. Jede Zusicherung ruft garetienDetailMarkup
// wirklich auf und liest Bloecke, Buchstaben und Titel aus dem GEBAUTEN Markup. Der erste Entwurf
// dieser Aufgabe (Bauplan 2026-09-09) suchte die Titel per indexOf im Quelltext -- ein Titel in
// einem Kommentar haette ihn gruen gemacht, waehrend die Spalte etwas ganz anderes zeigt.
// 🔴 DER BESTAND (Owner 14.09.2026): der Importer ist live. Je ein uebernommenes und ein
// abgelehntes Objekt aus einem Lauf OHNE verbund-Felder laufen mit (Abschnitte 6 und 7).
// ⚠️ Pixel misst dieser Test nicht -- ob die Buchstaben FLUCHTEN, sagt nur der Browser (Bauplan,
// Aufgabe 11 Schritt 5). Hier steht, was die Flucht voraussetzt: jeder Block ist ein direktes Kind
// von `.gi-detail`, und keine spaetere Regel ueberstimmt den Block (Abschnitt 10).
//
// Ausführen: node js/review/__tests__/garetien-detailspalte-reihenfolge.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

// 💣 Die Vorgabetafeln ECHT laden, BEVOR das Modul kommt -- ohne sie klafft ecosystem-display.js als
// blanker Bezeichner, sobald Block D wirklich gebaut wird (Vorbild garetien-bloecke.test.js).
global.document = global.document || { documentElement: {}, getElementById() { return null; },
	addEventListener() {}, querySelectorAll() { return []; } };
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
["js/map-features/ecosystem-display.js", "js/map-features/location-zoom-bands.js"].forEach(function (datei) {
	vm.runInThisContext(fs.readFileSync(path.join(WURZEL, datei), "utf8"), { filename: datei });
});
global.avesmapsLabelArtName = require(path.join(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was); }

// ---- Lesehilfen: die Bloecke eines GEBAUTEN Markups ------------------------------------------------
function bloecke(markup) {
	const raus = [];
	const muster = /<div class="(gi-block(?: [^"]*)?)"><p class="gi-block__kopf(?: [^"]*)?"><span class="gi-block__zahl">([^<]*)<\/span>([^<]*)/g;
	let t;
	while ((t = muster.exec(markup)) !== null) {
		raus.push({ klasse: t[1], buchstabe: t[2], titel: t[3], stelle: t.index });
	}
	return raus;
}
function buchstaben(markup) { return bloecke(markup).map(function (b) { return b.buchstabe; }).join(""); }
function inhalt(markup, buchstabe) {
	const liste = bloecke(markup);
	const i = liste.findIndex(function (b) { return b.buchstabe === buchstabe; });
	if (i === -1) { return null; }
	return markup.slice(liste[i].stelle, i + 1 < liste.length ? liste[i + 1].stelle : markup.length);
}
function tiefe(markup, stelle) {
	const davor = markup.slice(0, stelle);
	return (davor.match(/<div\b/g) || []).length - (davor.match(/<\/div>/g) || []).length;
}
function gesperrt(markup, merkmal) {
	return new RegExp(merkmal + '[^>]*\\bdisabled\\b').test(markup);
}
function zahl(markup, muster) { return (markup.match(muster) || []).length; }

// ---- Fixtures ----------------------------------------------------------------------------------------
const QUELLE = { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
	license: "cc-by-nc-sa-3.0", source_type: "briefspiel" };
function fragment(nr) {
	return {
		key: "ggp:Waelder:Wald:Garetien:Silker Hain " + nr + "!Silker Hain " + nr,
		name: "Silker Hain " + nr, typ: "Wald", ebene: "Waelder", stand: "offen", urteil: "neu",
		wiki: "ggp", ziel: "region", subtyp: "wald", kind: "vegetation",
		grund: "nichts desselben Typs in der Nähe", verbund_stamm: "Silker Hain", verbund_n: 2,
		geometrie: [[1, 1], [2, 1], [2, 2]], quelle: QUELLE, abschnitte: [],
		items: [{ id: 30 + nr, change_type: "new", anlass: "", felder: ["quelle"] }],
	};
}
const f1 = fragment(1);
const f2 = fragment(2);
// Ein Bauwerk mit einer Siedlung im Umkreis -- nur daran GIBT es die Stätte (eine unmoegliche Wahl
// zaehlt nie, garetienZielwahlZu).
const bauwerk = {
	key: "ggp:Sonstiges:Burg:Garetien:Burg Finster!Burg Finster", name: "Burg Finster", typ: "Burg",
	ebene: "Sonstiges", stand: "offen", urteil: "neu", wiki: "ggp", ziel: "location", subtyp: "gebaeude",
	kind: "", geometrie: [[3, 3]], quelle: QUELLE, abschnitte: [],
	innerorts: { public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8,
		kandidaten: [{ public_id: "stadt-wandleth", name: "Wandleth", meilen: 0.8, nennt_name: false }] },
	items: [{ id: 77, change_type: "new", anlass: "" }],
};
// 🔴 BESTAND: ein Lauf von VOR dem Deploy -- kein `verbund_stamm`, kein `verbund_n`.
const uebernommen = {
	key: "ggp:Waelder:Wald:Garetien:Dunkelforst!Dunkelforst", name: "Dunkelforst", typ: "Wald",
	ebene: "Waelder", stand: "uebernommen", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald",
	kind: "vegetation", geometrie: [[5, 5], [6, 5], [6, 6]], quelle: QUELLE, abschnitte: [],
	items: [{ id: 901, change_type: "new", anlass: null, apply_state: "done" }],
};
const abgelehnt = {
	key: "ggp:Waelder:Wald:Garetien:Moosgrund!Moosgrund", name: "Moosgrund", typ: "Wald",
	ebene: "Waelder", stand: "abgelehnt", urteil: "neu", wiki: "ggp", ziel: "region", subtyp: "wald",
	kind: "vegetation", geometrie: [[8, 8], [9, 8], [9, 9]], quelle: QUELLE, abschnitte: [],
	items: [{ id: 902, change_type: "new", anlass: null }],
};

// `zustand.objekte` gibt es nur ueber die echte Tuer (Vorbild garetien-verbund-klick.test.js).
async function mitObjekten(objekte) {
	const echterFetch = global.fetch;
	global.fetch = function () {
		return Promise.resolve({ json: () => Promise.resolve({ ok: true, objekte: objekte, plan_run_id: 7 }) });
	};
	await api.avesmapsGaretienListeHolen();
	global.fetch = echterFetch;
}

(async function () {
	api.avesmapsGaretienStageLeeren();
	await mitObjekten([f1, f2, bauwerk, uebernommen, abgelehnt]);

	// ---- 1. OFFEN: A B C F G -- D und E fehlen, C traegt nur Text -----------------------------------
	const offen = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(offen), "ABCFG", "auf „Offen\" die Bloecke A B C F G: " + buchstaben(offen));
	const titel = {};
	bloecke(offen).forEach(function (b) { titel[b.buchstabe] = b.titel; });
	gleich(titel.A, "Auf der Karte", "A heisst „Auf der Karte\"");
	gleich(titel.B, "Verbund", "B heisst „Verbund\"");
	gleich(titel.C, "Ziel &amp; Identität", "C heisst „Ziel & Identität\"");
	gleich(titel.F, "Handlung", "F heisst „Handlung\"");
	gleich(titel.G, "Weiter importieren", "G heisst „Weiter importieren\"");
	const cOffen = inhalt(offen, "C");
	pruefe(cOffen.indexOf(api.garetienVorschlagMarkup(f1)) !== -1,
		"C traegt auf „Offen\" den Vorschlag als Text (Aufgabe 10): " + cOffen);
	pruefe(!/data-gi-feld|<select|<input/.test(cOffen),
		"🔴 auf „Offen\" steht in C KEIN Einstellfeld (Owner 12.09.2026): " + cOffen);
	pruefe(cOffen.includes('<span class="gi-block__note">Vorschlag</span>'), "C sagt, dass es ein Vorschlag ist");
	pruefe(inhalt(offen, "A").includes("<b>Der Grund:</b> nichts desselben Typs in der Nähe"),
		"der Grund ist in Block A gewandert");
	pruefe(inhalt(offen, "A").includes("✦ Zentrieren"), "„✦ Zentrieren\" steht in A");
	pruefe(inhalt(offen, "G").includes('class="gi-naehe"'), "„Imports in der Nähe wählen\" ist Block G");
	pruefe(inhalt(offen, "F").includes('data-handlung="stage"'), "F traegt den Vorwaertsknopf");
	pruefe(!/class="gi-sec[ "]/.test(offen), "💣 keine `.gi-sec` mehr -- sie zoege eine zweite Linie in einen Block");

	// ---- 2. STAGE: A B C D E F G ---------------------------------------------------------------------
	api.avesmapsGaretienStageHinzufuegen([f1, f2]);
	const stage = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(stage), "ABCDEFG", "auf der Stage alle sieben: " + buchstaben(stage));
	const cStage = inhalt(stage, "C");
	const iZiel = cStage.indexOf('class="gi-ziel"');
	const iName = cStage.indexOf('data-gi-feld="einfuegeName"');
	const iForm = cStage.indexOf('data-gi-feld="zielForm"');
	pruefe(iZiel !== -1 && iName !== -1 && iForm !== -1 && cStage.includes('data-gi-feld="zielArt"'),
		"C traegt Zielwahl, Name, Form und Art: " + cStage);
	pruefe(iZiel < iName && iName < iForm, "in dieser Reihenfolge");
	// 💣 JEDES FELD GENAU EINMAL: Zielwahl und Namensfeld standen von Aufgabe 9 bis hierher in der Leiste.
	// Zweimal gezeichnet truegen zwei Felder dieselbe id.
	gleich(zahl(stage, /data-gi-feld="einfuegeName"/g), 1, "das Namensfeld steht genau einmal in der Spalte");
	gleich(zahl(stage, /role="radiogroup"/g), 1, "die Zielwahl steht genau einmal in der Spalte");
	pruefe(!/data-gi-feld=/.test(inhalt(stage, "F")), "🔴 F traegt kein Einstellfeld mehr: " + inhalt(stage, "F"));
	pruefe(inhalt(stage, "D").includes("für Klicks gesperrt"), "D traegt die Felder der Flaeche");
	pruefe(inhalt(stage, "E").includes("Die Quelle, die mitreist") && inhalt(stage, "E").includes("Wiki-Landschaft"),
		"E traegt Quelle und Wiki-Landschaft");
	const klasse = {};
	bloecke(stage).forEach(function (b) { klasse[b.buchstabe] = b.klasse; });
	gleich(klasse.A, "gi-block gi-block--erster", "A ist der erste Block");
	gleich(klasse.D, "gi-block gi-insert", "💣 D traegt gi-insert -- die Regler sind darunter verengt");
	gleich(klasse.E, "gi-block gi-insert", "E ebenso");
	gleich(klasse.F, "gi-block gi-acts", "F traegt gi-acts am Block selbst");
	gleich(zahl(stage, /class="gi-block[ "]/g), bloecke(stage).length, "kein Block ohne Buchstaben");
	gleich(zahl(stage, /gi-block--erster/g), 1, "genau EIN erster Block");
	pruefe(stage.startsWith('<div class="gi-detail">') && stage.endsWith("</div>"), "eine rollende Ansicht");
	bloecke(stage).forEach(function (b) {
		gleich(tiefe(stage, b.stelle), 1, "🔴 Block " + b.buchstabe + " ist direktes Kind von .gi-detail");
	});

	// ---- 3. Abgeblendet, nicht ausgeblendet ------------------------------------------------------------
	// ⚠️ Nur mit Zielen, die es fuer DIESES Objekt gibt -- an einer Flaeche „Nichts" und „Auf die Karte".
	api.garetienZielwahlSetzen(f1, "nichts");
	const nichts = api.garetienDetailMarkup(f1, null, false);
	gleich(buchstaben(nichts), "ABCDEFG", "⚠️ ein anderes Ziel nimmt keinen Block weg -- die Spalte springt nicht");
	pruefe(gesperrt(inhalt(nichts, "C"), 'data-gi-feld="einfuegeName"'), "bei „Nichts\" ist der Name gesperrt");
	pruefe(gesperrt(inhalt(nichts, "C"), 'data-gi-feld="zielForm"'), "…und die Form");
	pruefe(inhalt(nichts, "C").includes("gi-insert__row--aus"), "…und die Zeilen sind abgeblendet");
	pruefe(inhalt(nichts, "D").includes("gi-insert__row--aus")
		&& gesperrt(inhalt(nichts, "D"), 'id="' + api.garetienEingabeId(f1, "isLocked") + '"'),
		"D bleibt stehen, grau und gesperrt");
	api.garetienZielwahlSetzen(f1, "karte");
	const karte = api.garetienDetailMarkup(f1, null, false);
	pruefe(!karte.includes("gi-insert__row--aus"), "die Gegenprobe: „Auf die Karte\" blendet nichts ab");
	pruefe(!gesperrt(inhalt(karte, "C"), 'data-gi-feld="einfuegeName"'), "…und sperrt nichts");
	api.garetienZielwahlVergessen();

	// ---- 4. Zusammengelegt: C sagt, wem die Einstellungen gelten ----------------------------------------
	const schluessel = api.garetienVerbundSchluessel(f1);
	api.garetienVerbundZusammenlegen(schluessel, [f1, f2]);
	pruefe(inhalt(api.garetienDetailMarkup(f1, null, false), "C")
		.includes('<span class="gi-block__note">gilt dem ganzen Verbund</span>'), "C sagt „gilt dem ganzen Verbund\"");
	api.garetienVerbundAufloesen(schluessel);

	// ---- 5. Das Bauwerk: Siedlung und Umkreis in C, genau einmal -- und die Stätte ----------------------
	api.avesmapsGaretienStageHinzufuegen([bauwerk]);
	const mBau = api.garetienDetailMarkup(bauwerk, null, false);
	gleich(zahl(inhalt(mBau, "C"), /data-gi-umkreis="innerorts"/g), 1,
		"💣 der Innerorts-Umkreis steht in C, genau einmal: " + inhalt(mBau, "C"));
	gleich(zahl(mBau, /id="garetien-umkreis-innerorts"/g), 1, "und keine zweite gleiche id");
	gleich(zahl(mBau, /data-gi-feld="innerorts"/g), 1, "die Siedlung steht genau einmal -- in C");
	api.garetienZielwahlSetzen(bauwerk, "staette");
	gleich(api.garetienZielwahlZu(bauwerk), "staette", "Testvoraussetzung: am Bauwerk mit Siedlung gibt es die Stätte");
	const staette = api.garetienDetailMarkup(bauwerk, null, false);
	pruefe(!gesperrt(inhalt(staette, "C"), 'data-gi-feld="einfuegeName"'), "eine Stätte behaelt ihren Namen");
	pruefe(gesperrt(inhalt(staette, "C"), 'data-gi-feld="zielForm"') && inhalt(staette, "C").includes("gilt nicht für eine Stätte"),
		"…aber nicht ihre Form -- mit Grund");
	pruefe(inhalt(staette, "D").includes("gi-insert__row--aus") && gesperrt(inhalt(staette, "D"), 'data-gi-feld="isRuined"'),
		"…und D steht grau und gesperrt da");
	api.garetienZielwahlVergessen();

	// ---- 6. BESTAND: ein uebernommenes Objekt eines alten Laufs -- A und F, C bis E fehlen ---------------
	const mUeb = api.garetienDetailMarkup(uebernommen, null, false);
	gleich(buchstaben(mUeb), "AF", "🔴 uebernommen: nur A und F (Owner 14.09.2026): " + buchstaben(mUeb));
	pruefe(inhalt(mUeb, "F").includes('data-handlung="ruecknahme"') && inhalt(mUeb, "F").includes("Zurücknehmen"),
		"F traegt „Zurücknehmen\"");
	pruefe(inhalt(mUeb, "A").includes("Liegt bereits auf der Karte."), "der Satz, wo es liegt, steht in A");
	api.avesmapsGaretienStageHinzufuegen([uebernommen]);
	gleich(buchstaben(api.garetienDetailMarkup(uebernommen, null, false)), "AF",
		"⚠️ auch auf der Stage (bis garetienStageNachschlagen es abraeumt) keine Einstellbloecke");

	// ---- 7. BESTAND: eine abgelehnte Zeile -- A C F G, F traegt „Wieder vorschlagen" ---------------------
	const mAbg = api.garetienDetailMarkup(abgelehnt, null, false);
	gleich(buchstaben(mAbg), "ACFG", "🔴 abgelehnt: A C F G: " + buchstaben(mAbg));
	pruefe(inhalt(mAbg, "F").includes('data-handlung="wieder"'), "F traegt „Wieder vorschlagen\"");
	pruefe(!inhalt(mAbg, "F").includes('data-handlung="stage"'), "und nichts, das sie auf die Stage legt");
	pruefe(!/data-gi-feld|<select/.test(inhalt(mAbg, "C")), "C bleibt Text");

	// ---- 8. Ohne Auswahl kein Block -------------------------------------------------------------------------
	gleich(bloecke(api.garetienDetailMarkup(null)).length, 0, "ohne Auswahl steht der Hinweissatz, kein Block");

	// ---- 9. Der Bauer selbst ---------------------------------------------------------------------------------
	gleich(api.garetienBlockMarkup("C", "Ziel & Identität", "", "Vorschlag", false), "", "ohne Inhalt kein Block");
	gleich(api.garetienBlockMarkup("A", "T<", "<i>x</i>", "N&", true),
		'<div class="gi-block gi-block--erster"><p class="gi-block__kopf"><span class="gi-block__zahl">A</span>'
		+ 'T&lt;<span class="gi-block__note">N&amp;</span></p><i>x</i></div>', "Titel und Notiz escaped, erster Block");
	gleich(api.garetienBlockMarkup("F", "Handlung", "i", "", false, { blockKlasse: "gi-acts", kopfKlasse: "gi-acts__titel" }),
		'<div class="gi-block gi-acts"><p class="gi-block__kopf gi-acts__titel"><span class="gi-block__zahl">F</span>'
		+ "Handlung</p>i</div>", "Zusatzklassen an Block und Kopf");
	gleich(api.garetienZeilenAbblenden('<p class="gi-insert__row">a</p><p class="gi-insert__row gi-insert__row--edit">b</p>'
		+ '<label class="x gi-insert__row" for="y">'),
		'<p class="gi-insert__row gi-insert__row--aus">a</p><p class="gi-insert__row gi-insert__row--aus gi-insert__row--edit">b</p>'
		+ '<label class="x gi-insert__row gi-insert__row--aus" for="y">', "abgeblendet wird die Grundklasse, nie ein Modifikator");

	// ---- 10. Das CSS ---------------------------------------------------------------------------------------
	const roh = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8").replace(/\r\n/g, "\n");
	const css = roh.replace(/\/\*[\s\S]*?\*\//g, "");
	const block = (css.match(/\.gi-block\s*\{[^}]*\}/) || [""])[0];
	pruefe(block !== "", "die Regel .gi-block fehlt -- die Proben darunter messen sonst nichts");
	pruefe(/border-top:\s*1px solid var\(--color-divider\)/.test(block), "gruppiert wird ueber die Trennlinie");
	pruefe(!/border(-radius)?\s*:/.test(block.replace(/border-top/g, "")), "⚠️ und nie ueber einen Rahmen (§12)");
	pruefe(/\.gi-block\.gi-acts\s*\{[^}]*padding-left:\s*0/.test(css), "F nimmt ein Eigenpolster von .gi-acts zurueck");
	pruefe(!/\.gi-detail\s*>\s*\.gi-acts\s*\{/.test(css), "💣 `.gi-detail > .gi-acts` ist weg -- sie ueberstimmte .gi-block");
	pruefe(!/\.avm-col\s*>\s*\.gi-naehe\s*\{/.test(css), "💣 `.gi-win .avm-col > .gi-naehe` ist weg -- G steht in .gi-detail");
	pruefe(!/\.gi-sec(__note)?\s*\{/.test(css), "`.gi-sec` ist als tote Regel mitgegangen");
	pruefe(!/\.gi-acts\s*>\s*\.gi-ziel\s*\{/.test(css) && !/\.gi-acts\s+\.gi-insert__row\s*\{/.test(css),
		"💣 `.gi-acts > .gi-ziel` und `.gi-acts .gi-insert__row` sind weg -- in der Leiste steht keine Eingabe mehr");
	pruefe(/\.gi-block__zahl\s*\{[^}]*font-size:\s*var\(--font-size-caption\)/.test(css), "die Zahl im Kreis steht auf 11 px");
	// ⚠️ Die Regel baut Aufgabe 9; dieser Block setzt sie voraus (Abschnitt 3) und haelt ihre Stelle fest.
	pruefe(css.search(/\.gi-insert__row--aus\s*\{/) > css.search(/\.gi-insert__row\s*\{/),
		"⚠️ .gi-insert__row--aus (Aufgabe 9) steht HINTER .gi-insert__row -- gleich spezifisch, die spaetere gewinnt");

	// 💣 DIE STELLE DES BLOCKS: hinter der Zielwahl (Aufgabe 9), vor „Aufgabe 15" -- und keine Regel DAHINTER
	// setzt an einem Element eines Blocks eine Eigenschaft des Blocks. Gleich spezifisch gewinnt die spaetere,
	// und tools/mockup-vertrag prueft nur Deklarationen. Ausgefuehrt, nicht gelesen: jede Regel wird zerlegt.
	const stelle = roh.search(/^\.gi-block\s*\{/m);
	pruefe(stelle > roh.search(/^\.gi-ziel\s*\{/m) && stelle < roh.indexOf("Aufgabe 15: die Handlungsleiste"),
		"der Block steht hinter der Zielwahl (Aufgabe 9) und vor „Aufgabe 15\"");
	const lang = function (eigenschaft) {
		const e = eigenschaft.trim().toLowerCase();
		if (e === "margin" || e === "padding") { return ["top", "right", "bottom", "left"].map(function (s) { return e + "-" + s; }); }
		if (e === "border") { return ["top", "right", "bottom", "left"].map(function (s) { return "border-" + s; }); }
		const teil = e.match(/^(border-(?:top|right|bottom|left))-(?:width|style|color)$/);
		return [teil ? teil[1] : e];
	};
	const regeln = [];
	roh.slice(stelle).replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{([^{}]*)\}/g, function (_, sel, rumpf) {
		regeln.push({ sel: sel.trim(), props: rumpf.split(";").map(function (d) { return d.split(":")[0]; })
			.filter(function (d) { return d.trim() !== ""; }).reduce(function (a, p) { return a.concat(lang(p)); }, []) });
		return "";
	});
	const eigen = function (selektor) { return (regeln.find(function (r) { return r.sel === selektor; }) || { props: [] }).props; };
	pruefe(eigen(".gi-block").indexOf("margin-top") !== -1 && eigen(".gi-block__kopf").indexOf("margin-bottom") !== -1,
		"die Probe kennt die Eigenschaften der Blockregeln -- sonst faende sie nie etwas");
	const elemente = [
		{ klassen: ["gi-block", "gi-acts"], props: eigen(".gi-block") },
		{ klassen: ["gi-block", "gi-insert"], props: eigen(".gi-block") },
		{ klassen: ["gi-block__kopf", "gi-acts__titel"], props: eigen(".gi-block__kopf") },
	];
	const ueberstimmt = [];
	regeln.forEach(function (r) {
		r.sel.split(",").forEach(function (teil) {
			if (/gi-block/.test(teil)) { return; }
			const rechts = teil.trim().split(/[\s>+~]+/).pop() || "";
			const klassen = (rechts.match(/\.[\w-]+/g) || []).map(function (k) { return k.slice(1); });
			elemente.forEach(function (el) {
				if (klassen.length === 0 || !klassen.every(function (k) { return el.klassen.indexOf(k) !== -1; })) { return; }
				r.props.forEach(function (p) {
					if (el.props.indexOf(p) !== -1) { ueberstimmt.push(teil.trim() + " { " + p + " }"); }
				});
			});
		});
	});
	gleich(ueberstimmt.join(" · "), "", "💣 keine spaetere Regel ueberstimmt einen Block");

	console.log("OK -- garetien-detailspalte-reihenfolge (" + n + " Zusicherungen)");
})().catch(function (fehler) { console.error(fehler); process.exit(1); });
