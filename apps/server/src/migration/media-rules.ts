import type { Queryable } from "../database.ts";

/**
 * Die Freigaberegeln des Medienimports (WI-0063, Gate G1, Option A, Betreiber 2026-10-04; `media.yaml` →
 * `betreibergate.g1_freigaberegeln`): je eine Datenzeile in `publication_rule` mit wörtlichem Betreiberzitat und Datum, statt
 * Tausender Einzelfreigaben. Ein Widerruf schaltet alle betroffenen Medien mit EINER Zeile ab (`revoked_on`).
 *
 * 🔴 Die Zitate stehen hier wörtlich und sind der Beleg; sie sind kein Argument des Laufs. Eine Regel gilt nie für
 * `rights_basis unknown` und nie für `clearance_state rejected` (`media/policy.ts`); ein `blocked` an der Verwendung schlägt sie.
 *
 * 🔴 Eine einmal widerrufene Regel wird NIE neu angelegt: Der Import legt eine Regel nur an, wenn es für ihren Schlüssel (Rechtsbasis,
 * Entstehung, Rolle) noch gar keine Zeile gab, auch keine widerrufene. Widerruf und Änderung sind eine Betriebsmaßnahme per Skript bis
 * WI-0068 (`npm run ops:widerrufe-regel`).
 *
 * 🔴 ABLÖSUNG (Betreiber 2026-10-10, WI-0068 „KI-Regel und Namen“): Eine Regel kann eine ältere ablösen (`supersedes`). Dann widerruft
 * `seedPublicationRules` die Vorgängerin und legt die Nachfolgerin an, in DERSELBEN Transaktion: Ein Leser sieht entweder beide
 * Zustände ganz oder keinen, kein Asset wird dazwischen kurz öffentlich oder kurz privat. Abgelöst wird nur die Zeile, die das
 * Seed-Skript selbst anlegte (gleicher Schlüssel, gleiches Zitat, ohne Person). 🔴 Ist die Vorgängerin schon WIDERRUFEN, war das eine
 * Entscheidung: Die Nachfolgerin entsteht dann NICHT (sonst höbe ein Import den Widerruf auf; AGENTS „kein Import hebt eine getroffene
 * Entscheidung nachträglich auf“), und der Bericht nennt sie (`held`).
 */

export interface RuleEvidence {
    kind: "license_page";
    url: string;
    description: string;
}

/** Der Schlüssel einer Regel: wofür sie gilt. `creationMethod` `null`: jede Entstehung (Migration 0092). */
export interface RuleKey {
    basis: "own_work" | "fan_policy" | "permission" | "license";
    /** Nur bei `license`: die Lizenz, die die Regel trägt (Katalogschlüssel). */
    licenseKey?: string;
    creationMethod: "ai_generated" | null;
    role: "coat" | "header" | "literature_cover" | "map_preview" | "map_full" | "photobox";
}

/** Eine Regel, die eine Nachfolgerin ablöst: erkannt an Schlüssel, Zitat und Datum (so, wie das Seed-Skript sie anlegte). */
export interface SupersededRule extends RuleKey {
    scopeText: string;
    operatorQuote: string;
    decidedOn: string;
}

export interface RuleSeed extends RuleKey {
    scopeText: string;
    operatorQuote: string;
    decidedOn: string;
    evidence: readonly RuleEvidence[];
    /** Die Regel, die diese ablöst (widerrufen in derselben Transaktion, in der diese entsteht). */
    supersedes?: SupersededRule;
}

/** Vali 2026-11-01 wörtlich, Tippfehler inklusive; zuvor gefragt: freigegebene Reisebilder öffentlich, Erlaubnis und CC BY 4.0 (WI-0272 §12). */
const PHOTOBOX_RULE_OPERATOR_QUOTE = "freigaberegel passt. reisebildee dürfen öffentlich gezeigt werden";
const PHOTOBOX_RULE_DECIDED_ON = "2026-11-01";

const FAN_POLICY_PAGE: RuleEvidence = {
    kind: "license_page",
    url: "https://ulisses-spiele.de/fan-richtlinie/",
    description:
        "Fan-Richtlinie von Ulisses Spiele, die Rechtsgrundlage der Legacy-Einstufung permission_granted bei Literaturcovern und automatisch geholten Kartenvorschauen (Legacy: api/_internal/media-license-migration.php und citymaps.php). Hängt EINMAL an der Regel, nicht an jedem Asset.",
};

