import type { WarteschlangeAuftrag } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import type { WarteschlangeStandLeser } from "./stand-datei.ts";
import { asJson } from "./store.ts";

/**
 * Hängende Aufträge den Betreibern melden (WI-0179). Der Dirigent erkennt sie (`dirigent/haengt.ts`) und schreibt sie als `haengt`
 * in den Stand; 🔴 er selbst schreibt in keine Datenbank (WI-0163 §1.2). Melden tut deshalb die App: Jede Instanz liest den Stand
 * ohnehin (`QUEUE_STAND_FILE`) und meldet die hängenden Aufträge IHRER Umgebung in ihre eigene Glocke, als Art `auftrag_haengt` an
 * die Rolle `operator`, Text die Bezeichnung des Auftrags.
 *
 * - **Einmal je Auftrag und Versuch:** Die Quelle `haengt:<umgebung>-<id>-<attempt>` ist der Schlüssel gegen Doppelte, und den hält
 *   `benachrichtige()` selbst (`ON CONFLICT (an_person, quelle) DO NOTHING`, Migration 0107). Zwei Instanzen im Blue/Green, ein
 *   Neustart des Dirigenten oder der App melden also nicht doppelt. Hängt derselbe Auftrag nach einem neuen Versuch wieder, ist das
 *   eine neue Meldung.
 * - 🔴 **Nicht über die Warteschlange** (Jobart `benachrichtigung`): Eine Meldung darüber, dass die Warteschlange hängt, darf nicht
 *   in eben dieser Warteschlange warten.
 * - Die App-Rolle ruft `benachrichtige()` mit dem Standardrecht der Migrationsrolle auf Funktionen (`runtime-foundation.sh`), wie die
 *   Auslöser des Kanals; ein neues Recht entsteht nicht.
 * - Nur mit frischem Stand: Ein alter Stand sagt nichts über jetzt. Ohne Stand-Datei läuft der Melder nicht.
 * - Ein Fehler (Datenbank weg) kostet eine Zeile im Protokoll und diesen Takt, nie den Prozess; der nächste Takt versucht es wieder.
 */

/** So oft liest der Melder den Stand. Der Dirigent braucht ohnehin Minuten, bis ein Auftrag als hängend gilt. */
export const HAENGT_MELDER_MS = 60_000;

/** Die Grenze der Tafel `benachrichtigung` für den Text (Migration 0107). */
const TEXT_MAX = 300;

export interface HaengtMelderLog {
    warn(object: unknown, message: string): void;
}

export interface HaengtMelder {
    start(): void;
    close(): void;
    /** Ein Takt jetzt: gibt zurück, wie viele Meldungen neu angelegt wurden (je Person gezählt). */
    pruefe(): Promise<number>;
}

/** Der Schlüssel einer Meldung: je Umgebung, Auftrag und Versuch genau eine. */
export function haengtQuelle(auftrag: Pick<WarteschlangeAuftrag, "umgebung" | "id" | "haengt">): string {
    return `haengt:${auftrag.umgebung}-${String(auftrag.id)}-${String(auftrag.haengt?.attempt ?? 0)}`;
}

/** Der Text der Meldung: die Bezeichnung des Auftrags, sonst seine Art. */
export function haengtText(auftrag: Pick<WarteschlangeAuftrag, "label" | "kind">): string {
    const label = auftrag.label?.trim() ?? "";
    return [...(label === "" ? auftrag.kind : label)].slice(0, TEXT_MAX).join("");
}

export function createHaengtMelder(options: {
    database: Queryable;
    leser: WarteschlangeStandLeser;
    /** Die Umgebung der Glocke, wie die Anmeldung sie nennt (`benachrichtigung.environment`). */
    umgebung: string;
    log: HaengtMelderLog;
    everyMs?: number;
}): HaengtMelder {
    const { database, leser, log } = options;
    // Was diese Instanz schon gemeldet hat: spart die Anfrage je Takt. Die Wahrheit gegen Doppelte bleibt `quelle` in der Tafel.
    const gemeldet = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    let closed = false;

    async function pruefe(): Promise<number> {
        const lage = await leser.lage();
        if (lage.zustand !== "ok") return 0;
        let angelegt = 0;
        for (const auftrag of lage.stand.auftraege) {
            if (auftrag.umgebung !== leser.umgebung || auftrag.state !== "QUEUED" || auftrag.haengt === undefined)
                continue;
            const quelle = haengtQuelle(auftrag);
            if (gemeldet.has(quelle)) continue;
            const [row] = await database<{ angelegt: number }[]>`
                SELECT public.benachrichtige(
                    ${options.umgebung}, ${asJson(database, { rolle: "operator" })}::jsonb, 'system', NULL, 'auftrag_haengt', NULL,
                    ${haengtText(auftrag)}, ${quelle}
                ) AS angelegt
            `;
            gemeldet.add(quelle);
            const neu = row?.angelegt ?? 0;
            angelegt += neu;
            if (neu > 0)
                log.warn(
                    { job: auftrag.publicId, kind: auftrag.kind, haengt: auftrag.haengt, empfaenger: neu },
                    "Auftrag hängt: den Betreibern gemeldet",
                );
        }
        return angelegt;
    }

    const tick = async (): Promise<void> => {
        try {
            await pruefe();
        } catch (error) {
            log.warn({ err: error }, "Hängende Aufträge nicht gemeldet; neuer Versuch im nächsten Takt");
        }
    };

    return {
        start() {
            if (closed || timer !== undefined) return;
            void tick();
            timer = setInterval(() => void tick(), options.everyMs ?? HAENGT_MELDER_MS);
            timer.unref();
        },
        close() {
            closed = true;
            if (timer !== undefined) clearInterval(timer);
            timer = undefined;
        },
        pruefe,
    };
}
