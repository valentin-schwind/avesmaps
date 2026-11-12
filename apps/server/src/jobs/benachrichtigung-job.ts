import {
    BENACHRICHTIGUNG_ARTEN,
    COMMUNITY_GLOCKEN_ARTEN,
    PHOTOBOX_GLOCKEN_ARTEN,
    BEWERTUNG_GLOCKEN_ARTEN,
    KARTENVORSCHLAG_GLOCKEN_ARTEN,
    SOCIAL_GLOCKEN_ARTEN,
    ROLES,
    STOERUNG_ARTEN,
    UUID_PATTERN,
    WARTESCHLANGE_ARTEN,
    type BenachrichtigungArt,
} from "@avesmaps3d/shared";
import { AUTH_ENVIRONMENTS, type AuthEnvironment } from "../auth/config.ts";
import { isDatabaseUnavailable, type Queryable } from "../database.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { withJobDatabase } from "./job-database.ts";
import { asJson } from "./store.ts";

/**
 * Die Jobart `benachrichtigung` (WI-0163; Betreiber 2026-10-15: „Meldungen wie „Neu auf Production" sollen über die Warteschlange in
 * die richtige Umgebung gelangen, statt dass Claudio sie direkt einträgt“). Claudios Korridor reiht sie über
 * `benachrichtigung_einreihen(…)` (Migration 0133) in der Umgebung ein, für die sie bestimmt ist; der Ausführer DIESER Umgebung
 * trägt sie mit ihren Rechten ein: `benachrichtige(<umgebung>, an, 'system', NULL, art, NULL, text, quelle)` (Migration 0118), die
 * Jobs-Rolle darf das (`system-grants.psql`).
 *
 * Eingabe `{ art, an, text, quelle }`, streng geprüft, bevor etwas geschrieben wird: Eine unbekannte Art, ein Ziel, das
 * `benachrichtige` nicht kennt, ein leerer oder zu langer Text oder eine kaputte Quelle lassen den Auftrag scheitern
 * (`input_invalid`, nicht wiederholbar), und niemand bekommt etwas. Dieselbe `quelle` legt nie doppelt an: Das hält
 * `benachrichtige` selbst (`ON CONFLICT (an_person, quelle) DO NOTHING`); ein zweiter Lauf endet erfolgreich mit `angelegt: 0`.
 *
 * Die Umgebung ist die des Ausführers (`AVESMAPS_ENV`, wie die Anmeldung sie liest: ohne Wert nur lokal `development`), nie eine
 * Angabe der Eingabe: Eine Meldung landet dort, wo sie eingereiht wurde.
 */

export const BENACHRICHTIGUNG_KIND = "benachrichtigung";

/**
 * Die Arten, die über die Warteschlange kommen: die neuen Stände und der Prüflauf nach dem Push, genau die, die
 * `benachrichtigung_einreihen` an der Tür zulässt (Migrationen 0133, 0140; `abgleiche-korridor.test.ts` hält beide Listen
 * gleich). Eine neue Art hier braucht deshalb eine Migration, die die Tür erweitert. Nicht die des Kanals (`kanal_*`): Die gehören zu einem Vorgang (`bezug_ops`) und entstehen in seinen Auslösern.
 * 🔴 Und nicht die Störungen (`STOERUNG_ARTEN`, WI-0179): Eine Meldung darüber, dass die Warteschlange hängt, darf nicht in eben
 * dieser Warteschlange warten. Auch nicht das Ende der eigenen Aufträge (`WARTESCHLANGE_ARTEN`, WI-0230): Das meldet der Ausführer selbst.
 * Ebenso nicht die der Community (`COMMUNITY_GLOCKEN_ARTEN`, WI-0268 C5): Die App meldet neue Meldungen, Zuweisungen und Antworten in der Transaktion
 * der Handlung, die Aufbewahrung die Fristen; die Tür kennt sie nicht. Ebenso nicht die des Social Hubs (`SOCIAL_GLOCKEN_ARTEN`, WI-0270 C11) und nicht die der Reisebilder
 * (`PHOTOBOX_GLOCKEN_ARTEN`, WI-0272 S3): Die App meldet ein neues Reisebild in der Transaktion der Handlung.
 */
export const BENACHRICHTIGUNG_JOB_ARTEN: readonly BenachrichtigungArt[] = BENACHRICHTIGUNG_ARTEN.filter(
    (art) =>
        !art.startsWith("kanal_") &&
        !STOERUNG_ARTEN.includes(art) &&
        !WARTESCHLANGE_ARTEN.includes(art) &&
        !COMMUNITY_GLOCKEN_ARTEN.includes(art) &&
        !SOCIAL_GLOCKEN_ARTEN.includes(art) &&
        !PHOTOBOX_GLOCKEN_ARTEN.includes(art) &&
        !BEWERTUNG_GLOCKEN_ARTEN.includes(art) &&
        !KARTENVORSCHLAG_GLOCKEN_ARTEN.includes(art),
);

/** Wie lang der Text sein darf (Zeichen, nach dem Kürzen der Ränder): die Grenze der Tafel (`benachrichtigung_text`, 0107). */
export const BENACHRICHTIGUNG_TEXT_MAX = 300;

/** Die Quelle ist der Schlüssel gegen Doppelte, je Person: `stage:<sha>`, `production:<release>`. Die Tafel erlaubt 200 Zeichen. */
const QUELLE = /^[a-z][a-z0-9_-]{0,39}:[^\s]{1,159}$/u;
const UUID = new RegExp(UUID_PATTERN, "u");

export type BenachrichtigungZiel =
    | { person: string; ausser?: string }
    | { rolle: (typeof ROLES)[number]; ausser?: string }
    | { alle: true; ausser?: string };