/** Der Betreiberentscheid zur KI-Regel (WI-0068, in der Koordination „2026-10-10“), wörtlich, der Teil, auf dem die Regeln beruhen. */
export const AI_RULE_OPERATOR_QUOTE =
    "eigene bilder sind nicht automatisch öffentlich, aber die die wir haben sind alle KI-generiert und alle KI-generierten sind öffentlich";
/**
 * 🪤 Das Datum des Entscheids nach der Uhr des Rechners und der Commits (Sa 2026-10-10); die Koordination nennt ihn „2026-10-10“. Ein
 * Datum in der Zukunft der Datenbank sperrte jeden Widerruf von heute (`publication_rule_revocation_ordered`: `revoked_on >= decided_on`,
 * `ops:widerrufe-regel` setzt `CURRENT_DATE`). Gilt der 11., ist es diese eine Zeile.
 */
const AI_RULE_DECIDED_ON = "2026-10-10";

/**
 * Die abgelösten Klassenregeln für eigene Werke (G1), so wie das Seed-Skript sie bis zum KI-Entscheid anlegte: Sie galten JEDEM eigenen Werk,
 * auch einem neuen Upload ohne Rechteprüfung (WI-0068 P4a, Befund zur Klärung).
 */
export const SUPERSEDED_RULE_SEEDS: readonly SupersededRule[] = [
    {
        basis: "own_work",
        creationMethod: null,
        role: "header",
        scopeText:
            "Legacy-Ortsbilder (Klasse settlement_image): Klassenfreigabe als Avesmaps-eigene KI-Erzeugung trotz legacy_assumed. legacy_assumed bleibt als Prüfmarker am Asset; eine ausdrückliche Einzelklassifizierung oder spätere MAM-Korrektur gewinnt (publication_override blocked). Vorausgegangen, Betreiber 2026-10-04: „ja die dürften alle KI generiert sein - wobei es sein kann, dass ein editor was anderes gemacht hat. wir können das nachher im MAM aber (hoffentlich) leicht überprüfen“",
        operatorQuote:
            "Klassenfreigabe gilt. legacy_assumed bleibt als Prüfmarker bestehen, verhindert aber aufgrund der Betreiberregel nicht die Veröffentlichung.",
        decidedOn: "2026-10-04",
    },
    {
        basis: "own_work",
        creationMethod: null,
        role: "coat",
        scopeText:
            "Wappen mit Legacys Rechtecode ai_generated (Klassen territory_coat und settlement_coat): Klassenfreigabe als Avesmaps-eigene KI-Erzeugung trotz legacy_assumed, die Schwester der Ortsbild-Regel darüber. Gemessen am Satz media-f73329a4257b72bd sind es 14 Wappen: 11 Gebietswappen, die über legacy_asserted schon ohne Regel standen, und 3 Ortswappen unter /uploads/wappen/own/, die ohne sie unveröffentlicht blieben, weil Export A keinen Hochladestempel kennt und die Klasse deshalb nur legacy_assumed erreicht. legacy_assumed bleibt als Prüfmarker am Asset; eine Einzelklassifizierung oder spätere MAM-Korrektur gewinnt (publication_override blocked).",
        operatorQuote: "die ai_generated wappen zeigen. die sind alle von uns",
        decidedOn: "2026-10-05",
    },
];

const [OWN_WORK_HEADER, OWN_WORK_COAT] = SUPERSEDED_RULE_SEEDS as readonly [SupersededRule, SupersededRule];

