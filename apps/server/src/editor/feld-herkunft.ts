import { fuehrtHerkunft, type EditorLockKind, type FeldHerkuenfte, type FeldHerkunft } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Die Herkunft je Feld mit Wiki-Wert am Server (WI-0225, Modell c; Vertrag `packages/shared/src/feld-herkunft.ts`, Tafel
 * `field_origin`, Migration 0183). EINE Stelle für alle Editoren, die Lesen und Schreiben ihrer Art hier andocken:
 *
 * - **Lesen** (`leseHerkunft`): im Detail der Art als `herkunft`, je Objekt die Felder mit Vermerk. Ein Feld ohne Vermerk fehlt.
 * - **Schreiben** (`setzeHerkunft`): im Schreibweg der EINEN Operation, in derselben Transaktion wie der Wert. Je geändertem Feld
 *   `herkunftDerAenderung(aenderung)`: `{ revert: "wiki" }` wird wiki (den Wert holt die Art aus ihrem Schnappschuss), `{ value }`
 *   wird manual. An einer Straße oder Kraftlinie aus mehreren Abschnitten gilt der Vermerk je Abschnitt (`ids`).
 * - Nur Felder aus `FELD_HERKUNFT_FELDER` (sonst ein Programmierfehler, er wirft). Gelöscht wird nie; die App-Rolle darf es nicht
 *   (`apps/server/src/db/map-grants.psql`).
 * - 🔴 Der Legacy-Zug schreibt diese Tafel nicht (WI-0225 §2); bis zum Cutoff kann ein Vermerk nach einem Zug veraltet sein. Das ist
 *   gewollt: Das Wiki-Feld rechnet den Zustand aus Wert und Wiki-Wert, die Herkunft trennt nur „folgt“ von „gleich“.
 */

function pruefeFelder(art: EditorLockKind, felder: readonly string[]): void {
    const fremd = felder.filter((feld) => !fuehrtHerkunft(art, feld));
    if (fremd.length > 0) throw new Error(`field_origin: ${art} führt keine Herkunft für ${fremd.join(", ")}`);
}

/** Die Vermerke je Objekt (öffentliche Kennung); ein Objekt ohne Vermerk fehlt in der Antwort. */
export async function leseHerkunft(
    db: Queryable,
    art: EditorLockKind,
    ids: readonly string[],
): Promise<ReadonlyMap<string, FeldHerkuenfte>> {
    const herkunft = new Map<string, Record<string, FeldHerkunft>>();
    if (ids.length === 0) return herkunft;
    const rows = await db<{ object_id: string; field: string; origin: FeldHerkunft }[]>`
        SELECT object_id::text AS object_id, field, origin
          FROM field_origin
         WHERE object_kind = ${art} AND object_id = ANY(${[...ids]}::uuid[])
    `;
    for (const row of rows) {
        // Ein Feld, das die Art nicht (mehr) führt, zeigt niemand an.
        if (!fuehrtHerkunft(art, row.field)) continue;
        const felder = herkunft.get(row.object_id) ?? {};
        felder[row.field] = row.origin;
        herkunft.set(row.object_id, felder);
    }
    return herkunft;
}

/** Setzt die Herkunft der genannten Felder an allen `ids` (anlegen oder überschreiben); ein fehlendes Feld bleibt, wie es ist. */
export async function setzeHerkunft(
    db: Queryable,
    art: EditorLockKind,
    ids: readonly string[],
    felder: Readonly<Partial<Record<string, FeldHerkunft>>>,
): Promise<void> {
    const eintraege = Object.entries(felder).filter((e): e is [string, FeldHerkunft] => e[1] !== undefined);
    pruefeFelder(
        art,
        eintraege.map(([feld]) => feld),
    );
    if (ids.length === 0 || eintraege.length === 0) return;
    const objekte: string[] = [];
    const namen: string[] = [];
    const herkuenfte: string[] = [];
    // Doppelte Kennungen fielen sonst zweimal auf dieselbe Zeile („cannot affect row a second time“).
    for (const id of new Set(ids)) {
        for (const [feld, herkunft] of eintraege) {
            objekte.push(id);
            namen.push(feld);
            herkuenfte.push(herkunft);
        }
    }
    await db`
        INSERT INTO field_origin (object_kind, object_id, field, origin)
        SELECT ${art}, t.object_id, t.field, t.origin
          FROM unnest(${objekte}::uuid[], ${namen}::text[], ${herkuenfte}::text[]) AS t(object_id, field, origin)
        ON CONFLICT (object_kind, object_id, field) DO UPDATE SET origin = EXCLUDED.origin, set_at = now()
    `;
}
