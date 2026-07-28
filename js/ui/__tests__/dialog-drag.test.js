const assert = require("assert");

// Nur die reine Begrenzungsrechnung ist hier beweisbar -- Zeigerereignisse und Layout brauchen einen
// echten Browser. Genau diese Rechnung ist aber die Stelle, an der ein Fenster unerreichbar werden
// kann, also die, die einen Test verdient. Das Modul verdrahtet sich beim Laden nur, wenn es ein
// document gibt; unter Node bleibt es still.
const { avesmapsClampDialogOffset } = require("../dialog-drag.js");

const VIEWPORT = { width: 1200, height: 800 };
// Ein typisches Fenster: 600 breit, 400 hoch, mittig, Kopfzeile 40 hoch.
const BOX = { left: 300, top: 200, width: 600, height: 400, handleHeight: 40 };

// -----------------------------------------------------------------------------------------------
// 1. Innerhalb des Bildschirms kommt die gewuenschte Verschiebung unveraendert zurueck.
// -----------------------------------------------------------------------------------------------
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, 0, 0, VIEWPORT), { x: 0, y: 0 });
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, 120, -80, VIEWPORT), { x: 120, y: -80 });
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, -250, 150, VIEWPORT), { x: -250, y: 150 });

// -----------------------------------------------------------------------------------------------
// 2. Der Griff bleibt greifbar. Das ist der eigentliche Zweck der Begrenzung: ein Fenster, dessen
//    Kopfzeile aus dem Bild geschoben ist, laesst sich nie wieder zurueckholen.
// -----------------------------------------------------------------------------------------------
// Weit nach oben: der Deckel ist die Bildschirmoberkante (top 200 -> 0, also -200).
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, 0, -5000, VIEWPORT).y, -200);
// Weit nach unten: die Kopfzeile (40) bleibt sichtbar, also top hoechstens 800-40 = 760.
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, 0, 5000, VIEWPORT).y, 560);
// Weit nach links/rechts: 120px Fensterbreite bleiben stehen.
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, -5000, 0, VIEWPORT).x, -780); // left 300 -> -480
assert.deepStrictEqual(avesmapsClampDialogOffset(BOX, 5000, 0, VIEWPORT).x, 780); // left 300 -> 1080

// Eine niedrige Kopfzeile faellt nicht unter das Mindestmass von 24px zurueck.
const flatHandle = { left: 300, top: 200, width: 600, height: 400, handleHeight: 4 };
assert.strictEqual(avesmapsClampDialogOffset(flatHandle, 0, 5000, VIEWPORT).y, 576); // top -> 776
// Fehlt die Kopfzeile ganz (Griff nicht messbar), gilt dasselbe Mindestmass.
const noHandle = { left: 300, top: 200, width: 600, height: 400, handleHeight: 0 };
assert.strictEqual(avesmapsClampDialogOffset(noHandle, 0, 5000, VIEWPORT).y, 576);

// -----------------------------------------------------------------------------------------------
// 3. Schmale Fenster verschwinden nicht komplett: das Mindestmass ist nie groesser als das Fenster.
//    Sonst waere bei einem 80px breiten Kasten maxLeft < minLeft und die Grenzen kaempften gegen-
//    einander.
// -----------------------------------------------------------------------------------------------
const narrow = { left: 560, top: 200, width: 80, height: 120, handleHeight: 30 };
assert.strictEqual(avesmapsClampDialogOffset(narrow, 5000, 0, VIEWPORT).x, 560); // left -> 1120
assert.strictEqual(avesmapsClampDialogOffset(narrow, -5000, 0, VIEWPORT).x, -560); // left -> 0

// -----------------------------------------------------------------------------------------------
// 4. DIE INVARIANTE: die unverschobene Lage ist immer erlaubt.
//    Ein Fenster, das hoeher als der Bildschirm ist, haengt bei Flex-Zentrierung oben UND unten
//    heraus (top ist dann negativ). Wuerde die Begrenzung stur auf top >= 0 bestehen, machte so ein
//    Fenster beim ersten Anfassen einen Sprung nach unten -- die Begrenzung soll bremsen, nicht
//    schubsen.
// -----------------------------------------------------------------------------------------------
const tall = { left: 300, top: -150, width: 600, height: 1100, handleHeight: 40 };
assert.deepStrictEqual(avesmapsClampDialogOffset(tall, 0, 0, VIEWPORT), { x: 0, y: 0 });
// Nach oben bleibt es, wo es ist -- weiter hinauf geht nicht.
assert.strictEqual(avesmapsClampDialogOffset(tall, 0, -300, VIEWPORT).y, 0);
// Nach unten darf es, damit man den oberen Teil lesen kann.
assert.strictEqual(avesmapsClampDialogOffset(tall, 0, 100, VIEWPORT).y, 100);

// Dasselbe waagerecht: ein Fenster, das breiter als der Bildschirm ist, darf bleiben, wo es ist.
const wide = { left: -200, top: 100, width: 1600, height: 400, handleHeight: 40 };
assert.deepStrictEqual(avesmapsClampDialogOffset(wide, 0, 0, VIEWPORT), { x: 0, y: 0 });

// -----------------------------------------------------------------------------------------------
// 5. Ein winziges Browserfenster darf keine widerspruechlichen Grenzen erzeugen.
// -----------------------------------------------------------------------------------------------
const tiny = { width: 320, height: 200 };
const result = avesmapsClampDialogOffset(BOX, -5000, -5000, tiny);
assert.ok(Number.isFinite(result.x) && Number.isFinite(result.y), "Begrenzung liefert Zahlen");
assert.strictEqual(result.y, -200, "auch im kleinen Fenster ist oben bei 0 Schluss");

console.log("dialog-drag: alle Pruefungen bestanden");
