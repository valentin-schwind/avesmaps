import {
    INHALTE_VORKOMMEN_BEDINGUNGEN_MAX,
    WIKISYNC_KLIMAZONEN,
    WIKISYNC_LAGE_ORTSARTEN,
    WIKISYNC_LANDSCHAFTSARTEN,
    type InhalteVorkommenBedingung,
    type InhalteVorkommenRegelAenderung,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import { ApiError } from "../http/api-error.ts";
import { lageProtokoll, ruleKeyOf, type RuleTermKeyInput } from "../migration/lore-keys.ts";
import { titelAusWikiAdresse } from "../wiki/vorschau/adresse.ts";
import { ladeKetten, leseVorschlagRoh, titelNorm, type VorschlagRoh } from "./vorkommen-regeln-lesen.ts";

/**
 * Das Schreiben der Regeln eines Vorkommens (WI-0254 `--weiter`, Regeleditor im Reiter „Vorkommen“, Paket R; Bezug WI-0253 §26): ein Teil von `lore.update`, aufgerufen unter der Sperre des Eintrags
 * in derselben Operation wie Stammdaten, Ortszeilen und Quellen (`vorkommen-schreiben.ts`). Der Vertrag steht in `packages/shared/src/inhalte-vorkommen.ts` (`InhalteVorkommenRegelAenderung`).
 *
 * - 🔴 **Ändern heißt neu anlegen und die alte still legen:** Die App darf an `lore_rule` nur anlegen und die fünf Spalten des Zustands ändern (`map-grants.psql`), an Bedingungen und Arten nur anlegen,
 *   nie löschen. `add` mit `ersetzt` legt die neue Regel an und die genannte still (`retired`); `remove` legt still, nie weg: eine Regel aus Legacy oder dem WikiSync wird unterdrückt (`suppressed`),
 *   eine eigene gelöst (`retired`), beides mit `retired_origin = editor`.
 * - 🔴 **Der Fingerabdruck ist der der Ableitung:** `ruleKeyOf` über Eintragsschlüssel (`lore_entry.wiki_key`, ohne Artikel `avesmaps:<public_id>`), Beziehung und die geordnete Kette (Fläche als
 *   `region.public_id`, eine wartende Fläche als `wiki:<titel klein>`), genau wie `regelSchluessel` in `wiki/regeln/ableiten.ts`. Darum ist eine übernommene Wiki-Regel nach dem Speichern dieselbe Regel,
 *   die die nächste Ableitung als „gleich“ erkennt, und derselbe Fingerabdruck belebt eine still gelegte Zeile statt eine zweite anzulegen (`UNIQUE (lore_entry_id, rule_key)` zählt stille mit).
 * - **Die Herkunft folgt dem Fingerabdruck:** Ist er der des jüngsten Vorschlags für Eintrag und Beziehung, ist die Regel eine Wiki-Regel (`legacy_origin = wiki_verbreitung`, der WikiSync führt sie
 *   weiter); sonst eine Regel von Hand (`manual`) und der WikiSync fasst die Beziehung nicht an. Eine Regel von Hand merkt sich die Wiki-Fassung, von der sie ausging (`wiki_basis_key`, Migration 0249).
 * - 🔴 **Nur die Regel gehört der Redaktion, nicht der Eintrag** (Entscheidung Claudia zu WI-0253 §26, Vali: Regeln wiederherstellbar): Dieser Weg setzt `lore_entry.source_system` nicht. Die Regel
 *   trägt `source_system = editor` und `retired_origin = editor`; den Schutz davor, dass der Legacy-Zug oder der WikiSync sie überschreibt, leisten `ruleSpec.protectedWhere` und `uebernehmen.ts`.
 * - Geprüft wird alles hier, nicht in der Oberfläche (400 `validation_failed` mit dem Pfad, `regel_besteht` für eine Regel, die es schon gibt): 1 bis 25 Bedingungen, keine leer, Arten und Klimazonen
 *   aus den Tafeln, die Fläche eine aktive Landschaft außerhalb der Klima-Ebene, `flaeche` und `wartetAuf` schließen sich aus, `wartetAuf` nur mit einem Titel, den der Eintrag schon kennt. Was die
 *   ersetzte Regel schon trug (eine Kennung aus Legacy, eine Art außerhalb der Tafel), darf in der neuen bleiben, damit sich eine Regel aus Legacy ändern lässt.
 * - **Die Lage zu einer Linie** (WI-0254, Migration 0250): `lage` nennt die Richtung und ein oder zwei Orte als `place.public_id`. Jeder Ort muss eine AKTIVE SIEDLUNG sein (`WIKISYNC_LAGE_ORTSARTEN`, nicht Gebäude
 *   oder Stadtviertel) und darf nur einmal stehen; auch hier darf ein Ort bleiben, den die ersetzte Regel schon trug (er kann seither still gelegt oder umgewidmet sein). Eine Bedingung nur mit Lage ist gültig
 *   („alles südlich von …“). Die Lage geht als sechstes Feld in den Fingerabdruck ein (Orte sortiert: A–B ist B–A, `lageSchluessel`), im Protokoll als `lage: "sued:<kennung>/<kennung>"` und in die drei
 *   Spalten `line_direction`, `line_place_a_id`, `line_place_b_id`; ohne Lage bleibt alles wie vor 0250 (Fingerabdruck byte-gleich, kein Feld im Protokoll).
 */

export const fehlerbild = (pfad: string, regel: string, satz: string): ApiError =>
    new ApiError(400, "validation_failed", satz, { issues: [{ path: pfad, rule: regel }] });

export interface RegelZeile {
    id: string;
    relation: string;
    rule_key: string;
    sort_order: number;
    legacy_origin: string;
    state: string;
    source_system: string;
    retired_origin: string | null;
    wiki_basis_key: string | null;
}

/** Eine Regel im Fachprotokoll (`changes.rules`): wer sie ist, in welchem Zustand und was sie sagt. */
export interface RegelProtokoll {
    ruleId: string;
    relation: string;
    ruleKey: string;
    state: string;
    ursprung: string;
    bedingungen: {
        verknuepfung: string;
        flaeche: string | null;
        arten: string;
        klima: string | null;
        /** `richtung:kennung/kennung` (Kennungen klein, sortiert); fehlt, wo die Bedingung keine Lage hat. */
        lage?: string;
    }[];
}

/** Die Lage einer geprüften Bedingung: die Richtung, die Orte als `place.id` (in der Reihenfolge des Körpers: A, B) und als `place.public_id` (klein). */
interface TermLage {
    richtung: string;
    ortIds: string[];
    kennungen: string[];
}

/** Eine geprüfte Bedingung, bereit zum Schreiben und Rechnen des Fingerabdrucks. */
interface Term {
    joinOp: "und" | "oder" | "ohne";
    areaRegionId: string | null;
    legacyKennung: string | null;
    wartetTitel: string | null;
    /** Die Fläche, wie sie in den Fingerabdruck geht: `region.public_id` oder `wiki:<titel klein>`. */
    kennungFuerSchluessel: string | null;
    von: string | null;
    bis: string | null;
    arten: { ebene: string; art: string }[];
    lage: TermLage | null;
}

const ARTEN: ReadonlySet<string> = new Set(WIKISYNC_LANDSCHAFTSARTEN.map((a) => `${a.ebene}|${a.art}`));
/** Die Ebenen, die `lore_rule_term_type_layer_known` zulässt (die Prüfung der Tafel, nicht die Tafel unserer Arten). */
const EBENEN: ReadonlySet<string> = new Set(["derographisch", "vegetation", "topographie", "klima"]);
const ZONEN: readonly string[] = WIKISYNC_KLIMAZONEN;
const UUID_KLEIN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const protokollBedingung = (
    verknuepfung: string,
    flaeche: string | null,
    arten: readonly { ebene: string; art: string }[],
    von: string | null,
    bis: string | null,
    lage: { richtung: string; kennungen: readonly string[] } | null = null,
): RegelProtokoll["bedingungen"][number] => ({
    verknuepfung,
    flaeche,
    arten: arten.map((a) => `${a.ebene}/${a.art}`).join(","),
    klima: von === null || bis === null ? null : `${von}-${bis}`,
    ...(lage === null ? {} : { lage: lageProtokoll({ richtung: lage.richtung, orte: lage.kennungen }) }),
});

function protokollAusKette(
    regel: Pick<RegelZeile, "id" | "relation" | "rule_key" | "legacy_origin">,
    state: string,
    kette: readonly InhalteVorkommenBedingung[],
): RegelProtokoll {
    return {
        ruleId: regel.id,
        relation: regel.relation,
        ruleKey: regel.rule_key,
        state,
        ursprung: regel.legacy_origin,
        bedingungen: kette.map((b) =>
            protokollBedingung(
                b.joinOp,
                b.flaeche?.kennung ?? (b.wartetAuf === undefined ? null : `wiki:${b.wartetAuf}`),
                b.arten,
                b.klima?.von ?? null,
                b.klima?.bis ?? null,
                b.lage === undefined
                    ? null
                    : { richtung: b.lage.richtung, kennungen: b.lage.orte.map((ort) => ort.kennung) },
            ),
        ),
    };
}

/** Was das Stilllegen und Beleben einer Regel von ihr braucht (und im Speicher nachführen): die Nummer und der Zustand. */
export type RegelZustand = Pick<RegelZeile, "id" | "state" | "retired_origin">;

export async function stilllegen(tx: Sql, regel: RegelZustand, neuerState: "retired" | "suppressed"): Promise<void> {
    await tx`
        UPDATE lore_rule
           SET state = ${neuerState}, is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
         WHERE id = ${regel.id}::bigint
    `;
    regel.state = neuerState;
    regel.retired_origin = "editor";
}

export async function beleben(tx: Sql, regel: RegelZustand): Promise<void> {
    await tx`
        UPDATE lore_rule
           SET state = 'active', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
         WHERE id = ${regel.id}::bigint
    `;
    regel.state = "active";
    regel.retired_origin = null;
}

/**
 * Die Regeländerungen eines Körpers anwenden, in der Transaktion und unter der Sperre des Eintrags (`FOR UPDATE`); gibt vorher und nachher der berührten Regeln zurück, `undefined`, wo nichts geschah.
 * `eintrag.id` ist die interne Nummer, `eintrag.wikiKey` der Schlüssel des Eintrags (`null` ohne Wiki-Artikel).
 */
export async function wendeRegelnAn(
    tx: Sql,
    eintrag: { id: string; publicId: string; wikiKey: string | null },
    aenderungen: readonly InhalteVorkommenRegelAenderung[],
): Promise<{ vorher: RegelProtokoll[]; nachher: RegelProtokoll[] } | undefined> {
    if (aenderungen.length === 0) return undefined;
    // Alle Regeln des Eintrags in jedem Zustand: Der Fingerabdruck einer still gelegten belebt die Zeile, statt eine zweite anzulegen.
    const bestand = await tx<RegelZeile[]>`
        SELECT id::text AS id, relation, rule_key, sort_order::int AS sort_order, legacy_origin, state, source_system, retired_origin, wiki_basis_key
          FROM lore_rule WHERE lore_entry_id = ${eintrag.id}::bigint ORDER BY id
    `;
    const vorschlag = await leseVorschlagRoh(tx, eintrag.id);
    const eintragsSchluessel = eintrag.wikiKey ?? `avesmaps:${eintrag.publicId}`;
    const vorher: RegelProtokoll[] = [];
    const nachher: RegelProtokoll[] = [];
    const findeRegel = (id: string): RegelZeile | undefined => bestand.find((regel) => regel.id === id);
    let bekannteTitel: Map<string, string> | undefined;
    let titelMitFlaeche: Set<string> | undefined;

    for (const [index, aenderung] of aenderungen.entries()) {
        const pfad = `regeln.${String(index)}`;
        if (aenderung.op === "remove") {
            const regel = findeRegel(aenderung.ruleId);
            if (regel === undefined) {
                throw fehlerbild(
                    `${pfad}.ruleId`,
                    "unknown",
                    "Diese Regel gibt es nicht mehr; der Stand ist veraltet.",
                );
            }
            if (regel.state !== "active")
                throw fehlerbild(`${pfad}.ruleId`, "state", "Diese Regel ist schon still gelegt.");
            const kette = (await ladeKetten(tx, [regel.id])).get(regel.id) ?? [];
            // Eine Regel aus Legacy oder dem WikiSync wird unterdrückt (der Zug und die Übernahme beleben sie nie wieder), eine eigene gelöst.
            const neuerState = regel.source_system === "editor" ? "retired" : "suppressed";
            await stilllegen(tx, regel, neuerState);
            vorher.push(protokollAusKette(regel, "active", kette));
            nachher.push(protokollAusKette(regel, neuerState, kette));
            continue;
        }

        // ---- add ------------------------------------------------------------------------------------------------------------------
        if (aenderung.bedingungen.length < 1 || aenderung.bedingungen.length > INHALTE_VORKOMMEN_BEDINGUNGEN_MAX) {
            throw fehlerbild(
                `${pfad}.bedingungen`,
                "size",
                `Eine Regel hat 1 bis ${String(INHALTE_VORKOMMEN_BEDINGUNGEN_MAX)} Bedingungen.`,
            );
        }
        let ersetzt: RegelZeile | undefined;
        let ersetzteKette: InhalteVorkommenBedingung[] = [];
        if (aenderung.ersetzt !== undefined) {
            ersetzt = findeRegel(aenderung.ersetzt);
            if (ersetzt === undefined) {
                throw fehlerbild(
                    `${pfad}.ersetzt`,
                    "unknown",
                    "Diese Regel gibt es nicht mehr; der Stand ist veraltet.",
                );
            }
            if (ersetzt.state !== "active") {
                throw fehlerbild(`${pfad}.ersetzt`, "state", "Diese Regel ist schon still gelegt.");
            }
            ersetzteKette = (await ladeKetten(tx, [ersetzt.id])).get(ersetzt.id) ?? [];
        }
        // Was die ersetzte Regel schon trug, darf bleiben, auch wenn es die Tafeln nicht (mehr) kennen (eine Kennung aus Legacy, eine Art außerhalb der Tafel).
        const trugKennungen = new Set(
            ersetzteKette.flatMap((b) => (b.flaeche === undefined ? [] : [b.flaeche.kennung.toLowerCase()])),
        );
        const trugArten = new Set(ersetzteKette.flatMap((b) => b.arten.map((a) => `${a.ebene}|${a.art}`)));
        // Ein Ort der Linie, den die ersetzte Regel schon trug, darf bleiben, auch wenn er inzwischen still gelegt oder keine Siedlung mehr ist.
        const trugOrte = new Set(
            ersetzteKette.flatMap((b) => b.lage?.orte.map((ort) => ort.kennung.toLowerCase()) ?? []),
        );

        // Erst die Felder, dann die Flächen (eine Abfrage für alle).
        const roh = aenderung.bedingungen.map((b, j) => {
            const bp = `${pfad}.bedingungen.${String(j)}`;
            const arten: { ebene: string; art: string }[] = [];
            for (const a of b.arten) {
                const schluessel = `${a.ebene}|${a.art}`;
                const bekannt =
                    ARTEN.has(schluessel) || (trugArten.has(schluessel) && EBENEN.has(a.ebene) && a.art.trim() !== "");
                if (!bekannt) throw fehlerbild(`${bp}.arten`, "enum", "Diese Landschaftsart gibt es nicht.");
                if (!arten.some((eine) => eine.ebene === a.ebene && eine.art === a.art))
                    arten.push({ ebene: a.ebene, art: a.art });
            }
            let von: string | null = null;
            let bis: string | null = null;
            if (b.klima !== undefined) {
                const vonIndex = ZONEN.indexOf(b.klima.von);
                const bisIndex = ZONEN.indexOf(b.klima.bis);
                if (vonIndex < 0 || bisIndex < 0)
                    throw fehlerbild(`${bp}.klima`, "enum", "Diese Klimazone gibt es nicht.");
                if (vonIndex > bisIndex) {
                    throw fehlerbild(
                        `${bp}.klima`,
                        "order",
                        "Die Klimaspanne geht von der kälteren zur wärmeren Zone.",
                    );
                }
                von = b.klima.von;
                bis = b.klima.bis;
            }
            if (b.flaeche !== undefined && b.wartetAuf !== undefined) {
                throw fehlerbild(
                    bp,
                    "exclusive",
                    "Eine Bedingung nennt eine Fläche oder wartet auf einen Artikel, nicht beides.",
                );
            }
            if (b.flaeche !== undefined && !UUID_KLEIN.test(b.flaeche)) {
                throw fehlerbild(`${bp}.flaeche`, "format", "Diese Kennung ist keine Kennung einer Fläche.");
            }
            if (b.wartetAuf !== undefined && titelNorm(b.wartetAuf) === "") {
                throw fehlerbild(`${bp}.wartetAuf`, "required", "Der Titel des Artikels fehlt.");
            }
            if (b.lage !== undefined) {
                if (b.lage.orte.length < 1 || b.lage.orte.length > 2) {
                    throw fehlerbild(`${bp}.lage.orte`, "size", "Eine Linie läuft durch einen oder zwei Orte.");
                }
                for (const [k, kennung] of b.lage.orte.entries()) {
                    if (!UUID_KLEIN.test(kennung)) {
                        throw fehlerbild(
                            `${bp}.lage.orte.${String(k)}`,
                            "format",
                            "Diese Kennung ist keine Kennung eines Ortes.",
                        );
                    }
                }
                if (new Set(b.lage.orte).size !== b.lage.orte.length) {
                    throw fehlerbild(`${bp}.lage.orte`, "duplicate", "Ein Ort steht nur einmal in der Linie.");
                }
            }
            // Eine Lage zählt wie Fläche, Art und Klima: „alles südlich von …“ ist eine Bedingung, die etwas sagt.
            if (
                arten.length === 0 &&
                von === null &&
                b.flaeche === undefined &&
                b.wartetAuf === undefined &&
                b.lage === undefined
            ) {
                throw fehlerbild(bp, "required", "Eine Bedingung ohne Fläche, Art, Klima und Lage träfe alles.");
            }
            return { bp, b, arten, von, bis };
        });

        const kennungen = [...new Set(roh.flatMap(({ b }) => (b.flaeche === undefined ? [] : [b.flaeche])))];
        const regionen =
            kennungen.length === 0
                ? []
                : await tx<{ id: string; public_id: string; is_active: boolean; region_layer: string }[]>`
                      SELECT id::text AS id, public_id::text AS public_id, is_active, region_layer FROM region WHERE public_id = ANY(${kennungen}::uuid[])
                  `;
        const regionNachKennung = new Map(regionen.map((r) => [r.public_id, r]));

        const ortKennungen = [...new Set(roh.flatMap(({ b }) => b.lage?.orte ?? []))];
        const orte =
            ortKennungen.length === 0
                ? []
                : await tx<{ id: string; public_id: string; is_active: boolean; subtype: string }[]>`
                      SELECT id::text AS id, public_id::text AS public_id, is_active, subtype FROM place WHERE public_id = ANY(${ortKennungen}::uuid[])
                  `;
        const ortNachKennung = new Map(orte.map((o) => [o.public_id, o]));

        const terme: Term[] = [];
        for (const { bp, b, arten, von, bis } of roh) {
            const term: Term = {
                joinOp: b.verknuepfung,
                areaRegionId: null,
                legacyKennung: null,
                wartetTitel: null,
                kennungFuerSchluessel: null,
                von,
                bis,
                arten,
                lage: null,
            };
            if (b.lage !== undefined) {
                const lage: TermLage = { richtung: b.lage.richtung, ortIds: [], kennungen: [] };
                for (const [k, kennung] of b.lage.orte.entries()) {
                    const ort = ortNachKennung.get(kennung);
                    const op = `${bp}.lage.orte.${String(k)}`;
                    if (ort === undefined) throw fehlerbild(op, "unknown", "Diesen Ort gibt es nicht.");
                    // Was die ersetzte Regel schon nannte, bleibt, wie es war (der Ort kann seither still gelegt oder umgewidmet sein).
                    if (!trugOrte.has(kennung)) {
                        if (!ort.is_active) throw fehlerbild(op, "state", "Dieser Ort ist still gelegt.");
                        if (!(WIKISYNC_LAGE_ORTSARTEN as readonly string[]).includes(ort.subtype)) {
                            throw fehlerbild(
                                op,
                                "kind",
                                "An einer Linie steht eine Siedlung (Metropole bis Dorf), kein Gebäude und kein Stadtviertel.",
                            );
                        }
                    }
                    lage.ortIds.push(ort.id);
                    lage.kennungen.push(ort.public_id);
                }
                term.lage = lage;
            }
            if (b.flaeche !== undefined) {
                const region = regionNachKennung.get(b.flaeche);
                if (region !== undefined && region.is_active && region.region_layer !== "klima") {
                    term.areaRegionId = region.id;
                    term.kennungFuerSchluessel = region.public_id;
                } else if (trugKennungen.has(b.flaeche)) {
                    // Die ersetzte Regel nannte diese Fläche schon (eine inzwischen stille oder eine Kennung aus Legacy ohne Zeile): Sie bleibt, wie sie war.
                    if (region === undefined) term.legacyKennung = b.flaeche;
                    else term.areaRegionId = region.id;
                    term.kennungFuerSchluessel = b.flaeche;
                } else if (region === undefined) {
                    throw fehlerbild(`${bp}.flaeche`, "unknown", "Diese Fläche gibt es nicht.");
                } else if (region.region_layer === "klima") {
                    throw fehlerbild(
                        `${bp}.flaeche`,
                        "layer",
                        "Ein Klimaband ist keine Fläche für eine Regel; die Klimaspanne steht in der Bedingung selbst.",
                    );
                } else {
                    throw fehlerbild(`${bp}.flaeche`, "state", "Diese Fläche ist still gelegt.");
                }
            }
            if (b.wartetAuf !== undefined) {
                bekannteTitel ??= await ladeBekannteTitel(tx, eintrag.id, vorschlag);
                const titel = bekannteTitel.get(titelNorm(b.wartetAuf));
                if (titel === undefined) {
                    throw fehlerbild(
                        `${bp}.wartetAuf`,
                        "unknown",
                        "Auf diesen Artikel wartet der Eintrag nicht; eine wartende Fläche kommt nur aus einer Regel des Eintrags oder dem Vorschlag des Wikis.",
                    );
                }
                titelMitFlaeche ??= await ladeTitelMitFlaeche(tx);
                if (titelMitFlaeche.has(titelNorm(titel))) {
                    throw fehlerbild(
                        `${bp}.wartetAuf`,
                        "state",
                        "Diesen Artikel trägt inzwischen eine Fläche der Karte; bitte die Fläche wählen.",
                    );
                }
                term.wartetTitel = titel;
                term.kennungFuerSchluessel = `wiki:${titel.toLowerCase()}`;
            }
            terme.push(term);
        }

        const schluesselTerme: RuleTermKeyInput[] = terme.map((t, seq) => ({
            joinOp: seq === 0 ? "und" : t.joinOp,
            areaPublicId: t.kennungFuerSchluessel,
            climateFrom: t.von,
            climateTo: t.bis,
            types: t.arten.map((a) => ({ layer: a.ebene, type: a.art })),
            // Die Lage geht nur ein, wo es eine gibt (sechstes Feld, Orte sortiert): sonst bleibt der Fingerabdruck wie vor 0250.
            ...(t.lage === null ? {} : { lage: { richtung: t.lage.richtung, orte: t.lage.kennungen } }),
        }));
        const schluessel = ruleKeyOf(eintragsSchluessel, aenderung.relation, schluesselTerme);

        // Die Wiki-Fassung, von der die Regel ausgeht (`wikiBasis`), nur eine, die der Eintrag kennt: der Vorschlag oder eine Wiki-Regel des Eintrags.
        if (aenderung.wikiBasis !== undefined) {
            const vomVorschlag = vorschlag?.regeln.some((eine) => eine.schluessel === aenderung.wikiBasis) === true;
            const vonRegel = bestand.some(
                (regel) => regel.rule_key === aenderung.wikiBasis && regel.legacy_origin === "wiki_verbreitung",
            );
            if (!vomVorschlag && !vonRegel) {
                throw fehlerbild(`${pfad}.wikiBasis`, "unknown", "Diese Wiki-Fassung kennt der Eintrag nicht.");
            }
        }

        const vorhanden = bestand.find((regel) => regel.rule_key === schluessel);
        if (vorhanden?.state === "active") {
            // Dieselbe Kette wie die ersetzte Regel: nichts zu ändern. Jede andere aktive Regel mit diesem Fingerabdruck gibt es schon.
            if (ersetzt !== undefined && ersetzt.id === vorhanden.id) continue;
            throw new ApiError(400, "regel_besteht", "Diese Regel gibt es schon.", {
                issues: [{ path: pfad, rule: "regel_besteht" }],
            });
        }

        let neu: RegelZeile;
        if (vorhanden !== undefined) {
            // Eine still gelegte Zeile mit demselben Fingerabdruck lebt wieder auf (die Wiki-Fassung wiederherstellen, eine gelöschte Regel zurückholen); sie behält ihre Herkunft.
            const davor = vorhanden.state;
            await beleben(tx, vorhanden);
            neu = vorhanden;
            vorher.push(protokollAusKette(vorhanden, davor, []));
        } else {
            const herkunftWiki =
                vorschlag?.regeln.some(
                    (eine) => eine.beziehung === aenderung.relation && eine.schluessel === schluessel,
                ) === true;
            let basis: string | null = null;
            if (!herkunftWiki) {
                // Die Fassung, von der die Person ausging, geht vor: Wer einen Vorschlag bearbeitet, der eine Wiki-Regel ersetzt, beruht auf dem
                // Vorschlag, nicht auf der alten Regel (sonst stünde sofort „Wiki geändert“ an der neuen Regel; Entwurf `uebernehmeRegel`).
                basis =
                    aenderung.wikiBasis ??
                    (ersetzt?.legacy_origin === "wiki_verbreitung"
                        ? ersetzt.rule_key
                        : (ersetzt?.wiki_basis_key ?? null));
            }
            const sortierung = ersetzt?.sort_order ?? Math.max(-1, ...bestand.map((regel) => regel.sort_order)) + 1;
            const [angelegt] = await tx<{ id: string }[]>`
                INSERT INTO lore_rule (lore_entry_id, rule_key, relation, sort_order, legacy_origin, state, source_system, is_active, wiki_basis_key)
                VALUES (${eintrag.id}::bigint, ${schluessel}, ${aenderung.relation}, ${sortierung}, ${herkunftWiki ? "wiki_verbreitung" : "manual"},
                        'active', 'editor', TRUE, ${basis})
                RETURNING id::text AS id
            `;
            const regelId = angelegt!.id;
            neu = {
                id: regelId,
                relation: aenderung.relation,
                rule_key: schluessel,
                sort_order: sortierung,
                legacy_origin: herkunftWiki ? "wiki_verbreitung" : "manual",
                state: "active",
                source_system: "editor",
                retired_origin: null,
                wiki_basis_key: basis,
            };
            bestand.push(neu);
            for (const [seq, t] of terme.entries()) {
                const [term] = await tx<{ id: string }[]>`
                    INSERT INTO lore_rule_term (lore_rule_id, seq, join_op, area_region_id, legacy_area_public_id, wiki_area_title, climate_from, climate_to,
                                                line_direction, line_place_a_id, line_place_b_id)
                    VALUES (${regelId}::bigint, ${seq}, ${seq === 0 ? "und" : t.joinOp}, ${t.areaRegionId}::bigint, ${t.legacyKennung}, ${t.wartetTitel},
                            ${t.von}, ${t.bis}, ${t.lage?.richtung ?? null}, ${t.lage?.ortIds[0] ?? null}::bigint, ${t.lage?.ortIds[1] ?? null}::bigint)
                    RETURNING id::text AS id
                `;
                for (const art of t.arten) {
                    await tx`
                        INSERT INTO lore_rule_term_type (lore_rule_term_id, region_layer, region_type)
                        VALUES (${term!.id}::bigint, ${art.ebene}, ${art.art})
                    `;
                }
            }
        }
        nachher.push({
            ruleId: neu.id,
            relation: neu.relation,
            ruleKey: neu.rule_key,
            state: "active",
            ursprung: neu.legacy_origin,
            bedingungen: terme.map((t, seq) =>
                protokollBedingung(
                    seq === 0 ? "und" : t.joinOp,
                    t.kennungFuerSchluessel,
                    t.arten,
                    t.von,
                    t.bis,
                    t.lage === null ? null : { richtung: t.lage.richtung, kennungen: t.lage.kennungen },
                ),
            ),
        });
        if (ersetzt !== undefined && ersetzt.id !== neu.id) {
            await stilllegen(tx, ersetzt, "retired");
            vorher.push(protokollAusKette(ersetzt, "active", ersetzteKette));
            nachher.push(protokollAusKette(ersetzt, "retired", ersetzteKette));
        }
    }
    return vorher.length === 0 && nachher.length === 0 ? undefined : { vorher, nachher };
}

/**
 * Die Titel der Wiki-Artikel, auf die dieser Eintrag schon wartet: in einer seiner Regeln (jeder Zustand) oder im Vorschlag des WikiSync (eine offene Fläche). Schlüssel ist die Schreibweise
 * der Ableitung (`titelNorm`), Wert der Titel, wie er dort steht.
 */
async function ladeBekannteTitel(
    tx: Sql,
    eintragId: string,
    vorschlag: VorschlagRoh | undefined,
): Promise<Map<string, string>> {
    const titel = new Map<string, string>();
    const zeilen = await tx<{ titel: string }[]>`
        SELECT DISTINCT t.wiki_area_title AS titel
          FROM lore_rule_term t JOIN lore_rule r ON r.id = t.lore_rule_id
         WHERE r.lore_entry_id = ${eintragId}::bigint AND t.wiki_area_title IS NOT NULL
    `;
    for (const zeile of zeilen) titel.set(titelNorm(zeile.titel), zeile.titel);
    for (const regel of vorschlag?.regeln ?? []) {
        for (const b of regel.bedingungen) {
            const offen = b.flaeche;
            if (offen === null || !offen.offen) continue;
            const text = offen.titel ?? offen.name;
            if (titelNorm(text) !== "" && !titel.has(titelNorm(text))) titel.set(titelNorm(text), text);
        }
    }
    return titel;
}

/** Die Wiki-Titel, die inzwischen eine Fläche der Karte trägt (wie die Übernahme der Vorschläge sie prüft): Auf sie wartet keine Regel mehr. */
async function ladeTitelMitFlaeche(tx: Sql): Promise<Set<string>> {
    const titel = new Set<string>();
    for (const zeile of await tx<{ wiki_url: string }[]>`
        SELECT wiki_url FROM region WHERE is_active AND wiki_url IS NOT NULL AND region_layer <> 'klima'
    `) {
        const eins = titelAusWikiAdresse(zeile.wiki_url);
        if (eins !== null) titel.add(titelNorm(eins));
    }
    return titel;
}
