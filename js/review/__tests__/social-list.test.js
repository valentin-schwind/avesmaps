"use strict";
// The client half of the social hub's list.
//
// 💣 What is tested is the DECISION a chip encodes, not the DOM: a chip is the one thing that tells
// an editor whether a post actually reached a network. Entwurf §2.2 -- a single shared "gesendet"
// would swallow the case where one channel refused, and nobody notices until someone asks why
// nothing is there.
//
// Run, from the repo root:
//   node js/review/__tests__/social-list.test.js
const assert = require("assert");
const {
	chipClass,
	chipLabel,
	canRetry,
	strictestLimit,
	formatCount,
	postAuthorLabel,
	formatExpiry,
	proposalNote,
	isDraft,
	linkNoteText,
	applyCapabilityTo,
	postSummaryText,
} = require("../review-social.js");

// ---- der Riegel muss BEIDE Richtungen schalten --------------------------------------------------------

// 💣 Der Fehler, den dieser Test festnagelt (gemeldet 11.08.2026, „das social media hub geht in vielen
// fällen nicht auf"): der Riegel setzte `hidden = true`, wenn das Recht fehlt, und nahm es NIE zurueck.
// Beim Start ist der Client immer anonym -- der erste Lauf versteckte also den Abschnitt, und der
// zweite (nach der Session-Antwort) holte nur den REITER zurueck. Ergebnis: Reiter da, anklickbar,
// unterstrichen -- und darunter nichts.
//
// 🔴 Warum die Reiter-Kaskade das nicht heilt: `css/base/reset.css` setzt
// `[hidden] { display: none !important }`. Das `!important` schlaegt
// `.wiki-sync-panel__tab-panel.is-active { display: flex }`, also hilft kein Klick und keine Klasse.
// Ein `hidden`, das einmal gesetzt wurde, ist endgueltig, bis jemand es zuruecknimmt.
//
// ⚠️ Warum es „in vielen Faellen" ging und in anderen nicht: AvesmapsSession.load() liefert ein
// GETEILTES, zwischengespeichertes Versprechen. War es beim Start dieses Moduls schon aufgeloest,
// sah der erste Lauf das Recht bereits und setzte `hidden` gar nicht erst. Ladereihenfolge entschied.
const gate = { tab: { hidden: false }, section: { hidden: false } };

applyCapabilityTo(gate.tab, gate.section, false);
assert.strictEqual(gate.tab.hidden, true, "ohne Recht ist der Reiter weg");
assert.strictEqual(gate.section.hidden, true, "und der Abschnitt auch");

applyCapabilityTo(gate.tab, gate.section, true);
assert.strictEqual(gate.tab.hidden, false, "mit Recht kommt der Reiter zurueck");
assert.strictEqual(gate.section.hidden, false,
	"UND der Abschnitt -- das war der Fehler: er blieb versteckt, und wegen [hidden]!important " +
	"half kein Klick auf den Reiter");

// Der Rueckweg zaehlt genauso: wer das Recht verliert, verliert beides wieder.
applyCapabilityTo(gate.tab, gate.section, false);
assert.strictEqual(gate.section.hidden, true, "und zurueck geht es auch");

// Faellt geschlossen aus: alles ausser echtem `true` versteckt.
const strict = { tab: { hidden: false }, section: { hidden: false } };
applyCapabilityTo(strict.tab, strict.section, undefined);
assert.strictEqual(strict.section.hidden, true, "ohne Angabe bleibt zu");

// Fehlende Elemente duerfen nicht stuerzen -- das Markup kann fehlen, wenn jemand den Reiter entfernt.
assert.doesNotThrow(() => applyCapabilityTo(null, null, true), "fehlende Elemente stuerzen nicht");
assert.strictEqual(applyCapabilityTo(null, null, true), true, "und der Rueckgabewert bleibt das Recht");

// ---- the status a chip shows ---------------------------------------------------------------------

