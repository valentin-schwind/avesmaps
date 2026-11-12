import { PLACE_SUBTYPES } from "@avesmaps3d/shared";
import type { Queryable } from "../../../database.ts";
import { ortArtikelSchreiber } from "./ort-artikel.ts";
import type { BefundSchritt, FeldSchritt, Schreiber } from "./schreiber.ts";

/**
 * Der Schreiber der Orte (WI-0253 D-2; Bauwerke und Stadtviertel gehören dazu: `place.subtype`). Ein Objekt ist ein Ort (`place`) mit Einzelheiten (`place_detail`) und, wenn zugewiesen,
 * einem Wiki-Stand (`wiki_settlement_snapshot`, einer je Artikel; zwei Orte am selben Artikel teilen ihn). Geschrieben werden:
 *
 * - **Wirksam** (der Wert folgt dem Wiki: Vermerk „wiki“; ein leeres Feld braucht nichts, der Leser zeigt dann den Wiki-Wert):
 *   - `place.name` (Vermerk in `field_origin`) und `place.subtype` (die Ortsgröße, aus dem Wiki-Teil: Plan-Feld `settlement_class`);
 *   - `place_detail.einwohner`, `lage`, `oberhaupt` mit ihrer Herkunft an der Spalte (`*_origin`). Ein Wert, der entfällt, nimmt seine Herkunft mit (die Tafel verbietet eine Herkunft ohne
 *     Wert); ein Satz ohne ein einziges Feld wird still gelegt (`retired_origin = 'editor'`, wie im Editor, damit der Import ihn nicht wiederbelebt), ein stillgelegter mit Wert lebt auf.
 * - **Der Wiki-Wert** (↺, immer): Name, Einwohner, Oberhaupt, Region, Staat, Handelszone, Verkehrswege, Bevölkerung, Tempel, Beschreibung, Ortsgröße und Bauwerkart. Die Lage hat keine
 *   eigene Spalte: Sie ist „Region · Staat“ aus dem Schnappschuss. Die Ortsgröße trägt die Marke „geraten“ (`settlement_class_guessed`): Ein Wert aus den Kategorien ist nicht geraten, die
 *   Rücknahme stellt die Marke wieder her (`unbekanntFelder`).
 *
 * 🔴 **Der Name** ändert sich nur, wenn er nicht geleert wird, kein anderer Ort der Domäne (auch keiner ohne Lage) ihn schon trägt (der Editor warnt dort nur; die Übernahme ist vorsichtiger)
 * und keine Stätte am alten Namen hängt (`settlement_place.settlement_key`: Sie bliebe verwaist, solange sie nicht an der Kennung hängt). Sonst bleibt der Name, der Wiki-Wert wird trotzdem
 * geschrieben, und ein Befund sagt warum. Die Ortsgröße muss eine bekannte sein (`PLACE_SUBTYPES`).
 *
 * Name und Ortsgröße gehen in kein abgeleitetes Ergebnis ein, das ein Auftrag neu rechnete (Kacheln lesen die Tafel; die Kachelrevision hebt die Operation): kein Auftrag danach.
 * Die Sperre ist die des Editors (`FOR UPDATE` auf dem Ort): Ein gleichzeitiges Speichern wartet und scheitert danach an der Revision (409).
 */

const WIRKSAM = {
    name: "name",
    settlement_class: "subtype",
    einwohner: "detail.einwohner",
    lage: "detail.lage",
    oberhaupt: "detail.oberhaupt",
} as const;

const SCHNAPPSCHUSS = {
    name: "wiki_name",
    einwohner: "einwohner",
    oberhaupt: "oberhaupt",
    region_text: "region_text",
    staat_text: "staat_text",
    handelszone: "handelszone",
    verkehrswege: "verkehrswege",
    bevoelkerung: "bevoelkerung",
    tempel: "tempel",
    description: "description",
    settlement_class: "settlement_class",
    building_type: "building_type",
} as const;

const DETAIL_FELDER = ["einwohner", "lage", "oberhaupt"] as const;
type DetailFeld = (typeof DETAIL_FELDER)[number];

/** Der Schluessel zum Vergleichen von Namen unter den Orten dieses Laufs (die Datenbank vergleicht mit lower; hier genuegt der Vergleich untereinander). */
const schluesselDesNamens = (name: string): string => name.toLowerCase();

