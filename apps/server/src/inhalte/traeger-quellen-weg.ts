import type {
    EditorPathStreet,
    InhalteTraegerQuellenBody,
    InhalteTraegerQuellenVorher,
    OperationReceipt,
} from "@avesmaps3d/shared";
import type { PendingQuery } from "postgres";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import type { MapActor, MapAuditEntry } from "../editor/map-operation.ts";
import { readEditorPathStreet } from "../editor/path-list.ts";
import { ApiError } from "../http/api-error.ts";
import { aktualisiereKanon } from "./kanon-folgen.ts";
import { inhalteOperation } from "./operation.ts";
import {
    PROTOKOLL,
    eintrag,
    stimmtMitStand,
    sucheQuelle,
    veralteterStand,
    type QuelleZeile,
} from "./traeger-quellen-stand.ts";
import {
    fehlerbild,
    nurText,
    protokollEintrag,
    schreibeVerwendung,
    type LinkZeile,
    type VerknuepfungsOp,
} from "./verknuepfung-schreiben.ts";
import { fasseWegQuelleZusammen, type WegSicht } from "./weg-sicht.ts";

/**
 * Schreiben der Quellen der Straße eines Wegs, für beide Wege, die es gibt: `traeger.sources` vom Objekt her (`aendereWegQuellen`, `kind = path`; die Klappbox des Wegeditors) und `source.update` von
 * der Quelle her (`quellen-schreiben.ts`, der Reiter „Quellen“; er ruft `sperreStrasse` und `aendereStrassenQuelle` auf, dieselben Funktionen). WI-0254 §12. Ein Weg hat seine Quellen als Ganzes:
 * Betreiber 2026-10-28 „wege sind in den quellen oder im wiki als ganzes beschrieben, einzelne abschnitte sind technische details von uns“. Die Verknüpfungen hängen technisch je Abschnitt
 * (`path_source`); die Oberfläche kennt nur die Straße, und jede Änderung hier macht die Quelle auf der GANZEN Straße einheitlich. Vertrag: `packages/shared/src/inhalte-traeger-quellen.ts` und
 * `inhalte-quellen.ts`; die Sicht, gegen die `vorher` gilt, rechnet `fasseWegQuelleZusammen` (`weg-sicht.ts`), dieselbe Rechnung wie beide Lesewege.
 *
 * - **Die Straße** ist, was das Wege-Fenster liest (`readEditorPathStreet`): die Abschnitte auf der Karte mit demselben echten Namen, über Wegtypen hinweg; `:id` ist irgendein Abschnitt.
 *   Eine Straße, die nicht auf der Karte ist (von der Karte genommen oder gelöscht), ist still: 400.
 * - 🔴 **Sperren:** eine Transaktionssperre auf den **Anker** der Straße (`pg_advisory_xact_lock`): die kleinste öffentliche Kennung ihrer Abschnitte, die Kennung der Straße im Wege-Fenster. Eine
 *   Straße ist ihr Name und hat keine eigene Zeile, an der man sperren könnte; der Anker ist aus jedem Abschnitt gleich zu finden, darum überholen sich zwei Speichern derselben Straße von
 *   verschiedenen Abschnitten aus nicht. Der Anker wird vor der Sperre gelesen und danach noch einmal; hat er sich dazwischen geändert (jemand hat die Straße geteilt, verbunden oder umbenannt),
 *   ist die Operation 409 `edit_conflict`. Dazu `FOR UPDATE` an den betroffenen Verknüpfungen (`path_source`), NIE am Weg: Eine Quelle ändert weder Linie noch Namen, die Revision des Wegs
 *   steigt nicht, und die App-Rolle hat am Weg keine Rechte für eine Zeilensperre. Die Quelle selbst sperrt `traeger.sources` nicht; `source.update` hält sie ohnehin (`FOR UPDATE`), und dort gilt
 *   die feste Folge **Quelle, dann die Straßen nach aufsteigendem Anker, dann die Verknüpfungen** (`quellen-schreiben.ts`), damit zwei Fenster sich nicht verklemmen.
 * - 🔴 **Gegen den gesehenen Stand:** `vorher` gilt für die zusammengefasste Sicht (Zustand und die Angaben des ersten Abschnitts entlang der Straße, der die Quelle aktiv trägt). Weicht sie ab,
 *   ist die ganze Operation 409 `edit_conflict`.
 * - **Einheitlich auf allen Abschnitten:** `add` und `restore`: Jeder Abschnitt trägt die Quelle danach aktiv mit denselben Angaben (fehlt die Verknüpfung, wird sie angelegt; eine gelöste oder
 *   unterdrückte wird belebt). `update`: Die Angaben gelten allen, wer die Quelle noch nicht trug, bekommt sie dazu. Was eine Änderung nicht nennt, bleibt, wie die Sicht es zeigt. `remove`: auf
 *   allen Abschnitten, die sie aktiv tragen, wie bei den anderen Trägern (Legacy und Wiki unterdrückt, eigene gelöst, nie gelöscht).
 * - **Der Schreibkern ist der gemeinsame** (`verknuepfung-schreiben.ts`), `source_system = 'editor'`: Der Legacy-Zug fasst die Zeilen nie an, der WikiSync wertet sie als von Hand. Auch eine Zeile, die
 *   schon die gewünschten Werte trägt, wird zur Zeile des Editors, sonst käme sie mit dem nächsten Zug wieder auseinander.
 * - **Das Etikett** (`path_canon`) jedes Abschnitts wird in derselben Transaktion neu gerechnet. **Protokoll:** EIN Eintrag `path.sources_changed` am Anker, ohne Revision des Wegs
 *   (`changes.quellen` mit vorher und nachher je geänderter Quelle, in der Sicht der Straße); der Verlauf der Straße liest alle ihre Abschnitte und findet ihn. `source.update` schreibt denselben
 *   Eintrag für jede Straße, die es ändert (`wegEintrag`), neben seinem eigenen `source.updated`: Der Verlauf des Wegeditors findet so auch, was vom Reiter „Quellen“ kam.
 */

