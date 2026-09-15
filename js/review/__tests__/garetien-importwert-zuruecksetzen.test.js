// Owner 15.09.2026: „schön wärs außerdem, wenn man Name, Form, Art je auf die werte des Imports
// zurücksetzen könnte. Wir haben das Prinzip, dass der ursprüngliche Wert über dem label steht".
//
// 🔴 DIE BAUFORM DES WIKI-OVERRIDES: der Wert des Imports steht DURCHGESTRICHEN über der Zeile, daneben
// ein ↺ (`.wiki-alt`, `.dt-old`, `.dt-reset` aus css/components/wiki-override.css). Nur wo der Wert
// wirklich abweicht, nur auf der Stage, nur an einem bedienbaren Feld.
//
// Ausführen: node js/review/__tests__/garetien-importwert-zuruecksetzen.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }

function objekt(key, name) {
	return {
		key: key, stand: "offen", urteil: "neu", name: name, typ: "Wald",
		ziel: "region", subtyp: "wald", kind: "vegetation",
		geometrie: [[0, 0], [0, 10], [10, 10], [10, 0]],
		items: [{ id: 11, change_type: "new", anlass: "", felder: ["quelle"] }],
	};
}

api.garetienNameWahlVergessen();
api.garetienZielWahlVergessen();
api.avesmapsGaretienStageLeeren();

const o = objekt("ggp:Waelder:Wald:Garetien:Dunkelforst!Dunkelforst", "Dunkelforst");

// --- 1. Auf „Offen" gibt es nichts zurückzusetzen ------------------------------------------------
pruefe(!api.garetienIdentitaetMarkup(o).includes("data-gi-zuruecksetzen"), "auf „Offen\" kein ↺");

// --- 2. Auf der Stage, unverändert: kein ↺ ---------------------------------------------------------
api.avesmapsGaretienStageHinzufuegen([o]);
let mk = api.garetienIdentitaetMarkup(o);
pruefe(mk.includes('data-gi-feld="einfuegeName"') && mk.includes('data-gi-feld="zielForm"'),
	"Zeuge: die drei Felder stehen da -- sonst belegt „kein ↺\" nichts: " + mk);
pruefe(!mk.includes("data-gi-zuruecksetzen"), "⚠️ unverändert steht kein ↺ da");

// --- 3. Der Name -------------------------------------------------------------------------------------
api.garetienNameWahlSetzen(o, "Dunkler Forst");
mk = api.garetienIdentitaetMarkup(o);
pruefe(mk.includes('<span class="dt-old" title="Wert des Imports">Dunkelforst</span>'),
	"der Name des Imports steht durchgestrichen da: " + mk);
pruefe(mk.includes('data-gi-zuruecksetzen="name"'), "…mit seinem ↺");
pruefe(mk.indexOf('data-gi-zuruecksetzen="name"') < mk.indexOf('data-gi-feld="einfuegeName"'),
	"🔴 ÜBER der Zeile, nicht dahinter (Owner: „der ursprüngliche Wert über dem label\")");
pruefe(!mk.includes('data-gi-zuruecksetzen="form"'), "die Form ist unverändert und trägt keins");
pruefe(api.garetienZuruecksetzen(o, "name") === true, "das ↺ des Namens greift");
pruefe(api.garetienNameWahlZu(o) === "", "…und nimmt die Handeingabe zurück");
pruefe(!("name" in (api.garetienEingabenFuerServer(o) || {})), "…es reist kein Handname mehr mit");
pruefe(!api.garetienIdentitaetMarkup(o).includes('data-gi-zuruecksetzen="name"'), "danach steht kein ↺ mehr da");

// --- 4. Die Form ---------------------------------------------------------------------------------------
const wahl = api.garetienZielWahlZu(o);
wahl.ziel = "label";
wahl.subtyp = "berggipfel";
wahl.kind = "";
mk = api.garetienIdentitaetMarkup(o);
pruefe(mk.includes('<span class="dt-old" title="Wert des Imports">Fläche</span>'),
	"die Form des Imports steht als Beschriftung da, nicht als Schlüssel: " + mk);
pruefe(mk.includes('data-gi-zuruecksetzen="form"'), "…mit ihrem ↺");
pruefe(!mk.includes('data-gi-zuruecksetzen="art"'),
	"⚠️ nach einem Formwechsel trägt die Art KEIN eigenes ↺ -- das der Form nimmt beides zurück");
