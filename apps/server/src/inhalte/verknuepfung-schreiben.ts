import { SOURCE_REFERENCE_KINDS, type InhalteTraegerArt, type InhalteVerwendungAenderung } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { TRAEGER } from "./traeger.ts";

/**
 * Der Schreibkern für die Verknüpfung eines Kartenobjekts mit einer Quelle (`<träger>_source`, Migration 0066), WI-0254. Zwei Wege teilen ihn: `source.update` (von der Quelle her,
 * `quellen-schreiben.ts`) und `traeger.sources` (vom Objekt her, `traeger-quellen-schreiben.ts`: die Klappbox der Karteneditoren; für die Straße eines Wegs ruft `traeger-quellen-weg.ts`
 * ihn je Abschnitt auf, dort steht, wie daraus eine Quelle der ganzen Straße wird). EINE Regel, nicht zwei:
 *
 * - **Stilllegen, nie löschen:** Eine Verknüpfung aus Legacy (oder dem Wiki) wird unterdrückt (`suppressed`, der Zug belebt sie nie), eine eigene gelöst (`retired`), beide mit
 *   `retired_origin = editor` und wiederherstellbar.
 * - 🔴 **Bestandsschutz** (Kapitel 9.37, manuell schlägt Wiki): Was der Editor anlegt, ändert, löst oder holt, trägt `source_system = 'editor'`; der Legacy-Zug fasst solche Zeilen nie an
 *   (`migration/sources-import.ts`, `protectedWhere`), und der WikiSync wertet sie als von Hand.
 * - **Sperre:** `sperreVerwendung` nimmt die Zeile der Verknüpfung mit `FOR UPDATE`, NIE den Träger (die App-Rolle hat am Träger keine Spaltenrechte, die eine Zeilensperre braucht; die
 *   Revision des Trägers steigt durch Quellen nicht). Wer den Stand prüfen muss, bevor er schreibt (`traeger.sources`), tut es zwischen `sperreVerwendung` und `schreibeVerwendung`.
 * - **Die Rücknahme** (WI-0265 B6g3, `editor/ruecknahme-traeger-quellen.ts`) nimmt diesen Kern nicht: Sie kennt den Zielzustand aus dem Protokoll und setzt ihn direkt (`setzeZeile`), mit derselben Regel für
 *   Herkunft und Stempel (`source_system = 'editor'`, `updated_at`, `retired_origin = 'editor'`). Ändert sich diese Regel hier, ändert sie sich dort mit.
 */

export const nurText = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

export const fehlerbild = (pfad: string, regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: pfad, rule: regel }] });

/** Die Zeile einer Verknüpfung, wie sie in der Datenbank steht. */
export interface LinkZeile {
    id: string;
    state: string;
    is_active: boolean;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    source_system: string;
    updated_at: Date;
}

/** Das Objekt der Verknüpfung (interne Nummer) und ob es noch aktiv ist. */
export interface VerknuepfungTraeger {
    id: string;
    is_active: boolean;
}

/** Der Eintrag einer Verwendung im Protokoll: wer, in welchem Zustand, mit welchen Angaben. */
export function protokollEintrag(
    kind: InhalteTraegerArt,
    carrierId: string,
    zeile: Pick<LinkZeile, "state" | "reference_kind" | "pages" | "note"> | undefined,
): Record<string, unknown> {
    return {
        kind,
        carrierId,
        state: zeile?.state ?? "none",
        referenceKind: zeile?.reference_kind ?? null,
        pages: zeile?.pages ?? null,
        note: zeile?.note ?? null,
    };
}

const bezugsArtGueltig = (wert: string | null | undefined): boolean =>
    wert === null || wert === undefined || (SOURCE_REFERENCE_KINDS as readonly string[]).includes(wert);

/** Die Angaben einer Änderung: was fehlt, bleibt (`undefined`), `null` leert. */
export interface VerwendungsAngaben {
    referenceKind?: string | null | undefined;
    pages?: string | null | undefined;
    note?: string | null | undefined;
}

/** Die Änderung einer Verknüpfung, ohne das Objekt, an dem sie hängt. */
export type VerknuepfungsOp = ({ op: "add" | "update" } & VerwendungsAngaben) | { op: "remove" } | { op: "restore" };

