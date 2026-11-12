import type { MapEventType, Map as MapLibreMap } from "maplibre-gl";
import { shallowRef, type ShallowRef } from "vue";

/**
 * Der Hinweis „Die Karte ist gerade gestört.“ in der Anwendung (WI-0127 SYS-6; Bauplan SYS-0001 §6.6; WI-0119 E2, Betreiber
 * 2026-10-09: „ein infoscreen für benutzer muss immer vorhanden sein, wenn die karte nicht lädt“).
 *
 * Die Störungsseite liefert Nginx, solange die SEITE nicht lädt. Ist die Seite schon da und die Karte lädt trotzdem nicht, weil der
 * Server dahinter nicht mehr antwortet, legt sich dieser ruhige Hinweis mit dem Satz der Störungsseite über die Karte - einer für
 * alles, keine Fehlermeldung je Kachel - und verschwindet von selbst, sobald die Antworten zurück sind.
 *
 * - **Signal sind die Kacheln der Karte:** Hinter der Tür (Stage, später Production) geht jede Anfrage über `GET /api/auth/gate`;
 *   ist der Server weg, scheitert jede Kachel. Lokal scheitern die Rasterkacheln mit Fastify und die Vektorkacheln mit der
 *   Datenbank. Gezählt werden nur Fehler, die nach Ausfall aussehen: kein Status (das Netz), 0 oder 5xx. 401 und 403 sind die Tür,
 *   404 meldet MapLibre gar nicht erst.
 * - **Erst nach einer Serie:** `SCHWELLE` solcher Fehler binnen `FENSTER_MS`, ohne eine gelungene Kachel dazwischen. Ein einzelner
 *   Aussetzer unter Last zeigt nichts.
 * - **Von selbst weg:** Jede gelungene Kachel nimmt ihn zurück. Damit das auch ohne Bewegung der Karte geschieht, fragt die Wache,
 *   solange er steht, alle `NACHFRAGE_MS` die gescheiterten Quellen neu an (`refreshTiles`) - nur dann, sonst nie.
 */
export const SCHWELLE = 3;
export const FENSTER_MS = 20_000;
export const NACHFRAGE_MS = 15_000;

/** Sieht ein Fehler nach Ausfall aus? Kein Status, 0 oder 5xx; 4xx ist eine Antwort, kein Ausfall. */
export function istAusfall(status: unknown): boolean {
    return typeof status !== "number" || status === 0 || status >= 500;
}

export interface Uhr {
    jetzt(): number;
    alle(ms: number, tun: () => void): () => void;
}

const ECHTE_UHR: Uhr = {
    jetzt: () => Date.now(),
    alle: (ms, tun) => {
        const id = setInterval(tun, ms);
        return () => clearInterval(id);
    },
};

/** Eine Kachel in der Zählung der Karte. */
export interface KachelId {
    x: number;
    y: number;
    z: number;
}

export interface StoerungsWache {
    readonly sichtbar: Readonly<ShallowRef<boolean>>;
    /** Eine Kachel ist gescheitert; `status` aus dem Fehler, dazu Quelle und Kachel, damit sie nachgefragt werden kann. */
    fehler(status: unknown, quelle?: string, kachel?: KachelId): void;
    /** Eine Kachel ist angekommen. */
    erfolg(): void;
    stop(): void;
}

/**
 * Die Wache ohne Karte: `nachfragen` bekommt je Quelle die gescheiterten Kacheln, solange der Hinweis steht.
 */
