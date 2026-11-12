import {
    AUSLOESER_ARTEN,
    UUID_PATTERN,
    type AusloeserArt,
    type JobAusloeser,
    type JobOrigin,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Wer einen Auftrag ausgelöst hat (WI-0293; Betreiber 2026-11-09: „Wer hat sie gestartet. Wann. Wo (Stage oder Production)?“). EINE
 * Stelle für die Übersicht der eigenen Tafel und für den Stand des Dirigenten, damit beide dieselbe Art nennen.
 *
 * 🔴 In der Tafel steht der Auslöser als opake `actor_ref` (JOBS-0001 §4.1); einen Namen löst nur die Anwendung aus dem geschützten
 * Schema auf (`anzeigenamen`), und nur für eine Antwort an jemanden, der die Warteschlange sehen darf. Keine E-Mail, keine IP.
 */

const PERSON_REF = new RegExp(UUID_PATTERN, "iu");

/** Die Art aus `actor_ref` und Herkunft. Ohne Kennung: ein aufgezeichneter Lauf kommt aus dem Betrieb, ein eingereihter ist unbekannt. */
export function ausloeserArt(actorRef: string | null, origin: JobOrigin): AusloeserArt {
    const ref = actorRef?.trim() ?? "";
    if (ref === "") return origin === "recorded" ? "betrieb" : "unbekannt";
    if (PERSON_REF.test(ref)) return "person";
    if (ref === "jobs-cli" || ref.startsWith("cli:")) return "kommandozeile";
    if (ref.startsWith("agent:")) return "agent";
    return "automatik";
}

/** Eine Art aus dem Stand des Dirigenten: Was diese App (noch) nicht kennt, heißt „unbekannt“. */
export function bekannteArt(art: string | undefined): AusloeserArt | undefined {
    if (art === undefined) return undefined;
    return (AUSLOESER_ARTEN as readonly string[]).includes(art) ? (art as AusloeserArt) : "unbekannt";
}

/** Der Name eines Agenten aus `agent:<name>` („Claudio“); kein Personenbezug, die Agenten heißen im ganzen Haus so. */
function agentName(actorRef: string): string | null {
    const name = actorRef.slice("agent:".length).trim();
    return name === "" ? null : name.charAt(0).toLocaleUpperCase("de") + name.slice(1);
}

/**
 * Die heutigen Anzeigenamen zu den Personen unter `refs`, in EINER Abfrage. Wirft nie: Fehlt das Schema der Anmeldung oder das Recht
 * (eine Umgebung ohne Anmeldung), bleibt die Karte leer, und die Zeile sagt „von einer Person“.
 */
export async function anzeigenamen(db: Queryable, refs: Iterable<string | null>): Promise<Map<string, string>> {
    const ids = [...new Set([...refs].filter((ref): ref is string => ref !== null && PERSON_REF.test(ref)))];
    if (ids.length === 0) return new Map();
    try {
        const rows = await db<{ id: string; display_name: string | null }[]>`
            SELECT id::text AS id, display_name FROM avesmaps_auth.person WHERE id = ANY(${ids}::uuid[])
        `;
        return new Map(
            rows
                .filter((row) => row.display_name !== null && row.display_name.trim() !== "")
                .map((row) => [row.id.toLowerCase(), row.display_name as string]),
        );
    } catch {
        return new Map();
    }
}

/** Der Auslöser einer Zeile der eigenen Tafel, mit dem Namen aus `namen` (`anzeigenamen`). */
export function ausloeserVon(
    job: { actorRef: string | null; origin: JobOrigin },
    namen: ReadonlyMap<string, string>,
): JobAusloeser {
    const art = ausloeserArt(job.actorRef, job.origin);
    const ref = job.actorRef?.trim() ?? "";
    if (art === "person") return { art, name: namen.get(ref.toLowerCase()) ?? null };
    if (art === "agent") return { art, name: agentName(ref) };
    return { art, name: null };
}