export interface BenachrichtigungAuftrag {
    art: BenachrichtigungArt;
    an: BenachrichtigungZiel;
    text: string;
    quelle: string;
}

function ungueltig(grund: string): JobFailure {
    return new JobFailure("input_invalid", `Benachrichtigung: ${grund}`, false);
}

function istObjekt(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function leseZiel(value: unknown): BenachrichtigungZiel {
    if (!istObjekt(value)) throw ungueltig('"an" ist kein Objekt');
    const { ausser, ...rest } = value;
    if (ausser !== undefined && (typeof ausser !== "string" || !UUID.test(ausser)))
        throw ungueltig('"an.ausser" ist keine Kennung');
    const extra = ausser === undefined ? {} : { ausser };
    const keys = Object.keys(rest);
    if (keys.length !== 1) throw ungueltig('"an" braucht genau eines von "person", "rolle", "alle"');
    if (typeof rest["person"] === "string" && UUID.test(rest["person"])) return { person: rest["person"], ...extra };
    if (typeof rest["rolle"] === "string" && (ROLES as readonly string[]).includes(rest["rolle"]))
        return { rolle: rest["rolle"] as (typeof ROLES)[number], ...extra };
    if (rest["alle"] === true) return { alle: true, ...extra };
    throw ungueltig(`"an.${keys[0] ?? ""}" ist kein gültiges Ziel`);
}

/** Prüft die Eingabe streng; wirft `JobFailure("input_invalid")` mit dem Grund. */
export function leseBenachrichtigungAuftrag(input: Record<string, unknown>): BenachrichtigungAuftrag {
    const unbekannt = Object.keys(input).filter((key) => !["art", "an", "text", "quelle"].includes(key));
    if (unbekannt.length > 0) throw ungueltig(`unbekanntes Feld ${unbekannt.join(", ")}`);
    const { art, an, text, quelle } = input;
    if (typeof art !== "string" || !(BENACHRICHTIGUNG_JOB_ARTEN as readonly string[]).includes(art))
        throw ungueltig(`unbekannte Art ${typeof art === "string" ? art : "-"}`);
    if (typeof text !== "string") throw ungueltig('"text" fehlt');
    const getrimmt = text.trim();
    const zeichen = [...getrimmt].length;
    if (zeichen < 1 || zeichen > BENACHRICHTIGUNG_TEXT_MAX)
        throw ungueltig(`"text" hat ${String(zeichen)} Zeichen, erlaubt 1 bis ${String(BENACHRICHTIGUNG_TEXT_MAX)}`);
    if (typeof quelle !== "string" || !QUELLE.test(quelle))
        throw ungueltig('"quelle" ist keine Quelle wie "stage:<sha>"');
    return { art: art as BenachrichtigungArt, an: leseZiel(an), text: getrimmt, quelle };
}

/** Die Umgebung des Ausführers, wie die Anmeldung sie liest (`auth/config.ts`): ohne `AVESMAPS_ENV` nur lokal `development`. */
export function benachrichtigungUmgebung(environment: NodeJS.ProcessEnv): AuthEnvironment {
    const named = environment["AVESMAPS_ENV"];
    if (named !== undefined && named !== "") {
        if ((AUTH_ENVIRONMENTS as readonly string[]).includes(named)) return named as AuthEnvironment;
        throw new JobFailure("environment_invalid", `AVESMAPS_ENV ist keine bekannte Umgebung: ${named}`, false);
    }
    if ((environment["RELEASE_ID"] ?? "dev") === "dev") return "development";
    throw new JobFailure(
        "environment_missing",
        "AVESMAPS_ENV fehlt: Für welche Umgebung die Meldung ist, ist unklar",
        false,
    );
}

/** Trägt die Meldung ein; gibt zurück, wie viele Personen sie neu bekommen haben (Doppelte zählen nicht). */
export async function trageBenachrichtigungEin(
    database: Queryable,
    umgebung: AuthEnvironment,
    auftrag: BenachrichtigungAuftrag,
): Promise<number> {
    try {
        const [row] = await database<{ angelegt: number }[]>`
            SELECT public.benachrichtige(
                ${umgebung}, ${asJson(database, auftrag.an)}::jsonb, 'system', NULL, ${auftrag.art}, NULL, ${auftrag.text},
                ${auftrag.quelle}
            ) AS angelegt
        `;
        return row?.angelegt ?? 0;
    } catch (error) {
        const code = (error as { code?: unknown }).code;
        // Nur der SQLSTATE geht auf die Statusseite. Eine verlorene Verbindung ist wiederholbar, ein fehlendes Recht nicht.
        throw new JobFailure(
            "benachrichtigung_failed",
            `benachrichtige gescheitert, SQLSTATE ${typeof code === "string" ? code : "unbekannt"}`,
            isDatabaseUnavailable(error),
        );
    }
}

/** Der Handler im Job-Prozess. `deps` nur für Tests: die Testdatenbank und eine eigene Umgebung statt `process.env`. */
export async function runBenachrichtigungJob(
    context: JobContext,
    deps: { database?: Queryable; environment?: NodeJS.ProcessEnv } = {},
): Promise<Record<string, unknown>> {
    const auftrag = leseBenachrichtigungAuftrag(context.input);
    const umgebung = benachrichtigungUmgebung(deps.environment ?? process.env);
    await context.beginPhase("eintragen", 0);
    const angelegt =
        deps.database === undefined
            ? await withJobDatabase((database) => trageBenachrichtigungEin(database, umgebung, auftrag))
            : await trageBenachrichtigungEin(deps.database, umgebung, auftrag);
    return { art: auftrag.art, umgebung, quelle: auftrag.quelle, angelegt };
}
