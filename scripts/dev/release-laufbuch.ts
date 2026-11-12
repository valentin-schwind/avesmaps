// Das Laufbuch eines Release-Tests (WI-0248): `teile.json` im Ergebnisordner `.release-runs/<sha>/`.
//
// Der Runner führt es beim Lauf: welche Browserteile es gibt (Name, Bereiche, Zahl der Specs), welche Teile eine Wiederholung aus einem früheren
// Lauf übernahm, aus welchen Bestandteilen sich der Fingerabdruck der Umgebung zusammensetzt und wie jeder Schritt endete. Die Ansicht der
// Systemsteuerung (`release-bericht.ts`) liest es, die Wiederholung (`release-wiederholen.ts`) vergleicht damit die Umgebung. Es ist KEIN
// Teil des Nachweises: Der Nachweis Version 3 (`status.json`, Notiz) bleibt, wie Claudios Leser ihn kennen.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SchrittStatus } from "./release-ablauf.ts";

export const LAUFBUCH_DATEI = "teile.json";

export interface LaufBuchTeil {
    readonly id: string;
    readonly name: string;
    readonly bereiche: readonly string[];
    /** Wie viele Spec-Dateien der Teil umfasst. */
    readonly specs: number;
}

/** Was eine Wiederholung aus einem früheren Lauf übernahm (`uebernommen`), was neu lief (`neu`) und warum sie nichts übernahm (`grund`). */
export interface LaufBuchWiederholung {
    /** Der Ordnername des früheren Laufs unter `.release-runs`. */
    readonly von: string;
    readonly uebernommen: readonly string[];
    readonly neu: readonly string[];
    readonly grund: string | null;
}

export interface LaufBuch {
    readonly version: 1;
    readonly teile: readonly LaufBuchTeil[];
    /** Warum die Browserteile nicht laufen konnten (Teilzuordnung); sonst `null`. */
    readonly problem: string | null;
    /** Die Bestandteile des Fingerabdrucks der Umgebung (Name → SHA-256), damit eine Wiederholung sagen kann, WAS sich verändert hat. */
    readonly komponenten: Readonly<Record<string, string>>;
    readonly wiederholung: LaufBuchWiederholung | null;
    /** Wie jeder Schritt endete, sobald er endete (`lint` … `besucherpaket`, `browser-n`). */
    readonly schritte: Readonly<Record<string, { readonly status: SchrittStatus; readonly grund?: string }>>;
}

const istText = (w: unknown): w is string => typeof w === "string";
const istTextListe = (w: unknown): w is string[] => Array.isArray(w) && w.every(istText);
const STATUS: readonly string[] = ["gruen", "rot", "uebersprungen", "uebernommen"];

/** Liest das Laufbuch; `undefined`, wenn es fehlt oder nicht passt (ein Lauf aus der Zeit davor hat keines). */
export function leseLaufBuch(ordner: string): LaufBuch | undefined {
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, LAUFBUCH_DATEI), "utf8"));
        if (typeof roh !== "object" || roh === null) return undefined;
        const b = roh as Record<string, unknown>;
        if (b["version"] !== 1 || !Array.isArray(b["teile"])) return undefined;
        const teile: LaufBuchTeil[] = [];
        for (const t of b["teile"] as unknown[]) {
            const e = (t ?? {}) as Record<string, unknown>;
            if (!istText(e["id"]) || !istText(e["name"]) || !istTextListe(e["bereiche"])) return undefined;
            teile.push({
                id: e["id"],
                name: e["name"],
                bereiche: e["bereiche"],
                specs: typeof e["specs"] === "number" ? e["specs"] : 0,
            });
        }
        const komponenten: Record<string, string> = {};
        for (const [k, v] of Object.entries((b["komponenten"] ?? {}) as Record<string, unknown>))
            if (istText(v)) komponenten[k] = v;
        const schritte: Record<string, { status: SchrittStatus; grund?: string }> = {};
        for (const [k, v] of Object.entries((b["schritte"] ?? {}) as Record<string, unknown>)) {
            const e = (v ?? {}) as Record<string, unknown>;
            if (!istText(e["status"]) || !STATUS.includes(e["status"])) continue;
            schritte[k] = {
                status: e["status"] as SchrittStatus,
                ...(istText(e["grund"]) ? { grund: e["grund"] } : {}),
            };
        }
        const w = b["wiederholung"];
        let wiederholung: LaufBuchWiederholung | null = null;
        if (typeof w === "object" && w !== null) {
            const e = w as Record<string, unknown>;
            if (istText(e["von"]) && istTextListe(e["uebernommen"]) && istTextListe(e["neu"]))
                wiederholung = {
                    von: e["von"],
                    uebernommen: e["uebernommen"],
                    neu: e["neu"],
                    grund: istText(e["grund"]) ? e["grund"] : null,
                };
        }
        return {
            version: 1,
            teile,
            problem: istText(b["problem"]) ? b["problem"] : null,
            komponenten,
            wiederholung,
            schritte,
        };
    } catch {
        return undefined;
    }
}

/** Schreibt das Laufbuch ganz oder gar nicht (Hilfsdatei, dann umbenennen): Ein Leser sieht nie eine halbe Datei. */
export function schreibeLaufBuch(ordner: string, buch: LaufBuch): void {
    const ziel = join(ordner, LAUFBUCH_DATEI);
    const hilfe = `${ziel}.tmp`;
    writeFileSync(hilfe, `${JSON.stringify(buch, null, 2)}\n`);
    try {
        renameSync(hilfe, ziel);
    } catch {
        // Ein Leser hält die Zieldatei gerade offen (Windows): dann direkt schreiben.
        writeFileSync(ziel, `${JSON.stringify(buch, null, 2)}\n`);
    }
}
