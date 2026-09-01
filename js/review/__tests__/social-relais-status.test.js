"use strict";
// Was der Hub ueber einen Beitrag sagt, der auf das Relais wartet.
// Entwurf: docs/superpowers/specs/2026-08-30-mastodon-relais-design.md
//
// 🔴 Der Auftrag des Owners war woertlich „zeig das bei uns irgendwie an, dass die action noch nicht
// durch is". Das Gegenteil davon ist nicht „rot", sondern „stumm": ein Beitrag, der ohne Erklaerung
// auf „wartet" steht, ist von einem nie versuchten nicht zu unterscheiden.
//
// Ausfuehren:  node js/review/__tests__/social-relais-status.test.js

const assert = require("assert");
const { chipClass, chipLabel, canRetry, wartezeitText, RELAIS_WARNUNG_MINUTEN } =
	require("../review-social.js");

// -------------------------------------------------------------------------------------------------
// 1. 🔴 DIE TRAGENDE ZUSICHERUNG: die zwei neuen Zustaende sind NICHT gruen.
//    Gruen heisst in diesem Hub „es steht draussen" -- und genau das stimmt hier nicht.
// -------------------------------------------------------------------------------------------------
assert.strictEqual(chipClass("queued"), "social-chip social-chip--wait", "wartend, nicht gesendet");
assert.strictEqual(chipClass("sending"), "social-chip social-chip--wait", "unterwegs, nicht gesendet");
assert.notStrictEqual(chipClass("queued"), chipClass("sent"), "queued sieht nie aus wie sent");
// ⚠️ Und auch nicht rot: der Beitrag ist nicht gescheitert, er ist noch nicht dran.
assert.notStrictEqual(chipClass("queued"), chipClass("failed"), "queued sieht nie aus wie failed");

// -------------------------------------------------------------------------------------------------
// 2. Die Zustaende werden BENANNT, statt auf den Rueckfall „wartet" zu fallen.
//    💣 Der Rueckfall ist richtig und bleibt -- aber er beantwortet die Frage des Owners nicht.
// -------------------------------------------------------------------------------------------------
const wartend = chipLabel({ label: "Mastodon", status: "queued", wartet_sekunden: 12 * 60 });
assert.ok(wartend.includes("wartet auf Versand"), "der Zustand wird benannt");
assert.ok(wartend.includes("12 Min."), "und wie lange schon");
assert.notStrictEqual(wartend, chipLabel({ label: "Mastodon", status: "irgendwas" }),
	"queued sagt mehr als der Rueckfall");

assert.ok(chipLabel({ label: "Mastodon", status: "sending" }).includes("wird gesendet"),
	"ein uebernommener Beitrag sagt, dass er unterwegs ist");

// -------------------------------------------------------------------------------------------------
// 3. Die Warnung. ⚠️ GitHubs Zeitplan ist keine Zusage, und in einem stillen Repository schaltet
//    GitHub ihn nach 60 Tagen ab. Ohne diese Zeile sieht „laeuft seit Tagen nicht" genauso aus wie
//    „noch zehn Minuten".
// -------------------------------------------------------------------------------------------------
const knappDrunter = chipLabel({
	label: "Mastodon", status: "queued", wartet_sekunden: RELAIS_WARNUNG_MINUTEN * 60 - 1,
});
const knappDrueber = chipLabel({
	label: "Mastodon", status: "queued", wartet_sekunden: RELAIS_WARNUNG_MINUTEN * 60,
});
assert.ok(!knappDrunter.includes("Workflow"), "unter der Schwelle keine Warnung");
assert.ok(knappDrueber.includes("Workflow"), "ab der Schwelle die Frage nach dem Workflow");
// 💣 DIE SCHWELLE HAT ZWEI GRENZEN, UND SIE STAND EINMAL AUSSERHALB BEIDER.
// 🪤 Bis zum 01.09.2026 waren es 90 Minuten, gerechnet als „drei verpasste Laeufe" aus einem Takt,
// den GitHub nie eingehalten hat (gemessen: 2,3 bis 7,0 Stunden). Sie schlug damit bei fast jedem
// Beitrag an -- und eine Warnung, die immer dasteht, liest niemand mehr. Sie war nicht zu scharf,
// sie war wertlos.
// Nach unten: deutlich ueber der normalen Zustellung (der Server stoesst den Lauf jetzt selbst an,
// das sind Sekunden) -- sonst warnt sie im Normalfall.
assert.ok(RELAIS_WARNUNG_MINUTEN >= 10, "die Warnschwelle warnt nicht im Normalfall");
// Nach oben: UNTER dem kuerzesten gemessenen Abstand des Zeitplans (2,3 h = 138 min) -- sonst
// deckt das Netz darunter sie zu und sie meldet nie etwas, was nicht ohnehin von selbst kaeme.
assert.ok(RELAIS_WARNUNG_MINUTEN < 138, "die Warnschwelle greift, bevor der Zeitplan sie zudeckt");
// ⚠️ INNERHALB dieses Korridors ist die genaue Zahl Ermessen, und der Test sagt das absichtlich:
// eine Mutationsprobe auf 90 bleibt hier gruen. Das ist kein Loch -- 90 waere vertretbar, nur
// traeger. Wer die Zusicherung auf den heute gewaehlten Wert zoege, machte sie zur Tautologie:
// sie pruefte dann nur noch, dass die Zahl die Zahl ist.

// -------------------------------------------------------------------------------------------------
// 4. Die Wartezeit. ⚠️ Die Sekunden rechnet der SERVER: `attempted_at` traegt keine Zeitzone, und
//    im Browser gelesen waere die Zahl fuer jeden Betrachter eine andere.
// -------------------------------------------------------------------------------------------------
assert.strictEqual(wartezeitText(0), "gerade eben");
assert.strictEqual(wartezeitText(59), "gerade eben");
assert.strictEqual(wartezeitText(60), "1 Min.");
assert.strictEqual(wartezeitText(3599), "59 Min.");
assert.strictEqual(wartezeitText(3600), "1 Std.");
assert.strictEqual(wartezeitText(86400), "1 Tage");
// 🔴 Fehlt die Angabe, wird NICHTS behauptet -- „gerade eben" fuer einen Beitrag, der seit gestern
// liegt, waere schlimmer als gar keine Zeit.
assert.strictEqual(wartezeitText(undefined), "", "ohne Angabe keine Zeit");
assert.strictEqual(wartezeitText(null), "", "null ist keine Zahl");
assert.strictEqual(wartezeitText(-5), "", "negativ ist keine Auskunft");
const ohneZeit = chipLabel({ label: "Mastodon", status: "queued" });
assert.ok(ohneZeit.includes("wartet auf Versand"), "der Zustand steht trotzdem da");
assert.ok(!ohneZeit.includes("("), "aber keine erfundene Klammer");

// -------------------------------------------------------------------------------------------------
// 5. „Erneut" bleibt den gescheiterten vorbehalten. ⚠️ Ein wartender Beitrag braucht keinen
//    Knopf -- ihn erneut einzureihen taete nichts, und der Editor haette den Eindruck, es liege an
//    ihm.
// -------------------------------------------------------------------------------------------------
assert.ok(!canRetry({ status: "queued" }), "wartend wird nicht wiederholt");
assert.ok(!canRetry({ status: "sending" }), "unterwegs wird nicht wiederholt");
assert.ok(canRetry({ status: "failed" }), "gescheitert schon");

console.log("social-relais-status ok");
