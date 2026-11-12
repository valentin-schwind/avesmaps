import { describe, expect, it, vi } from "vitest";
import { istDoppelklick } from "../src/map/geometrie/anlegen";
import { halteLeertaste, type LeertastenQuellen } from "../src/map/geometrie/neue-flaeche-anbindung";

/**
 * Die gehaltene Leertaste bei „Neue Fläche“ (OPS-000040, Thomas; Betreiber „A unbedingt“ und „A beim doppelklick“: wie Legacy). Die Fälle
 * A bis E aus Legacys `js/map-features/__tests__/ecosystem-draw-leertastensperre.test.js` (Mirror a7f2dac8): ohne Leertaste wie bisher;
 * gehalten zählt jeder Klick, kein Doppelklick schließt, die Karte steht; im Textfeld wirkt sie nicht; Beenden und Fokusverlust lösen sie.
 * Den Zug auf der Karte prüft `e2e/neue-flaeche.spec.ts`.
 */

/** Eine Ereignisquelle, die Handler wirklich hält (wie Legacys `baueEreignisquelle`), und merkt, wer in der Capture-Phase hört. */
function quelle(): LeertastenQuellen["dokument"] & { fire(typ: string, event: unknown): void; capture: Set<string> } {
    const handler = new Map<string, EventListener[]>();
    const capture = new Set<string>();
    return {
        capture,
        addEventListener(
            typ: string,
            fn: EventListenerOrEventListenerObject | null,
            optionen?: boolean | AddEventListenerOptions,
        ) {
            if (optionen === true || (typeof optionen === "object" && optionen.capture === true)) capture.add(typ);
            handler.set(typ, [...(handler.get(typ) ?? []), fn as EventListener]);
        },
        removeEventListener(typ: string, fn: EventListenerOrEventListenerObject | null) {
            handler.set(
                typ,
                (handler.get(typ) ?? []).filter((x) => x !== fn),
            );
        },
        fire(typ, event) {
            for (const fn of handler.get(typ) ?? []) fn(event as Event);
        },
    };
}

const leertaste = (ziel: unknown = {}) => ({ key: " ", code: "Space", target: ziel, preventDefault: vi.fn() });
/** Ein Ziel wie ein Textfeld: `closest` findet ein Eingabefeld. */
const textfeld = { closest: (wahl: string) => (wahl.includes("input") ? {} : null) };

function buehne(laeuft = true) {
    const dokument = quelle();
    const fenster = quelle();
    const sperre = { an: vi.fn(), aus: vi.fn() };
    const taste = halteLeertaste(() => laeuft, sperre, { dokument, fenster });
    return { dokument, fenster, sperre, taste };
}

describe("Leertaste beim Zeichnen einer neuen Fläche (Legacys Fälle A–E)", () => {
    it("🔴 A ohne Leertaste: getrennte Klicks sind zwei Ecken, zwei schnelle dicht beieinander ein Doppelklick", () => {
        expect(istDoppelklick({ zeit: 0, at: { x: 0, y: 0 } }, 1000, { x: 100, y: 0 }, false)).toBe(false);
        expect(istDoppelklick({ zeit: 1000, at: { x: 100, y: 0 } }, 1010, { x: 100, y: 2 }, false)).toBe(true);
        expect(istDoppelklick(undefined, 1010, { x: 100, y: 2 }, false)).toBe(false);
    });

    it("🔴 B gehalten: jeder Klick zählt, kein Doppelklick schließt, das Verschieben ist sofort gesperrt; Loslassen stellt alles her", () => {
        const { dokument, sperre, taste } = buehne();
        const runter = leertaste();
        dokument.fire("keydown", runter);
        expect(runter.preventDefault).toHaveBeenCalled();
        expect(taste.gehalten()).toBe(true);
        expect(sperre.an).toHaveBeenCalledTimes(1);
        // Die Wiederholung der gehaltenen Taste sperrt nicht noch einmal.
        dokument.fire("keydown", leertaste());
        expect(sperre.an).toHaveBeenCalledTimes(1);
        expect(istDoppelklick({ zeit: 1010, at: { x: 100, y: 2 } }, 1015, { x: 100, y: 2 }, taste.gehalten())).toBe(
            false,
        );

        dokument.fire("keyup", leertaste());
        expect(taste.gehalten()).toBe(false);
        expect(sperre.aus).toHaveBeenCalledTimes(1);
        expect(istDoppelklick({ zeit: 2000, at: { x: 300, y: 300 } }, 2005, { x: 300, y: 301 }, taste.gehalten())).toBe(
            true,
        );
    });

    it("🔴 vor den Tastenkürzeln: keydown hört in der Capture-Phase und fängt die Taste ab (sonst öffnet sie zugleich die Suche oder fixiert die Auswahl)", () => {
        const { dokument } = buehne();
        expect(dokument.capture.has("keydown")).toBe(true);
        const runter = leertaste();
        dokument.fire("keydown", runter);
        expect(runter.preventDefault).toHaveBeenCalled();
    });

    it("🔴 C in einem Textfeld bleibt die Leertaste wirkungslos", () => {
        const { dokument, sperre, taste } = buehne();
        const runter = leertaste(textfeld);
        dokument.fire("keydown", runter);
        expect(taste.gehalten()).toBe(false);
        expect(sperre.an).not.toHaveBeenCalled();
        expect(runter.preventDefault).not.toHaveBeenCalled();
    });

    it("🔴 D endet das Zeichnen bei gehaltener Leertaste, ist die Karte wieder frei", () => {
        const { dokument, sperre, taste } = buehne();
        dokument.fire("keydown", leertaste());
        expect(sperre.an).toHaveBeenCalledTimes(1);
        taste.loese();
        expect(sperre.aus).toHaveBeenCalledTimes(1);
        expect(taste.gehalten()).toBe(false);
        // Ein späteres keyup gibt nicht noch einmal frei.
        dokument.fire("keyup", leertaste());
        expect(sperre.aus).toHaveBeenCalledTimes(1);
    });

    it("🔴 E ein Fokusverlust (Alt-Tab) mit gehaltener Leertaste löst die Sperre", () => {
        const { dokument, fenster, sperre, taste } = buehne();
        dokument.fire("keydown", leertaste());
        fenster.fire("blur", {});
        expect(sperre.aus).toHaveBeenCalledTimes(1);
        expect(taste.gehalten()).toBe(false);
    });

    it("ohne laufendes Zeichnen tut die Leertaste nichts; destroy hört auf und gibt frei", () => {
        const still = buehne(false);
        still.dokument.fire("keydown", leertaste());
        expect(still.sperre.an).not.toHaveBeenCalled();

        const { dokument, sperre, taste } = buehne();
        dokument.fire("keydown", leertaste());
        taste.destroy();
        expect(sperre.aus).toHaveBeenCalledTimes(1);
        dokument.fire("keydown", leertaste());
        expect(sperre.an).toHaveBeenCalledTimes(1);
    });
});