export const PUBLICATION_RULE_SEEDS: readonly RuleSeed[] = [
    {
        basis: "own_work",
        creationMethod: "ai_generated",
        role: "header",
        scopeText:
            "Orts- und Kopfbilder (Rolle header), die als eigenes Werk gelten UND KI-generiert sind (Entstehung ai_generated): Klassenfreigabe, auch bei legacy_assumed (das bleibt Prüfmarker am Asset). Löst die Regel own_work/header vom 2026-10-04 ab, die jedem eigenen Werk galt: Ein eigenes Werk, das nicht KI-generiert ist, wartet auf die Rechteprüfung (Korb „Rechte prüfen: früher als KI angenommen“). Vorausgegangen, Betreiber 2026-10-04: „ja die dürften alle KI generiert sein - wobei es sein kann, dass ein editor was anderes gemacht hat. wir können das nachher im MAM aber (hoffentlich) leicht überprüfen“. Eine Einzelentscheidung im MAM gewinnt (publication_override blocked).",
        operatorQuote: AI_RULE_OPERATOR_QUOTE,
        decidedOn: AI_RULE_DECIDED_ON,
        evidence: [],
        supersedes: OWN_WORK_HEADER,
    },
    {
        basis: "own_work",
        creationMethod: "ai_generated",
        role: "coat",
        scopeText:
            "Wappen (Rolle coat, Orte und Gebiete), die als eigenes Werk gelten UND KI-generiert sind (Entstehung ai_generated): Klassenfreigabe, auch bei legacy_assumed. Löst die Regel own_work/coat vom 2026-10-05 ab, die jedem eigenen Werk galt: Ein eigenes Werk, das nicht KI-generiert ist, wartet auf die Rechteprüfung. Vorausgegangen, Betreiber 2026-10-05: „die ai_generated wappen zeigen. die sind alle von uns“. Eine Einzelentscheidung im MAM gewinnt (publication_override blocked).",
        operatorQuote: AI_RULE_OPERATOR_QUOTE,
        decidedOn: AI_RULE_DECIDED_ON,
        evidence: [],
        supersedes: OWN_WORK_COAT,
    },
    {
        basis: "fan_policy",
        creationMethod: null,
        role: "literature_cover",
        scopeText: "Literaturcover unter den Fan-Regeln von Ulisses (Legacy: permission_granted, Urheber Ulisses)",
        operatorQuote:
            "G1 = A. fan_policy für literature_cover und Kartenvorschauen: ja, zentrale widerrufbare publication_rule.",
        decidedOn: "2026-10-04",
        evidence: [FAN_POLICY_PAGE],
    },
    {
        basis: "fan_policy",
        creationMethod: null,
        role: "map_preview",
        scopeText:
            "Kartenvorschauen der Kartensammlung, automatisch geholt, unter den Fan-Regeln von Ulisses (Legacy: permission_granted, Herkunft autoget)",
        operatorQuote:
            "G1 = A. fan_policy für literature_cover und Kartenvorschauen: ja, zentrale widerrufbare publication_rule.",
        decidedOn: "2026-10-04",
        evidence: [FAN_POLICY_PAGE],
    },
    {
        basis: "permission",
        creationMethod: null,
        role: "map_preview",
        scopeText:
            "Kartenvorschauen, die in Legacy von Hand hochgeladen wurden (Klasse citymap_preview, Legacy: permission_granted, Herkunft upload): die vier echten Kartenbilder der Kartensammlung (WI-0063 27.16, Befund 2). Sie bilden auf permission ab, weil Legacys permission_granted nur bei Covern und automatisch geholten Vorschauen zu fan_policy wird. Die Regel gilt nur in der Rolle map_preview; die Vollkarte (map_full) hebt sie nicht.",
        operatorQuote: "die vier kartenbilder auch freigeben",
        decidedOn: "2026-10-09",
        evidence: [],
    },
    {
        basis: "permission",
        creationMethod: null,
        role: "map_full",
        scopeText:
            "Vollbilder der Kartensammlung mit Einzelgenehmigung (Klasse citymap_full, Legacy: permission_granted). Im Bestand genau eine: Rhôndur (WI-0063 27.16, Frage 2). Die Regel gibt die Datei frei; WO das Vollbild erscheint, ist eine eigene Entscheidung (27.16, Frage 5).",
        operatorQuote: "die Vollkarte Rhôndur auch freigeben",
        decidedOn: "2026-10-09",
        evidence: [],
    },
    {
        basis: "permission",
        creationMethod: null,
        role: "photobox",
        scopeText:
            "Reisebilder mit der Nutzung „Nur für Avesmaps“: Die Erlaubnis gibt der Einsender mit seiner Erklärung zur Bedingungsfassung (WI-0272 §15). Öffentlich wird nur, was die Redaktion freigegeben hat.",
        operatorQuote: PHOTOBOX_RULE_OPERATOR_QUOTE,
        decidedOn: PHOTOBOX_RULE_DECIDED_ON,
        evidence: [],
    },
    {
        basis: "license",
        licenseKey: "cc-by-4.0",
        creationMethod: null,
        role: "photobox",
        scopeText:
            "Reisebilder mit der Nutzung „CC BY 4.0“: Die Lizenz erteilt der Einsender mit seiner Erklärung zur Bedingungsfassung (WI-0272 §15). Öffentlich wird nur, was die Redaktion freigegeben hat.",
        operatorQuote: PHOTOBOX_RULE_OPERATOR_QUOTE,
        decidedOn: PHOTOBOX_RULE_DECIDED_ON,
        evidence: [],
    },
];

