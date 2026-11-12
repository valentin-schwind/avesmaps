// Alte Laufordner des Release-Tests aufräumen (WI-0248): Der Runner legt je geprüftem Stand `.release-runs/<sha40>` an (Klon, node_modules, Bau,
// Datenbank-Cluster, Ergebnisse, rund 3 GB) und löschte nie etwas; die Platte lief voll, ein Lauf scheiterte an ENOSPC. Vorbild ist die Aufräumregel
// der Testpakete (`zuLoeschendePakete` in `release-fixtures.ts`).
//
// 🔴 Was bleibt: der aktuelle Lauf und der jüngste andere (höchstens zwei). Bei einer Wiederholung (`--uebernehmen <Ordner>`) belegt der Ordner des
// früheren Laufs den zweiten Platz: Er liefert die grünen Teile und fällt nie weg. Der Nachweis selbst ist dauerhaft in `refs/notes/sammellauf`
// (Git-Notizen), nicht in diesen Ordnern.
//
// 🔴 Was nie gelöscht wird: alles, dessen Name kein Laufordner ist (`aktiv`, die Sperre, und Fremdes); ein Lauf, der noch leben kann (Status `laeuft`
// innerhalb der Gesamtzeit des Runners, ein lebender PostgreSQL-Postmaster in seinem Ordner, ein lebender Starter für seine SHA); ein Ordner, der ein
// Verweis statt eines Ordners ist. Im Zweifel bleibt der Ordner liegen und das Protokoll nennt den Grund.
//
// 🔴 Junctions und Symlinks (`node_modules/@avesmaps3d/*` sind welche): Jeder Verweis unter dem Laufordner wird zuerst einzeln gelöst (nie hineingefolgt,
// `lstat` statt `stat`), erst danach wird der Ordner gelöscht. Bleibt auch nur ein Verweis stehen, bleibt der Ordner liegen (wie `vor-dem-push.ts`).
//
// Der Lauf wird nie angehalten: Jeder Fehler hier ist eine Zeile im Protokoll (`aufraeumen.txt` im Ergebnisordner), kein Abbruch. Gemessen wird der
// freie Platz vor und nach dem Aufräumen; unter `FREI_WARNUNG_BYTES` steht danach eine deutliche Warnzeile.
import { lstatSync, readdirSync, readFileSync, rmdirSync, statfsSync, unlinkSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { LAUF_ORDNER } from "./release-wiederholen.ts";

/** Wie viele Laufordner bleiben: der aktuelle und der jüngste andere. */
export const LAEUFE_BEHALTEN = 2;
/** Weniger freier Platz nach dem Aufräumen ist eine Warnung wert (ein Lauf braucht rund 3 GB, Bau und Datenbank wachsen noch). */
export const FREI_WARNUNG_BYTES = 10 * 1024 ** 3;
/** Ein Lauf, dessen Status noch `laeuft` sagt, kann nach so langer Zeit nicht mehr leben: Die Gesamtzeit des Runners sind zwölf Stunden, dazu eine Stunde Reserve. */
export const LAUF_GRENZE_MS = 13 * 3600_000;

/** Ein Laufordner unter `.release-runs`, soweit die Auswahl ihn braucht. */
export interface LaufInfo {
    readonly name: string;
    readonly ordner: string;
    /** Beginn in Millisekunden (`status.json`, sonst die Anlegezeit des Ordners: Löschen im Ordner ändert sie nicht, anders als die Änderungszeit). */
    readonly start: number;
    /** `status` der `status.json`, leer wenn nicht lesbar. */
    readonly status: string;
}

/**
 * Welche Läufe wegfallen: alle bis auf die `behalten` behaltenen. `aktuell` zählt immer zu den behaltenen und belegt einen Platz (er besteht oder
 * entsteht gleich), ebenso `erhalten` (der Ordner, den eine Wiederholung übernimmt), wenn es ihn gibt. Die übrigen Plätze gehen an die jüngsten.
 * Rein: Es wird nichts gelesen und nichts gelöscht.
 */
export function zuLoeschendeLaeufe(
    laeufe: readonly { readonly name: string; readonly start: number }[],
    behalten: number,
    aktuell: string,
    erhalten: readonly string[] = [],
): string[] {
    const vorhanden = new Set(laeufe.map((l) => l.name));
    const jung = [...laeufe].sort((a, b) => b.start - a.start || (a.name < b.name ? 1 : -1));
    const bleiben = new Set([aktuell, ...erhalten.filter((n) => vorhanden.has(n))]);
    for (const l of jung) if (bleiben.size < behalten) bleiben.add(l.name);
    return jung.filter((l) => !bleiben.has(l.name)).map((l) => l.name);
}

/** Der Laufordner `laeufe/name`; `undefined`, wenn der Name kein Laufordner ist oder der Eintrag ein Verweis oder eine Datei ist. */
export function leseLaufInfo(laeufe: string, name: string): LaufInfo | undefined {
    if (!LAUF_ORDNER.test(name)) return undefined;
    const ordner = join(laeufe, name);
    let info;
    try {
        info = lstatSync(ordner);
    } catch {
        return undefined;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) return undefined;
    let start = Number.NaN;
    let status = "";
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, "status.json"), "utf8"));
        if (typeof roh === "object" && roh !== null) {
            const s = roh as { start?: unknown; status?: unknown };
            if (typeof s.start === "string") start = Date.parse(s.start);
            if (typeof s.status === "string") status = s.status;
        }
    } catch {
        /* Kein lesbarer Status: Anlegezeit des Ordners, Status unbekannt. */
    }
    if (!Number.isFinite(start)) start = info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
    return { name, ordner, start, status };
}

