import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

/**
 * Was die Zulassung und die Selbstmeldung vom Rechner wissen müssen (JOBS-0001 4.7).
 *
 * Linux (der VPS): `MemAvailable` und der Swap aus `/proc/meminfo`, das bisher Eingelagerte aus `/proc/vmstat` (`pswpin`), die Spitze
 * eines Prozesses (`VmHWM`) aus `/proc/<pid>/status`. Anderswo (der Entwicklungsrechner unter Windows): `os.freemem()` und kein Swap; die Spitze meldet
 * dann der Job-Prozess selbst. 🔴 Der Swap ist kein Budget: er geht in keine Rechnung der Zulassung ein, nur in den Befund
 * `swap_in_use`.
 */

export interface MemoryReading {
    /** `MemAvailable`, in MB. */
    availableMb: number;
    totalMb: number;
    /** Benutzter Swap in MB, `null`, wo es keinen Wert gibt. */
    swapUsedMb: number | null;
    /**
     * Seit dem Start des Rechners aus dem Swap eingelagert, in MB (`pswpin` mal 4 KiB); `null`, wo es keinen Wert gibt. Die Differenz
     * über einen Auftrag zeigt, ob jemand auf die Platte wartete; der Bestand im Swap allein sagt das nicht (MS9, Claudio 2026-10-19).
     */
    swapInMb?: number | null;
}

/** Eine Messung des Rechners. Im Test ein Double. */
export type MemoryProbe = () => MemoryReading | null;

const KB_PER_MB = 1024;

function kb(text: string, name: string): number | null {
    const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, "m").exec(text);
    return match?.[1] === undefined ? null : Number(match[1]);
}

/** Liest den Text von `/proc/meminfo`. */
export function parseMeminfo(text: string): MemoryReading | null {
    const available = kb(text, "MemAvailable");
    const total = kb(text, "MemTotal");
    if (available === null || total === null) return null;
    const swapTotal = kb(text, "SwapTotal");
    const swapFree = kb(text, "SwapFree");
    return {
        availableMb: Math.floor(available / KB_PER_MB),
        totalMb: Math.floor(total / KB_PER_MB),
        swapUsedMb:
            swapTotal === null || swapFree === null ? null : Math.max(0, Math.ceil((swapTotal - swapFree) / KB_PER_MB)),
    };
}

/** Liest `pswpin` aus dem Text von `/proc/vmstat` als MB (Seiten zu 4 KiB); `null` ohne den Wert. */
export function parseVmstatSwapIn(text: string): number | null {
    const match = /^pswpin\s+(\d+)$/m.exec(text);
    return match?.[1] === undefined ? null : Math.floor((Number(match[1]) * 4) / KB_PER_MB);
}

export const readSystemMemory: MemoryProbe = () => {
    if (process.platform === "linux") {
        try {
            const reading = parseMeminfo(readFileSync("/proc/meminfo", "utf8"));
            if (reading) {
                let swapInMb: number | null = null;
                try {
                    swapInMb = parseVmstatSwapIn(readFileSync("/proc/vmstat", "utf8"));
                } catch {
                    // Ohne `/proc/vmstat` kein Befund zum Swap, die Zulassung braucht ihn nicht.
                }
                return { ...reading, swapInMb };
            }
        } catch {
            // Fällt auf os zurück.
        }
    }
    return {
        availableMb: Math.floor(freemem() / 1024 / 1024),
        totalMb: Math.floor(totalmem() / 1024 / 1024),
        swapUsedMb: null,
    };
};

export interface ProcessUsage {
    /** Aktuelle Größe im Speicher (RSS), MB. */
    rssMb: number;
    /** Spitze seit dem Start des Prozesses (`VmHWM`), MB. */
    rssPeakMb: number;
}

/** Liest `VmRSS` und `VmHWM` eines Prozesses; `null`, wo es `/proc` nicht gibt oder der Prozess fort ist. */
export function readProcessUsage(pid: number): ProcessUsage | null {
    if (process.platform !== "linux") return null;
    try {
        const status = readFileSync(`/proc/${String(pid)}/status`, "utf8");
        const rss = kb(status, "VmRSS");
        const peak = kb(status, "VmHWM");
        if (rss === null && peak === null) return null;
        return {
            rssMb: Math.ceil((rss ?? peak ?? 0) / KB_PER_MB),
            rssPeakMb: Math.ceil((peak ?? rss ?? 0) / KB_PER_MB),
        };
    } catch {
        return null;
    }
}
