import { readFile } from "node:fs/promises";
import type {
    AdminSicherung,
    SicherungAntwort,
    SicherungAufbewahrung,
    SicherungLauf,
    SicherungTeil,
    SicherungZustand,
} from "@avesmaps3d/shared";
import { SICHERUNG_ANTWORTEN } from "@avesmaps3d/shared";

/**
 * Die Statusdateien von Claudio lesen (WI-0127 SYS-9 und SYS-8, SYS-0001 §3.6): die der Sicherung (`BACKUP_STATUS_FILE`) und die des
 * Systemzustands (`SYSTEM_STATUS_FILE`). Ein Leser für beide (`createStatusFileReader`).
 *
 * - **Fehlt die Variable oder die Datei:** „nicht eingerichtet“, kein Fehler. Lokal ist das der Normalfall.
 * - **Unlesbar oder falsche Form:** „unbekannt“ mit EINER WARN-Zeile je Inhalt (nicht je Anfrage).
 * - **`null` oder fehlendes Feld:** `null` („unbekannt“ in der Anzeige), nie 0. Unbekannte Felder werden ignoriert; eine höhere
 *   `schema_version` liest die bekannten Felder und meldet sie (`neueresFormat`).
 * - Gelesen wird bei Bedarf mit 30 s Zwischenspeicher je Instanz. Der Browser bekommt nie den rohen Inhalt, sondern das Lesemodell
 *   (`AdminSicherung`): keine Pfade, keine Fehlertexte aus der Datei, die Prüfsumme gekürzt.
 *
 * Bei der Sicherung zählt nicht das Alter der Datei, sondern `next_run_at`: Ist er mehr als 2 h vorbei ohne neuen Lauf, heißt der Stand
 * „überfällig“. Beim Systemzustand zählt `generated_at`: älter als 15 min heißt „veraltet“, und keine ihrer Zahlen gilt als aktuell.
 */

export const STATUS_CACHE_MS = 30_000;
/** So lange darf `next_run_at` vorbei sein, bevor die Sicherung „überfällig“ heißt (§3.6). */
export const UEBERFAELLIG_MS = 2 * 3_600_000;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const zahl = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const wahr = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);
const objekt = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
/** Ein Zeitpunkt nur, wenn er sich lesen lässt; sonst `null`. */
const moment = (value: unknown): string | null => {
    const raw = text(value);
    return raw !== null && !Number.isNaN(Date.parse(raw)) ? raw : null;
};
const eines = <T extends string>(value: unknown, erlaubt: readonly T[]): T | null =>
    typeof value === "string" && (erlaubt as readonly string[]).includes(value) ? (value as T) : null;

function lauf(value: unknown): SicherungLauf | null {
    const raw = objekt(value);
    if (raw === null) return null;
    return {
        startedAt: moment(raw["started_at"]),
        finishedAt: moment(raw["finished_at"]),
        result: eines(raw["result"], ["ok", "failed", "running"] as const),
        errorCode: text(raw["error_code"]),
        trigger: eines(raw["trigger"], ["timer", "manual"] as const),
        operationId: text(raw["operation_id"]),
    };
}

function teil(value: unknown): SicherungTeil | null {
    const raw = objekt(value);
    const kind = text(raw?.["kind"]);
    if (raw === null || kind === null) return null;
    const sha = text(raw["sha256"]);
    return {
        kind,
        bytes: zahl(raw["bytes"]),
        sha256: sha === null ? null : sha.slice(0, 12),
        encrypted: wahr(raw["encrypted"]),
        offsite: text(raw["offsite"]),
        offsiteVerifiedAt: moment(raw["offsite_verified_at"]),
    };
}

function aufbewahrung(value: unknown): SicherungAufbewahrung | null {
    const raw = objekt(value);
    if (raw === null) return null;
    return {
        local: zahl(raw["local"]),
        daily: zahl(raw["daily"]),
        weekly: zahl(raw["weekly"]),
        monthly: zahl(raw["monthly"]),
    };
}

