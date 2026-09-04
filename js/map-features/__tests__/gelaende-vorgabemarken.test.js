"use strict";

/**
 * Vorgabemarken, Rücksetz-Knöpfe und die gemerkte Vorlage.
 *
 * 🔴 Owner 04.09.2026: „Presets sollen gespeichert werden. Wenn sie verändere soll hinter den button
 * reset-buttons erscheinen … die default werte sollen über dreicke auf den slidern sichtbar sein
 * (wie bei den zoombändern) … unten die statusleiste soll mir immer anzeigen, wenn das höhenfeld
 * aktualisiert wurde."
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
const hydro = require(path.join(WURZEL, "js/map-features/map-features-ecosystem-hydrologie.js"));

let gehalten = 0;
const pruefe = (name, fn) => {
	try {
		fn();
		gehalten++;
		console.log("  ok  " + name);
	} catch (fehler) {
		console.error("  FEHLER  " + name + "\n    " + fehler.message);
		process.exitCode = 1;
	}
};

const markup = lies("index.html");
const properties = lies("js/map-features/map-features-ecosystem-properties.js");
const css = lies("css/features/ecosystem-layer.css");

// Die zwölf Regler, die eine Marke und einen Knopf tragen müssen.
const ELEMENTE = ["grain", "avgheight", "bergform", "rauschen", "sattel",
	"talbreite", "einschnitt", "erosion", "hypsometrie", "plateau", "levels"];

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   1. MARKUP
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("jeder Regler hat eine Vorgabemarke und einen Rücksetz-Knopf", () => {
	for (const el of ELEMENTE) {
		assert.ok(markup.includes('id="ecosystem-properties-' + el + '-mark"'),
			"die Vorgabemarke fehlt bei " + el);
		assert.ok(markup.includes('id="ecosystem-properties-' + el + '-reset"'),
			"der Rücksetz-Knopf fehlt bei " + el);
	}
});

pruefe("Marke und Knopf starten VERSTECKT", () => {
	// 🔴 Ohne gemerkte Vorlage gibt es keine Vorgabe -- eine Marke ohne Bezug behauptet einen Wert,
	// den niemand gesetzt hat, und ein Knopf ohne Vorgabe hätte nichts zum Zurücksetzen.
	for (const el of ELEMENTE) {
		for (const teil of ["-mark", "-reset"]) {
			const i = markup.indexOf('id="ecosystem-properties-' + el + teil + '"');
			const tagEnde = markup.indexOf(">", i);
			assert.ok(markup.slice(i, tagEnde).includes("hidden"),
				el + teil + " ist nicht versteckt");
		}
	}
});

pruefe("die Marke liegt IN der Schieber-Hülle, nicht daneben", () => {
	// 💣 Ein `<input type=range>` kann kein Kind haben -- die Marke braucht eine Hülle, sonst kann
	// sie nicht relativ zum Schieber positioniert werden und sitzt am Zeilenrand.
	for (const el of ELEMENTE) {
		const i = markup.indexOf('id="ecosystem-properties-' + el + '"');
		const huelle = markup.lastIndexOf("sliderwrap", i);
		const marke = markup.indexOf('id="ecosystem-properties-' + el + '-mark"', i);
		const huelleEnde = markup.indexOf("</span></span>", i);
		assert.ok(huelle > 0 && huelle < i, "der Schieber " + el + " hat keine Hülle");
		assert.ok(marke > i && marke < huelleEnde + 20,
			"die Marke von " + el + " liegt ausserhalb der Hülle");
	}
});

pruefe("die Zeile hat VIER Spalten, und die ↺-Spalte bleibt stehen", () => {
	// 💣 Die Spalte muss auch dann Platz belegen, wenn der Knopf `hidden` ist -- sonst springt die
	// ganze Zeile um seine Breite, sobald man einen Regler anfasst. Genau dieses Springen hat
	// 2026-07-29 schon einmal eine Spalte gekostet.
	const regel = css.match(/\.ecosystem-properties-dialog__terrainrow \{[^}]*\}/);
	assert.ok(regel, "die Zeilenregel fehlt");
	const spalten = /grid-template-columns:\s*([^;]+);/.exec(regel[0]);
	assert.ok(spalten, "die Zeile hat kein Spaltenraster");
	// 🪤 GEZAEHLT WIRD AUSSERHALB DER KLAMMERN: `minmax(0, 1fr)` traegt selbst ein Leerzeichen, ein
	// naives `split(/\s+/)` zaehlt daraus zwei Spalten. Beim Bau einmal passiert -- der Test meldete
	// fuenf, wo vier stehen.
	const ohneKlammern = spalten[1].replace(/\([^)]*\)/g, "()");
	assert.strictEqual(ohneKlammern.trim().split(/\s+/).length, 4,
		"die Zeile hat nicht vier Spalten: " + spalten[1].trim());
	// ⚠️ Und die Zahlenspalte ist breiter als die alten 5em -- „3200" passte nicht (Owner am Bild).
	assert.ok(/5\.6em|6em|5\.5em/.test(spalten[1]),
		"die Zahlenspalte ist nicht breiter geworden: " + spalten[1].trim());
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   2. DIE RECHNUNG -- ausgeführt, nicht gelesen
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("Marke und Knopf hängen an DERSELBEN Frage", () => {
	// 🔴 „Weicht der Regler von der Vorlage ab?" wird EINMAL beantwortet (`terrainAbweichung`), und
	// beide lesen dieselbe Antwort. Zwei getrennte Rechnungen liefen beim nächsten Umbau
	// auseinander, und dann stünde ein Knopf neben einer Marke, die woanders sitzt.
	const i = properties.indexOf("function syncTerrainVorgabe(");
	assert.ok(i > 0, "syncTerrainVorgabe fehlt");
	const rumpf = properties.slice(i, i + 1400);
	assert.ok(rumpf.includes("terrainAbweichung("),
		"die Marke rechnet die Abweichung selbst, statt die gemeinsame Antwort zu nehmen");
	assert.ok(rumpf.includes("knopf.hidden") && rumpf.includes("marke.hidden"),
		"nicht beide werden aus derselben Antwort gesetzt");
	// 💣 Die Marke sitzt anteilig zwischen min und max des REGLERS, nicht auf einer festen Skala:
	// „Einschnitt" läuft bis 3000, „Sattel" bis 1.
	assert.ok(rumpf.includes("regler.min") && rumpf.includes("regler.max"),
		"die Marke rechnet ohne die Grenzen ihres Reglers -- bei „Einschnitt\" (bis 3000) säße sie "
		+ "dann an derselben Stelle wie bei „Sattel\" (bis 1)");
});

pruefe("die Vorgabe kommt aus der GEMERKTEN Vorlage, nicht aus den Modulvorgaben", () => {
	// 🔴 `terrainDefaults` liefert die Vorgaben des MODULS -- das ist etwas anderes als die Werte der
	// Vorlage, die ein Editor zuletzt angewandt hat. Ein ↺ muss dorthin zurück, wo der Wert HERKAM.
	const i = properties.indexOf("function vorlagenWerte(");
	assert.ok(i > 0, "vorlagenWerte fehlt");
	const rumpf = properties.slice(i, i + 900);
	assert.ok(rumpf.includes("terrain_preset_morph") && rumpf.includes("terrain_preset_hoehe"),
		"die Vorgabe liest die gemerkten Vorlagen nicht");
	assert.ok(rumpf.includes("VORLAGEN_FELDER"),
		"die Schlüssel werden nicht übersetzt -- die Vorlage spricht `plateau`, das Feld heisst "
		+ "`terrain_plateau`");
});

pruefe("beide Vorlagen-Schlüssel reisen beim Speichern mit -- und beim Zurücksetzen als leer", () => {
	// 💣 Ohne das behielte eine auf Automatik zurückgesetzte Fläche ihren Vorlagennamen -- und damit
	// ↺-Knöpfe, die auf Werte zeigen, die sie nicht mehr hat.
	const i = properties.indexOf("async function saveTerrainSettings(");
	assert.ok(i > 0, "saveTerrainSettings fehlt");
	const rumpf = properties.slice(i, i + 1200);
	assert.ok(rumpf.includes("payload.terrain_preset_morph") && rumpf.includes("payload.terrain_preset_hoehe"),
		"die gemerkten Vorlagen reisen nicht mit");
	assert.ok(/reset \? "" :/.test(rumpf),
		"beim Zurücksetzen wird die Vorlage nicht geleert");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   3. DIE STATUSLEISTE
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("jeder Anstrich meldet sich -- aber überschreibt keine bleibende Meldung", () => {
	// 🔴 Owner: „unten die statusleiste soll mir immer anzeigen, wenn das höhenfeld aktualisiert
	// wurde."
	// 💣 UND NUR, WENN KEINE ANDERE MELDUNG LÄUFT. Der Zeichner malt auch bei jedem Zoom- und
	// Pan-Schritt; „Gelände gespeichert" oder eine Fehlermeldung wäre sonst nach der nächsten
	// Kartenbewegung weg, bevor sie jemand gelesen hat.
	const i = properties.indexOf("hoehenskalaAbo = window.AvesmapsEcosystemHeightRender.onPaint(");
	assert.ok(i > 0, "das Anstrich-Abo fehlt");
	const rumpf = properties.slice(i, i + 1600);
	assert.ok(rumpf.includes("Höhenfeld aktualisiert"), "der Anstrich wird nicht gemeldet");
	assert.ok(rumpf.includes("terrainStatusFrist > Date.now()"),
		"die Meldung überschreibt bleibende Meldungen -- es fehlt die Frist");
	assert.ok(rumpf.includes("fluechtig: true"),
		"die Anstrich-Meldung setzt selbst eine Frist und sperrt sich damit aus");

	// Und ein Fehler hält länger als ein Erfolg.
	const j = properties.indexOf("function setTerrainStatus(");
	const status = properties.slice(j, j + 900);
	assert.ok(/isError \?\s*TERRAIN_STATUS_FRIST_FEHLER_MS\s*:\s*TERRAIN_STATUS_FRIST_MS/.test(status),
		"ein Fehler hält nicht länger als eine Erfolgsmeldung");
});

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   4. DIE VORLAGE WIRD GEMERKT
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

pruefe("das Anwenden einer Vorlage merkt ihren Schlüssel", () => {
	const i = properties.indexOf("function wendeVorlageAn(");
	assert.ok(i > 0, "wendeVorlageAn fehlt");
	const rumpf = properties.slice(i, i + 2000);
	assert.ok(rumpf.includes("terrain_preset_hoehe") && rumpf.includes("terrain_preset_morph"),
		"die angewandte Vorlage wird nicht gemerkt");
	// 🔴 WELCHES der beiden Felder, entscheidet die LISTE -- nicht der Schlüssel. Eine Vorlage
	// „hochgebirge" in der Morphologie-Liste gäbe es sonst nie, aber die Weiche wäre geraten.
	assert.ok(rumpf.includes("ECOSYSTEM_HYDRO_HOEHENSTUFEN"),
		"die Weiche zwischen den zwei Feldern liest nicht die Liste");
});

pruefe("der Titel der Falte nennt die gemerkte Vorlage", () => {
	const i = properties.indexOf('propertiesElement("foldtitle")');
	assert.ok(i > 0, "der Faltentitel wird nicht gesetzt");
	const rumpf = properties.slice(i - 200, i + 900);
	assert.ok(rumpf.includes("Letztes Preset"), "der Titel nennt die Vorlage nicht");
	assert.ok(rumpf.includes("vorlagenName("), "der Name wird nicht aus der Tabelle geholt");
	// ⚠️ Ohne Vorlage bleibt der Titel schlicht -- „(Letztes Preset: )" wäre ein leeres Versprechen.
	assert.ok(/beide\s*\?/.test(rumpf), "ohne gemerkte Vorlage steht trotzdem eine Klammer da");
});

pruefe("die Skala traegt einen Strich an der Durchschnittshoehe", () => {
	// 🔴 Owner 04.09.2026, mit Mockup: „die durchschnittshöhe muss jetzt unten in der höhenskala
	// ausreichen (schön wär ein vertikaler strich mit markierung)". Die Zahl darunter sagt es genau,
	// der Strich zeigt, WO sie zwischen den Gipfeln liegt.
	const i = properties.indexOf("scalemean");
	assert.ok(i > 0, "der Strich wird nicht gezeichnet");
	const rumpf = properties.slice(i - 900, i + 700);
	// 💣 In DIESELBE Leiste wie die Gipfelmarken -- sie ist `position: relative` und schon vermessen.
	// Eine eigene Huelle waere eine zweite Stelle, an der eine Prozentzahl gerechnet wird.
	assert.ok(rumpf.includes("bar.appendChild(strich)"),
		"der Strich haengt nicht in der Skalenleiste");
	// 💣 GEKLEMMT: ein halb gerechnetes Feld waehrend eines Laufs kann ueber dem Weisspunkt liegen,
	// und ein Strich ausserhalb der Leiste haengt im Nichts.
	assert.ok(rumpf.includes("Math.max(0, Math.min(1, mittel / weisspunkt))"),
		"die Position ist nicht auf die Leiste geklemmt");

	// Und der Stil: durch den Balken hindurch, nicht nur darueber oder darauf.
	const regel = css.match(/\.ecosystem-properties-dialog__scalemean \{[^}]*\}/);
	assert.ok(regel, "die Stilregel fehlt");
	assert.ok(/top:\s*-/.test(regel[0]) && /bottom:\s*-/.test(regel[0]),
		"der Strich reicht nicht ueber den Balken hinaus -- ueber ihm allein waere er zwischen den "
		+ "Gipfelmarken kaum auszumachen, auf ihm allein verschwaende er im hellen Drittel");
	assert.ok(/pointer-events:\s*none/.test(regel[0]),
		"der Strich faengt Zeigerereignisse ab -- die Marken tragen Tooltips");
});

if (!process.exitCode) {
	console.log("\n" + gehalten + " Zusicherungen gehalten.");
}
