import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WikiTransportFehler } from "./fehler.ts";

/**
 * Der Ort des Takts (WI-0253 B-1): EIN Ordner für den ganzen Host, in dem alle Prozesse, beide Umgebungen und jede Anfrage dieselben
 * Dateien sehen (Vermerk der letzten Anfrage, Schutz-Zustand, Bot-Sitzung). Hier liegen die drei Dinge, die jede dieser Dateien braucht:
 * der Ordner selbst, eine Sperre über Prozessgrenzen und das atomare Lesen und Schreiben.
 *
 * 🔴 GESCHLOSSEN STATT UNGEDROSSELT. Fehlt der Ordner in der Konfiguration, ist er nicht anlegbar oder nicht beschreibbar, oder ist die Sperre
 * nicht zu bekommen, wirft jeder Aufruf `takt_nicht_nutzbar` beziehungsweise `takt_sperre`, und es geht keine Anfrage hinaus. Legacy fiel
 * ohne Vermerk auf ein prozesslokales Zählen zurück und feuerte damit in jedem Prozess bei null an (die „Pause“ jeder Anfrage war null).
 *
 * Die Sperre ist eine Datei, die mit `wx` (nur anlegen, nie überschreiben) entsteht und nur Millisekunden hält: Lesen, Platz rechnen,
 * Schreiben. Geschlafen wird nie unter ihr. Eine Sperre, die ein abgestürzter Prozess zurückließ, gilt nach `sperreVeraltetMs` als frei.
 */

export interface TaktOrtOptionen {
    /** Der Ordner (`WIKI_TAKT_ROOT`); `undefined`: nicht eingerichtet. */
    verzeichnis: string | undefined;
    /** Die Uhr in Unix-Millisekunden; nur Tests ersetzen sie. */
    jetzt?: (() => number) | undefined;
    schlafe?: ((ms: number, signal?: AbortSignal) => Promise<void>) | undefined;
    /** Wie lange auf die Sperre gewartet wird, und ab wann eine liegengebliebene als frei gilt. */
    sperreWartetMs?: number | undefined;
    sperreVeraltetMs?: number | undefined;
}

export interface TaktOrt {
    jetzt(): number;
    schlafe(ms: number, signal?: AbortSignal): Promise<void>;
    /** Führt `arbeit` unter der Sperre über Prozessgrenzen aus; der Ordner ist dann da. */
    mitSperre<T>(arbeit: (verzeichnis: string) => Promise<T>): Promise<T>;
    /** Der Ordner, ohne Sperre (nur zum Lesen); wirft, wenn er nicht eingerichtet oder nicht anlegbar ist. */
    ordner(): Promise<string>;
}

const SPERR_DATEI = "takt.lock";
/** Fehler, die „ein anderer hält die Sperre“ heißen (Windows meldet eine eben gelöschte Datei als EPERM oder EBUSY). */
const SPERRE_BELEGT = new Set(["EEXIST", "EPERM", "EBUSY"]);

const echteSchlafe = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(new WikiTransportFehler("abgebrochen", "Abgebrochen"));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", beiAbbruch);
            resolve();
        }, ms);
        const beiAbbruch = (): void => {
            clearTimeout(timer);
            reject(new WikiTransportFehler("abgebrochen", "Abgebrochen"));
        };
        signal?.addEventListener("abort", beiAbbruch, { once: true });
    });

function codeVon(fehler: unknown): string {
    const code = (fehler as { code?: unknown }).code;
    return typeof code === "string" ? code : "unbekannt";
}

function nichtNutzbar(grund: string, fehler?: unknown): WikiTransportFehler {
    const zusatz = fehler === undefined ? "" : ` (${codeVon(fehler)})`;
    return new WikiTransportFehler(
        "takt_nicht_nutzbar",
        `Der Takt der Wiki-Anfragen ist nicht nutzbar: ${grund}${zusatz}`,
    );
}

