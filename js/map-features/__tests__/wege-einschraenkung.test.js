/*
 * Die Regel „dieser Weg ist eingeschränkt befahrbar" und ihr Satz.
 *
 * Owner 01.09.2026: „viele straßen, insbesondere pässe sind nur eingeschränkt befahrbar. […] alle
 * wege, die nur eingeschränkt befahrbar sind, sollen 2 eigenschaften haben: kursiver name und eine
 * zusammenfassung der einschränkung in deren infobox." Umfang nach Mockup-Abstimmung: Zeitfenster
 * UND Reisemittel-Sperre, aber nur auf LANDwegen (docs/wege-einschraenkung-mockup.html).
 *
 * 💣 EINE Regel für BEIDE Anzeigen. Die Kartenschrift fragt nur „betroffen ja/nein", die Infobox
 * zusätzlich nach dem Satz -- aber beide fragen DIESELBE Funktion. Eine Regel, die einen von zwei
 * Erzeugern bindet, ist keine Regel (AGENTS.md, mehrfach bezahlt).
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie trägt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };
// 🪤 Objekte aus dem vm-Kontext tragen den Prototyp DIESES Realms, und deepStrictEqual
// vergleicht Prototypen mit -- gleiche Schlüssel und Werte schlagen dann trotzdem fehl.
// Deshalb über JSON normalisiert, bevor verglichen wird.
const klar = (wert) => JSON.parse(JSON.stringify(wert));
const tief = (ist, soll, warum) => { assert.deepStrictEqual(klar(ist), klar(soll), warum || ""); checks++; };

// ---- Die echten Quellen laden ------------------------------------------------------------------
// Dieselbe Bauform wie bach-haekchen.test.js: die Regel wird NICHT nachgebaut, sondern geladen.
const ctx = { console, module: undefined };
vm.createContext(ctx);
const config = lies("js", "config.js");
const stueck = (marke) => {
	const rest = config.slice(config.indexOf(marke));
	const ende = rest.indexOf("\n};");
	return (ende >= 0 && ende < 4000) ? rest.slice(0, ende + 3) : rest.slice(0, rest.indexOf("\n"));
};
vm.runInContext(stueck("const PATH_SUBTYPE_KEYS"), ctx);
vm.runInContext(stueck("const TRANSPORT_DOMAIN_OPTIONS"), ctx);
vm.runInContext('const SYNTHETIC_ROUTE_TYPE = "Querfeldein";', ctx);
vm.runInContext(lies("js", "map-features", "map-features-path-domain.js"), ctx);
vm.runInContext(lies("js", "map-features", "path-einschraenkung.js"), ctx);

ctx.__arg = null;
const rufe = (ausdruck, arg) => { ctx.__arg = arg; return vm.runInContext(ausdruck, ctx); };
const regel = (segmente) => rufe("avesmapsWegEinschraenkung(__arg)", segmente);

// Ein Abschnitt, wie ihn die Kartenantwort liefert.
const abschnitt = (subtype, extra) => ({
	properties: Object.assign({ feature_subtype: subtype, name: "Testweg" }, extra || {})
});

const FENSTER_SALJETH = { from_month: "peraine", from_day: 15, to_month: "efferd", to_day: 30 };
const seasons = (transporte, fenster) => {
	const o = {};
	transporte.forEach((t) => { o[t] = fenster; });
	return o;
};

// Ein Monatsname-Lieferant, wie ihn der Browser hereinreicht (dort: routePlanMonthLabel, das die
// zwölf Namen aus dem <select> des Routenplaners liest -- es gibt nur EINE Monatsliste).
const monatsName = (key) => ({ peraine: "Peraine", efferd: "Efferd", travia: "Travia" }[key] || key);
const satz = (segmente) => rufe("avesmapsWegEinschraenkungSatz(avesmapsWegEinschraenkung(__arg), __monat)",
	segmente, ctx.__monat = monatsName);

// =================================================================================================
// 1. Der gewöhnliche Weg ist NICHT eingeschränkt
// =================================================================================================
gleich(regel([abschnitt("Strasse")]), null,
	"eine Straße ohne Fenster und ohne abweichende Reisemittel ist nicht eingeschränkt");

gleich(regel([abschnitt("Pfad")]), null,
	"ein Pfad ohne Kutsche ist NORMAL -- das ist die Vorgabe seiner Wegart, keine Sperre");

// =================================================================================================
// 2. Zeitfenster
// =================================================================================================
const mitFenster = regel([abschnitt("Gebirgspass", {
	allowed_transports: ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"],
	transport_seasons: seasons(["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"], FENSTER_SALJETH)
})]);
wahr(mitFenster !== null, "ein Weg mit Zeitfenster ist eingeschränkt");
tief(mitFenster.fenster, FENSTER_SALJETH, "das Fenster reist unverändert mit");

// 💣 DIE LÜCKE. Live tragen 2 der 7 Saljethweg-Abschnitte KEIN Fenster (Altbestand von vor der
// serverseitigen Weitergabe an alle Geschwister). Ohne diese Regel stünde derselbe Weg auf einem
// Stück kursiv und auf dem nächsten aufrecht.
const mitLuecke = regel([
	abschnitt("Pfad"),
	abschnitt("Gebirgspass", { transport_seasons: seasons(["groupFoot"], FENSTER_SALJETH) }),
	abschnitt("Pfad")
]);
wahr(mitLuecke !== null,
	"EIN Abschnitt mit Fenster macht den ganzen Weg eingeschränkt -- sonst flackert der Name entlang der Strecke");

// =================================================================================================
// 3. Reisemittel-Sperre
// =================================================================================================
// Der Schattenbachpass: Pfad-Abschnitte tragen die Vorgabe, drei Gebirgspass-Abschnitte nur „zu Fuß".
const schattenbach = regel([
	abschnitt("Pfad", { allowed_transports: ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"] }),
	abschnitt("Gebirgspass", { allowed_transports: ["groupFoot", "lightWalker"] }),
	abschnitt("Pfad")
]);
wahr(schattenbach !== null, "ein Weg, dem die Wegart mehr erlauben würde, ist eingeschränkt");
tief(schattenbach.erlaubt.slice().sort(), ["groupFoot", "lightWalker"],
	"durchgehend erlaubt ist die SCHNITTMENGE über alle Abschnitte -- was auf einem Stück nicht darf, darf auf dem Weg nicht");
gleich(schattenbach.fenster, null, "dieser Weg hat kein Zeitfenster");

// 💣 DER FUND VOM 01.09.2026: eine ERWEITERUNG ist keine Sperre.
// Live tragen zwei Wege eine Liste, die über die Vorgabe ihrer Wegart HINAUSgeht (eine Kutsche, die
// ein Editor auf einem Pfad angehakt hat). Die erste Fassung der Regel verglich nur „weicht ab" und
// hätte diese beiden als eingeschränkt gemeldet -- kursiv, mit einer Zeile, die nichts zu sagen hat.
gleich(regel([abschnitt("Pfad", {
	allowed_transports: ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"]
})]), null,
	"eine Kutsche, die jemand auf einem Pfad ZUSÄTZLICH erlaubt hat, ist eine Erweiterung -- kein Grund für Kursivschrift");

// =================================================================================================
// 4. Wasser bleibt außen vor (Owner-Entscheid: Landwege)
// =================================================================================================
gleich(regel([abschnitt("Flussweg", { allowed_transports: ["riverBarge"] })]), null,
	"Flusswege sind ausgenommen -- sonst stünden 564 Flussabschnitte kursiv (live gemessen)");
gleich(regel([abschnitt("Seeweg", { allowed_transports: ["galley"] })]), null,
	"Seewege ebenso");

// =================================================================================================
// 5. Der Satz
// =================================================================================================
gleich(satz([abschnitt("Gebirgspass", {
	transport_seasons: seasons(["groupFoot"], FENSTER_SALJETH)
})]), "Nur vom 15. Peraine bis zum 30. Efferd befahrbar, sonst gesperrt.",
	"Zeitfenster: der Satz nennt beide Enden mit Tag und Monat");

gleich(satz([
	abschnitt("Pfad", { allowed_transports: ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"] }),
	abschnitt("Gebirgspass", { allowed_transports: ["groupFoot", "lightWalker"] })
]), "Nur zu Fuß.",
	"beide Fuß-Mittel übrig -> die Familie wird zusammengezogen, statt zwei Kunstbegriffe aufzuzählen");

// Die KÜRZERE Liste gewinnt: fehlt nur eines, wird das eine genannt statt fünf aufgezählt.
gleich(satz([abschnitt("Gebirgspass", {
	allowed_transports: ["caravan", "groupFoot", "lightWalker", "groupHorse", "lightRider"]
})]), "Nicht mit Kutsche.",
	"fehlt nur die Kutsche, nennt der Satz die Kutsche -- nicht die fünf, die dürfen");

// 46 Wege live: weder Karawane noch Kutsche. Gleich lang in beide Richtungen -> das MÖGLICHE gewinnt,
// weil ein Reisender wissen will, womit er durchkommt.
gleich(satz([abschnitt("Gebirgspass", {
	allowed_transports: ["groupFoot", "lightWalker", "groupHorse", "lightRider"]
})]), "Nur zu Fuß und zu Pferd.",
	"bei Gleichstand nennt der Satz, was geht");

// 💣 HALBE FAMILIE. Live tragen 3 Wege nur `lightWalker` -- eine Reisegruppe zu Fuß kommt dort NICHT
// durch, ein Einzelner schon. „Nur zu Fuß" wäre hier schlicht falsch.
gleich(satz([abschnitt("Gebirgspass", { allowed_transports: ["lightWalker"] })]),
	"Nur zu Fuß mit leichtem Gepäck.",
	"ist nur ein Mitglied einer Familie erlaubt, wird es einzeln benannt statt die Familie zu behaupten");

// 🪤 AN DEN ECHTEN DATEN GEFUNDEN (Abnahme 01.09.2026): stünde vor jedem Reisemittel ein eigenes
// „mit", käme „Nicht mit Kutsche und mit einer Reisegruppe zu Pferd." heraus. Die Reisemittel sind
// zweierlei Art -- Fahrzeuge („mit Kutsche") und Fortbewegungsarten („zu Fuß") --, deshalb tragen
// die Gruppen-Formen „als", nicht „mit".
gleich(satz([abschnitt("Gebirgspass", {
	allowed_transports: ["caravan", "groupFoot", "lightWalker", "lightRider"]
})]), "Nicht mit Kutsche und als Reisegruppe zu Pferd.",
	"zwei gesperrte Mittel verschiedener Art dürfen sich nicht zu einem doppelten „mit“ addieren");

// Beides zusammen: zwei Aussagen, deshalb heißt die Zeile im Plural „Einschränkungen" (Owner).
gleich(satz([abschnitt("Gebirgspass", {
	allowed_transports: ["groupFoot", "lightWalker"],
	transport_seasons: seasons(["groupFoot", "lightWalker"], FENSTER_SALJETH)
})]), "Nur vom 15. Peraine bis zum 30. Efferd befahrbar, sonst gesperrt. Nur zu Fuß.",
	"Fenster und Reisemittel stehen als zwei Sätze nebeneinander");

// 💣 Der Monatsname kommt von AUSSEN. Im Browser liefert ihn routePlanMonthLabel aus dem <select>
// des Routenplaners -- es gibt nur eine Liste der zwölf Monate, und sie steht im Markup (AGENTS §2).
let gefragt = [];
ctx.__monat = (key) => { gefragt.push(key); return "MONATSNAME"; };
gleich(rufe("avesmapsWegEinschraenkungSatz(avesmapsWegEinschraenkung(__arg), __monat)", [
	abschnitt("Gebirgspass", { transport_seasons: seasons(["groupFoot"], FENSTER_SALJETH) })
]), "Nur vom 15. MONATSNAME bis zum 30. MONATSNAME befahrbar, sonst gesperrt.",
	"der Satz baut KEINE eigene Monatsliste, sondern fragt den übergebenen Lieferanten");
tief(gefragt, ["peraine", "efferd"], "und zwar für beide Enden des Fensters");

// 💣 GAR NICHTS KOMMT DURCH. Eine gespeicherte LEERE Liste ist ein Entscheid und heißt „kein
// Reisemittel" (so dokumentiert in resolvePathAllowedTransports). Ohne eigenen Satz stünde dort
// „Nur ." -- ein halber Satz, den niemand als Fehler erkennt.
gleich(satz([abschnitt("Gebirgspass", { allowed_transports: [], transport_domain: "land" })]),
	"Für kein Reisemittel befahrbar.",
	"ist gar nichts erlaubt, sagt der Satz genau das");

// ⚠️ Jedes Landreisemittel braucht eine Satzform. Kommt eines dazu, fiele es sonst STILL aus jedem
// Satz heraus -- der Weg wäre kursiv und die Zeile daneben unvollständig, ohne Fehlermeldung.
const landMittel = rufe("avesmapsWegLandMittel()");
wahr(landMittel.length > 0, "TRANSPORT_DOMAIN_OPTIONS.land muss Reisemittel liefern");
landMittel.forEach((mittel) => {
	wahr(rufe("Boolean(AVESMAPS_WEG_MITTEL_SATZFORM[__arg])", mittel),
		`für das Landreisemittel „${mittel}" fehlt die Satzform in AVESMAPS_WEG_MITTEL_SATZFORM`);
});

// =================================================================================================
// 6. Der Gruppenschlüssel -- welche Abschnitte sind derselbe Weg?
// =================================================================================================
// Dieselbe Bauform wie wpGroupWays (js/pages/wege-editor-model.js): die Wiki-Zuweisung ist die
// Identität eines Weges, der Name nur der Rückfall. „Ein Name ist kein Schlüssel."
const schluessel = (p) => rufe("avesmapsWegGruppenSchluessel(__arg)", p);
gleich(schluessel(abschnitt("Pfad", { wiki_path: { wiki_key: "saljethweg" } })), "wiki:saljethweg",
	"mit Wiki-Zuweisung entscheidet der wiki_key");
gleich(schluessel(abschnitt("Pfad", { name: "Schattenbachpass" })), "name:Pfad:Schattenbachpass",
	"ohne Zuweisung der Rückfall aus wpGroupWays -- Wegart UND Name");
wahr(schluessel(abschnitt("Pfad", { wiki_path: { wiki_key: "x" }, name: "A" }))
	!== schluessel(abschnitt("Pfad", { name: "A" })),
	"ein zugewiesener und ein nicht zugewiesener Abschnitt sind NICHT dieselbe Gruppe");

console.log(`wege-einschraenkung.test.js: ${checks} Zusicherungen bestanden`);
