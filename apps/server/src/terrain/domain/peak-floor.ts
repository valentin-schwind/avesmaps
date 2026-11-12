import type { StoredRaster } from "../dem-tiles.ts";
import { createFinding, type Finding } from "../../findings.ts";
import type { DomainInputs } from "./inputs.ts";

/**
 * Gipfel unter der Grundhöhe ihres Gebirges (Betreiber 2026-10-17, Register „Höhenmodell: Darf das Gelände eines Gebirges höher liegen
 * als sein höchster benannter Gipfel?“: kein Deckel, dafür eine Warnung). Wörtlich: „der berg darf nicht vom gebirge verschluckt werden.
 * vielleicht eine warnung, wenn der berg die grundhöhe des gebirges unterschreitet wenn er aufgrund von erosion verschwinden sollte, dann
 * kann ich auch nix machen“.
 *
 * - 🔴 **Grundhöhe des Gebirges** = seine Kammhöhe `terrain_control.maximalhoehe` (Legacy-Maximalhöhe bzw. Höhenstufe); fehlt sie,
 *   die Vorgabe nach Fläche (`grundhoeheFor`, Betreiber 2026-09-27). Genau diesen Wert stempelt die Ausgangsform als Untergrenze auf
 *   Kamm und Plateau (`packages/shared/src/gebirge/`: `stempleKamm` in `ridge.ts`, `sockel` in `build.ts`): Ein Gipfel darunter liegt
 *   von Anfang an unter seinem eigenen Kamm.
 *   Nicht gemeint ist der globale Regler „Grundhöhe“ des Reiters (`continentalHeight`).
 * - **Je Paar Gipfel–Gebirge:** Ein Gipfel kann in mehreren Gebirgsflächen liegen; geprüft wird gegen jede.
 * - **Nur melden** (`AGENTS.md`, „Blockierende Prüfungen im Betrieb“): Kämme über einem Gipfel sind erlaubt, Erosion wird hingenommen.
 * - **Gelände am Gipfel und ringsum** aus dem fertigen Raster: Am Gipfel steht seine Höhe (Gipfel exakt); erst das höchste Gelände
 *   im Umkreis von `RINGSUM_E` Karteneinheiten zeigt, ob er verschluckt ist.
 */

/** Ein Paar aus Gipfel und Gebirgsfläche, in der er liegt, mit der Grundhöhe dieses Gebirges. */
export interface PeakFloor {
    peakId: string;
    areaId: string;
    gebirge: string;
    grundhoehe: number;
    /** `kammhoehe`: aus `maximalhoehe`; `vorgabe`: ohne eigenen Wert, nach Fläche. */
    quelle: "kammhoehe" | "vorgabe";
}

/** Der Umkreis, in dem „ringsum“ gemessen wird: eine Karteneinheit. */
export const RINGSUM_E = 1;

export interface GipfelUnterGrundhoehe {
    areaId: string;
    gebirge: string;
    grundhoehe: number;
    quelle: PeakFloor["quelle"];
    gipfel: { id: string; name: string; hoehe: number; gelaende: number; ringsum: number }[];
}

/** Die Höhe der Zelle unter einem Punkt und das höchste Gelände im Kreis darum (wie `verifyDomainRaster` die Gipfel liest). */
function gelaendeUm(
    raster: StoredRaster,
    x: number,
    y: number,
    radius: number,
): { am: number; ringsum: number } | null {
    const n = raster.width;
    const col = Math.floor((x - raster.originX) / raster.cell);
    const row = Math.floor((y - raster.originY) / raster.cell);
    if (col < 0 || row < 0 || col >= n || row >= raster.height) return null;
    const reichweite = Math.ceil(radius / raster.cell);
    let ringsum = 0;
    for (let r = Math.max(0, row - reichweite); r <= Math.min(raster.height - 1, row + reichweite); r += 1)
        for (let c = Math.max(0, col - reichweite); c <= Math.min(n - 1, col + reichweite); c += 1) {
            const dx = (c - col) * raster.cell;
            const dy = (r - row) * raster.cell;
            if (dx * dx + dy * dy <= radius * radius) ringsum = Math.max(ringsum, raster.samples[r * n + c]!);
        }
    return { am: raster.samples[row * n + col]!, ringsum };
}

/** Je Gebirge die Gipfel unter seiner Grundhöhe, mit dem Gelände am Gipfel und ringsum; Gebirge und Gipfel nach Name. */
export function gipfelUnterGrundhoehe(raster: StoredRaster, input: DomainInputs): GipfelUnterGrundhoehe[] {
    const peaks = new Map(input.peaks.map((peak) => [peak.id, peak]));
    const gebirge = new Map<string, GipfelUnterGrundhoehe>();
    for (const floor of input.peakFloors ?? []) {
        const peak = peaks.get(floor.peakId);
        if (peak === undefined || peak.h === null || !(peak.h < floor.grundhoehe)) continue;
        const gelaende = gelaendeUm(raster, peak.x, peak.y, RINGSUM_E);
        if (gelaende === null) continue;
        const eintrag = gebirge.get(floor.areaId) ?? {
            areaId: floor.areaId,
            gebirge: floor.gebirge,
            grundhoehe: floor.grundhoehe,
            quelle: floor.quelle,
            gipfel: [],
        };
        eintrag.gipfel.push({
            id: peak.id,
            name: peak.name,
            hoehe: peak.h,
            gelaende: gelaende.am,
            ringsum: gelaende.ringsum,
        });
        gebirge.set(floor.areaId, eintrag);
    }
    const name = new Intl.Collator("de");
    return [...gebirge.values()]
        .map((eintrag) => ({ ...eintrag, gipfel: eintrag.gipfel.sort((a, b) => name.compare(a.name, b.name)) }))
        .sort((a, b) => name.compare(a.gebirge, b.gebirge) || a.areaId.localeCompare(b.areaId));
}

const zahl = (wert: number): string => Math.round(wert).toLocaleString("de-DE");

/** Der Befund dazu; ohne betroffenen Gipfel keiner. */
export function gipfelUnterGrundhoeheFinding(liste: readonly GipfelUnterGrundhoehe[]): Finding | null {
    const paare = liste.flatMap((eintrag) => eintrag.gipfel.map((gipfel) => ({ eintrag, gipfel })));
    if (paare.length === 0) return null;
    const gipfel = new Map(paare.map(({ gipfel: g }) => [g.id, g.name]));
    const objekte = [...gipfel].map(([publicId, name]) => ({ table: "terrain_peak", publicId, name }));
    return createFinding(
        "gelaende/gipfel_unter_grundhoehe",
        `${String(gipfel.size)} Gipfel liegen unter der Grundhöhe ihres Gebirges (${String(paare.length)} Paare in ${String(liste.length)} Gebirgen); nur gemeldet, der Lauf geht weiter`,
        { gipfel: gipfel.size, paare: paare.length, gebirge: liste.length, ringsumE: RINGSUM_E },
        objekte,
        objekte.length,
        paare.map(
            ({ eintrag, gipfel: g }) =>
                `${eintrag.gebirge} (Grundhöhe ${zahl(eintrag.grundhoehe)}): ${g.name} ${zahl(g.hoehe)}, Gelände am Gipfel ${zahl(g.gelaende)}, ringsum bis ${zahl(g.ringsum)}`,
        ),
    );
}
