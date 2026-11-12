import {
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { Value } from "@sinclair/typebox/value";
import {
    ABZUG_HOLEN_URL,
    ABZUG_QUELLEN,
    AbzugHolenListe,
    istAbzugKennung,
    istAbzugSchluessel,
    type AbzugDatei,
    type AbzugQuelle,
} from "@avesmaps3d/shared";

/**
 * Der Entwicklungsrechner holt einen Abzug selbst (WI-0251; Vali 2026-10-25: „ich will keine dateien runter und wieder hochladen“). Dieses Stück
 * kann zwei Dinge: den Schlüssel je Quelle verwahren und den neuesten Abzug einer Quelle über HTTPS laden, mit Fortsetzen nach einem Abbruch.
 * Das Einspielen selbst bleibt bei `lokal.ts` und `einspielen.ts`; es hat seine eigenen Prüfungen (Prüfsummen, Zeilen, Medien, Sicherung).
 *
 * - 🔴 **Der Schlüssel liegt nur hier**: in `<Ablage>/schluessel.json` (die Ablage liegt unter `C:/avesmaps3d-data`, nie im Repository), nur für den
 *   Benutzer lesbar, und kommt in keine Antwort, kein Protokoll und keinen Fehlersatz. Der Server sagt der Oberfläche nur, FÜR WELCHE Quelle einer
 *   hinterlegt ist.
 * - **Nur diese Adresse, nie umgeleitet**: Der Schlüssel geht an die Adresse der Quelle und an keine andere (`redirect: "error"`); ohne HTTPS gibt es
 *   die Adresse nur in Tests.
 * - **Laden** (`holeAbzug`): Liste holen, den neuesten wählen, Platz prüfen (Rest der Datei plus 1 GiB), die Teil-Datei `holen-<quelle>-<kennung>.tar.part`
 *   mit `Range` fortsetzen; reißt die Verbindung ab, folgen bis zu drei weitere Versuche, danach bleibt die Teil-Datei für den nächsten Knopfdruck liegen.
 *   Teil-Dateien anderer Abzüge werden gelöscht (sie wären nur Ballast). Ein Abzug, dessen Größe nicht stimmt, wird nie weitergereicht.
 */

export const QUELLEN_ADRESSEN: Readonly<Record<AbzugQuelle, string>> = {
    staging: "https://stage.avesmaps.de",
    production: "https://avesmaps.de",
};

export const QUELLEN_NAMEN: Readonly<Record<AbzugQuelle, string>> = { staging: "Stage", production: "Production" };

const LUFT_BYTES = 1024 * 1024 * 1024;
const VERSUCHE = 4;
const STILLSTAND_MS = 60_000;
const LISTE_FRIST_MS = 30_000;

/** Ein Fehler, dessen Satz die Oberfläche der Person zeigt (kein Schlüssel, kein Pfad mit Geheimnis darin). */
export class HolenFehler extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = "HolenFehler";
        this.code = code;
    }
}

// --- Der Schlüssel je Quelle -------------------------------------------------------------------------------------------------------------------------

export interface SchluesselSpeicher {
    /** Der Wert, oder `undefined`; nur für den Aufruf an die Quelle. */
    lies(quelle: AbzugQuelle): string | undefined;
    /** Für welche Quellen einer hinterlegt ist. */
    gesetzt(): Record<AbzugQuelle, boolean>;
    /** Hinterlegt (`wert`) oder entfernt (`null`). */
    setze(quelle: AbzugQuelle, wert: string | null): void;
}

/** Macht eine Datei nur für den Benutzer lesbar: POSIX über den Modus, Windows über die Zugriffsliste (`icacls`). Scheitert still, die Datei bleibt dann wie sie ist. */
function nurFuerBenutzer(pfad: string): void {
    if (process.platform !== "win32") return;
    try {
        const benutzer = process.env["USERNAME"] ?? userInfo().username;
        execFileSync("icacls", [pfad, "/inheritance:r", "/grant:r", `${benutzer}:F`], {
            stdio: "ignore",
            windowsHide: true,
        });
    } catch {
        // Ohne icacls erbt die Datei die Rechte des Ordners.
    }
}