assert.strictEqual(chipClass("sent"), "social-chip social-chip--ok", "gesendet ist gruen");
assert.strictEqual(chipClass("failed"), "social-chip social-chip--err", "fehler ist rot");
assert.strictEqual(chipClass("pending"), "social-chip social-chip--wait", "wartet ist neutral");
assert.strictEqual(chipClass("scheduled"), "social-chip social-chip--wait", "geplant ebenso");
// 🔴 The single most dangerous default in this file. A status a later Stufe adds, which this client
// does not know yet, must NOT render as success -- green reads as "it is out there".
assert.strictEqual(chipClass("brandneu"), "social-chip social-chip--wait",
	"ein unbekannter Zustand faellt auf wartend, NIE auf gesendet");
assert.strictEqual(chipClass(undefined), "social-chip social-chip--wait", "und fehlend ebenso");
assert.strictEqual(chipClass("SENT"), "social-chip social-chip--wait",
	"auch Grossschreibung ist kein Treffer -- die Werte kommen aus der Datenbank, exakt oder gar nicht");

assert.strictEqual(chipLabel({ label: "Instagram", status: "sent" }), "Instagram ✓");
assert.strictEqual(chipLabel({ label: "Mastodon", status: "failed" }), "Mastodon — Fehler");
assert.strictEqual(chipLabel({ label: "Facebook", status: "pending" }), "Facebook — wartet");
assert.strictEqual(chipLabel({ label: "Probe", status: "scheduled" }), "Probe — geplant");
assert.strictEqual(chipLabel({ label: "Probe", status: "brandneu" }), "Probe — wartet",
	"und der unbekannte Zustand heisst auch in Worten nicht 'gesendet'");

// ---- who may be retried ---------------------------------------------------------------------------

assert.strictEqual(canRetry({ status: "failed" }), true, "fehlgeschlagen darf wiederholt werden");
assert.strictEqual(canRetry({ status: "sent" }), false,
	"gesendet NICHT -- auf Instagram waere das ein Doppelbeitrag, der sich nur loeschen laesst");
assert.strictEqual(canRetry({ status: "pending" }), false, "wartend nicht");
assert.strictEqual(canRetry({ status: "scheduled" }), false, "geplant nicht");
assert.strictEqual(canRetry(null), false, "und nichts ist auch kein Ziel");

// ---- the strictest limit, mirrored from avesmapsSocialStrictestLimit -------------------------------

// ⚠️ The server enforces this again in avesmapsSocialCheckTarget. This half exists for comfort, so the
// editor sees the ceiling while typing -- it is not the lock.
const CHANNELS = [
	{ key: "probe", label: "Probe", max_chars: 500 },
	{ key: "instagram", label: "Instagram", max_chars: 2200 },
	{ key: "facebook", label: "Facebook", max_chars: 63206 },
	{ key: "mastodon", label: "Mastodon", max_chars: 500 },
];

assert.deepStrictEqual(strictestLimit(CHANNELS, ["instagram", "mastodon"]),
	{ key: "mastodon", label: "Mastodon", max_chars: 500 },
	"mit Mastodon angehakt ist die Decke 500, und der Zaehler muss sie BENENNEN");
assert.deepStrictEqual(strictestLimit(CHANNELS, ["instagram", "facebook"]),
	{ key: "instagram", label: "Instagram", max_chars: 2200 },
	"Mastodon abwaehlen gibt sofort 2200 zurueck");
assert.strictEqual(strictestLimit(CHANNELS, []).max_chars, null,
	"nichts angehakt, keine Decke -- NICHT null als 0, das wuerde jeden Beitrag verbieten");
assert.strictEqual(strictestLimit(CHANNELS, ["gibtsnicht"]).max_chars, null,
	"ein unbekannter Schluessel steuert keine Decke bei, statt zu stuerzen");

// ---- the counter --------------------------------------------------------------------------------------

// 💣 The line the whole hashtag design hangs on: tags are shown SEPARATELY because four of them are
// quickly 60 characters, and against Mastodon's 500 that is more than a tenth.
assert.strictEqual(formatCount(168, 61, { label: "Mastodon", max_chars: 500 }),
	"168 + 61 Hashtags = 229 von 500 Zeichen (engster Kanal: Mastodon)",
	"der Zaehler weist Text und Hashtags getrennt aus und nennt den engsten Kanal");
