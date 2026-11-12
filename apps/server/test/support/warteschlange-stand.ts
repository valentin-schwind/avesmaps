import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
    WarteschlangeAuftrag,
    WarteschlangePause,
    WarteschlangeStand,
    WarteschlangeUmgebung,
} from "@avesmaps3d/shared";

/**
 * Ein Stand der gemeinsamen Warteschlange für Tests (WI-0163): so, wie der Dirigent ihn schreibt (`WarteschlangeStand`), mit
 * vernünftigen Vorgaben. `at` ist „jetzt“, damit er frisch ist; wer einen alten will, setzt ihn.
 */

export const LAEUFT: WarteschlangePause = {
    paused: false,
    umgebung: null,
    changedAt: null,
    since: null,
    by: null,
    byLabel: null,
    reason: null,
};

export function auftrag(
    umgebung: WarteschlangeUmgebung,
    teile: Partial<WarteschlangeAuftrag> & { publicId: string },
): WarteschlangeAuftrag {
    return {
        umgebung,
        id: 1,
        kind: "legacy_zug",
        label: null,
        state: "QUEUED",
        origin: "queued",
        platz: 1,
        queuedAt: "2026-10-15T03:00:00.000Z",
        startedAt: null,
        phase: null,
        progress: null,
        wartegrund: null,
        schwer: true,
        ...teile,
    };
}

export function stand(teile: Partial<WarteschlangeStand> = {}, now: Date = new Date()): WarteschlangeStand {
    return {
        schema: 1,
        at: now.toISOString(),
        dirigent: { instanz: "dirigent-test", release: "20261015T030000Z-abcdef1", taktS: 2 },
        pause: LAEUFT,
        umgebungen: [
            { name: "test", erreichbar: true, planer: true },
            { name: "staging", erreichbar: true, planer: true },
        ],
        auftraege: [],
        ...teile,
    };
}

/** Ein Ordner mit `stand.json`; `schreibe` legt den Inhalt ab (auch Kaputtes), `weg` räumt auf. */
export async function standOrdner(): Promise<{
    datei: string;
    schreibe(inhalt: unknown): Promise<void>;
    weg(): Promise<void>;
}> {
    const ordner = await mkdtemp(join(tmpdir(), "avesmaps3d-stand-"));
    const datei = join(ordner, "stand.json");
    return {
        datei,
        async schreibe(inhalt) {
            await writeFile(datei, typeof inhalt === "string" ? inhalt : JSON.stringify(inhalt), "utf8");
        },
        async weg() {
            await rm(ordner, { recursive: true, force: true });
        },
    };
}