export function erzeugeSchluesselSpeicher(
    wurzel: string | undefined,
    schuetzen: (pfad: string) => void = nurFuerBenutzer,
): SchluesselSpeicher {
    const pfad = (): string => join(wurzel!, "schluessel.json");
    const lese = (): Partial<Record<AbzugQuelle, string>> => {
        if (wurzel === undefined || !existsSync(pfad())) return {};
        try {
            const roh: unknown = JSON.parse(readFileSync(pfad(), "utf8"));
            const aus: Partial<Record<AbzugQuelle, string>> = {};
            if (roh !== null && typeof roh === "object") {
                for (const quelle of ABZUG_QUELLEN) {
                    const wert = (roh as Record<string, unknown>)[quelle];
                    if (istAbzugSchluessel(wert)) aus[quelle] = wert;
                }
            }
            return aus;
        } catch {
            return {};
        }
    };
    return {
        lies: (quelle) => lese()[quelle],
        gesetzt: () => {
            const da = lese();
            return { staging: da.staging !== undefined, production: da.production !== undefined };
        },
        setze(quelle, wert) {
            if (wurzel === undefined)
                throw new HolenFehler(
                    "ablage",
                    "Auf diesem Rechner ist kein Ort für Abzüge eingerichtet (ABZUG_ROOT).",
                );
            const neu = { ...lese() };
            if (wert === null) delete neu[quelle];
            else neu[quelle] = wert;
            mkdirSync(wurzel, { recursive: true });
            const teil = `${pfad()}.neu`;
            writeFileSync(teil, `${JSON.stringify(neu, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
            schuetzen(teil);
            renameSync(teil, pfad());
        },
    };
}

// --- Laden -------------------------------------------------------------------------------------------------------------------------------------------

export interface HolenOptionen {
    readonly quelle: AbzugQuelle;
    /** Die Adresse der Quelle ohne Pfad, `https://stage.avesmaps.de`. */
    readonly adresse: string;
    readonly schluessel: string;
    /** Hier entstehen die Teil-Dateien. */
    readonly ordner: string;
    readonly fetch?: typeof fetch;
    /** Freie Bytes auf dem Datenträger des Ordners; `undefined`: nicht zu messen. */
    readonly freieBytes?: (ordner: string) => number | undefined;
    readonly bericht?: (stand: { kennung: string; geladen: number; gesamt: number }) => void;
    /** Wie lange eine Verbindung ohne ein Byte ausbleiben darf (Vorgabe 60 s). */
    readonly stillstandMs?: number | undefined;
    /** Wartezeit vor einem weiteren Versuch (Tests: 0). */
    readonly pauseMs?: number | undefined;
    /** Ein Abzug, der schon vollständig im Eingang liegt (ein Einspielen scheiterte): Ist es der neueste der Quelle, wird nichts geladen. */
    readonly liegt?: { readonly pfad: string; readonly kennung: string; readonly bytes: number } | undefined;
}

export interface HolenErgebnis {
    readonly kennung: string;
    readonly erstellt: string;
    readonly bytes: number;
    /** Die vollständige Datei (noch mit der Endung `.part`; der Aufrufer benennt sie um), oder `liegt.pfad`, wenn sie schon da war. */
    readonly pfad: string;
    readonly abzug: AbzugDatei;
}

function teilName(quelle: AbzugQuelle, kennung: string): string {
    return `holen-${quelle}-${kennung}.tar.part`;
}

function quellenName(quelle: AbzugQuelle): string {
    return QUELLEN_NAMEN[quelle];
}

function kopf(schluessel: string, extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${schluessel}`, accept: "application/json, application/x-tar", ...extra };
}

/** Der Satz zu einer Antwort der Quelle, die nicht 2xx war. Der Körper liefert nur den Fehlercode. */
async function antwortFehler(antwort: Response, quelle: AbzugQuelle): Promise<HolenFehler> {
    const name = quellenName(quelle);
    let code = "";
    try {
        const body = (await antwort.json()) as { error?: { code?: unknown } };
        if (typeof body?.error?.code === "string") code = body.error.code;
    } catch {
        // Kein JSON: es zählt der Status.
    }
    if (antwort.status === 401 || code.startsWith("abzug_schluessel_")) {
        return new HolenFehler(
            code === "abzug_schluessel_abgelaufen" ? "schluessel_abgelaufen" : "schluessel_ungueltig",
            code === "abzug_schluessel_abgelaufen"
                ? `Der Schlüssel für ${name} ist abgelaufen oder widerrufen. Lege dort im Datenabgleich einen neuen an und trage ihn hier ein.`
                : `${name} hat den Schlüssel nicht angenommen. Prüfe, ob er vollständig und für ${name} angelegt ist.`,
        );
    }
    if (antwort.status === 404 || code === "abzug_unbekannt") {
        return new HolenFehler(
            "unbekannt",
            `Der Abzug liegt auf ${name} nicht mehr bereit (er wird dort nach 24 Stunden gelöscht). Noch einmal holen nimmt den neuesten.`,
        );
    }
    if (antwort.status === 503) {
        return new HolenFehler(
            "nicht_bereit",
            `${name} ist gerade nicht bereit (Wartung, eingeschränkter Betrieb oder Abzüge nicht eingerichtet). Später noch einmal versuchen.`,
        );
    }
    return new HolenFehler(
        "antwort",
        `${name} antwortete unerwartet (HTTP ${String(antwort.status)}${code === "" ? "" : `, ${code}`}).`,
    );
}

function netzFehler(error: unknown, quelle: AbzugQuelle): HolenFehler {
    const grund =
        error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    return new HolenFehler("netz", `${quellenName(quelle)} ist nicht zu erreichen (${grund}).`);
}

async function holeListe(o: HolenOptionen, hole: typeof fetch): Promise<AbzugDatei[]> {
    let antwort: Response;
    try {
        antwort = await hole(`${o.adresse}${ABZUG_HOLEN_URL}/liste`, {
            headers: kopf(o.schluessel),
            redirect: "error",
            signal: AbortSignal.timeout(LISTE_FRIST_MS),
        });
    } catch (error) {
        throw netzFehler(error, o.quelle);
    }
    if (!antwort.ok) throw await antwortFehler(antwort, o.quelle);
    let body: unknown;
    try {
        body = await antwort.json();
    } catch {
        body = null;
    }
    if (!Value.Check(AbzugHolenListe, body) || body.umgebung !== o.quelle) {
        throw new HolenFehler(
            "antwort",
            `${quellenName(o.quelle)} antwortete mit einer Liste, die dieser Stand nicht versteht.`,
        );
    }
    return [...body.abzuege].sort((a, b) => b.erstellt.localeCompare(a.erstellt));
}

/** Lädt, was von der Teil-Datei noch fehlt. Wirft bei einem Abbruch der Verbindung (`netz`); der Aufrufer versucht es erneut. */
async function ladeRest(o: HolenOptionen, hole: typeof fetch, abzug: AbzugDatei, teil: string): Promise<void> {
    const vorhanden = existsSync(teil) ? statSync(teil).size : 0;
    if (vorhanden === abzug.bytes) return;
    const abbruch = new AbortController();
    const stillstand = o.stillstandMs ?? STILLSTAND_MS;
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const wach = (): void => {
        if (uhr !== undefined) clearTimeout(uhr);
        uhr = setTimeout(() => abbruch.abort(new Error("keine Daten mehr")), stillstand);
    };
    try {
        wach();
        let antwort: Response;
        try {
            antwort = await hole(`${o.adresse}${ABZUG_HOLEN_URL}/${encodeURIComponent(abzug.kennung)}/datei`, {
                headers: kopf(o.schluessel, vorhanden > 0 ? { range: `bytes=${String(vorhanden)}-` } : {}),
                redirect: "error",
                signal: abbruch.signal,
            });
        } catch (error) {
            throw netzFehler(error, o.quelle);
        }
        if (antwort.status === 416) {
            // Die Teil-Datei passt nicht (größer als der Abzug): von vorn.
            rmSync(teil, { force: true });
            throw new HolenFehler("netz", "Die Teil-Datei passte nicht und wird neu geladen.");
        }
        if (!antwort.ok) throw await antwortFehler(antwort, o.quelle);
        if (antwort.body === null) throw new HolenFehler("netz", `${quellenName(o.quelle)} schickte keine Datei.`);
        // 206: weiter ab `vorhanden`. 200: die Quelle fing von vorn an (kein Range): die Teil-Datei wird überschrieben.
        const fortsetzen = antwort.status === 206 && vorhanden > 0;
        if (fortsetzen) {
            const bereich = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(antwort.headers.get("content-range") ?? "");
            if (bereich === null || Number(bereich[1]) !== vorhanden || Number(bereich[3]) !== abzug.bytes) {
                rmSync(teil, { force: true });
                throw new HolenFehler(
                    "netz",
                    "Die Quelle setzte nicht an der richtigen Stelle fort; die Datei wird neu geladen.",
                );
            }
        }
        let geladen = fortsetzen ? vorhanden : 0;
        o.bericht?.({ kennung: abzug.kennung, geladen, gesamt: abzug.bytes });
        const zaehler = new Transform({
            transform(stueck: Buffer, _kodierung, weiter) {
                wach();
                geladen += stueck.length;
                o.bericht?.({ kennung: abzug.kennung, geladen, gesamt: abzug.bytes });
                weiter(null, stueck);
            },
        });
        try {
            await pipeline(
                Readable.fromWeb(antwort.body as unknown as WebReadableStream<Uint8Array>),
                zaehler,
                createWriteStream(teil, { flags: fortsetzen ? "a" : "w" }),
                { signal: abbruch.signal },
            );
        } catch (error) {
            throw netzFehler(error, o.quelle);
        }
    } finally {
        if (uhr !== undefined) clearTimeout(uhr);
    }
}

/** Holt den neuesten Abzug der Quelle in `ordner`; setzt eine Teil-Datei fort. Wirft `HolenFehler`. */
export async function holeAbzug(o: HolenOptionen): Promise<HolenErgebnis> {
    const hole = o.fetch ?? fetch;
    mkdirSync(o.ordner, { recursive: true });
    const abzuege = await holeListe(o, hole);
    const abzug = abzuege[0];
    if (abzug === undefined) {
        throw new HolenFehler(
            "kein_abzug",
            `Auf ${quellenName(o.quelle)} liegt kein Abzug bereit. Löse dort im Datenabgleich „Abzug erstellen“ aus (mit Passkey) und hole danach noch einmal.`,
        );
    }
    if (!istAbzugKennung(abzug.kennung)) {
        throw new HolenFehler(
            "antwort",
            `${quellenName(o.quelle)} nannte einen Abzug mit einer Kennung, die dieser Stand nicht annimmt.`,
        );
    }
    if (o.liegt !== undefined && o.liegt.kennung === abzug.kennung && o.liegt.bytes === abzug.bytes) {
        for (const teil of readdirSync(o.ordner))
            if (teil.startsWith("holen-") && teil.endsWith(".tar.part")) rmSync(join(o.ordner, teil), { force: true });
        o.bericht?.({ kennung: abzug.kennung, geladen: abzug.bytes, gesamt: abzug.bytes });
        return { kennung: abzug.kennung, erstellt: abzug.erstellt, bytes: abzug.bytes, pfad: o.liegt.pfad, abzug };
    }
    const name = teilName(o.quelle, abzug.kennung);
    const teil = join(o.ordner, name);
    // Teil-Dateien anderer Abzüge sind nur Ballast.
    for (const anderer of readdirSync(o.ordner)) {
        if (anderer.startsWith("holen-") && anderer.endsWith(".tar.part") && anderer !== name)
            rmSync(join(o.ordner, anderer), { force: true });
    }
    const vorhanden = existsSync(teil) ? statSync(teil).size : 0;
    if (vorhanden > abzug.bytes) rmSync(teil, { force: true });
    const rest = abzug.bytes - (vorhanden > abzug.bytes ? 0 : vorhanden);
    const frei = (o.freieBytes ?? (() => undefined))(o.ordner);
    if (frei !== undefined && frei < rest + LUFT_BYTES) {
        throw new HolenFehler(
            "platz",
            `Auf dem Datenträger ist zu wenig Platz für den Abzug (er braucht ${String(Math.ceil(rest / 1024 ** 3))} GB, frei sind ${String(Math.floor(frei / 1024 ** 3))} GB, dazu 1 GB Luft). Nichts wurde geladen.`,
        );
    }
    let letzter: HolenFehler | undefined;
    for (let versuch = 1; versuch <= VERSUCHE; versuch += 1) {
        try {
            await ladeRest(o, hole, abzug, teil);
            letzter = undefined;
            break;
        } catch (error) {
            if (!(error instanceof HolenFehler) || error.code !== "netz") throw error;
            letzter = error;
            if (versuch < VERSUCHE && (o.pauseMs ?? 2000) > 0)
                await new Promise((fertig) => setTimeout(fertig, o.pauseMs ?? 2000));
        }
    }
    if (letzter !== undefined) {
        const da = existsSync(teil) ? statSync(teil).size : 0;
        throw new HolenFehler(
            "netz",
            `${letzter.message} Geladen sind ${String(Math.floor(da / 1024 ** 2))} von ${String(Math.ceil(abzug.bytes / 1024 ** 2))} MB; ein neuer Versuch macht dort weiter.`,
        );
    }
    const groesse = existsSync(teil) ? statSync(teil).size : 0;
    if (groesse !== abzug.bytes) {
        rmSync(teil, { force: true });
        throw new HolenFehler(
            "antwort",
            `Die geladene Datei hat nicht die Größe, die ${quellenName(o.quelle)} nannte. Sie wurde verworfen; noch einmal holen lädt sie neu.`,
        );
    }
    return { kennung: abzug.kennung, erstellt: abzug.erstellt, bytes: groesse, pfad: teil, abzug };
}