assert.strictEqual(formatCount(168, 0, { label: "Mastodon", max_chars: 500 }),
	"168 von 500 Zeichen (engster Kanal: Mastodon)",
	"ohne Hashtags keine Hashtag-Haelfte -- '168 + 0' liest sich wie ein Fehler");
assert.strictEqual(formatCount(168, 61, { label: "", max_chars: null }),
	"168 + 61 Hashtags = 229 Zeichen",
	"ohne angehakten Kanal gibt es eine Zahl, aber keine Decke");

// ---- who wrote it ------------------------------------------------------------------------------------

assert.strictEqual(postAuthorLabel({ origin: "routine", author: "Automatisch" }), "Automatisch");
assert.strictEqual(postAuthorLabel({ origin: "editor", author: "Valentin" }), "Valentin");
// 🔴 A post whose author was lost must never read as if the automation wrote it -- the distinction
// between "a person decided this" and "a routine proposed it" is the point of the marker.
assert.strictEqual(postAuthorLabel({ origin: "editor", author: "" }), "Unbekannt");
assert.strictEqual(postAuthorLabel({ origin: "routine", author: "" }), "Automatisch",
	"bei der Routine ist der Name dagegen ohnehin nur ein Etikett");

// ---- wann der Zugang abläuft ------------------------------------------------------------------------

assert.strictEqual(formatExpiry("never"), "Zugang läuft nie ab");

// 💣 DIE gefaehrliche Verwechslung. null heisst „keine gespeicherte Zeile" -- also Nichtwissen, denn
// der Token kann in der Konfiguration stehen. Wuerde das als „läuft nie ab" erscheinen, stuende eine
// Zusage da, die niemand gemessen hat: genau so starb am 10.08.2026 zweimal ein Zugang lautlos.
assert.strictEqual(formatExpiry(null), "",
	"ohne gespeicherte Zeile steht da NICHTS, niemals eine Zusage");
assert.strictEqual(formatExpiry(undefined), "", "und bei fehlendem Feld ebenso");
assert.strictEqual(formatExpiry(""), "", "und beim leeren Wert auch");

// Ein Datum ist eine Vorwarnung und muss lesbar sein.
assert.ok(formatExpiry("2026-10-09 12:00:00").startsWith("Zugang läuft ab: "),
	"ein Datum wird als Ablauf ausgewiesen");
assert.ok(formatExpiry("2026-10-09 12:00:00").includes("2026"),
	"und traegt das Jahr, sonst raet man das Jahrzehnt");

// Unlesbares faellt NICHT auf „nie" zurueck -- lieber der Rohwert als eine falsche Zusage.
assert.strictEqual(formatExpiry("kaputt"), "Zugang läuft ab: kaputt",
	"ein unlesbares Datum bleibt sichtbar und faellt nie auf die Zusage zurueck");

// ---- was ueber einem wartenden Beitrag steht ---------------------------------------------------------

// 💣 ZWEI Herkuenfte im selben Zustand `proposal`: die Routine schlaegt vor, ein Editor parkt.
// Der Satz "Vorschlag der Routine" stand fest verdrahtet und war ab dem ersten Editor-Entwurf
// sichtbar falsch -- ueber dem eigenen Text.
assert.strictEqual(proposalNote({ origin: "routine" }), "Vorschlag der Routine — wartet auf Freigabe.");
assert.strictEqual(proposalNote({ origin: "editor" }), "Entwurf — noch nicht veröffentlicht.",
	"ein Editor-Entwurf darf nie so lesen, als haette die Routine ihn vorgeschlagen");
assert.strictEqual(proposalNote({}), "Entwurf — noch nicht veröffentlicht.",
	"ohne Herkunft faellt es auf den Menschen zurueck, nicht auf die Automatik");
assert.strictEqual(proposalNote(null), "Entwurf — noch nicht veröffentlicht.");

// ---- was in die Entwurfsspalte des Fensters gehoert -----------------------------------------------

