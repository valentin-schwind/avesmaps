const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die drei Abstände der Landschaftsnamen: Repel · Versatz · Drift (31.08.2026).
// Entwurf: docs/superpowers/specs/2026-08-31-landschaften-label-kollision-design.md
//
// 🔴 SIE ENTSCHEIDEN, OB EIN NAME AUSWEICHT ODER VERSCHWINDET. Ein Regler, dessen Wert niemand
// liest, ist keine Einstellung, sondern eine Beruhigung -- deshalb prüft dieser Test beide Hälften:
// den Leser (was gilt) UND die Verdrahtung (wer ihn ruft).
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/ecosystem-display-abstaende.test.js

const lies = (rel) => fs.readFileSync(path.join(__dirname, rel), "utf8");
vm.runInThisContext(lies("../ecosystem-display.js"), { filename: "ecosystem-display.js" });

// ---- A. Die Vorgaben --------------------------------------------------------------------------
// 💣 DIE 72 IST AM LAUFENDEN BROWSER GEMESSEN, und sie steht hier als Abnahmewert. Im gemeldeten
// Fall („Grüne Zwillinge", drei Namen auf einem Punkt, Bildhöhen 60 / 40 / 38 px) stehen bei 40 nur
// einer, bei 56 zwei und ab 64 alle drei. Die 72 gibt dem Fall eine Stufe Luft.
//
// 🪤 Hier stand kurz 56 -- aus einer Simulation, die `renderMapLabelToImage` OHNE die Halo-Parameter
// rief und die Namen dadurch 6 px zu schmal und 6 px zu flach maß. Wer diesen Wert je nachrechnet,
// nimmt den Pfad aus `createLabelIcon` (getLabelHaloParams) und hält das Ergebnis gegen die
// `width`/`height` des `<img>` im DOM.
avesmapsEcosystemDisplayInstall(null);
assert.strictEqual(avesmapsEcosystemDisplayAbstand("repel"), 2, "Repel: Luft um jeden Namen");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("versatz"), 8, "Versatz: Schrittweite");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("drift"), 72, "Drift: der Deckel");

// ---- B. Die Übersteuerung ----------------------------------------------------------------------
avesmapsEcosystemDisplayInstall({ abstaende: { repel: 5, drift: 90 } });
assert.strictEqual(avesmapsEcosystemDisplayAbstand("repel"), 5, "ein gespeicherter Wert gilt");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("drift"), 90, "auch der zweite");
// ⚠️ Eine LÜCKE fällt für sich allein auf die Vorgabe zurück, nicht der ganze Abschnitt.
// „nichts gespeichert" und „hier steht etwas anderes" sind verschiedene Aussagen.
assert.strictEqual(avesmapsEcosystemDisplayAbstand("versatz"), 8, "was nicht dasteht, bleibt Vorgabe");

// ---- C. Ein Wert außerhalb der Schranken fällt auf die VORGABE, nicht auf die Schranke ---------
// 🔴 Ein geklemmter Wert sähe aus wie eine Entscheidung; ein Rückfall ist als Rückfall erkennbar.
avesmapsEcosystemDisplayInstall({ abstaende: { drift: 999, repel: -3, versatz: 0 } });
assert.strictEqual(avesmapsEcosystemDisplayAbstand("drift"), 72, "über der Schranke -> Vorgabe");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("repel"), 2, "unter der Schranke -> Vorgabe");
// 💣 Versatz 0 ist der gefährliche: der Kandidatenbauer wächst in Schritten von `versatz` und liefe
// bei 0 endlos. Er fängt es selbst ab (Abschnitt E), aber schon der Leser lässt ihn nicht durch.
assert.strictEqual(avesmapsEcosystemDisplayAbstand("versatz"), 8, "Versatz 0 -> Vorgabe");

avesmapsEcosystemDisplayInstall({ abstaende: { drift: "56", versatz: null, repel: NaN } });
assert.strictEqual(avesmapsEcosystemDisplayAbstand("drift"), 72, "eine Zeichenkette ist keine Zahl");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("versatz"), 8, "null auch nicht");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("repel"), 2, "und NaN erst recht");

// 🔴 Die Null selbst ist gültig, wo sie eine Aussage ist: „gar nicht ausweichen" bzw. „kein
// Zuschlag". Nur beim Versatz ist sie es nicht -- dort ist sie eine Endlosschleife.
avesmapsEcosystemDisplayInstall({ abstaende: { drift: 0, repel: 0 } });
assert.strictEqual(avesmapsEcosystemDisplayAbstand("drift"), 0, "Drift 0 ist eine Einstellung");
assert.strictEqual(avesmapsEcosystemDisplayAbstand("repel"), 0, "Repel 0 ebenso");

assert.strictEqual(avesmapsEcosystemDisplayAbstand("gibtsnicht"), 0, "ein unbekannter Schlüssel ergibt 0");
avesmapsEcosystemDisplayInstall(null);

// ---- D. Die Schranken müssen zu denen des SERVERS passen ---------------------------------------
// 💣 Zwei Prüfungen über dieselbe Zahl, in zwei Sprachen. Laufen sie auseinander, nimmt der Server
// einen Wert an, den der Browser stumm verwirft -- der Regler steht dann auf 25 und die Karte
// rechnet mit 8, und niemand sieht warum.
const php = fs.readFileSync(path.join(__dirname, "../../../api/_internal/app/ecosystem-display.php"), "utf8");
const phpBlock = php.split("AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS = [")[1].split("];")[0];
const phpGrenzen = {};
phpBlock.replace(/'(\w+)'\s*=>\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/g, (_, k, min, max) => {
	phpGrenzen[k] = { min: Number(min), max: Number(max) };
	return "";
});
assert.deepStrictEqual(Object.keys(phpGrenzen).sort(), ["drift", "repel", "versatz"],
	"der Server kennt genau diese drei Schlüssel");