/** Die Prozessnummer aus der ersten Zeile einer `postmaster.pid`; `undefined`, wenn die Datei fehlt oder nichts Brauchbares enthält. */
export function postmasterPid(ordner: string): number | undefined {
    try {
        const pid = Number(readFileSync(join(ordner, "postmaster.pid"), "utf8").split(/\r?\n/, 1)[0]);
        return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
        return undefined;
    }
}

/** Lebt der Prozess? `EPERM` heißt: ja, nur unter einem anderen Konto. */
export function lebtProzess(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === "EPERM";
    }
}

/** Alle PostgreSQL-Postmaster-Prozessnummern in den Wegwerf-Clustern (`avesmaps3d-testdb-*`) eines Laufordners. */
function clusterPids(ordner: string): number[] {
    let namen: string[];
    try {
        namen = readdirSync(ordner).filter((n) => n.startsWith("avesmaps3d-testdb-"));
    } catch {
        return [];
    }
    return namen.flatMap((n) => {
        const pid = postmasterPid(join(ordner, n, "data"));
        return pid === undefined ? [] : [pid];
    });
}

/**
 * Warum dieser Lauf nicht gelöscht werden darf; `undefined`, wenn nichts dagegen spricht.
 * - Status `laeuft` und jünger als die Gesamtzeit des Runners: Er kann noch leben.
 * - Ein Postmaster in seinem Ordner lebt: Das Löschen träfe einen laufenden Datenbankcluster.
 * - Ein Starter für seine SHA lebt (Startvermerk `baut`, vom Aufrufer gemeldet).
 */
export function grundBehalten(
    lauf: LaufInfo,
    o: {
        readonly jetzt: number;
        readonly lebt: (pid: number) => boolean;
        readonly geschuetzteShas: ReadonlySet<string>;
    },
): string | undefined {
    if (lauf.status === "laeuft" && o.jetzt - lauf.start < LAUF_GRENZE_MS)
        return "Status „laeuft“ innerhalb der Gesamtzeit des Runners: der Lauf kann noch leben";
    const pid = clusterPids(lauf.ordner).find((p) => o.lebt(p));
    if (pid !== undefined)
        return `ein Datenbank-Cluster in diesem Ordner läuft noch (PostgreSQL-Prozess ${String(pid)})`;
    if (o.geschuetzteShas.has(lauf.name.slice(0, 40))) return "ein Starter für diese SHA läuft (Startvermerk „baut“)";
    return undefined;
}

function existiert(pfad: string): boolean {
    try {
        lstatSync(pfad);
        return true;
    } catch {
        return false;
    }
}

