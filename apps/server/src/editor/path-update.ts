import {
    AVENTURIA_TRAVEL_MODEL,
    kennzeichenAusWiki,
    offeredTransports,
    PATH_EDIT_SUBTYPES,
    PATH_LAND_SUBTYPES,
    pathReaderName,
    wegtypAusWiki,
    type FeldHerkunft,
    type OperationReceipt,
    type PathFlowDirection,
    type PathMark,
    type PathReisenBody,
    type PathUpdateBody,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { formeUmIn, pruefeKurve, type KurveGeschrieben } from "./path-edit.ts";
import { konflikt, pruefeSperren, type TxErgebnis } from "./path-split.ts";
import { alsProtokoll, planeWeitere, schreibeWeitere } from "./path-weitere.ts";

/**
 * `path.update` (WI-0177 W5b; Vertrag `packages/shared/src/editor-path-update.ts`; Muster `kraftlinien-schreiben.ts`, K6): Name, Wegart
 * und „Name auf der Karte“ der ganzen Straße in EINER Operation, jeder Abschnitt gegen seine Revision.
 *
 * - **Die Straße** ist, was das Wege-Fenster liest (`readEditorPathStreet`): die Abschnitte auf der Karte mit demselben echten Namen,
 *   über Wegtypen und Kennzeichen hinweg (WI-0177 Schritt 2, Legacys Regel (c)); ein Abschnitt ohne echten Namen (leer, Griff) ist
 *   seine eigene Straße. Ein Abschnitt im Körper, der nicht zu ihr gehört (andere Straße,
 *   andere Domäne), ist 400; fehlt einer oder weicht eine Revision ab, 409 `edit_conflict` (wie die Kraftlinie). Hält ein anderer einen
 *   Abschnitt, 409 `object_locked`.
 * - **Ein Update je Abschnitt**, nur wo sich ein Wert ändert; die Revision zählt der Trigger (`path_revision`).
 * - **Wegart** nur zwischen Landwegen: Ein Flussweg bleibt Flussweg (Bach, Strömung, Reisemittel des Wassers), Seewege sind
 *   abgeschaltet. Wechselt sie, rechnet die Wegfindung neu (`routing` steht aus).
 * - **Zusammengelegt:** Heißt die Straße danach wie eine andere, sind beide eine (ein Weg ist sein Name); die Quittung sagt es
 *   (`merged`).
 * - **Kennzeichen** (`mark`, Migration 0174, WI-0177 §30): die Karawanenroute über dem Wegtyp; genannt gilt es allen Abschnitten,
 *   `""` nimmt es überall weg, ohne Nennung behält jeder Abschnitt seins (gemischt wie der Tunnel). Nur an Landwegen (400 sonst). Es
 *   ändert keine Reisezeit, also steht `routing` nicht aus.
 * - **Tunnel** je Abschnitt (`sections[].tunnel`, Migration 0172): nur, wo der Körper ihn nennt; wechselt er, steht `routing` aus (kein
 *   Querfeldein-Anschluss entlang eines Tunnels).
 * - **Wegtyp je Abschnitt** (`sections[].subtype`, Vorschlag 3 Schritt 3): geht vor der Wegart der Straße; nur unter Landwegen (ein
 *   Flussweg bleibt Flussweg, 400). Herkunft manual nur an diesem Abschnitt; wechselt er, steht `routing` aus. Der Abschnitt bleibt in
 *   seinem Weg (ein Weg ist sein Name, Schritt 2a).
 * - **Reisemittel** je Abschnitt (`sections[].reisen`, Migration 0208, Vorschlag 3 Schritt 3): Liste und Fenster ganz, danach „vollständig
 *   geschrieben“ (F16 „A“: nichts erbt mehr). Ein Mittel, das der Wegtyp (nach dieser Operation) nicht anbietet, oder ein Fenster an
 *   einem Mittel außerhalb der Liste ist 400. Die Liste steht in der Folge des Angebots, ein leeres Fenster als NULL. Wechselt etwas,
 *   steht `routing` aus; das Protokoll führt `reisen` mit Liste, Fenstern und Merkmal vorher und nachher, damit ↺ den Stand zurückholt
 *   (`geschrieben: false`, auch die Vorgabe `null`).
 * - **↺ zum Wiki-Wert** (WI-0225 §7, Modell c): `{ revert: "wiki" }` an Name, Wegart oder Kennzeichen nimmt den Wert aus dem Artikel
 *   der Straße (wie der Lesepfad: Titel und Weg-Art des Hauptartikels, `wegtypAusWiki`, `kennzeichenAusWiki`); ohne Wert 400. Je
 *   genanntem Feld vermerkt `field_origin` an ALLEN Abschnitten die Herkunft (↺ wiki, ein Wert manual), in derselben Transaktion; das
 *   Protokoll führt einen Wechsel als `nameOrigin`, `subtypeOrigin`, `markOrigin`.
 * - **Die Kurve** (`shape`, W5b Schritt 3): EIN Abschnitt der Straße bekommt sein neues Kontrollpolygon samt mitgezogener Punkte anderer
 *   Wege (`formeUmIn`, dieselbe Rechnung wie bisher `path.reshape`), nach den Feldern und gegen die Revision, die er dann hat.
 * - **Weitere Straßennamen** je Abschnitt (`sections[].weitere`, WI-0302; `path-weitere.ts`): die vollständige Liste der Wiki-Artikel der Wege neben dem
 *   Hauptartikel, als weitere Zuweisung (`path_wiki_assignment`, Rolle `further`). Ändert sie sich, zählt die Revision des Abschnitts (ein Update der Zeile wie
 *   bei jedem Feld), und das Protokoll führt `weitere` vorher und nachher (`[{ key, name }]`, nach Namen). Ändern sich NUR sie, gibt es keine Aufträge
 *   (`ableitung: false`): Karte, Wegprofil, Schriftläufe und Wegfindung kennen nur den Hauptnamen.
 */

export interface AbschnittZeile {
    public_id: string;
    map_domain_id: string;
    name: string;
    subtype: string;
    label_visible: boolean;
    is_tunnel: boolean;
    mark: PathMark | null;
    is_bach: boolean;
    flow_direction: PathFlowDirection | null;
    transport_domain: string | null;
    allowed_transports: string[] | null;
    transport_seasons: Record<string, unknown> | null;
    transports_written: boolean;
    revision: number;
    updated_at: Date;
}

/** Die Reisemittel eines Abschnitts, wie das Protokoll sie vorher und nachher führt (↺ holt genau das zurück). */
interface Reisen {
    liste: string[] | null;
    fenster: Record<string, unknown>;
    geschrieben: boolean;
}

/** Ein Wert mit Schlüsseln in fester Folge, damit zwei gleiche Stände gleich aussehen. */
const geordnet = (wert: unknown): unknown =>
    Array.isArray(wert)
        ? wert.map(geordnet)
        : typeof wert === "object" && wert !== null
          ? Object.fromEntries(
                Object.entries(wert)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([k, v]) => [k, geordnet(v)]),
            )
          : wert;