export function createStoerungsWache(
    nachfragen: (gescheitert: ReadonlyMap<string, readonly KachelId[]>) => void,
    uhr: Uhr = ECHTE_UHR,
): StoerungsWache {
    const sichtbar = shallowRef(false);
    let fehlerZeiten: number[] = [];
    const gescheitert = new Map<string, Map<string, KachelId>>();
    let stopNachfrage: (() => void) | undefined;

    function verbergen(): void {
        stopNachfrage?.();
        stopNachfrage = undefined;
        gescheitert.clear();
        sichtbar.value = false;
    }

    return {
        sichtbar,
        fehler(status, quelle, kachel) {
            if (!istAusfall(status)) return;
            const jetzt = uhr.jetzt();
            fehlerZeiten = [...fehlerZeiten.filter((zeit) => jetzt - zeit < FENSTER_MS), jetzt];
            if (quelle !== undefined && kachel !== undefined) {
                const kacheln = gescheitert.get(quelle) ?? new Map<string, KachelId>();
                kacheln.set(`${String(kachel.z)}/${String(kachel.x)}/${String(kachel.y)}`, kachel);
                gescheitert.set(quelle, kacheln);
            }
            if (!sichtbar.value && fehlerZeiten.length >= SCHWELLE) {
                sichtbar.value = true;
                stopNachfrage = uhr.alle(NACHFRAGE_MS, () =>
                    nachfragen(new Map([...gescheitert].map(([quelle, kacheln]) => [quelle, [...kacheln.values()]]))),
                );
            }
        },
        erfolg() {
            fehlerZeiten = [];
            if (sichtbar.value) verbergen();
            else gescheitert.clear();
        },
        stop: verbergen,
    };
}

/** Was die Oberfläche zeigt: eine Wache für die eine Karte der Seite. */
export const karteGestoert = shallowRef(false);

/** Nur Quellen, die ihre Kacheln über das Netz holen, zählen; eine GeoJSON-Quelle zerlegt ihre Daten im Browser. */
const NETZ_QUELLEN = new Set(["vector", "raster", "raster-dem"]);

type KachelEreignis = { sourceId?: string; source?: { type?: string }; tile?: { tileID?: { canonical?: KachelId } } };

/**
 * Hängt die Wache an die Karte. Gibt die Funktion zurück, die sie wieder abnimmt.
 *
 * 🪤 Nachgefragt wird KACHEL für Kachel (`refreshTiles(quelle, kacheln)`), nicht die ganze Quelle: Ohne Kachelliste setzt MapLibre
 * 6.10 eine gescheiterte Vektorkachel auf „lädt“, und `loadTile` wartet dann auf eine Ladung, die nie kommt (gemessen 2026-10-10:
 * alle Kacheln von `places` blieben „loading“, obwohl der Server wieder 200 antwortete). Mit der Liste lädt sie als „abgelaufen“ neu.
 */
export function installKartenStoerung(map: MapLibreMap): () => void {
    const wache = createStoerungsWache((gescheitert) => {
        for (const [quelle, kacheln] of gescheitert) {
            try {
                if (map.getSource(quelle) !== undefined) map.refreshTiles(quelle, [...kacheln]);
            } catch {
                // Die Quelle ist mit einem Stilwechsel verschwunden; ihre Nachfolgerin lädt ihre Kacheln selbst.
            }
        }
    });
    const ausDemNetz = (event: KachelEreignis): boolean =>
        event.tile !== undefined && event.tile !== null && NETZ_QUELLEN.has(event.source?.type ?? "");
    // Ein Kachelfehler trägt Quelle und Kachel am Ereignis (MapLibre `ErrorEvent(err, { tile })`, die Quelle reicht der Stil dazu).
    const onError = (event: MapEventType["error"]): void => {
        const kachel = event as MapEventType["error"] & KachelEreignis;
        if (!ausDemNetz(kachel)) return;
        wache.fehler(
            (event.error as { status?: unknown } | undefined)?.status,
            kachel.sourceId,
            kachel.tile?.tileID?.canonical,
        );
        karteGestoert.value = wache.sichtbar.value;
    };
    const onData = (event: MapEventType["sourcedata"]): void => {
        if (!ausDemNetz(event as KachelEreignis)) return;
        wache.erfolg();
        karteGestoert.value = wache.sichtbar.value;
    };
    map.on("error", onError);
    map.on("sourcedata", onData);
    return () => {
        map.off("error", onError);
        map.off("sourcedata", onData);
        wache.stop();
        karteGestoert.value = false;
    };
}