/** Alle Junctions und Symlinks unter `ordner`, ohne einem zu folgen (`lstat` statt `stat`: Ein Verweis ist weder Ordner noch Datei). */
export function verweiseUnter(ordner: string): string[] {
    const gefunden: string[] = [];
    const offen = [ordner];
    for (let aktuell = offen.pop(); aktuell !== undefined; aktuell = offen.pop()) {
        let eintraege: string[];
        try {
            eintraege = readdirSync(aktuell);
        } catch {
            continue;
        }
        for (const name of eintraege) {
            const pfad = join(aktuell, name);
            let info;
            try {
                info = lstatSync(pfad);
            } catch {
                continue;
            }
            if (info.isSymbolicLink()) gefunden.push(pfad);
            else if (info.isDirectory()) offen.push(pfad);
        }
    }
    return gefunden;
}

export type EntfernErgebnis =
    { readonly ok: true; readonly verweise: number } | { readonly ok: false; readonly grund: string };

/**
 * Löscht einen Laufordner, ohne einem Verweis zu folgen: erst jeden Verweis einzeln lösen (nur der Verweis verschwindet, nie sein Ziel), prüfen, dass
 * keiner stehen blieb, dann den Rest. Bleibt ein Verweis, bleibt der Ordner liegen. Wirft nicht.
 */
