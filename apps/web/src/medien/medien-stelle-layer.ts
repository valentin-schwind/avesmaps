import { watch } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, roundMapCoordinate } from "@avesmaps3d/shared";
import { imKartenraum } from "../community/lage-vorschlag";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import type { MedienStelle } from "./medien-stelle";

/**
 * Der Klick der Kartenwahl in der Korrektur einer Reisebild-Einreichung (WI-0272 S3, Aufgabe 18; `medien-stelle.ts`): Wie `photobox/stelle-layer.ts` für „Stelle ändern“ im Formular der
 * Besucher, nur ohne Symbol (die Medienverwaltung ist zu, solange gewählt wird, ein Hinweis oben sagt es) und für das andere Fenster.
 *
 * - 🔴 **Der Klick gehört dem Koordinator** (Besitzer `stelle-korrigieren`, Rang in `priorities.ts` neben `stelle-waehlen`): Er ist nur angemeldet, solange die Wahl läuft; dann gehört ihm der nächste Klick
 *   auf die Karte, wo auch immer (Fadenkreuz), auch auf einem Ort, und er beendet die Wahl. Außerhalb des Kartenraums nimmt er nichts an (der Server lehnte die Stelle ab).
 * - **Esc beendet die Wahl** (Escape-Kaskade, Stufe `action`); die Medienverwaltung geht dann wieder auf, ohne neue Stelle.
 * - Die Karte wird nicht verändert: `map_mutation = false`; die Stelle landet als Eingabe im Kasten und geht erst mit „Korrektur speichern“ an den Server.
 */

const space = AVENTURIA.coordinateSpace;

export interface MedienStelleKarte {
    destroy(): void;
}

export function installMedienStelle(
    map: MapLibreMap,
    umfeld: {
        readonly interaction: MapInteractionCoordinator;
        readonly escape: Pick<EscapeCascade, "register">;
        readonly steuerung: Pick<MedienStelle, "waehlen" | "setze" | "beende">;
    },
): MedienStelleKarte {
    const { interaction, escape, steuerung } = umfeld;

    const besitzer: InteractionOwner<Claim> = {
        id: "stelle-korrigieren",
        priority: INTERACTION_PRIORITY["stelle-korrigieren"],
        kinds: ["click", "hover"],
        layers: () => [],
        hit: (context) => (context.kind === "hover" ? { cursor: "crosshair" } : {}),
        apply(kind, _claim, context) {
            if (kind !== "click") return;
            const lage = fromRenderLngLat(space, context.lngLat);
            const rund = { x: roundMapCoordinate(lage.x), y: roundMapCoordinate(lage.y) };
            if (!imKartenraum(rund)) return;
            steuerung.setze(rund);
        },
    };
    let abmelden: (() => void) | undefined;
    const stopModus = watch(
        steuerung.waehlen,
        (modus) => {
            if (modus && abmelden === undefined) abmelden = interaction.register(besitzer);
            else if (!modus && abmelden !== undefined) {
                abmelden();
                abmelden = undefined;
            }
        },
        { immediate: true, flush: "sync" },
    );
    // Esc beendet die Wahl, bevor es die Auswahl der Karte aufhebt (Stufe `action`).
    const stopEscape = escape.register("action", () => {
        if (!steuerung.waehlen.value) return false;
        steuerung.beende();
        return true;
    });

    let ab = false;
    const destroy = (): void => {
        if (ab) return;
        ab = true;
        stopModus();
        stopEscape();
        abmelden?.();
        abmelden = undefined;
    };
    map.once("remove", destroy);
    return { destroy };
}
