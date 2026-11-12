import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { recordEvent } from "../auth/audit.ts";
import type { CliIo } from "../auth/cli-commands.ts";
import { loadAuthConfig } from "../auth/config.ts";
import { createDatabase, type Database, type Queryable } from "../database.ts";
import {
    LegacyDateiFehler,
    bezugJson,
    planeUebernahme,
    pruefeDatei,
    type OrtZeile,
    type Plan,
    type Uebernahme,
} from "./community-legacy.ts";

/**
 * Der Lauf von `community:legacy` (WI-0268 C9): die offenen Meldungen aus Legacy einmalig als Vorgänge der Community übernehmen.
 * Der Einstieg ist `community-legacy-cli.ts`; hier liegt, was sich ohne Prozess prüfen lässt.
 *
 * 🔴 OHNE `--anwenden` kein einziger Schreibzugriff: Das Werkzeug liest die Datei und die Orte, zählt und berichtet. MIT `--anwenden` ist `--operator-said "<Zitat>"`
 * Pflicht (Map Mutation Guard: der persönliche, scope-genaue Zuruf des Betreibers für genau diese Umgebung); fehlt er, bricht das Werkzeug ab, bevor es die Datei oder die
 * Datenbank anfasst. Jede Meldung geht in einer eigenen Transaktion hinein (`community_legacy_uebernehmen`, wiederholbar über die Legacy-Nummer), danach prüft das Werkzeug
 * jede übernommene Meldung gegen die Datei und schreibt EINEN Protokolleintrag (`system.community_legacy_uebernommen`, nur Zahlen).
 *
 * 🔴 Datenschutz: Weder Bericht noch Protokoll nennen einen Namen oder Text, nur Legacy-Nummern und Zahlen. Die Datei trägt Namen und Texte: Sie bleibt lokal, wird nie
 * committet und nach dem Lauf gelöscht.
 */

/** Wo die Datei ohne `--datei` liegt (Download-Fach des Entwicklungsrechners; auf dem VPS gibt Claudio den Pfad an). */
export const STANDARD_DATEI = "C:\\avesmaps3d-data\\legacy-snapshots\\aktuell\\map-reports-offen.json";

export const USAGE =
    'usage: community:legacy [--datei <map-reports-offen.json>] [--anwenden --operator-said "<Zitat des Betreibers>"]';

export interface LaufDeps {
    /** Eine fertige Verbindung (Tests); sonst `DATABASE_URL`. */
    database?: Database | undefined;
    /** Der Systembenutzer für das Protokoll (Tests); sonst der angemeldete. */
    systemUser?: string | undefined;
}

// --- Datenbank --------------------------------------------------------------------------------------------------------------------------------

/** Die aktiven Orte der Welt `aventuria` (Lage als x/y der Karte), nach Kennung geordnet: gleiche Eingabe, gleiches Ergebnis. */
export async function leseOrte(db: Queryable): Promise<OrtZeile[]> {
    const rows = await db<{ public_id: string; name: string; subtype: string; x: number; y: number }[]>`
        SELECT public_id::text AS public_id, name, subtype, ST_X(geom) AS x, ST_Y(geom) AS y
          FROM place
         WHERE map_domain_id = 'aventuria' AND is_active
         ORDER BY public_id
    `;
    return rows.map((row) => ({ publicId: row.public_id, name: row.name, subtype: row.subtype, x: row.x, y: row.y }));
}

/** Welche der Legacy-Nummern schon übernommen sind; `undefined`, wenn die Tafel fehlt (Migration 0277 noch nicht eingespielt). */
export async function leseSchonUebernommen(
    db: Queryable,
    ids: readonly number[],
): Promise<ReadonlySet<number> | undefined> {
    const [da] = await db<{ da: boolean }[]>`SELECT to_regclass('avesmaps_community.legacy_meldung') IS NOT NULL AS da`;
    if (da?.da !== true) return undefined;
    const rows = await db<{ legacy_id: number }[]>`
        SELECT legacy_id FROM avesmaps_community.legacy_meldung WHERE legacy_id = ANY(${[...ids]}::int[])
    `;
    return new Set(rows.map((row) => row.legacy_id));
}

async function funktionDa(db: Queryable): Promise<boolean> {
    const [da] = await db<{ da: boolean }[]>`
        SELECT to_regprocedure(
            'avesmaps_community.community_legacy_uebernehmen(integer,text,text,text,text,text,jsonb,timestamptz,text)'
        ) IS NOT NULL AS da
    `;
    return da?.da === true;
}

