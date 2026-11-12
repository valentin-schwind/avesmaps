import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statfsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { Transform } from "node:stream";
import type { AbzugEinspielenPhase, AbzugManifest } from "@avesmaps3d/shared";
import { createDatabase } from "../database.ts";
import { ladeStrom } from "./copy-ein.ts";
import { EinspielenFehler } from "./fehler.ts";
import { leseKatalog } from "./katalog.ts";
import { erste, legeMedienAb, pruefeMedienStrom, type MedienErgebnis } from "./medien.ts";
import { ladeFolge, bezeichner, tafelBezeichner } from "./plan.ts";
import { pruefeAbzug } from "./pruefen.ts";
import { lokalZuLeerendeTafeln, type GeladeneRegeln } from "./regeln.ts";
import { tarStrom } from "./tar.ts";

/**
 * Das Einspielen eines Abzugs in die LOKALE Entwicklungsdatenbank (WI-0251). 🔴 Es ersetzt die Kartendaten dieser Datenbank und läuft nur
 * auf Knopfdruck der Betreiber (Map Mutation Guard); die Route gibt es nur auf dem Entwicklungsrechner. Stage und Production werden
 * nie berührt, Konten, Betrieb und Protokolle dieser Datenbank bleiben (sie stehen nicht in den Regeln der Mitnahme).
 *
 * Ablauf, jeder Schritt ein Halt, wenn er scheitert, und bis zum letzten ist NICHTS verändert:
 *
 * 1. **Prüfen** (`pruefeAbzug`): Format, Migrationen, Kartendomäne, Tafeln, Spalten, Rechte, die Liste der Mediendateien und Platz dafür; dann jede
 *    Mediendatei einmal durch den Hash (`pruefeMedienStrom`). Eine kaputte Datei hält hier an, bevor irgendetwas entsteht.
 * 2. **Sicherung** der bisherigen Daten der betroffenen Tafeln (`pg_dump -Fc --data-only`) in `<Ablage>/sicherung/`. Ohne `pg_dump` oder bei einem
 *    Fehler wird nicht ersetzt: Es gibt kein Einspielen ohne Sicherung. Mediendateien braucht die Sicherung nicht: Lokal wird keine gelöscht.
 * 3. **Eine Transaktion** auf einer eigenen Verbindung: Benutzer-Trigger der Tafeln aus (Revisionszähler, Sperren für Handschreiben), Fremdschlüssel
 *    in Kreisen aufschieben, alle betroffenen Tafeln mit einem `TRUNCATE` leeren, jede Tafel als `COPY … FROM STDIN (FORMAT binary)` laden
 *    (Prüfsumme und Zeilenzahl gegen das Manifest), Fremdschlüssel prüfen, alles zurückstellen, Folgen (Sequenzen) nachziehen, `COMMIT`.
 *
 * 4. **Mediendateien ablegen** (`legeMedienAb`), erst nach dem Commit: jede atomar nach `MEDIA_ROOT`. Scheitert dort etwas, ist die Datenbank schon
 *    ersetzt; das Ergebnis nennt dann `medien.offen`, und ein erneutes Einspielen derselben Datei legt die fehlenden ab.
 *
 * Eine Folge geht nie zurück: Sie wird auf das Größere aus bisherigem Stand und `max(Spalte)` gesetzt, und erst nach allen Prüfungen. Sonst
 * könnte ein gescheiterter Lauf sie unter bestehende Zeilen senken (`setval` ist nicht transaktional).
 */
export interface EinspielenBericht {
    readonly phase: AbzugEinspielenPhase;
    readonly tafel?: string | null;
    readonly fortschritt?: number | null;
    readonly sicherung?: string | null;
}