/** Ein Abschnitt der Straße: interne Nummer und öffentliche Kennung. */
interface Abschnitt {
    id: string;
    public_id: string;
}

/** Die Verknüpfung einer Quelle an einem Abschnitt, gesperrt. */
export type Verknuepfung = LinkZeile & { carrier_id: string };

const SPALTEN = `v.id::text AS id, p.public_id::text AS carrier_id, v.state, v.is_active, v.reference_kind, v.pages, v.note, v.source_system, v.updated_at`;

/** Die Verknüpfungen einer Quelle an den Abschnitten, mit `FOR UPDATE` (nur die Zeilen der Verknüpfung) oder ohne. Die Reihenfolge der Sperren ist die der Nummern. */
export const leseVerknuepfungen = (
    tx: Sql,
    abschnitte: readonly string[],
    quelleId: string,
    sperren: boolean,
): PendingQuery<Verknuepfung[]> =>
    tx.unsafe<Verknuepfung[]>(
        `SELECT ${SPALTEN}
           FROM path_source v JOIN path p ON p.id = v.path_id
          WHERE p.public_id = ANY($1::uuid[]) AND v.source_id = $2::bigint
          ORDER BY v.id${sperren ? " FOR UPDATE OF v" : ""}`,
        [[...abschnitte], quelleId] as never[],
    );

/** Die zusammengefasste Sicht in der Form, in der `stimmtMitStand` und das Protokoll sie lesen; `undefined`: Kein Abschnitt führt die Quelle. */
export const sichtAlsZeile = (
    sicht: WegSicht<Verknuepfung> | undefined,
): Pick<LinkZeile, "state" | "reference_kind" | "pages" | "note"> | undefined =>
    sicht === undefined
        ? undefined
        : {
              state: sicht.state,
              reference_kind: sicht.erste.reference_kind,
              pages: sicht.erste.pages,
              note: sicht.erste.note,
          };

