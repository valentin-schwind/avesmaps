// Was ein gueltiger SVG-Abzug erfuellen muss -- EINE Liste, benutzt vom Unit-Test (an einer
// Fixture) UND vom naechtlichen Workflow (an der echten, 8 MB grossen Datei).
//
// 🔴 ZWEI PRUEFLISTEN WAEREN EINE ZU VIEL. Stuende die Abnahme nur im Test, ginge ein
// kaputter Abzug live, weil der Test eine Fixture prueft und nicht das Erzeugnis; stuende sie
// nur im Workflow, faenden wir Fehler erst um 03:17 nachts. Also dieselbe Liste an beiden
// Stellen -- der Unterschied ist bloss, WAS man ihr reicht.
//
// ⚠️ Der Zeichenstrom wird STUECKWEISE geprueft, nie mit einem regulaeren Ausdruck ueber die
// ganze Datei: `docs/svg-export-semantik-uebergabe.md` sagt es selbst -- „Die Datei ist gross.
// Einmal parsen, nicht mehrfach mit regulaeren Ausdruecken ueber 10 MB laufen."
"use strict";

// Die Abnahmepunkte. Jeder bekommt den Kopf (die ersten Kilobyte) oder den ganzen Text; was
// er braucht, sagt `braucht`.
const PRUEFUNGEN = [
	{ name: "XML-Deklaration", braucht: "kopf",
		pruef: (k) => k.startsWith('<?xml version="1.0" encoding="UTF-8"?>') },
	{ name: "SVG-Namensraum", braucht: "kopf",
		pruef: (k) => k.includes('xmlns="http://www.w3.org/2000/svg"') },
	// 💣 Die GROESSE steht in width/height, der Zeichenraum bleibt IMMER 0…1024 im viewBox.
	// Wer stattdessen die Koordinaten multiplizierte, muesste jede Strichstaerke und jede
	// Schrift einzeln mitrechnen -- und ein Vergessener fiele erst im Druck auf.
	{ name: "viewBox 0 0 1024 1024", braucht: "kopf",
		pruef: (k) => k.includes('viewBox="0 0 1024 1024"') },
	{ name: "32768 x 32768", braucht: "kopf",
		pruef: (k) => k.includes('width="32768"') && k.includes('height="32768"') },
	{ name: "avm-Namensraum", braucht: "kopf",
		pruef: (k) => k.includes('xmlns:avm="https://avesmaps.de/ns/export/1"') },
	// 🔴 Vektor und Raster gelten nur zusammen, wenn beide dieselbe revision tragen. Die Zahlen
	// kommen aus den Endpunkten, nicht aus einer Uhr -- eine leere Fassung ist deshalb ein
	// Befund und keine Kleinigkeit.
	{ name: "avm:kartenfassung gesetzt", braucht: "kopf",
		pruef: (k) => /avm:kartenfassung="[0-9]+"/.test(k) && !/avm:kartenfassung="0"/.test(k) },
	{ name: "avm:landschaftsfassung gesetzt", braucht: "kopf",
		pruef: (k) => /avm:landschaftsfassung="[0-9]+"/.test(k) },
	{ name: "avm:exportiert gesetzt", braucht: "kopf",
		pruef: (k) => /avm:exportiert="\d{4}-\d{2}-\d{2}T/.test(k) },
	// 🔴 Keine Glaettung: die API liefert die Geometrie, wie sie in den Daten steht. Eine
	// gerundete Grenze verschoebe Land zwischen Reichen, und eine geglaettete Kueste waere
	// eine Aussage ueber die Welt, die niemand getroffen hat.
	{ name: 'avm:geglaettet="nein"', braucht: "kopf",
		pruef: (k) => k.includes('avm:geglaettet="nein"') },
	{ name: 'avm:flaechen_geglaettet="nein"', braucht: "kopf",
		pruef: (k) => k.includes('avm:flaechen_geglaettet="nein"') },
	{ name: "Lizenz reist mit", braucht: "kopf",
		pruef: (k) => k.includes("NOTICE.md") && k.includes("avesmaps.de") },
	{ name: "Vokabular im Kopf", braucht: "kopf",
		pruef: (k) => k.includes('<desc id="avm-vokabular">') },

	{ name: "Ebene Landschaften", braucht: "ganz", pruef: (t) => t.includes("layer-landschaften") },
	{ name: "Ebene Wege", braucht: "ganz", pruef: (t) => /id="layer-wege/.test(t) },
	{ name: "Ebene Orte", braucht: "ganz", pruef: (t) => /id="layer-orte/.test(t) },
	{ name: "Ebene Beschriftungen", braucht: "ganz", pruef: (t) => /id="layer-beschriftungen/.test(t) },

	{ name: "avm:kind=landschaft", braucht: "ganz", pruef: (t) => t.includes('avm:kind="landschaft"') },
	{ name: "avm:kind=weg", braucht: "ganz", pruef: (t) => t.includes('avm:kind="weg"') },
	{ name: "avm:kind=ort", braucht: "ganz", pruef: (t) => t.includes('avm:kind="ort"') },
	// „Gewaesser" ist keine eigene Ebene: Fluesse sind Wege mit feature_subtype Flussweg, Seen
	// und Meere sind Landschaftsflaechen. Eine eigene Ebene daraus zu machen hiesse, ein
	// zweites Mal zu entscheiden, was ein Fluss ist.
	{ name: "Gewaesser: Flusswege", braucht: "ganz", pruef: (t) => t.includes('avm:type="Flussweg"') },
	{ name: "Gewaesser: Seen oder Meere", braucht: "ganz",
		pruef: (t) => t.includes('avm:type="see"') || t.includes('avm:type="meer"') },
	{ name: "avm:id (stabile Kennung)", braucht: "ganz", pruef: (t) => /avm:id="[^"]+"/.test(t) },

	{ name: "sauber geschlossen", braucht: "ganz", pruef: (t) => t.trimEnd().endsWith("</svg>") },
];

/**
 * `text` darf der ganze Abzug sein oder -- fuer die Kopfpruefungen -- nur dessen Anfang.
 * Rueckgabe: {ok, befunde:[Namen der durchgefallenen Punkte], geprueft}
 */
function pruefeAbzug(text, nurKopf) {
	const ganz = String(text);
	const kopf = ganz.slice(0, 200000);
	const anwendbar = PRUEFUNGEN.filter((p) => !nurKopf || p.braucht === "kopf");
	const befunde = anwendbar
		.filter((p) => !p.pruef(p.braucht === "kopf" ? kopf : ganz))
		.map((p) => p.name);

	return { ok: befunde.length === 0, befunde: befunde, geprueft: anwendbar.length };
}

/**
 * Grobe Wohlgeformtheit ohne XML-Parser: jedes `<g` bekommt sein `</g>`, und es steht kein
 * unmaskiertes `&` im Text. Beides faellt in einer 8-MB-Datei sonst niemandem auf, macht sie
 * aber in Inkscape unlesbar.
 * ⚠️ Das ist KEINE XML-Validierung. Es ist die Naht, an der dieser Bauer schon einmal haette
 * reissen koennen (`nimm()` setzt Passmarken vor das letzte `</g>` einer Ebene).
 */
function pruefeStruktur(text) {
	const ganz = String(text);
	const auf = (ganz.match(/<g[\s>]/g) || []).length;
	const zu = (ganz.match(/<\/g>/g) || []).length;
	const befunde = [];
	if (auf !== zu) { befunde.push(`Gruppen unausgeglichen: ${auf} mal <g>, ${zu} mal </g>`); }
	// `&` ist nur als Entitaet erlaubt.
	const roheAmpersands = (ganz.match(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#x[0-9a-fA-F]+);)/g) || []).length;
	if (roheAmpersands > 0) { befunde.push(`${roheAmpersands} unmaskierte &`); }

	return { ok: befunde.length === 0, befunde: befunde };
}

module.exports = { PRUEFUNGEN: PRUEFUNGEN, pruefeAbzug: pruefeAbzug, pruefeStruktur: pruefeStruktur };
