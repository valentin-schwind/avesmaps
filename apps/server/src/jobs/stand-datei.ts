import {
    leseWarteschlangeStand,
    warteschlangeStandVeraltet,
    type WarteschlangeStand,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { createStatusFileReader, type StatusFileReader } from "../system/status-files.ts";

/**
 * Der Stand der gemeinsamen Warteschlange lesen (WI-0163 §5.1): die Datei, die der Dirigent auf dem Host in jedem Takt schreibt
 * (`QUEUE_STAND_FILE`, Form `WarteschlangeStand`). Muster und Leser wie Claudios Statusdateien (`system/status-files.ts`): ein
 * Leser je Instanz, eine WARN-Zeile je unlesbarem Inhalt, nie der rohe Inhalt an den Browser.
 *
 * Die Lagen:
 *
 * - `nicht_eingerichtet`: keine Variable. Die App zeigt nur die eigene Tafel, wie bis WI-0163 (lokal ohne Dirigent, Tests).
 * - `fehlt`: Variable gesetzt, Datei nicht da (der Dirigent hat noch nie geschrieben).
 * - `unlesbar`: Datei da, aber keine lesbare Form.
 * - `veraltet`: älter als `WARTESCHLANGE_STAND_ALT_S` (30 s): Der Dirigent meldet sich nicht.
 * - `ok`: frisch. Nur dann gelten Reihe, Gründe und die wirksame Pause aus dem Stand.
 *
 * 🔴 Alles außer `ok` und `nicht_eingerichtet` heißt „Zustand unbekannt“, nie „läuft“ (WI-0163 §1.7). Gelesen wird tolerant:
 * Unbekannte Felder bleiben unbeachtet (`leseWarteschlangeStand`), denn der Dirigent läuft aus dem Stage-Stand, Production liest
 * womöglich mit einem älteren Release.
 *
 * Zwischengespeichert wird nur kurz (`STAND_CACHE_MS`): Der Dirigent schreibt alle 2 s, und ein Stand von 30 s gilt schon als alt.
 * Die Frische rechnet jeder Aufruf an seiner eigenen Uhr; der Zwischenspeicher hält nur das Lesen der Datei.
 */

/** So lange gilt ein gelesener Inhalt je Instanz; der Dirigent schreibt in jedem Takt (2 s). */
export const STAND_CACHE_MS = 2_000;

export type StandLage =
    | { zustand: "nicht_eingerichtet" }
    | { zustand: "fehlt" | "unlesbar"; stand: null }
    | { zustand: "veraltet" | "ok"; stand: WarteschlangeStand };

export interface WarteschlangeStandLeser {
    /** Wie diese Umgebung im Stand heißt (`AVESMAPS_ENV`, sonst `development`). */
    readonly umgebung: WarteschlangeUmgebung;
    /** Ist die Datei eingerichtet (`QUEUE_STAND_FILE` gesetzt)? Ohne sie gilt alles wie bis WI-0163. */
    readonly eingerichtet: boolean;
    lage(now?: Date): Promise<StandLage>;
}

export interface StandLeserOptionen {
    warn?: (message: string) => void;
    clock?: () => number;
    /** Für Tests und die Kommandozeile: `0` liest jedes Mal neu. */
    ttlMs?: number;
}

export function createWarteschlangeStandLeser(
    file: string | undefined,
    umgebung: WarteschlangeUmgebung,
    options: StandLeserOptionen = {},
): WarteschlangeStandLeser {
    const eingerichtet = file !== undefined && file !== "";
    const reader: StatusFileReader<WarteschlangeStand> = createStatusFileReader(
        file,
        "der Warteschlange",
        leseWarteschlangeStand,
        {
            ttlMs: options.ttlMs ?? STAND_CACHE_MS,
            ...(options.warn ? { warn: options.warn } : {}),
            ...(options.clock ? { clock: options.clock } : {}),
        },
    );
    return {
        umgebung,
        eingerichtet,
        async lage(now = new Date()): Promise<StandLage> {
            if (!eingerichtet) return { zustand: "nicht_eingerichtet" };
            const gelesen = await reader.read();
            if (gelesen.art === "fehlt") return { zustand: "fehlt", stand: null };
            if (gelesen.art === "unlesbar") return { zustand: "unlesbar", stand: null };
            const stand = gelesen.stand;
            return { zustand: warteschlangeStandVeraltet(stand, now.getTime()) ? "veraltet" : "ok", stand };
        },
    };
}

/** Die Lage jetzt samt dem Namen dieser Umgebung: die Form, die Übersicht, Abgleiche und Systemzustand nehmen. */
export async function standJetzt(
    leser: WarteschlangeStandLeser,
    now?: Date,
): Promise<{ lage: StandLage; umgebung: WarteschlangeUmgebung }> {
    return { lage: await leser.lage(now), umgebung: leser.umgebung };
}

/** Ein Leser, der nie etwas weiß: für Wege ohne Fastify und für Tests, die die Datei nicht brauchen. */
export function keinStand(umgebung: WarteschlangeUmgebung = "development"): WarteschlangeStandLeser {
    return createWarteschlangeStandLeser(undefined, umgebung);
}