const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(geordnet(a)) === JSON.stringify(geordnet(b));

/** Prüft die Reisemittel eines Abschnitts gegen das Angebot seines Wegtyps und ordnet die Liste wie das Angebot. */
function reisenAus(teil: PathReisenBody, art: string, publicId: string): Reisen {
    const fenster = teil.fenster as Record<string, unknown>;
    if (teil.geschrieben === false) return { liste: teil.liste, fenster, geschrieben: false };
    if (teil.liste === null)
        throw new ApiError(400, "validation_failed", "Die Reisemittel brauchen eine Liste.", {
            field: "sections.reisen.liste",
            publicId,
        });
    const angebot = offeredTransports(AVENTURIA_TRAVEL_MODEL, art);
    const fremd = teil.liste.find((mittel) => !angebot.includes(mittel));
    if (fremd !== undefined)
        throw new ApiError(400, "validation_failed", "Dieses Reisemittel bietet der Wegtyp nicht an.", {
            field: "sections.reisen.liste",
            publicId,
            transport: fremd,
        });
    const ohne = Object.keys(fenster).find((mittel) => !teil.liste?.includes(mittel));
    if (ohne !== undefined)
        throw new ApiError(400, "validation_failed", "Ein Zeitfenster gilt nur einem Reisemittel, das hier fährt.", {
            field: "sections.reisen.fenster",
            publicId,
            transport: ohne,
        });
    return { liste: angebot.filter((mittel) => teil.liste?.includes(mittel)), fenster, geschrieben: true };
}

