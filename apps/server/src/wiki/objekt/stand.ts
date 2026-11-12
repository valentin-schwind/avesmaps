import type { WikiBoxArt, WikiBoxErgebnis, WikiBoxFehler, WikiBoxLetzter } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { isMissingTable } from "../../system/state-row.ts";
import { kuerze } from "../infobox/text.ts";
import type { FeldSchritt } from "../abgleich/uebernahme/schreiber.ts";

/**
 * Der Stand des Syncs je Objekt (WI-0253, Wiki-Box; Migration 0238 `wikisync_objekt`): Zeit, Ergebnis und Auslöser des letzten Syncs, dazu der letzte Fehlschlag mit dem Ende der Pause. Ein Protokoll, nie ein
 * Fachwert: Keine Fachtafel liest es.
 *
 * - **Schreiben** (`merkeErfolge`, `merkeFehlschlag`) darf nur die Jobs-Rolle (`system-grants.psql`): der Auftrag `wiki_artikel` mit Objekt (eine Person) und die Übernahme eines Laufs (`automatisch`). Das
 *   Protokoll darf nie etwas aufhalten: Fehlt die Tafel oder das Recht (das Release ist da, die Grants noch nicht), tut `weich` nichts, statt die Übernahme abzubrechen.
 * - **Lesen** (`leseObjektStand`) auch als App-Rolle. Ein Weg, eine Kraftlinie oder eine Landschaft trägt die Zeile an jedem seiner Abschnitte; gelesen wird die jüngste.
 */

export type ObjektErgebnis = Exclude<WikiBoxErgebnis, "fehlgeschlagen">;

/** Das Ergebnis eines Syncs an einem Objekt: wie viele Felder sich änderten und welche. */
export interface ObjektErfolg {
    ergebnis: ObjektErgebnis;
    felder: string[];
    anzahl: number;
}

/** Wer es war: eine Person (`von`), ein Werkzeug (`label`) oder der automatische Lauf (`automatisch`). */
export interface Ausloeser {
    von: string | null;
    label: string | null;
    automatisch: boolean;
}

/** Höchstens so viele Felder merkt sich eine Zeile (die Tafel verlangt es). */
const FELDER_MAX = 40;

/** Das Ergebnis EINES Objekts aus den Schritten der Übernahme: `uebernommen`, wenn sich ein wirksamer Wert änderte, `stand`, wenn nur der Wiki-Stand nachzog, sonst `keine_aenderung`. */
export function erfolgAusSchritten(schritte: readonly FeldSchritt[]): ObjektErfolg {
    const felder = [...new Set(schritte.filter((schritt) => schritt.wirksam !== undefined).map((s) => s.feld))];
    if (felder.length > 0) {
        return { ergebnis: "uebernommen", felder: felder.slice(0, FELDER_MAX), anzahl: felder.length };
    }
    return schritte.some((schritt) => schritt.schnappschuss !== undefined)
        ? { ergebnis: "stand", felder: [], anzahl: 0 }
        : { ergebnis: "keine_aenderung", felder: [], anzahl: 0 };
}

/** Das Ergebnis je Objekt, wie die Übernahme eines Bereichs es hinterlässt: nur für die berührten Objekte. */
export function erfolgeAusSchritten(
    schritte: readonly FeldSchritt[],
    beruehrt: readonly string[],
): Map<string, ObjektErfolg> {
    const ergebnisse = new Map<string, ObjektErfolg>();
    for (const id of beruehrt) {
        ergebnisse.set(id, erfolgAusSchritten(schritte.filter((schritt) => schritt.objekt.id === id)));
    }
    return ergebnisse;
}

/**
 * Die Arten, die `wikisync_objekt` annimmt (CHECK der Migrationen 0238 und 0282: der Gipfel seit WI-0271 L4). Eine Art, die hier fehlt, hält keinen Stand des Syncs fest
 * (die Felder schreibt der Sync trotzdem); ein INSERT einer Art, die der CHECK nicht kennt, bräche mit ihm die ganze Übernahme.
 */
