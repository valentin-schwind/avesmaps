import { shallowRef, type ShallowRef } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, canonColour, toRenderLngLat, type OperationReceipt } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { AnlegenArt, AnlegenModus, AnlegenStand } from "../map/geometrie/anlegen";
import { installAnlegenModus } from "../map/geometrie/anlegen-modus";
import type { FlaechenSofort, SofortTeilflaeche } from "../map/geometrie/flaechen-quelle";
import type { Punkt, Ziel } from "../map/geometrie/geometrie";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { landschaftSofort } from "./landschaft-flaechen";

/**
 * „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19 wörtlich: „gern aus zwei oder mehr punkten. ja aber in legacy war noch ein random
 * abstand dazwischen, hier soll ein schnitt exakt sein und in zwei flächen teilen und trennen. die schnittlinie soll nicht fortgeführt
 * werden - nur zwischen den punkten wo geschnitten wurde sollen kanten enstehen“).
 *
 * - **Zeichnen** der Schnittlinie im Modus „Anlegen“ des Geometrie-Moduls (`SCHNITT_ANLEGEN`): Punkt für Punkt, gerade, eingerastet an
 *   Ecken und Kanten der Teilfläche, die geschnitten wird (gelb umrissen). Gesten und Tasten wie „Neue Fläche“: Klick setzt, Doppelklick,
 *   Enter und „Fertig“ beenden, Rechtsklick und ⌫ nehmen zurück, Strg+Z und Strg+Y; Esc fragt ab dem ersten Abschnitt.
 * - **Fertig** schreibt EINE Operation `landscape.split` (Entwurf wie G4, ↺ im Verlauf); der Server schneidet exakt an der Linie, wie
 *   sie ist. Lehnt er ab (die Linie quert die Fläche nicht ganz), bleibt der Entwurf mit seinem Satz.
 * - Später dasselbe Werkzeug für die Gebiete (Register 2026-10-19): Die Art und das Zeichnen kennen keine Landschaft, nur die Andockung
 *   hier (Detail lesen, schreiben).
 * - **Die Art** gibt die Quelle (`FlaechenSofort`, WI-0261 Stufe 3), ohne Angabe die Landschaft (`landschaftSofort`): An einer Sprache schreibt dasselbe
 *   Zeichnen `sprache_flaeche.split`, und das Stück wird eine eigene Teilfläche derselben Sprache (`saetze.geschnitten`).
 */

const space = AVENTURIA.coordinateSpace;
const QUELLE = "editor-zerschneiden";
const EBENE = "editor-zerschneiden-flaeche";

type Polygon = readonly (readonly (readonly [number, number])[])[];

/** Die Schnittlinie (Spalte „Schnitt“ neben der Tafel in `anlegen.ts`): gerade, ab zwei Punkten, rastet an Ecken und Kanten ein. */
export const SCHNITT_ANLEGEN: AnlegenArt = {
    id: "schnitt",
    teilart: "linie",
    rundung: (punkte) => [...punkte],
    ziele: () => ["ecke", "kante"],
    amZiel: () => "einrasten",
    mindestens: 2,
    pruefe: (punkte) => (punkte.length < 2 ? "zuWenig" : undefined),
};

/** Ecken und Kanten der Stücke als Ziele des Einrastens. */
export function schnittZiele(teile: readonly Polygon[], objekt: string, name: string): Ziel[] {
    const ziele: Ziel[] = [];
    for (const polygon of teile)
        for (const ring of polygon)
            ring.forEach((p, i) => {
                const q = ring[(i + 1) % ring.length]!;
                ziele.push({ art: "ecke", at: { x: p[0], y: p[1] }, objekt, name });
                ziele.push({ art: "kante", at: { x: p[0], y: p[1] }, bis: { x: q[0], y: q[1] }, objekt, name });
            });
    return ziele;
}

export interface ZerschneidenSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    fangradius(): number;
    /** Geschrieben (Landschaft): Kachelrevision, Fenster und Liste neu. */
    geschrieben(quittung: OperationReceipt, regionen: readonly string[]): void;
    melde(text: string, ton: "warning" | "success"): void;
    fetcher?: typeof fetch;
}

export interface ZerschneidenLauf {
    readonly regionId: string;
    readonly areaId: string;
    readonly name: string;
    readonly stand: AnlegenStand;
    readonly phase: "zeichnet" | "schreibt";
    /** Esc mit gezeichneten Abschnitten fragt erst. */
    readonly frage: boolean;
}

export interface Zerschneiden {
    readonly laufend: Readonly<ShallowRef<ZerschneidenLauf | undefined>>;
    /** `quelle`: die Art (ohne Angabe die Landschaft). */
    starte(start: { regionId: string; areaId: string }, quelle?: FlaechenSofort): Promise<void>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): void;
    antworte(verwerfen: boolean): void;
    abbrechen(): boolean;
}

const LEER: AnlegenStand = { punkte: 0, abschnitte: 0, zurueck: false, wieder: false, fertig: "zuWenig" };

const alsFeatures = (teile: readonly Polygon[]) => ({
    type: "FeatureCollection" as const,
    features: teile.map((polygon) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
            type: "Polygon" as const,
            coordinates: polygon.map((ring) => {
                const punkte = ring.map(([x, y]) => {
                    const p = toRenderLngLat(space, { x, y });
                    return [p.lng, p.lat];
                });
                return punkte.length > 0 ? [...punkte, punkte[0]!] : punkte;
            }),
        },
    })),
});

