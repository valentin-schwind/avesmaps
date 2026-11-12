import {
    gleicheLage,
    pointInGeometry,
    punktHoeheBegrenzt,
    seePlatz,
    type EditorGebirge,
    type V12Geometry,
    type WasserHoehe,
} from "@avesmaps3d/shared";
import type { Punkt } from "../map/geometrie/geometrie";

/**
 * Flüsse und Seen im Kammeditor (WI-0249; Vali 2026-10-25: „die höhe von seen und flüssen, welche das gebirge durchqueren, sollen ebenfalls in
 * ihrer höhe verändert werden können. bei flüssen soll (nur im kammeditor) das ganze wie bei kämmen ablaufen (ein fluss wird aber nicht im
 * kammeditor erstellt, sondern automatisch erkannt und ist einfach "da" wo er ist). bei seen will man im kammeditor ebenfalls die höhe einstellen
 * können“; Vali wählte A, 2026-10-26: wirksam nur im Gelände der Fassung 19, gespeichert je Gebirge nach Lage).
 *
 * - **Erkannt** aus der Eingabe des Gebirges (`EditorGebirge.eingabe`): je Fluss jedes zusammenhängende Stück seiner Stützpunkte in der Fläche
 *   und außerhalb der Seen (im See gilt der See), je See, dessen Platz (`seePlatz`) oder ein Eckpunkt in der Fläche liegt, sein Platz. Sie sind Teile des Netzes nur zum Wählen
 *   (`Teil.fest`): hinter Kämmen, Nebengipfeln und Mulden nummeriert, ohne Ziehen, Setzen und Löschen.
 * - **Herkunft** (WI-0259): Jedes Stück weiß, aus welchem Fluss oder See der Eingabe es kommt (`herkunft`), wo es im Flussweg beginnt (`ab`) und
 *   welche Nachbarn es dort hat (`vor`, `nach`; sie gehen in die Rundung ein). So findet das Profil im Reiter „Gebirge“ seine Punkte wieder.
 * - **Höhen** stehen im Netz nach Lage (`flussHoehen`, `seeHoehen`); ohne Eintrag gilt dort die Regel des Geländes, und über dem Punkt steht
 *   keine Zahl (Vali 2026-10-26: eine Zahl, die Höhe aus dem Kamm, sonst nichts). Der Spiegel eines Sees ist EIN Wert für den ganzen See.
 */

export interface WasserTeil {
    readonly art: "fluss" | "see";
    readonly name: string;
    /** Fluss: die Stützpunkte dieses Stücks in der Fläche, in ihrer Folge; See: sein Platz. */
    readonly punkte: readonly Punkt[];
    /** Nur am See: seine Fläche (sein Spiegel gilt für jeden Punkt in ihr). */
    readonly g?: V12Geometry;
    /** Woher das Stück kommt (WI-0259): beim Fluss der Index in `eingabe.fluesse`, beim See der in `eingabe.seen`. */
    readonly herkunft: number;
    /** Beim Fluss: der Index des ersten Punkts dieses Stücks im ganzen Flussweg (`fluss.p`); beim See 0. */
    readonly ab: number;
    /**
     * Beim Fluss: die Nachbarn des Stücks im Flussweg, davor und dahinter, auch wenn sie außerhalb der Fläche oder im See liegen (WI-0259). Sie
     * werden nicht gezeichnet, aber die Rundung wie auf der Karte (Catmull-Rom) braucht sie für die Tangenten an den Enden des Stücks.
     */
    readonly vor?: Punkt;
    readonly nach?: Punkt;
}

export interface Gewaesser {
    readonly teile: readonly WasserTeil[];
}

export const KEIN_GEWAESSER: Gewaesser = { teile: [] };

