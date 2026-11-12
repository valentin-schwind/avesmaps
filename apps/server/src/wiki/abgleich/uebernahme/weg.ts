import { isPathHandle } from "@avesmaps3d/shared";
import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Wege (WI-0253 D-2). Ein Objekt ist ein Abschnitt (`path`); die Abschnitte einer Straße tragen denselben Namen und teilen sich den Artikel (und damit den Wiki-Stand
 * `wiki_path_snapshot`, den die HAUPTzuweisung `path_wiki_assignment` mit `role = 'main'` benennt). Geschrieben werden:
 *
 * - **Wirksam** nur der Name (`path.name`), an jedem Abschnitt, dessen Name dem Wiki FOLGT (Vermerk „wiki“ in `field_origin`). Wegart, Kennzeichen und Reisemittel bleiben beim Editor: Sie sind keine
 *   Felder des Abgleichs.
 * - **Der Wiki-Wert** (↺): Name, Art (Straße oder Fluss), Wegart, Lage, Länge, Verlauf, Beschreibung.
 *
 * 🔴 **Ein Weg ist sein Name** (`path-update.ts`): Wer den Namen ändert, ändert ihn an allen Abschnitten der Straße, nie leer und nie auf den Namen einer anderen Straße (das verschmölze beide).
 * Die Übernahme ändert den Namen darum nur, wenn ihre Zeilen die GANZE Straße treffen und der neue Name frei ist; sonst bleibt der Name, der Wiki-Wert wird trotzdem geschrieben, und ein Befund
 * sagt warum. Ein Griff (`Pfad-12`, der bloße Wegtyp) ist keine Straße: Dieser Abschnitt steht für sich.
 *
 * 🔴 **Nur die Hauptzuweisung wird gepflegt.** Hängt ein Artikel am Abschnitt nur als weitere Zuweisung (`role = 'further'`), ist sein Wiki-Stand schlank (Schlüssel, Name, Art, Wegart) und gehört
 * nicht zu den Feldern dieser Übernahme (`weitere_zuweisung`); an einem schlanken Wiki-Stand legt sie keine Texte an (`schnappschuss_schlank`: Die Tafel verbietet Lage, Verlauf, Länge und
 * Beschreibung dort). Die Art muss `strasse` oder `fluss` sein.
 *
 * Der Name geht in die Wegnamen auf der Karte (`path_label_runs`) und das Wegprofil ein: Nur ein Schritt mit Namen löst die Ableitung aus (`leitetAb`).
 * Die Sperre ist die des Editors (`FOR NO KEY UPDATE` auf dem Abschnitt, wie `path-update.ts`): Ein gleichzeitiges Speichern wartet und scheitert danach an der Revision (409).
 */

const WIRKSAM = { name: "name" } as const;
const SCHNAPPSCHUSS = {
    name: "name",
    kind: "kind",
    art: "art",
    lage: "lage",
    laenge: "laenge",
    verlauf: "verlauf",
    description: "description",
} as const;

/** Die Felder, die ein schlanker Wiki-Stand nicht trägt (die Tafel erzwingt NULL). */
const NUR_VOLL: ReadonlySet<string> = new Set(["lage", "laenge", "verlauf", "description"]);

