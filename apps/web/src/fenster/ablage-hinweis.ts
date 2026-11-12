import { watch, type WatchStopHandle } from "vue";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";

/**
 * Der Hinweis „Entwurf liegt unter Offene Bearbeitungen“ (Orchestrierung 2026-10-18 nach der Rangfolge, Betreiber bestätigt, wörtlich:
 * „Schließen mit ✕ verwirft nie einen Entwurf, er wird unter „Offene Bearbeitungen“ abgelegt. -> dafür ist das da“; EDIT-0003, R2 gilt
 * nur beim Verlassen eines Modus). Auslöser war der Fund „Tal am Donnerkessel“: Der Entwurf lag abgelegt, und niemand sagte es.
 *
 * Für jedes Werkzeugfenster mit Entwurf, gleich welches Werkzeug: Geht ein Fenster mit Ungespeichertem aus dem Bild in die Ablage
 * (✕, ein anderes Objekt an seiner Stelle nach D19, die Lasche „Info“), sagt es der Hinweis EINMAL je Entwurf. Erst wenn das Fenster
 * nichts Ungespeichertes mehr trägt (gespeichert, verworfen, geschlossen), kann ein neuer Entwurf ihn wieder auslösen.
 */
export function installAblageHinweis(
    werkzeugfenster: Pick<Werkzeugfenster, "stand">,
    melde: () => void,
): WatchStopHandle {
    const gesagt = new Set<string>();
    return watch(
        () =>
            werkzeugfenster.stand.value.fenster.map((f) => ({
                id: f.id,
                lage: f.lage,
                ungespeichert: f.ungespeichert,
            })),
        (jetzt, vorher) => {
            const war = new Map(vorher.map((f) => [f.id, f]));
            for (const fenster of jetzt) {
                if (!fenster.ungespeichert) {
                    gesagt.delete(fenster.id);
                    continue;
                }
                const davor = war.get(fenster.id);
                const abgelegt = fenster.lage === "versenkt" && davor !== undefined && davor.lage !== "versenkt";
                if (!abgelegt || gesagt.has(fenster.id)) continue;
                gesagt.add(fenster.id);
                melde();
            }
            for (const id of gesagt) if (!jetzt.some((f) => f.id === id)) gesagt.delete(id);
        },
    );
}