const istOrtsgroesse = (wert: string | null): boolean =>
    wert !== null && (PLACE_SUBTYPES as readonly string[]).includes(wert);

export const ortSchreiber: Schreiber = {
    bereich: "ort",
    protokollArt: "place",
    objektArt: "place",
    affectedArt: "place",
    eintragZiel: (id) => ({ placeId: id }),
    zielSpalte: "place_public_id",
    wirksameSpalten: WIRKSAM,
    schnappschussSpalten: SCHNAPPSCHUSS,
    auditNamen: { settlement_class: "subtype" },
    unbekanntFelder: new Set(["settlement_class"]),
    leitetAb: () => false,
    // Die Orts- und Bauwerk-Artikel ohne Ort (WI-0295): dieselbe Operation, eigene Fachtafel (die Registry).
    neben: ortArtikelSchreiber,

    async sperre(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; revision: number }[]>`
            SELECT public_id::text AS id, revision::int AS revision
              FROM place
             WHERE public_id = ANY(${[...ids]}::uuid[]) AND is_active
             ORDER BY public_id
               FOR UPDATE
        `;
        await tx`
            SELECT s.id
              FROM wiki_settlement_snapshot s
             WHERE s.id IN (
                       SELECT a.snapshot_id
                         FROM place_wiki_assignment a
                         JOIN place p ON p.id = a.place_id
                        WHERE p.public_id = ANY(${[...ids]}::uuid[]) AND a.is_active AND a.snapshot_id IS NOT NULL
                   )
             ORDER BY s.id
               FOR UPDATE
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.revision]));
    },

    async schnappschussIds(tx, ids) {
        if (ids.length === 0) return new Map();
        const zeilen = await tx<{ id: string; snapshot: string }[]>`
            SELECT p.public_id::text AS id, a.snapshot_id::text AS snapshot
              FROM place p
              JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active AND a.assignment_state = 'assigned'
              JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
             WHERE p.public_id = ANY(${[...ids]}::uuid[])
        `;
        return new Map(zeilen.map((zeile) => [zeile.id, zeile.snapshot]));
    },

    async pruefe(tx, schritte) {
        const befunde: BefundSchritt[] = [];
        const verworfen = new Set<FeldSchritt>();
        const bleibtNur = new Map<FeldSchritt, "snapshot">();
        const befund = (
            schritt: FeldSchritt,
            art: BefundSchritt["befund"],
            grund: string,
            feld: string | null = schritt.feld,
        ): void => {
            befunde.push({
                objektId: schritt.objekt.id,
                objektArt: "place",
                objektName: schritt.objekt.name,
                feld,
                befund: art,
                grund,
            });
        };

        // 1. Die Ortsgröße muss eine bekannte sein: ein Wert, den es nicht gibt, wird nirgends geschrieben (der Wiki-Wert hinter ↺ ebenso wenig).
        for (const schritt of schritte.filter((kandidat) => kandidat.feld === "settlement_class")) {
            const wirksamFalsch = schritt.wirksam !== undefined && !istOrtsgroesse(schritt.wirksam.nachher);
            const wikiFalsch = schritt.schnappschuss !== undefined && !istOrtsgroesse(schritt.schnappschuss.nachher);
            if (wirksamFalsch || wikiFalsch) {
                verworfen.add(schritt);
                befund(schritt, "wert_unzulaessig", "Diese Ortsgröße gibt es nicht");
            }
        }

        // 2. Der Name.
        const namen = schritte.filter(
            (schritt) => schritt.feld === "name" && schritt.wirksam !== undefined && !verworfen.has(schritt),
        );
        const ablehnen = (schritt: FeldSchritt, art: BefundSchritt["befund"], grund: string): void => {
            bleibtNur.set(schritt, "snapshot");
            befund(schritt, art, grund);
        };
        for (const schritt of namen) {
            if ((schritt.wirksam?.nachher ?? "").trim() === "")
                ablehnen(schritt, "name_leer", "Der Name wird nie geleert");
        }
        const frei = namen.filter((schritt) => !bleibtNur.has(schritt));
        if (frei.length > 0) {
            const neue = [...new Set(frei.map((schritt) => schritt.wirksam?.nachher ?? ""))];
            const ids = frei.map((schritt) => schritt.objekt.id);
            // Wer trägt den neuen Namen schon (ein anderer Ort derselben Domäne, auch einer ohne Lage)? Verglichen wird in der Datenbank (lower), wie der Editor es tut.
            const domaene = await tx<{ id: string; domain: string }[]>`
                SELECT public_id::text AS id, map_domain_id AS domain FROM place WHERE public_id = ANY(${ids}::uuid[])
            `;
            const domainVon = new Map(domaene.map((zeile) => [zeile.id, zeile.domain]));
            const traegt = await tx<{ ziel: string; id: string; domain: string }[]>`
                SELECT n.ziel, o.public_id::text AS id, o.map_domain_id AS domain
                  FROM unnest(${neue}::text[]) AS n(ziel)
                  JOIN (
                      SELECT public_id, name, map_domain_id FROM place WHERE is_active
                      UNION ALL
                      SELECT public_id, name, map_domain_id FROM place_unplaced WHERE is_active
                  ) o ON lower(o.name) = lower(n.ziel)
            `;
            for (const schritt of frei) {
                const dom = domainVon.get(schritt.objekt.id);
                const ziel = schritt.wirksam?.nachher ?? "";
                if (
                    traegt.some(
                        (zeile) => zeile.ziel === ziel && zeile.domain === dom && zeile.id !== schritt.objekt.id,
                    )
                )
                    ablehnen(schritt, "name_vergeben", "Ein anderer Ort trägt den Namen schon");
            }
            // Zwei Orte dieses Laufs auf denselben neuen Namen: keiner von beiden.
            const jeNeu = new Map<string, FeldSchritt[]>();
            for (const schritt of frei.filter((kandidat) => !bleibtNur.has(kandidat))) {
                const schluessel = `${domainVon.get(schritt.objekt.id) ?? ""}\u0000${schluesselDesNamens(schritt.wirksam?.nachher ?? "")}`;
                jeNeu.set(schluessel, [...(jeNeu.get(schluessel) ?? []), schritt]);
            }
            for (const gruppe of jeNeu.values()) {
                if (gruppe.length > 1)
                    for (const schritt of gruppe)
                        ablehnen(schritt, "name_vergeben", "Zwei Orte bekämen denselben Namen");
            }
            // Eine Stätte, die am alten Namen hängt, bliebe verwaist (`settlement_key` ist der kleingeschriebene Name).
            const alte = frei.filter((kandidat) => !bleibtNur.has(kandidat));
            if (alte.length > 0) {
                const staetten = await tx<{ alt: string }[]>`
                    SELECT DISTINCT n.alt
                      FROM unnest(${[...new Set(alte.map((schritt) => schritt.wirksam?.vorher ?? ""))]}::text[]) AS n(alt)
                      JOIN settlement_place sp ON sp.is_active AND sp.settlement_key = lower(n.alt)
                `;
                const mitStaetten = new Set(staetten.map((zeile) => zeile.alt));
                for (const schritt of alte) {
                    if (mitStaetten.has(schritt.wirksam?.vorher ?? ""))
                        ablehnen(schritt, "name_gesperrt", "Stätten hängen noch am alten Namen");
                }
            }
        }

        const bleibt = schritte.flatMap((schritt): FeldSchritt[] => {
            if (verworfen.has(schritt)) return [];
            if (!bleibtNur.has(schritt)) return [schritt];
            return schritt.schnappschuss === undefined
                ? []
                : [{ objekt: schritt.objekt, feld: schritt.feld, schnappschuss: schritt.schnappschuss }];
        });
        return { schritte: bleibt, befunde };
    },

    async schreibeObjekt(tx, id, spalten) {
        const ort: Record<string, string | null> = {};
        const detail: Partial<Record<DetailFeld, string | null>> = {};
        for (const [spalte, wert] of Object.entries(spalten)) {
            if (spalte.startsWith("detail.")) detail[spalte.slice("detail.".length) as DetailFeld] = wert;
            else ort[spalte] = wert;
        }
        if (Object.keys(detail).length > 0) await schreibeDetail(tx, id, detail);
        const namen = Object.keys(ort);
        const [zeile] =
            namen.length === 0
                ? await tx<{ revision: number }[]>`
                      UPDATE place SET revision = revision WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `
                : await tx<{ revision: number }[]>`
                      UPDATE place SET ${tx(ort, ...namen)}, revision = revision
                       WHERE public_id = ${id}::uuid AND is_active RETURNING revision::int AS revision
                  `;
        if (zeile === undefined) throw new Error(`Ort ${id}: nicht zu schreiben (nicht gesperrt oder nicht aktiv)`);
        return zeile.revision;
    },

    async schreibeSchnappschuss(tx, schnappschussId, spalten, marken) {
        const namen = Object.keys(spalten);
        if (namen.length > 0) {
            await tx`
                UPDATE wiki_settlement_snapshot SET ${tx(spalten as Record<string, string | null>, ...namen)}, updated_at = now()
                 WHERE id = ${schnappschussId}::bigint
            `;
        }
        // Die Marke "geraten": Ein Wert aus den Kategorien ist nicht geraten; die Ruecknahme stellt die Marke wieder her.
        if (marken?.bekannt.includes("settlement_class") === true) {
            await tx`UPDATE wiki_settlement_snapshot SET settlement_class_guessed = FALSE, updated_at = now() WHERE id = ${schnappschussId}::bigint`;
        } else if (marken?.unbekannt.includes("settlement_class") === true) {
            await tx`UPDATE wiki_settlement_snapshot SET settlement_class_guessed = TRUE, updated_at = now() WHERE id = ${schnappschussId}::bigint`;
        }
    },
};

/**
 * Die Einzelheiten eines Orts nach der Übernahme: Wert und Herkunft je Spalte (ein Wert aus dem Wiki trägt `wiki`, ein entfallener keine Herkunft), der Satz still gelegt, wenn kein Feld mehr
 * einen Wert trägt. Es gibt nichts zu schreiben, wo der Ort keinen Satz hat: Ohne Satz gibt es keinen eigenen Wert, dem etwas folgt.
 */
async function schreibeDetail(
    tx: Queryable,
    ortId: string,
    felder: Partial<Record<DetailFeld, string | null>>,
): Promise<void> {
    const [satz] = await tx<
        {
            id: string;
            description: string | null;
            einwohner: string | null;
            lage: string | null;
            oberhaupt: string | null;
        }[]
    >`
        SELECT d.id::text AS id, d.description, d.einwohner, d.lage, d.oberhaupt
          FROM place_detail d JOIN place p ON p.id = d.place_id
         WHERE p.public_id = ${ortId}::uuid
           FOR UPDATE OF d
    `;
    if (satz === undefined) return;
    const naechste = { einwohner: satz.einwohner, lage: satz.lage, oberhaupt: satz.oberhaupt };
    const herkunft: Record<DetailFeld, string | null | undefined> = {
        einwohner: undefined,
        lage: undefined,
        oberhaupt: undefined,
    };
    for (const feld of DETAIL_FELDER) {
        if (!(feld in felder)) continue;
        const wert = felder[feld] ?? null;
        const text = wert === null || wert.trim() === "" ? null : wert;
        naechste[feld] = text;
        herkunft[feld] = text === null ? null : "wiki";
    }
    const leer =
        satz.description === null &&
        naechste.einwohner === null &&
        naechste.lage === null &&
        naechste.oberhaupt === null;
    await tx`
        UPDATE place_detail SET
            einwohner = ${naechste.einwohner}, lage = ${naechste.lage}, oberhaupt = ${naechste.oberhaupt},
            einwohner_origin = CASE WHEN ${herkunft.einwohner !== undefined} THEN ${herkunft.einwohner ?? null} ELSE einwohner_origin END,
            lage_origin = CASE WHEN ${herkunft.lage !== undefined} THEN ${herkunft.lage ?? null} ELSE lage_origin END,
            oberhaupt_origin = CASE WHEN ${herkunft.oberhaupt !== undefined} THEN ${herkunft.oberhaupt ?? null} ELSE oberhaupt_origin END,
            is_active = ${!leer},
            retired_at = ${leer ? new Date() : null},
            retired_origin = ${leer ? "editor" : null},
            updated_at = now()
         WHERE id = ${satz.id}::bigint
    `;
}
