import {
    RELEASE_TEST_JOB_KIND,
    RELEASE_TEST_JOB_REF,
    type ReleaseTestAuftrag,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { claimsSlot } from "../jobs/kinds.ts";
import { planerAktiv } from "../jobs/overview.ts";
import type { JobRow } from "../jobs/rows.ts";
import type { StandLage } from "../jobs/stand-datei.ts";
import { listQueued, listRunning } from "../jobs/store.ts";
import { leseWarteumstand, umstandMitStand, wartegrund } from "../jobs/wartegrund.ts";

/**
 * Der Auftrag `release_test` für die Karte „Release-Test“ (WI-0248; Vali 2026-10-26: Nach dem Klick muss klar sein, dass er angekommen ist). Nur
 * lesen. Gezeigt wird, was die Warteschlange ohnehin weiß: wartet er (mit Platz, Grund und der Art, hinter der er steht) oder läuft er.
 *
 * - **Platz** aus dem Stand des Dirigenten, wenn er frisch ist (die gemeinsame Reihe), sonst die Stelle unter den Wartenden dieser Umgebung in der
 *   Reihenfolge der Zulassung. Ein angekündigter Lauf (Herkunft `recorded`) belegt keinen.
 * - **Grund** wie auf der Statusseite (`wartegrund`, mit dem Stand des Dirigenten dessen Grund).
 * - **Wartet auf** die Art des ersten laufenden Auftrags mit Platz (`claimsSlot`): Der Release-Test läuft allein, also wartet er auf jeden.
 */
export async function leseReleaseTestAuftrag(
    db: Queryable,
    stand: { lage: StandLage; umgebung: WarteschlangeUmgebung },
    mapDomainId: string,
): Promise<ReleaseTestAuftrag | null> {
    const [queued, running] = await Promise.all([listQueued(db), listRunning(db)]);
    const job = [...running, ...queued].find(
        (zeile) => zeile.kind === RELEASE_TEST_JOB_KIND && zeile.externalRef === RELEASE_TEST_JOB_REF,
    );
    if (job === undefined) return null;
    const commit = job.inputRef["commit"];
    if (typeof commit !== "string" || !/^[0-9a-f]{40}$/u.test(commit)) return null;
    const basis = {
        id: job.publicId,
        commit,
        wiederholen: job.inputRef["wiederholen"] === true,
        // Der Volltest (WI-0264): Schnelltest und voller Lauf nacheinander, nur Bericht. Die Karte nennt ihn so.
        ...(job.inputRef["volltest"] === true ? { volltest: true } : {}),
        seit: job.queuedAt.toISOString(),
        abbruch: job.cancelRequestedAt !== null,
    };
    if (job.state === "RUNNING") return { ...basis, zustand: "laeuft", platz: null, wartetAuf: null, grund: null };
    const umstand = umstandMitStand(
        await leseWarteumstand(db, {
            plannerActive: await planerAktiv(db, mapDomainId, stand),
            pickupKinds: new Set(),
        }),
        stand.lage,
        stand.umgebung,
    );
    // `listQueued` liefert in der Reihenfolge der Zulassung (Priorität, Einreihen, Kennung).
    const wartende = queued.filter((zeile: JobRow) => zeile.origin === "queued");
    const stelle = wartende.findIndex((zeile) => zeile.id === job.id);
    const platz = umstand.stand?.plaetze.get(job.publicId) ?? (stelle < 0 ? null : stelle + 1);
    const laufend = running.find((zeile) => claimsSlot(zeile.kind));
    return {
        ...basis,
        zustand: "wartet",
        platz,
        wartetAuf: laufend?.kind ?? null,
        grund: wartegrund(job, umstand),
    };
}