/** Die Änderung einer Quelle an der Straße: der Kern der Verknüpfung (`VerknuepfungsOp`) mit dem gesehenen Stand der Straße. */
export type StrassenAenderung = VerknuepfungsOp & { vorher: InhalteTraegerQuellenVorher | null };

/** Die Angaben, die nach einer Änderung auf jedem Abschnitt stehen: genannt, sonst wie die Sicht sie zeigt (`null` leert). */
function zielAngaben(aenderung: StrassenAenderung, sicht: WegSicht<Verknuepfung> | undefined) {
    const alt = sichtAlsZeile(sicht);
    const genannt = aenderung.op === "add" || aenderung.op === "update" ? aenderung : undefined;
    return {
        referenceKind: genannt?.referenceKind === undefined ? (alt?.reference_kind ?? null) : genannt.referenceKind,
        pages: genannt?.pages === undefined ? (alt?.pages ?? null) : nurText(genannt.pages),
        note: genannt?.note === undefined ? (alt?.note ?? null) : nurText(genannt.note),
    };
}

/** 409, wo die Straße sich zwischen Lesen und Sperre geändert hat. */
const strasseGeaendert = (revision: number): ApiError =>
    new ApiError(409, "edit_conflict", "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.", {
        currentRevision: revision,
        changedAt: new Date().toISOString(),
    });

/** Die Straße, gesperrt, mit allem, was das Schreiben von ihr braucht. */
export interface StrassenLage {
    strasse: EditorPathStreet;
    /** Die höchste Revision ihrer Abschnitte (nur zur Auskunft im 409). */
    revision: number;
    /** Die öffentlichen Kennungen der Abschnitte entlang der Straße. */
    kennungen: string[];
    /** Kennung → Platz entlang der Straße (die Folge, nach der die Sicht den „ersten“ Abschnitt wählt). */
    folge: Map<string, number>;
    abschnitte: Abschnitt[];
    abschnittVon: Map<string, Abschnitt>;
    /** Die Abschnitte entlang der Straße. */
    entlang: Abschnitt[];
}