const STAND_ARTEN: ReadonlySet<WikiBoxArt> = new Set<WikiBoxArt>([
    "ort",
    "weg",
    "gebiet",
    "region",
    "kraftlinie",
    "gipfel",
]);

/** Gibt es die Tafel, und darf diese Rolle sie schreiben? Sonst bleibt das Protokoll stumm (Release vor den Grants). */
async function darfSchreiben(db: Queryable): Promise<boolean> {
    const [zeile] = await db<{ ok: boolean | null }[]>`
        SELECT (to_regclass('public.wikisync_objekt') IS NOT NULL
                AND has_table_privilege('public.wikisync_objekt', 'INSERT')
                AND has_table_privilege('public.wikisync_objekt', 'UPDATE')) AS ok
    `;
    return zeile?.ok === true;
}

export interface WikiHerkunft {
    revision: number | null;
    stand: Date | null;
}

/**
 * Hält den Erfolg fest, je Objekt eine Zeile (anlegen oder überschreiben); ein früherer Fehlschlag fällt. Tut nichts, wo die Tafel fehlt oder die Rolle sie nicht schreiben darf. Läuft in der
 * Transaktion der Operation, damit der Stand nie vor dem Geschriebenen steht.
 */
export async function merkeErfolge(
    db: Queryable,
    art: WikiBoxArt,
    eintraege: ReadonlyMap<string, ObjektErfolg>,
    wer: Ausloeser,
    zusatz: { wiki?: WikiHerkunft; jobPublicId?: string } = {},
): Promise<void> {
    if (!STAND_ARTEN.has(art) || eintraege.size === 0 || !(await darfSchreiben(db))) return;
    const zeilen = [...eintraege].map(([id, erfolg]) => ({
        id,
        ergebnis: erfolg.ergebnis,
        anzahl: erfolg.anzahl,
        felder: erfolg.felder.slice(0, FELDER_MAX),
    }));
    const label = wer.label === null ? null : kuerze(wer.label, 80);
    await db`
        INSERT INTO wikisync_objekt (art, objekt_id, am, ergebnis, anzahl, felder, automatisch, ausgeloest_von, ausgeloest_label, wiki_revision, wiki_stand, job_public_id)
        SELECT ${art}, r.id::uuid, now(), r.ergebnis, r.anzahl, ARRAY(SELECT jsonb_array_elements_text(r.felder)), ${wer.automatisch}, ${wer.von}::uuid, ${label},
               ${zusatz.wiki?.revision ?? null}::bigint, ${zusatz.wiki?.stand ?? null}::timestamptz, ${zusatz.jobPublicId ?? null}::uuid
          FROM jsonb_to_recordset(${db.json(zeilen as never)}::jsonb) AS r(id text, ergebnis text, anzahl int, felder jsonb)
        ON CONFLICT (art, objekt_id) DO UPDATE
           SET am = EXCLUDED.am, ergebnis = EXCLUDED.ergebnis, anzahl = EXCLUDED.anzahl, felder = EXCLUDED.felder, automatisch = EXCLUDED.automatisch,
               ausgeloest_von = EXCLUDED.ausgeloest_von, ausgeloest_label = EXCLUDED.ausgeloest_label, wiki_revision = EXCLUDED.wiki_revision,
               wiki_stand = EXCLUDED.wiki_stand, job_public_id = EXCLUDED.job_public_id,
               fehler_am = NULL, fehler_code = NULL, fehler = NULL, frei_ab = NULL
    `;
}

export interface Fehlschlag {
    code: string;
    text: string;
    /** Bis wann das Wiki Ruhe will (eine Drosselung oder eine Pause); sonst `null`. */
    freiAb: Date | null;
}