/** Der Schlüssel als Text („own_work/ai_generated/coat“, „fan_policy/literature_cover“) für Berichte und Befunde. */
export function ruleKeyLabel(key: RuleKey): string {
    return [key.basis, key.licenseKey ?? null, key.creationMethod, key.role].filter((part) => part !== null).join("/");
}

/** Alle Texte, unter denen das Seed-Skript Regeln anlegt oder angelegt hat (die Aufräumhilfe der Tests erkennt ihre Zeilen daran). */
export const RULE_SEED_SCOPE_TEXTS: readonly string[] = [
    ...PUBLICATION_RULE_SEEDS.map((seed) => seed.scopeText),
    ...SUPERSEDED_RULE_SEEDS.map((seed) => seed.scopeText),
];

/** Wie die Tafel zu einer Regel des Skripts steht. */
export type RuleSeedState =
    | "active" // die Zeile gibt es und sie gilt
    | "revoked" // die Zeile gibt es, sie ist widerrufen (eine Entscheidung)
    | "held" // es gibt sie nicht, weil ihre Vorgängerin widerrufen ist (eine Entscheidung)
    | "pending" // es gibt sie nicht; ihre Vorgängerin gilt noch (der Wechsel steht aus)
    | "missing"; // es gibt sie nicht

interface RuleRow {
    id: string;
    basis: string;
    license_key: string | null;
    creation_method: string | null;
    role: string;
    operator_quote: string;
    decided_on: string;
    revoked_on: string | null;
    decided_by_person: string | null;
}

async function readRuleRows(tx: Queryable): Promise<RuleRow[]> {
    return tx<RuleRow[]>`
        SELECT id::text AS id, rights_basis AS basis, license_key, creation_method, role, operator_quote,
               decided_on::text AS decided_on, revoked_on::text AS revoked_on, decided_by_person::text AS decided_by_person
          FROM publication_rule
         ORDER BY id
    `;
}

const keyOf = (row: RuleRow): string =>
    ruleKeyLabel({
        basis: row.basis as RuleKey["basis"],
        ...(row.license_key === null ? {} : { licenseKey: row.license_key }),
        creationMethod: row.creation_method as RuleKey["creationMethod"],
        role: row.role as RuleKey["role"],
    });

/** Die Zeilen, die das Seed-Skript für diese abgelöste Regel anlegte (Schlüssel ohne Lizenz, Zitat, Datum, ohne Person). */
function predecessorRows(rows: readonly RuleRow[], superseded: SupersededRule): RuleRow[] {
    return rows.filter(
        (row) =>
            row.license_key === null &&
            keyOf(row) === ruleKeyLabel(superseded) &&
            row.operator_quote === superseded.operatorQuote &&
            row.decided_on === superseded.decidedOn &&
            row.decided_by_person === null,
    );
}

function stateOf(rows: readonly RuleRow[], seed: RuleSeed): RuleSeedState {
    const own = rows.filter((row) => keyOf(row) === ruleKeyLabel(seed));
    if (own.some((row) => row.revoked_on === null)) return "active";
    if (own.length > 0) return "revoked";
    if (seed.supersedes === undefined) return "missing";
    const before = predecessorRows(rows, seed.supersedes);
    if (before.some((row) => row.revoked_on === null)) return "pending";
    return before.length > 0 ? "held" : "missing";
}

