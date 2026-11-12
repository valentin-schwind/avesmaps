/**
 * Messwerkzeuge des Adapters (WI-0250 Phase B): Wanduhr, CPU-Zeit des Prozesses (mit den Workern), Spitzen-RSS und die Last, die andere
 * Prozesse während des Laufs erzeugten. Die Fremdlast gehört zu jeder Messung: Auf einem Entwicklungsrechner, an dem mehrere Sitzungen
 * rechnen, sagt eine Zeit ohne sie wenig.
 */
import { cpus, freemem, platform, release, arch, totalmem, endianness } from "node:os";
import { versions } from "node:process";

export interface Messpunkt {
    /** Wanduhr in Millisekunden (nur der gemessene Aufruf, ohne Laden der Module). */
    wall_ms: number;
    /** CPU-Zeit des ganzen Prozesses (Nutzer + System, mit den Workern der Erosion). */
    cpu_ms: number;
    /** Spitzen-Arbeitssatz des Prozesses bis zum Ende des Aufrufs (monoton: bei Wiederholungen der Wert seit Prozessbeginn). */
    rss_spitze_mib: number;
    /** Arbeitssatz am Ende des Aufrufs. */
    rss_ende_mib: number;
    /** Wie viele Kerne die Maschine im Mittel auslastete, minus die des eigenen Prozesses: die Last der anderen. */
    fremdlast_kerne: number;
    /** Auslastung der ganzen Maschine in Prozent (alle Prozesse). */
    maschine_prozent: number;
}

interface CpuStand {
    belegt: number;
    gesamt: number;
}

function cpuStand(): CpuStand {
    let belegt = 0;
    let gesamt = 0;
    for (const kern of cpus()) {
        const t = kern.times;
        const alles = t.user + t.nice + t.sys + t.idle + t.irq;
        gesamt += alles;
        belegt += alles - t.idle;
    }
    return { belegt, gesamt };
}

const MIB = 1024 * 1024;
const spitzeMib = (): number => process.resourceUsage().maxRSS / 1024;

/** Gibt Zwischenspeicher frei (nur mit `--expose-gc`), damit ein Lauf nicht die Reste des vorigen zahlt. */
export function aufraeumen(): void {
    (globalThis as { gc?: () => void }).gc?.();
}

/** Misst einen Aufruf. Der Speicher wird vorher aufgeräumt. */
export async function messe<T>(f: () => T | Promise<T>): Promise<{ wert: T; messung: Messpunkt }> {
    aufraeumen();
    const c0 = process.cpuUsage();
    const s0 = cpuStand();
    const t0 = performance.now();
    const wert = await f();
    const wall_ms = performance.now() - t0;
    const s1 = cpuStand();
    const c = process.cpuUsage(c0);
    const cpu_ms = (c.user + c.system) / 1000;
    const dGesamt = s1.gesamt - s0.gesamt;
    const dBelegt = s1.belegt - s0.belegt;
    const kerneMaschine = wall_ms > 0 && dGesamt > 0 ? (dBelegt / dGesamt) * cpus().length : 0;
    const eigeneKerne = wall_ms > 0 ? cpu_ms / wall_ms : 0;
    return {
        wert,
        messung: {
            wall_ms: runde(wall_ms, 1),
            cpu_ms: runde(cpu_ms, 1),
            rss_spitze_mib: runde(spitzeMib(), 1),
            rss_ende_mib: runde(process.memoryUsage().rss / MIB, 1),
            fremdlast_kerne: runde(Math.max(0, kerneMaschine - eigeneKerne), 2),
            maschine_prozent: runde(dGesamt > 0 ? (dBelegt / dGesamt) * 100 : 0, 1),
        },
    };
}

export function runde(x: number, stellen: number): number {
    const f = 10 ** stellen;
    return Math.round(x * f) / f;
}

export function median(xs: readonly number[]): number {
    if (xs.length === 0) return Number.NaN;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Wo die Zeit zwischen zwei Markierungen bleibt: `markiere(name)` schreibt die Zeit seit der letzten Markierung unter `name` gut. */
export class Stoppuhr {
    readonly ms: Record<string, number> = {};
    private letzte = performance.now();

    neustart(): void {
        this.letzte = performance.now();
    }

    markiere(name: string): void {
        const jetzt = performance.now();
        this.ms[name] = runde((this.ms[name] ?? 0) + (jetzt - this.letzte), 1);
        this.letzte = jetzt;
    }
}

export interface Umgebung {
    node: string;
    v8: string;
    plattform: string;
    prozessor: string;
    kerne: number;
    arbeitsspeicher_gib: number;
    arbeitsspeicher_frei_mib: number;
    byteorder: string;
    erosion_arbeiter_umgebung: string | null;
    /** Die Optionen, mit denen Node lief (Heap-Grenze, `--expose-gc`). */
    node_optionen: string[];
}

export function umgebung(): Umgebung {
    const kerne = cpus();
    return {
        node: versions.node,
        v8: versions.v8,
        plattform: `${platform()} ${release()} ${arch()}`,
        prozessor: kerne[0]?.model.trim() ?? "unbekannt",
        kerne: kerne.length,
        arbeitsspeicher_gib: runde(totalmem() / 1024 ** 3, 1),
        arbeitsspeicher_frei_mib: Math.round(freemem() / MIB),
        byteorder: endianness(),
        erosion_arbeiter_umgebung: process.env["TERRAIN_EROSION_WORKERS"] ?? null,
        node_optionen: process.execArgv,
    };
}