function antwort(value: unknown): SicherungAntwort | null {
    const raw = objekt(value);
    if (raw === null) return null;
    return {
        operationId: text(raw["operation_id"]),
        at: moment(raw["at"]),
        result: eines(raw["result"], SICHERUNG_ANTWORTEN),
    };
}

/** Der Inhalt der Datei als Lesemodell; `null`, wenn er keine Statusdatei der Sicherung ist (falsche Form). */
export function parseBackupStatus(
    raw: unknown,
): (Omit<AdminSicherung, "now" | "zustand" | "anstossen"> & { letzteAnfrage: SicherungAntwort | null }) | null {
    const datei = objekt(raw);
    if (datei === null || typeof datei["schema_version"] !== "number") return null;
    const teile = (Array.isArray(datei["parts"]) ? datei["parts"] : [])
        .map(teil)
        .filter((entry): entry is SicherungTeil => entry !== null);
    const geprueft = teile
        .map((entry) => entry.offsiteVerifiedAt)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1);
    const probe = objekt(datei["last_restore_drill"]);
    return {
        stand: moment(datei["updated_at"]),
        letzterLauf: lauf(datei["last_run"]),
        letzteErfolgreiche: moment(datei["last_success_at"]),
        ausserHaus: { eingerichtet: wahr(datei["offsite_configured"]), geprueftAm: geprueft ?? null },
        probelauf:
            probe === null
                ? null
                : { at: moment(probe["at"]), result: eines(probe["result"], ["ok", "failed"] as const) },
        naechsterLauf: moment(datei["next_run_at"]),
        aufbewahrung: aufbewahrung(datei["retention"]),
        teile,
        neueresFormat: datei["schema_version"] > 1,
        letzteAnfrage: antwort(datei["last_request"]),
    };
}

/**
 * Der Zustand zu einer Uhr (§6.5): läuft · fehlgeschlagen · überfällig · aktuell, sonst unbekannt. Ein gescheiterter Lauf bleibt
 * „fehlgeschlagen“, auch wenn der nächste überfällig ist: Das Schwerere steht vorn.
 */
export function backupZustand(
    stand: Pick<AdminSicherung, "letzterLauf" | "naechsterLauf">,
    now: Date,
): Exclude<SicherungZustand, "nicht_eingerichtet"> {
    const result = stand.letzterLauf?.result ?? null;
    if (result === "running") return "laeuft";
    if (result === "failed") return "fehlgeschlagen";
    const naechster = stand.naechsterLauf === null ? null : Date.parse(stand.naechsterLauf);
    if (naechster !== null && now.getTime() > naechster + UEBERFAELLIG_MS) return "ueberfaellig";
    if (result === "ok") return "aktuell";
    return "unbekannt";
}

/** Was ein Leser liefert: die Datei fehlt (nicht eingerichtet), ist unlesbar, oder ihr Lesemodell. */
export type StatusFileRead<T> = { art: "fehlt" } | { art: "unlesbar" } | { art: "gelesen"; stand: T };

export interface StatusFileReader<T> {
    read(): Promise<StatusFileRead<T>>;
}

/**
 * Ein Leser je Instanz und Datei, mit 30 s Zwischenspeicher. Ohne Pfad: immer „fehlt“. `warn` bekommt je unlesbarem Inhalt eine Zeile
 * (ohne den Inhalt selbst); `name` sagt, welche Datei (`der Sicherung`, `des Systemzustands`).
 */
