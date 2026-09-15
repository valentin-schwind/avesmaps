// Owner 15.09.2026: „"Dorf Tannweiler" soll bei uns "Tannweiler" heißen" -- und Ruinen bekommen das Häkchen
// automatisch („wenns kein "tag" gibt, das "Ruine" passt auch!"). Auf die drei Fragen der Liste: „X in Y"
// wird „X (Y)" („guter vorschlag"), Burgruinen wie in der Liste, übernommene Objekte benennen die Editoren
// von Hand um.
//
// 🔴 EIN VORSCHLAG, KEINE ENTSCHEIDUNG: der Name aus Garetien steht durchgestrichen über dem Feld, ↺ holt ihn.
//
// Ausführen: node js/review/__tests__/garetien-namensvorschlag.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
let n = 0;
function gleich(ist, soll, was) { n++; assert.strictEqual(ist, soll, was + " -- ist: " + JSON.stringify(ist)); }
function pruefe(b, was) { n++; assert.ok(b, was); }

// --- 1. Die Regel -----------------------------------------------------------------------------------------------
[
	["Dorf Tannweiler", "Tannweiler", false],
	["Markt Allenstein", "Allenstein", false],
	["Stadt Luring", "Luring", false],
	["Weiler Apfelhain", "Apfelhain", false],
	["Reichsstadt Greifenfurt", "Greifenfurt", false],
	["Königsstadt Puleth", "Puleth", false],
	["Kaiserstadt Gareth", "Gareth", false],
	["Streudorf Kelsenburg", "Kelsenburg", false],
	["Dorf Ährenfeld in Ehrenfeldt", "Ährenfeld (Ehrenfeldt)", false],
	["Markt Ährenfeld in Ochsenblut", "Ährenfeld (Ochsenblut)", false],
	["Dorf Finsterwald in Hexenhain", "Finsterwald (Hexenhain)", false],
	["Stadt Schmalfurt an der Ange", "Schmalfurt an der Ange", false],
	["Ruine Mühlenburg", "Mühlenburg", true],
	["Ruine Cellas Spukschlösschen", "Cellas Spukschlösschen", true],
	["Burgruine Rond", "Burg Rond", true],
	["Klosterruine Blauendorn", "Kloster Blauendorn", true],
	["Dorfruine Salzbergen", "Salzbergen", true],
].forEach(function (fall) {
	const v = api.garetienNameVorschlag(fall[0]);
	gleich(v.name, fall[1], "Vorschlag für „" + fall[0] + "“");
	gleich(v.ruine, fall[2], "Ruine für „" + fall[0] + "“");
});

// 🔴 Was BLEIBT: Bauwerk-Wörter, auch unbekannte (die Liste nennt nur, was fällt), und „in" ohne Siedlungswort.
[
	"Burg Boronia", "Festung Wehrheim", "Gut Tannenhof", "Kloster Arras de Mott", "Pfalz Gareth",
	"Reichsfeste Hirschfurt", "Schänke Zum Krug", "Gasthaus Sonne", "Tempel in Gareth", "Silkwiesen",
	"Dorf", "Stadt-Gareth", "Dorfwiese Hain", "",
].forEach(function (name) {
	const v = api.garetienNameVorschlag(name);
	gleich(v.name, name, "„" + name + "“ bleibt stehen");
	gleich(v.ruine, false, "„" + name + "“ ist keine Ruine");
});
gleich(api.garetienNameVorschlag(null).name, "", "kein Name bleibt kein Name");

// --- 2. Das Namensfeld zeigt den Vorschlag, der Garetien-Name steht darüber ---------------------------------------
function objekt(key, name, subtyp) {
	return {
		key: key, stand: "offen", urteil: "neu", name: name, typ: "Dorf",
		ziel: "location", subtyp: subtyp || "dorf", kind: "",
		items: [{ id: 21, change_type: "new", anlass: "", felder: ["quelle"] }],
	};
}
api.garetienNameWahlVergessen();
api.garetienZielWahlVergessen();
api.avesmapsGaretienStageLeeren();