/** Eine Meldung übernehmen, in einer eigenen Transaktion. Gibt die Kennung des Vorgangs zurück (bei einer schon übernommenen die vorhandene). */
export async function uebernehmeEine(database: Database, u: Uebernahme): Promise<number> {
    return database.begin(async (tx) => {
        const [row] = await tx<{ id: string }[]>`
            SELECT avesmaps_community.community_legacy_uebernehmen(
                ${u.legacyId}::int, ${u.kategorie}, ${u.text}, ${u.quelle}, ${u.fehltArt}, ${u.melderName},
                ${tx.json(bezugJson(u.bezug) as never)}::jsonb, ${u.eingegangenAt}::timestamptz, ${u.notiz}
            )::text AS id
        `;
        return Number(row?.id);
    });
}

interface PruefZeile {
    legacy_id: number;
    art: string;
    kategorie: string;
    fehlt_art: string | null;
    eingang: string;
    quelle: string | null;
    bezuege: number;
    nachrichten: number;
    bezug_art: string | null;
    objekt_id: string | null;
    lage_x: number | null;
    lage_y: number | null;
    vorschlag_x: number | null;
    vorschlag_y: number | null;
    text: string | null;
    melder_name: string | null;
    melder_mail: string | null;
    melder_discord: string | null;
    melder_person: string | null;
    melder_schluessel: boolean | null;
    melder_da: boolean;
}

const nahe = (a: number | null, b: number | undefined): boolean =>
    a === null ? b === undefined : b !== undefined && Math.abs(a - b) < 1e-9;

/**
 * Prüft jede übernommene Meldung gegen die Datei: genau ein Vorgang, ein Bezug und eine Nachricht; Text, Kategorie, Art des Fehlenden, Quelle, Lage und Melder stimmen,
 * und am Melder hängt nichts als der Name. Gibt die Legacy-Nummern zurück, bei denen etwas nicht stimmt (leer = alles in Ordnung).
 */
export async function pruefeNachLauf(db: Queryable, uebernahmen: readonly Uebernahme[]): Promise<number[]> {
    const rows = await db<PruefZeile[]>`
        SELECT l.legacy_id, v.art, v.kategorie, v.fehlt_art, v.eingang, v.quelle,
               (SELECT count(*)::int FROM avesmaps_community.bezug x WHERE x.vorgang_id = v.id) AS bezuege,
               (SELECT count(*)::int FROM avesmaps_community.nachricht x WHERE x.vorgang_id = v.id AND x.richtung = 'ein') AS nachrichten,
               b.art AS bezug_art, b.objekt_id::text AS objekt_id, b.lage_x, b.lage_y, b.vorschlag_x, b.vorschlag_y,
               n.text,
               m.name AS melder_name, m.mail AS melder_mail, m.discord_id AS melder_discord, m.person_id::text AS melder_person,
               (m.schluessel_hash IS NOT NULL) AS melder_schluessel, (m.vorgang_id IS NOT NULL) AS melder_da
          FROM avesmaps_community.legacy_meldung l
          JOIN avesmaps_community.vorgang v ON v.id = l.vorgang_id
          LEFT JOIN avesmaps_community.bezug b ON b.vorgang_id = v.id
          LEFT JOIN avesmaps_community.nachricht n ON n.vorgang_id = v.id AND n.richtung = 'ein'
          LEFT JOIN avesmaps_community.melder m ON m.vorgang_id = v.id
         WHERE l.legacy_id = ANY(${uebernahmen.map((u) => u.legacyId)}::int[])
    `;
    const jeId = new Map<number, PruefZeile[]>();
    for (const row of rows) jeId.set(row.legacy_id, [...(jeId.get(row.legacy_id) ?? []), row]);
    const falsch: number[] = [];
    for (const u of uebernahmen) {
        const zeilen = jeId.get(u.legacyId) ?? [];
        const z = zeilen[0];
        const bezug = u.bezug;
        const vorschlag = bezug.art === "objekt" ? bezug.vorschlagLage : undefined;
        const stimmt =
            zeilen.length === 1 &&
            z !== undefined &&
            z.art === "meldung" &&
            z.eingang === "website" &&
            z.bezuege === 1 &&
            z.nachrichten === 1 &&
            z.kategorie === u.kategorie &&
            z.fehlt_art === u.fehltArt &&
            z.quelle === u.quelle &&
            z.text === u.text &&
            z.bezug_art === bezug.art &&
            (bezug.art === "objekt" ? z.objekt_id === bezug.objektId : z.objekt_id === null) &&
            nahe(z.lage_x, bezug.lage.x) &&
            nahe(z.lage_y, bezug.lage.y) &&
            nahe(z.vorschlag_x, vorschlag?.x) &&
            nahe(z.vorschlag_y, vorschlag?.y) &&
            z.melder_da === (u.melderName !== null) &&
            z.melder_name === u.melderName &&
            z.melder_mail === null &&
            z.melder_discord === null &&
            z.melder_person === null &&
            z.melder_schluessel !== true;
        if (!stimmt) falsch.push(u.legacyId);
    }
    return falsch;
}

