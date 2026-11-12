import {
    jedeKarteneinstellung,
    karteneinstellungenWirksam,
    karteneinstellungGleich,
    karteneinstellungImRahmen,
    REISEBEGINN_NAMENLOSE_TAGE,
    REISEBEGINN_TAGE,
    type AdminKarteneinstellungen,
    privateKarteneinstellung,
    privateKarteneinstellungenWirksam,
    type JedeKarteneinstellung,
    type PrivateKartenEinstellungen,
    type KartenEinstellungen,
    type KartenWert,
    type KurvenPunkt,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { isMissingTable } from "./state-row.ts";

/**
 * Die Karteneinstellungen auf dem Server (WI-0166, Migration 0134): lesen, in die Ansicht der Verwaltung bringen, für den Start
 * der Karte zusammenrechnen, verstellen und zurücksetzen. Die Tafel samt Vorgabe, Art und Grenzen steht im geteilten Paket
 * (`packages/shared/src/system/karteneinstellungen.ts`) — hier liegt KEINE zweite Liste. Vorbild ist die Wegfindung
 * (`system/wegfindung.ts`).
 *
 * - **Fehlerrichtung:** Fehlt die Tafel (vor 0134), gelten die Vorgaben (`unprovisioned`); die Karte startet trotzdem. Ein
 *   Fehler der Datenbank wird nie verschluckt; ihn trägt der Aufrufer.
 * - Eine Kennung, die die Tafel nicht kennt, oder ein Wert, der nicht (mehr) in Art und Grenzen passt, wird übergangen und
 *   gemeldet (`unknownKeys`). So überlebt ein Rückweg auf das vorige Release eine Einstellung, die es noch nicht gibt.
 */

export interface KarteneinstellungZeile {
    value: KartenWert;
    changedAt: Date;
    changedBy: string | null;
}

export interface Karteneinstellungsstand {
    source: AdminKarteneinstellungen["source"];
    revision: number | null;
    zeilen: ReadonlyMap<string, KarteneinstellungZeile>;
    unknownKeys: string[];
}

/**
 * Liest die Abweichungen und ihre Revision AUS DER DATENBANK. `personen: false` für den öffentlichen Leseweg: Der braucht nur
 * die Werte, und wer verstellt hat, geht Besucher nichts an.
 */
export async function leseKarteneinstellungen(
    db: Queryable,
    { personen = true }: { personen?: boolean } = {},
): Promise<Karteneinstellungsstand> {
    let revision: number | null = null;
    try {
        const [state] = await db<
            { revision: number }[]
        >`SELECT revision::int AS revision FROM map_setting_state WHERE id = 1`;
        revision = state?.revision ?? null;
    } catch (error) {
        if (!isMissingTable(error)) throw error;
    }
    let rows: { key: string; value: unknown; changed_at: Date; changed_by: string | null }[];
    try {
        rows = personen
            ? await db`
                SELECT m.key, m.value, m.changed_at, COALESCE(p.display_name, m.changed_by_label) AS changed_by
                  FROM map_setting m
                  LEFT JOIN avesmaps_auth.person p ON p.id = m.changed_by
                 ORDER BY m.key
            `
            : await db`SELECT key, value, changed_at, NULL::text AS changed_by FROM map_setting ORDER BY key`;
    } catch (error) {
        if (isMissingTable(error)) return { source: "unprovisioned", revision, zeilen: new Map(), unknownKeys: [] };
        throw error;
    }
    const zeilen = new Map<string, KarteneinstellungZeile>();
    const unknownKeys: string[] = [];
    for (const row of rows) {
        // Öffentlich oder privat (WI-0180 §8): Beide gehören zur Tafel; welche jemand sehen darf, entscheidet der Leseweg.
        const einstellung = jedeKarteneinstellung(row.key);
        if (einstellung === undefined || !karteneinstellungImRahmen(einstellung, row.value)) unknownKeys.push(row.key);
        else zeilen.set(row.key, { value: row.value, changedAt: row.changed_at, changedBy: row.changed_by });
    }
    return { source: "database", revision, zeilen, unknownKeys };
}

/** Die wirksamen Werte zu einem Stand: die Vorgaben, überschrieben von den Abweichungen. Das liest der Start der Karte. */
export function wirksameKarteneinstellungen(stand: Karteneinstellungsstand): KartenEinstellungen {
    return karteneinstellungenWirksam(Object.fromEntries([...stand.zeilen].map(([id, zeile]) => [id, zeile.value])));
}

/** Die wirksamen privaten Werte (WI-0180 §8); nur für Sitzungen mit `switch_environment`. */
export function privateKarteneinstellungen(stand: Karteneinstellungsstand): PrivateKartenEinstellungen {
    return privateKarteneinstellungenWirksam(
        Object.fromEntries([...stand.zeilen].map(([id, zeile]) => [id, zeile.value])),
    );
}

/**
 * Das Lesemodell des Reiters: nur die abweichenden Zeilen; Namen und Sätze kennt die Oberfläche aus der Sprachtafel. Private
 * Zeilen stehen nie in `rows`, sondern in `privat`, und das nur mit `privat: true` (Sitzungen mit `switch_environment`).
 */
export function karteneinstellungenModell(
    stand: Karteneinstellungsstand,
    now: Date,
    { privat = false }: { privat?: boolean } = {},
): AdminKarteneinstellungen {
    const zeile = ([id, z]: [string, KarteneinstellungZeile]) => ({
        id,
        // Eine Kurve ist im Lesemodell eine gewöhnliche Liste; die Tafel liefert sie schreibgeschützt.
        value: (Array.isArray(z.value) ? z.value.map((p: KurvenPunkt) => ({ ...p })) : z.value) as
            Exclude<KartenWert, readonly KurvenPunkt[]> | KurvenPunkt[],
        changedAt: z.changedAt.toISOString(),
        changedBy: z.changedBy,
    });
    const alle = [...stand.zeilen];
    return {
        now: now.toISOString(),
        revision: stand.revision,
        source: stand.source,
        rows: alle.filter(([id]) => privateKarteneinstellung(id) === undefined).map(zeile),
        unknownKeys: [...stand.unknownKeys].sort(),
        ...(privat ? { privat: alle.filter(([id]) => privateKarteneinstellung(id) !== undefined).map(zeile) } : {}),
    };
}

/** Was die Fehlermeldung über die erlaubten Werte sagt, je Art. */
function grenzenVon(einstellung: JedeKarteneinstellung): Record<string, unknown> {
    switch (einstellung.art) {
        case "text":
            return { maxLaenge: einstellung.maxLaenge, muster: einstellung.muster };
        case "zahl":
            return {
                min: einstellung.min,
                max: einstellung.max,
                ...(einstellung.schritt === undefined ? {} : { schritt: einstellung.schritt }),
            };
        case "punkt":
            return { ...einstellung.grenzen };
        case "auswahl":
            return { optionen: [...einstellung.optionen] };
        case "schalter":
            return { art: "boolean" };
        case "reisebeginn":
            return {
                monate: [...einstellung.monate],
                tage: { ...REISEBEGINN_TAGE },
                tageNamenlos: { ...REISEBEGINN_NAMENLOSE_TAGE },
            };
        case "farbe":
            return { art: "#rrggbb" };
        case "kurve":
            return {
                punkte: { ...einstellung.punkte },
                zoom: { ...einstellung.zoom },
                neigung: { ...einstellung.neigung },
            };
    }
}

/**
 * Die Sperre jedes Schreibwegs der Karteneinstellungen, für die Dauer der Transaktion (`pg_advisory_xact_lock`). Wer hier schreibt,
 * nimmt sie, bevor er die Revision liest; sonst lesen zwei Schreibwege dieselbe `baseRevision` und überschreiben einander.
 *
 * 🔴 **Nicht `SELECT … FOR UPDATE` auf `map_setting_state`:** Das verlangt in PostgreSQL das UPDATE-Recht, auch wenn niemand
 * schreibt, und das hat die App an dieser Tafel nicht (die Revision hebt allein der Trigger). Production antwortete darauf beim
 * Speichern „permission denied for table map_setting_state“ (Claudio 2026-10-15); lokal und in Tests fiel es nicht auf, weil dort
 * als Eigentümer gearbeitet wird. Der Wächter `karteneinstellungen-grants.test.ts` schreibt darum als App-Rolle.
 */
export const KARTENEINSTELLUNGEN_SPERRE = "map_setting:schreiben";

export interface Verstellen {
    id: string;
    /** Der neue Wert, oder `null`: zurück auf die Vorgabe (die Zeile wird gelöscht). */
    value: KartenWert | null;
    baseRevision: number;
    actor: { personId: string | null; label: string };
    conflict?: (current: { revision: number; changedAt: Date }) => Promise<ApiError>;
}

/**
 * Verstellt eine Einstellung oder setzt sie zurück, in der Transaktion des Aufrufers (der das Protokoll im selben Zug schreibt).
 *
 * - `baseRevision` veraltet: 409 `edit_conflict`.
 * - Kennung nicht in der Tafel: 400 `unknown_setting`. Falsche Art oder außerhalb der Grenzen: 400 `value_out_of_range`.
 * - Steht der Wert schon so (auch: schon auf der Vorgabe, also ohne Zeile): 409 `no_change`; sonst stünde ein Protokolleintrag
 *   über eine Änderung da, die keine war.
 * - 🔴 Die Vorgabe selbst wird nie gespeichert: Wer genau die Vorgabe schickt, setzt zurück (die Zeile fällt weg).
 */
export async function verstelleKarteneinstellung(
    tx: Queryable,
    input: Verstellen,
): Promise<{ from: KartenWert | null; to: KartenWert | null; revision: number }> {
    const einstellung = jedeKarteneinstellung(input.id);
    if (einstellung === undefined) throw new ApiError(400, "unknown_setting", "Diese Einstellung gibt es nicht.");
    if (input.value !== null && !karteneinstellungImRahmen(einstellung, input.value)) {
        throw new ApiError(
            400,
            "value_out_of_range",
            "Der Wert passt nicht zu dieser Einstellung oder liegt außerhalb ihrer Grenzen.",
            grenzenVon(einstellung),
        );
    }
    const ziel = input.value !== null && karteneinstellungGleich(input.value, einstellung.vorgabe) ? null : input.value;
    // Erst die Sperre, dann die Revision lesen: Zwei Schreibwege hintereinander, nie verzahnt (siehe KARTENEINSTELLUNGEN_SPERRE).
    await tx`SELECT pg_advisory_xact_lock(hashtext(${KARTENEINSTELLUNGEN_SPERRE}))`;
    const [state] = await tx<{ revision: number; updated_at: Date }[]>`
        SELECT revision::int AS revision, updated_at FROM map_setting_state WHERE id = 1
    `;
    if (state === undefined) {
        throw new ApiError(
            503,
            "karteneinstellungen_unprovisioned",
            "Die Tafel der Karteneinstellungen fehlt noch in dieser Umgebung.",
        );
    }
    if (state.revision !== input.baseRevision) {
        throw input.conflict
            ? await input.conflict({ revision: state.revision, changedAt: state.updated_at })
            : new ApiError(
                  409,
                  "edit_conflict",
                  "Jemand hat das gerade geändert. Neu laden zeigt den aktuellen Stand.",
              );
    }
    const [vorher] = await tx<{ value: unknown }[]>`SELECT value FROM map_setting WHERE key = ${input.id}`;
    const from = vorher !== undefined && karteneinstellungImRahmen(einstellung, vorher.value) ? vorher.value : null;
    const unveraendert =
        vorher === undefined ? ziel === null : ziel !== null && from !== null && karteneinstellungGleich(from, ziel);
    if (unveraendert) throw new ApiError(409, "no_change", "Der Wert steht schon so.");
    if (ziel === null) await tx`DELETE FROM map_setting WHERE key = ${input.id}`;
    else
        await tx`
            INSERT INTO map_setting (key, value, changed_at, changed_by, changed_by_label)
            VALUES (${input.id}, ${tx.json(ziel as never)}, now(), ${input.actor.personId}::uuid, ${input.actor.label})
            ON CONFLICT (key) DO UPDATE SET
                value = EXCLUDED.value, changed_at = now(), changed_by = EXCLUDED.changed_by,
                changed_by_label = EXCLUDED.changed_by_label
        `;
    const [neu] = await tx<
        { revision: number }[]
    >`SELECT revision::int AS revision FROM map_setting_state WHERE id = 1`;
    return { from, to: ziel, revision: neu!.revision };
}