assert.strictEqual(isDraft({ state: "proposal" }), true);
// 🔴 Ein veroeffentlichter Beitrag darf dort NIE stehen: die Zeile traegt einen
// "Veroeffentlichen"-Knopf, und auf ihm waere das ein zweiter Versand -- auf Instagram ein
// Doppelbeitrag, den man nur loeschen kann.
assert.strictEqual(isDraft({ state: "released" }), false);
assert.strictEqual(isDraft({ state: "discarded" }), false);
assert.strictEqual(isDraft({}), false, "ohne Zustand faellt es zu -- nicht auf");
assert.strictEqual(isDraft(null), false);

// ---- der Hinweis auf nicht klickbare Links --------------------------------------------------------

const KANAELE = [
	{ key: "instagram", label: "Instagram", clickable_links: false },
	{ key: "facebook", label: "Facebook", clickable_links: true },
	{ key: "probe", label: "Probe", clickable_links: true },
	{ key: "zweiter", label: "Zweiter", clickable_links: false },
];
const hinweis = (text, keys) => linkNoteText(text, keys, KANAELE);

// 🔴 HINWEIS, KEIN RIEGEL: die Funktion liefert einen SATZ, sie aendert den Text nicht und sperrt
// nichts. Wer hier je ein true/false zum Sperren einbaut, verbietet „Karte auf avesmaps.de".
assert.ok(hinweis("Mehr dazu auf avesmaps.de", ["instagram"]).length > 0,
	"Adresse plus Instagram ergibt einen Hinweis");
assert.ok(hinweis("Mehr dazu auf avesmaps.de", ["instagram"]).includes("Instagram"),
	"und er nennt den Kanal, denn die Liste kann mehrere tragen");

// ⚠️ Der Kanal entscheidet ueber clickable_links aus dem REGISTER, nicht ueber seinen Schluessel.
assert.strictEqual(hinweis("Mehr dazu auf avesmaps.de", ["facebook"]), "",
	"derselbe Text an Facebook: kein Hinweis, dort ist es ein Link");
assert.strictEqual(hinweis("Heute neue Wege eingetragen", ["instagram"]), "",
	"Instagram ohne Adresse im Text: kein Hinweis");
assert.strictEqual(hinweis("Mehr dazu auf avesmaps.de", []), "", "ohne angehakten Kanal auch nicht");

// Mehrere betroffene Kanaele werden aufgezaehlt, und das Verb geht mit.
const zwei = hinweis("siehe avesmaps.de", ["instagram", "zweiter"]);
assert.ok(zwei.includes("Instagram und Zweiter"), "beide betroffenen Kanaele werden genannt");
assert.ok(zwei.includes("machen"), "und im Plural");
assert.ok(hinweis("siehe avesmaps.de", ["instagram"]).includes("macht"), "im Singular entsprechend");

// Was als Adresse zaehlt.
assert.ok(hinweis("https://avesmaps.de/?s=abc", ["instagram"]).length > 0, "mit Schema");
assert.ok(hinweis("www.avesmaps.de", ["instagram"]).length > 0, "mit www");
assert.ok(hinweis("schau auf example.com vorbei", ["instagram"]).length > 0, "blosse Domain");

// 💣 Und was NICHT: ein Hinweis, der bei jedem zweiten deutschen Satz aufpoppt, ist einer, den
// niemand mehr liest. Deshalb nur gaengige Endungen statt aller TLDs der Welt.
assert.strictEqual(hinweis("z.B. drei neue Wege", ["instagram"]), "", "z.B. ist keine Adresse");
assert.strictEqual(hinweis("Kosch u.a. ergaenzt", ["instagram"]), "", "u.a. auch nicht");
assert.strictEqual(hinweis("Der Ort heisst Havena, Nr.7", ["instagram"]), "", "und eine Nummer nicht");
// 💣 Der Fall, der die ENGE Endungsliste rechtfertigt: ein vergessenes Leerzeichen nach dem Punkt.
// „Gareth.Danach" sieht fuer ein Muster mit beliebiger Endung wie eine Domain aus -- und ein
// getippter Beitrag hat so etwas schnell. Mit der Liste ist es keine.
assert.strictEqual(hinweis("Der Weg endet in Gareth.Danach kommt Punin", ["instagram"]), "",
	"ein fehlendes Leerzeichen nach dem Punkt ist keine Adresse");