export function erzeugeTaktOrt(optionen: TaktOrtOptionen): TaktOrt {
    const jetzt = optionen.jetzt ?? (() => Date.now());
    const schlafe = optionen.schlafe ?? echteSchlafe;
    const wartetMs = optionen.sperreWartetMs ?? 5_000;
    const veraltetMs = optionen.sperreVeraltetMs ?? 15_000;
    let bereit: Promise<string> | null = null;

    const ordner = (): Promise<string> => {
        const verzeichnis = optionen.verzeichnis;
        if (verzeichnis === undefined) {
            return Promise.reject(nichtNutzbar("kein Ordner eingerichtet (WIKI_TAKT_ROOT)"));
        }
        bereit ??= mkdir(verzeichnis, { recursive: true, mode: 0o770 }).then(
            () => verzeichnis,
            (fehler: unknown) => {
                bereit = null;
                throw nichtNutzbar("der Ordner ist nicht anlegbar", fehler);
            },
        );
        return bereit;
    };

    async function sperreNehmen(verzeichnis: string): Promise<{ datei: string; marke: string }> {
        const datei = join(verzeichnis, SPERR_DATEI);
        const marke = `${String(process.pid)}-${randomBytes(6).toString("hex")}`;
        const frist = jetzt() + wartetMs;
        for (;;) {
            try {
                // 0660 wie `anmeldung.json`: Die Sperre teilen beide Dienstbenutzer des Hosts.
                const griff = await open(datei, "wx", 0o660);
                try {
                    await griff.writeFile(marke);
                } finally {
                    await griff.close();
                }
                return { datei, marke };
            } catch (fehler) {
                if (!SPERRE_BELEGT.has(codeVon(fehler))) throw nichtNutzbar("die Sperre ist nicht anlegbar", fehler);
            }
            // Eine liegengebliebene Sperre (abgestürzter Prozess) wegräumen; wer sie zuerst wegnimmt, gewinnt.
            try {
                const alter = jetzt() - (await stat(datei)).mtimeMs;
                if (alter > veraltetMs) {
                    await unlink(datei).catch(() => undefined);
                    continue;
                }
            } catch {
                // Weg ist sie schon: gleich noch einmal versuchen.
                continue;
            }
            if (jetzt() > frist) {
                throw new WikiTransportFehler(
                    "takt_sperre",
                    "Die Sperre um den Takt der Wiki-Anfragen war nicht zu bekommen",
                    {
                        wiederholbar: true,
                    },
                );
            }
            await schlafe(10 + Math.floor(Math.random() * 30));
        }
    }

    async function sperreGeben(sperre: { datei: string; marke: string }): Promise<void> {
        // Nur die eigene Sperre löschen: Hat ein anderer eine veraltete weggeräumt und neu angelegt, gehört sie ihm.
        try {
            if ((await readFile(sperre.datei, "utf8")) === sperre.marke) await unlink(sperre.datei);
        } catch {
            // Schon weg: nichts zu tun.
        }
    }

    return {
        jetzt,
        schlafe,
        ordner,
        async mitSperre<T>(arbeit: (verzeichnis: string) => Promise<T>): Promise<T> {
            const verzeichnis = await ordner();
            const sperre = await sperreNehmen(verzeichnis);
            try {
                return await arbeit(verzeichnis);
            } finally {
                await sperreGeben(sperre);
            }
        },
    };
}

/** Liest eine Datei des Takts; `null`, wenn es sie nicht gibt. Jeder andere Fehler heißt „nicht nutzbar“. */
export async function leseDatei(pfad: string): Promise<string | null> {
    try {
        return await readFile(pfad, "utf8");
    } catch (fehler) {
        if (codeVon(fehler) === "ENOENT") return null;
        throw nichtNutzbar("eine Datei ist nicht lesbar", fehler);
    }
}

/**
 * Schreibt atomar: in eine Nachbardatei, dann `rename` darüber. Ein Leser sieht nie eine halbe Datei, und ein Abbruch mitten im Schreiben
 * lässt die alte stehen. Schlägt das Schreiben fehl, ist der Takt nicht nutzbar (Quote voll, Rechte): nie ein stiller Erfolg.
 */
export async function schreibeAtomar(pfad: string, text: string, modus = 0o660): Promise<void> {
    const zwischen = `${pfad}.${randomBytes(4).toString("hex")}.tmp`;
    try {
        await writeFile(zwischen, text, { mode: modus });
        await rename(zwischen, pfad);
    } catch (fehler) {
        await unlink(zwischen).catch(() => undefined);
        throw nichtNutzbar("eine Datei ist nicht schreibbar", fehler);
    }
}