/**
 * Das Objekt (404, wo es das nicht gibt) und die Zeile seiner Verknüpfung mit der Quelle, gesperrt (`FOR UPDATE`); `bisher` fehlt, wo es noch keine gab.
 */
export async function sperreVerwendung(
    tx: Sql,
    kind: InhalteTraegerArt,
    carrierId: string,
    quelleId: string,
): Promise<{ traeger: VerknuepfungTraeger; bisher: LinkZeile | undefined }> {
    const tafeln = TRAEGER[kind];
    const [traeger] = await tx.unsafe<VerknuepfungTraeger[]>(
        `SELECT id::text AS id, is_active FROM ${tafeln.carrier} WHERE public_id = $1::uuid`,
        [carrierId],
    );
    if (traeger === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
    const [bisher] = await tx.unsafe<LinkZeile[]>(
        `SELECT id::text AS id, state, is_active, reference_kind, pages, note, source_system, updated_at
           FROM ${tafeln.link} WHERE ${tafeln.foreignKey} = $1::bigint AND source_id = $2::bigint FOR UPDATE`,
        [traeger.id, quelleId],
    );
    return { traeger, bisher };
}

/**
 * Eine Änderung an einer Verknüpfung (gesperrt durch `sperreVerwendung`). Gibt das Objekt (interne Nummer) und den Protokolleintrag vor und nach zurück; `undefined`, wo nichts zu
 * tun war („update“ mit denselben Werten ist kein Eintrag; „lösen“ einer gelösten Verknüpfung ist ein Fehler).
 */
export async function schreibeVerwendung(
    tx: Sql,
    kind: InhalteTraegerArt,
    carrierId: string,
    quelleId: string,
    gesperrt: { traeger: VerknuepfungTraeger; bisher: LinkZeile | undefined },
    aenderung: VerknuepfungsOp,
): Promise<{ traegerId: string; vorher: Record<string, unknown>; nachher: Record<string, unknown> } | undefined> {
    const tafeln = TRAEGER[kind];
    const { traeger, bisher } = gesperrt;
    const angaben =
        aenderung.op === "add" || aenderung.op === "update"
            ? {
                  referenceKind: aenderung.referenceKind,
                  pages: aenderung.pages === undefined ? undefined : nurText(aenderung.pages),
                  note: aenderung.note === undefined ? undefined : nurText(aenderung.note),
              }
            : undefined;
    if (angaben !== undefined && !bezugsArtGueltig(angaben.referenceKind)) {
        throw fehlerbild("links.referenceKind", "enum", "Diese Art des Belegs gibt es nicht.");
    }
    const vorher = protokollEintrag(kind, carrierId, bisher);

    if (aenderung.op === "add") {
        if (!traeger.is_active) {
            throw fehlerbild(
                "links.carrierId",
                "state",
                "An ein stillgelegtes Objekt lässt sich keine Quelle anhängen.",
            );
        }
        if (bisher?.state === "active") {
            throw fehlerbild("links.carrierId", "unique", "Diese Quelle ist an diesem Objekt schon angehängt.");
        }
        const art = angaben?.referenceKind === undefined ? (bisher?.reference_kind ?? null) : angaben.referenceKind;
        const seiten = angaben?.pages === undefined ? (bisher?.pages ?? null) : angaben.pages;
        const notiz = angaben?.note === undefined ? (bisher?.note ?? null) : angaben.note;
        if (bisher === undefined) {
            await tx.unsafe(
                `INSERT INTO ${tafeln.link} (${tafeln.foreignKey}, source_id, reference_kind, pages, note, position, state, is_active, source_system)
                 VALUES ($1::bigint, $2::bigint, $3, $4, $5,
                         (SELECT coalesce(max(position) + 1, 0) FROM ${tafeln.link} WHERE ${tafeln.foreignKey} = $1::bigint),
                         'active', TRUE, 'editor')`,
                [traeger.id, quelleId, art, seiten, notiz] as never[],
            );
        } else {
            await tx.unsafe(
                `UPDATE ${tafeln.link}
                    SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, reference_kind = $2, pages = $3,
                        note = $4, source_system = 'editor', updated_at = now()
                  WHERE id = $1::bigint`,
                [bisher.id, art, seiten, notiz] as never[],
            );
        }
        return {
            traegerId: traeger.id,
            vorher,
            nachher: protokollEintrag(kind, carrierId, {
                state: "active",
                reference_kind: art,
                pages: seiten,
                note: notiz,
            }),
        };
    }

    if (bisher === undefined)
        throw new ApiError(404, "not_found", "Diese Quelle ist an diesem Objekt nicht angehängt.");

    if (aenderung.op === "update") {
        if (bisher.state !== "active") {
            throw fehlerbild(
                "links.carrierId",
                "state",
                "Eine gelöste Verknüpfung lässt sich nicht ändern; erst wiederherstellen.",
            );
        }
        const art = angaben?.referenceKind === undefined ? bisher.reference_kind : angaben.referenceKind;
        const seiten = angaben?.pages === undefined ? bisher.pages : angaben.pages;
        const notiz = angaben?.note === undefined ? bisher.note : angaben.note;
        if (art === bisher.reference_kind && seiten === bisher.pages && notiz === bisher.note) return undefined;
        await tx.unsafe(
            `UPDATE ${tafeln.link} SET reference_kind = $2, pages = $3, note = $4, source_system = 'editor', updated_at = now() WHERE id = $1::bigint`,
            [bisher.id, art, seiten, notiz] as never[],
        );
        return {
            traegerId: traeger.id,
            vorher,
            nachher: protokollEintrag(kind, carrierId, {
                state: "active",
                reference_kind: art,
                pages: seiten,
                note: notiz,
            }),
        };
    }

    if (aenderung.op === "remove") {
        if (bisher.state !== "active") {
            throw fehlerbild("links.carrierId", "state", "Diese Verknüpfung ist schon gelöst.");
        }
        // Eine Verknüpfung aus Legacy wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst.
        const neuerState = bisher.source_system === "legacy" ? "suppressed" : "retired";
        await tx.unsafe(
            `UPDATE ${tafeln.link}
                SET state = $2, is_active = FALSE, retired_at = now(), retired_origin = 'editor', source_system = 'editor', updated_at = now()
              WHERE id = $1::bigint`,
            [bisher.id, neuerState] as never[],
        );
        return {
            traegerId: traeger.id,
            vorher,
            nachher: protokollEintrag(kind, carrierId, { ...bisher, state: neuerState }),
        };
    }

    // restore
    if (bisher.state === "active") throw fehlerbild("links.carrierId", "state", "Diese Verknüpfung ist nicht gelöst.");
    if (!traeger.is_active) {
        throw fehlerbild("links.carrierId", "state", "An ein stillgelegtes Objekt lässt sich keine Quelle anhängen.");
    }
    await tx.unsafe(
        `UPDATE ${tafeln.link}
            SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, source_system = 'editor', updated_at = now()
          WHERE id = $1::bigint`,
        [bisher.id] as never[],
    );
    return {
        traegerId: traeger.id,
        vorher,
        nachher: protokollEintrag(kind, carrierId, { ...bisher, state: "active" }),
    };
}

/**
 * Eine Änderung an einer Verwendung: sperren und schreiben in einem Zug (`source.update`, wo es nichts zu prüfen gibt, bevor geschrieben wird). Der Ablauf und jede Fehlermeldung sind
 * die von `quellen-schreiben.ts` vor dem Herauslösen: Das Objekt fehlt (404), die Quelle ist dort schon angehängt (400), die Angaben sind ungültig (400).
 */
export async function wendeVerwendungAn(
    tx: Sql,
    quelleId: string,
    aenderung: InhalteVerwendungAenderung,
): Promise<{ traegerId: string; vorher: Record<string, unknown>; nachher: Record<string, unknown> } | undefined> {
    const gesperrt = await sperreVerwendung(tx, aenderung.kind, aenderung.carrierId, quelleId);
    return schreibeVerwendung(tx, aenderung.kind, aenderung.carrierId, quelleId, gesperrt, aenderung);
}