assert.strictEqual(hinweis("Neue Wege eingetragen.Weitere folgen", ["instagram"]), "",
	"und ein zusammengelaufener Satz auch nicht");
assert.strictEqual(hinweis("", ["instagram"]), "", "leerer Text: nichts");
assert.strictEqual(hinweis(null, ["instagram"]), "", "und null stuerzt nicht ab");
assert.strictEqual(linkNoteText("avesmaps.de", ["instagram"], null), "",
	"ohne Kanalliste ebenfalls nicht -- der Hub laedt sie nach, sie kann kurz fehlen");

// ---- die Zeile, die zugeklappt dasteht ---------------------------------------------------------

// Die Liste zeigt den Beitragstext seit 14.08.2026 erst auf Klick (`<details>`). Was ZUgeklappt
// dasteht, entscheidet diese Funktion -- und sie darf NIE leer werden: ein leeres `<summary>` ist ein
// unsichtbarer, aber klickbarer Streifen, und wer die Liste ueberfliegt, sieht nur noch Datum.
assert.strictEqual(postSummaryText({ title: "Neue Anzeigemethoden", text: "Ihr könnt die Karte …" }),
	"Neue Anzeigemethoden",
	"gibt es eine Titelzeile, ist SIE die Klappzeile -- sonst stuende sie zweimal da");
assert.strictEqual(postSummaryText({ title: "  Mit Rand  ", text: "egal" }), "Mit Rand",
	"und sie wird getrimmt");

// Ohne Titel traegt die erste Zeile die Auskunft -- dieselbe Regel wie beim Kanal „Neuigkeiten".
assert.strictEqual(postSummaryText({ title: "", text: "Kurz und fertig." }), "Kurz und fertig.",
	"ein kurzer einzeiliger Text steht ganz da, ohne Auslassungspunkte");
assert.strictEqual(postSummaryText({ text: "Erste Zeile.\nZweite Zeile." }), "Erste Zeile. …",
	"bei mehreren Zeilen sagen die Punkte, dass da noch etwas ist");

// 💣 Gekuerzt wird an der WORTgrenze. Ein harter Schnitt mitten im Wort liest sich wie ein Datenfehler.
const lang = postSummaryText({ text: "Ihr könnt die Karte jetzt freiräumen: Wege, Beschriftungen, "
	+ "Grenzen und Flüsse lassen sich einzeln ausblenden." });
assert.ok(lang.endsWith(" …"), "ein langer Text endet mit Auslassungspunkten");
assert.ok(lang.length <= 82, "und bleibt kurz genug fuer eine Zeile: " + lang.length);
assert.ok(!/\S…/.test(lang), "die Punkte haengen nie an einem abgeschnittenen Wortstueck: " + lang);
assert.ok("Ihr könnt die Karte jetzt freiräumen: Wege, Beschriftungen, Grenzen und Flüsse lassen "
	.startsWith(lang.slice(0, -2)), "und was dasteht, steht so auch im Text");

// Ein Wort ohne jede Leerstelle darf nicht dazu fuehren, dass gar nichts gekuerzt wird.
const wurm = postSummaryText({ text: "A".repeat(200) });
assert.ok(wurm.length <= 82, "auch ein Wortwurm wird gekappt: " + wurm.length);

// 🔴 Faellt nie auf Leer zurueck.
assert.strictEqual(postSummaryText({ title: "", text: "" }), "Ohne Text");
assert.strictEqual(postSummaryText({ title: "   ", text: "  \n " }), "Ohne Text",
	"auch wenn nur Leerraum dasteht");
assert.strictEqual(postSummaryText(null), "Ohne Text", "und nichts stuerzt nicht ab");

console.log("social-list.test: OK");
