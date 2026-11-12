import { readFile, statfs } from "node:fs/promises";
import os from "node:os";

/**
 * Was die Anwendung selbst messen kann (WI-0127 SYS-8, SYS-0001 §3.7): Last, Kerne, Arbeitsspeicher, Auslagerung, Laufzeit, der eigene
 * Speicher und der freie Platz auf den Datenträgern von Kacheln und Medien. 🔴 Was sich nicht messen lässt, ist `null`, nie 0: Unter Windows
 * meldet Node die Last als 0, und `/proc/meminfo` gibt es nur unter Linux.
 */

export interface OsMesswerte {
    last: { eins: number; fuenf: number; fuenfzehn: number } | null;
    kerne: number | null;
    speicher: {
        gesamt: number | null;
        belegt: number | null;
        auslagerung: number | null;
        auslagerungGesamt: number | null;
    };
    laufzeit: { system: number | null; prozess: number };
    rss: number;
}

/** Die Felder aus `/proc/meminfo` in Bytes (`MemTotal`, `MemAvailable`, `SwapTotal`, `SwapFree`); fehlt die Datei, leer. */
export function leseMeminfo(text: string): Record<string, number> {
    const werte: Record<string, number> = {};
    for (const line of text.split("\n")) {
        const match = /^(\w+):\s+(\d+)\s*kB$/u.exec(line.trim());
        if (match) werte[match[1]!] = Number(match[2]) * 1024;
    }
    return werte;
}

async function meminfo(): Promise<Record<string, number> | null> {
    if (process.platform !== "linux") return null;
    try {
        return leseMeminfo(await readFile("/proc/meminfo", "utf8"));
    } catch {
        return null;
    }
}

export async function osMesswerte(platform: NodeJS.Platform = process.platform): Promise<OsMesswerte> {
    const info = await meminfo();
    const gesamt = info?.["MemTotal"] ?? os.totalmem();
    // Belegt heißt „nicht verfügbar“ (MemAvailable rechnet freigebbaren Zwischenspeicher als frei), sonst Node `freemem`.
    const verfuegbar = info?.["MemAvailable"] ?? os.freemem();
    const swapTotal = info?.["SwapTotal"];
    const swapFree = info?.["SwapFree"];
    const [eins, fuenf, fuenfzehn] = os.loadavg() as [number, number, number];
    const kerne = os.cpus().length;
    return {
        last: platform === "win32" ? null : { eins, fuenf, fuenfzehn },
        kerne: kerne > 0 ? kerne : null,
        speicher: {
            gesamt: Number.isFinite(gesamt) && gesamt > 0 ? gesamt : null,
            belegt: Number.isFinite(gesamt) && Number.isFinite(verfuegbar) ? Math.max(0, gesamt - verfuegbar) : null,
            auslagerung: swapTotal === undefined || swapFree === undefined ? null : Math.max(0, swapTotal - swapFree),
            auslagerungGesamt: swapTotal ?? null,
        },
        laufzeit: { system: Math.round(os.uptime()), prozess: Math.round(process.uptime()) },
        rss: process.memoryUsage().rss,
    };
}

/** Gesamt und frei (für Nicht-Root verfügbar) des Datenträgers, auf dem `path` liegt; `null`, wenn es den Pfad nicht gibt. */
export async function platteVon(path: string | undefined): Promise<{ gesamt: number; frei: number } | null> {
    if (path === undefined || path === "") return null;
    try {
        const stats = await statfs(path);
        return { gesamt: stats.blocks * stats.bsize, frei: stats.bavail * stats.bsize };
    } catch {
        return null;
    }
}