/** Die Straße zu einem Abschnitt (404, wo es ihn nicht gibt), ohne sie zu sperren. */
export async function leseStrasse(tx: Sql, kennung: string): Promise<EditorPathStreet> {
    const strasse = await readEditorPathStreet(tx, kennung);
    if (strasse === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
    return strasse;
}

/**
 * Die Straße zu einem Abschnitt sperren und lesen: der Anker vor der Sperre (`vorab`; wer ihn schon gelesen hat, gibt ihn mit), die Straße danach. 404, wo es den Abschnitt nicht gibt; 409, wo
 * der Anker sich dazwischen geändert hat; 400, wo die Straße nicht auf der Karte ist.
 */
export async function sperreStrasse(tx: Sql, kennung: string, vorab?: EditorPathStreet): Promise<StrassenLage> {
    const zuerst = vorab ?? (await leseStrasse(tx, kennung));
    await tx`SELECT pg_advisory_xact_lock(hashtext('traeger_quellen:schreiben'), hashtext(${`path:${zuerst.id}`}))`;
    const strasse = await leseStrasse(tx, kennung);
    const revision = Math.max(...strasse.segments.map((abschnitt) => abschnitt.revision));
    if (strasse.id !== zuerst.id) throw strasseGeaendert(revision);
    if (strasse.offMap === true || strasse.deleted === true) {
        throw fehlerbild(
            "links.carrierId",
            "state",
            "An eine Straße, die nicht auf der Karte ist, lässt sich keine Quelle ändern.",
        );
    }
    const kennungen = strasse.segments.map((abschnitt) => abschnitt.id);
    const abschnitte = await tx<Abschnitt[]>`
        SELECT id::text AS id, public_id::text AS public_id FROM path WHERE public_id = ANY(${kennungen}::uuid[])
    `;
    const abschnittVon = new Map(abschnitte.map((abschnitt) => [abschnitt.public_id, abschnitt] as const));
    return {
        strasse,
        revision,
        kennungen,
        folge: new Map(kennungen.map((id, index) => [id, index] as const)),
        abschnitte,
        abschnittVon,
        entlang: kennungen.map((id) => abschnittVon.get(id)!),
    };
}

/**
 * EINE Änderung an der Quelle auf der GANZEN Straße (die Straße ist gesperrt, `sperreStrasse`): `vorher` gegen die zusammengefasste Sicht (409), dann jeder Abschnitt über den gemeinsamen Kern.
 * Gibt den Eintrag der Straße vor und nach der Änderung zurück (`protokollEintrag`, mit dem Anker als Kennung); `undefined`, wo nichts zu tun war (dieselben Werte noch einmal).
 * `revisionAuskunft` ist die Zahl, die ein 409 nennt (nur zur Auskunft): die der Straße, bei `source.update` die der Quelle.
 */
export async function aendereStrassenQuelle(
    tx: Sql,
    lage: StrassenLage,
    quelle: QuelleZeile,
    quelleKennung: string,
    aenderung: StrassenAenderung,
    revisionAuskunft: number = lage.revision,
): Promise<{ vorher: Record<string, unknown>; nachher: Record<string, unknown> } | undefined> {
    const { strasse, kennungen, folge, abschnittVon, entlang } = lage;
    const zeilen = await leseVerknuepfungen(tx, kennungen, quelle.id, true);
    const sicht = zeilen.length === 0 ? undefined : fasseWegQuelleZusammen(zeilen, folge);
    const bisher = sichtAlsZeile(sicht);
    if (!stimmtMitStand(aenderung.vorher, bisher)) {
        const zuletzt =
            zeilen.length === 0 ? undefined : new Date(Math.max(...zeilen.map((z) => z.updated_at.getTime())));
        throw await veralteterStand(tx, "path", kennungen, quelleKennung, revisionAuskunft, zuletzt);
    }

    if (aenderung.op === "remove" || aenderung.op === "update" || aenderung.op === "restore") {
        if (sicht === undefined)
            throw new ApiError(404, "not_found", "Diese Quelle ist an diesem Objekt nicht angehängt.");
        if (aenderung.op === "remove" && sicht.state !== "active")
            throw fehlerbild("links.carrierId", "state", "Diese Verknüpfung ist schon gelöst.");
        if (aenderung.op === "update" && sicht.state !== "active") {
            throw fehlerbild(
                "links.carrierId",
                "state",
                "Eine gelöste Verknüpfung lässt sich nicht ändern; erst wiederherstellen.",
            );
        }
        if (aenderung.op === "restore" && sicht.state === "active")
            throw fehlerbild("links.carrierId", "state", "Diese Verknüpfung ist nicht gelöst.");
    }
    if (aenderung.op === "add" && sicht?.state === "active")
        throw fehlerbild("links.carrierId", "unique", "Diese Quelle ist an diesem Objekt schon angehängt.");

    let geschrieben = false;
    if (aenderung.op === "remove") {
        // Auf allen Abschnitten, die sie aktiv tragen; wer sie schon gelöst hat oder nie trug, bleibt.
        for (const zeile of zeilen.filter((eine) => eine.state === "active")) {
            const abschnitt = abschnittVon.get(zeile.carrier_id)!;
            await schreibeVerwendung(
                tx,
                "path",
                abschnitt.public_id,
                quelle.id,
                { traeger: { id: abschnitt.id, is_active: true }, bisher: zeile },
                { op: "remove" },
            );
            geschrieben = true;
        }
    } else {
        // Anhängen, ändern, holen: danach trägt jeder Abschnitt die Quelle aktiv, mit denselben Angaben.
        const ziel = zielAngaben(aenderung, sicht);
        for (const abschnitt of entlang) {
            const zeile = zeilen.find((eine) => eine.carrier_id === abschnitt.public_id);
            const gesperrt = { traeger: { id: abschnitt.id, is_active: true }, bisher: zeile };
            if (zeile === undefined || zeile.state !== "active") {
                // Fehlt die Verknüpfung, wird sie angelegt; eine gelöste oder unterdrückte lebt mit den Angaben der Straße wieder auf.
                const op: VerknuepfungsOp = { op: "add", ...ziel };
                await schreibeVerwendung(tx, "path", abschnitt.public_id, quelle.id, gesperrt, op);
                geschrieben = true;
                continue;
            }
            const op: VerknuepfungsOp = { op: "update", ...ziel };
            if ((await schreibeVerwendung(tx, "path", abschnitt.public_id, quelle.id, gesperrt, op)) !== undefined) {
                geschrieben = true;
            } else if (zeile.source_system !== "editor") {
                // Dieselben Werte, aber noch die Zeile aus Legacy: Sie wird zur Zeile des Editors, damit der Zug sie nicht wieder auseinanderzieht.
                await tx.unsafe(
                    `UPDATE path_source SET source_system = 'editor', updated_at = now() WHERE id = $1::bigint`,
                    [zeile.id] as never[],
                );
            }
        }
    }
    if (!geschrieben) return undefined;
    const danach = await leseVerknuepfungen(tx, kennungen, quelle.id, false);
    const sichtDanach = danach.length === 0 ? undefined : fasseWegQuelleZusammen(danach, folge);
    return {
        vorher: protokollEintrag("path", strasse.id, bisher),
        nachher: protokollEintrag("path", strasse.id, sichtAlsZeile(sichtDanach)),
    };
}

/**
 * Der Eintrag `path.sources_changed` am Anker der Straße (ohne Revision, `changes.quellen`), den `traeger.sources` für den Wegeditor schreibt und `source.update` für jede Straße, die es ändert:
 * Der Verlauf der Straße findet beide auf demselben Weg.
 */
export const wegEintrag = (
    lage: StrassenLage,
    vorher: readonly Record<string, unknown>[],
    nachher: readonly Record<string, unknown>[],
): MapAuditEntry => ({
    action: `${PROTOKOLL.path.art}.sources_changed`,
    ...PROTOKOLL.path.ziel(lage.strasse.id),
    changes: { quellen: { before: [...vorher], after: [...nachher] } },
});

export async function aendereWegQuellen(
    database: Database,
    actor: MapActor,
    kennung: string,
    body: InhalteTraegerQuellenBody,
): Promise<OperationReceipt> {
    return inhalteOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "traeger.sources",
            body: { kind: "path", carrierId: kennung, ...body },
        },
        async (tx) => {
            const lage = await sperreStrasse(tx, kennung);
            const { strasse } = lage;

            const vorherListe: Record<string, unknown>[] = [];
            const nachherListe: Record<string, unknown>[] = [];
            for (const aenderung of body.aenderungen) {
                const quelle = await sucheQuelle(tx, aenderung.sourceId, aenderung.op);
                const ergebnis = await aendereStrassenQuelle(tx, lage, quelle, aenderung.sourceId, aenderung);
                if (ergebnis === undefined) continue;
                vorherListe.push(eintrag(quelle, aenderung.sourceId, ergebnis.vorher));
                nachherListe.push(eintrag(quelle, aenderung.sourceId, ergebnis.nachher));
            }

            const affected = strasse.segments.map((abschnitt) => ({
                kind: "path" as const,
                id: abschnitt.id,
                revision: abschnitt.revision,
            }));
            if (vorherListe.length === 0) {
                // Nichts hat sich geändert (dieselben Werte noch einmal): kein Protokoll.
                return { receipt: { affected, derivedWork: [], warnings: [] }, entries: [] };
            }
            await aktualisiereKanon(tx, { path: new Set(lage.abschnitte.map((abschnitt) => abschnitt.id)) });
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `Quellen von „${strasse.name}“ geändert`,
                entries: [wegEintrag(lage, vorherListe, nachherListe)],
            };
        },
    );
}
