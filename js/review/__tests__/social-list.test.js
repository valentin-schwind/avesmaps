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
} = require("../review-social.js");

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

console.log("social-list.test: OK");
