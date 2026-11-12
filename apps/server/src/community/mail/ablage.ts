import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";

/**
 * Die Ablage der Mails (WI-0268 C6b; Handover `project-control/handovers/2026-10-31-wi0268-c6-mailweg-an-claudio.md`): Rohmails und Anhänge als Dateien unter `COMMUNITY_MAIL_ABLAGE`.
 *
 * - **Der Name ist der SHA-256 des Inhalts** (64 Kleinbuchstaben und Ziffern), nie ein Name aus der Mail: Aus einer Mail entsteht so kein Pfad. Gleicher Inhalt, gleiche Datei; die Datenbank kennt
 *   alle Verweise darauf.
 * - **Privat:** Datei 0600, Verzeichnis 0700 (nur der Benutzer des Prozesses), nie über Nginx ausgeliefert; Herunterladen nur über die App mit `read_mailbox`.
 * - 🔴 **Ein Pfad entsteht nur aus einem geprüften Namen** (`pfadFuer`): Alles, was nicht genau 64 Hexzeichen sind, wirft. Die App setzt den Pfad nie aus der Anfrage zusammen, sondern nimmt den Namen aus der Datenbank.
 * - **Löschen ist ein Abgleich** (`gleicheAb`): Die Datenbank entfernt die Verweise (Rohmail mit den Kontaktdaten, Anhänge mit dem Personenbezug oder dem Papierkorb), die Dateien bleiben liegen, bis der Abruf sie mit der Datenbank vergleicht und
 *   alles löscht, was kein Verweis mehr kennt. Sehr junge Dateien (Standard: eine Stunde) fasst der Abgleich nie an: Sie könnten zu einer Mail gehören, die gerade erst aufgenommen wird.
 */

const NAME = /^[0-9a-f]{64}$/u;
const TEMP = /^[0-9a-f]{64}\.[0-9a-f]{12}\.tmp$/u;

/** So jung darf eine Datei sein, ohne dass der Abgleich sie anfasst (Millisekunden). */
export const ABGLEICH_MINDESTALTER_MS = 3_600_000;
/** Eine liegengebliebene Zwischendatei (Absturz beim Schreiben) wird nach so langer Zeit gelöscht. */
const TEMP_ALTER_MS = 24 * 3_600_000;
/** So viele Namen fragt der Abgleich auf einmal bei der Datenbank an. */
const ABGLEICH_STAPEL = 1000;

export const istAblageName = (name: string): boolean => NAME.test(name);

export interface AblageDatei {
    stream: ReadStream;
    groesse: number;
}

export interface AblageAbgleich {
    /** Wie viele Dateien der Abgleich angesehen hat. */
    geprueft: number;
    /** Wie viele er gelöscht hat (Datenbank kennt sie nicht mehr). */
    geloescht: number;
}

export interface Ablage {
    /** Legt den Inhalt ab und gibt den Namen (SHA-256, Hex) zurück. Existiert die Datei, bleibt sie (ihr Zeitstempel wird erneuert). */
    schreibe(inhalt: Buffer): Promise<string>;
    /** Öffnet eine Datei zum Lesen; `undefined`, wenn es sie nicht gibt. Wirft bei einem Namen, der keiner ist. */
    oeffne(name: string): Promise<AblageDatei | undefined>;
    /**
     * Löscht, was die Datenbank nicht mehr kennt. `behalten` bekommt Namen und nennt die, die noch einen Verweis haben (Funktion `community_mail_dateien_behalten`).
     * Dateien jünger als `mindestAlterMs` und fremde Dateien (Name kein SHA-256) bleiben unberührt.
     */
    gleicheAb(
        behalten: (namen: string[]) => Promise<string[]>,
        optionen?: { mindestAlterMs?: number; jetzt?: () => number },
    ): Promise<AblageAbgleich>;
}

/** Die Ablage in einem Verzeichnis. */
export function dateiAblage(verzeichnis: string): Ablage {
    const pfadFuer = (name: string): string => {
        if (!NAME.test(name)) throw new Error("Kein Name aus der Ablage");
        return join(verzeichnis, name);
    };
    return {
        async schreibe(inhalt) {
            const name = createHash("sha256").update(inhalt).digest("hex");
            const ziel = pfadFuer(name);
            await mkdir(verzeichnis, { recursive: true, mode: 0o700 });
            try {
                const vorhanden = await stat(ziel);
                if (vorhanden.isFile() && vorhanden.size === inhalt.length) {
                    const jetzt = new Date();
                    await utimes(ziel, jetzt, jetzt);
                    return name;
                }
            } catch (fehler) {
                if ((fehler as { code?: unknown }).code !== "ENOENT") throw fehler;
            }
            const zwischen = join(verzeichnis, `${name}.${randomBytes(6).toString("hex")}.tmp`);
            const datei = await open(zwischen, "wx", 0o600);
            try {
                await datei.writeFile(inhalt);
            } finally {
                await datei.close();
            }
            await rename(zwischen, ziel);
            return name;
        },
        async oeffne(name) {
            const pfad = pfadFuer(name);
            try {
                const info = await stat(pfad);
                if (!info.isFile()) return undefined;
                return { stream: createReadStream(pfad), groesse: info.size };
            } catch (fehler) {
                if ((fehler as { code?: unknown }).code === "ENOENT") return undefined;
                throw fehler;
            }
        },
        async gleicheAb(behalten, optionen = {}) {
            const mindestAlter = optionen.mindestAlterMs ?? ABGLEICH_MINDESTALTER_MS;
            const jetzt = (optionen.jetzt ?? Date.now)();
            let eintraege: string[];
            try {
                eintraege = await readdir(verzeichnis);
            } catch (fehler) {
                if ((fehler as { code?: unknown }).code === "ENOENT") return { geprueft: 0, geloescht: 0 };
                throw fehler;
            }
            const kandidaten: string[] = [];
            let geloescht = 0;
            for (const eintrag of eintraege) {
                const pfad = join(verzeichnis, eintrag);
                if (TEMP.test(eintrag)) {
                    // Eine liegengebliebene Zwischendatei (der Prozess starb beim Schreiben).
                    try {
                        const info = await stat(pfad);
                        if (jetzt - info.mtimeMs > TEMP_ALTER_MS) {
                            await unlink(pfad);
                            geloescht += 1;
                        }
                    } catch {
                        // schon weg
                    }
                    continue;
                }
                if (!NAME.test(eintrag)) continue;
                try {
                    const info = await stat(pfad);
                    if (info.isFile() && jetzt - info.mtimeMs >= mindestAlter) kandidaten.push(eintrag);
                } catch {
                    // schon weg
                }
            }
            for (let ab = 0; ab < kandidaten.length; ab += ABGLEICH_STAPEL) {
                const stapel = kandidaten.slice(ab, ab + ABGLEICH_STAPEL);
                const bekannt = new Set(await behalten(stapel));
                for (const name of stapel) {
                    if (bekannt.has(name)) continue;
                    try {
                        await unlink(pfadFuer(name));
                        geloescht += 1;
                    } catch (fehler) {
                        if ((fehler as { code?: unknown }).code !== "ENOENT") throw fehler;
                    }
                }
            }
            return { geprueft: kandidaten.length, geloescht };
        },
    };
}