pruefe(mk.indexOf('data-gi-zuruecksetzen="form"') < mk.indexOf('data-gi-feld="zielForm"'), "über dem Feld");
pruefe(api.garetienZuruecksetzen(o, "form") === true, "das ↺ der Form greift");
pruefe(api.garetienZielWahlZu(o).ziel === "region" && api.garetienZielWahlZu(o).subtyp === "wald",
	"…und stellt Form UND Art des Imports wieder her: " + JSON.stringify(api.garetienZielWahlZu(o)));
pruefe(!api.garetienIdentitaetMarkup(o).includes("data-gi-zuruecksetzen"), "danach kein ↺ mehr");

// --- 5. Die Art ------------------------------------------------------------------------------------------
api.garetienZielWahlZu(o).subtyp = "see";
mk = api.garetienIdentitaetMarkup(o);
pruefe(mk.includes('data-gi-zuruecksetzen="art"'), "eine geänderte Art trägt ihr ↺: " + mk);
pruefe(!mk.includes('data-gi-zuruecksetzen="form"'), "die Form ist gleich und trägt keins");
pruefe(mk.includes('<span class="dt-old" title="Wert des Imports">wald</span>'),
	"der Wert des Imports steht da (ohne Vokabular fällt die Beschriftung auf den Schlüssel zurück)");
pruefe(api.garetienZuruecksetzen(o, "art") === true && api.garetienZielWahlZu(o).subtyp === "wald",
	"das ↺ der Art stellt sie wieder her");

// --- 6. Gesperrt, unbekannt, nicht auf der Stage ------------------------------------------------------------
api.garetienZielWahlZu(o).subtyp = "see";
pruefe(!api.garetienZielWahlMarkup(o, true, "").includes("data-gi-zuruecksetzen"),
	"an einem gesperrten Feld gibt es nichts zurückzunehmen");
pruefe(!api.garetienZielWahlMarkup(o, false, "Keine Form nötig").includes("data-gi-zuruecksetzen"),
	"…und an einem abgeblendeten ebenso wenig");
pruefe(api.garetienImportwertZeile("groesse", "12", true, false) === "", "ein unbekanntes Feld baut keinen Knopf");
pruefe(api.garetienZuruecksetzen(o, "groesse") === false, "…und setzt nichts zurück");
api.garetienZielWahlZu(o).subtyp = "wald";
const draussen = objekt("ggp:Waelder:Wald:Garetien:Hellforst!Hellforst", "Hellforst");
pruefe(api.garetienZuruecksetzen(draussen, "name") === false, "🔴 nicht auf der Stage: nichts zurückzusetzen");

// --- 7. Der Klick: über die Einzelansicht, vor dem Feld-Knopf ---------------------------------------------------
api.garetienNameWahlSetzen(o, "Dunkler Forst");
try { api.garetienDetailWaehlen(o.key, [o]); } catch (e) { /* das Zeichnen braucht mehr DOM */ }
pruefe(api.garetienZuruecksetzenKlick("name", [o]) === true, "der Klick findet das Objekt der Einzelansicht");
pruefe(api.garetienNameWahlZu(o) === "", "…und setzt zurück");

const quelle = fs.readFileSync(path.join(__dirname, "..", "review-garetien-importer.js"), "utf8")
	.replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const posZurueck = quelle.indexOf('closest("button[data-gi-zuruecksetzen]")');
const posFeld = quelle.indexOf('closest("button[data-gi-feld]")');
pruefe(posZurueck !== -1 && posFeld !== -1, "beide Knopf-Weichen stehen im Klick-Zuhörer");
pruefe(posZurueck < posFeld, "💣 das ↺ wird VOR dem Feld-Knopf erkannt -- beide sind `<button>`");

// --- 8. Die Bauteile erreichen die App ----------------------------------------------------------------------------
const wurzel = path.join(__dirname, "..", "..", "..");
const override = fs.readFileSync(path.join(wurzel, "css", "components", "wiki-override.css"), "utf8");
pruefe(/\.dt-old\s*\{/.test(override) && /\.dt-reset\s*\{/.test(override) && /\.wiki-alt\s*\{/.test(override),
	"die drei Klassen sind im geteilten Blatt definiert");
const styles = fs.readFileSync(path.join(wurzel, "css", "styles.css"), "utf8");
pruefe(styles.includes("components/wiki-override.css"), "🔴 …und css/styles.css bindet es in die App ein");

api.garetienNameWahlVergessen();
api.garetienZielWahlVergessen();
api.avesmapsGaretienStageLeeren();
console.log("OK -- garetien-importwert-zuruecksetzen: " + n + " Zusicherungen");
