import {
    INHALTE_WERK_ROLLEN,
    type InhalteWerkFelder,
    type InhalteWerkOrtEintrag,
    type RuecknahmeBody,
    type RuecknahmePruefung,
    type RuecknahmeReceipt,
    type RuecknahmeVorschauBody,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { schreibeWerkAendern, type WerkRuecknahme } from "../inhalte/werke-schreiben.ts";
import { eintraegeNachKennung } from "./history.ts";
import type { MapActor } from "./map-operation.ts";
import type { RuecknahmeSchreiben } from "./ruecknahme-ablauf.ts";
import { RUECKNAHME_WERK_OPERATION, WERK_OPERATIONEN } from "./ruecknahme-arten.ts";
import {
    gleichWert,
    inhalteFamilie,
    mitGrund,
    nichtRuecknehmbar,
    planAusEintraegen,
    ruecknehmenInhalte,
    vorschauInhalte,
    zielFelder,
    zusammenfassung,
    type InhaltePlan,
} from "./ruecknahme-inhalte.ts";
import type { RuecknahmeAdapter, RuecknahmeLeser, VorKonflikt } from "./ruecknahme.ts";

/**
 * Werke der Spielliteratur zurücknehmen (WI-0265 B6g1; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, F.1, Gate 2 und 3; Testvertrag U4 bis U9): der
 * Adapter des Werks für die Vorprüfung (`ruecknahme.ts`), die Vorschau und die Rücknahme in EINER Operation `work.restore_series` (Quelle `restore`, `reverts` = die offenen Mitglieder in
 * Serienfolge; Ablauf, Fehler und Naht der Inhalte in `ruecknahme-ablauf.ts` und `ruecknahme-inhalte.ts`). Die Route hängt an EINEM Werk (`:id`); jedes Mitglied berührt es.
 *
 * 🔴 **Was zurückgeht** (`work.update` und die Rücknahme selbst): Titel, Art, Auflage, Reihe, Jahr (samt der Jahresangabe in Worten, die das Ändern des Jahres löschte), Genre, „offiziell“,
 * Notiz, Stillgelegt und die Ortsliste. Die Ortsliste hält das Protokoll vollständig fest (die aktiven Zeilen vorher und nachher mit Nummer, Name und Rolle in ihrer Reihenfolge): Die Rücknahme
 * setzt GENAU diese Liste, über denselben Schreibweg wie das Ändern (`schreibeWerkAendern`, `orte` mit den Nummern der Zeilen). Eine Zeile, die die Operation stilllegte, kommt zurück (dieselbe
 * Zeile, nicht eine neue); eine Zeile, die sie anlegte, wird stillgelegt (gelöscht wird nie). Mehrere Mitglieder sind eine Arbeitsserie (dasselbe Werk, dieselbe Person): je Feld der Wert VOR
 * dem ersten Mitglied, das es berührt, in EINER Operation.
 *
 * 🔴 **Die Herkunft je Feld bleibt „manuell“.** Das Protokoll nennt die frühere Herkunft nicht (`adventure_field_origin`); ein zurückgenommenes Feld trägt wie jedes im Editor geschriebene den
 * Vermerk `manual` (manuell schlägt Wiki, Kapitel 9.37) und das Werk `source_system = 'editor'`: Der Wert, den die Redaktion bewusst zurückholt, überschreibt der WikiSync nicht.
 *
 * 🔴 **Das Anlegen** (`work.create`, WI-0265 B8d): Zurück heißt stillgelegt (`aktiv: false` über denselben Schreibweg), nie gelöscht; die Rücknahme dieser Rücknahme belebt wieder. Eine Serie darf mit dem
 * Anlegen beginnen und geht als Ganzes zurück: Die Ortsliste kehrt auf den Stand davor zurück (leer), was die Felder danach schrieben, bleibt (ohne Belang für ein stillgelegtes Werk). Hängt seither etwas
 * am Werk, das die Serie nicht anlegte (eine Zeile der Ortsliste, ein Wiki-Schlüssel), lehnt die Vorprüfung ab (Konflikt `wert`, Schlüssel `inhalt_verwendet`). Import, Zurücksetzen der Testwelt (Grund `quelle`)
 * und WikiSync (eigene Rücknahme) sind nie Mitglied; was nur die Übernahme des WikiSync schreibt (Komplexität, Autoren, F-Shop-Nummer), ist nie Teil einer Rücknahme.
 *
 * **Bedingung:** Revision und Werte stehen heute gleich wie nach dem letzten Mitglied (Kern: die Revision des Werks; hier zusätzlich die Werte und die Ortsliste, damit der Konflikt die Felder
 * nennt, und dass die Zeilen der Liste noch zum Werk gehören).
 */

/** Die Felder, die `work.update` schreibt (`places` ist die Ortsliste); ein anderes im Protokoll (die Felder des WikiSync) nimmt die Rücknahme nicht zurück. */
const FELDER = [
    "title",
    "productType",
    "edition",
    "series",
    "genre",
    "isOfficial",
    "editorNote",
    "bfYear",
    "bfLabel",
    "active",
    "places",
] as const;
type Feld = (typeof FELDER)[number];
const BEKANNT: ReadonlySet<string> = new Set<string>(FELDER);
/** Der Grund einer früheren Rücknahme steht im Protokoll, ist aber kein Feld des Werks. */
const OHNE_FELD = "restoreReason";

/** `work.updated` ändert, `work.created` legt an (WI-0265 B8d); beides zusammen schreibt keine Operation. */
const FELDER_AKTIONEN: ReadonlySet<string> = new Set(["work.updated", "work.created"]);

const istFelderArt = (operation: string, aktionen: readonly string[]): boolean =>
    WERK_OPERATIONEN.has(operation) && aktionen.length > 0 && aktionen.every((aktion) => FELDER_AKTIONEN.has(aktion));

/** Eine Zeile der Ortsliste, wie das Protokoll sie führt (`rowId`, Rolle; Name und Art des Ziels dienen nur der Anzeige). */
interface OrtZeile {
    rowId: string;
    role: string;
}

/** Die Ortsliste aus dem Protokoll, als Liste von Zeilen; `undefined`, wenn der Wert keine solche Liste ist. */
function ortListe(wert: unknown): OrtZeile[] | undefined {
    if (!Array.isArray(wert)) return undefined;
    const zeilen: OrtZeile[] = [];
    for (const eine of wert as Record<string, unknown>[]) {
        if (typeof eine?.["rowId"] !== "string" || typeof eine["role"] !== "string") return undefined;
        zeilen.push({ rowId: eine["rowId"], role: eine["role"] });
    }
    return zeilen;
}

interface WerkIst {
    revision: number;
    name: string;
    /** Der Wiki-Schlüssel des Werks; ein im Editor angelegtes hat keinen (WI-0265 B8d). */
    wikiKey: string | null;
    werte: Record<Exclude<Feld, "places">, unknown>;
    /** Die aktiven Zeilen der Ortsliste in ihrer Reihenfolge. */
    orte: OrtZeile[];
}

interface WerkZeile {
    public_id: string;
    id: string;
    revision: number;
    title: string;
    product_type: string;
    edition: string | null;
    series: string | null;
    genre: string | null;
    is_official: boolean;
    editor_note: string | null;
    bf_year: number | null;
    bf_label: string | null;
    is_active: boolean;
    wiki_key: string | null;
}

/** Der heutige Stand der Werke samt aktiver Ortsliste; was es nicht gibt, fehlt in der Antwort. */
async function leseIst(database: Queryable, ids: readonly string[]): Promise<Map<string, WerkIst>> {
    if (ids.length === 0) return new Map();
    const zeilen = await database<WerkZeile[]>`
        SELECT public_id::text AS public_id, id::text AS id, revision::int AS revision, title, product_type, edition, series, genre,
               is_official, editor_note, bf_year, bf_label, is_active, wiki_key
          FROM adventure WHERE public_id = ANY(${ids as string[]}::uuid[])
    `;
    const orte = new Map<string, OrtZeile[]>();
    if (zeilen.length > 0)
        for (const eine of await database<{ adventure_id: string; row_id: string; role: string }[]>`
            SELECT adventure_id::text AS adventure_id, id::text AS row_id, role
              FROM adventure_place
             WHERE adventure_id = ANY(${zeilen.map((zeile) => zeile.id)}::bigint[]) AND is_active AND state = 'active'
             ORDER BY adventure_id, sort_order, export_ordinal, id
        `)
            orte.set(eine.adventure_id, [
                ...(orte.get(eine.adventure_id) ?? []),
                { rowId: eine.row_id, role: eine.role },
            ]);
    return new Map(
        zeilen.map((zeile) => [
            zeile.public_id,
            {
                revision: zeile.revision,
                name: zeile.title,
                wikiKey: zeile.wiki_key,
                werte: {
                    title: zeile.title,
                    productType: zeile.product_type,
                    edition: zeile.edition,
                    series: zeile.series,
                    genre: zeile.genre,
                    isOfficial: zeile.is_official,
                    editorNote: zeile.editor_note,
                    bfYear: zeile.bf_year,
                    bfLabel: zeile.bf_label,
                    active: zeile.is_active,
                },
                orte: orte.get(zeile.id) ?? [],
            },
        ]),
    );
}

/** Die Felder, die heute anders stehen als nach dem letzten Mitglied (Namen des Protokolls). */
function abweichendeFelder(plan: InhaltePlan, ist: WerkIst): string[] {
    const abweichend: string[] = [];
    for (const ziel of plan.felder.values()) {
        if (!BEKANNT.has(ziel.feld)) continue;
        if (ziel.feld === "places") {
            const soll = ortListe(ziel.nachher);
            if (soll === undefined || !gleichWert(soll, ist.orte)) abweichend.push(ziel.feld);
        } else if (!gleichWert(ist.werte[ziel.feld as Exclude<Feld, "places">], ziel.nachher))
            abweichend.push(ziel.feld);
    }
    return abweichend;
}

/** Was die Rücknahme dem Schreibweg von `work.update` gibt: die Felder und die Ortsliste davor und die Jahresangabe in Worten. */
function koerperAus(plan: InhaltePlan): {
    fields: InhalteWerkFelder;
    orte?: InhalteWerkOrtEintrag[];
    ruecknahme: WerkRuecknahme;
} {
    const felder: { -readonly [K in keyof InhalteWerkFelder]: InhalteWerkFelder[K] } = {};
    const ruecknahme: WerkRuecknahme = {};
    let orte: InhalteWerkOrtEintrag[] | undefined;
    for (const { feld, vorher } of zielFelder(plan, ["places"]).values()) {
        if (!BEKANNT.has(feld)) throw nichtRuecknehmbar("des Werks", feld);
        switch (feld as Feld) {
            case "title":
            case "productType":
                // Ein Werk braucht Titel und Art: Waren sie vorher leer, gibt es nichts, wohin sie zurückgehen könnten.
                if (typeof vorher !== "string" || vorher.trim() === "") throw nichtRuecknehmbar("des Werks", feld);
                felder[feld as "title" | "productType"] = vorher;
                break;
            case "edition":
            case "series":
            case "genre":
            case "editorNote":
                if (vorher !== null && typeof vorher !== "string") throw nichtRuecknehmbar("des Werks", feld);
                felder[feld as "edition" | "series" | "genre" | "editorNote"] = vorher;
                break;
            case "isOfficial":
                if (typeof vorher !== "boolean") throw nichtRuecknehmbar("des Werks", feld);
                felder.isOfficial = vorher;
                break;
            case "bfYear":
                if (vorher !== null && !Number.isInteger(vorher)) throw nichtRuecknehmbar("des Werks", feld);
                felder.bfYear = vorher as number | null;
                break;
            case "bfLabel":
                if (vorher !== null && typeof vorher !== "string") throw nichtRuecknehmbar("des Werks", feld);
                ruecknahme.bfLabel = vorher;
                break;
            case "active":
                if (typeof vorher !== "boolean") throw nichtRuecknehmbar("des Werks", feld);
                felder.aktiv = vorher;
                break;
            case "places": {
                const liste = ortListe(vorher);
                if (liste === undefined) throw nichtRuecknehmbar("des Werks", feld);
                if (liste.some((zeile) => !(INHALTE_WERK_ROLLEN as readonly string[]).includes(zeile.role)))
                    throw nichtRuecknehmbar("des Werks", feld);
                orte = liste.map((zeile) => ({
                    rowId: zeile.rowId,
                    role: zeile.role as (typeof INHALTE_WERK_ROLLEN)[number],
                }));
                break;
            }
        }
    }
    return { fields: felder, ...(orte === undefined ? {} : { orte }), ruecknahme };
}

/** Der Adapter des Werks für `vorpruefen` (siehe Kopf der Datei). */
export const WERK_ADAPTER: RuecknahmeAdapter = {
    familie: "werk",
    // Das Recht der Vorwärtsoperation: `work.update` verlangt `manage_sources` (`POST …/inhalte/literatur/:id/update`).
    recht: () => "manage_sources",
    pruefeArt: (operation, aktionen) =>
        istFelderArt(operation, aktionen) ? { ok: true } : { ok: false, reason: "art" },
    pruefeListe(offen) {
        // Ein Mitglied mit einem Feld, das nur der WikiSync schreibt (Komplexität, Autoren, F-Shop-Nummer), nimmt die Rücknahme nicht mit; ganz oder gar nicht.
        const verworfen = new Map<string, "art">();
        for (const mitglied of offen)
            if (
                mitglied.gegenstaende.some((gegenstand) =>
                    gegenstand.felder.some((feld) => feld !== OHNE_FELD && !BEKANNT.has(feld)),
                )
            )
                verworfen.set(mitglied.operationId, "art");
        return verworfen;
    },
    async pruefeWerte(database, kontext): Promise<readonly VorKonflikt[]> {
        const eintraege = (
            await eintraegeNachKennung(
                database,
                kontext.offen.map((m) => m.operationId),
                { personId: kontext.leser.personId, nutzlast: "voll" },
            )
        ).entries.filter((eintrag) =>
            istFelderArt(
                eintrag.operation,
                eintrag.objects.map((g) => g.action),
            ),
        );
        if (eintraege.length === 0) return [];
        const plan = planAusEintraegen(eintraege, "work");
        const ist = await leseIst(database, [...plan.keys()]);
        const konflikte: VorKonflikt[] = [];
        for (const [id, werk] of plan) {
            const heute = ist.get(id);
            const name = werk.name === undefined ? {} : { name: werk.name };
            if (heute === undefined) {
                konflikte.push({ art: "geloescht", kind: "work", id, ...name });
                continue;
            }
            const abweichend = abweichendeFelder(werk, heute);
            if (abweichend.length > 0) {
                konflikte.push({
                    art: "wert",
                    kind: "work",
                    id,
                    ...name,
                    currentRevision: heute.revision,
                    felder: abweichend,
                    abweichung: { was: "felder" },
                    detail: `Heute anders als nach dem letzten Schritt: ${abweichend.join(", ")}.`,
                });
                continue;
            }
            // Ein angelegtes Werk wird still gelegt: Hängt seither etwas an ihm, das die Serie nicht anlegte (eine Zeile der Ortsliste, ein Wiki-Schlüssel), bleibt es, wie es ist (WI-0265 B8d).
            if (werk.angelegt) {
                const fremd = [
                    ...(werk.felder.has("places") || heute.orte.length === 0 ? [] : ["places"]),
                    ...(heute.wikiKey === null ? [] : ["wiki"]),
                ];
                if (fremd.length > 0) {
                    konflikte.push({
                        art: "wert",
                        kind: "work",
                        id,
                        ...name,
                        currentRevision: heute.revision,
                        felder: fremd,
                        abweichung: { was: "inhalt_verwendet" },
                        detail: `Seit dem Anlegen hängt etwas am Werk: ${fremd.join(", ")}.`,
                    });
                    continue;
                }
            }
            // Jede Zeile der Ortsliste davor muss noch zu diesem Werk gehören (der Schreibweg lehnt eine fremde ab).
            const davor = ortListe(werk.felder.get("places")?.vorher);
            if (davor !== undefined && davor.length > 0) {
                const [da] = await database<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM adventure_place p JOIN adventure a ON a.id = p.adventure_id
                     WHERE a.public_id = ${id}::uuid AND p.id = ANY(${davor.map((zeile) => zeile.rowId)}::bigint[])
                `;
                if ((da?.n ?? 0) !== new Set(davor.map((zeile) => zeile.rowId)).size)
                    konflikte.push({
                        art: "wert",
                        kind: "work",
                        id,
                        ...name,
                        currentRevision: heute.revision,
                        felder: ["places"],
                        abweichung: { was: "felder" },
                        detail: "Eine Zeile der Ortsliste davor gibt es nicht mehr.",
                    });
            }
        }
        return konflikte;
    },
};

const familieVon = (werkId: string) => inhalteFamilie(RUECKNAHME_WERK_OPERATION, `work:${werkId}`, WERK_ADAPTER);

/** 404, wenn es das Werk nicht gibt (die Route hängt an ihm). */
async function pruefeWerk(database: Queryable, werkId: string): Promise<void> {
    const [zeile] = await database<{ da: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM adventure WHERE public_id = ${werkId}::uuid) AS da
    `;
    if (zeile?.da !== true) throw new ApiError(404, "not_found", "Dieses Werk gibt es nicht.");
}

/** `POST …/inhalte/literatur/:id/restore-series/preview`: lesend, nichts wird geschrieben und kein Auftrag eingestellt. */
export async function vorschauWerk(
    database: Database,
    werkId: string,
    body: RuecknahmeVorschauBody,
    leser: RuecknahmeLeser,
): Promise<RuecknahmePruefung> {
    await pruefeWerk(database, werkId);
    return vorschauInhalte(database, familieVon(werkId), "work", body, leser);
}

/**
 * `POST …/inhalte/literatur/:id/restore-series`: nimmt die Mitglieder (Felder und Ortsliste einer Serie von `work.update`) in EINER Operation zurück (Ablauf: `fuehreRuecknahmeAus`). Hier
 * steht, was das Werk ausmacht: die Sperre seiner Zeile und die Inverse über den Schreibweg von `work.update`.
 */
export async function ruecknehmenWerk(
    database: Database,
    actor: MapActor,
    leser: RuecknahmeLeser,
    werkId: string,
    body: RuecknahmeBody,
): Promise<RuecknahmeReceipt> {
    await pruefeWerk(database, werkId);
    return ruecknehmenInhalte({
        database,
        actor,
        leser,
        familie: familieVon(werkId),
        body,
        schreiben: {
            async sperreZeilen(tx) {
                await tx`SELECT id FROM adventure WHERE public_id = ${werkId}::uuid ORDER BY id FOR UPDATE`;
            },
            async schreibe({ tx, offen, grund }: RuecknahmeSchreiben) {
                const eintraege = (
                    await eintraegeNachKennung(tx, offen, { personId: leser.personId, nutzlast: "voll" })
                ).entries.sort((a, b) => a.seq - b.seq);
                const werk = planAusEintraegen(eintraege, "work").get(werkId);
                if (werk === undefined) throw nichtRuecknehmbar("des Werks");
                const ist = (await leseIst(tx, [werkId])).get(werkId);
                if (ist === undefined) throw new ApiError(404, "not_found", "Dieses Werk gibt es nicht.");
                const { fields, orte, ruecknahme } = koerperAus(werk);
                const arbeit = await schreibeWerkAendern(
                    tx,
                    werkId,
                    { baseRevision: ist.revision, fields, ...(orte === undefined ? {} : { orte }) },
                    ruecknahme,
                );
                return {
                    receipt: arbeit.receipt,
                    summary: zusammenfassung("Werk", ist.name, eintraege.length),
                    entries: arbeit.entries.map((eintrag) => mitGrund(eintrag, grund)),
                };
            },
        },
    });
}
