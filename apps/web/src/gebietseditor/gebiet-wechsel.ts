import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, HitContext, MapInteractionCoordinator } from "../map/interaction/types";

/**
 * Ein Klick auf ein anderes Gebiet wechselt die Bearbeitung der Grenzen (OPS-000077; Thomas: „Wunsch einfacher Klick wechselt der Editor zwischen den Gebieten, wie früher“). Bisher hieß
 * das zweimal Doppelklick: Der erste auf das andere Gebiet war „Fertig“ und endete, erst der zweite begann dort.
 *
 * - **Wo:** Nur außerhalb der bearbeiteten Fläche und ihres Saums (`traegt`). Dort bleibt der Doppelklick „Punkt setzen“ (EDIT-0003 T59, OPS-000043).
 * - **Wen:** Das kleinste Gebiet unter dem Zeiger, wie der Doppelklick; die Anbindung führt ein abgeleitetes Gebiet zur Baronie unter dem Klickpunkt.
 * - **Rang:** Vor dem Weg und der Fläche, damit ein Weg im Nachbargebiet den Wechsel nicht schluckt; ein Ort, ein Gipfel und die Anfasser gehen vor (`priorities.ts`).
 * - **Ungespeichertes** schreibt der Wechsel erst wie „Fertig“ (`wechsleGebiet`): So liest das nächste Gebiet die gemeinsamen Ecken schon neu. Schreibt der Server nicht, bleibt alles stehen,
 *   und die Leiste sagt warum (`entwurf-leiste.vue`).
 */

export interface GebietWechselSeite {
    /** Läuft „Grenzen bearbeiten“ bereit, ohne dass gerade gespeichert wird? */
    laeuft(): boolean;
    /** Gehört der Punkt noch der bearbeiteten Fläche oder ihrem Saum? */
    traegt(punkt: { readonly x: number; readonly y: number }): boolean;
    layers(): readonly string[];
    /** Die Gebiete unter dem Zeiger, kleinste zuerst. */
    gebiete(context: HitContext): readonly { readonly id: string }[];
    wechsle(id: string, context: HitContext): void;
}

export function installGebietWechsel(coordinator: MapInteractionCoordinator, seite: GebietWechselSeite): () => void {
    return coordinator.register({
        id: "gebiet-wechsel",
        priority: INTERACTION_PRIORITY["gebiet-wechsel"],
        kinds: ["click"],
        layers: () => seite.layers(),
        enabled: () => seite.laeuft(),
        hit(context): Claim | undefined {
            if (seite.traegt(context.point) || seite.gebiete(context).length === 0) return undefined;
            return {};
        },
        apply(_kind, _claim, context) {
            const [ziel] = seite.gebiete(context);
            if (ziel !== undefined) seite.wechsle(ziel.id, context);
        },
    });
}

/** Das Bearbeitete, von dem der Wechsel weggeht. */
export interface WechselVon {
    readonly ungespeichert: number;
    fertig(): Promise<void>;
    /** Läuft die Bearbeitung noch? Nach „Fertig“ heißt das: Es wurde nicht geschrieben. */
    laeuft(): boolean;
}

/** Erst schreiben, was offen ist; bleibt die Bearbeitung danach stehen (Ablehnung, Konflikt), beginnt nichts Neues. */
export async function wechsleGebiet(von: WechselVon | undefined, beginne: () => Promise<void>): Promise<void> {
    if (von !== undefined && von.ungespeichert > 0) {
        await von.fertig();
        if (von.laeuft()) return;
    }
    await beginne();
}