/** Je Regel des Skripts ihr Stand in der Tafel (Prüfer, Bericht, Werkzeug `media:regeln`). */
export async function ruleSeedStates(
    tx: Queryable,
    seeds: readonly RuleSeed[] = PUBLICATION_RULE_SEEDS,
): Promise<{ seed: RuleSeed; state: RuleSeedState }[]> {
    const rows = await readRuleRows(tx);
    return seeds.map((seed) => ({ seed, state: stateOf(rows, seed) }));
}

export interface RuleSeedResult {
    /** Neu angelegte Regelzeilen. */
    created: number;
    /** Regeln, für die es schon eine Zeile gab (aktiv oder widerrufen): nichts angefasst. */
    present: number;
    /** Neu angelegte Belege an Regeln. */
    evidence: number;
    /** Abgelöste Vorgängerinnen, in derselben Transaktion widerrufen. */
    superseded: number;
    /** Regeln, die NICHT entstanden, weil ihre Vorgängerin widerrufen ist (eine Entscheidung, der Import hebt sie nicht auf). */
    held: string[];
}

/**
 * Legt die Regeln an, die es noch nicht gibt, samt ihrem Beleg, und widerruft dabei abgelöste Vorgängerinnen. Wiederholbar: ein zweiter
 * Lauf schreibt nichts, eine widerrufene Regel bleibt widerrufen, und eine widerrufene Vorgängerin bringt ihre Nachfolgerin nie hervor.
 */
export async function seedPublicationRules(
    tx: Queryable,
    seeds: readonly RuleSeed[] = PUBLICATION_RULE_SEEDS,
): Promise<RuleSeedResult> {
    const result: RuleSeedResult = { created: 0, present: 0, evidence: 0, superseded: 0, held: [] };
    for (const seed of seeds) {
        const rows = await readRuleRows(tx);
        const state = stateOf(rows, seed);
        if (state === "held") {
            result.held.push(ruleKeyLabel(seed));
            continue;
        }
        if (state === "active" || state === "revoked") {
            result.present += 1;
        } else {
            if (state === "pending" && seed.supersedes !== undefined) {
                const before = predecessorRows(rows, seed.supersedes).filter((row) => row.revoked_on === null);
                const reason = `Abgelöst durch die Regel ${ruleKeyLabel(seed)} (Betreiber ${seed.decidedOn}): „${seed.operatorQuote}“`;
                for (const row of before) {
                    await tx`
                        UPDATE publication_rule
                           SET revoked_on = ${seed.decidedOn}::date, revoked_reason = ${reason}, updated_at = now()
                         WHERE id = ${row.id}::bigint AND revoked_on IS NULL
                    `;
                    result.superseded += 1;
                }
            }
            await tx`
                INSERT INTO publication_rule (rights_basis, license_key, creation_method, role, scope_text, operator_quote, decided_on)
                VALUES (${seed.basis}, ${seed.licenseKey ?? null}, ${seed.creationMethod}, ${seed.role}, ${seed.scopeText}, ${seed.operatorQuote},
                        ${seed.decidedOn}::date)
            `;
            result.created += 1;
        }
        // Der Beleg gehört an die Regel, die es gibt (neu oder älter); er entsteht nur, wenn er dort noch nicht hängt.
        const [rule] = await tx<{ id: string }[]>`
            SELECT id::text FROM publication_rule
             WHERE rights_basis = ${seed.basis} AND role = ${seed.role}
               AND license_key IS NOT DISTINCT FROM ${seed.licenseKey ?? null}
               AND creation_method IS NOT DISTINCT FROM ${seed.creationMethod}
             ORDER BY id LIMIT 1
        `;
        if (rule === undefined) continue;
        for (const evidence of seed.evidence) {
            const added = await tx<{ id: string }[]>`
                INSERT INTO media_rights_evidence (publication_rule_id, evidence_kind, external_url, description, recorded_by)
                SELECT ${rule.id}, ${evidence.kind}, ${evidence.url}, ${evidence.description}, 'migrate:media'
                WHERE NOT EXISTS (
                    SELECT 1 FROM media_rights_evidence WHERE publication_rule_id = ${rule.id} AND external_url = ${evidence.url}
                )
                RETURNING id::text
            `;
            result.evidence += added.length;
        }
    }
    return result;
}