Object.keys(phpGrenzen).forEach((k) => {
	assert.deepStrictEqual(
		{ min: AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS[k].min, max: AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS[k].max },
		phpGrenzen[k],
		`die Schranken von "${k}" stimmen auf beiden Seiten überein`
	);
});

// ---- E. Der Kandidatenbauer wächst mit diesen Werten -------------------------------------------
vm.runInThisContext(lies("../location-zoom-bands.js"), { filename: "location-zoom-bands.js" });
vm.runInThisContext(lies("../label-placement.js"), { filename: "label-placement.js" });

const ring = avesmapsFreeLabelCandidatePlacements(
	avesmapsEcosystemDisplayAbstand("versatz"),
	avesmapsEcosystemDisplayAbstand("drift")
);
assert.ok(ring.length > 9,
	"mit den Vorgaben entstehen mehr Stellen als die neun festen von vor dem 31.08.2026");
assert.ok(ring.every((k) => k.drift <= 72), "und keine liegt jenseits des Deckels");
// 💣 Der gemeldete Fall braucht 64, nicht 40: drei Namen mit 60 / 40 / 38 px Bildhöhe plus Repel
// stehen auf demselben Punkt. Im Browser gemessen weicht der Waldname 48 px nach oben aus und der
// Gipfelname 64 px nach unten -- der Ring MUSS beide Stellen anbieten.
assert.ok(ring.some((k) => k.dx === 0 && k.dy === 64), "der Ring bietet die gemessene Stelle +64 an");
assert.ok(ring.some((k) => k.dx === 0 && k.dy === -48), "und die gemessene Stelle -48");

// ---- F. Verdrahtung: die KARTE liest die drei Werte wirklich ------------------------------------
// 🔴 Die Hausregel: ein grüner Rechentest beweist nichts, solange niemand den Wert liest.
const karte = lies("../map-features-label-collisions.js");
["repel", "versatz", "drift"].forEach((feld) => {
	assert.ok(new RegExp(`avesmapsEcosystemDisplayAbstand\\("${feld}"\\)`).test(karte),
		`der Kollisionsdurchgang holt "${feld}"`);
});
// 💣 UND ER MUSS BEIM RICHTIGEN VORBEIKOMMEN. Der Repel geht ausdrücklich in die Messung, sonst
// fällt sie auf den Vorgabewert zurück -- und der ist der Regler der ORTSCHAFTEN (die versteckte
// Kopplung, die dieser Umbau beseitigt hat).
assert.ok(/measureLabelCollisionRect\(element, isLocation \? undefined : freeLabelRepel\)/.test(karte),
	"und reicht den Repel je Familie in die Messung, statt den Vorgabewert greifen zu lassen");

// ---- G. Verdrahtung: das FENSTER schreibt sie, und zwar ohne eigene Zahlen ----------------------
const fenster = fs.readFileSync(path.join(__dirname, "../../../html/landschaften-editor.html"), "utf8");
assert.ok(/id="ecoDisplayAbstaendeRows"/.test(fenster), "das Fenster hat den Abschnitt");
assert.ok(/ecoDisplayZeichneAbstaende\(\);/.test(fenster), "und zeichnet ihn im Durchgang mit");
["repel", "versatz", "drift"].forEach((feld) => {
	assert.ok(new RegExp(`feld: "${feld}"`).test(fenster), `der Regler "${feld}" steht im Fenster`);
});
// 💣 KEINE ABGESCHRIEBENEN ZAHLEN. Vorgaben und Schranken kommen aus dem geteilten Modul -- eine
// Abschrift zeigte dem Editor etwas anderes an, als die Karte rechnet.
assert.ok(/AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE\[/.test(fenster),
	"die Vorgaben kommen aus dem geteilten Modul");
assert.ok(/AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS\[/.test(fenster),
	"die Schranken ebenso");

// 🔴 UND DIE ABSCHNITTSLISTE STEHT GENAU EINMAL. Bis zum 31.08.2026 stand sie fünfmal abgeschrieben
// (Anfangswert, Laden, Antwort des Speicherns, Zurücksetzen, Senden). Wer eine Stelle vergisst,
// bekommt einen Regler, der beim Zurücksetzen wiederkommt oder beim Speichern verschwindet -- und
// zwar lautlos, denn ein fehlendes `t.abstaende || {}` wirft nicht.
const listen = fenster.match(/\["flaeche", "deckkraft", "global"/g) || [];
assert.strictEqual(listen.length, 1,
	"die Liste der Abschnitte steht genau einmal (ECO_DISPLAY_ABSCHNITTE), nicht fünfmal abgeschrieben");
assert.ok(/const ECO_DISPLAY_ABSCHNITTE = \[[^\]]*"abstaende"/.test(fenster),
	"und sie enthält den neuen Abschnitt");
// Die vier Stellen, die früher abschrieben, gehen jetzt durch den einen Bauer.
assert.ok((fenster.match(/ecoDisplayTafelAus\(/g) || []).length >= 4,
	"Anfangswert, Laden, Speicher-Antwort und Zurücksetzen benutzen denselben Bauer");

// ---- H. Und das Fenster lädt das Modul überhaupt ------------------------------------------------
assert.ok(/ecosystem-display\.js/.test(fenster), "das Fenster lädt die geteilte Tafel");
assert.ok(/ecosystem-display\.js/.test(fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8")),
	"die Karte ebenfalls");

console.log("ecosystem-display-abstaende: alle Zusicherungen erfuellt");
