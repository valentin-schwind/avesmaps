import {
    LANDMARKEN_MERKMALE,
    PEAK_HEIGHT_MAX,
    formtGelaende,
    istLandmarkenArt,
    merkmaleDerArt,
    type EditorPeakDetail,
    type LandmarkenArt,
    type LandmarkenMerkmal,
    type PeakChanges,
    type PeakUpdateBody,
} from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import { t } from "../i18n/i18n";
import type { GipfelDaten } from "./gipfel-daten";

/**
 * Der Gipfel als Art des Fensterrumpfs (WI-0178 P2; EDIT-0003 T55; Rumpf `fenster/bearbeitung.ts`): Name, Höhe, „Auf der Karte anzeigen“
 * und die Lage sind Felder des EINEN Entwurfs; „Fertig“ schreibt sie als EINE Operation `peak.update` (`gipfel-daten.ts`).
 *
 * - **Lage als Feld** wie beim Verschieben einer Beschriftung (C4, `beschriftung-ziehen.ts`): Jeder Zug auf der Karte ist ein Schritt im
 *   Entwurf (↶ ↷), die Karte rückt erst mit „Fertig“.
 * - **Höhe:** ganze Schritt, 0 bis 65535; ein Gipfel ohne Höhe (Legacy kennt keine) bleibt ohne, bis jemand eine einträgt.
 * - Ein leerer Name sperrt „Fertig“ mit Grund (`pruefe`).
 * - **Landmarkenart und Merkmale** (WI-0271 L4): Felder desselben Entwurfs. Eine Höhe gibt es nur bei Berggipfel und Vulkan (`formtGelaende`);
 *   wechselt die Art zu einer ohne Gelände, schickt „Fertig“ keine Höhe, und der Server leert sie (`peak.update`).
 */
export interface GipfelFelder {
    readonly name: string;
    readonly art: LandmarkenArt;
    readonly merkmale: readonly LandmarkenMerkmal[];
    readonly hoehe: number | undefined;
    readonly anzeigen: boolean;
    readonly x: number;
    readonly y: number;
}

export type GipfelStand = Stand<GipfelFelder, never>;

export function gipfelFelder(d: EditorPeakDetail): GipfelFelder {
    return {
        name: d.name,
        art: d.subtype,
        merkmale: d.merkmale ?? [],
        hoehe: d.height,
        anzeigen: d.showName,
        x: d.position[0],
        y: d.position[1],
    };
}

/** Die Merkmale in der Folge des Katalogs (wie der Server sie speichert): So gleichen sich zwei gleiche Mengen. */
export const merkmaleGeordnet = (merkmale: readonly string[]): LandmarkenMerkmal[] =>
    LANDMARKEN_MERKMALE.filter((merkmal) => merkmale.includes(merkmal));

const gleicheMerkmale = (a: readonly string[], b: readonly string[]): boolean =>
    merkmaleGeordnet(a).join() === merkmaleGeordnet(b).join();

/** Was sich zwischen zwei Ständen der Felder unterscheidet, als Namen der Felder. */
function unterschiede(a: GipfelFelder, b: GipfelFelder): string[] {
    const raus: string[] = [];
    if (a.name.trim() !== b.name.trim()) raus.push("name");
    if (a.art !== b.art) raus.push("art");
    if (!gleicheMerkmale(a.merkmale, b.merkmale)) raus.push("merkmale");
    if (a.hoehe !== b.hoehe) raus.push("hoehe");
    if (a.anzeigen !== b.anzeigen) raus.push("anzeigen");
    if (a.x !== b.x || a.y !== b.y) raus.push("lage");
    return raus;
}

export function createGipfelArt(
    daten: GipfelDaten,
): BearbeitungsArt<EditorPeakDetail, GipfelFelder, never, PeakUpdateBody> {
    return {
        sperrArt: "peak",
        lade: (id, signal) => daten.lies(id, signal),
        felder: gipfelFelder,
        operation(d, start, jetzt, operationId) {
            const changes: { -readonly [K in keyof PeakChanges]: PeakChanges[K] } = {};
            const a = start.felder;
            const b = jetzt.felder;
            if (b.name.trim() !== a.name.trim()) changes.name = b.name.trim();
            if (b.art !== a.art) changes.subtype = b.art;
            // „Nur Gelände“ nimmt der Server beim Wechsel zu einer Art ohne Gelände mit; schicken darf man es dann nicht.
            const merkmale = merkmaleGeordnet(b.merkmale).filter((merkmal) => merkmaleDerArt(b.art).includes(merkmal));
            if (!gleicheMerkmale(merkmale, a.merkmale)) changes.merkmale = merkmale;
            // Ohne Gelände keine Höhe: Der Server leert sie mit dem Wechsel der Art.
            if (formtGelaende(b.art) && b.hoehe !== undefined && (b.hoehe !== a.hoehe || b.art !== a.art))
                changes.height = b.hoehe;
            if (b.anzeigen !== a.anzeigen) changes.showName = b.anzeigen;
            if (b.x !== a.x || b.y !== a.y) changes.position = [b.x, b.y];
            return Object.keys(changes).length === 0 ? undefined : { operationId, baseRevision: d.revision, changes };
        },
        schreibe: (id, body) => daten.schreibe(id, body),
        geaendert: (d, stand) => unterschiede(gipfelFelder(d), stand.felder),
        fremde: (vorher, jetzt) => unterschiede(gipfelFelder(vorher), gipfelFelder(jetzt)),
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = gipfelFelder(vorher);
            const neu = gipfelFelder(jetzt);
            const eigen = stand.felder;
            const eigene = new Set(unterschiede(alt, eigen));
            return {
                felder: {
                    name: eigene.has("name") ? eigen.name : neu.name,
                    art: eigene.has("art") ? eigen.art : neu.art,
                    merkmale: eigene.has("merkmale") ? eigen.merkmale : neu.merkmale,
                    hoehe: eigene.has("hoehe") ? eigen.hoehe : neu.hoehe,
                    anzeigen: eigene.has("anzeigen") ? eigen.anzeigen : neu.anzeigen,
                    x: eigene.has("lage") ? eigen.x : neu.x,
                    y: eigene.has("lage") ? eigen.y : neu.y,
                },
                form: undefined,
            };
        },
        pruefe(_d, stand) {
            if (stand.felder.name.trim() === "") return t("landschaftseditor.gipfel.grund.name");
            const hoehe = formtGelaende(stand.felder.art) ? stand.felder.hoehe : undefined;
            if (hoehe !== undefined && (!Number.isInteger(hoehe) || hoehe < 0 || hoehe > PEAK_HEIGHT_MAX))
                return t("landschaftseditor.gipfel.grund.hoehe", { max: String(PEAK_HEIGHT_MAX) });
            return undefined;
        },
        sicherung: {
            // 2: mit Landmarkenart und Merkmalen (WI-0271 L4); ein älterer Entwurf ohne sie kommt nicht zurück.
            version: 2,
            aus: (stand) => stand,
            ein(wert) {
                const s = wert as Partial<GipfelStand> | null;
                const f = s?.felder;
                if (f === undefined || typeof f.name !== "string" || typeof f.anzeigen !== "boolean") return undefined;
                if (typeof f.x !== "number" || typeof f.y !== "number") return undefined;
                if (typeof f.art !== "string" || !istLandmarkenArt(f.art) || !Array.isArray(f.merkmale))
                    return undefined;
                return { felder: f, form: undefined };
            },
        },
    };
}