// --- Bericht ----------------------------------------------------------------------------------------------------------------------------------

/** Höchstens so viele Nummern nennt der Bericht je Zeile. */
const NUMMERN_MAX = 20;

function nummern(ids: readonly number[]): string {
    if (ids.length === 0) return "";
    const gezeigt = ids.slice(0, NUMMERN_MAX).join(", ");
    return ` (Legacy-Nummern ${gezeigt}${ids.length > NUMMERN_MAX ? ", …" : ""})`;
}

/** Die Zeilen des Berichts: nur Zahlen und Legacy-Nummern. `schon` ist `undefined`, wenn die Tafel noch fehlt. */
export function berichtZeilen(plan: Plan, schon: ReadonlySet<number> | undefined): string[] {
    const b = plan.befunde;
    const zeilen: string[] = [];
    const zeile = (name: string, wert: number, ids: readonly number[] = []): void => {
        zeilen.push(`${name.padEnd(30)} ${String(wert).padStart(5)}${nummern(ids)}`);
    };
    zeile("geliefert", plan.geliefert);
    zeile("Testzeilen (ZZ-Systemtest)", b.testzeile.length, b.testzeile);
    zeile("Lage ungültig oder außerhalb", b.lageUngueltig.length, b.lageUngueltig);
    if (b.unbrauchbar.length > 0) zeile("Zeile unbrauchbar", b.unbrauchbar.length, b.unbrauchbar);
    if (b.doppelt.length > 0) zeile("Nummer doppelt in der Datei", b.doppelt.length, b.doppelt);
    zeile("zu übernehmen", plan.uebernahmen.length);
    zeile("  Objekt gefunden (Ort)", plan.objektGefunden);
    zeile("  Stelle", plan.stelle);
    zeile("  Text aufgefüllt", plan.aufgefuellt);
    for (const [kategorie, anzahl] of Object.entries(plan.jeKategorie).sort(([a], [c]) => a.localeCompare(c))) {
        zeile(`  Kategorie ${kategorie}`, anzahl);
    }
    if (schon === undefined) {
        zeilen.push(
            `${"schon übernommen".padEnd(30)} unbekannt (Tafel legacy_meldung fehlt: Migration 0277 ist nicht eingespielt)`,
        );
    } else {
        const vorhanden = plan.uebernahmen.filter((u) => schon.has(u.legacyId)).length;
        zeile("schon übernommen", vorhanden);
        zeile("noch zu übernehmen", plan.uebernahmen.length - vorhanden);
    }
    const hinweise: [string, readonly number[]][] = [
        ["Hinweis Art der Beschriftung unbekannt", b.artUnbekannt],
        ["Hinweis Meldeart unbekannt", b.typUnbekannt],
        ["Hinweis Quelle zu lang (entfällt)", b.quelleZuLang],
        ["Hinweis Name gekürzt", b.nameGekuerzt],
        ["Hinweis Text gekürzt", b.textGekuerzt],
    ];
    for (const [name, ids] of hinweise) if (ids.length > 0) zeile(name, ids.length, ids);
    return zeilen;
}

// --- Lauf -------------------------------------------------------------------------------------------------------------------------------------

/**
 * Der Lauf. Rückgabe: 0 in Ordnung, 1 Fehler in Datei, Datenbank oder Prüfung, 2 falscher Aufruf (auch: `--anwenden` ohne Zitat).
 */
