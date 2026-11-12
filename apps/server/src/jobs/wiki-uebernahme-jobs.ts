import { AVENTURIA, RUECKNAHME_GRUND_MAX, WIKISYNC_BEREICHE, type WikisyncBereich } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Database } from "../database.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { ausloeserVon } from "../wiki/abgleich/ablage.ts";
import { legacyZugLaeuft } from "../wiki/abgleich/legacy-zug.ts";
import { raeumeVerwaisteAb, legeUebernahmeAn, schliesseUebernahme } from "../wiki/abgleich/uebernahme/protokoll.ts";
import { pruefeUebernahme } from "../wiki/abgleich/uebernahme/pruefen.ts";
import { schreiberFuer } from "../wiki/abgleich/uebernahme/liste.ts";
import { UebernahmeAbgelehnt, uebernimmBereich } from "../wiki/abgleich/uebernahme/uebernehmen.ts";
import type { Schreiber } from "../wiki/abgleich/uebernahme/schreiber.ts";
import { nimmObjektSyncZurueck, nimmZurueck } from "../wiki/abgleich/uebernahme/zuruecknehmen.ts";
import { JobCancelled, JobFailure, JobStopped, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";

/**
 * Die zwei schweren Aufträge des WikiSync, die die Karte ändern (WI-0253 D-1): `wiki_uebernehmen` und `wiki_zuruecknehmen`. Beide SCHREIBEN in Fachtafeln
 * (als Jobs-Rolle; ihre Rechte stehen in `apps/server/src/db/system-grants.psql`) und gelten darum als schwer: Sie laufen allein auf dem Host, nie neben dem Legacy-Zug,
 * dem Import oder der Gebietsableitung (`exclusivePairs` in den Profilen), und eine Person als Auslöser macht sie zu einem Editor-Auftrag, den die Kartensperre anhält
 * (`isEditorJob`).
 *
 * Eingabe (`input_ref`), streng geprüft:
 * - `wiki_uebernehmen`: `bereiche` (mindestens einer), `lauf` (der Lauf der Vorschau; ohne Angabe je Bereich der jüngste fertige).
 * - `wiki_zuruecknehmen`: `bereich`, `lauf` (der Lauf der Vorschau, aus dem übernommen wurde) und `uebernahme` (die Zeile in `wikisync_uebernahme`; seit WI-0265 B8e auch die einer Rücknahme: sie
 *   spielt die Übernahme wieder ein), oder `objekt` (die Operation eines Syncs an EINEM Objekt, `wikisync.objekt_sync`, Wiki-Box; dazu `bereich`).
 *
 * Wer es ausgelöst hat, steht im Auftrag (`job.actor_ref`): eine Person handelt als diese Person, jede andere Kennung (die Kommandozeile, später ein Zeitplan) als
 * das System. Der Auftrag handelt nie als Agent (Map Mutation Guard: Er ist ein Produktprozess eines berechtigten Nutzers).
 */

/** Wie das Ergebnis eines Bereichs im Auftrag aussieht. */
export interface BereichsErgebnis {
    bereich: WikisyncBereich;
    uebernahme: number | null;
    status: "fertig" | "abgelehnt" | "abgebrochen" | "fehlgeschlagen";
    grund?: string;
    operationId?: string | null;
    zahlen?: Record<string, number>;
}

export interface UebernahmeAbhaengigkeiten {
    environment?: NodeJS.ProcessEnv;
    /** Die Datenbank des Auftrags (Jobs-Rolle); Tests geben ihre Verbindung. */
    mitDatenbank?: <T>(arbeit: (db: Database) => Promise<T>) => Promise<T>;
}

function streng(input: Record<string, unknown>, erlaubt: readonly string[]): void {
    const unbekannt = Object.keys(input).filter((schluessel) => !erlaubt.includes(schluessel));
    if (unbekannt.length > 0) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: unbekanntes Feld ${unbekannt.join(", ")}`, false);
    }
}

function bereichAus(wert: unknown, feld: string): WikisyncBereich {
    if (typeof wert !== "string" || !(WIKISYNC_BEREICHE as readonly string[]).includes(wert)) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: "${feld}" ist kein Bereich`, false);
    }
    return wert as WikisyncBereich;
}