export interface EinspielenOptionen {
    readonly databaseUrl: string;
    readonly tarPfad: string;
    readonly regeln: GeladeneRegeln;
    /** Hier entsteht `sicherung/`. */
    readonly ablage: string;
    /** Das Verzeichnis von `pg_dump` (`pgDumpPfad`); `undefined`: Es wird nicht eingespielt. */
    readonly pgDump: string | undefined;
    /** `MEDIA_ROOT` dieser Instanz: wohin die Mediendateien des Abzugs kommen. Ohne sie wird kein Abzug mit Mediendateien eingespielt. */
    readonly medienWurzel: string | undefined;
    readonly bericht?: ((bericht: EinspielenBericht) => void) | undefined;
    /** Wie lange das Warten auf die Sperren der Tafeln dauern darf, bevor abgebrochen wird (Vorgabe 30 s). */
    readonly sperrfristS?: number | undefined;
}

export interface EinspielenErgebnis {
    readonly kennung: string;
    readonly tafeln: number;
    readonly zeilen: number;
    /** Dateiname der Sicherung. */
    readonly sicherung: string;
    /** Was mit den Mediendateien geschah. */
    readonly medien: MedienErgebnis;
}

export { EinspielenFehler };

/** Das Verzeichnis der PostgreSQL-Programme: `PG_BIN_DIR`, der Windows-Standard, der Linux-Standard, dann der Suchpfad. */
export function pgDumpPfad(
    env: NodeJS.ProcessEnv = process.env,
    gibtEs: (pfad: string) => boolean = existsSync,
): string | undefined {
    const exe = process.platform === "win32" ? ".exe" : "";
    const kandidaten = [
        env["PG_BIN_DIR"],
        "C:/tools/pgsql-18/bin",
        "/usr/lib/postgresql/18/bin",
        ...(env["PATH"] ?? "").split(delimiter),
    ];
    return kandidaten.find((ordner) => ordner !== undefined && ordner !== "" && gibtEs(join(ordner, `pg_dump${exe}`)));
}

