import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Kraftlinien (WI-0253 D-1; der erste angeschlossene Bereich). Ein Objekt ist ein Abschnitt (`powerline`); die Abschnitte einer Linie tragen denselben
 * Namen und teilen sich den Artikel (und damit den Schnappschuss `wiki_powerline_snapshot`, den die Zuordnung `powerline_wiki_assignment` benennt). Geschrieben werden:
 *
 * - **Name und Beschreibung** (wirksam): `powerline.name`, `powerline.description` an jedem Abschnitt, dessen Wert dem Wiki FOLGT (Vermerk „wiki“ in `field_origin`; ein leeres
 *   Feld braucht nichts: Der Leser zeigt dann den Wiki-Wert). Die Revision zählt der Trigger (`powerline_revision`, Migration 0143), genau einmal je Abschnitt und
 *   Operation; ein Editor mit einem Entwurf von vorher bekommt 409. Den Vermerk selbst liest die Übernahme nur.
 * - **Wiki-Wert** (der Schnappschuss, ↺): Name, Stärke, Affinität, Länge, Regionen, Verlauf, Beschreibung. Stärke bis Verlauf führt kein Abschnitt selbst, sie stehen
 *   NUR im Schnappschuss.
 *
 * 🔴 **Der Name bindet die Abschnitte zur Linie** (`kraftlinien-schreiben.ts`): Wer ihn ändert, ändert ihn an allen Abschnitten der Linie, nie leer und nie auf den Namen
 * einer anderen Linie (das verschmölze beide, der Editor warnt dort mit `merged`). Die Übernahme ändert den Namen darum nur, wenn ihre Zeilen die GANZE Linie treffen
 * und der neue Name frei ist; sonst bleibt der Name, der Schnappschuss wird trotzdem geschrieben, und ein Befund sagt warum (`pruefe`).
 *
 * Lesen tut `ladeObjekte` (`lokal.ts`); hier steht nur, was schreibt und sperrt. Die Sperre ist dieselbe wie die des Editors (`FOR UPDATE` auf den Abschnitten): Ein
 * gleichzeitiges Speichern im Editor wartet und scheitert danach an der Revision (409).
 */

const WIRKSAM = { name: "name", description: "description" } as const;
const SCHNAPPSCHUSS = {
    name: "name",
    staerke: "staerke",
    affinitaet: "affinitaet",
    laenge: "laenge",
    regionen: "regionen",
    verlauf: "verlauf",
    description: "description",
} as const;