function ganzeZahl(wert: unknown, feld: string, pflicht: boolean): number | undefined {
    if (wert === undefined && !pflicht) return undefined;
    if (typeof wert !== "number" || !Number.isInteger(wert) || wert < 1) {
        throw new JobFailure("input_invalid", `Wiki-Auftrag: "${feld}" ist keine Nummer`, false);
    }
    return wert;
}

export function leseUebernehmenEingabe(input: Record<string, unknown>): {
    bereiche: WikisyncBereich[];
    lauf: number | undefined;
} {
    streng(input, ["bereiche", "lauf"]);
    const roh = input["bereiche"];
    if (!Array.isArray(roh) || roh.length === 0) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "bereiche" ist keine Liste von Bereichen', false);
    }
    const bereiche = WIKISYNC_BEREICHE.filter((bereich) => roh.includes(bereich));
    if (bereiche.length !== new Set(roh).size) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "bereiche" nennt etwas, das kein Bereich ist', false);
    }
    return { bereiche, lauf: ganzeZahl(input["lauf"], "lauf", false) };
}

/**
 * Die Eingabe der Rücknahme, streng geprüft: entweder EINE Übernahme (`bereich`, `lauf`, `uebernahme`) oder der ganze Lauf (`lauf` und `bereiche`: die Bereiche, deren jüngste Übernahme dieses Laufs noch
 * steht; jeder in seiner Transaktion, einer, der nichts mehr zurückzunehmen hat, wird übersprungen).
 */
