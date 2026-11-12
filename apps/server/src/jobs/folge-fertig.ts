import type { BenachrichtigungArt, JobState } from "@avesmaps3d/shared";
import type { AuthEnvironment } from "../auth/config.ts";
import type { Queryable } from "../database.ts";
import { OHNE_KARTENBEZUG, isEditorJob } from "./editor-freeze.ts";

/**
 * Die Glocke meldet das Ende einer Auftragsfolge (WI-0230; Betreiber 2026-10-19 zur Warteschlange im Kopf: „wenn die warteschlange
 * abgearbeitet ist, kann sie die glocke benachrichtigen (Warteschlange fertig. Bitte neu laden oder so)“). Nur an die Person, die die
 * Aufträge ausgelöst hat (`actor_ref` ist ihre `person.id`), nur wenn keiner ihrer Aufträge mehr wartet oder läuft, und je Folge EINE
 * Meldung, nicht je Auftrag.
 *
 * - **Folge:** die Aufträge der Person, die ohne Pause aufeinander folgten: Vom zuletzt beendeten zurück gehört jeder dazu, der endete,
 *   nachdem ein späterer der Folge eingereiht wurde. Eine Kette (`terrain_local` → `dem_publish` → …) ist von Anfang an eingereiht und
 *   trägt dieselbe Person, darum endet ihre Folge erst mit dem letzten Glied.
 * - **Einmal:** Die Quelle ist der zuletzt beendete Auftrag der Folge. Enden zwei zugleich und prüfen beide, sehen beide denselben
 *   letzten, und `benachrichtige` legt nur eine Zeile an (`ON CONFLICT (an_person, quelle)`). Wer zuerst prüft, während der andere noch
 *   läuft, meldet nichts; jeder schreibt sein Ende, bevor er prüft, also sieht der Letzte alle.
 * - **Satz:** `warteschlange_fertig`, wenn die Karte jedes Ergebnis selbst nachlädt (`map.changed`, `area.changed`,
 *   `display_heights.changed`, siehe `terrain-live.ts`), sonst `warteschlange_fertig_laden`; ist ein Auftrag gescheitert oder
 *   abgebrochen, `warteschlange_fehler` (die Warteschlange im Kopf zeigt ihn, bis sie geöffnet wurde).
 *
 * 🪤 Ein Lauf, dessen Ausführer stirbt, endet in der Pflege (abgelaufene Lease): Dort meldet niemand. Die Glocke ist ein Hinweis, kein
 * Protokoll; die Warteschlange bleibt die Wahrheit.
 */

/** Arten, deren Ergebnis die Karte ohne Neuladen zeigt (sie melden ein Kartenereignis) oder die nichts Sichtbares ändern. */
export const SELBST_NACHGELADEN: ReadonlySet<string> = new Set([
    "territory_derive",
    "land_smooth",
    "label_runs",
    "path_label_runs",
    "terrain_local",
    "dem_publish",
    "terrain_full",
    "display_heights",
    "routing_reload",
    // Die Treffer der Sprachen (WI-0261 S4) stehen in keiner Kachel; die Zeile „Sprachen“ liest sie beim Öffnen einer Infobox.
    "sprache_treffer",
]);

/** So weit zurück reicht eine Folge höchstens; was davor endete, gehört zu einer früheren Meldung. */
export const FOLGE_HOECHSTENS_H = 6;

export type FolgeArt = Extract<
    BenachrichtigungArt,
    "warteschlange_fertig" | "warteschlange_fertig_laden" | "warteschlange_fehler"
>;

export interface FolgeZeile {
    publicId: string;
    kind: string;
    state: JobState;
    queuedAt: Date;
    finishedAt: Date | null;
}

/**
 * Die Folge, die mit dem zuletzt beendeten Auftrag endet; `null`, solange noch einer wartet oder läuft oder keiner endete. `zeilen`
 * sind die Aufträge EINER Person, in beliebiger Reihenfolge.
 */
export function letzteFolge(zeilen: readonly FolgeZeile[]): FolgeZeile[] | null {
    if (zeilen.some((zeile) => zeile.finishedAt === null)) return null;
    const beendet = [...zeilen].sort(
        (a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime() || b.publicId.localeCompare(a.publicId),
    );
    const [letzter] = beendet;
    if (letzter === undefined) return null;
    const folge = [letzter];
    let anfang = letzter.queuedAt.getTime();
    for (const zeile of beendet.slice(1)) {
        if (zeile.finishedAt!.getTime() < anfang) break;
        folge.push(zeile);
        anfang = Math.min(anfang, zeile.queuedAt.getTime());
    }
    return folge;
}

export function folgeArt(folge: readonly Pick<FolgeZeile, "kind" | "state">[]): FolgeArt {
    if (folge.some((zeile) => zeile.state === "FAILED" || zeile.state === "CANCELLED")) return "warteschlange_fehler";
    return folge.every((zeile) => SELBST_NACHGELADEN.has(zeile.kind))
        ? "warteschlange_fertig"
        : "warteschlange_fertig_laden";
}

export type FolgeMeldung =
    | { gemeldet: false; grund: "keine_person" | "laeuft_noch" }
    | { gemeldet: boolean; art: FolgeArt; quelle: string; auftraege: number };

/**
 * Nach dem Ende eines Auftrags: Ist die Folge seiner Person abgearbeitet, bekommt sie EINE Meldung. `gemeldet: false` mit `art` heißt,
 * ein anderer Ausführer hat dieselbe Folge schon gemeldet. Wirft bei Datenbankfehlern; der Aufrufer entscheidet, was dann geschieht.
 */
export async function meldeFolgeFertig(
    database: Queryable,
    umgebung: AuthEnvironment,
    actorRef: string | null,
): Promise<FolgeMeldung> {
    if (actorRef === null || !isEditorJob(actorRef)) return { gemeldet: false, grund: "keine_person" };
    const zeilen = await database<
        { public_id: string; kind: string; state: JobState; queued_at: Date; finished_at: Date | null }[]
    >`
        SELECT public_id::text, kind, state, queued_at, finished_at
          FROM job
         WHERE actor_ref = ${actorRef}
           AND NOT (kind = ANY(${[...OHNE_KARTENBEZUG]}::text[]))
           AND (state IN ('QUEUED', 'RUNNING') OR finished_at > now() - make_interval(hours => ${FOLGE_HOECHSTENS_H}))
    `;
    const folge = letzteFolge(
        zeilen.map((zeile) => ({
            publicId: zeile.public_id,
            kind: zeile.kind,
            state: zeile.state,
            queuedAt: zeile.queued_at,
            finishedAt: zeile.finished_at,
        })),
    );
    if (folge === null) return { gemeldet: false, grund: "laeuft_noch" };
    const art = folgeArt(folge);
    const quelle = `warteschlange:${umgebung}:${folge[0]!.publicId}`;
    const [row] = await database<{ angelegt: number }[]>`
        SELECT public.benachrichtige(
            ${umgebung}, jsonb_build_object('person', ${actorRef}::text), 'system', NULL, ${art}, NULL, NULL, ${quelle}
        ) AS angelegt
    `;
    return { gemeldet: (row?.angelegt ?? 0) > 0, art, quelle, auftraege: folge.length };
}
