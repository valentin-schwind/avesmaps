// Owner-Meldung 09.09.2026: „wenn ich eine fläche importiere ist sie zunächst weg und verschwindet,
// erst F5 bringt sie zurück. das label dagegen ist von anfang an da."
//
// 🔴 DER UNTERSCHIED IST DIE URSACHE. Das LABEL einer Landschaft ist ein `map_features`-Eintrag und
// reist im Live-Delta mit (pollLiveMapUpdates liest `data.features`). Die FLÄCHE steht in
// `ecosystem_region`/`ecosystem_area` und kommt aus einem EIGENEN Abruf
// (api/app/ecosystem-areas.php) -- in der Kartennutzlast gibt es dafür gar keinen Block
// (nachgezählt an der Live-Nutzlast: climate_zones, feature_kanon, feature_sources, features,
// in_settlement_places, revision, source_catalog, source_corpora, travel_hours, travel_speeds).
// Sie konnte also nie nachkommen.
//
// Ausführen: node js/review/__tests__/garetien-flaeche-nachladen.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, fenster } = ladeImporter();
let n = 0;
function pruefe(b, was) { n++; assert.ok(b, was); }

let gerufen = 0;
(fenster || global.window).loadEcosystemAreas = function () { gerufen++; return Promise.resolve(); };

// 🔴 Eine Fläche wurde angelegt -> nachladen.
gerufen = 0;
pruefe(api.garetienFlaechenNachladen({ angelegt_je_form: { region: 1, label: 1 } }) === true,
	"eine angelegte Fläche zieht den Abruf nach");
pruefe(gerufen === 1, "und zwar genau einmal: " + gerufen);

// ⚠️ Ein Import ganz ohne Fläche zahlt den Abruf NICHT -- er holt alle Flächen.
gerufen = 0;
pruefe(api.garetienFlaechenNachladen({ angelegt_je_form: { location: 5, path: 3, label: 2 } }) === false,
	"ohne Fläche kein Abruf");
pruefe(gerufen === 0, "und wirklich keiner: " + gerufen);

// 🪤 Fällt offen aus: leere/fehlende Zählung wirft nicht.
pruefe(api.garetienFlaechenNachladen({}) === false, "ohne Zählung kein Abruf, keine Ausnahme");
pruefe(api.garetienFlaechenNachladen(null) === false, "und ohne Summe erst recht nicht");

// 💣 Fehlt die Funktion im Fenster, bleibt es beim alten Zustand -- der Import darf daran nicht
// scheitern (dann hilft F5, wie bisher).
delete (fenster || global.window).loadEcosystemAreas;
pruefe(api.garetienFlaechenNachladen({ angelegt_je_form: { region: 2 } }) === false,
	"ohne den Lader kein Wurf, nur kein Nachtrag");

// =================================================================================================
// Die NAHT -- wird sie am Ende des Laufs auch gerufen?
// =================================================================================================
// 💣 Die Funktion allein nützt nichts. Geprüft wird der AUFRUF mit Semikolon, nie der blosse Name:
// `garetienFlaechenNachladen` steht auch in der Definitionszeile und im Export, und ein Test, der
// nur den Namen sucht, bliebe grün, wenn der Aufruf gelöscht wird (die Vakuum-Falle).
const fs = require("fs");
const quelle = fs.readFileSync(require("path").join(__dirname, "..", "review-garetien-importer.js"), "utf8");
pruefe(quelle.includes("garetienFlaechenNachladen(summe);"),
	"der Lauf ruft den Nachtrag am Ende wirklich");
// ⚠️ Und NUR einmal: je Häppchen gerufen holte derselbe Abruf alle Flächen mehrfach.
pruefe(quelle.split("garetienFlaechenNachladen(summe);").length - 1 === 1,
	"genau ein Aufruf -- nicht je Häppchen");

console.log("OK -- " + n + " Zusicherungen");