const LANDWEGE: readonly string[] = PATH_LAND_SUBTYPES;
/** Wohin der Editor eine Wegart stellen darf: Landwege und Flussweg (Plan Fluss/Bach). Ein Seeweg bleibt. */
const WAEHLBAR: readonly string[] = PATH_EDIT_SUBTYPES;
/** Die Verkehrsdomäne einer Art: Land oder Fluss (der Bach eigens, er trägt keine Boote). */
const domaeneVon = (art: string, bach: boolean): string => (art === "Flussweg" ? (bach ? "bach" : "fluss") : "land");

/** Die Felder mit Herkunft (`FELD_HERKUNFT_FELDER.path`) und ihr Name im Protokoll. */
const HERKUNFT_FELDER = [
    ["name", "nameOrigin"],
    ["subtype", "subtypeOrigin"],
    ["mark", "markOrigin"],
] as const;
type HerkunftFeld = (typeof HERKUNFT_FELDER)[number][0];
/** Die Felder im Protokoll, die in kein abgeleitetes Ergebnis eingehen: die weiteren Straßennamen und die Herkunft (WI-0302). */
const OHNE_ABLEITUNG: ReadonlySet<string> = new Set(["weitere", ...HERKUNFT_FELDER.map(([, protokoll]) => protokoll)]);

type ZumWiki = { readonly revert: "wiki" };
const zumWiki = (wert: unknown): wert is ZumWiki => typeof wert === "object" && wert !== null && "revert" in wert;

/** Titel und Weg-Art des Artikels der Straße, wie der Lesepfad sie wählt (`zusammenfassung` in `path-list.ts`). */
async function wikiDerStrasse(
    tx: Queryable,
    ids: readonly string[],
): Promise<{ titel: string | null; art: string | null }> {
    const [artikel] = await tx<{ titel: string | null; art: string | null }[]>`
        SELECT s.name AS titel, s.art
          FROM path p
          JOIN path_wiki_assignment w ON w.path_id = p.id AND w.role = 'main' AND w.is_active
          JOIN wiki_path_snapshot s ON s.id = w.snapshot_id AND s.is_active
         WHERE p.public_id = ANY(${[...ids]}::uuid[])
         ORDER BY (s.name IS NULL), p.public_id
         LIMIT 1
    `;
    return artikel ?? { titel: null, art: null };
}

const ohneWiki = (feld: HerkunftFeld, text: string): ApiError =>
    new ApiError(400, "validation_failed", text, { field: feld });

export async function updatePathStreet(
    database: Database,
    actor: MapActor,
    anker: string,
    body: PathUpdateBody,
): Promise<OperationReceipt> {
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM path WHERE public_id = ${anker}::uuid AND is_active
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    if (!body.sections.some((teil) => teil.publicId === anker))
        throw new ApiError(400, "validation_failed", "Der Abschnitt gehört nicht zu dieser Straße.", {
            field: "sections",
        });
    // Die Kurve vor der Transaktion prüfen: mindestens zwei Punkte, Anfang nicht gleich Ende.
    const neueKurve = body.shape === undefined ? undefined : pruefeKurve(body.shape.points);

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "path.update",
            mapDomainId: vorab.map_domain_id,
            body: { anker, ...body },
        },
        (tx) => schreibeStrasseIn(tx, actor, anker, body, neueKurve),
    );
}

/** Eine Straße, wie sie geschrieben wird: der Abschnitt der Route und alle Abschnitte, die mit ihm eine Straße sind (derselbe echte Name, siehe Kopf der Datei). */
export interface StrasseZeilen {
    eigener: AbschnittZeile;
    abschnitte: AbschnittZeile[];
}

/**
 * Liest die Straße des Abschnitts `anker` in der Transaktion und sperrt ihre Abschnitte (`FOR NO KEY UPDATE`, Reihenfolge nach Kennung); mit `sperren: false` nur lesend (die Vorprüfung).
 * Der Schreibweg der Felder und die Rücknahme (`ruecknahme-weg.ts`) lesen sie damit gleich: Eine Straße ist, was das Wege-Fenster liest.
 */