export async function runCommunityLegacy(
    argv: readonly string[],
    environment: NodeJS.ProcessEnv,
    io: CliIo,
    deps: LaufDeps = {},
): Promise<number> {
    let werte;
    try {
        werte = parseArgs({
            args: [...argv],
            options: {
                datei: { type: "string" },
                anwenden: { type: "boolean", default: false },
                "operator-said": { type: "string" },
            },
            strict: true,
        }).values;
    } catch (error) {
        io.err(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
        return 2;
    }
    const anwenden = werte.anwenden === true;
    const zitat = werte["operator-said"]?.trim();
    // 🔴 Vor allem anderen: Wer schreiben will, braucht den Zuruf des Betreibers.
    if (anwenden && (zitat === undefined || zitat === "")) {
        io.err(
            `--anwenden schreibt in die Datenbank und braucht den Zuruf des Betreibers für genau diese Umgebung: --operator-said "<Zitat>". Nichts geschrieben.\n${USAGE}`,
        );
        return 2;
    }
    const datei = werte.datei ?? STANDARD_DATEI;

    const databaseUrl = environment["DATABASE_URL"];
    if (deps.database === undefined && databaseUrl === undefined) {
        io.err("DATABASE_URL fehlt.");
        return 2;
    }
    let umgebung;
    if (anwenden) {
        // Das Protokoll braucht die Umgebung; ohne sie wird gar nicht erst geschrieben.
        try {
            umgebung = loadAuthConfig(environment).environment;
        } catch (error) {
            io.err(`Die Umgebung ist nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
            return 2;
        }
        if (umgebung === undefined) {
            io.err("AVESMAPS_ENV fehlt: Ohne benannte Umgebung gibt es kein Protokoll, also wird nichts geschrieben.");
            return 2;
        }
    }

    let zeilen: unknown[];
    try {
        zeilen = pruefeDatei(JSON.parse(await readFile(datei, "utf8")) as unknown);
    } catch (error) {
        if (error instanceof LegacyDateiFehler) io.err(error.message);
        else if (error instanceof SyntaxError) io.err("Die Datei ist kein gültiges JSON.");
        else io.err(`Die Datei ist nicht lesbar: ${(error as NodeJS.ErrnoException).code ?? "Fehler"}`);
        return 1;
    }

    const database = deps.database ?? createDatabase(databaseUrl!, { max: 2 });
    try {
        const orte = await leseOrte(database);
        const plan = planeUebernahme(zeilen, orte);
        const ids = plan.uebernahmen.map((u) => u.legacyId);
        const schon = await leseSchonUebernommen(database, ids);

        io.out(
            anwenden ? `Freigabe (Betreiberzitat): „${zitat}“` : "PROBELAUF - ohne --anwenden wird nichts geschrieben",
        );
        if (!anwenden && zitat !== undefined && zitat !== "")
            io.out("Hinweis: --operator-said gilt nur mit --anwenden; dies ist ein Probelauf.");
        io.out(`Datei                          ${datei}`);
        io.out(`aktive Orte (aventuria)        ${String(orte.length).padStart(5)}`);
        for (const z of berichtZeilen(plan, schon)) io.out(z);
        if (!anwenden) return 0;

        if (schon === undefined || !(await funktionDa(database))) {
            io.err(
                "Die Migration 0277 ist in dieser Datenbank nicht eingespielt (Tafel oder Funktion fehlt). Nichts geschrieben.",
            );
            return 1;
        }
        let angelegt = 0;
        let vorhanden = 0;
        for (const u of plan.uebernahmen) {
            try {
                await uebernehmeEine(database, u);
            } catch (error) {
                // Nur Code und Meldung der Datenbank, nie die Einzelheiten der Zeile; die schon übernommenen bleiben, ein neuer Lauf macht weiter.
                const code = (error as { code?: string }).code ?? "Fehler";
                io.err(
                    `Abbruch bei Legacy-Nummer ${String(u.legacyId)} (${code}: ${error instanceof Error ? error.message : String(error)}). Bisher angelegt: ${String(angelegt)}. Ein neuer Lauf setzt fort.`,
                );
                return 1;
            }
            if (schon.has(u.legacyId)) vorhanden += 1;
            else angelegt += 1;
        }
        io.out(
            `übernommen                     ${String(angelegt).padStart(5)} neu angelegt, ${String(vorhanden)} waren schon da`,
        );

        const falsch = await pruefeNachLauf(database, plan.uebernahmen);
        const b = plan.befunde;
        const ausgefiltert = b.testzeile.length + b.lageUngueltig.length + b.unbrauchbar.length + b.doppelt.length;
        let ergebnis = 0;
        if (falsch.length === 0)
            io.out(
                `Prüfung                        alle ${String(plan.uebernahmen.length)} Meldungen stimmen mit der Datei überein`,
            );
        else {
            io.err(`Prüfung: ${String(falsch.length)} Meldungen weichen von der Datei ab${nummern(falsch)}.`);
            ergebnis = 1;
        }
        try {
            await database.begin((tx) =>
                recordEvent(tx, {
                    environment: umgebung!,
                    action: "system.community_legacy_uebernommen",
                    actorKind: "cli",
                    actorLabel: `cli:${deps.systemUser ?? userInfo().username}`,
                    targetRef: "legacy-meldungen",
                    details: { geliefert: plan.geliefert, angelegt, vorhanden, ausgefiltert, zitat: true },
                }),
            );
        } catch (error) {
            io.err(
                `Das Protokoll konnte nicht geschrieben werden (${(error as { code?: string }).code ?? "Fehler"}); die Übernahme selbst ist fertig. Bitte den Lauf mit Zahlen im Bericht an Claudia melden.`,
            );
            return 1;
        }
        io.out("Protokoll                      system.community_legacy_uebernommen geschrieben");
        io.out("Danach: die Datei löschen (sie trägt Namen und Texte).");
        return ergebnis;
    } finally {
        if (deps.database === undefined) await database.end({ timeout: 5 });
    }
}