export function createZerschneiden(seite: ZerschneidenSeite): Zerschneiden {
    const landschaft: FlaechenSofort = {
        ...landschaftSofort({ fetcher: seite.fetcher }),
        geschrieben: (quittung) =>
            seite.geschrieben(quittung, [
                ...new Set(quittung.affected.filter((x) => x.kind === "landscape").map((x) => x.id)),
            ]),
    };
    /** Die Art des laufenden Modus. */
    let art: FlaechenSofort = landschaft;
    const laufend = shallowRef<ZerschneidenLauf | undefined>(undefined);
    let modus: AnlegenModus | undefined;
    let ende: (() => void) | undefined;
    let revision = 0;

    function setze(neu: Partial<ZerschneidenLauf>): void {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...neu };
    }

    function beende(): void {
        modus?.aus();
        modus = undefined;
        ende?.();
        ende = undefined;
        laufend.value = undefined;
    }

    async function schreibe(punkte: readonly Punkt[]): Promise<void> {
        const lauf = laufend.value;
        if (lauf === undefined) return;
        setze({ phase: "schreibt", frage: false });
        modus?.sperre(true);
        const quelle = art;
        try {
            const ergebnis = await quelle.schneide(lauf.regionId, lauf.areaId, {
                operationId: crypto.randomUUID(),
                baseRevision: revision,
                line: punkte.map(({ x, y }) => [x, y]),
            });
            if (!ergebnis.ok) {
                modus?.sperre(false);
                setze({ phase: "zeichnet" });
                seite.melde(ergebnis.satz, "warning");
                return;
            }
            beende();
            quelle.geschrieben(ergebnis.wert, "zerschneiden");
            seite.melde(t(quelle.saetze.geschnitten), "success");
        } catch {
            modus?.sperre(false);
            setze({ phase: "zeichnet" });
            seite.melde(t("landschaftseditor.mitAnderer.offline"), "warning");
        }
    }

    function taste(event: KeyboardEvent): void {
        const lauf = laufend.value;
        if (lauf?.phase !== "zeichnet" || lauf.frage) return;
        const ziel = event.target as HTMLElement | null;
        if (ziel?.closest("input, textarea, select, [contenteditable='true']")) return;
        const ohne = !event.ctrlKey && !event.metaKey && !event.altKey;
        const k = event.key.toLowerCase();
        if (event.key === "Enter" && ohne) modus?.fertig();
        else if (event.key === "Backspace" && ohne) modus?.zurueck();
        else if ((event.ctrlKey || event.metaKey) && (k === "z" || k === "y")) {
            if (k === "y" || event.shiftKey) modus?.wieder();
            else modus?.zurueck();
        } else return;
        event.preventDefault();
    }

    async function starte(start: { regionId: string; areaId: string }, quelle = landschaft): Promise<void> {
        if (laufend.value !== undefined) return;
        let teil: SofortTeilflaeche | undefined;
        try {
            const gelesen = await quelle.lies(start.regionId, start.areaId);
            if (!gelesen.ok) {
                seite.melde(gelesen.satz, "warning");
                return;
            }
            teil = gelesen.wert;
        } catch {
            seite.melde(t("landschaftseditor.mitAnderer.offline"), "warning");
            return;
        }
        const k = seite.karte();
        if (teil === undefined || k === undefined || laufend.value !== undefined) return;
        revision = teil.revision;
        const teile = teil.teile;
        const ziele = schnittZiele(teile, start.areaId, teil.name);
        const neu = installAnlegenModus(k.map, k.interaction, {
            art: SCHNITT_ANLEGEN,
            ziele: () => ziele,
            fangradius: () => seite.fangradius(),
            stand: (stand) => setze({ stand }),
            fertig: (punkte) => void schreibe(punkte.map((p) => p.at)),
            abgewiesen: () => seite.melde(t("landschaftseditor.zerschneiden.zuWenig"), "warning"),
        });
        if (neu === undefined) return;
        modus = neu;
        art = quelle;
        // Die Teilfläche, die geschnitten wird, gelb umrissen (Farbcode des Betreibers: Gelb = Auswahl).
        k.map.addSource(QUELLE, { type: "geojson", data: alsFeatures(teile) });
        k.map.addLayer({
            id: EBENE,
            type: "line",
            source: QUELLE,
            paint: { "line-color": canonColour("mapSelection"), "line-width": 3 },
        });
        document.addEventListener("keydown", taste);
        const map = k.map;
        ende = () => {
            document.removeEventListener("keydown", taste);
            if (map.getLayer(EBENE) !== undefined) map.removeLayer(EBENE);
            if (map.getSource(QUELLE) !== undefined) map.removeSource(QUELLE);
        };
        laufend.value = { ...start, name: teil.name, stand: LEER, phase: "zeichnet", frage: false };
    }

    return {
        laufend,
        starte,
        zurueck: () => modus?.zurueck(),
        wieder: () => modus?.wieder(),
        verwerfen() {
            if (laufend.value?.phase !== "zeichnet") return;
            modus?.verwerfen();
            setze({ frage: false });
        },
        fertig: () => modus?.fertig(),
        antworte(verwerfen) {
            if (laufend.value === undefined) return;
            if (verwerfen) beende();
            else setze({ frage: false });
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined || jetzt.phase === "schreibt") return false;
            // Das zweite Esc beantwortet die Frage.
            if (!jetzt.frage && jetzt.stand.abschnitte > 0) {
                setze({ frage: true });
                return true;
            }
            beende();
            return true;
        },
    };
}