export const wegSchreiber: Schreiber = {
    bereich: "weg",
    protokollArt: "path",
    objektArt: "path",
    affectedArt: "path",
    eintragZiel: (id) => ({ pathId: id }),
    zielSpalte: "path_public_id",
    wirksameSpalten: WIRKSAM,
    schnappschussSpalten: SCHNAPPSCHUSS,
    leitetAb: (schritte) => schritte.some((schritt) => schritt.feld === "name" && schritt.wirksam !== undefined),

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM path
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR NO KEY UPDATE
        `;
        await tx`
            SELECT s.id
              FROM wiki_path_snapshot s
             WHERE s.id IN (
                       SELECT a.snapshot_id
                         FROM path_wiki_assignment a
                         JOIN path p ON p.id = a.path_id
                        WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND a.is_active AND a.role = 'main' AND a.snapshot_id IS NOT NULL
                   )
             ORDER BY s.id
               FOR NO KEY UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT p.public_id::text AS id, a.snapshot_id::text AS snapshot
              FROM path p
              JOIN path_wiki_assignment a
                ON a.path_id = p.id AND a.is_active AND a.role = 'main' AND a.assignment_state = 'assigned'
              JOIN wiki_path_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE p.public_id = ANY(${[...ids]}::uuid[])
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    async pruefe(tx, schritte) {
        const befunde: BefundSchritt[] = [];
        const nurSnapshot = new Set<FeldSchritt>();
        const verworfen = new Set<FeldSchritt>();
        const befund = (schritt: FeldSchritt, art: BefundSchritt["befund"], grund: string): void => {
            befunde.push({
                objektId: schritt.objekt.id,
                objektArt: "path",
                objektName: schritt.objekt.name,
                feld: schritt.feld,
                befund: art,
                grund,
            });
        };

        // 1. Der Wiki-Stand: schlank legt keine Texte an; die Art ist Straße oder Fluss.
        for (const schritt of schritte) {
            if (schritt.schnappschuss === undefined) continue;
            if (schritt.objekt.schnappschussUnbekannt.has(schritt.feld) && NUR_VOLL.has(schritt.feld)) {
                verworfen.add(schritt);
                befund(schritt, "schnappschuss_schlank", "Der Wiki-Stand dieses Artikels ist schlank");
                continue;
            }
            if (
                schritt.feld === "kind" &&
                schritt.schnappschuss.nachher !== null &&
                schritt.schnappschuss.nachher !== "strasse" &&
                schritt.schnappschuss.nachher !== "fluss"
            ) {
                verworfen.add(schritt);
                befund(schritt, "wert_unzulaessig", "Weder Straße noch Fluss");
            }
        }

        // 2. Der Name.
        const namen = schritte.filter(
            (schritt) => schritt.feld === "name" && schritt.wirksam !== undefined && !verworfen.has(schritt),
        );
        const ablehnen = (schritt: FeldSchritt, art: BefundSchritt["befund"], grund: string): void => {
            nurSnapshot.add(schritt);
            befund(schritt, art, grund);
        };
        for (const schritt of namen) {
            if ((schritt.wirksam?.nachher ?? "").trim() === "")
                ablehnen(schritt, "name_leer", "Der Name wird nie geleert");
        }
        const frei = namen.filter((schritt) => !nurSnapshot.has(schritt));
        if (frei.length > 0) {
            const alt = [...new Set(frei.map((schritt) => schritt.wirksam?.vorher ?? ""))];
            const neu = [...new Set(frei.map((schritt) => schritt.wirksam?.nachher ?? ""))];
            const vorhanden = await tx<{ id: string; name: string; subtype: string; domain: string }[]>`
                SELECT public_id::text AS id, name, subtype, map_domain_id AS domain
                  FROM path
                 WHERE is_active AND (name = ANY(${alt}::text[]) OR name = ANY(${neu}::text[]))
            `;
            const domaene = new Map(vorhanden.map((zeile) => [zeile.id, zeile.domain]));
            const ziele = new Set(frei.map((schritt) => schritt.objekt.id));
            const echterName = (zeile: { name: string; subtype: string }): boolean =>
                !isPathHandle(zeile.name, zeile.subtype);
            // 2a. Die ganze Straße: jeder Abschnitt, der heute so heißt, steht unter den Zielen. Ein Griff ist keine Straße.
            for (const schritt of frei) {
                const eigener = vorhanden.find((zeile) => zeile.id === schritt.objekt.id);
                if (eigener === undefined || !echterName(eigener)) continue;
                const strasse = vorhanden.filter(
                    (zeile) => zeile.name === eigener.name && zeile.domain === eigener.domain && echterName(zeile),
                );
                if (strasse.some((zeile) => !ziele.has(zeile.id)))
                    ablehnen(schritt, "linie_unvollstaendig", "Nicht alle Abschnitte der Straße hängen am Artikel");
            }
            // 2b. Ein freier Name: Kein anderer Abschnitt trägt ihn heute (das verschmölze zwei Straßen).
            for (const schritt of frei.filter((kandidat) => !nurSnapshot.has(kandidat))) {
                const dom = domaene.get(schritt.objekt.id);
                const ziel = schritt.wirksam?.nachher ?? "";
                if (
                    vorhanden.some(
                        (zeile) =>
                            zeile.name === ziel && zeile.domain === dom && !ziele.has(zeile.id) && echterName(zeile),
                    )
                )
                    ablehnen(schritt, "name_vergeben", "Eine andere Straße trägt den Namen schon");
            }
            // 2c. Zwei Straßen dieses Laufs auf denselben neuen Namen verschmölzen ebenfalls.
            const jeNeu = new Map<string, Set<string>>();
            for (const schritt of frei.filter((kandidat) => !nurSnapshot.has(kandidat))) {
                const schluessel = `${domaene.get(schritt.objekt.id) ?? ""}\u0000${schritt.wirksam?.nachher ?? ""}`;
                const vorher = jeNeu.get(schluessel) ?? new Set<string>();
                vorher.add(schritt.wirksam?.vorher ?? "");
                jeNeu.set(schluessel, vorher);
            }
            for (const schritt of frei.filter((kandidat) => !nurSnapshot.has(kandidat))) {
                const schluessel = `${domaene.get(schritt.objekt.id) ?? ""}\u0000${schritt.wirksam?.nachher ?? ""}`;
                if ((jeNeu.get(schluessel)?.size ?? 0) > 1)
                    ablehnen(schritt, "name_vergeben", "Zwei Straßen bekämen denselben Namen");
            }
        }

        const bleibt = schritte.flatMap((schritt): FeldSchritt[] => {
            if (verworfen.has(schritt)) return [];
            if (!nurSnapshot.has(schritt)) return [schritt];
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
                      UPDATE path SET revision = revision WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `
                : await tx<{ revision: number }[]>`
                      UPDATE path SET ${tx(spalten as Record<string, string | null>, ...namen)}, revision = revision
                       WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `;
        if (zeile === undefined) throw new Error(`Weg ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        return zeile.revision;
    },

    async schreibeSchnappschuss(tx, schnappschussId, spalten) {
        const namen = Object.keys(spalten);
        if (namen.length === 0) return;
        await tx`
            UPDATE wiki_path_snapshot
               SET ${tx(spalten as Record<string, string | null>, ...namen)}, updated_at = now()
             WHERE id = ${schnappschussId}::bigint
        `;
    },
};