export async function entferneLaufOrdner(ordner: string): Promise<EntfernErgebnis> {
    const verweise = verweiseUnter(ordner);
    for (const pfad of verweise) {
        try {
            rmdirSync(pfad);
        } catch {
            try {
                unlinkSync(pfad);
            } catch {
                /* bleibt stehen, siehe unten */
            }
        }
    }
    const uebrig = verweise.filter(existiert);
    if (uebrig.length > 0)
        return {
            ok: false,
            grund: `${String(uebrig.length)} Verweis(e) ließen sich nicht lösen, der Ordner bleibt liegen`,
        };
    try {
        await rm(ordner, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    } catch (e) {
        return {
            ok: false,
            grund: `Löschen fehlgeschlagen (${(e as NodeJS.ErrnoException).code ?? "Fehler"}), ein Rest bleibt liegen`,
        };
    }
    return { ok: true, verweise: verweise.length };
}

/** Der freie Platz auf dem Laufwerk von `pfad` in Bytes; `undefined`, wenn er sich nicht messen lässt. */
export function freierPlatz(pfad: string): number | undefined {
    try {
        const s = statfsSync(pfad);
        return Number(s.bavail) * Number(s.bsize);
    } catch {
        return undefined;
    }
}

/** `12,3 GB` (deutsche Schreibweise, eine Nachkommastelle); `unbekannt`, wo es keinen Wert gibt. */
export function gb(bytes: number | undefined): string {
    return bytes === undefined ? "unbekannt" : `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`;
}

export interface AufraeumOptionen {
    /** Der Ordner `.release-runs`. */
    readonly laeufe: string;
    /** Der Ordnername des Laufs, der gerade startet (die SHA). */
    readonly aktuell: string;
    /** Der Ordnername des früheren Laufs, den eine Wiederholung übernimmt (`--uebernehmen`). */
    readonly erhalten?: string;
    readonly behalten?: number;
    /** SHAs, für die ein Starter lebt (Startvermerk `baut`); ihre Ordner bleiben. */
    readonly geschuetzteShas?: ReadonlySet<string>;
    readonly jetzt?: () => number;
    readonly lebt?: (pid: number) => boolean;
    readonly freierPlatz?: (pfad: string) => number | undefined;
    /** Eine Zeile des Protokolls. */
    readonly sag?: (zeile: string) => void;
}

export interface AufraeumErgebnis {
    readonly geloescht: readonly string[];
    readonly behalten: readonly string[];
    readonly uebersprungen: readonly { readonly name: string; readonly grund: string }[];
    readonly freiVorher: number | undefined;
    readonly freiNachher: number | undefined;
    /** Nach dem Aufräumen sind weniger als `FREI_WARNUNG_BYTES` frei. */
    readonly warnung: boolean;
}

/**
 * Räumt `.release-runs` auf (siehe Kopf) und protokolliert jede Handlung. Wirft nie: Ein Fehler ist eine Zeile, nie ein Abbruch des Laufs.
 * Wer sie aufruft, hält die Sperre `aktiv`; neben ihr läuft kein anderer Runner.
 */
export async function raeumeLaeufeAuf(o: AufraeumOptionen): Promise<AufraeumErgebnis> {
    const sag = o.sag ?? ((): void => undefined);
    const messe = o.freierPlatz ?? freierPlatz;
    const behalten = o.behalten ?? LAEUFE_BEHALTEN;
    const geloescht: string[] = [];
    const uebersprungen: { name: string; grund: string }[] = [];
    const freiVorher = messe(o.laeufe);
    sag(`Aufräumen alter Läufe: freier Platz vorher ${gb(freiVorher)}`);
    let bleibt: string[] = [];
    try {
        let namen: string[] = [];
        try {
            namen = readdirSync(o.laeufe).filter((n) => LAUF_ORDNER.test(n));
        } catch {
            /* Kein Ordner, nichts aufzuräumen. */
        }
        const infos = namen.flatMap((n) => {
            const info = leseLaufInfo(o.laeufe, n);
            return info === undefined ? [] : [info];
        });
        const weg = zuLoeschendeLaeufe(infos, behalten, o.aktuell, o.erhalten === undefined ? [] : [o.erhalten]);
        bleibt = infos.map((i) => i.name).filter((n) => !weg.includes(n));
        if (!bleibt.includes(o.aktuell)) bleibt.push(o.aktuell);
        // Von alt nach neu, damit ein Abbruch mittendrin die jüngeren Läufe verschont.
        const reihenfolge = weg
            .map((n) => infos.find((i) => i.name === n))
            .filter((i): i is LaufInfo => i !== undefined)
            .sort((a, b) => a.start - b.start || (a.name < b.name ? -1 : 1));
        for (const lauf of reihenfolge) {
            const grund = grundBehalten(lauf, {
                jetzt: (o.jetzt ?? Date.now)(),
                lebt: o.lebt ?? lebtProzess,
                geschuetzteShas: o.geschuetzteShas ?? new Set(),
            });
            if (grund !== undefined) {
                uebersprungen.push({ name: lauf.name, grund });
                bleibt.push(lauf.name);
                sag(`  bleibt liegen: ${lauf.name} (${grund})`);
                continue;
            }
            const ergebnis = await entferneLaufOrdner(lauf.ordner);
            if (ergebnis.ok) {
                geloescht.push(lauf.name);
                sag(`  gelöscht: ${lauf.name} (${String(ergebnis.verweise)} Verweis(e) zuerst gelöst)`);
            } else {
                uebersprungen.push({ name: lauf.name, grund: ergebnis.grund });
                bleibt.push(lauf.name);
                sag(`  bleibt liegen: ${lauf.name} (${ergebnis.grund})`);
            }
        }
        for (const n of bleibt.filter((n) => !uebersprungen.some((u) => u.name === n)))
            sag(
                `  behalten: ${n} (${n === o.aktuell ? "aktueller Lauf" : n === o.erhalten ? "Wiederholung übernimmt ihn" : "jüngster anderer Lauf"})`,
            );
    } catch (e) {
        sag(`  Aufräumen abgebrochen (${(e as NodeJS.ErrnoException).code ?? "Fehler"}); der Lauf geht weiter`);
    }
    const freiNachher = messe(o.laeufe);
    sag(`Aufräumen alter Läufe: freier Platz nachher ${gb(freiNachher)}`);
    const warnung = freiNachher !== undefined && freiNachher < FREI_WARNUNG_BYTES;
    if (warnung)
        sag(
            `WARNUNG: Nach dem Aufräumen sind nur ${gb(freiNachher)} frei (Schwelle ${gb(FREI_WARNUNG_BYTES)}). Ein Lauf braucht rund 3 GB ` +
                "und wächst beim Bau; Platz schaffen, sonst droht ENOSPC.",
        );
    return { geloescht, behalten: bleibt, uebersprungen, freiVorher, freiNachher, warnung };
}