/** Die Bestandteile einer Verbindungsadresse für `pg_dump`; das Kennwort geht über die Umgebung, nie in die Befehlszeile. */
export function verbindungVon(url: string): {
    host: string;
    port: string;
    user: string;
    password: string;
    datenbank: string;
} {
    const adresse = new URL(url);
    return {
        host: adresse.hostname,
        port: adresse.port === "" ? "5432" : adresse.port,
        user: decodeURIComponent(adresse.username),
        password: decodeURIComponent(adresse.password),
        datenbank: decodeURIComponent(adresse.pathname.replace(/^\//u, "")),
    };
}

/** Freie Bytes auf dem Datenträger eines Ordners; `undefined`, wenn das Betriebssystem es nicht sagt. */
function freierPlatz(ordner: string): number | undefined {
    try {
        const info = statfsSync(ordner);
        return Number(info.bavail) * Number(info.bsize);
    } catch {
        return undefined;
    }
}

function zeitstempel(jetzt = new Date()): string {
    return jetzt
        .toISOString()
        .replace(/[-:]/gu, "")
        .replace(/\.\d+Z$/u, "Z");
}

/** Sichert die Daten der genannten Tafeln; gibt den Dateinamen zurück. Wirft, ohne eine halbe Datei zu hinterlassen. */
export async function sichereTafeln(optionen: {
    databaseUrl: string;
    tafeln: readonly string[];
    ordner: string;
    pgDump: string;
    kennung: string;
}): Promise<string> {
    mkdirSync(optionen.ordner, { recursive: true });
    const name = `vorher-${optionen.kennung}-${zeitstempel()}.dump`;
    const ziel = join(optionen.ordner, name);
    const verbindung = verbindungVon(optionen.databaseUrl);
    const exe = process.platform === "win32" ? ".exe" : "";
    const argumente = [
        "-Fc",
        "-Z",
        "6",
        "--data-only",
        "-h",
        verbindung.host,
        "-p",
        verbindung.port,
        "-U",
        verbindung.user,
        "-d",
        verbindung.datenbank,
        "-f",
        ziel,
        ...optionen.tafeln.flatMap((tafel) => ["-t", tafel]),
    ];
    const fehlerzeilen: string[] = [];
    const ende = await new Promise<number | null>((fertig, abgelehnt) => {
        const kind = spawn(join(optionen.pgDump, `pg_dump${exe}`), argumente, {
            env: { ...process.env, PGPASSWORD: verbindung.password, PGCONNECT_TIMEOUT: "10" },
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
        });
        kind.stderr.on("data", (stueck: Buffer) => fehlerzeilen.push(stueck.toString("utf8")));
        kind.once("error", abgelehnt);
        kind.once("close", fertig);
    });
    if (ende !== 0) {
        rmSync(ziel, { force: true });
        const grund = fehlerzeilen.join("").trim().split(/\r?\n/u).slice(-2).join(" ").slice(0, 300);
        throw new EinspielenFehler(
            "sicherung",
            `Die Sicherung der bisherigen Daten scheiterte (pg_dump Status ${String(ende)}): ${grund}`,
        );
    }
    return name;
}

interface TafelUndFolgen {
    readonly alle: readonly string[];
}

/** Die Tafeln, die ein Einspielen ersetzt: die des Abzugs, dazu die lokal mitzuleerenden und die, die es an der Quelle noch nicht gab. */
export function betroffeneTafeln(
    manifest: AbzugManifest,
    regeln: GeladeneRegeln,
    neueTafeln: readonly string[] = [],
): TafelUndFolgen {
    const namen = manifest.tafeln.map((tafel) => tafel.tafel);
    return { alle: [...new Set([...namen, ...lokalZuLeerendeTafeln(regeln.regeln), ...neueTafeln])] };
}

/** Spielt einen Abzug ein. Wirft `EinspielenFehler` (mit Satz) oder den Fehler der Datenbank; in beiden Fällen ist nichts verändert. */
export async function spieleAbzugEin(optionen: EinspielenOptionen): Promise<EinspielenErgebnis> {
    const sag = optionen.bericht ?? (() => undefined);
    const db = createDatabase(optionen.databaseUrl, { max: 1 });
    try {
        sag({ phase: "pruefen" });
        const katalog = await leseKatalog(db);
        const vorab = await pruefeAbzug(db, optionen.tarPfad, optionen.regeln, katalog, {
            wurzel: optionen.medienWurzel,
        });
        if (vorab.manifest === null || vorab.probleme.length > 0) {
            const erster = vorab.probleme[0];
            throw new EinspielenFehler(
                "gesperrt",
                `Der Abzug passt nicht zu dieser Datenbank (${erster?.code ?? "datei"}${erster?.detail ? `: ${erster.detail}` : ""}). Nichts wurde verändert.`,
            );
        }
        const manifest = vorab.manifest;
        const betroffen = betroffeneTafeln(manifest, optionen.regeln, vorab.neueTafeln).alle;

        // 1. Die Mediendateien: jede einmal durch den Hash, bevor irgendetwas entsteht.
        if (manifest.medien.length > 0) {
            sag({ phase: "medienpruefen", fortschritt: 0 });
            await pruefeMedienStrom(optionen.tarPfad, manifest, vorab.eintraege, (anteil) =>
                sag({ phase: "medienpruefen", fortschritt: anteil }),
            );
        }

        // 2. Sicherung: nie ersetzen ohne.
        if (optionen.pgDump === undefined) {
            throw new EinspielenFehler(
                "sicherung",
                "pg_dump wurde nicht gefunden (PG_BIN_DIR). Ohne Sicherung wird nichts ersetzt.",
            );
        }
        sag({ phase: "sicherung" });
        // Platz für die Sicherung: komprimiert rund die Hälfte der Tafeln (ohne Indizes), dazu 1 GiB Luft. Ein volles Laufwerk soll vor dem
        // Ersetzen auffallen, nicht mittendrin.
        const [groesse] = await db<{ bytes: string }[]>`
            SELECT COALESCE(sum(pg_total_relation_size(c.oid)), 0)::text AS bytes
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname || '.' || c.relname = ANY (${betroffen as string[]}::text[])
        `;
        mkdirSync(join(optionen.ablage, "sicherung"), { recursive: true });
        const frei = freierPlatz(join(optionen.ablage, "sicherung"));
        const noetig = Math.ceil(Number(groesse?.bytes ?? 0) / 2) + 1024 * 1024 * 1024;
        if (frei !== undefined && frei < noetig) {
            throw new EinspielenFehler(
                "platz",
                `Auf dem Datenträger ist zu wenig Platz für die Sicherung (frei ${String(Math.round(frei / 1024 ** 3))} GB, nötig etwa ${String(Math.ceil(noetig / 1024 ** 3))} GB). Nichts wurde verändert.`,
            );
        }
        const sicherung = await sichereTafeln({
            databaseUrl: optionen.databaseUrl,
            tafeln: betroffen,
            ordner: join(optionen.ablage, "sicherung"),
            pgDump: optionen.pgDump,
            kennung: manifest.kennung,
        });
        sag({ phase: "sicherung", sicherung });

        // 3. Die Transaktion.
        const gesamtBytes = manifest.tafeln.reduce(
            (summe, tafel) => summe + (vorab.eintraege.find((eintrag) => eintrag.name === tafel.datei)?.groesse ?? 0),
            0,
        );
        let geladenBytes = 0;
        let zeilenGesamt = 0;
        const mitTrigger = new Set<string>();
        const aufgeschoben: { von: string; name: string }[] = [];
        const sperrfrist = optionen.sperrfristS ?? 30;
        sag({ phase: "leeren" });
        try {
            await db.begin(async (tx) => {
                await tx.unsafe(`SET LOCAL lock_timeout = '${String(Math.max(1, Math.trunc(sperrfrist)))}s'`);
                await tx.unsafe("SET LOCAL statement_timeout = 0");

                // Benutzer-Trigger der betroffenen Tafeln aus: Revisionszähler hängen sich sonst an jede Zeile, und manche Tafeln sperren Handschreiben.
                const trigger = await tx<{ tafel: string }[]>`
                    SELECT DISTINCT n.nspname || '.' || c.relname AS tafel
                      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE NOT t.tgisinternal AND n.nspname || '.' || c.relname = ANY (${betroffen as string[]}::text[])
                `;
                for (const zeile of trigger) {
                    await tx.unsafe(`ALTER TABLE ${tafelBezeichner(zeile.tafel)} DISABLE TRIGGER USER`);
                    mitTrigger.add(zeile.tafel);
                }

                // Fremdschlüssel in Kreisen aufschieben (zwei Tafeln, die aufeinander zeigen, lassen sich nur so laden).
                const namenDesAbzugs = manifest.tafeln.map((tafel) => tafel.tafel);
                const { zyklen } = ladeFolge(
                    namenDesAbzugs,
                    katalog.fremdschluessel.filter(
                        (fk) => namenDesAbzugs.includes(fk.von) && namenDesAbzugs.includes(fk.nach),
                    ),
                );
                const imKreis = new Set(zyklen.flat());
                for (const fk of katalog.fremdschluessel) {
                    if (fk.von === fk.nach || fk.aufschiebbar) continue;
                    const gruppe = zyklen.find((kreis) => kreis.includes(fk.von));
                    if (gruppe === undefined || !imKreis.has(fk.nach) || !gruppe.includes(fk.nach)) continue;
                    await tx.unsafe(
                        `ALTER TABLE ${tafelBezeichner(fk.von)} ALTER CONSTRAINT ${bezeichner(fk.name)} DEFERRABLE INITIALLY IMMEDIATE`,
                    );
                    aufgeschoben.push({ von: fk.von, name: fk.name });
                }
                if (aufgeschoben.length > 0) await tx.unsafe("SET CONSTRAINTS ALL DEFERRED");

                // Leeren: EIN Befehl für alle, damit die Fremdschlüssel untereinander kein CASCADE brauchen.
                await tx.unsafe(`TRUNCATE TABLE ${betroffen.map(tafelBezeichner).join(", ")}`);

                // Laden, Eltern vor Kindern (die Reihenfolge des Manifests).
                sag({ phase: "laden", fortschritt: 0 });
                for (const tafel of manifest.tafeln) {
                    const eintrag = vorab.eintraege.find((kandidat) => kandidat.name === tafel.datei);
                    if (eintrag === undefined) throw new EinspielenFehler("datei", `Im Abzug fehlt ${tafel.datei}.`);
                    sag({
                        phase: "laden",
                        tafel: tafel.tafel,
                        fortschritt: gesamtBytes === 0 ? 1 : geladenBytes / gesamtBytes,
                    });
                    const spalten = tafel.spalten.map((spalte) => bezeichner(spalte.name)).join(", ");
                    const hash = createHash("sha256");
                    let bytes = 0;
                    const pruefstrom = new Transform({
                        transform(stueck: Buffer, _kodierung, weiter) {
                            hash.update(stueck);
                            bytes += stueck.length;
                            geladenBytes += stueck.length;
                            weiter(null, stueck);
                        },
                    });
                    const roh = tarStrom(optionen.tarPfad, eintrag);
                    roh.once("error", (error) => pruefstrom.destroy(error));
                    roh.pipe(pruefstrom);
                    try {
                        await ladeStrom(
                            tx,
                            `COPY ${tafelBezeichner(tafel.tafel)} (${spalten}) FROM STDIN (FORMAT binary)`,
                            pruefstrom,
                        );
                    } catch (error) {
                        roh.destroy();
                        throw new EinspielenFehler(
                            "laden",
                            `Das Laden von ${tafel.tafel} scheiterte (${error instanceof Error ? error.message.slice(0, 200) : String(error)}). Nichts wurde verändert.`,
                        );
                    }
                    if (hash.digest("hex") !== tafel.sha256 || bytes !== eintrag.groesse) {
                        throw new EinspielenFehler(
                            "pruefsumme",
                            `Die Prüfsumme von ${tafel.tafel} stimmt nicht mit dem Manifest überein. Nichts wurde verändert.`,
                        );
                    }
                    const [gezaehlt] = await tx.unsafe<{ n: string }[]>(
                        `SELECT count(*)::text AS n FROM ${tafelBezeichner(tafel.tafel)}`,
                    );
                    if (Number(gezaehlt?.n) !== tafel.zeilen) {
                        throw new EinspielenFehler(
                            "zeilen",
                            `${tafel.tafel}: ${gezaehlt?.n ?? "?"} Zeilen geladen, das Manifest nennt ${String(tafel.zeilen)}. Nichts wurde verändert.`,
                        );
                    }
                    zeilenGesamt += tafel.zeilen;
                }

                // Die Medientafel und die Liste der Dateien gehören zusammen: jede Zeile hat ihre Datei im Abzug (oder ist als fehlend an der
                // Quelle genannt), und der Abzug trägt keine Datei ohne Zeile. Sonst wäre der Export fehlerhaft, und es bliebe ein leeres Bild.
                const regelMedien = optionen.regeln.regeln.medien;
                const medienZeilen = await tx.unsafe<{ pfad: string }[]>(
                    `SELECT ${bezeichner(regelMedien.schluessel)} AS pfad FROM ${tafelBezeichner(regelMedien.tafel)}`,
                );
                const imAbzug = new Set([...manifest.medien.map((medium) => medium.pfad), ...manifest.medienFehlend]);
                const dieZeilen = new Set(medienZeilen.map((zeile) => zeile.pfad));
                const ohneDatei = [...dieZeilen].filter((pfad) => !imAbzug.has(pfad));
                const ohneZeile = [...imAbzug].filter((pfad) => !dieZeilen.has(pfad));
                if (ohneDatei.length > 0 || ohneZeile.length > 0) {
                    const teile = [
                        ...(ohneDatei.length > 0
                            ? [
                                  `${String(ohneDatei.length)} Zeilen ohne Datei im Abzug, zum Beispiel ${erste(ohneDatei, 1)}`,
                              ]
                            : []),
                        ...(ohneZeile.length > 0
                            ? [`${String(ohneZeile.length)} Dateien ohne Zeile, zum Beispiel ${erste(ohneZeile, 1)}`]
                            : []),
                    ];
                    throw new EinspielenFehler(
                        "medien",
                        `Die Mediendateien passen nicht zu den Medienzeilen (${teile.join("; ")}). Nichts wurde verändert.`,
                    );
                }

                // Prüfen und zurückstellen, was wir verstellt haben.
                sag({ phase: "folgen", fortschritt: 1 });
                await tx.unsafe("SET CONSTRAINTS ALL IMMEDIATE");
                for (const fk of aufgeschoben) {
                    await tx.unsafe(
                        `ALTER TABLE ${tafelBezeichner(fk.von)} ALTER CONSTRAINT ${bezeichner(fk.name)} NOT DEFERRABLE`,
                    );
                }
                for (const tafel of mitTrigger)
                    await tx.unsafe(`ALTER TABLE ${tafelBezeichner(tafel)} ENABLE TRIGGER USER`);

                // Folgen zuletzt und nur nach oben.
                for (const folge of katalog.folgen) {
                    if (!betroffen.includes(folge.tafel)) continue;
                    const [schema = "public", name = folge.folge] = folge.folge.split(".");
                    await tx.unsafe(
                        `SELECT setval(${quoteLiteral(folge.folge)}::regclass,
                                GREATEST((SELECT COALESCE(max(${bezeichner(folge.spalte)}), 0) FROM ${tafelBezeichner(folge.tafel)}),
                                         (SELECT COALESCE(last_value, 0) FROM pg_sequences WHERE schemaname = ${quoteLiteral(schema)} AND sequencename = ${quoteLiteral(name)}),
                                         1),
                                TRUE)`,
                    );
                }
            });
        } catch (error) {
            if (error instanceof EinspielenFehler) throw error;
            throw new EinspielenFehler("datenbank", datenbankSatz(error));
        }

        // Nach dem Commit: Statistik für die Planer, damit die ersten Abfragen nicht blind rechnen. Scheitert das, ist es nur langsamer.
        for (const tafel of manifest.tafeln) {
            try {
                await db.unsafe(`ANALYZE ${tafelBezeichner(tafel.tafel)}`);
            } catch {
                // Autovacuum holt es nach.
            }
        }

        // 4. Mediendateien ablegen. Die Datenbank ist jetzt ersetzt: Was hier scheitert, wird nicht zum Fehler des ganzen Laufs, sondern zu `offen`.
        const ohneMedien: MedienErgebnis = {
            dateien: manifest.medien.length,
            geschrieben: 0,
            vorhanden: 0,
            offen: manifest.medien.length,
            bytes: 0,
            ersterFehler: null,
        };
        let medien: MedienErgebnis;
        if (manifest.medien.length === 0) {
            medien = { ...ohneMedien, offen: 0 };
        } else if (optionen.medienWurzel === undefined) {
            medien = { ...ohneMedien, ersterFehler: "MEDIA_ROOT ist nicht gesetzt" };
        } else {
            sag({ phase: "medien", fortschritt: 0 });
            medien = await legeMedienAb(optionen.tarPfad, optionen.medienWurzel, manifest, vorab.eintraege, (anteil) =>
                sag({ phase: "medien", fortschritt: anteil }),
            ).catch((error: unknown): MedienErgebnis => ({
                ...ohneMedien,
                ersterFehler: error instanceof Error ? error.message : String(error),
            }));
        }
        sag({ phase: "fertig", fortschritt: 1 });
        return { kennung: manifest.kennung, tafeln: manifest.tafeln.length, zeilen: zeilenGesamt, sicherung, medien };
    } finally {
        await db.end({ timeout: 5 });
    }
}

function quoteLiteral(wert: string): string {
    return `'${wert.replace(/'/gu, "''")}'`;
}

/** Ein Satz zu einem Fehler der Datenbank, ohne Verbindungsdaten; die Meldung der Datenbank nennt nie das Kennwort. */
export function datenbankSatz(error: unknown): string {
    const meldung = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown }).code;
    if (code === "55P03") {
        return "Die Datenbank ist gerade belegt (eine Tafel ist gesperrt). Stoppe den lokalen Server und die Auftragsabarbeitung und versuche es erneut. Nichts wurde verändert.";
    }
    return `Das Einspielen ist gescheitert und wurde zurückgenommen (${meldung.slice(0, 240)}). Nichts wurde verändert.`;
}