export function createStatusFileReader<T>(
    file: string | undefined,
    name: string,
    parse: (raw: unknown) => T | null,
    options: { warn?: (message: string) => void; clock?: () => number; ttlMs?: number } = {},
): StatusFileReader<T> {
    const clock = options.clock ?? Date.now;
    const ttl = options.ttlMs ?? STATUS_CACHE_MS;
    let cached: { at: number; value: StatusFileRead<T> } | undefined;
    let gewarnt: string | undefined;
    return {
        async read() {
            if (file === undefined || file === "") return { art: "fehlt" };
            if (cached !== undefined && clock() - cached.at < ttl) return cached.value;
            let value: StatusFileRead<T>;
            let inhalt: string | undefined;
            try {
                inhalt = await readFile(file, "utf8");
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code;
                if (code === "ENOENT" || code === "ENOTDIR") value = { art: "fehlt" };
                else {
                    value = { art: "unlesbar" };
                    if (gewarnt !== code) options.warn?.(`Statusdatei ${name} nicht lesbar (${code ?? "?"})`);
                    gewarnt = code;
                }
                cached = { at: clock(), value };
                return value;
            }
            let parsed: T | null;
            try {
                parsed = parse(JSON.parse(inhalt));
            } catch {
                parsed = null;
            }
            if (parsed === null) {
                value = { art: "unlesbar" };
                if (gewarnt !== inhalt) options.warn?.(`Statusdatei ${name} hat keine lesbare Form`);
                gewarnt = inhalt;
            } else {
                value = { art: "gelesen", stand: parsed };
                gewarnt = undefined;
            }
            cached = { at: clock(), value };
            return value;
        },
    };
}

export type BackupStatus = NonNullable<ReturnType<typeof parseBackupStatus>>;
export type BackupStatusReader = StatusFileReader<BackupStatus>;

/** Der Leser der Sicherung (SYS-9). */
export function createBackupStatusReader(
    file: string | undefined,
    options: { warn?: (message: string) => void; clock?: () => number; ttlMs?: number } = {},
): BackupStatusReader {
    return createStatusFileReader(file, "der Sicherung", parseBackupStatus, options);
}

// --- Systemzustand (SYS-8) ------------------------------------------------------------------------------------------------------------

/** Eine Zahl ≥ 0 (auch mit Nachkommastellen, etwa Millisekunden); sonst `null`. */
const messwert = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Die Probe der Tür von außen: wann, von wo, und je Pfad der erwartete gegen den bekommenen Code. */
export interface SystemTuer {
    at: string | null;
    von: string | null;
    proben: { url: string; erwartet: string | null; bekommen: string | null; ms: number | null }[];
}

/** Ein Dienst laut `systemctl`: Name und Zustand, beides nur als Kennung. */
export interface SystemDienst {
    name: string;
    zustand: string;
}

export interface SystemStatusFile {
    stand: string | null;
    host: string | null;
    neueresFormat: boolean;
    disks: { mount: string; gesamt: number | null; frei: number | null }[];
    /** Die Tür der **Stage** (oberste Ebene der Datei, 302/200/401); die von Production steht in `production`. */
    tuer: SystemTuer | null;
    /** Die Dienste des Hosts; `fastify` und `martin` sind hier die der Stage, die von Production stehen in `production`. */
    dienste: SystemDienst[];
    /**
     * Der eigene Abschnitt von Production (Claudio, `handovers/2026-10-14-systemzustand-production-abschnitt-an-claudia.md`, von
     * seinem Zeitgeber seit `aa5b7693` geschrieben): `system.json` ist EINE Datei für den ganzen Host, und ihre oberste Ebene
     * beschreibt `stage.avesmaps.de`. Production hat eine eigene Tür (200/200/401) und eigene Dienste `fastify`/`martin`; Form und
     * Prüfung sind dieselben wie oben.
     *
     * 🔴 `null`, solange der Abschnitt fehlt. Dann bleibt die Tür in Production „unbekannt“ und ist nie die der Stage
     * (`systemzustand.ts`, `fuerUmgebung`): Eine grüne Kachel, die die falsche Domäne beschreibt, wäre schlimmer.
     */
    production: { tuer: SystemTuer | null; dienste: SystemDienst[] } | null;
    groessen: {
        at: string | null;
        kacheln: number | null;
        medienVeroeffentlicht: number | null;
        medienPrivat: number | null;
        sicherungenLokal: number | null;
    } | null;
}

