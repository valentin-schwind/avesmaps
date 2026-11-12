import {
    GEBIRGS_MODELL_SPALTE,
    GEBIRGS_MODELL_WERTE,
    GEBIRGS_WERTE,
    RUECKNAHME_NETZ_TEILE,
    linieMitHoehen,
    type GebirgsAenderung,
    type GebirgsNetzAenderung,
    type GebirgsNetzStand,
    type GebirgsZurueckAlle,
    type MapHistoryActor,
    type MapHistoryEntry,
    type MapHistoryObject,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { gebirgSchreiben, leseGebirgsZusatz } from "../terrain/gebirge-editor.ts";
import type { MapAuditEntry } from "./map-operation.ts";
import type { VorKonflikt } from "./ruecknahme.ts";

/**
 * Die Gebirgswerte beim Zurücknehmen (WI-0265 B3; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2, C.3, D, F.1; Testvertrag U2, U3, U5, U6, U8,
 * U13; Gate 2 und 3 abgenommen 2026-10-31): der Vergleich der Werte und die Inverse über `gebirgSchreiben`. 🔴 Seit B6c ist das Gebirge ein TEIL der Rücknahme der Derographie
 * (`ruecknahme-flaeche.ts`: Adapter, Vorschau und Rücknahme in EINER Operation für alle Arten der Landschaft); hier bleibt, was nur das Gebirge weiß.
 *
 * - **Was zurückgeht:** je Teilfläche und Feld der Wert VOR dem ersten Mitglied, das das Feld berührt (Typ, Muster, Kammhöhe, die zehn Werte der V12, die vier Werte
 *   des Rückennetzes, die Saat) und das Netz als EIN Feld (C.3, „Gebirge-Netz ist ein Feld“: Kämme, Täler, Nebengipfel, Mulden und die Höhen an Flüssen und Seen, die seit
 *   WI-0249 nach Lage im Netz stehen). Das Protokoll `area.gebirge` führt das GANZE Netz vorher und nachher; die Höhen an Flüssen und Seen stecken darin, nichts
 *   wird aus dem heutigen Stand rekonstruiert. Geschrieben wird über `gebirgSchreiben`, den einen Schreibweg des Gebirges (Revision, Netz ersetzen, Flusshöhen auf
 *   Stützpunkten): Eine Flusshöhe, die kein aktiver Flussweg mehr trägt, bleibt auch hier weg (WI-0259), sie war ohnehin unwirksam.
 * - **Bedingung** (`pruefeWerte`): Der heutige Stand ist für JEDES Feld, das die Serie berührt, gleich dem Stand nach dem letzten Mitglied, das es berührt. Die Revision
 *   der Gebirgswerte steht nicht im Protokoll; der Vergleich der Werte ersetzt sie (Hinweis aus B2). Dazu gilt: Ist eine Flusshöhe seit dem ersten Schritt mit ihrem Weg
 *   gewandert (`wasserHoehen` im Protokoll eines Wegs, „Höhe wandert mit“, WI-0259), geht die Rücknahme NICHT: Sie schriebe die Höhe an ihre alte Lage zurück, an der kein
 *   Stützpunkt mehr liegt. Streng und alles oder nichts, die Konflikte nennen Gegenstand, Feld, Person und Zeit.
 * - **Eine Operation** (`ruecknahme-flaeche.ts`): `landscape.restore_series`, Quelle `restore`, `reverts` = die offenen Mitglieder in der Reihenfolge der Serie; alle Teilflächen in EINER
 *   Transaktion (`FOR UPDATE` an `terrain_control` in fester Reihenfolge), die Vorprüfung wird in ihr wiederholt. `affected` nennt nur die Gebirgswerte: Die Schreibnaht rechnet
 *   ihre Ableitung EINMAL (`deriveAfter`), und das Gelände bekommt höchstens EINE Kette `terrain_local` → `dem_publish` (oder reiht sich in den wartenden Lauf ein). Unter einem
 *   Rezept ohne regionale Rückverteilung gibt es keinen Lauf; die Quittung trägt dann `terrain_stale` („Gelände veraltet“), nie ein erfundenes „aktualisiert“.
 * - **Grund** (Gate 2): Betrifft die Rücknahme eine andere Person, ist `reason` Pflicht (400 `reason_required`); er steht als `restoreReason` an den Protokolleinträgen der
 *   Rücknahme und damit im Eintrag der Liste.
 * - **Rücknahme einer Rücknahme** geht über denselben Weg: `landscape.restore_series` und die Einzel-Rücknahmen der Editoren (`landscape.update` mit Quelle `restore`) sind
 *   Mitglieder wie jede Änderung am Gebirge.
 * - **Mit anderen Änderungen zusammen** (B6c): Eine Operation, die neben dem Gebirge Felder, Beschriftungen oder die Form schrieb, nimmt `ruecknahme-flaeche.ts` ganz zurück; das Gebirge darin geht
 *   durch die Funktionen dieser Datei, der Rest durch die dortige Inverse des Protokolls.
 */

export const GEBIRGE_PROTOKOLL = "area.gebirge";

const MODELL_NACH_SPALTE = new Map<string, (typeof GEBIRGS_MODELL_WERTE)[number]>(
    GEBIRGS_MODELL_WERTE.map((wert) => [GEBIRGS_MODELL_SPALTE[wert], wert]),
);
const WERT_SPALTEN: ReadonlySet<string> = new Set(GEBIRGS_WERTE);
/** Die Spalten von `terrain_control`, die der Editor schreibt (wie `SPALTEN` in `gebirge-editor.ts`); ohne das Netz. */
const SPALTEN = [
    "gebirgstyp",
    "muster",
    "maximalhoehe",
    ...GEBIRGS_WERTE,
    ...GEBIRGS_MODELL_WERTE.map((wert) => GEBIRGS_MODELL_SPALTE[wert]),
    "saat",
] as const;

type Netz = GebirgsNetzStand;
const LEERES_NETZ: Netz = { kaemme: [], nebengipfel: [] };

/**
 * Ein Netz, wie das Protokoll es führt, in der heutigen Form: Operationen vor Migration 0219 tragen die Höhe einer ganzen Linie (`h`); sie gilt als dieselbe Höhe an allen
 * Stützpunkten, wie der Server sie liest (WI-0249 P9). Ohne Netz (eine leere Spalte davor) das leere Netz.
 */
function netzAusProtokoll(wert: unknown): Netz {
    const netz = (wert ?? LEERES_NETZ) as Omit<Netz, "kaemme"> & {
        kaemme: (Netz["kaemme"][number] & { h?: number | undefined })[];
    };
    return {
        ...netz,
        kaemme: netz.kaemme.map((kamm) =>
            linieMitHoehen(
                kamm.punkte,
                kamm.rang,
                kamm.hoehen ?? (kamm.h === undefined ? null : kamm.punkte.map(() => kamm.h!)),
            ),
        ),
    };
}

type PunktMitHoehe = { x: number; y: number; h?: number | null };
const punktHoehe = ({ x, y, h }: PunktMitHoehe) => ({ x, y, h: h ?? null });

type NetzTeil = (typeof RUECKNAHME_NETZ_TEILE)[number];

/** Die Teile des Netzes in fester Form und Folge, zum Vergleichen (die Reihenfolge der Schlüssel im Protokoll ist die der Datenbank, nicht die des Schreibwegs). */
function netzTeile(wert: unknown): Record<NetzTeil, string> {
    const netz = netzAusProtokoll(wert);
    return {
        kaemme: JSON.stringify(netz.kaemme.map((k) => ({ punkte: k.punkte, rang: k.rang, hoehen: k.hoehen ?? null }))),
        nebengipfel: JSON.stringify(netz.nebengipfel.map(punktHoehe)),
        mulden: JSON.stringify((netz.mulden ?? []).map(punktHoehe)),
        flussHoehen: JSON.stringify((netz.flussHoehen ?? []).map(punktHoehe)),
        seeHoehen: JSON.stringify((netz.seeHoehen ?? []).map(punktHoehe)),
    };
}

/** Die Teile (Schlüssel, nie Wörter), in denen sich zwei Netze unterscheiden. */
function netzAbweichung(a: unknown, b: unknown): NetzTeil[] {
    const links = netzTeile(a);
    const rechts = netzTeile(b);
    return RUECKNAHME_NETZ_TEILE.filter((teil) => links[teil] !== rechts[teil]);
}

/** Die Teile des Netzes als deutsche Wörter, nur für den Hinweis beim Überfahren (`detail`); die Oberfläche benennt sie aus ihren Sprachtafeln. */
const NETZ_TEIL_DEUTSCH: Record<NetzTeil, string> = {
    kaemme: "Kämme",
    nebengipfel: "Nebengipfel",
    mulden: "Mulden",
    flussHoehen: "Flusshöhen",
    seeHoehen: "Seehöhen",
};

/** Das Netz, wie `gebirgSchreiben` es nimmt: immer mit Mulden und den Höhen an Flüssen und Seen, auch leer (leer nimmt die gespeicherten weg). */
function netzZumSchreiben(netz: Netz): GebirgsNetzAenderung {
    return {
        kaemme: netz.kaemme.map((kamm) => {
            const paare = (kamm.hoehen ?? []).flatMap((h, i): [number, number][] => (h === null ? [] : [[i, h]]));
            return paare.length === 0
                ? { punkte: kamm.punkte, rang: kamm.rang }
                : { punkte: kamm.punkte, rang: kamm.rang, hoehen: paare };
        }),
        nebengipfel: netz.nebengipfel.map(({ x, y, h }) => (h === null ? { x, y } : { x, y, h })),
        mulden: (netz.mulden ?? []).map(({ x, y, h }) => (h === null ? { x, y } : { x, y, h })),
        flussHoehen: (netz.flussHoehen ?? []).map(({ x, y, h }) => ({ x, y, h })),
        seeHoehen: (netz.seeHoehen ?? []).map(({ x, y, h }) => ({ x, y, h })),
    };
}

/** Ein Wert einer Spalte zum Vergleichen: Zahlen als Zahl (Tafel und Protokoll liefern sie je nach Weg als Zahl oder Zeichenkette), Text als Text, leer als `null`. */
function normWert(wert: unknown): string | number | null {
    if (wert === null || wert === undefined) return null;
    if (typeof wert === "number") return wert;
    if (typeof wert === "string") return wert.trim() !== "" && Number.isFinite(Number(wert)) ? Number(wert) : wert;
    return JSON.stringify(wert);
}

function gleichWert(feld: string, a: unknown, b: unknown): boolean {
    if (feld === "netz") return netzAbweichung(a, b).length === 0;
    return normWert(a) === normWert(b);
}

/** Was ein Feld über die Serie hinweg erlebt hat: der Wert vor dem ersten und nach dem letzten Mitglied, das es berührt (C.3). */
interface FeldZiel {
    feld: string;
    vorher: unknown;
    nachher: unknown;
    ersteSeq: number;
    letzteSeq: number;
}
export interface FlaechenPlan {
    name?: string;
    /** Die Landschaft der Teilfläche (aus dem Protokolleintrag). */
    region?: string;
    felder: Map<string, FeldZiel>;
}

/** Die Gebirgsfelder der Mitglieder je Teilfläche (nur `area.gebirge`); die Einträge brauchen die volle Nutzlast. */
export function planAusEintraegen(eintraege: readonly MapHistoryEntry[]): Map<string, FlaechenPlan> {
    const plan = new Map<string, FlaechenPlan>();
    for (const eintrag of [...eintraege].sort((a, b) => a.seq - b.seq)) {
        for (const gegenstand of eintrag.objects) {
            if (gegenstand.kind !== "area" || gegenstand.action !== GEBIRGE_PROTOKOLL) continue;
            const wechsel = gegenstand.changes["gebirge"];
            const vorher = (wechsel?.before ?? {}) as Record<string, unknown>;
            const nachher = (wechsel?.after ?? {}) as Record<string, unknown>;
            let flaeche = plan.get(gegenstand.id);
            if (flaeche === undefined) {
                flaeche = {
                    felder: new Map(),
                    ...(gegenstand.name !== undefined ? { name: gegenstand.name } : {}),
                    ...(gegenstand.landscape !== undefined ? { region: gegenstand.landscape.id } : {}),
                };
                plan.set(gegenstand.id, flaeche);
            }
            for (const feld of new Set([...Object.keys(vorher), ...Object.keys(nachher)])) {
                const bisher = flaeche.felder.get(feld);
                if (bisher === undefined)
                    flaeche.felder.set(feld, {
                        feld,
                        vorher: vorher[feld] ?? null,
                        nachher: nachher[feld] ?? null,
                        ersteSeq: eintrag.seq,
                        letzteSeq: eintrag.seq,
                    });
                else {
                    bisher.nachher = nachher[feld] ?? null;
                    bisher.letzteSeq = eintrag.seq;
                }
            }
        }
    }
    return plan;
}

interface GebirgeIst {
    /** Die Werte der Spalten (`null`, wo leer oder ohne aktive Zeile). */
    werte: Record<string, unknown>;
    netz: Netz;
}

/** Der heutige Stand der Gebirgswerte einer Teilfläche; `undefined`, wenn es die Teilfläche nicht gibt. */
async function leseIst(database: Queryable, area: string): Promise<GebirgeIst | undefined> {
    const [ziel] = await database<
        { id: string }[]
    >`SELECT id::text AS id FROM region_area WHERE public_id = ${area}::uuid`;
    if (ziel === undefined) return undefined;
    const [zeile] = await database<Record<string, unknown>[]>`
        SELECT gebirgstyp, muster, maximalhoehe, hypsometrie, plateau, rauschen, einschnitt, erosion, talbreite, koernung, stufen, bergform,
               sattel, grat, grat_breite, talboden, erosionsfestigkeit, saat
          FROM terrain_control WHERE area_id = ${ziel.id}::bigint AND is_active
    `;
    const zusatz = (await leseGebirgsZusatz(database, [ziel.id])).get(ziel.id)!;
    return {
        werte: Object.fromEntries(SPALTEN.map((spalte) => [spalte, zeile?.[spalte] ?? null])),
        netz: zusatz.netz,
    };
}

const istWert = (ist: GebirgeIst, feld: string): unknown => (feld === "netz" ? ist.netz : (ist.werte[feld] ?? null));

interface WegZeile {
    operation_id: string;
    seq: string;
    at: Date;
    actor_kind: MapHistoryActor["kind"];
    person_id: string | null;
    display_name: string | null;
}

/** Die jüngste Operation an einem Weg nach `nachSeq`, die eine Flusshöhe dieser Teilfläche mit ihrem Stützpunkt umgezogen hat (`wasserHoehen` im Protokoll des Wegs). */
async function gewanderteFlusshoehe(database: Queryable, area: string, nachSeq: number): Promise<WegZeile | undefined> {
    const [zeile] = await database<WegZeile[]>`
        SELECT o.operation_id::text AS operation_id, o.seq::text AS seq, o.at, o.actor_kind, o.actor_person_id::text AS person_id, p.display_name
          FROM map_audit_event e
          JOIN map_operation o ON o.operation_id = e.operation_id
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.seq > ${nachSeq} AND e.path_public_id IS NOT NULL
           AND (e.changes -> 'wasserHoehen' -> 'before') @> ${JSON.stringify([{ area }])}::text::jsonb
         ORDER BY o.seq DESC LIMIT 1
    `;
    return zeile;
}

const akteurVon = (zeile: WegZeile, personId: string): MapHistoryActor => ({
    kind: zeile.actor_kind,
    ...(zeile.person_id !== null ? { id: zeile.person_id } : {}),
    ...(zeile.display_name !== null ? { name: zeile.display_name } : {}),
    ...(zeile.person_id === personId ? { self: true as const } : {}),
});

const hatWasserHoehen = (wert: unknown): boolean => {
    const netz = netzAusProtokoll(wert);
    return (netz.flussHoehen?.length ?? 0) > 0;
};

/** Die Namen der Felder im Sammelfeld `gebirge`, die sich wirklich änderten (der Kern nennt sie als `felder` einer späteren Änderung; `undefined`: die Schlüssel des Protokolls gelten). */
export function feinFelderGebirge(gegenstand: MapHistoryObject): string[] | undefined {
    if (gegenstand.kind !== "area" || gegenstand.action !== GEBIRGE_PROTOKOLL) return undefined;
    const wechsel = gegenstand.changes["gebirge"];
    const vorher = (wechsel?.before ?? {}) as Record<string, unknown>;
    const nachher = (wechsel?.after ?? {}) as Record<string, unknown>;
    const felder = [...new Set([...Object.keys(vorher), ...Object.keys(nachher)])].filter(
        (feld) => !gleichWert(feld, vorher[feld] ?? null, nachher[feld] ?? null),
    );
    return felder.length === 0 ? undefined : felder;
}

/**
 * Der Vergleich der Werte für die Gebirgswerte der offenen Mitglieder (`eintraege` mit voller Nutzlast): Konflikte der Art `wert`, wo der heutige Stand nicht dem nach dem letzten Schritt gleicht
 * oder eine Flusshöhe mit ihrem Weg gewandert ist.
 */
export async function konflikteGebirge(
    database: Queryable,
    eintraege: readonly MapHistoryEntry[],
    personId: string,
): Promise<VorKonflikt[]> {
    const konflikte: VorKonflikt[] = [];
    for (const [area, plan] of planAusEintraegen(eintraege)) {
        const ist = await leseIst(database, area);
        const name = plan.name === undefined ? {} : { name: plan.name };
        if (ist === undefined) {
            konflikte.push({ art: "geloescht", kind: "area", id: area, ...name });
            continue;
        }
        const abweichend = [...plan.felder.values()].filter(
            (ziel) => !gleichWert(ziel.feld, istWert(ist, ziel.feld), ziel.nachher),
        );
        const netz = plan.felder.get("netz");
        // Eine Flusshöhe, die seit dem ersten Schritt mit ihrem Weg gewandert ist: Zurückschreiben setzte sie an eine Lage ohne Stützpunkt.
        const gewandert =
            netz !== undefined && (hatWasserHoehen(netz.vorher) || hatWasserHoehen(netz.nachher))
                ? await gewanderteFlusshoehe(database, area, netz.ersteSeq)
                : undefined;
        if (abweichend.length === 0 && gewandert === undefined) continue;
        const netzNachher = abweichend.find((ziel) => ziel.feld === "netz");
        const netzTeil = netzNachher === undefined ? [] : netzAbweichung(istWert(ist, "netz"), netzNachher.nachher);
        const teile = abweichend.flatMap((ziel) =>
            ziel.feld === "netz"
                ? [`Netz (${netzTeil.map((teil) => NETZ_TEIL_DEUTSCH[teil]).join(", ")})`]
                : [ziel.feld],
        );
        const detail =
            gewandert === undefined
                ? `Heute anders als nach dem letzten Schritt: ${teile.join(", ")}.`
                : `Eine Flusshöhe ist seit dem ersten Schritt mit ihrem Weg gewandert${teile.length > 0 ? `; heute anders als nach dem letzten Schritt: ${teile.join(", ")}` : ""}.`;
        konflikte.push({
            art: "wert",
            kind: "area",
            id: area,
            ...name,
            felder: [
                ...new Set([...abweichend.map((ziel) => ziel.feld), ...(gewandert === undefined ? [] : ["netz"])]),
            ],
            abweichung: {
                was: gewandert === undefined ? "felder" : "flusshoehe",
                ...(netzTeil.length > 0 ? { netzTeile: netzTeil } : {}),
            },
            detail,
            ...(gewandert === undefined
                ? {}
                : {
                      changedBy: akteurVon(gewandert, personId),
                      changedAt: gewandert.at.toISOString(),
                      operationId: gewandert.operation_id,
                      seq: Number(gewandert.seq),
                  }),
        });
    }
    return konflikte;
}

/**
 * Die Änderung am Gebirge, die eine Teilfläche auf die Werte VOR der Serie bringt: nur Felder, die heute anders stehen; leer über `zurueck`, das Netz als Ganzes. `undefined`,
 * wenn nichts zu schreiben ist.
 */
function aenderungAus(plan: FlaechenPlan, ist: GebirgeIst): GebirgsAenderung | undefined {
    const aenderung: { -readonly [K in keyof GebirgsAenderung]: GebirgsAenderung[K] } = {};
    const werte: Record<string, number> = {};
    const modell: Record<string, number> = {};
    const zurueck: GebirgsZurueckAlle[] = [];
    for (const { feld, vorher } of plan.felder.values()) {
        if (gleichWert(feld, istWert(ist, feld), vorher)) continue;
        const leer = vorher === null || vorher === undefined;
        const modellWert = MODELL_NACH_SPALTE.get(feld);
        if (feld === "netz") aenderung.netz = netzZumSchreiben(netzAusProtokoll(vorher));
        else if (feld === "gebirgstyp") {
            if (leer) zurueck.push("typ");
            else aenderung.typ = vorher as NonNullable<GebirgsAenderung["typ"]>;
        } else if (feld === "muster") {
            if (leer) zurueck.push("muster");
            else aenderung.muster = vorher as NonNullable<GebirgsAenderung["muster"]>;
        } else if (feld === "maximalhoehe") {
            if (leer) zurueck.push("kammhoehe");
            else aenderung.kammhoehe = Number(vorher);
        } else if (feld === "saat") {
            if (leer) zurueck.push("saat");
            else aenderung.saat = Number(vorher);
        } else if (modellWert !== undefined) {
            if (leer) zurueck.push(modellWert);
            else modell[modellWert] = Number(vorher);
        } else if (WERT_SPALTEN.has(feld)) {
            if (leer) zurueck.push(feld as GebirgsZurueckAlle);
            else werte[feld] = Number(vorher);
        } else
            throw new ApiError(400, "not_revertable", "Diese Änderung am Gebirge lässt sich nicht zurücknehmen.", {
                reason: "art",
                field: feld,
            });
    }
    if (Object.keys(werte).length > 0) aenderung.werte = werte;
    if (Object.keys(modell).length > 0) aenderung.modell = modell;
    if (zurueck.length > 0) aenderung.zurueck = zurueck;
    return Object.keys(aenderung).length === 0 ? undefined : aenderung;
}

/** Die Zeilen von `terrain_control` der Teilflächen in fester Reihenfolge sperren (kanonisch: nach Zeilennummer), vor der wiederholten Vorprüfung. */
export async function sperreGebirgswerte(tx: Queryable, flaechen: readonly string[]): Promise<void> {
    if (flaechen.length === 0) return;
    await tx`
        SELECT c.id FROM terrain_control c JOIN region_area a ON a.id = c.area_id
         WHERE a.public_id = ANY(${flaechen as string[]}::uuid[])
         ORDER BY c.id FOR UPDATE OF c
    `;
}

/**
 * Die Inverse der Gebirgswerte: je Teilfläche der Wert VOR dem ersten Mitglied, über `gebirgSchreiben`. Gibt Gegenstände und Protokolleinträge zurück (leer, wo der Stand schon der vom Anfang war);
 * `grund` steht als `restoreReason` an jedem Eintrag. Die Quittung zum Gelände (`terrain_stale`) sagt der Aufrufer.
 *
 * `auswahl` wählt die Teilflächen (alle, wenn es fehlt). 🪤 `gebirgSchreiben` schreibt nur an einer Teilfläche auf der Karte (Fläche UND Landschaft aktiv, WI-0265 B8c): Geht die Rücknahme eine Fläche von der Karte
 * (eine angelegte, die die Serie still legt), müssen ihre Werte VOR dem Stilllegen zurück, kommt sie auf die Karte, danach; die Aufrufer rufen die Funktion darum zweimal mit je einer Auswahl.
 */
export async function schreibeGebirge(
    tx: Queryable,
    eintraege: readonly MapHistoryEntry[],
    grund: string | undefined,
    auswahl: (area: string) => boolean = () => true,
): Promise<{ affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const plan = planAusEintraegen(eintraege);
    const affected: OperationReceipt["affected"] = [];
    const entries: MapAuditEntry[] = [];
    for (const area of [...plan.keys()].filter(auswahl).sort()) {
        const flaeche = plan.get(area)!;
        const ist = await leseIst(tx, area);
        if (ist === undefined) throw new ApiError(404, "not_found", "Diese Teilfläche gibt es nicht mehr.");
        const aenderung = aenderungAus(flaeche, ist);
        if (aenderung === undefined) continue;
        const geschrieben = await gebirgSchreiben(tx, area, aenderung);
        if (geschrieben.aenderungen.length === 0) continue;
        affected.push(...geschrieben.affected);
        entries.push({
            action: "area.gebirge",
            ...(flaeche.region !== undefined ? { regionId: flaeche.region } : {}),
            areaId: area,
            changes: {
                gebirge: {
                    before: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.alt])),
                    after: Object.fromEntries(geschrieben.aenderungen.map((a) => [a.feld, a.neu])),
                },
                ...(grund !== undefined ? { restoreReason: { after: grund } } : {}),
            },
        });
    }
    return { affected, entries };
}