export const kraftlinieSchreiber: Schreiber = {
    bereich: "kraftlinie",
    protokollArt: "powerline",
    objektArt: "powerline",
    affectedArt: "powerline",
    eintragZiel: (id) => ({ powerlineId: id }),
    zielSpalte: "powerline_public_id",
    wirksameSpalten: WIRKSAM,
    schnappschussSpalten: SCHNAPPSCHUSS,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM powerline
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR UPDATE
        `;
        // Die Schnappschüsse, an denen sie hängen: nach den Abschnitten und in fester Reihenfolge gesperrt.
        await tx`
            SELECT s.id
              FROM wiki_powerline_snapshot s
             WHERE s.id IN (
                       SELECT w.snapshot_id
                         FROM powerline_wiki_assignment w
                         JOIN powerline p ON p.id = w.powerline_id
                        WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND w.snapshot_id IS NOT NULL
                   )
             ORDER BY s.id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT p.public_id::text AS id, w.snapshot_id::text AS snapshot
              FROM powerline p
              JOIN powerline_wiki_assignment w ON w.powerline_id = p.id AND w.is_active AND w.assignment_state = 'assigned'
             WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND w.snapshot_id IS NOT NULL
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    async pruefe(tx, schritte) {
        const namen = schritte.filter((schritt) => schritt.feld === "name" && schritt.wirksam !== undefined);
        if (namen.length === 0) return { schritte: [...schritte], befunde: [] };
        const befunde: BefundSchritt[] = [];
        const verworfen = new Set<FeldSchritt>();
        const verwirf = (schritt: FeldSchritt, befund: BefundSchritt["befund"], grund: string): void => {
            verworfen.add(schritt);
            befunde.push({
                objektId: schritt.objekt.id,
                objektArt: "powerline",
                objektName: schritt.objekt.name,
                feld: "name",
                befund,
                grund,
            });
        };

        // 1. Der Name einer Linie wird nie geleert.
        for (const schritt of namen) {
            if ((schritt.wirksam?.nachher ?? "").trim() === "")
                verwirf(schritt, "name_leer", "Der Name wird nie geleert");
        }
        const frei = namen.filter((schritt) => !verworfen.has(schritt));
        if (frei.length > 0) {
            const alt = [...new Set(frei.map((schritt) => schritt.wirksam?.vorher ?? ""))];
            const neu = [...new Set(frei.map((schritt) => schritt.wirksam?.nachher ?? ""))];
            const vorhanden = await tx<{ id: string; name: string; domain: string }[]>`
                SELECT public_id::text AS id, name, map_domain_id AS domain
                  FROM powerline
                 WHERE is_active AND (name = ANY(${alt}::text[]) OR name = ANY(${neu}::text[]))
            `;
            const domaene = new Map(vorhanden.map((zeile) => [zeile.id, zeile.domain]));
            const ziele = new Set(frei.map((schritt) => schritt.objekt.id));
            // 2. Die ganze Linie: jeder Abschnitt, der heute so heißt, steht unter den Zielen.
            for (const schritt of frei) {
                const dom = domaene.get(schritt.objekt.id);
                const linie = vorhanden.filter(
                    (zeile) => zeile.name === schritt.wirksam?.vorher && zeile.domain === dom,
                );
                if (linie.some((zeile) => !ziele.has(zeile.id)))
                    verwirf(schritt, "linie_unvollstaendig", "Nicht alle Abschnitte der Linie hängen am Artikel");
            }
            // 3. Ein freier Name: Kein anderer Abschnitt trägt ihn heute.
            for (const schritt of frei.filter((kandidat) => !verworfen.has(kandidat))) {
                const dom = domaene.get(schritt.objekt.id);
                if (
                    vorhanden.some(
                        (zeile) =>
                            zeile.name === schritt.wirksam?.nachher && zeile.domain === dom && !ziele.has(zeile.id),
                    )
                )
                    verwirf(schritt, "name_vergeben", "Eine andere Linie trägt den Namen schon");
            }
            // 4. Zwei Linien dieses Laufs auf denselben neuen Namen verschmölzen ebenfalls.
            const jeNeu = new Map<string, Set<string>>();
            for (const schritt of frei.filter((kandidat) => !verworfen.has(kandidat))) {
                const schluessel = `${domaene.get(schritt.objekt.id) ?? ""}\u0000${schritt.wirksam?.nachher ?? ""}`;
                const vorher = jeNeu.get(schluessel) ?? new Set<string>();
                vorher.add(schritt.wirksam?.vorher ?? "");
                jeNeu.set(schluessel, vorher);
            }
            for (const schritt of frei.filter((kandidat) => !verworfen.has(kandidat))) {
                const schluessel = `${domaene.get(schritt.objekt.id) ?? ""}\u0000${schritt.wirksam?.nachher ?? ""}`;
                if ((jeNeu.get(schluessel)?.size ?? 0) > 1)
                    verwirf(schritt, "name_vergeben", "Zwei Linien bekämen denselben Namen");
            }
        }
        // Ein verworfener Name bleibt, wie er ist; sein Wiki-Wert (der Schnappschuss) wird trotzdem geschrieben.
        const bleibt = schritte.flatMap((schritt): FeldSchritt[] => {
            if (!verworfen.has(schritt)) return [schritt];
            return schritt.schnappschuss === undefined
                ? []
                : [{ objekt: schritt.objekt, feld: schritt.feld, schnappschuss: schritt.schnappschuss }];
        });
        return { schritte: bleibt, befunde };
    },

    async schreibeObjekt(tx, id, spalten) {
        const namen = Object.keys(spalten);
        const [zeile] =
            namen.length === 0
                ? await tx<{ revision: number }[]>`
                      UPDATE powerline SET revision = revision WHERE public_id = ${id}::uuid RETURNING revision::int AS revision
                  `
                : await tx<{ revision: number }[]>`
                      UPDATE powerline SET ${tx(spalten as Record<string, string | null>, ...namen)}
                       WHERE public_id = ${id}::uuid RETURNING revision::int AS revision
                  `;
        if (zeile === undefined)
            throw new Error(`Kraftlinie ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        return zeile.revision;
    },

    async schreibeSchnappschuss(tx, schnappschussId, spalten) {
        const namen = Object.keys(spalten);
        if (namen.length === 0) return;
        await tx`
            UPDATE wiki_powerline_snapshot
               SET ${tx(spalten as Record<string, string | null>, ...namen)}, updated_at = now()
             WHERE id = ${schnappschussId}::bigint
        `;
    },
};