/** Ein Dienstname oder Zustand aus der Datei: nur Kennungen, kein freier Text (höchstens 40 Zeichen aus a-z, 0-9, _, -, .). */
const kennung = (value: unknown): string | null =>
    typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/u.test(value) ? value : null;
/** Eine Pfadangabe der Probe (`/`, `/anmelden`, `/api/x`): nur ein Pfad, keine Adresse. */
const probenPfad = (value: unknown): string | null =>
    typeof value === "string" && /^\/[A-Za-z0-9_./-]{0,80}$/u.test(value) ? value : null;
/** Ein Statuscode der Probe als Text (`302`); sonst `null`. */
const code = (value: unknown): string | null =>
    typeof value === "string" && /^\d{3}$/u.test(value)
        ? value
        : typeof value === "number" && Number.isInteger(value)
          ? String(value)
          : null;

/** Eine Tür aus einem Abschnitt der Datei (oberste Ebene oder `production`); ohne Abschnitt `null`. */
function tuerAus(raw: unknown): SystemTuer | null {
    const probe = objekt(raw);
    if (probe === null) return null;
    return {
        at: moment(probe["at"]),
        von: kennung(probe["from"]),
        proben: (Array.isArray(probe["checks"]) ? probe["checks"] : []).flatMap((entry) => {
            const check = objekt(entry);
            const url = check === null ? null : probenPfad(check["url"]);
            if (check === null || url === null) return [];
            return [{ url, erwartet: code(check["expect"]), bekommen: code(check["got"]), ms: messwert(check["ms"]) }];
        }),
    };
}

/** Die Dienste aus einem Abschnitt der Datei: nur Kennungen als Name und Zustand; ohne Abschnitt leer. */
function diensteAus(raw: unknown): SystemDienst[] {
    const services = objekt(raw);
    if (services === null) return [];
    return Object.entries(services).flatMap(([name, zustand]) => {
        const n = kennung(name);
        const z = kennung(zustand);
        return n === null || z === null ? [] : [{ name: n, zustand: z }];
    });
}

/** `system.json` als Lesemodell (Claudio, `handovers/2026-10-10-wi0119-systemzustand-antwort.md` Nr. 1); `null` bei falscher Form. */
export function parseSystemStatus(raw: unknown): SystemStatusFile | null {
    const datei = objekt(raw);
    if (datei === null || typeof datei["schema_version"] !== "number") return null;
    const disks = (Array.isArray(datei["disks"]) ? datei["disks"] : []).flatMap((entry) => {
        const disk = objekt(entry);
        const mount = disk === null ? null : text(disk["mount"]);
        if (disk === null || mount === null || mount.length > 120) return [];
        return [{ mount, gesamt: zahl(disk["size_bytes"]), frei: zahl(disk["free_bytes"]) }];
    });
    const sizes = objekt(datei["sizes"]);
    const production = objekt(datei["production"]);
    return {
        stand: moment(datei["generated_at"]),
        host: kennung(datei["host"]),
        neueresFormat: datei["schema_version"] > 1,
        disks,
        tuer: tuerAus(datei["door_probe"]),
        dienste: diensteAus(datei["services"]),
        production:
            production === null
                ? null
                : { tuer: tuerAus(production["door_probe"]), dienste: diensteAus(production["services"]) },
        groessen:
            sizes === null
                ? null
                : {
                      at: moment(sizes["at"]),
                      kacheln: zahl(sizes["tiles_bytes"]),
                      medienVeroeffentlicht: zahl(sizes["media_published_bytes"]),
                      medienPrivat: zahl(sizes["media_private_bytes"]),
                      sicherungenLokal: zahl(sizes["backups_local_bytes"]),
                  },
    };
}

export type SystemStatusReader = StatusFileReader<SystemStatusFile>;

/** Der Leser des Systemzustands (SYS-8). */
export function createSystemStatusReader(
    file: string | undefined,
    options: { warn?: (message: string) => void; clock?: () => number; ttlMs?: number } = {},
): SystemStatusReader {
    return createStatusFileReader(file, "des Systemzustands", parseSystemStatus, options);
}