/** Flüsse und Seen eines Gebirges aus seiner Eingabe. */
export function gewaesserAus(eingabe: EditorGebirge["eingabe"] | undefined): Gewaesser {
    if (eingabe === undefined) return KEIN_GEWAESSER;
    const drin = (x: number, y: number): boolean => pointInGeometry([x, y], eingabe.geometry);
    const teile: WasserTeil[] = [];
    (eingabe.fluesse ?? []).forEach((fluss, herkunft) => {
        let stueck: Punkt[] = [];
        let ab = 0;
        const schliesse = (): void => {
            if (stueck.length > 0) {
                const davor = ab > 0 ? fluss.p[ab - 1] : undefined;
                const dahinter = fluss.p[ab + stueck.length];
                teile.push({
                    art: "fluss",
                    name: fluss.n,
                    punkte: stueck,
                    herkunft,
                    ab,
                    ...(davor === undefined ? {} : { vor: { x: davor[0], y: davor[1] } }),
                    ...(dahinter === undefined ? {} : { nach: { x: dahinter[0], y: dahinter[1] } }),
                });
            }
            stueck = [];
        };
        fluss.p.forEach(([x, y], k) => {
            // Im See gilt der See (Vali 2026-10-25: „durchquert ein fluss einen see, gilt für die beiden an der stelle nur die höhe des sees“).
            const imSee = (eingabe.seen ?? []).some((see) => pointInGeometry([x, y], see.g));
            if (drin(x, y) && !imSee) {
                if (stueck.length === 0) ab = k;
                stueck.push({ x, y });
            } else schliesse();
        });
        schliesse();
    });
    (eingabe.seen ?? []).forEach((see, herkunft) => {
        const platz = seePlatz(see.g);
        const polygone = (see.g.type === "Polygon"
            ? [see.g.coordinates]
            : see.g.coordinates) as unknown as (readonly (readonly [number, number])[])[][];
        const beruehrt =
            drin(platz.x, platz.y) ||
            polygone.some((polygon) => polygon.some((ring) => ring.some(([x, y]) => drin(x, y))));
        if (beruehrt) teile.push({ art: "see", name: see.n, punkte: [platz], g: see.g, herkunft, ab: 0 });
    });
    return { teile };
}

/** Die gespeicherte Höhe an einem Punkt eines Gewässers (`null` ohne eigene). */
export function wasserHoehe(
    netz: { flussHoehen?: readonly WasserHoehe[]; seeHoehen?: readonly WasserHoehe[] },
    teil: WasserTeil,
    at: Punkt,
): number | null {
    if (teil.art === "see")
        return netz.seeHoehen?.find((w) => teil.g !== undefined && pointInGeometry([w.x, w.y], teil.g))?.h ?? null;
    return netz.flussHoehen?.find((w) => gleicheLage(w, at))?.h ?? null;
}

/**
 * Höhen an Punkten von Gewässern setzen (`null` nimmt die eigene Höhe weg). Ein See trägt danach genau einen Eintrag an seinem Platz. Leere Listen
 * fallen weg: Ohne eigene Höhen an Gewässern ist das Netz Zeichen für Zeichen das ohne sie.
 */
export function mitWasserHoehen<N extends { flussHoehen?: WasserHoehe[]; seeHoehen?: WasserHoehe[] }>(
    netz: N,
    werte: readonly { teil: WasserTeil; at: Punkt; h: number | null }[],
): N {
    if (werte.length === 0) return netz;
    let fluesse = [...(netz.flussHoehen ?? [])];
    let seen = [...(netz.seeHoehen ?? [])];
    for (const { teil, at, h } of werte) {
        const wert = punktHoeheBegrenzt(h);
        if (teil.art === "see") {
            seen = seen.filter((w) => teil.g === undefined || !pointInGeometry([w.x, w.y], teil.g));
            if (wert !== null) seen.push({ x: at.x, y: at.y, h: wert });
        } else {
            fluesse = fluesse.filter((w) => !gleicheLage(w, at));
            if (wert !== null) fluesse.push({ x: at.x, y: at.y, h: wert });
        }
    }
    const neu = { ...netz };
    if (fluesse.length > 0) neu.flussHoehen = fluesse;
    else delete neu.flussHoehen;
    if (seen.length > 0) neu.seeHoehen = seen;
    else delete neu.seeHoehen;
    return neu;
}
