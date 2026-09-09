// Owner 09.09.2026: „erlaube, dass der Name verändert werden kann (nur auf der Stage und Achte
// darauf, dass das label aktualisiert)".
//
// 🔴 DIE ÄNDERUNG WIRKT AUF `after.name`, UND DAMIT AUF ALLES. Jeder Anleger des Importers liest
// den Namen von dort -- die Fläche, ihr LABEL, der Ort, der Weg, der Berggipfel
// (avesmapsGaretienNameUebersteuern, garetien-plan.php). Die Bitte „achte darauf, dass das label
// aktualisiert" ist deshalb kein eigener Handgriff: sie fällt an dieser einen Stelle ab.
//
// Ausführen: node js/review/__tests__/garetien-name-aendern.test.js

"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }

function objekt() {
	return { key: "ggp:Gewaesser:Wald:Garetien:Dunkelforst!Dunkelforst", stand: "offen",
		urteil: "neu", name: "Dunkelforst",
		items: [{ id: 11, change_type: "new", anlass: "", felder: ["quelle"] }] };
}

api.garetienNameWahlVergessen();
api.avesmapsGaretienStageLeeren();

// --- 1. NUR AUF DER STAGE -----------------------------------------------------------------------
const o = objekt();
pruefe(api.garetienEinfuegeHakenMarkup(o) === "", "vor der Stage kein Kasten und kein Namensfeld");
api.avesmapsGaretienStageHinzufuegen([o]);
let mk = api.garetienEinfuegeHakenMarkup(o);
pruefe(mk.includes('data-gi-feld="einfuegeName"'), "auf der Stage steht das Namensfeld da");
pruefe(mk.includes('value="Dunkelforst"'), "vorbelegt mit dem Namen des Vorschlags");

// --- 2. Die Eingabe reist bis in den Anfragerumpf ------------------------------------------------
// 💣 Das ist die NAHT. Feld, Zustand und Rumpf können je für sich stimmen, während der Wert
// unterwegs verlorengeht -- genau so war der Regler „Angezeigte Zeilen" monatelang wirkungslos.
api.garetienNameWahlSetzen(o, "Dunkler Forst");
pruefe(api.garetienNameWahlZu(o) === "Dunkler Forst", "der Zustand hält die Eingabe");
pruefe(api.garetienEingabenFuerServer(o).name === "Dunkler Forst",
	"und sie steht im Anfragerumpf: " + JSON.stringify(api.garetienEingabenFuerServer(o)));
const jeItem = api.garetienStageEinstellungenJeItem([o]);
pruefe((jeItem["11"] || {}).name === "Dunkler Forst",
	"und kommt am ITEM an, mit dem der Import läuft: " + JSON.stringify(jeItem));

// ⚠️ Ohne Eingabe reist KEIN `name` mit -- sonst schriebe jeder Import den Vorschlagsnamen als
// „Handeingabe" fest, und eine spätere Korrektur am Vorschlag käme nie an.
// ⚠️ EIGENER Schlüssel: der Zustand hängt am Objektschlüssel, zwei Fixtures mit demselben sind
// dasselbe Objekt (und der Test misst dann seine eigene vorige Eingabe).
const frisch = objekt();
frisch.key = "ggp:Gewaesser:Wald:Garetien:Hellforst!Hellforst";
api.avesmapsGaretienStageHinzufuegen([frisch]);
pruefe(!("name" in (api.garetienEingabenFuerServer(frisch) || {})),
	"ohne Eingabe kein `name` im Rumpf: " + JSON.stringify(api.garetienEingabenFuerServer(frisch)));

// ⚠️ Leer heisst „unverändert", nie „lösche den Namen".
api.garetienNameWahlSetzen(o, "   ");
pruefe(api.garetienNameWahlZu(o) === "", "nur Leerzeichen zählen als keine Eingabe");
pruefe(!("name" in (api.garetienEingabenFuerServer(o) || {})), "und reisen nicht mit");
api.garetienNameWahlSetzen(o, "Dunkler Forst");

// --- 3. Der Server legt ihn auf `after.name` ------------------------------------------------------
const plan = fs.readFileSync(path.join(__dirname, "..", "..", "..", "api", "_internal", "import",
	"garetien-plan.php"), "utf8");
pruefe(plan.includes("function avesmapsGaretienNameUebersteuern("),
	"die Server-Regel gibt es");
pruefe(/\$nach\['name'\] = \$name;/.test(plan), "und sie schreibt auf `after.name`");
// 🔴 EIGENE Funktion, kein Zweig in avesmapsGaretienZielUebersteuern: jene kehrt früh zurück, wenn
// keine ZIELwahl vorliegt -- der Name ginge dort in genau dem Fall verloren, für den er da ist.
pruefe(plan.indexOf("function avesmapsGaretienNameUebersteuern(")
	< plan.indexOf("function avesmapsGaretienZielUebersteuern("),
	"als eigene Funktion neben der Zielwahl, nicht in ihr");

const uebernahme = fs.readFileSync(path.join(__dirname, "..", "..", "..", "api", "_internal",
	"import", "garetien-uebernahme.php"), "utf8");
pruefe(uebernahme.includes("$nach = avesmapsGaretienNameUebersteuern($nach, $rumpfDesItems);"),
	"und die Übernahme ruft sie -- an derselben Stelle wie die Zielwahl");
// 💣 GENAU EINMAL: `$nach` entsteht an einer Stelle, und jeder Anleger liest von dort. Ein zweiter
// Aufruf wäre ein zweiter Ort, an dem der Name gesetzt wird.
pruefe((uebernahme.split("avesmapsGaretienNameUebersteuern(").length - 1) === 1,
	"genau einmal -- ein Ort, an dem der Name entsteht");

// 🔴 DAS LABEL: die Fläche und ihr Label lesen BEIDE `$nach['name']`. Wäre das nicht so, müsste der
// Name zweimal gesetzt werden -- und der Owner hat genau danach gefragt.
const nameAusNach = (uebernahme.match(/'name' => \(string\) \$nach\['name'\]/g) || []).length;
pruefe(nameAusNach >= 3,
	"mehrere Anleger lesen den Namen aus derselben Stelle (" + nameAusNach + ") -- darunter das Label");

api.avesmapsGaretienStageLeeren();
console.log("OK -- " + n + " Zusicherungen");
