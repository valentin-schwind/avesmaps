import {
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    statfsSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Type, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
    AbzugLauf,
    type AbzugEingang,
    type AbzugLauf as AbzugLaufTyp,
    type AbzugQuelle,
    type AbzugSichtEinspielen,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import {
    EinspielenFehler,
    datenbankSatz,
    pgDumpPfad,
    spieleAbzugEin,
    type EinspielenBericht,
    type EinspielenErgebnis,
    type EinspielenOptionen,
} from "./einspielen.ts";
import { dateinameFuer } from "./ablage.ts";
import {
    HolenFehler,
    QUELLEN_ADRESSEN,
    QUELLEN_NAMEN,
    erzeugeSchluesselSpeicher,
    holeAbzug,
    type SchluesselSpeicher,
} from "./holen.ts";
import { leseKatalog } from "./katalog.ts";
import { medienSumme } from "./medien.ts";
import { liesAbzug, pruefeAbzug } from "./pruefen.ts";
import type { GeladeneRegeln } from "./regeln.ts";

/**
 * Das lokale Einspielen als Dienst der Instanz (WI-0251): die Datei, die bereitliegt, und der Lauf, der sie einspielt. Der Lauf lebt im
 * Speicher dieses Prozesses; Eingang und Ergebnis des letzten Laufs stehen zusätzlich als kleine Dateien in der Ablage, damit ein Neustart des
 * Servers (der Entwicklungsserver startet bei jeder Änderung neu) nichts vergessen macht. Ein Lauf, der mit dem Prozess endet, bricht ab: Die
 * Transaktion der Datenbank wird dann zurückgenommen, es ist nichts verändert.
 *
 *     <Ablage>/eingang/aktuell.tar        die hochgeladene Datei (höchstens eine; bleibt liegen, solange Mediendateien offen sind)
 *     <Ablage>/eingang/aktuell.json       Name der Datei und Zeitpunkt
 *     <Ablage>/letzter-lauf.json          Ergebnis des letzten Einspielens
 *     <Ablage>/sicherung/vorher-….dump    die Sicherungen vor jedem Ersetzen
 */
export interface LokalDienstOptionen {
    readonly db: Queryable;
    readonly databaseUrl: string | undefined;
    readonly wurzel: string | undefined;
    readonly regeln: GeladeneRegeln;
    /** `MEDIA_ROOT` dieser Instanz: wohin die Mediendateien des Abzugs kommen. */
    readonly medienWurzel?: string | undefined;
    /** `undefined`: suchen; `null`: es gibt keins (Tests). */
    readonly pgDump?: string | null | undefined;
    /** Nur Tests: ersetzt das echte Einspielen. */
    readonly einspielen?: ((optionen: EinspielenOptionen) => Promise<EinspielenErgebnis>) | undefined;
    readonly jetzt?: () => Date;
    readonly warn?: (meldung: string) => void;
    /** Wo die Quellen liegen (Vorgabe `QUELLEN_ADRESSEN`: HTTPS); nur Tests und Entwicklung nehmen eine andere. */
    readonly quellen?: Partial<Record<AbzugQuelle, string>> | undefined;
    /** Nur Tests: ersetzt `fetch`, mit dem der Abzug geholt wird. */
    readonly fetch?: typeof fetch | undefined;
    /** Nur Tests: Wartezeit zwischen den Versuchen und Frist ohne Daten. */
    readonly pauseMs?: number | undefined;
    readonly stillstandMs?: number | undefined;
    /** Nur Tests: ein anderer Speicher für die Schlüssel (Vorgabe: `<Ablage>/schluessel.json`, nur für den Benutzer lesbar). */
    readonly schluessel?: SchluesselSpeicher | undefined;
}

export interface Startschein {
    readonly kennung: string;
}

/** Der Auftrag, einen Abzug von einer Quelle zu holen und einzuspielen (geprüft, aber noch nicht gestartet). */
export interface HolenSchein {
    readonly quelle: AbzugQuelle;
}

export interface LokalDienst {
    sicht(): Promise<AbzugSichtEinspielen>;
    /** Nimmt die Datei an, prüft sie und legt sie als Eingang ab. Wirft `ApiError`. */
    nimmAn(strom: Readable, name: string, bytes: number | undefined): Promise<AbzugEingang>;
    /** Prüft, ob jetzt eingespielt werden darf; wirft `ApiError`. */
    pruefeStart(kennung: string): Promise<Startschein>;
    /** Startet das Einspielen im Hintergrund; kehrt sofort zurück. */
    starte(schein: Startschein): void;
    /** Hinterlegt den Schlüssel einer Quelle (`wert`) oder entfernt ihn (`null`). Der Wert verlässt diesen Dienst nie wieder. */
    setzeSchluessel(quelle: AbzugQuelle, wert: string | null): void;
    /** Prüft, ob jetzt von `quelle` geholt werden darf; wirft `ApiError`. */
    pruefeHolen(quelle: AbzugQuelle): HolenSchein;
    /** Holt den neuesten Abzug der Quelle und spielt ihn ein, im Hintergrund; kehrt sofort zurück. */
    starteHolen(schein: HolenSchein): void;
    /** Wartet auf das Ende des laufenden Einspielens (Tests). */
    abwarten(): Promise<void>;
}

/** Der Name, den die Person der Datei gab: Buchstaben, Ziffern und einfache Zeichen, nie ein Pfad. */
const DATEINAME = /^[\w. ()+-]{1,120}$/u;
const LUFT_BYTES = 1024 * 1024 * 1024;
const Meta = Type.Object({ name: Type.String(), hochgeladen: Type.String() });

function freieBytes(ordner: string): number | undefined {
    try {
        const info = statfsSync(ordner);
        return Number(info.bavail) * Number(info.bsize);
    } catch {
        return undefined;
    }
}

function liesJson<T>(pfad: string, schema: TSchema): T | null {
    try {
        const roh: unknown = JSON.parse(readFileSync(pfad, "utf8"));
        return Value.Check(schema, roh) ? (roh as T) : null;
    } catch {
        return null;
    }
}

export function erzeugeLokalDienst(optionen: LokalDienstOptionen): LokalDienst {
    const jetzt = optionen.jetzt ?? (() => new Date());
    const warn = optionen.warn ?? (() => undefined);
    const wurzel = optionen.wurzel;
    let lauf: AbzugLaufTyp | null = null;
    let laeuft: Promise<void> | null = null;
    let letzterGelesen = false;
    const schluessel = optionen.schluessel ?? erzeugeSchluesselSpeicher(wurzel);

    const eingangOrdner = (): string => join(wurzel!, "eingang");
    const tarPfad = (): string => join(eingangOrdner(), "aktuell.tar");
    const metaPfad = (): string => join(eingangOrdner(), "aktuell.json");
    const laufPfad = (): string => join(wurzel!, "letzter-lauf.json");
    const pgDump = (): string | undefined => (optionen.pgDump === null ? undefined : (optionen.pgDump ?? pgDumpPfad()));
    const ohneAblage = (): ApiError =>
        new ApiError(
            503,
            "abzug_ablage_fehlt",
            "Auf diesem Rechner ist kein Ort für Abzüge eingerichtet (ABZUG_ROOT).",
        );

    /** Das Ergebnis des letzten Laufs vor dem Neustart, einmal. Ein Lauf, der „läuft“, aber keinen Prozess mehr hat, ist mit dem Server gestorben. */
    function ladeLetzten(): void {
        if (letzterGelesen || wurzel === undefined) return;
        letzterGelesen = true;
        if (lauf !== null) return;
        const gelesen = liesJson<AbzugLaufTyp>(laufPfad(), AbzugLauf);
        lauf =
            gelesen?.zustand === "laeuft"
                ? {
                      ...gelesen,
                      zustand: "fehler",
                      ende: jetzt().toISOString(),
                      meldung:
                          gelesen.phase === "holen"
                              ? "Das Holen wurde abgebrochen (der Server wurde beendet). Die Teil-Datei bleibt; ein neuer Versuch macht dort weiter."
                              : "Das Einspielen wurde abgebrochen (der Server wurde beendet). Nichts wurde verändert.",
                  }
                : gelesen;
    }

    function speichereLauf(): void {
        if (wurzel === undefined || lauf === null) return;
        try {
            mkdirSync(wurzel, { recursive: true });
            writeFileSync(laufPfad(), `${JSON.stringify(lauf, null, 2)}\n`, "utf8");
        } catch (error) {
            warn(`Abzug: Lauf nicht gespeichert (${error instanceof Error ? error.message : String(error)})`);
        }
    }

    /** Der Eingang, mit der Prüfung gegen diese Datenbank (`mitPruefung`) oder ohne (während eines Laufs ist die Datenbank belegt). */
    async function eingang(mitPruefung: boolean): Promise<AbzugEingang | null> {
        if (wurzel === undefined || !existsSync(tarPfad())) return null;
        const meta = liesJson<{ name: string }>(metaPfad(), Meta);
        const name = meta?.name ?? "abzug.tar";
        const bytes = statSync(tarPfad()).size;
        const gelesen = await liesAbzug(tarPfad());
        if (gelesen.manifest === null) {
            return {
                name,
                bytes,
                kennung: "",
                quelle: "staging",
                erstellt: "",
                tafeln: 0,
                zeilen: 0,
                medien: 0,
                medienBytes: 0,
                medienFehlend: 0,
                probleme: [...gelesen.probleme],
            };
        }
        const manifest = gelesen.manifest;
        const probleme = mitPruefung
            ? (
                  await pruefeAbzug(optionen.db, tarPfad(), optionen.regeln, await leseKatalog(optionen.db), {
                      wurzel: optionen.medienWurzel,
                  })
              ).probleme
            : [];
        const medien = medienSumme(manifest);
        return {
            name,
            bytes,
            kennung: manifest.kennung,
            quelle: manifest.quelle,
            erstellt: manifest.erstellt,
            tafeln: manifest.tafeln.length,
            zeilen: manifest.tafeln.reduce((summe, tafel) => summe + tafel.zeilen, 0),
            medien: medien.dateien,
            medienBytes: medien.bytes,
            medienFehlend: medien.fehlend,
            probleme: [...probleme],
        };
    }

    function bericht(b: EinspielenBericht): void {
        if (lauf === null) return;
        lauf = {
            ...lauf,
            phase: b.phase,
            tafel: b.tafel !== undefined ? b.tafel : b.phase === "laden" ? lauf.tafel : null,
            fortschritt: b.fortschritt !== undefined ? b.fortschritt : lauf.fortschritt,
            sicherung: b.sicherung ?? lauf.sicherung,
        };
    }

    /** Das Einspielen der Datei im Eingang; läuft im Hintergrund und gibt `laeuft` am Ende frei. */
    async function spieleEin(): Promise<void> {
        try {
            const ergebnis = await (optionen.einspielen ?? spieleAbzugEin)({
                databaseUrl: optionen.databaseUrl!,
                tarPfad: tarPfad(),
                regeln: optionen.regeln,
                ablage: wurzel!,
                pgDump: pgDump(),
                medienWurzel: optionen.medienWurzel,
                bericht,
            });
            lauf = {
                ...lauf!,
                zustand: "fertig",
                phase: "fertig",
                tafel: null,
                fortschritt: 1,
                ende: jetzt().toISOString(),
                zeilen: ergebnis.zeilen,
                sicherung: ergebnis.sicherung,
                meldung: null,
                medien: {
                    dateien: ergebnis.medien.dateien,
                    geschrieben: ergebnis.medien.geschrieben,
                    offen: ergebnis.medien.offen,
                    bytes: ergebnis.medien.bytes,
                },
            };
            if (ergebnis.medien.offen > 0) {
                // Die Datenbank ist ersetzt, aber nicht alle Mediendateien liegen: Die Datei bleibt, damit ein erneutes Einspielen die
                // fehlenden nachholt.
                warn(
                    `Abzug einspielen: ${String(ergebnis.medien.offen)} von ${String(ergebnis.medien.dateien)} Mediendateien nicht abgelegt (${ergebnis.medien.ersterFehler ?? "ohne Angabe"})`,
                );
            } else {
                // Eingespielt: Die Datei wird nicht mehr gebraucht und wäre nur Ballast auf dem Datenträger.
                rmSync(tarPfad(), { force: true });
                rmSync(metaPfad(), { force: true });
            }
        } catch (error) {
            const satz = error instanceof EinspielenFehler ? error.message : datenbankSatz(error);
            warn(`Abzug einspielen: ${satz}`);
            lauf = { ...lauf!, zustand: "fehler", tafel: null, ende: jetzt().toISOString(), meldung: satz };
        } finally {
            speichereLauf();
            laeuft = null;
        }
    }

    return {
        async sicht() {
            ladeLetzten();
            return {
                rolle: "einspielen",
                jetzt: jetzt().toISOString(),
                ablage: wurzel !== undefined,
                sicherung: pgDump() !== undefined,
                eingang: await eingang(laeuft === null),
                lauf,
                schluessel: schluessel.gesetzt(),
            };
        },

        async nimmAn(strom, name, bytes) {
            if (wurzel === undefined) throw ohneAblage();
            if (laeuft !== null)
                throw new ApiError(409, "abzug_laeuft", "Es läuft gerade ein Einspielen. Warte, bis es fertig ist.");
            const sauber = name.trim();
            if (!DATEINAME.test(sauber)) {
                throw new ApiError(
                    400,
                    "abzug_datei_ungueltig",
                    "Der Dateiname enthält Zeichen, die hier nicht gehen.",
                );
            }
            mkdirSync(eingangOrdner(), { recursive: true });
            const verfuegbar = freieBytes(eingangOrdner());
            if (verfuegbar !== undefined && bytes !== undefined && verfuegbar < bytes + LUFT_BYTES) {
                throw new ApiError(
                    503,
                    "abzug_ablage_fehlt",
                    "Auf dem Datenträger ist zu wenig Platz für die Datei (sie braucht ihre Größe plus 1 GiB Luft).",
                );
            }
            const teil = join(eingangOrdner(), "aktuell.tar.part");
            try {
                await pipeline(strom, createWriteStream(teil));
            } catch (error) {
                rmSync(teil, { force: true });
                throw new ApiError(
                    400,
                    "abzug_datei_ungueltig",
                    `Die Datei kam nicht vollständig an (${error instanceof Error ? error.message : String(error)}).`,
                );
            }
            const gelesen = await liesAbzug(teil);
            if (gelesen.manifest === null) {
                rmSync(teil, { force: true });
                const erster = gelesen.probleme[0];
                throw new ApiError(
                    422,
                    "abzug_datei_ungueltig",
                    `Das ist kein Abzug von Avesmaps3D (${erster?.code ?? "datei"}${erster?.detail ? `: ${erster.detail}` : ""}).`,
                );
            }
            renameSync(teil, tarPfad());
            writeFileSync(
                metaPfad(),
                `${JSON.stringify({ name: sauber, hochgeladen: jetzt().toISOString() })}\n`,
                "utf8",
            );
            const angelegt = await eingang(true);
            if (angelegt === null)
                throw new ApiError(500, "internal", "Der Eingang ist nach dem Ablegen nicht zu lesen.");
            return angelegt;
        },

        async pruefeStart(kennung) {
            if (wurzel === undefined) throw ohneAblage();
            if (laeuft !== null) throw new ApiError(409, "abzug_laeuft", "Es läuft gerade ein Einspielen.");
            if (optionen.databaseUrl === undefined) {
                throw new ApiError(
                    503,
                    "abzug_ablage_fehlt",
                    "Dieser Server hat keine Datenbank, in die er einspielen könnte.",
                );
            }
            if (pgDump() === undefined) {
                throw new ApiError(
                    503,
                    "abzug_sicherung_fehlt",
                    "pg_dump wurde nicht gefunden (PG_BIN_DIR). Ohne Sicherung der bisherigen Daten wird nichts ersetzt.",
                );
            }
            const bereit = await eingang(true);
            if (bereit === null || bereit.kennung !== kennung) {
                throw new ApiError(
                    404,
                    "abzug_unbekannt",
                    "Diese Datei liegt nicht (mehr) bereit. Wähle sie noch einmal.",
                );
            }
            const erster = bereit.probleme[0];
            if (erster !== undefined) {
                throw new ApiError(
                    409,
                    "abzug_einspielen_gesperrt",
                    `Der Abzug passt nicht zu dieser Datenbank (${erster.code}${erster.detail ? `: ${erster.detail}` : ""}). Nichts wurde verändert.`,
                );
            }
            return { kennung };
        },

        starte(schein) {
            if (laeuft !== null || wurzel === undefined || optionen.databaseUrl === undefined) return;
            lauf = {
                kennung: schein.kennung,
                zustand: "laeuft",
                phase: "pruefen",
                tafel: null,
                fortschritt: 0,
                seit: jetzt().toISOString(),
                ende: null,
                zeilen: null,
                sicherung: null,
                meldung: null,
            };
            speichereLauf();
            laeuft = spieleEin();
        },

        setzeSchluessel(quelle, wert) {
            if (wurzel === undefined) throw ohneAblage();
            schluessel.setze(quelle, wert);
        },

        pruefeHolen(quelle) {
            if (wurzel === undefined) throw ohneAblage();
            if (laeuft !== null) throw new ApiError(409, "abzug_laeuft", "Es läuft gerade ein Einspielen.");
            if (optionen.databaseUrl === undefined) {
                throw new ApiError(
                    503,
                    "abzug_ablage_fehlt",
                    "Dieser Server hat keine Datenbank, in die er einspielen könnte.",
                );
            }
            if (pgDump() === undefined) {
                throw new ApiError(
                    503,
                    "abzug_sicherung_fehlt",
                    "pg_dump wurde nicht gefunden (PG_BIN_DIR). Ohne Sicherung der bisherigen Daten wird nichts ersetzt.",
                );
            }
            if (schluessel.lies(quelle) === undefined) {
                throw new ApiError(
                    409,
                    "abzug_schluessel_fehlt",
                    `Für ${QUELLEN_NAMEN[quelle]} ist hier kein Schlüssel hinterlegt.`,
                );
            }
            return { quelle };
        },

        starteHolen(schein) {
            if (laeuft !== null || wurzel === undefined || optionen.databaseUrl === undefined) return;
            const quelle = schein.quelle;
            const wert = schluessel.lies(quelle);
            if (wert === undefined) return;
            lauf = {
                kennung: "",
                zustand: "laeuft",
                phase: "holen",
                tafel: null,
                fortschritt: 0,
                seit: jetzt().toISOString(),
                ende: null,
                zeilen: null,
                sicherung: null,
                meldung: null,
                holen: { quelle, geladen: 0, gesamt: 0 },
            };
            speichereLauf();
            laeuft = (async () => {
                try {
                    // Liegt dieser Abzug schon vollständig im Eingang (das Einspielen scheiterte), wird er nicht noch einmal geladen.
                    const da = await eingang(false);
                    const geholt = await holeAbzug({
                        quelle,
                        liegt:
                            da !== null && da.kennung !== "" && da.quelle === quelle
                                ? { pfad: tarPfad(), kennung: da.kennung, bytes: da.bytes }
                                : undefined,
                        adresse: optionen.quellen?.[quelle] ?? QUELLEN_ADRESSEN[quelle],
                        schluessel: wert,
                        ordner: eingangOrdner(),
                        ...(optionen.fetch === undefined ? {} : { fetch: optionen.fetch }),
                        freieBytes,
                        pauseMs: optionen.pauseMs,
                        stillstandMs: optionen.stillstandMs,
                        bericht: ({ kennung, geladen, gesamt }) => {
                            if (lauf === null) return;
                            lauf = {
                                ...lauf,
                                kennung,
                                fortschritt: gesamt > 0 ? Math.min(1, geladen / gesamt) : 0,
                                holen: { quelle, geladen, gesamt },
                            };
                        },
                    });
                    // Das Manifest ist der erste Eintrag: Es muss zu dem passen, was die Quelle in der Liste nannte.
                    const gelesen = await liesAbzug(geholt.pfad);
                    if (
                        gelesen.manifest === null ||
                        gelesen.manifest.kennung !== geholt.kennung ||
                        gelesen.manifest.quelle !== quelle
                    ) {
                        rmSync(geholt.pfad, { force: true });
                        throw new HolenFehler(
                            "antwort",
                            `Die geladene Datei ist kein Abzug von ${QUELLEN_NAMEN[quelle]}, oder sie ist beschädigt. Sie wurde verworfen.`,
                        );
                    }
                    if (geholt.pfad !== tarPfad()) {
                        rmSync(tarPfad(), { force: true });
                        renameSync(geholt.pfad, tarPfad());
                        writeFileSync(
                            metaPfad(),
                            `${JSON.stringify({ name: dateinameFuer(quelle, geholt.kennung), hochgeladen: jetzt().toISOString() })}\n`,
                            "utf8",
                        );
                    }
                    lauf = { ...lauf!, kennung: geholt.kennung, phase: "pruefen", fortschritt: 0, holen: null };
                } catch (error) {
                    const satz =
                        error instanceof HolenFehler
                            ? error.message
                            : `Das Holen scheiterte (${error instanceof Error ? error.message : String(error)}).`;
                    warn(`Abzug holen: ${satz}`);
                    lauf = { ...lauf!, zustand: "fehler", tafel: null, ende: jetzt().toISOString(), meldung: satz };
                    speichereLauf();
                    laeuft = null;
                    return;
                }
                await spieleEin();
            })();
        },

        async abwarten() {
            await laeuft;
        },
    };
}