export async function leseStrasse(
    tx: Queryable,
    anker: string,
    optionen: { sperren?: boolean } = {},
): Promise<StrasseZeilen> {
    const sperre = optionen.sperren === false ? tx`` : tx`FOR NO KEY UPDATE`;
    // 🔴 FOR NO KEY UPDATE, nicht FOR UPDATE (Befund Claudio 2026-10-19 bei den Gebieten, 503 nach 2 s lock_timeout): Wer eine
    // Zeile mit Fremdschlüssel auf `path` schreibt, nimmt FOR KEY SHARE auf den Weg und hält es bis zum Ende seiner Transaktion,
    // so das Wegprofil (`terrain_path_profile`) im Zeigerwechsel eines Geländes (`terrain/domain/local-publish.ts`, zusammen mit
    // Master und Kacheln) und `path_visual` in der vollen Ableitung. FOR UPDATE wartete darauf; FOR NO KEY UPDATE nicht, und zwei
    // Editoren schließen sich weiter aus. `path.update` ändert nie eine Kennung des Wegs.
    const [eigener] = await tx<AbschnittZeile[]>`
        SELECT public_id::text AS public_id, map_domain_id, name, subtype, label_visible, is_tunnel, mark, is_bach,
               flow_direction, transport_domain, allowed_transports, transport_seasons, transports_written,
               revision::int AS revision, updated_at
          FROM path WHERE public_id = ${anker}::uuid AND is_active
           ${sperre}
    `;
    if (eigener === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
    const abschnitte =
        pathReaderName(eigener.name, eigener.subtype) === null
            ? [eigener]
            : await tx<AbschnittZeile[]>`
                  SELECT public_id::text AS public_id, map_domain_id, name, subtype, label_visible, is_tunnel, mark,
                         is_bach, flow_direction, transport_domain, allowed_transports, transport_seasons,
                         transports_written, revision::int AS revision, updated_at
                    FROM path
                   WHERE map_domain_id = ${eigener.map_domain_id} AND name = ${eigener.name}
                     AND btrim(name) <> subtype AND is_active
                   ORDER BY public_id
                     ${sperre}
              `;
    return { eigener, abschnitte };
}

/**
 * Der Schreibteil von `path.update` in einer laufenden Transaktion: Felder der ganzen Straße (jeder Abschnitt gegen seine Revision), optional die Kurve eines Abschnitts.
 * Die Route ruft ihn über `updatePathStreet`; die Rücknahme der Felder (`ruecknahme-weg.ts`, WI-0265 B6a) ruft ihn in der Transaktion ihrer einen Operation, damit sie
 * dieselben Prüfungen, dieselbe Herkunft und dieselben abgeleiteten Aufträge hat wie ein „Fertig“.
 */
export async function schreibeStrasseIn(
    tx: Sql,
    actor: MapActor,
    anker: string,
    body: PathUpdateBody,
    neueKurve: ReturnType<typeof pruefeKurve> | undefined,
): Promise<TxErgebnis> {
    const { eigener, abschnitte } = await leseStrasse(tx, anker);
    // 🔴 Nur Abschnitte DIESER Straße (Domäne, Name; Befund der Sicherheitsprüfung OPS-000036): ein fremder ist 400.
    const zurStrasse = new Set(abschnitte.map((a) => a.public_id));
    const fremd = body.sections.find((teil) => !zurStrasse.has(teil.publicId));
    if (fremd !== undefined)
        throw new ApiError(400, "validation_failed", "Der Abschnitt gehört nicht zu dieser Straße.", {
            field: "sections",
            publicId: fremd.publicId,
        });
    // Derselbe Satz Abschnitte mit denselben Revisionen, sonst hat jemand die Straße inzwischen geändert.
    const basis = new Map(body.sections.map((teil) => [teil.publicId, teil.baseRevision]));
    const abweichend =
        abschnitte.find((a) => basis.get(a.public_id) !== a.revision) ??
        (basis.size !== abschnitte.length ? eigener : undefined);
    if (abweichend !== undefined) throw await konflikt(tx, abweichend.public_id);
    await pruefeSperren(
        tx,
        actor,
        abschnitte.map((a) => a.public_id),
    );

    // ↺ zum Wiki-Wert: den Wert aus dem Artikel der Straße holen (WI-0225 §7).
    const wiki =
        zumWiki(body.name) || zumWiki(body.subtype) || zumWiki(body.mark)
            ? await wikiDerStrasse(
                  tx,
                  abschnitte.map((a) => a.public_id),
              )
            : { titel: null, art: null };
    let name: string | undefined;
    if (zumWiki(body.name)) {
        if (wiki.titel === null) throw ohneWiki("name", "Die Straße hat keinen Wiki-Namen.");
        name = wiki.titel.trim();
    } else name = body.name?.trim();
    let wunschArt: string | undefined;
    if (zumWiki(body.subtype)) {
        const art = wiki.art === null ? undefined : wegtypAusWiki(wiki.art);
        if (art === undefined || !WAEHLBAR.includes(art))
            throw ohneWiki("subtype", "Das Wiki nennt dieser Straße keine Wegart.");
        wunschArt = art;
    } else wunschArt = body.subtype;
    let wunschKennzeichen: PathMark | "" | undefined;
    if (zumWiki(body.mark)) {
        const kennzeichen = wiki.art === null ? undefined : kennzeichenAusWiki(wiki.art);
        if (kennzeichen === undefined) throw ohneWiki("mark", "Das Wiki nennt dieser Straße kein Kennzeichen.");
        wunschKennzeichen = kennzeichen;
    } else wunschKennzeichen = body.mark;

    const neuerName = name !== undefined && name !== eigener.name ? name : undefined;
    // Die Wegart gilt allen Abschnitten; mit Kennzeichen können sie vorher verschiedene haben.
    const neueArt = wunschArt !== undefined && abschnitte.some((a) => a.subtype !== wunschArt) ? wunschArt : undefined;
    // Der Wegtyp je Abschnitt geht vor der Wegart der Straße; nur Landwege wechseln.
    const teilArt = new Map(
        body.sections.flatMap((teil) => (teil.subtype === undefined ? [] : [[teil.publicId, teil.subtype] as const])),
    );
    const artNachher = (a: AbschnittZeile): string => teilArt.get(a.public_id) ?? neueArt ?? a.subtype;
    // Ein Seeweg bleibt Seeweg (abgeschaltet, WI-0046): weder je Abschnitt noch über die Wegart der Straße.
    const teilSee = abschnitte.find(
        (a) => teilArt.has(a.public_id) && teilArt.get(a.public_id) !== a.subtype && !WAEHLBAR.includes(a.subtype),
    );
    if (teilSee !== undefined)
        throw new ApiError(400, "validation_failed", "Diese Wegart lässt sich nicht ändern.", {
            field: "sections.subtype",
            publicId: teilSee.public_id,
        });
    let teilArtGeaendert = false;
    const see = abschnitte.find((a) => !WAEHLBAR.includes(a.subtype));
    if (neueArt !== undefined && see !== undefined)
        throw new ApiError(400, "validation_failed", "Diese Wegart lässt sich nicht ändern.", {
            field: "subtype",
        });
    // Bach je Abschnitt vor dem der Straße; nur an einem Fluss (nach dieser Operation). Ein Landweg ist nie ein Bach.
    const teilBach = new Map(
        body.sections.flatMap((teil) => (teil.bach === undefined ? [] : [[teil.publicId, teil.bach] as const])),
    );
    const bachNachher = (a: AbschnittZeile): boolean =>
        artNachher(a) === "Flussweg" && (teilBach.get(a.public_id) ?? body.bach ?? a.is_bach);
    const bachAmLand = abschnitte.find(
        (a) => artNachher(a) !== "Flussweg" && (teilBach.get(a.public_id) ?? body.bach) === true,
    );
    if (bachAmLand !== undefined)
        throw new ApiError(400, "validation_failed", "Ein Bach ist ein Fluss.", {
            field: teilBach.has(bachAmLand.public_id) ? "sections.bach" : "bach",
            publicId: bachAmLand.public_id,
        });
    // Die Fließrichtung je Abschnitt (Schritt 4): nur an einem Fluss.
    const richtungWunsch = new Map(
        body.sections.flatMap((teil) =>
            teil.flowDirection === undefined ? [] : [[teil.publicId, teil.flowDirection] as const],
        ),
    );
    const richtungAmLand = abschnitte.find((a) => richtungWunsch.has(a.public_id) && artNachher(a) !== "Flussweg");
    if (richtungAmLand !== undefined)
        throw new ApiError(400, "validation_failed", "Nur ein Fluss hat eine Fließrichtung.", {
            field: "sections.flowDirection",
            publicId: richtungAmLand.public_id,
        });
    let wasserGeaendert = false;
    // Das Kennzeichen je Abschnitt: ohne Wunsch behält jeder seins (eine Straße kann es gemischt tragen), mit Wunsch alle.
    const kennzeichenVon = (a: AbschnittZeile): PathMark | null =>
        wunschKennzeichen === undefined ? a.mark : wunschKennzeichen === "" ? null : wunschKennzeichen;
    const wasser = abschnitte.find((a) => !LANDWEGE.includes(artNachher(a)));
    if (wunschKennzeichen !== undefined && wunschKennzeichen !== "" && wasser !== undefined)
        throw new ApiError(400, "validation_failed", "Ein Kennzeichen tragen nur Landwege.", { field: "mark" });
    let zusammen = 0;
    const nameNachher = neuerName ?? eigener.name;
    // Ein Weg ist sein Name: Eine andere Straße, mit der diese danach eine ist, hat denselben echten Namen.
    if (neuerName !== undefined && pathReaderName(nameNachher, neueArt ?? eigener.subtype) !== null) {
        const [andere] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM path
             WHERE map_domain_id = ${eigener.map_domain_id} AND name = ${nameNachher} AND btrim(name) <> subtype
               AND is_active AND NOT (public_id = ANY(${abschnitte.map((a) => a.public_id)}::uuid[]))
        `;
        zusammen = andere?.n ?? 0;
    }

    const affected: OperationReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    // Tunnel je Abschnitt (Migration 0172): nur, wo der Körper ihn nennt.
    const tunnelWunsch = new Map(
        body.sections.flatMap((teil) => (teil.tunnel === undefined ? [] : [[teil.publicId, teil.tunnel] as const])),
    );
    let tunnelGeaendert = false;
    // Reisemittel je Abschnitt (Migration 0208): nur, wo der Körper sie nennt; geprüft gegen den Wegtyp nach dieser Operation.
    const reisenWunsch = new Map(
        body.sections.flatMap((teil) => (teil.reisen === undefined ? [] : [[teil.publicId, teil.reisen] as const])),
    );
    let reisenGeaendert = false;
    // Die Herkunft je genanntem Feld (WI-0225 §7): ↺ wiki, ein Wert manual; vorher, wie `field_origin` sie führt.
    const herkunftNachher: Partial<Record<HerkunftFeld, FeldHerkunft>> = {};
    for (const [feld] of HERKUNFT_FELDER)
        if (body[feld] !== undefined) herkunftNachher[feld] = zumWiki(body[feld]) ? "wiki" : "manual";
    const herkunftVorher = await leseHerkunft(
        tx,
        "path",
        Object.keys(herkunftNachher).length > 0 || teilArt.size > 0 ? abschnitte.map((a) => a.public_id) : [],
    );
    // Die weiteren Straßennamen je Abschnitt (WI-0302): nur, wo der Körper sie nennt; geprüft, bevor etwas geschrieben wird.
    const weitereWunsch = new Map(
        body.sections.flatMap((teil) => (teil.weitere === undefined ? [] : [[teil.publicId, teil.weitere] as const])),
    );
    const weitere = weitereWunsch.size === 0 ? undefined : await planeWeitere(tx, weitereWunsch);
    // Die Abschnitte, deren Wegtyp einzeln wechselt: Herkunft manual nur an ihnen.
    const teilManuell: string[] = [];
    const nurHerkunft: MapAuditEntry[] = [];
    for (const a of abschnitte) {
        const changes: Record<string, MapChange> = {};
        if (neuerName !== undefined) changes["name"] = { before: a.name, after: neuerName };
        const art = artNachher(a);
        if (art !== a.subtype) changes["subtype"] = { before: a.subtype, after: art };
        const kennzeichen = kennzeichenVon(a);
        if (kennzeichen !== a.mark) changes["mark"] = { before: a.mark, after: kennzeichen };
        if (body.labelVisible !== undefined && body.labelVisible !== a.label_visible)
            changes["labelVisible"] = { before: a.label_visible, after: body.labelVisible };
        const bach = bachNachher(a);
        if (bach !== a.is_bach) changes["isBach"] = { before: a.is_bach, after: bach };
        const richtung = richtungWunsch.has(a.public_id) ? (richtungWunsch.get(a.public_id) ?? null) : a.flow_direction;
        if (richtung !== a.flow_direction) changes["flowDirection"] = { before: a.flow_direction, after: richtung };
        // Wechselt die Domäne (Land, Fluss, Bach), fallen die Reisemittel auf die Vorgabe der neuen Art (Legacy
        // `resetToDefault`): Der Bach trägt keine Boote (F14; leere Liste mit Domäne `none`, sonst fiele sie auf die Vorgabe).
        const domaeneWechsel = domaeneVon(art, bach) !== domaeneVon(a.subtype, a.is_bach);
        if (domaeneWechsel || bach !== a.is_bach || richtung !== a.flow_direction) wasserGeaendert = true;
        const tunnel = tunnelWunsch.get(a.public_id) ?? a.is_tunnel;
        if (tunnel !== a.is_tunnel) {
            changes["tunnel"] = { before: a.is_tunnel, after: tunnel };
            tunnelGeaendert = true;
        }
        const weitereWechsel = weitere?.wechsel.get(a.public_id);
        if (weitereWechsel !== undefined)
            changes["weitere"] = {
                before: alsProtokoll(weitereWechsel.vorher),
                after: alsProtokoll(weitereWechsel.nachher),
            };
        const wunschReisen = reisenWunsch.get(a.public_id);
        const reisenVorher: Reisen = {
            liste: a.allowed_transports,
            fenster: a.transport_seasons ?? {},
            geschrieben: a.transports_written,
        };
        const vorgabe: Reisen = { liste: bach ? [] : null, fenster: {}, geschrieben: false };
        const reisenNachher =
            wunschReisen !== undefined
                ? reisenAus(wunschReisen, art, a.public_id)
                : domaeneWechsel
                  ? vorgabe
                  : undefined;
        const neueReisen =
            reisenNachher !== undefined && !gleich(reisenVorher, reisenNachher) ? reisenNachher : undefined;
        if (neueReisen !== undefined) {
            changes["reisen"] = { before: reisenVorher, after: neueReisen };
            reisenGeaendert = true;
        }
        const herkunftWechsel: Record<string, MapChange> = {};
        for (const [feld, protokoll] of HERKUNFT_FELDER) {
            const nachher = herkunftNachher[feld];
            const vorher = herkunftVorher.get(a.public_id)?.[feld] ?? null;
            if (nachher !== undefined && nachher !== vorher)
                herkunftWechsel[protokoll] = { before: vorher, after: nachher };
        }
        if (teilArt.has(a.public_id) && art !== a.subtype) {
            teilArtGeaendert = true;
            teilManuell.push(a.public_id);
            const vorher = herkunftVorher.get(a.public_id)?.subtype ?? null;
            if (herkunftNachher.subtype === undefined && vorher !== "manual")
                herkunftWechsel["subtypeOrigin"] = { before: vorher, after: "manual" };
        }
        if (Object.keys(changes).length === 0) {
            // Nur die Herkunft wechselt (↺ auf einen gleichen Wert): kein Update der Zeile, die Revision bleibt.
            if (Object.keys(herkunftWechsel).length > 0)
                nurHerkunft.push({
                    action: "path.updated",
                    pathId: a.public_id,
                    // Die Zeile bleibt, wie sie war: keine Revision danach (`map_audit_event_revision_forward`).
                    revisionBefore: a.revision,
                    revisionAfter: null,
                    changes: herkunftWechsel,
                });
            continue;
        }
        Object.assign(changes, herkunftWechsel);
        // Die Domäne der Reisemittel folgt der Art, wo sie wechselt: `none` am Bach, sonst offen (die Vorgabe der Art).
        const domaene = domaeneWechsel ? (bach ? "none" : null) : a.transport_domain;
        const [zeile] = await tx<{ revision: number }[]>`
            UPDATE path
               SET name = ${neuerName ?? a.name}, subtype = ${art},
                   label_visible = ${body.labelVisible ?? a.label_visible}, is_tunnel = ${tunnel}, mark = ${kennzeichen}
                   ${
                       // Nur, was sich ändert: Ein Spaltenrecht prüft PostgreSQL für jede Spalte im SET, auch mit gleichem Wert.
                       // Ohne die Rechte für Fluss und Bach (map-grants.psql) scheiterte sonst jedes Speichern.
                       bach !== a.is_bach ? tx`, is_bach = ${bach}` : tx``
                   }
                   ${richtung !== a.flow_direction ? tx`, flow_direction = ${richtung}` : tx``}
                   ${domaene !== a.transport_domain ? tx`, transport_domain = ${domaene}` : tx``}
                   ${
                       neueReisen === undefined
                           ? tx``
                           : tx`, allowed_transports = ${neueReisen.liste}::text[],
                                transport_seasons = ${
                                    Object.keys(neueReisen.fenster).length === 0
                                        ? null
                                        : tx.json(neueReisen.fenster as never)
                                }::jsonb,
                                transports_written = ${neueReisen.geschrieben}`
                   }
             WHERE public_id = ${a.public_id}::uuid AND revision = ${a.revision}
         RETURNING revision::int AS revision
        `;
        if (zeile === undefined) throw await konflikt(tx, a.public_id);
        affected.push({ kind: "path", id: a.public_id, revision: zeile.revision });
        entries.push({
            action: "path.updated",
            pathId: a.public_id,
            revisionBefore: a.revision,
            revisionAfter: zeile.revision,
            changes,
        });
    }
    entries.push(...nurHerkunft);
    if (weitere !== undefined) await schreibeWeitere(tx, weitere);
    // Der Wegtyp je Abschnitt: Herkunft manual nur an den Abschnitten, die einzeln wechselten (die Wegart der Straße geht über alle).
    if (herkunftNachher.subtype === undefined) await setzeHerkunft(tx, "path", teilManuell, { subtype: "manual" });
    await setzeHerkunft(
        tx,
        "path",
        abschnitte.map((a) => a.public_id),
        herkunftNachher,
    );
    // Die Kurve EINES Abschnitts (W5b Schritt 3), gegen die Revision, die er nach den Feldern hat.
    let kurve: KurveGeschrieben | undefined;
    if (body.shape !== undefined && neueKurve !== undefined) {
        const ziel = abschnitte.find((a) => a.public_id === body.shape?.publicId);
        if (ziel === undefined)
            throw new ApiError(400, "validation_failed", "Die Kurve gehört nicht zu dieser Straße.", {
                field: "shape",
            });
        const revisionJetzt = affected.find((x) => x.id === ziel.public_id)?.revision ?? ziel.revision;
        kurve = await formeUmIn(tx, actor, ziel.public_id, neueKurve, body.shape.carried, revisionJetzt);
        for (const neu of kurve.affected) {
            const da = affected.findIndex((x) => x.id === neu.id);
            if (da >= 0) affected[da] = neu;
            else affected.push(neu);
        }
        entries.push(...kurve.entries);
    }
    const strasse = neuerName ?? eigener.name;
    // Nur weitere Straßennamen (und allenfalls die Herkunft): kein Auftrag, denn kein abgeleitetes Ergebnis kennt sie (WI-0302).
    const ohneAbleitung =
        kurve === undefined &&
        weitere !== undefined &&
        weitere.wechsel.size > 0 &&
        entries.every((entry) => Object.keys(entry.changes ?? {}).every((feld) => OHNE_ABLEITUNG.has(feld)));
    return {
        ...(ohneAbleitung ? { ableitung: false as const } : {}),
        receipt: {
            affected,
            derivedWork: [
                ...(kurve !== undefined ? [{ kind: "path_visual", state: "done" } as const] : []),
                // Tunnel nimmt dem Abschnitt den Querfeldein-Anschluss, Reisemittel ändern, wer wann fährt: auch das rechnet die
                // Wegfindung neu.
                ...(kurve !== undefined ||
                neueArt !== undefined ||
                teilArtGeaendert ||
                wasserGeaendert ||
                tunnelGeaendert ||
                reisenGeaendert
                    ? [{ kind: "routing", state: "pending" } as const]
                    : []),
            ],
            warnings:
                zusammen > 0
                    ? [{ code: "merged", message: `„${strasse}“ gab es schon; beide Straßen sind jetzt eine.` }]
                    : [],
        },
        summary: `${strasse === "" ? "Weg" : strasse}: ${
            kurve === undefined
                ? `Felder für ${String(affected.length)} Abschnitte`
                : `Wegkurve${kurve.mitgezogen > 0 ? `, ${String(kurve.mitgezogen)} Wege mitgezogen` : ""}`
        }`,
        entries,
    };
}