export type ZuruecknehmenEingabe =
    | { art: "eine"; bereich: WikisyncBereich; lauf: number; uebernahme: number; grund?: string }
    | { art: "ganz"; lauf: number; bereiche: WikisyncBereich[]; grund?: string }
    | { art: "objekt"; bereich: WikisyncBereich; operationId: string; grund?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Der Grund einer Rücknahme aus „Änderungen“ (WI-0265 B8d; Pflicht, wenn die Übernahme von einer anderen Person stammt): ein Text; er steht danach als `restoreReason` an den Einträgen der Rücknahme. */
function grundAus(wert: unknown): { grund?: string } {
    if (wert === undefined) return {};
    if (typeof wert !== "string" || wert.trim() === "" || wert.length > RUECKNAHME_GRUND_MAX) {
        throw new JobFailure("input_invalid", 'Wiki-Auftrag: "grund" ist kein Text', false);
    }
    return { grund: wert.trim() };
}

export function leseZuruecknehmenEingabe(input: Record<string, unknown>): ZuruecknehmenEingabe {
    streng(input, ["bereich", "lauf", "uebernahme", "bereiche", "grund", "objekt"]);
    if (input["objekt"] !== undefined) {
        if (input["lauf"] !== undefined || input["uebernahme"] !== undefined || input["bereiche"] !== undefined) {
            throw new JobFailure("input_invalid", 'Wiki-Auftrag: "objekt" gilt allein, mit "bereich"', false);
        }
        const kennung = input["objekt"];
        if (typeof kennung !== "string" || !UUID.test(kennung)) {
            throw new JobFailure("input_invalid", 'Wiki-Auftrag: "objekt" ist keine Operation', false);
        }
        return {
            art: "objekt",
            bereich: bereichAus(input["bereich"], "bereich"),
            operationId: kennung.toLowerCase(),
            ...grundAus(input["grund"]),
        };
    }
    if (input["bereiche"] !== undefined) {
        if (input["bereich"] !== undefined || input["uebernahme"] !== undefined) {
            throw new JobFailure(
                "input_invalid",
                'Wiki-Auftrag: "bereiche" gilt allein, ohne "bereich" und "uebernahme"',
                false,
            );
        }
        const roh = input["bereiche"];
        if (!Array.isArray(roh) || roh.length === 0) {
            throw new JobFailure("input_invalid", 'Wiki-Auftrag: "bereiche" ist keine Liste von Bereichen', false);
        }
        const bereiche = WIKISYNC_BEREICHE.filter((bereich) => roh.includes(bereich));
        if (bereiche.length !== new Set(roh).size) {
            throw new JobFailure("input_invalid", 'Wiki-Auftrag: "bereiche" nennt etwas, das kein Bereich ist', false);
        }
        return {
            art: "ganz",
            lauf: ganzeZahl(input["lauf"], "lauf", true) as number,
            bereiche,
            ...grundAus(input["grund"]),
        };
    }
    return {
        art: "eine",
        bereich: bereichAus(input["bereich"], "bereich"),
        lauf: ganzeZahl(input["lauf"], "lauf", true) as number,
        uebernahme: ganzeZahl(input["uebernahme"], "uebernahme", true) as number,
        ...grundAus(input["grund"]),
    };
}

// Dieselben Umgebungen wie `AUTH_ENVIRONMENTS`; hier abgeschrieben, damit ein Auftrag die Anmeldung nicht laden muss.
const UMGEBUNGEN: readonly string[] = ["development", "staging", "production", "test"];

/** Die Umgebung dieses Prozesses für `map_operation.environment`; ohne Angabe `development`. */
export function umgebungVon(environment: NodeJS.ProcessEnv): AuthEnvironment {
    const wert = (environment["AVESMAPS_ENV"] ?? "").trim();
    return UMGEBUNGEN.includes(wert) ? (wert as AuthEnvironment) : "development";
}

export async function handelnder(
    db: Database,
    jobPublicId: string,
    environment: AuthEnvironment,
): Promise<{ actor: MapActor; von: string | null; label: string | null }> {
    const [zeile] = await db<
        { actor_ref: string | null }[]
    >`SELECT actor_ref FROM job WHERE public_id = ${jobPublicId}::uuid`;
    const { von, label } = ausloeserVon(zeile?.actor_ref ?? null);
    const actor: MapActor =
        von !== null
            ? { kind: "person", personId: von, environment }
            : { kind: "system", label: (label ?? "wikisync").slice(0, 80), environment };
    return { actor, von, label };
}

/** Ein Fehler der Operation an der Karte als Fehler des Auftrags: Ein anderer 503 ist einen späteren Versuch wert. */
function alsAuftragsfehler(fehler: unknown): never {
    if (fehler instanceof ApiError) throw new JobFailure(fehler.code, fehler.message, fehler.statusCode === 503);
    throw fehler;
}

/** Was im Protokoll eines Bereichs steht, den der Legacy-Zug aufgehalten hat: kein Fehler, ein Warten (Betrieb 2026-10-26). */
export const GRUND_WARTET_LEGACY_ZUG = "Wartet, bis der Import fertig ist; danach läuft der Auftrag von selbst weiter.";

/** Hält der Legacy-Zug gerade die Kartendomäne (`map_import_running`, `editor/map-operation.ts`)? Dann ist nichts geschrieben, und der Auftrag wartet. */
const zugHaeltDieKarte = (fehler: unknown): boolean =>
    fehler instanceof ApiError && fehler.code === "map_import_running";

/**
 * Läuft ein Legacy-Zug, gibt der Auftrag seinen Platz zurück, bevor er etwas anlegt (`JobStopped`: zurück in die Warteschlange, ohne einen Versuch zu verbrauchen); der Dirigent startet ihn
 * erst nach dem Zug wieder (`exclusivePairs`). Das fängt den Fall, dass der Zug erst nach der Zulassung dieses Auftrags anlief (Claudios Abholer nimmt ihn an der Warteschlange vorbei).
 */
async function warteAufDenZug(db: Database): Promise<void> {
    if (await legacyZugLaeuft(db)) throw new JobStopped();
}

async function melde(
    db: Database,
    id: number,
    status: "abgebrochen" | "fehlgeschlagen" | "abgelehnt",
    grund: string,
): Promise<void> {
    await schliesseUebernahme(db, id, { status, grund, zahlen: {} }).catch(() => undefined);
}

/** `wiki_uebernehmen`: die gewählten Bereiche nacheinander übernehmen, jeder in seiner Transaktion. */
export async function runWikiUebernehmenJob(
    context: JobContext,
    deps: UebernahmeAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    const eingabe = leseUebernehmenEingabe(context.input);
    const umgebung = deps.environment ?? process.env;
    const mitDatenbank = deps.mitDatenbank ?? withJobDatabase;
    return mitDatenbank(async (db) => {
        await context.beginPhase("pruefen", 0.05);
        await warteAufDenZug(db);
        const wer = await handelnder(db, context.job.publicId, umgebungVon(umgebung));
        const mapDomainId = context.job.mapDomainId ?? AVENTURIA.mapDomain;
        const ergebnisse: BereichsErgebnis[] = [];
        for (const [index, bereich] of eingabe.bereiche.entries()) {
            await context.beginPhase("uebernehmen", 0.1 + (0.85 * index) / eingabe.bereiche.length);
            const pruefung = await pruefeUebernahme(db, bereich, eingabe.lauf);
            if (!pruefung.ok) {
                // Ein Bereich, der nicht anläuft, bekommt trotzdem seine Zeile: Das Protokoll sagt, warum nichts geschah.
                const id = await legeUebernahmeAn(db, {
                    art: "uebernahme",
                    bereich,
                    laufId: eingabe.lauf ?? 0,
                    dump: { datei: null, sha256: null, stand: null },
                    jobPublicId: context.job.publicId,
                    ausgeloestVon: wer.von,
                    ausgeloestLabel: wer.label,
                });
                await melde(db, id, "abgelehnt", pruefung.grund);
                ergebnisse.push({ bereich, uebernahme: id, status: "abgelehnt", grund: pruefung.grund });
                continue;
            }
            const id = await legeUebernahmeAn(db, {
                art: "uebernahme",
                bereich,
                laufId: pruefung.lauf.id,
                dump: pruefung.lauf.dump,
                kategorien: pruefung.lauf.kategorien,
                jobPublicId: context.job.publicId,
                ausgeloestVon: wer.von,
                ausgeloestLabel: wer.label,
            });
            await raeumeVerwaisteAb(db, bereich, id);
            try {
                const ergebnis = await uebernimmBereich({
                    db,
                    bereich,
                    schreiber: pruefung.schreiber,
                    lauf: pruefung.lauf,
                    uebernahmeId: id,
                    actor: wer.actor,
                    mapDomainId,
                    jobPublicId: context.job.publicId,
                    vorDemSchreiben: () => context.checkpoint(),
                });
                ergebnisse.push({
                    bereich,
                    uebernahme: id,
                    status: "fertig",
                    operationId: ergebnis.operationId,
                    zahlen: ergebnis.zahlen,
                });
            } catch (fehler) {
                if (fehler instanceof JobCancelled || fehler instanceof JobStopped) {
                    await melde(db, id, "abgebrochen", "Abgebrochen, bevor etwas geschrieben wurde");
                    throw fehler;
                }
                if (fehler instanceof UebernahmeAbgelehnt) {
                    await melde(db, id, "abgelehnt", fehler.grund);
                    ergebnisse.push({ bereich, uebernahme: id, status: "abgelehnt", grund: fehler.grund });
                    continue;
                }
                if (zugHaeltDieKarte(fehler)) {
                    // Der Zug lief erst nach dem Start an: Dieser Bereich ist zurückgerollt, nichts ist geschrieben. Der Auftrag wartet und übernimmt danach von vorn.
                    await melde(db, id, "abgebrochen", GRUND_WARTET_LEGACY_ZUG);
                    throw new JobStopped();
                }
                await melde(db, id, "fehlgeschlagen", fehler instanceof Error ? fehler.message : String(fehler));
                return alsAuftragsfehler(fehler);
            }
        }
        await context.beginPhase("abschliessen", 0.98);
        return { bereiche: ergebnisse };
    });
}

interface RueckZeile {
    id: number;
    operation_id: string | null;
    zurueckgenommen_am: Date | null;
    dump_datei: string | null;
    dump_sha256: string | null;
    dump_stand: string | null;
}

/** Nimmt EINE Übernahme zurück: legt das Protokoll an, ruft den Schreiber, meldet Abbruch und Fehler. */
async function nimmEineUebernahmeZurueck(
    db: Database,
    context: JobContext,
    wer: { actor: MapActor; von: string | null; label: string | null },
    bereich: WikisyncBereich,
    lauf: number,
    uebernahme: RueckZeile & { operation_id: string },
    schreiber: Schreiber,
    grund?: string,
): Promise<BereichsErgebnis> {
    const id = await legeUebernahmeAn(db, {
        art: "zuruecknahme",
        bereich,
        laufId: lauf,
        zurueckVon: uebernahme.id,
        dump: { datei: uebernahme.dump_datei, sha256: uebernahme.dump_sha256, stand: uebernahme.dump_stand },
        jobPublicId: context.job.publicId,
        ausgeloestVon: wer.von,
        ausgeloestLabel: wer.label,
    });
    await raeumeVerwaisteAb(db, bereich, id);
    try {
        const ergebnis = await nimmZurueck({
            db,
            bereich,
            schreiber,
            uebernahme: { id: uebernahme.id, operationId: uebernahme.operation_id },
            rueckId: id,
            actor: wer.actor,
            mapDomainId: context.job.mapDomainId ?? AVENTURIA.mapDomain,
            jobPublicId: context.job.publicId,
            vorDemSchreiben: () => context.checkpoint(),
            ...(grund === undefined ? {} : { grund }),
        });
        return {
            bereich,
            uebernahme: id,
            status: "fertig",
            operationId: ergebnis.operationId,
            zahlen: ergebnis.zahlen,
        };
    } catch (fehler) {
        if (fehler instanceof JobCancelled || fehler instanceof JobStopped) {
            await melde(db, id, "abgebrochen", "Abgebrochen, bevor etwas geschrieben wurde");
            throw fehler;
        }
        if (zugHaeltDieKarte(fehler)) {
            await melde(db, id, "abgebrochen", GRUND_WARTET_LEGACY_ZUG);
            throw new JobStopped();
        }
        await melde(db, id, "fehlgeschlagen", fehler instanceof Error ? fehler.message : String(fehler));
        return alsAuftragsfehler(fehler);
    }
}

/**
 * `wiki_zuruecknehmen`: eine Übernahme je Bereich und Lauf zurücknehmen, oder den ganzen Lauf (alle Bereiche, deren Übernahme dieses Laufs noch steht, nacheinander, jeder in seiner Transaktion;
 * ein Fehler hält die übrigen nicht auf die Probe: Er bricht den Auftrag ab, was schon zurückgenommen ist, bleibt es).
 */
export async function runWikiZuruecknehmenJob(
    context: JobContext,
    deps: UebernahmeAbhaengigkeiten = {},
): Promise<Record<string, unknown>> {
    const eingabe = leseZuruecknehmenEingabe(context.input);
    const umgebung = deps.environment ?? process.env;
    const mitDatenbank = deps.mitDatenbank ?? withJobDatabase;
    if (eingabe.art !== "ganz" && schreiberFuer(eingabe.bereich) === undefined) {
        throw new JobFailure("nicht_angeschlossen", "Für diesen Bereich gibt es noch keine Übernahme", false);
    }
    return mitDatenbank(async (db) => {
        await context.beginPhase("pruefen", 0.05);
        await warteAufDenZug(db);
        const wer = await handelnder(db, context.job.publicId, umgebungVon(umgebung));
        if (eingabe.art === "objekt") {
            // Der Sync an EINEM Objekt (Wiki-Box): derselbe Kern wie die Rücknahme eines Laufs, ohne Zeile in `wikisync_uebernahme`; die Befunde stehen im Ergebnis des Auftrags.
            const schreiber = schreiberFuer(eingabe.bereich) as Schreiber;
            await context.beginPhase("zuruecknehmen", 0.2);
            const ergebnis = await nimmObjektSyncZurueck({
                db,
                bereich: eingabe.bereich,
                schreiber,
                syncOperationId: eingabe.operationId,
                actor: wer.actor,
                mapDomainId: context.job.mapDomainId ?? AVENTURIA.mapDomain,
                jobPublicId: context.job.publicId,
                vorDemSchreiben: () => context.checkpoint(),
                ...(eingabe.grund === undefined ? {} : { grund: eingabe.grund }),
            });
            await context.beginPhase("abschliessen", 0.98);
            return {
                bereich: eingabe.bereich,
                status: "fertig",
                operationId: ergebnis.operationId,
                felder: ergebnis.felder,
                befunde: ergebnis.befunde.length,
            };
        }
        if (eingabe.art === "eine") {
            const schreiber = schreiberFuer(eingabe.bereich) as Schreiber;
            const [uebernahme] = await db<RueckZeile[]>`
                SELECT id::int AS id, operation_id::text AS operation_id, zurueckgenommen_am, dump_datei, dump_sha256, dump_stand
                  FROM wikisync_uebernahme
                 WHERE id = ${eingabe.uebernahme} AND bereich = ${eingabe.bereich} AND lauf_id = ${eingabe.lauf}
                   AND art IN ('uebernahme', 'zuruecknahme') AND status = 'fertig'
            `;
            if (uebernahme === undefined || uebernahme.operation_id === null) {
                throw new JobFailure(
                    "nichts_zurueckzunehmen",
                    "Diese Übernahme hat nichts geschrieben oder gibt es nicht",
                    false,
                );
            }
            if (uebernahme.zurueckgenommen_am !== null) {
                throw new JobFailure("schon_zurueckgenommen", "Diese Übernahme ist schon zurückgenommen", false);
            }
            await context.beginPhase("zuruecknehmen", 0.2);
            const ergebnis = await nimmEineUebernahmeZurueck(
                db,
                context,
                wer,
                eingabe.bereich,
                eingabe.lauf,
                { ...uebernahme, operation_id: uebernahme.operation_id },
                schreiber,
                eingabe.grund,
            );
            await context.beginPhase("abschliessen", 0.98);
            return { ...ergebnis };
        }

        // Der ganze Lauf: je Bereich die jüngste Übernahme dieses Laufs, die etwas geschrieben hat und noch steht.
        const ergebnisse: BereichsErgebnis[] = [];
        for (const [index, bereich] of eingabe.bereiche.entries()) {
            await context.beginPhase("zuruecknehmen", 0.1 + (0.85 * index) / eingabe.bereiche.length);
            const schreiber = schreiberFuer(bereich);
            const [uebernahme] = await db<RueckZeile[]>`
                SELECT id::int AS id, operation_id::text AS operation_id, zurueckgenommen_am, dump_datei, dump_sha256, dump_stand
                  FROM wikisync_uebernahme
                 WHERE bereich = ${bereich} AND lauf_id = ${eingabe.lauf} AND art = 'uebernahme' AND status = 'fertig'
                   AND operation_id IS NOT NULL AND zurueckgenommen_am IS NULL
                 ORDER BY id DESC LIMIT 1
            `;
            if (schreiber === undefined || uebernahme === undefined || uebernahme.operation_id === null) {
                ergebnisse.push({ bereich, uebernahme: null, status: "abgelehnt", grund: "nichts_zurueckzunehmen" });
                continue;
            }
            ergebnisse.push(
                await nimmEineUebernahmeZurueck(
                    db,
                    context,
                    wer,
                    bereich,
                    eingabe.lauf,
                    { ...uebernahme, operation_id: uebernahme.operation_id },
                    schreiber,
                    eingabe.grund,
                ),
            );
        }
        await context.beginPhase("abschliessen", 0.98);
        return { lauf: eingabe.lauf, bereiche: ergebnisse };
    });
}
