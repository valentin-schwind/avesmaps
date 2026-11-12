import {
    wegfindungAmKnopf,
    wegfindungImRahmen,
    wegfindungVorgaben,
    wegfindungWert,
    wegfindungWirksam,
    type AdminWegfindung,
    type SeegraphStand,
    type Wegfindungswerte,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";

/**
 * Der Stand der Kenngrößen der Wegfindung auf dem Server, NUR LESEND (WI-0153, Bauplan §9 Schnitte 2, 3 und 6;
 * Migrationen 0132 und 0135): was gespeichert ist, was freigegeben ist, und beides in der Ansicht der Verwaltung.
 * Verstellen und Freigeben stehen in `wegfindung.ts`.
 *
 * 🔴 **Ohne Fastify und ohne `ApiError`**, wie `inhaltsstand.ts`: Der Routing-Worker und die Werkzeuge
 * (`compare-topologie`, der Korpus-Wächter) laden diesen Weg. 🪤 Ein Import aus `http/` zieht die Erweiterung des
 * Fastify-Moduls mit und bricht `tsc -p tsconfig.tools.json` — gemessen an d896eca3.
 *
 * Die Tafel der 51 Werte samt Vorgabe, Satz und Grenzen steht im geteilten Paket (`packages/shared/src/wegfindung.ts`)
 * — hier liegt KEINE zweite Liste.
 *
 * 🔴 **Gespeichert wird nur, was verstellt ist.** Alles andere ist die Vorgabe aus dem Register. Zurücksetzen löscht die
 * Zeile; eine gespeicherte Zahl, die heute zufällig der Vorgabe gleicht, verdeckte sonst eine spätere Änderung im Code.
 *
 * - **Fehlerrichtung:** Fehlt die Tafel (vor 0132), gelten die Vorgaben (`unprovisioned`), und der Reiter bleibt lesbar.
 *   Ein Fehler der Datenbank wird nie verschluckt; ihn trägt der Aufrufer.
 * - Eine Kennung in der Tafel, die das Register nicht kennt, oder eine Zahl außerhalb ihrer Grenzen wird übergangen und
 *   gemeldet (`unknownKeys`), wie bei 0102 und den Karteneinstellungen. So überlebt ein Rückweg auf das vorige Release eine
 *   Einstellung, die es noch nicht gibt, und eine enger gefasste Grenze rechnet nicht mit dem alten Wert weiter (WI-0214).
 *
 * 🔴 **Zwei Tafeln seit Schnitt 6** (Migration 0135): `routing_setting` hält, was VERSTELLT ist (das Feld im Reiter),
 * `routing_setting_applied`, was FREIGEGEBEN ist (womit das Routing rechnet). Speichern ändert am Routing nichts; erst
 * der Knopf schreibt die Freigabe fort. Sonst holte sich jeder Worker die Änderung binnen fünf Sekunden von selbst, und
 * die Leiste behauptete „noch nicht gerechnet“, während längst gerechnet war.
 */

export interface WegfindungZeile {
    value: number;
    changedAt: Date;
    changedBy: string | null;
}

export interface Wegfindungsstand {
    source: AdminWegfindung["source"];
    revision: number | null;
    /** Was verstellt ist: die Zahl im Feld. */
    zeilen: ReadonlyMap<string, WegfindungZeile>;
    /** Was freigegeben ist: die Zahl, mit der das Routing rechnet (Migration 0135). */
    freigegeben: ReadonlyMap<string, number>;
    unknownKeys: string[];
    /** Wer wann zuletzt freigegeben hat, und welcher `routing_reload` dabei eingereiht wurde. */
    freigabe: { at: Date | null; by: string | null; job: string | null };
}

/**
 * Liest die Abweichungen und ihre Revision AUS DER DATENBANK (nie aus einem Speicher, der den Weckruf erst nach dem COMMIT
 * bekäme: sonst trüge die Antwort nach dem eigenen Verstellen eine veraltete `baseRevision`). `personen: false` für Rollen ohne
 * Zugriff auf das Anmeldeschema (die Jobs-Rolle): `changedBy` trägt dann nur das Etikett der Kommandozeile.
 */
export async function leseWegfindung(
    db: Queryable,
    { personen = true }: { personen?: boolean } = {},
): Promise<Wegfindungsstand> {
    /**
     * 🔴 Erst fragen, ob die Tafeln da sind, nicht auf den Fehler warten. Der Routing-Worker liest in EINER
     * Transaktion (`SNAPSHOT_TRANSACTION`), und dort bricht eine gescheiterte Anweisung alles ab: Ein `catch` auf 42P01
     * räumt den Fehler weg, aber jede weitere Anweisung derselben Transaktion scheitert dann auch. Gemessen am
     * 2026-10-15, als `routing_setting_applied` in der Entwicklungsdatenbank noch fehlte — der Worker fiel aus, statt
     * auf die Vorgaben zurückzufallen, und mit ihm jede Route.
     */
    const [tafeln] = await db<{ zustand: boolean; werte: boolean; freigabe: boolean }[]>`
        SELECT to_regclass('public.routing_setting_state') IS NOT NULL AS zustand,
               to_regclass('public.routing_setting') IS NOT NULL AS werte,
               to_regclass('public.routing_setting_applied') IS NOT NULL AS freigabe
    `;
    const da = tafeln ?? { zustand: false, werte: false, freigabe: false };
    let revision: number | null = null;
    let freigabe: Wegfindungsstand["freigabe"] = { at: null, by: null, job: null };
    if (da.zustand) {
        const [state] = await db<
            { revision: number; applied_at: Date | null; applied_by: string | null; applied_job: string | null }[]
        >`
            SELECT s.revision::int AS revision, s.applied_at,
                   COALESCE(${personen ? db`p.display_name` : db`NULL`}, s.applied_by_label) AS applied_by,
                   s.applied_job::text AS applied_job
              FROM routing_setting_state s
              ${personen ? db`LEFT JOIN avesmaps_auth.person p ON p.id = s.applied_by` : db``}
             WHERE s.id = 1
        `;
        revision = state?.revision ?? null;
        if (state) freigabe = { at: state.applied_at, by: state.applied_by, job: state.applied_job };
    }
    /** Der freigegebene Stand (0135); fehlt die Tafel, ist nichts freigegeben und es gelten die Vorgaben. */
    let freigegeben = new Map<string, number>();
    if (da.freigabe) {
        const rows = await db<{ key: string; value: number }[]>`SELECT key, value FROM routing_setting_applied`;
        freigegeben = new Map(rows.map((row) => [row.key, row.value]));
    }
    const unknownKeys: string[] = [];
    for (const [key, value] of freigegeben) {
        if (annehmbar(key, value)) continue;
        unknownKeys.push(key);
        freigegeben.delete(key);
    }
    if (!da.werte) {
        return { source: "unprovisioned", revision, zeilen: new Map(), freigegeben, unknownKeys, freigabe };
    }
    let rows: { key: string; value: number; changed_at: Date; changed_by: string | null }[];
    {
        rows = personen
            ? await db`
                SELECT r.key, r.value, r.changed_at, COALESCE(p.display_name, r.changed_by_label) AS changed_by
                  FROM routing_setting r
                  LEFT JOIN avesmaps_auth.person p ON p.id = r.changed_by
                 ORDER BY r.key
            `
            : await db`SELECT key, value, changed_at, changed_by_label AS changed_by FROM routing_setting ORDER BY key`;
    }
    const zeilen = new Map<string, WegfindungZeile>();
    for (const row of rows) {
        if (!annehmbar(row.key, row.value)) unknownKeys.push(row.key);
        else zeilen.set(row.key, { value: row.value, changedAt: row.changed_at, changedBy: row.changed_by });
    }
    return { source: "database", revision, zeilen, freigegeben, unknownKeys: [...new Set(unknownKeys)], freigabe };
}

/**
 * Nimmt der Lesestand diese gespeicherte Zahl an? Nur eine bekannte Kennung mit einer Zahl in IHREN Grenzen (WI-0214,
 * Befund P1-09). 🔴 Geprüft wird beim Lesen, nicht nur beim Schreiben: Ein Wert, den ein späteres Release enger fasst
 * oder den jemand per SQL setzt, fällt auf die Vorgabe zurück und steht in `unknownKeys`, statt still mitzurechnen —
 * wie bei den Karteneinstellungen. Reiter, Freigabe und Dienst lesen damit denselben Stand.
 */
function annehmbar(key: string, value: number): boolean {
    const wert = wegfindungWert(key);
    return wert !== undefined && wegfindungImRahmen(wert, value);
}

/**
 * Die wirksamen Werte zu einem Stand: die Vorgaben des Registers, überschrieben nach EINER Regel (WI-0153 Schnitt 6).
 *
 * - Was am Knopf hängt (Folge `netz`), kommt aus dem FREIGEGEBENEN Stand. Speichern ändert daran nichts; erst der Knopf.
 * - Alles andere kommt aus dem GESPEICHERTEN Stand und gilt mit der nächsten Prüfung des Dienstes von selbst.
 *
 * Ist nichts gesetzt, sind es die Vorgaben des Registers — also dieselben Zahlen, die vorher als Konstanten im
 * Quelltext standen. 🪤 Die Regel steht im Register (`wegfindungAmKnopf`), nicht hier: Der Revisionsteil, die
 * Freigabe und die Leiste lesen dieselbe, sonst sagt die Oberfläche etwas anderes als der Dienst rechnet.
 */
export function wirksameWegfindung(stand: Wegfindungsstand): Wegfindungswerte {
    const abweichungen: Record<string, number> = {};
    for (const [key, value] of stand.freigegeben) if (wegfindungAmKnopf(key)) abweichungen[key] = value;
    for (const [key, zeile] of stand.zeilen) if (!wegfindungAmKnopf(key)) abweichungen[key] = zeile.value;
    return wegfindungWirksam(abweichungen);
}

/**
 * Das Lesemodell des Reiters: je Kennung, die gespeichert ODER freigegeben abweicht, zwei Zahlen — `value` ist
 * gespeichert, `applied` ist das, womit der Dienst rechnet. Die Namen und Sätze kennt die Oberfläche aus dem Register.
 *
 * 🔴 Was NICHT am Knopf hängt, trägt in `applied` denselben Wert wie in `value`: Es gilt ohne Knopf. Damit ist eine
 * Zeile mit `value !== applied` genau eine, die auf die Freigabe wartet — die Oberfläche braucht dafür keine zweite
 * Regel. 🪤 Es ist der Stand der DATENBANK, nicht der des Workers: Bis die nächste Prüfung läuft (fünf Sekunden),
 * rechnet er noch mit der alten Zahl. Genau das sagt der Satz der Zeile.
 */
export function wegfindungModell(
    stand: Wegfindungsstand,
    now: Date,
    jobState: string | null = null,
    seaGraph: SeegraphStand = { derivedAt: null, stale: false, job: null, jobState: null },
): AdminWegfindung {
    const kennungen = [...new Set([...stand.zeilen.keys(), ...stand.freigegeben.keys()])]
        .filter((id) => wegfindungWert(id) !== undefined)
        .sort();
    return {
        now: now.toISOString(),
        revision: stand.revision,
        source: stand.source,
        rows: kennungen.map((id) => {
            const zeile = stand.zeilen.get(id);
            return {
                id,
                value: zeile?.value ?? null,
                applied: wegfindungAmKnopf(id) ? (stand.freigegeben.get(id) ?? null) : (zeile?.value ?? null),
                changedAt: zeile?.changedAt.toISOString() ?? null,
                changedBy: zeile?.changedBy ?? null,
            };
        }),
        unknownKeys: [...stand.unknownKeys].sort(),
        appliedAt: stand.freigabe.at?.toISOString() ?? null,
        appliedBy: stand.freigabe.by,
        appliedJob: stand.freigabe.job,
        appliedJobState: jobState,
        seaGraph,
    };
}

/**
 * 🔴 **Die Lesestelle außerhalb des Routing-Workers** (WI-0214, Befund S3-01): die wirksamen Zahlen für den
 * Fastify-Hauptthread — Grenzen der Anfrage, Ortssuche, Prüfhaken, Infopanel — nach derselben Regel wie der Worker
 * (`wirksameWegfindung`).
 *
 * Warum nicht `werte()` aus `routing/einstellungen.ts`: Das ist der Zustand EINES Threads, und gesetzt wird er nur im
 * Worker. Worker-Threads haben eigene Module, also sah der Hauptthread dort für immer die Vorgaben, während der Reiter den
 * eingestellten Wert als geltend zeigte. 🪤 Auch nicht über die Nachricht des Workers: Prüfhaken, Infopanel und Ortssuche
 * hingen dann am Leben des Routenrechners, und kein Test über `app.inject` sähe die Thread-Grenze.
 *
 * - **Fünf Sekunden zwischengespeichert, je Datenbank** — so oft prüft auch der Worker. Mehrere Anfragen zugleich teilen
 *   sich eine Abfrage.
 * - **Verstellen und Freigeben im selben Prozess** vergessen den Speicher sofort (`vergissWegfindungswerte`); andere
 *   Instanzen holen den Stand mit dem nächsten Ablauf.
 * - **Fällt die Datenbank kurz aus,** gilt der zuletzt gelesene Stand weiter: Der Routenrechner hält sein Netz im Speicher
 *   und rechnet weiter, also sollen ihn die Grenzen davor nicht anhalten. Gab es noch keinen, bekommt der Aufrufer den
 *   Fehler, wie bei jeder anderen Abfrage. Ohne Datenbank (`undefined`) gelten die Vorgaben.
 */
export const WEGFINDUNG_LESEN_MS = 5000;

interface Gelesen {
    at: number;
    werte: Promise<Wegfindungswerte>;
}

const gelesen = new WeakMap<object, Gelesen>();
/** Der zuletzt erfolgreich gelesene Stand je Datenbank: Er trägt über einen kurzen Ausfall. */
const zuletzt = new WeakMap<object, Wegfindungswerte>();
const VORGABEN = Object.freeze(wegfindungVorgaben());

export async function wegfindungswerte(
    db: Queryable | undefined,
    now: () => number = Date.now,
): Promise<Wegfindungswerte> {
    if (db === undefined) return VORGABEN;
    const vorher = gelesen.get(db);
    if (vorher !== undefined && now() - vorher.at < WEGFINDUNG_LESEN_MS) return vorher.werte;
    const werte = leseWegfindung(db, { personen: false }).then(
        (stand) => {
            const wirksam = wirksameWegfindung(stand);
            zuletzt.set(db, wirksam);
            return wirksam;
        },
        (error: unknown) => {
            // Ein Fehler bleibt nicht fünf Sekunden liegen: Die nächste Anfrage fragt neu.
            if (gelesen.get(db)?.werte === werte) gelesen.delete(db);
            const alt = zuletzt.get(db);
            if (alt === undefined) throw error;
            return alt;
        },
    );
    gelesen.set(db, { at: now(), werte });
    return werte;
}

/** Vergisst den gelesenen Stand dieser Datenbank: nach dem Verstellen und Freigeben, und in Tests. */
export function vergissWegfindungswerte(db: Queryable | undefined): void {
    if (db !== undefined) gelesen.delete(db);
}
