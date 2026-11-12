import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, fromRenderLngLat, toRenderLngLat, type EditorPathDetail } from "@avesmaps3d/shared";
import type { Punkt } from "../map/geometrie/geometrie";
import type { Teilantwort, WegeditorDaten } from "./wegeditor-daten";

/**
 * „Weg hier teilen“ im Rechtsklick auf den Weg (WI-0177; Thomas 2.1 fand „Hier teilen“ nicht; der Betreiber wählte am 2026-10-19
 * „A: auch am Weg (Empfehlung)“): teilt den Abschnitt unter dem Rechtsklick an seinem inneren Stützpunkt, der dem Klick am nächsten
 * liegt, ohne dass der Modus erst beginnt. Wie „Hier teilen“ am Griff der laufenden Wegkurve (das bleibt) ist es EINE Operation
 * `path.split` gegen die Revision des Abschnitts.
 *
 * - **Wo:** im Umkreis von `UMKREIS_FANGRADIEN` Fangradien um den Klick. Außerhalb des Modus sieht man die Stützpunkte nicht; der Umkreis
 *   ist darum weiter als beim Einrasten. Liegt dort keiner, steht der Eintrag grau mit Grund (dort einen setzen).
 * - **Laden:** Die Punkte des Abschnitts liest die Seite, wenn das Kartenmenü am Weg aufgeht (`bereit`); bis dahin steht der Eintrag grau
 *   („lädt“), danach baut die Seite das Menü neu. Nach jeder Änderung an Wegen vergisst sie alles (`vergiss`).
 */

/** So viele Fangradien um den Klick sucht „Weg hier teilen“ einen inneren Stützpunkt. */
export const UMKREIS_FANGRADIEN = 3;

export type Teilstelle =
    | { readonly art: "stelle"; readonly index: number; readonly at: Punkt }
    | { readonly art: "laedt" }
    | { readonly art: "keine" };

/** Der innere Stützpunkt (nie ein Ende) am nächsten an `at`, höchstens `umkreis` entfernt; sonst keiner. */
export function naechsterInnerer(
    punkte: readonly Punkt[],
    at: Punkt,
    umkreis: number,
): { readonly index: number; readonly at: Punkt } | undefined {
    let treffer: { index: number; at: Punkt } | undefined;
    let abstand = umkreis;
    for (let i = 1; i < punkte.length - 1; i++) {
        const p = punkte[i]!;
        const d = Math.hypot(p.x - at.x, p.y - at.y);
        if (d <= abstand) {
            treffer = { index: i, at: p };
            abstand = d;
        }
    }
    return treffer;
}

/** Karteneinheiten je Bildpunkt an `at`, wie die Karte jetzt steht (wie der Maßstab der Wegkurve, waagrecht und senkrecht gemittelt). */
export function einheitenJePixel(map: MapLibreMap, at: Punkt): number {
    const space = AVENTURIA.coordinateSpace;
    const render = toRenderLngLat(space, at);
    const bild = map.project([render.lng, render.lat]);
    const weite = (dx: number, dy: number): number => {
        const p = fromRenderLngLat(space, map.unproject([bild.x + dx, bild.y + dy]));
        return Math.hypot(p.x - at.x, p.y - at.y);
    };
    return (weite(1, 0) + weite(0, 1)) / 2;
}

export interface WegHierTeilen {
    /** Erfüllt, sobald die Punkte des Abschnitts gelesen sind (oder das Lesen scheiterte); liest sie, wenn nötig. */
    bereit(publicId: string): Promise<void>;
    /** Wo geteilt würde; nicht reaktiv (das Menü liest es beim Bauen), es stößt höchstens das Lesen an. */
    stelle(publicId: string, at: Punkt | undefined, umkreis: number): Teilstelle;
    /** Teilt dort; `undefined`, wenn es keine Stelle gibt. */
    teile(publicId: string, at: Punkt | undefined, umkreis: number): Promise<Teilantwort | undefined>;
    vergiss(): void;
}

export function createWegHierTeilen(
    daten: Pick<WegeditorDaten, "weg" | "teile">,
    neueKennung: () => string = () => crypto.randomUUID(),
): WegHierTeilen {
    const gelesen = new Map<string, EditorPathDetail | null>();
    const laedt = new Map<string, Promise<void>>();
    let generation = 0;

    function bereit(publicId: string): Promise<void> {
        if (gelesen.has(publicId)) return Promise.resolve();
        const laufend = laedt.get(publicId);
        if (laufend !== undefined) return laufend;
        const meine = generation;
        const versprochen = daten
            .weg(publicId, new AbortController().signal)
            .catch(() => null)
            .then((weg) => {
                laedt.delete(publicId);
                if (meine === generation) gelesen.set(publicId, weg !== null && weg.active ? weg : null);
            });
        laedt.set(publicId, versprochen);
        return versprochen;
    }

    function stelle(publicId: string, at: Punkt | undefined, umkreis: number): Teilstelle {
        if (!gelesen.has(publicId)) {
            void bereit(publicId);
            return { art: "laedt" };
        }
        const weg = gelesen.get(publicId);
        const treffer = weg && at !== undefined ? naechsterInnerer(weg.points, at, umkreis) : undefined;
        return treffer === undefined ? { art: "keine" } : { art: "stelle", ...treffer };
    }

    return {
        bereit,
        stelle,
        async teile(publicId, at, umkreis) {
            await bereit(publicId);
            const weg = gelesen.get(publicId);
            const hier = stelle(publicId, at, umkreis);
            if (!weg || hier.art !== "stelle") return undefined;
            // Gelesen ist danach nicht mehr wahr: Der Abschnitt ist kürzer, ein neuer kam dazu.
            gelesen.delete(publicId);
            return daten.teile(publicId, {
                operationId: neueKennung(),
                baseRevision: weg.revision,
                index: hier.index,
                at: { x: hier.at.x, y: hier.at.y },
            });
        },
        vergiss() {
            generation += 1;
            gelesen.clear();
            laedt.clear();
        },
    };
}