const dorf = objekt("ggp:Siedlungen:Dorf:Garetien:Tannweiler", "Dorf Tannweiler");
api.avesmapsGaretienStageHinzufuegen([dorf]);
gleich(api.garetienNameFuerImport(dorf), "Tannweiler", "die Vorgabe des Feldes ist der Vorschlag");
gleich(api.garetienNameImportwert(dorf), "Dorf Tannweiler", "der Importwert bleibt der Name aus Garetien");
let mk = api.garetienIdentitaetMarkup(dorf);
pruefe(mk.includes('data-gi-feld="einfuegeName"') && mk.includes('value="Tannweiler"'),
	"im Feld steht der Vorschlag: " + mk);
pruefe(mk.includes('<span class="dt-old" title="Wert des Imports">Dorf Tannweiler</span>')
	&& mk.includes('data-gi-zuruecksetzen="name"'),
	"🔴 der Name aus Garetien steht durchgestrichen darüber, mit ↺: " + mk);
gleich(api.garetienNameWahlZu(dorf), "", "💣 der Vorschlag landet NICHT im Namensspeicher");
gleich((api.garetienEingabenFuerServer(dorf) || {}).name, "Tannweiler",
	"🔴 …reist aber an den Server -- sonst legte der Import „Dorf Tannweiler“ an");
gleich(api.garetienEingabenZustandZu(dorf).isRuined, false, "ein Dorf ist keine Ruine");

// --- 3. ↺ holt den Garetien-Namen, und DER reist dann ------------------------------------------------------------
pruefe(api.garetienZuruecksetzen(dorf, "name") === true, "das ↺ greift");
gleich(api.garetienNameFuerImport(dorf), "Dorf Tannweiler", "nach ↺ steht der Name aus Garetien im Feld");
gleich((api.garetienEingabenFuerServer(dorf) || {}).name, "Dorf Tannweiler",
	"💣 …und reist als Handname -- ein leerer Speicher hieße wieder „Vorschlag“");
pruefe(!api.garetienIdentitaetMarkup(dorf).includes('data-gi-zuruecksetzen="name"'), "danach steht kein ↺ mehr da");

// --- 4. Ohne Präfix reist kein Name (die Stamm-Regel des Servers bleibt unberührt) ------------------------------
const ohne = objekt("ggp:Siedlungen:Dorf:Garetien:Silkwiesen", "Silkwiesen");
api.avesmapsGaretienStageHinzufuegen([ohne]);
pruefe(!("name" in (api.garetienEingabenFuerServer(ohne) || {})), "ein Name ohne Präfix schickt keinen Namen");
pruefe(!api.garetienIdentitaetMarkup(ohne).includes('data-gi-zuruecksetzen="name"'), "…und zeigt kein ↺");

// --- 5. Die Ruine: Häkchen vorbelegt, abnehmbar -------------------------------------------------------------------
const ruine = objekt("ggp:Burgen:Burg:Garetien:Muehlenburg", "Ruine Mühlenburg", "gebaeude");
api.avesmapsGaretienStageHinzufuegen([ruine]);
gleich(api.garetienEingabenZustandZu(ruine).isRuined, true, "🔴 eine Ruine bekommt das Häkchen");
const rumpf = api.garetienEingabenFuerServer(ruine) || {};
gleich(rumpf.is_ruined, true, "…und es reist an den Server");
gleich(rumpf.name, "Mühlenburg", "…mit dem Namen ohne „Ruine“");
api.garetienEingabenZustandZu(ruine).isRuined = false;
gleich((api.garetienEingabenFuerServer(ruine) || {}).is_ruined, false, "⚠️ nur eine Vorbelegung: abgenommen reist „nein“");
gleich(api.garetienEingabenGrundwerte({ name: "Burgruine Rond", subtyp: "gebaeude" }).isRuined, true,
	"die Grundwerte lesen den Namen");
gleich(api.garetienEingabenGrundwerte({ name: "Burg Rond", subtyp: "gebaeude" }).isRuined, false, "…und nur ihn");

api.garetienNameWahlVergessen();
api.garetienZielWahlVergessen();
api.avesmapsGaretienStageLeeren();
console.log("OK -- garetien-namensvorschlag: " + n + " Zusicherungen");