/** Hält den Fehlschlag fest, ohne den letzten Erfolg anzufassen. */
export async function merkeFehlschlag(
    db: Queryable,
    art: WikiBoxArt,
    ids: readonly string[],
    fehlschlag: Fehlschlag,
    jobPublicId?: string,
): Promise<void> {
    if (!STAND_ARTEN.has(art) || ids.length === 0 || !(await darfSchreiben(db))) return;
    await db`
        INSERT INTO wikisync_objekt (art, objekt_id, fehler_am, fehler_code, fehler, frei_ab, job_public_id)
        SELECT ${art}, t.id, now(), ${kuerze(fehlschlag.code, 64)}, ${kuerze(fehlschlag.text, 500)}, ${fehlschlag.freiAb}::timestamptz, ${jobPublicId ?? null}::uuid
          FROM unnest(${[...ids]}::uuid[]) AS t(id)
        ON CONFLICT (art, objekt_id) DO UPDATE
           SET fehler_am = EXCLUDED.fehler_am, fehler_code = EXCLUDED.fehler_code, fehler = EXCLUDED.fehler, frei_ab = EXCLUDED.frei_ab,
               job_public_id = EXCLUDED.job_public_id
    `;
}

export interface ObjektStand {
    letzter: WikiBoxLetzter | null;
    fehler: WikiBoxFehler | null;
}

type Zeile = Record<string, unknown>;
const zeitVon = (wert: unknown): Date | null => (wert instanceof Date ? wert : null);

/**
 * Der jüngste Erfolg und der jüngste Fehlschlag über die Abschnitte des Objekts. Ein Fehlschlag, den ein späterer Erfolg überholt hat, steht nicht mehr da. Fehlt die Tafel (vor Migration 0238),
 * gibt es nichts.
 */
export async function leseObjektStand(db: Queryable, art: WikiBoxArt, ids: readonly string[]): Promise<ObjektStand> {
    if (!STAND_ARTEN.has(art) || ids.length === 0) return { letzter: null, fehler: null };
    let zeilen: Zeile[];
    try {
        zeilen = await db<Zeile[]>`
            SELECT o.am, o.ergebnis, o.anzahl, o.felder, o.automatisch, COALESCE(p.display_name, o.ausgeloest_label) AS wer,
                   o.fehler_am, o.fehler_code, o.frei_ab
              FROM wikisync_objekt o LEFT JOIN avesmaps_auth.person p ON p.id = o.ausgeloest_von
             WHERE o.art = ${art} AND o.objekt_id = ANY(${[...ids]}::uuid[])
        `;
    } catch (fehler) {
        if (isMissingTable(fehler)) return { letzter: null, fehler: null };
        throw fehler;
    }
    let erfolg: Zeile | undefined;
    let fehlschlag: Zeile | undefined;
    for (const zeile of zeilen) {
        const am = zeitVon(zeile["am"]);
        if (am !== null && (erfolg === undefined || am > (zeitVon(erfolg["am"]) ?? new Date(0)))) erfolg = zeile;
        const fehlerAm = zeitVon(zeile["fehler_am"]);
        if (
            fehlerAm !== null &&
            (fehlschlag === undefined || fehlerAm > (zeitVon(fehlschlag["fehler_am"]) ?? new Date(0)))
        )
            fehlschlag = zeile;
    }
    const letzter: WikiBoxLetzter | null =
        erfolg === undefined
            ? null
            : {
                  am: (zeitVon(erfolg["am"]) as Date).toISOString(),
                  ergebnis: erfolg["ergebnis"] as ObjektErgebnis,
                  felder: (erfolg["felder"] as string[] | null) ?? [],
                  anzahl: Number(erfolg["anzahl"] ?? 0),
                  automatisch: erfolg["automatisch"] === true,
                  wer: erfolg["automatisch"] === true ? null : ((erfolg["wer"] as string | null) ?? null),
              };
    const fehlerAm = fehlschlag === undefined ? null : zeitVon(fehlschlag["fehler_am"]);
    const ueberholt = fehlerAm !== null && erfolg !== undefined && (zeitVon(erfolg["am"]) ?? new Date(0)) >= fehlerAm;
    const fehler: WikiBoxFehler | null =
        fehlschlag === undefined || fehlerAm === null || ueberholt
            ? null
            : {
                  am: fehlerAm.toISOString(),
                  code: String(fehlschlag["fehler_code"]),
                  freiAb: zeitVon(fehlschlag["frei_ab"])?.toISOString() ?? null,
              };
    return { letzter, fehler };
}
