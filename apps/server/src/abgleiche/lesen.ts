import {
    ABGLEICH_JOBARTEN,
    ABGLEICH_KATEGORIE,
    ABGLEICH_QUELLEN,
    abgleichKreis,
    type AbgleichAusfuehrungen,
    type AbgleichAusloeser,
    type AbgleichAuftrag,
    type AbgleichLauf,
    type AbgleichQuelle,
    type AbgleichZeile,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { KEIN_UMSTAND, wartegrund, type Warteumstand } from "../jobs/wartegrund.ts";
import { isMissingTable } from "../system/state-row.ts";

/**
 * Das Lesemodell der Abgleiche (WI-0127 SYS-14): je Quelle der letzte fertige Lauf und ein wartender oder laufender Auftrag.
 *
 * 🔴 **Gezählt wird jeder Zug, nicht nur der Knopf.** „Stand des letzten Abgleichs“ heißt: wann die Daten zuletzt aus Legacy kamen. Dazu
 * zählen auch die Läufe, die sich selbst aufzeichnen (Herkunft `recorded`, Art `import`): `legacy:update` auf Zuruf (`legacy-update-…`),
 * der Zug im Korridor auf Stage (`import-…`) und dort der Medien-Binärimport (`media-files-…`). Ihre Lücken kennt die Warteschlange
 * nicht (`luecken: null`); ein erfolgreicher Lauf gilt dann als vollständig.
 */
const RECORDED_REFS: Readonly<Record<AbgleichQuelle, readonly string[]>> = {
    legacy: ["legacy-update-%", "import-%"],
    // Die Kategoriezeilen (WI-0141) zählen nur ihre eigenen Aufträge: Ein ganzer Zug sagt nichts darüber, wann DIESE Kategorie
    // zuletzt aus Legacy kam — er zieht sie mit, aber die Zeile oben nennt ihn schon.
    legacy_landschaften: [],
    legacy_wege: [],
    legacy_orte: [],
    medien: ["media-files-%"],
    // Der Production-Zug (WI-0144) zählt nur seine eigenen Aufträge: Er läuft ausschließlich über den Knopf, es gibt keinen
    // aufgezeichneten Lauf, der ihn von außen täte.
    production: [],
};

export interface JobRow {
    public_id: string;
    kind: string;
    state: string;
    phase: string | null;
    progress: number | null;
    wait_reason: string | null;
    queued_at: Date;
    started_at: Date | null;
    finished_at: Date | null;
    error_summary: string | null;
    result: Record<string, unknown> | null;
    label: string | null;
    actor_ref: string | null;
    display_name: string | null;
}

/** Eine Person mit Namen; sonst ein Ablauf mit seinem Etikett, ein Start von der Kommandozeile als `cli:<Systembenutzer>`. */
function ausloeser(row: JobRow): AbgleichAusloeser {
    if (row.display_name !== null) return { art: "person", name: row.display_name };
    const cli = row.actor_ref?.startsWith("cli:") === true ? row.actor_ref : null;
    return { art: "ablauf", name: row.label ?? cli };
}

function stringList(value: unknown): string[] | null {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;
}

export function lauf(row: JobRow): AbgleichLauf {
    const result = row.result ?? {};
    const befunde = result["befunde"];
    const satz = result["satz"];
    return {
        jobId: row.public_id,
        state: row.state as AbgleichLauf["state"],
        startedAt: row.started_at?.toISOString() ?? null,
        finishedAt: (row.finished_at ?? row.queued_at).toISOString(),
        ausgeloest: ausloeser(row),
        luecken: stringList(result["luecken"]),
        befunde: typeof befunde === "number" && Number.isInteger(befunde) && befunde >= 0 ? befunde : null,
        satz: typeof satz === "string" ? satz : null,
        fehler: row.error_summary,
    };
}

export function auftrag(row: JobRow, umstand: Warteumstand): AbgleichAuftrag {
    return {
        jobId: row.public_id,
        state: row.state as AbgleichAuftrag["state"],
        queuedAt: row.queued_at.toISOString(),
        startedAt: row.started_at?.toISOString() ?? null,
        phase: row.phase,
        progress: row.progress,
        // Dieselbe Stelle wie die Statusseite (WI-0160): pausiert, auf die Abholung, hinter einem laufenden Auftrag derselben Art,
        // oder niemand nimmt ihn an. Vorher stand hier ein eigener `pickup`-Ausdruck — eine zweite Semantik für dieselbe Frage.
        // Mit dem Stand des Dirigenten (WI-0163) dessen Grund und der Platz in der gemeinsamen Reihe.
        waitReason: wartegrund(
            { kind: row.kind, state: row.state, waitReason: row.wait_reason, publicId: row.public_id },
            umstand,
        ),
        ausgeloest: ausloeser(row),
        platz: row.state === "QUEUED" ? (umstand.stand?.plaetze.get(row.public_id) ?? null) : null,
    };
}

async function rowsFor(db: Queryable, quelle: AbgleichQuelle, active: boolean): Promise<JobRow[]> {
    const kind = ABGLEICH_JOBARTEN[quelle];
    const refs = RECORDED_REFS[quelle];
    // 🪤 Die drei Kategorien teilen die Jobart `legacy_zug`; die Zeile unterscheidet sie an der Eingabe des Auftrags.
    const kategorie = ABGLEICH_KATEGORIE[quelle];
    const rows = await db<JobRow[]>`
        SELECT j.public_id::text AS public_id, j.kind, j.state, j.phase, j.progress::float8 AS progress, j.wait_reason, j.queued_at,
               j.started_at, j.finished_at, j.error_summary, j.result, j.label, j.actor_ref, p.display_name
          FROM job j
          LEFT JOIN avesmaps_auth.person p ON p.id::text = j.actor_ref
         WHERE ((j.kind = ${kind} AND ${
             kategorie === null ? db`TRUE` : db`j.input_ref->>'kategorie' = ${kategorie}`
         }) OR (j.kind = 'import' AND j.external_ref LIKE ANY (${refs as string[]}::text[])))
           AND ${active ? db`j.state IN ('QUEUED', 'RUNNING')` : db`j.finished_at IS NOT NULL`}
         ORDER BY ${active ? db`(j.state = 'RUNNING') DESC, j.queued_at` : db`j.finished_at`} DESC, j.id DESC
         LIMIT 2
    `;
    return rows;
}

/**
 * Die Zeilen in der Reihenfolge der Quellen, je mit ihrer Ausführung (ohne Angabe `aus`). Fehlt die Warteschlange (vor Migration 0070),
 * steht jede Zeile leer da.
 */
export async function readAbgleiche(
    db: Queryable,
    modes: Partial<AbgleichAusfuehrungen> = {},
    umstand: Warteumstand = KEIN_UMSTAND,
): Promise<AbgleichZeile[]> {
    const zeilen: AbgleichZeile[] = [];
    for (const quelle of ABGLEICH_QUELLEN) {
        const ausfuehrung = modes[quelle] ?? "aus";
        try {
            const [[last], [active, danach]] = await Promise.all([
                rowsFor(db, quelle, false),
                rowsFor(db, quelle, true),
            ]);
            const letzter = last === undefined ? null : lauf(last);
            zeilen.push({
                quelle,
                kreis: abgleichKreis(letzter),
                letzter,
                // Läuft die Zeile, steht der laufende Auftrag vorn (mit Fortschritt); ein weiterer wartet dahinter.
                laufend: active === undefined ? null : auftrag(active, umstand),
                ...(active?.state === "RUNNING" && danach?.state === "QUEUED" ? { wartetDanach: true } : {}),
                ausfuehrung,
            });
        } catch (error) {
            if (!isMissingTable(error)) throw error;
            zeilen.push({ quelle, kreis: "leer", letzter: null, laufend: null, ausfuehrung });
        }
    }
    return mitHinter(zeilen);
}

/**
 * Wartet ein Auftrag, während ein anderer Abgleich dieser Umgebung läuft, nennt die Zeile den laufenden (Betreiber 2026-10-17: Ein Zug
 * reiht hinter einem laufenden ein, Handover `2026-10-17-legacy-zug-einreihen-hinter-laufendem-an-claudia.md`). Der Betrieb fährt
 * die Abgleiche nacheinander; „hinter“ ist also der, der gerade läuft.
 */
function mitHinter(zeilen: AbgleichZeile[]): AbgleichZeile[] {
    const laeuft = zeilen.find((zeile) => zeile.laufend?.state === "RUNNING");
    if (laeuft === undefined) return zeilen;
    return zeilen.map((zeile) =>
        zeile.laufend?.state === "QUEUED" ? { ...zeile, laufend: { ...zeile.laufend, hinter: laeuft.quelle } } : zeile,
    );
}
