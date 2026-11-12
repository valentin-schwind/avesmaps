import { describe, expect, it } from "vitest";
import { MIN_TARGET_GAP } from "../src/map/camera/visible-area.ts";
import {
    LASCHEN_RAND,
    LEISTE_ABSTAND,
    leistenbreite,
    leistenplatz,
    meldeLeistenbreite,
} from "../src/fenster/leistenplatz.ts";

/**
 * Wo die Leiste eines Modus steht (EDIT-0003 T45 (3); Festlegung der Editor-Orchestrierung 2026-10-19 nach der Bedienprobe: „‚Fertig‘
 * wanderte zwischen unten und oben. Zweimal traf mein Klick daneben.“). Problemfälle: Die Liste fährt ein oder aus, und die Leiste
 * springt; an der Grenze flattert sie beim Ziehen des Browserfensters; eine neue Bearbeitung behält den alten Platz.
 */
const GROESSE = { width: 1000, height: 700 };
/** So viel decken Planer und Fenster, dass `frei` Bildpunkte Breite bleiben. */
const bedeckt = (frei: number) => ({ left: 300, right: GROESSE.width - 300 - frei });

describe("Platz der Leiste", () => {
    it("🔴 Fall 1: Liste ein und aus während der Bearbeitung → die Leiste bleibt, wo sie ist", () => {
        // Bei 1280 px ohne Lücke gewählt: im Fenster.
        const start = leistenplatz(undefined, "neu", GROESSE, bedeckt(40), true);
        expect(start).toBe("fenster");
        // Die Liste fährt ein, die Lücke wird breit: sie bleibt im Fenster.
        expect(leistenplatz(start, "sonst", GROESSE, bedeckt(400), true)).toBe("fenster");
        // Umgekehrt: auf der Karte gewählt, die Liste fährt aus und lässt noch Platz: sie bleibt auf der Karte.
        expect(leistenplatz("karte", "sonst", GROESSE, bedeckt(200), true)).toBe("karte");
    });

    it("🔴 Bedienprobe 1600 px: Die Lücke reicht für ein Hinflugziel, nicht für die Leiste → im Fenster, „Fertig“ bleibt erreichbar", () => {
        const breite = 520;
        // 170 px frei: früher genügten 80 (`MIN_TARGET_GAP`), und die Leiste lag unter Lasche und Fenster.
        expect(leistenplatz(undefined, "neu", GROESSE, bedeckt(170), true, breite)).toBe("fenster");
        expect(leistenplatz(undefined, "neu", GROESSE, bedeckt(breite + LASCHEN_RAND + 1), true, breite)).toBe("karte");
        // Auf der Karte gewählt, dann fährt die Liste aus und das Fenster wächst über sie: einmal ins Fenster, nie zurück.
        expect(leistenplatz("karte", "sonst", GROESSE, bedeckt(170), true, breite)).toBe("fenster");
        expect(leistenplatz("fenster", "sonst", GROESSE, bedeckt(700), true, breite)).toBe("fenster");
    });

    it("die Leisten melden ihre Breite; es zählt die breiteste, abgemeldet zählt keine", () => {
        const a = Symbol("a");
        const b = Symbol("b");
        meldeLeistenbreite(a, 400);
        meldeLeistenbreite(b, 520);
        expect(leistenbreite()).toBe(520);
        meldeLeistenbreite(b, undefined);
        meldeLeistenbreite(a, undefined);
        expect(leistenbreite()).toBe(0);
    });

    it("🔴 Fall 2: knapp über und unter der Grenze → kein Hin und Her, erst mit Abstand wechselt sie", () => {
        const knappDrueber = bedeckt(MIN_TARGET_GAP.width + 10);
        const knappDrunter = bedeckt(MIN_TARGET_GAP.width - 10);
        let platz = leistenplatz(undefined, "neu", GROESSE, knappDrunter, true);
        expect(platz).toBe("fenster");
        for (const b of [knappDrueber, knappDrunter, knappDrueber]) {
            platz = leistenplatz(platz, "groesse", GROESSE, b, true);
            expect(platz).toBe("fenster");
        }
        // Erst deutlich über der Grenze auf die Karte, und dort bleibt sie bis unter die Grenze.
        platz = leistenplatz(platz, "groesse", GROESSE, bedeckt(MIN_TARGET_GAP.width + LEISTE_ABSTAND + 1), true);
        expect(platz).toBe("karte");
        expect(leistenplatz(platz, "groesse", GROESSE, knappDrueber, true)).toBe("karte");
        expect(leistenplatz(platz, "groesse", GROESSE, knappDrunter, true)).toBe("fenster");
    });

    it("Fall 3: eine neue Bearbeitung wählt neu; ohne angedocktes Fenster immer über der Karte", () => {
        expect(leistenplatz("fenster", "neu", GROESSE, bedeckt(400), true)).toBe("karte");
        expect(leistenplatz("karte", "neu", GROESSE, bedeckt(20), true)).toBe("fenster");
        expect(leistenplatz("fenster", "sonst", GROESSE, bedeckt(20), false)).toBe("karte");
    });
});
