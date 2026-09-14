/**
 * Der Kartenausschnitt für den Social-Media-Hub — die Entscheidungen hinter Rahmen und Aufnahme.
 *
 * 🔴 Die tragende Zusicherung steht in Teil 5: DIE BESCHRIFTUNGEN SIND IM BILD. Das ist der
 * Owner-Entscheid vom 26.08.2026 („aufziehbarer rahmen, mit beschriftungen") und zugleich der
 * einzige Unterschied zu tools/layer-tiles/capture.js, das für seine Icons genau umgekehrt eine
 * Allowlist ohne Beschriftungen führt. Wer hier auf eine Allowlist umbaut, verliert die Namen —
 * und zwar lautlos, weil ein Bild ohne Ortsnamen wie ein Bild aussieht.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const abzug = require(path.join(__dirname, "..", "karten-abzug.js"));

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

// ⚠️ Zeilenendenneutral und OHNE Kommentare: die Arbeitskopie trägt CRLF, das Deploy-Tor LF
// (AGENTS.md §9), und ein Quelltexttest, der Kommentare mitliest, schlägt an der Warnung an, die
// vor dem Muster warnt — der nächste Leser löscht dann den Kommentar statt den Fehler.
function lies(datei) {
	return fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
}
function ohneKommentare(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
		.replace(/<!--[\s\S]*?-->/g, "");
}

// ---- 1. Das Rechteck entsteht in jede Zugrichtung ---------------------------------------------
// 💣 Ohne Normalisierung liefert ein Zug nach links oben negative Breiten, und jede Prüfung danach
// rechnet mit Unsinn weiter — `istGrossGenug` sagt dann „zu klein" bei einem großen Rahmen.
{
	const runter = abzug.normalisiereRechteck(10, 20, 110, 220);
	pruefe(runter.x === 10 && runter.y === 20, "Zug nach rechts unten: Ursprung ist die Startecke");
	pruefe(runter.breite === 100 && runter.hoehe === 200, "Zug nach rechts unten: Maße");

	const hoch = abzug.normalisiereRechteck(110, 220, 10, 20);
	pruefe(hoch.x === 10 && hoch.y === 20, "Zug nach links oben: Ursprung wandert mit");
	pruefe(hoch.breite === 100 && hoch.hoehe === 200, "Zug nach links oben: gleiche Maße, positiv");

	const quer = abzug.normalisiereRechteck(110, 20, 10, 220);
	pruefe(quer.x === 10 && quer.y === 20 && quer.breite === 100 && quer.hoehe === 200,
		"Zug über Eck: ebenfalls positiv");
}

// ---- 2. Der Rahmen bleibt auf der Karte -------------------------------------------------------
// 💣 Er wird GEKAPPT, nicht verschoben: was außerhalb liegt, ist nicht gemalt und käme als
// Hintergrundfarbe ins Bild — ein grauer Streifen am Rand, den niemand bestellt hat.
{
	const raus = abzug.klemmeAufFlaeche({ x: 900, y: 500, breite: 300, hoehe: 300 }, 1000, 600);
	pruefe(raus.x === 900 && raus.y === 500, "Klemmen verschiebt den Ursprung nicht");
	pruefe(raus.breite === 100 && raus.hoehe === 100, "Klemmen kappt auf den Kartenrand");

	const negativ = abzug.klemmeAufFlaeche({ x: -50, y: -50, breite: 200, hoehe: 200 }, 1000, 600);
	pruefe(negativ.x === 0 && negativ.y === 0, "Negativer Ursprung landet auf 0");

	const drin = abzug.klemmeAufFlaeche({ x: 10, y: 10, breite: 100, hoehe: 100 }, 1000, 600);
	pruefe(drin.breite === 100 && drin.hoehe === 100, "Ein Rahmen mittendrin bleibt unangetastet");
}

// ---- 3. Ein Klick ist kein Rahmen -------------------------------------------------------------
{
	pruefe(abzug.istGrossGenug({ breite: 200, hoehe: 200 }) === true, "200 × 200 genügt");
	pruefe(abzug.istGrossGenug({ breite: 2, hoehe: 2 }) === false, "Ein Fehlgriff genügt nicht");
	pruefe(abzug.istGrossGenug({ breite: 400, hoehe: 10 }) === false,
		"Ein breiter Strich genügt nicht — BEIDE Kanten zählen");
	pruefe(abzug.istGrossGenug(null) === false, "Kein Rechteck genügt nicht");
	pruefe(abzug.istGrossGenug({ breite: abzug.MINDESTKANTE, hoehe: abzug.MINDESTKANTE }) === true,
		"Genau die Mindestkante genügt noch");
}

// ---- 4. Die Bildmaße --------------------------------------------------------------------------
// 💣 Der Deckel ist tragend: ein großer Ausschnitt auf einem 4K-Schirm mit doppelter Punktdichte
// wäre 7680 px breit und über dem Flächenlimit mancher Browser-Leinwände.
{
	const einfach = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 1, 2048);
	pruefe(einfach.breite === 400 && einfach.hoehe === 300, "Einfache Punktdichte: 1:1");

	const doppelt = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 2, 2048);
	pruefe(doppelt.breite === 800 && doppelt.hoehe === 600,
		"Doppelte Punktdichte hebt das Bild mit an");

	const dreifach = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 3, 2048);
	pruefe(dreifach.breite === 800, "Ein 3x-Schirm wird auf den Hausdeckel 2 begrenzt");

	const riesig = abzug.abzugMasse({ breite: 3000, hoehe: 1500 }, 2, 2048);
	pruefe(riesig.breite === 2048, "Der Breitendeckel greift");
	pruefe(riesig.hoehe === 1024, "Und das Seitenverhältnis überlebt ihn");

	const winzig = abzug.abzugMasse({ breite: 0.2, hoehe: 0.2 }, 1, 2048);
	pruefe(winzig.breite >= 1 && winzig.hoehe >= 1, "Nie 0 px — eine Leinwand mit 0 wirft");
}

// ---- 5. 🔴 Die Beschriftungen sind im Bild ----------------------------------------------------
// Der Owner-Entscheid vom 26.08.2026. Diese Zusicherung ist der Grund, warum hier eine DENYLIST
// steht und nicht die Allowlist aus tools/layer-tiles/capture.js.
{
	const INS_BILD = ["leaflet-labels-pane", "leaflet-regionLabels-pane", "leaflet-tile-pane",
		"leaflet-locationCanvas-pane", "leaflet-locations-pane", "leaflet-regions-pane",
		"leaflet-roads-pane", "leaflet-powerlines-pane", "leaflet-route-pane",
		"leaflet-mapDecorations-pane", "leaflet-ecosystem-pane"];
	INS_BILD.forEach(function (pane) {
		pruefe(abzug.paneGehoertInsBild(pane) === true, "Gehört ins Bild: " + pane);
	});

	// Bedienung dieses einen Editors, nicht Inhalt der Karte.
	const DRAUSSEN = ["leaflet-popup-pane", "leaflet-tooltip-pane", "leaflet-sharePin-pane",
		"leaflet-regionHover-pane", "leaflet-measurement-pane", "leaflet-measurementHandles-pane"];
	DRAUSSEN.forEach(function (pane) {
		pruefe(abzug.paneGehoertInsBild(pane) === false, "Bleibt draußen: " + pane);
	});

	// 🪤 UND DIE FALLE, IN DIE DIESER TEST BEIM SCHREIBEN FAST GELAUFEN WÄRE: eine Liste erfundener
	// Pane-Namen ist grün und prüft NICHTS — „gehört ins Bild" über einen Namen, den es gar nicht
	// gibt, ist immer wahr, weil die Denylist ihn nicht kennt. Genau das ist die Lehre aus den
	// 19 CSS-Regeln, die nach einer Umbenennung auf nichts mehr passten. Deshalb werden die Namen
	// oben gegen die WIRKLICHKEIT gehalten: gegen die `createPane`-Aufrufe des Projekts.
	// Leaflets Regel: createPane("labelsPane") erzeugt die Klasse `leaflet-labels-pane`.
	// ⚠️ Leaflets EIGENE Panes (tile, popup, tooltip, marker, overlay, shadow, map) stehen nicht in
	// unserem Code, sondern in der Bibliothek — und drei davon trägt die Denylist. Sie hier von Hand
	// hinzuschreiben hiesse, genau die Phantom-Liste anzulegen, die dieser Block verhindern soll;
	// die Bibliothek benutzt dasselbe `createPane("…")` und wird deshalb einfach mitgelesen.
	const echteNamen = new Set();
	["js/app/bootstrap.js", "js/third-party/leaflet.js"].concat(
		fs.readdirSync(path.join(wurzel, "js", "map-features"))
			.filter(function (n) { return n.endsWith(".js"); })
			.map(function (n) { return "js/map-features/" + n; })
	).forEach(function (datei) {
		let text;
		try { text = lies(datei); } catch (fehler) { return; }
		(text.match(/createPane\(\s*["'][A-Za-z]+["']/g) || []).forEach(function (treffer) {
			const roh = treffer.replace(/.*["']([A-Za-z]+)["']/, "$1");
			echteNamen.add("leaflet-" + roh.replace(/Pane$/, "") + "-pane");
		});
	});
	pruefe(echteNamen.size > 10, "Die Pane-Namen des Projekts wurden gefunden (" + echteNamen.size + ")");
	INS_BILD.concat(DRAUSSEN).forEach(function (pane) {
		pruefe(echteNamen.has(pane), "Diese Pane gibt es wirklich: " + pane);
	});

	// 💣 Der Behälter aller Panes. Ohne ihn in der Denylist wird jede Ebene ein zweites Mal gemalt —
	// bei halbdurchsichtigen Flächen sieht man das sofort, bei deckenden nie.
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-map-pane") === false,
		"Die Sammel-Pane bleibt draußen");

	// Leaflet schreibt mehrere Klassen an eine Pane — geprüft wird der ganze Klassenname.
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-popup-pane") === false,
		"Auch mit vorangestellter Grundklasse erkannt");
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-labels-pane") === true,
		"… und die Beschriftungen ebenso");
}

// ---- 6. Fremde Bildherkunft vergiftet die Leinwand --------------------------------------------
// 💣 Der Fehler kommt erst ganz am Ende, beim `toBlob` — wenn alles gemalt ist. Ein durchgelassenes
// fremdes Bild kostet also nicht das Bild, sondern die ganze Aufnahme.
{
	const heim = "https://avesmaps.de/index.html";
	pruefe(abzug.quelleIstEigen("data:image/png;base64,AAAA", heim) === true,
		"Ein data:-Bild ist immer unbedenklich");
	pruefe(abzug.quelleIstEigen("https://avesmaps.de/uploads/wappen/x.png", heim) === true,
		"Ein Wappen von uns ist eigen");
	pruefe(abzug.quelleIstEigen("/tiles/5/map_1_-1.webp", heim) === true,
		"Eine relative Kachel ist eigen");
	pruefe(abzug.quelleIstEigen("https://wiki-aventurica.de/bild.png", heim) === false,
		"Ein Wiki-Bild ist fremd");
	pruefe(abzug.quelleIstEigen("", heim) === false, "Ein leeres src gilt als fremd");
	pruefe(abzug.quelleIstEigen("nicht::eine::url", "auch keine url") === false,
		"Unlesbares fällt auf die sichere Seite");
}

// ---- 7. Was beim Ziehen unter dem Rahmen steht ------------------------------------------------
{
	pruefe(abzug.verhaeltnisPasst({ breite: 1000, hoehe: 1000 }) === true, "Quadrat passt");
	pruefe(abzug.verhaeltnisPasst({ breite: 800, hoehe: 1000 }) === true, "4:5 passt gerade noch");
	pruefe(abzug.verhaeltnisPasst({ breite: 700, hoehe: 1000 }) === false, "Hochkant fällt heraus");
	pruefe(abzug.verhaeltnisPasst({ breite: 2000, hoehe: 1000 }) === false, "Panorama fällt heraus");
	pruefe(abzug.verhaeltnisPasst({ breite: 100, hoehe: 0 }) === false, "Keine Division durch 0");

	// 💣 Die Zeile nennt die Maße des BILDES, nicht die des Rahmens: bei doppelter Punktdichte sind
	// das verschiedene Zahlen, und die interessante ist die, die hochgeladen wird.
	pruefe(abzug.masszeile({ breite: 400, hoehe: 300 }, 2).indexOf("800 × 600") === 0,
		"Die Maßzeile nennt die Bildmaße");
	pruefe(abzug.masszeile({ breite: 400, hoehe: 300 }, 2).indexOf("zugeschnitten") === -1,
		"4:3 passt und wird nicht als Zuschnitt angekündigt");
	pruefe(abzug.masszeile({ breite: 300, hoehe: 900 }, 1).indexOf("zugeschnitten") > 0,
		"Ein schmaler Hochkantrahmen kündigt den Zuschnitt an");
	pruefe(abzug.masszeile({ breite: 5, hoehe: 5 }, 1).indexOf("px") === -1,
		"Unter der Mindestkante steht keine Maßangabe, sondern die Aufforderung");
}

// ---- 8. Die Verdrahtung -----------------------------------------------------------------------
// ⚠️ „Die Datei ist eingebunden" ist erfüllt, auch wenn niemand sie ruft — deshalb wird BEIDES
// geprüft: die Ladereihenfolge UND der Aufruf.
{
	const index = ohneKommentare(lies("index.html"));
	const abzugTag = index.indexOf("js/ui/karten-abzug.js");
	const socialTag = index.indexOf("js/review/review-social.js");
	pruefe(abzugTag > 0, "index.html lädt js/ui/karten-abzug.js");
	pruefe(socialTag > 0 && abzugTag < socialTag,
		"… und zwar VOR review-social.js, das es benutzt");

	// 🔴 Der Knopf ist nicht mehr abgeschaltet. Bis 26.08.2026 stand er mit `disabled` und dem Titel
	// „Kommt spaeter" da — der Anlass dieser ganzen Arbeit.
	const knopf = index.match(/<button[^>]*id="social-map-shot"[^>]*>/);
	pruefe(!!knopf, "Der Knopf trägt die ID social-map-shot");
	pruefe(!!knopf && knopf[0].indexOf("disabled") === -1,
		"🔴 Der Knopf „Kartenausschnitt\" ist NICHT mehr abgeschaltet");

	// Das Video bleibt abgeschaltet — es ist laut Entwurf §11 Stufe 3, und dieser Umbau rührt es
	// nicht an. Ohne diese Zeile fiele es niemandem auf, wenn es versehentlich mit freigeschaltet
	// würde: ein Knopf, der nichts tut, sieht aus wie ein Knopf.
	const video = index.match(/<button[^>]*>[^<]*Video[^<]*<\/button>/);
	pruefe(!!video && video[0].indexOf("disabled") >= 0, "Das Video bleibt abgeschaltet");

	const social = ohneKommentare(lies("js/review/review-social.js"));
	pruefe(social.indexOf("avesmapsKartenAbzug") > 0,
		"review-social.js ruft das Bauteil wirklich auf");
	pruefe(social.indexOf("rahmenWaehlen") > 0 && social.indexOf("aufnehmen") > 0,
		"… und zwar beide Hälften: Rahmen wählen und aufnehmen");

	// 💣 Der Hub muss sich für das Ziehen WEGBLENDEN, nicht schließen: `closeHub`/`openHub` setzen
	// das Formular zurück, und ein halb geschriebener Beitrag wäre nach der Aufnahme weg.
	pruefe(social.indexOf("closeHub()") === -1 || social.indexOf("hidden = true") > 0,
		"Der Hub wird für die Aufnahme weggeblendet, nicht geschlossen");

	const css = lies("css/components/social-hub.css") + lies("css/components/karten-abzug.css");
	pruefe(css.indexOf(".kartenabzug-schicht") > 0, "Die Ziehschicht hat einen Stil");
	pruefe(css.indexOf(".kartenabzug-rahmen") > 0, "Der Rahmen hat einen Stil");

	// 🔴 AGENTS.md §12: keine hartkodierte Farbe, immer ein Token. Geprüft wird der Stil DIESES
	// Bauteils — ein `#rrggbb` darin wäre genau die Divergenz, die die Regel verhindert.
	const eigen = lies("css/components/karten-abzug.css");
	const hexe = (ohneKommentare(eigen).match(/#[0-9a-fA-F]{3,8}\b/g) || []);
	pruefe(hexe.length === 0, "Keine hartkodierte Farbe im Stil des Bauteils: " + hexe.join(" "));
}

// ---- 9. 💣 Das Leaflet-Transform reist nicht mit ins Bild ------------------------------------
// Falle (5) aus karten-abzug.js, gemessen 14.09.2026: Leaflet setzt an jedes Renderer-SVG ein
// Inline-`transform: translate3d(-160px, -110px, 0px)` (sein Polster) und dazu die passende
// viewBox. Der Klon nahm das Transform mit, das data:-Bild wandte es ein ZWEITES Mal an, und jede
// SVG-Ebene lag im Abzug um das Polster daneben — Greifenfurt 100 px unter der Reichsstraße.
// ⚠️ AUSGEFÜHRT, nicht gelesen: `svgZuBild` wird aus BEIDEN Dateien ausgeschnitten und gegen
// Attrappen gefahren; geprüft wird die data:-Adresse, die wirklich ins <img> geht. Ein Regex auf
// `style.transform = ""` wäre auch dann grün, wenn die Zeile am ORIGINAL stünde — und dann spränge
// die laufende Karte um das Polster.
{
	const vm = require("vm");

	// Ein Stil, der sich wie CSSStyleDeclaration verhält, soweit es hier zählt: `style.transform = ""`
	// und `removeProperty` löschen die Deklaration, und das style-Attribut folgt dem Objekt.
	function falscherStil(beiAenderung) {
		const deklarationen = new Map();
		function setze(name, wert) {
			if (wert === "" || wert === null || wert === undefined) deklarationen.delete(name);
			else deklarationen.set(name, String(wert));
			beiAenderung();
		}
		return {
			get cssText() {
				return Array.from(deklarationen, function (paar) { return paar[0] + ": " + paar[1] + ";"; }).join(" ");
			},
			set cssText(text) {
				deklarationen.clear();
				String(text).split(";").forEach(function (teil) {
					const i = teil.indexOf(":");
					if (i > 0 && teil.slice(i + 1).trim()) deklarationen.set(teil.slice(0, i).trim(), teil.slice(i + 1).trim());
				});
			},
			getPropertyValue: function (name) { return deklarationen.get(name) || ""; },
			setProperty: setze,
			removeProperty: function (name) { const alt = deklarationen.get(name) || ""; setze(name, ""); return alt; },
			get transform() { return deklarationen.get("transform") || ""; },
			set transform(wert) { setze("transform", wert); }
		};
	}

	function falschesElement(tag, attribute, kinder) {
		const attrs = new Map();
		const el = {
			tagName: tag,
			kinder: kinder || [],
			style: null,
			getAttribute: function (name) {
				if (!attrs.has(name)) return null;
				return name === "style" ? el.style.cssText : attrs.get(name);
			},
			setAttribute: function (name, wert) {
				if (name === "style") { attrs.set("style", ""); el.style.cssText = wert; }
				else { attrs.set(name, String(wert)); }
			},
			removeAttribute: function (name) {
				if (name === "style") el.style.cssText = "";
				attrs.delete(name);
			},
			attributNamen: function () { return Array.from(attrs.keys()); },
			cloneNode: function (tief) {
				const klon = falschesElement(tag, {}, tief ? el.kinder.map(function (k) { return k.cloneNode(true); }) : []);
				attrs.forEach(function (wert, name) { klon.setAttribute(name, el.getAttribute(name)); });
				return klon;
			},
			querySelectorAll: function () {
				const alle = [];
				(function lauf(knoten) {
					knoten.kinder.forEach(function (kind) { alle.push(kind); lauf(kind); });
				})(el);
				return alle;
			},
			get viewBox() {
				const teile = String(attrs.get("viewBox") || "").split(/\s+/).map(Number);
				return teile.length === 4 ? { baseVal: { x: teile[0], y: teile[1], width: teile[2], height: teile[3] } } : null;
			}
		};
		el.style = falscherStil(function () { if (!attrs.has("style")) attrs.set("style", ""); });
		Object.keys(attribute).forEach(function (name) { el.setAttribute(name, attribute[name]); });
		return el;
	}

	function serialisiere(el) {
		const attribute = el.attributNamen().map(function (name) {
			return " " + name + "=\"" + el.getAttribute(name) + "\"";
		}).join("");
		return "<" + el.tagName + attribute + ">" + el.kinder.map(serialisiere).join("") + "</" + el.tagName + ">";
	}

	// Der GANZE Rumpf, per Klammerzählung — nie ein festes Zeichenfenster, das sonst die Länge der
	// Kommentare misst. MALSTIL kommt mit, weil `svgZuBild` es aus dem Modulbereich liest.
	function svgZuBildAus(datei) {
		const text = lies(datei);
		const malstil = text.match(/var MALSTIL = \[[\s\S]*?\];/);
		const kopf = text.indexOf("function svgZuBild(");
		if (!malstil || kopf < 0) return null;
		const auf = text.indexOf("{", text.indexOf(")", kopf));
		let tiefe = 0;
		let ende = -1;
		for (let i = auf; i < text.length; i++) {
			if (text[i] === "{") tiefe++;
			else if (text[i] === "}" && --tiefe === 0) { ende = i + 1; break; }
		}
		if (ende < 0) return null;
		const bilder = [];
		const kontext = {
			Image: function () {
				const bild = this;
				bilder.push(bild);
				Object.defineProperty(bild, "src", {
					get: function () { return bild.gesetzteQuelle; },
					set: function (wert) { bild.gesetzteQuelle = wert; if (typeof bild.onload === "function") bild.onload(); }
				});
			},
			XMLSerializer: function () { this.serializeToString = serialisiere; },
			getComputedStyle: function (el) {
				return { getPropertyValue: function (name) { return el.tagName === "path" && name === "fill-opacity" ? "0.72" : ""; } };
			}
		};
		vm.runInNewContext(malstil[0] + "\n" + text.slice(kopf, ende), kontext);
		return { svgZuBild: kontext.svgZuBild, bilder: bilder };
	}

	const PRAEFIX = "data:image/svg+xml;charset=utf-8,";
	["js/ui/karten-abzug.js", "tools/layer-tiles/capture.js"].forEach(function (datei) {
		const lauf = svgZuBildAus(datei);
		pruefe(!!lauf && typeof lauf.svgZuBild === "function", datei + ": svgZuBild ausgeschnitten");
		if (!lauf || typeof lauf.svgZuBild !== "function") return;

		// So legt Leaflet ein Renderer-SVG an (gemessen bei 1600 × 1100, Polster 10 %).
		const pfad = falschesElement("path", { d: "M0 0L10 10", "fill-opacity": "0.2" }, []);
		const original = falschesElement("svg", {
			"pointer-events": "none", width: "1920", height: "1320", viewBox: "-160 -110 1920 1320",
			style: "transform: translate3d(-160px, -110px, 0px);"
		}, [pfad]);
		lauf.svgZuBild(original, 1920, 1320);

		const bild = lauf.bilder[lauf.bilder.length - 1];
		const quelle = bild && typeof bild.src === "string" && bild.src.indexOf(PRAEFIX) === 0
			? decodeURIComponent(bild.src.slice(PRAEFIX.length)) : "";
		pruefe(quelle !== "", datei + ": das Bild bekam eine data:-Adresse (sonst lief svgZuBild in sein catch)");
		pruefe(quelle.indexOf("translate") === -1,
			datei + ": 💣 das Leaflet-Transform steht NICHT im Bild — sonst liegt jede SVG-Ebene um das Polster daneben");
		pruefe(quelle.indexOf("viewBox=\"-160 -110 1920 1320\"") >= 0,
			datei + ": die viewBox bleibt — sie ist die andere Hälfte derselben Rechnung");
		pruefe(quelle.indexOf("width=\"1920\"") >= 0 && quelle.indexOf("height=\"1320\"") >= 0,
			datei + ": der Klon trägt die Bildmaße");
		pruefe(quelle.indexOf("fill-opacity=\"0.72\"") >= 0,
			datei + ": Falle (2) wirkt weiter — der berechnete Malstil steht im Klon");
		pruefe(original.style.transform === "translate3d(-160px, -110px, 0px)",
			datei + ": 🔴 das ORIGINAL behält sein Transform — geleert wird nur am Klon, sonst springt die laufende Karte");
	});
}

if (fehler > 0) {
	console.error(fehler + " Fehler");
	process.exit(1);
}
console.log("karten-abzug: alle Prüfungen bestanden");
