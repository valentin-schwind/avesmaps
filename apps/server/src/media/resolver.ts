import {
    MEDIA_ROLES,
    MEDIA_ROLE_SWITCH,
    istOhneKiEntstehung,
    mediaPublicUrl,
    type MediaCredit,
    type MediaKind,
    type MediaPublicView,
    type MediaRole,
    type PhotoboxCreationKind,
    type ReisebildKarte,
    type ReisebilderAntwort,
    type ReisebilderAusschnitt,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { inhaltsstandFuer, schalterVon } from "../system/inhaltsstand.ts";
import { relationOf, relationSql, withholdTypeImages } from "./image-relation.ts";
import { gehalteneAssets } from "./notaus.ts";
import {
    decidePublication,
    type ClearanceState,
    type CreationMethod,
    type ModerationState,
    type PublicationOverride,
    type PublicationRuleFacts,
    type RightsBasis,
    type TechnicalState,
} from "./policy.ts";
import { PHOTOBOX_KACHEL_VARIANT, PUBLISHED_VARIANT } from "./roles.ts";
import { PUBLICATION_RULES_JSON } from "./rules.ts";

/**
 * Der öffentliche Lesepfad des Media Core (WI-0063 Plan MEDIA-M5): lädt für ein Fachobjekt seine Medien, wendet
 * Unterdrückung, Rückzug und die EINE Entscheidung (`policy.ts`) an und liefert nur `MediaPublicView[]`.
 *
 * 🔴 Eine Abfrage je Fachobjekt, kein N+1. Die Abfrage wählt NUR Spalten, die eine öffentliche Sicht braucht: Prompt,
 * interne Notiz, Beleg, Legacy-Login, Speicherschlüssel und Clearance-Zustand verlassen die Datenbank hier gar nicht erst.
 * Kein Endpunkt in diesem Paket (der Detail-Lesevertrag kommt mit P4); vor Auth gibt es keinen Lesepfad für Prompts,
 * Notizen oder Belege.
 *
 * Reihenfolge der Antwort: erst das Wappen, dann die Kopfbilder (ein einzelnes Titelbild vor der Galerie, die Galerie in
 * ihrer `sort_order`).
 *
 * Seit MEDIA-M14 liest derselbe Pfad auch die Umschläge der Spielliteratur und die Vorschauen der Kartensammlung - über
 * DIESELBE Entscheidung und DIESELBEN Spalten, nur mit einem anderen Träger. 🔴 Eine Sektion listet viele Werke und viele
 * Karten; sie fragt darum EINMAL für alle (`resolveLiteratureCovers`, `resolveCitymapPreviews`, `resolveCitymapFulls`),
 * nie je Zeile.
 *
 * Im Nachgang zu MEDIA-M11 kam die dritte Katalogrolle dazu: `map_full`, das Vollbild der Kartensammlung. Das
 * Paritätsreview hatte sie als einzige unerwartete Abweichung gegen Legacy gefunden - die Rolle stand in `roles.ts`, in
 * der Rasterpipeline, im Schema und in `citymap_media`, nur fragte sie niemand ab. 🪤 Der Pfad liefert heute NICHTS, und
 * das ist richtig: die eine vorhandene Vollkarte trägt `rights_basis permission`, und dafür gibt es keine Freigaberegel.
 * Ob es eine geben soll - und an welcher Stelle des Lesevertrags das Bild dann erscheint - sind offene Betreiberfragen
 * (`media.yaml` → `offen_m11`), keine Entscheidung dieses Lesepfads.
 *
 * Die Inhaltsschalter der Systemsteuerung (WI-0127 SYS-10) gelten hier mit: Jeder Ladeweg holt den Stand einmal
 * (`inhaltsstandFuer`, aus dem Store der Anwendung ohne Datenbankfrage) und gibt ihn der Entscheidung mit. Ebenso der Einzelbild-Notaus
 * (Code-Review 2026-10-16 S8-04): EINE Abfrage je Ladeweg (`gehalteneAssets`), nie eine je Zeile; ein gesperrtes Bild bekommt keine
 * Adresse, auch solange seine Datei noch nicht in der Quarantäne liegt.
 *
 * Der Bildbezug (Betreiber 2026-10-11, „1A … 2 B … 3 A“, `image-relation.ts`): Jedes Kopfbild eines Ortes trägt `relation`
 * (Ortsansicht oder Typbild), gerechnet in DERSELBEN Abfrage je Verwendung; danach fallen an einem Ort mit Ortsansicht die Typbilder
 * weg (2B). Andere Rollen tragen das Feld nie.
 */

interface UsageRow {
    role: MediaRole;
    usageKind: "binding" | "gallery";
    override: PublicationOverride;
    retired: boolean;
    suppressed: boolean;
    assetPublicId: string;
    mediaKind: MediaKind;
    technicalState: TechnicalState;
    moderationState: ModerationState;
    creationMethod: CreationMethod;
    rightsBasis: RightsBasis | null;
    clearanceState: ClearanceState | null;
    licenseKey: string | null;
    licenseFamily: string | null;
    licenseRequiresAttribution: boolean | null;
    licenseName: string | null;
    licenseUri: string | null;
    creator: string | null;
    attribution: string | null;
    fileSha256: string | null;
    fileMimeType: string | null;
    fileWidth: number | null;
    fileHeight: number | null;
    rules: PublicationRuleFacts[];
    /** Nur die Abfrage der Orte rechnet ihn (Rolle `header`); sonst fehlt er. */
    relation?: string | null;
    /** Nur die Abfrage der Reisebilder eines Ortes (Rolle `photobox`, WI-0272 S5) bringt sie mit; sonst fehlen sie. */
    reisebildBeschreibung?: string | null;
    reisebildName?: string | null;
    reisebildEntstehung?: PhotoboxCreationKind | null;
}

const ROLE_ORDER: Readonly<Record<MediaRole, number>> = {
    coat: 0,
    header: 1,
    map_full: 2,
    map_preview: 3,
    literature_cover: 4,
    photobox: 5,
    social_post: 6,
};

/**
 * Verlangen die Rechte eine Nennung? (Betreiber 2026-10-11 über die Koordination, wörtlich: „[Name] ist ein editor von uns, aber "Urheber" braucht nur dran stehen wenn das bild auch urhebernennung verlangt, oder?“) Nicht der Weg zur Veröffentlichung
 * (automatisch, Regel, Einzelfreigabe) entscheidet, sondern die Rechtelage:
 * - eine Lizenz, außer sie verlangt ausdrücklich keine (CC0, gemeinfrei): CC BY und Verwandte, auch ohne bekannte Version;
 * - eine Erlaubnis und die Fan-Richtlinie: Die Nennung gehört zu den Bedingungen, unter denen wir das Bild zeigen dürfen;
 * - nie ein eigenes Werk (KI oder nicht) und nie Public Domain.
 */
export function creditRequired(rights: { basis: RightsBasis; licenseRequiresAttribution: boolean | null }): boolean {
    switch (rights.basis) {
        case "license":
            return rights.licenseRequiresAttribution !== false;
        case "permission":
        case "fan_policy":
            return true;
        default:
            return false;
    }
}

function creditOf(row: UsageRow): MediaCredit | undefined {
    const credit: MediaCredit = {};
    if (row.creator) credit.creator = row.creator;
    if (row.licenseName) credit.licenseName = row.licenseName;
    if (row.licenseUri) credit.licenseUri = row.licenseUri;
    if (row.attribution) credit.attribution = row.attribution;
    return Object.keys(credit).length > 0 ? credit : undefined;
}

/** Was jede Entscheidung eines Ladewegs mitbekommt: die Inhaltsschalter und die Assets unter Notaus. */
interface Lesestand {
    switches: { isOff(key: string): boolean };
    gehalten: ReadonlySet<string>;
}

async function lesestand(database: Queryable): Promise<Lesestand> {
    const [stand, gehalten] = await Promise.all([inhaltsstandFuer(database), gehalteneAssets(database)]);
    return { switches: schalterVon(stand), gehalten: gehalten.publicIds };
}

/** Die veröffentlichte Hauptdatei einer Zeile, wenn es sie gibt (Prüfsumme, Art und Maße vollständig). */
function veroeffentlichteDatei(
    row: UsageRow,
): { sha256: string; mimeType: string; width: number; height: number } | null {
    return row.fileSha256 !== null && row.fileMimeType !== null && row.fileWidth !== null && row.fileHeight !== null
        ? { sha256: row.fileSha256, mimeType: row.fileMimeType, width: row.fileWidth, height: row.fileHeight }
        : null;
}

/**
 * Die EINE Entscheidung für eine Zeile eines Ladewegs: `decidePublication` mit den Inhaltsschaltern und dem Notaus. Jeder Ladeweg fragt sie, keiner hält eine
 * eigene Liste von Gründen.
 */
function entscheide(row: UsageRow, { switches, gehalten }: Lesestand): ReturnType<typeof decidePublication> {
    const published = veroeffentlichteDatei(row);
    return decidePublication({
        role: row.role,
        asset: {
            mediaKind: row.mediaKind,
            technicalState: row.technicalState,
            moderationState: row.moderationState,
            creationMethod: row.creationMethod,
        },
        rights:
            row.rightsBasis !== null && row.clearanceState !== null
                ? {
                      basis: row.rightsBasis,
                      clearance: row.clearanceState,
                      licenseKey: row.licenseKey,
                      licenseRequiresAttribution: row.licenseRequiresAttribution,
                      licenseFamily: row.licenseFamily,
                  }
                : null,
        usage: { role: row.role, suppressed: row.suppressed, retired: row.retired, override: row.override },
        published: published ? { mimeType: published.mimeType } : null,
        rules: row.rules,
        suspended: gehalten.has(row.assetPublicId),
        switches,
    });
}

/** Aus den Zeilen die öffentlichen Sichten: nur, was die Entscheidung erlaubt, sortiert und ohne Dubletten. */
function toPublicViews(rows: readonly UsageRow[], stand: Lesestand): MediaPublicView[] {
    const seen = new Set<string>();
    const views: MediaPublicView[] = [];
    for (const row of rows) {
        const published = veroeffentlichteDatei(row);
        const decision = entscheide(row, stand);
        if (!decision.allowed || !published) continue;
        const key = `${row.role}:${row.assetPublicId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Die Nennung nur, wo die Rechte sie verlangen (`creditRequired`), gleich auf welchem Weg das Bild öffentlich ist.
        const credit =
            row.rightsBasis !== null &&
            creditRequired({ basis: row.rightsBasis, licenseRequiresAttribution: row.licenseRequiresAttribution })
                ? creditOf(row)
                : undefined;
        views.push({
            id: row.assetPublicId,
            role: row.role,
            url: mediaPublicUrl(published.sha256),
            width: published.width,
            height: published.height,
            mimeType: published.mimeType,
            ...(credit ? { credit } : {}),
            // Nur am Kopfbild, und ein fehlender Wert ist Typbild, nie Ortsansicht.
            ...(row.role === "header" ? { relation: relationOf(row.relation) } : {}),
            // Für den Filter „Ohne KI“; ein Reisebild nennt seine Entstehung im eigenen Block.
            ...(row.role === "header" && row.creationMethod === "ai_generated" ? { ki: true as const } : {}),
            // 🔴 Und umgekehrt NUR mit einer als ohne KI eingetragenen Entstehung (WI-0281): Ein Typbild unbekannter Herkunft trägt keines der beiden Felder.
            ...(row.role === "header" && istOhneKiEntstehung(row.creationMethod) ? { ohneKi: true as const } : {}),
            // Ein Reisebild im Kopf eines Ortes (WI-0272 S5): der Bezug `reisebild` und, was Besucher über das Bild erfahren (Beschreibung, freiwilliger Name, Entstehung).
            ...(row.role === "photobox" && row.reisebildBeschreibung != null && row.reisebildEntstehung != null
                ? {
                      relation: "reisebild" as const,
                      reisebild: {
                          beschreibung: row.reisebildBeschreibung,
                          ...(row.reisebildName == null || row.reisebildName.trim() === ""
                              ? {}
                              : { name: row.reisebildName.trim() }),
                          entstehung: row.reisebildEntstehung,
                      },
                  }
                : {}),
        });
    }
    return views;
}

/** Die Spalten des Assets, seiner Rechte und seiner veröffentlichten Datei: nur, was die Entscheidung und die Sicht brauchen. */
const ASSET_COLUMNS = `
    a.public_id AS "assetPublicId", a.media_kind AS "mediaKind", a.technical_state AS "technicalState",
    a.moderation_state AS "moderationState", a.creation_method AS "creationMethod",
    r.rights_basis AS "rightsBasis", r.clearance_state AS "clearanceState", r.license_key AS "licenseKey",
    r.license_family AS "licenseFamily", r.creator, r.attribution,
    l.requires_attribution AS "licenseRequiresAttribution", l.display_name AS "licenseName", l.canonical_uri AS "licenseUri",
    f.sha256 AS "fileSha256", f.mime_type AS "fileMimeType", f.width AS "fileWidth", f.height AS "fileHeight",
    ${PUBLICATION_RULES_JSON} AS rules
`;

/**
 * Welche veröffentlichte Variante zu welcher Rolle gehört, als eine `CASE`-Zeile mit Parametern ab `$2`. Die Namen stehen
 * NUR in `roles.ts` (`PUBLISHED_VARIANT`); die Abfrage trägt keine zweite Liste, und eine neue Rolle fällt hier von selbst
 * mit an.
 */
const VARIANT_CASE = `CASE u.role ${MEDIA_ROLES.map(
    (role, index) => `WHEN '${role}' THEN $${String(index + 2)}::text`,
).join(" ")} END`;

/** Die Varianten in der Reihenfolge, in der `VARIANT_CASE` sie erwartet. */
const VARIANT_PARAMS: readonly string[] = MEDIA_ROLES.map((role) => PUBLISHED_VARIANT[role]);

const ASSET_JOINS = `
    JOIN media_asset a ON a.id = u.media_asset_id
    LEFT JOIN media_rights r ON r.media_asset_id = a.id
    LEFT JOIN license_catalog l ON l.key = r.license_key
    LEFT JOIN LATERAL (
        SELECT f.sha256, f.mime_type, f.width, f.height
        FROM media_file f
        WHERE f.media_asset_id = a.id AND f.storage_class = 'published'
          AND f.variant = ${VARIANT_CASE}
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT 1
    ) f ON TRUE
`;

const ORDER = `
    ORDER BY CASE u.role WHEN 'coat' THEN 0 ELSE 1 END, CASE u."usageKind" WHEN 'binding' THEN 0 ELSE 1 END,
             u.sort_order, u.usage_id
`;

const PLACE_QUERY = `
    WITH subject AS (SELECT id FROM place WHERE public_id = $1::uuid),
    u AS (
        SELECT 'binding' AS "usageKind", m.role, 0 AS sort_order, m.id AS usage_id, m.media_asset_id,
               m.publication_override AS override, m.retired_at IS NOT NULL AS retired,
               EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = m.place_id AND s.role = m.role) AS suppressed,
               m.image_relation_override AS relation_override
        FROM place_media m JOIN subject ON subject.id = m.place_id
        UNION ALL
        SELECT 'gallery', g.role, i.sort_order, i.id, i.media_asset_id,
               i.publication_override, i.retired_at IS NOT NULL OR g.retired_at IS NOT NULL,
               EXISTS (SELECT 1 FROM place_media_suppression s WHERE s.place_id = g.place_id AND s.role = g.role),
               i.image_relation_override
        FROM place_media_gallery g
        JOIN media_gallery_item i ON i.gallery_id = g.media_gallery_id
        JOIN subject ON subject.id = g.place_id
    )
    SELECT u."usageKind", u.role, u.override, u.retired, u.suppressed, ${ASSET_COLUMNS},
           ${relationSql("u.role", "u.relation_override", "a.id")} AS relation
    FROM u ${ASSET_JOINS} ${ORDER}
`;

/**
 * Die freigegebenen Reisebilder eines Ortes (WI-0272 S5): Einreichungen im Zustand `approved`, deren Ort dieser ist (`media_submission.place_id`, nach der Freigabe nicht mehr zu ändern) und deren
 * Verwendung `photobox_media` noch gilt. Kein zweiter Bestand: Freigabe legt die Verwendung an, Offline und das Zurücknehmen setzen `retired_at`, und beides gilt hier von selbst. Die Reihenfolge ist die der
 * Freigabe (`photobox_media.id`): Ein neues Bild reiht sich hinten an, das erste Bild des Kopfes springt nicht um.
 *
 * - 🔴 **Valis Kopfregel**, Fassung 2026-11-09: Reisebilder ersetzen kein Typbild, sie reihen sich dahinter ein („man will nicht dass reisebilder typbilder plötzlich ersetzen, sondern einfach nur die galerie extended“; die Fassung vom 2026-11-02 „wenn typbild (von uns) UND photoboxbilder: nur photoboxbilder“ gilt nicht mehr). Weiter gilt: „wenn individuelles titelbild (von uns) UND photoboxbilder, dann unser individuelles titelbild zuerst UND dann photobox bilder“. „Titelbild entfernen“ (`header.none`) heißt nur „kein eigenes Titelbild, also Typbild“ („wird ein titelbild entfernt ist das gleichzusetzen mit "kein titelbild aber typbild"“): Die Unterdrückung gilt für gebundene Bilder, nie für Reisebilder.
 * - Die Entscheidung ist dieselbe wie überall (`decidePublication`): Freigaberegel, Schalter `media.role.photobox`, Notaus.
 * - Nur die Angaben, die Besucher auch auf der Karte sehen (`resolveReisebilder`): Beschreibung, freiwilliger Name, Entstehung. Nie der Zustand, die Stelle oder ein Schlüssel.
 */
const PLACE_REISEBILDER_QUERY = `
    WITH subject AS (SELECT id FROM place WHERE public_id = $1::uuid),
    u AS (
        SELECT 'binding' AS "usageKind", m.role, 0 AS sort_order, m.id AS usage_id, m.media_asset_id,
               m.publication_override AS override, m.retired_at IS NOT NULL AS retired,
               FALSE AS suppressed,
               s.description AS "reisebildBeschreibung", s.attribution_name AS "reisebildName", s.creation_kind AS "reisebildEntstehung"
          FROM media_submission s
          JOIN subject ON subject.id = s.place_id
          JOIN photobox_media m ON m.media_submission_id = s.id AND m.retired_at IS NULL
         WHERE s.state = 'approved'
    )
    SELECT u."usageKind", u.role, u.override, u.retired, u.suppressed, u."reisebildBeschreibung", u."reisebildName",
           u."reisebildEntstehung", ${ASSET_COLUMNS}
    FROM u ${ASSET_JOINS}
    ORDER BY u.usage_id
`;

const TERRITORY_QUERY = `
    WITH subject AS (SELECT id FROM territory WHERE public_id = $1::uuid),
    u AS (
        SELECT 'binding' AS "usageKind", m.role, 0 AS sort_order, m.id AS usage_id, m.media_asset_id,
               m.publication_override AS override, m.retired_at IS NOT NULL AS retired,
               EXISTS (
                   SELECT 1 FROM territory_media_suppression s WHERE s.territory_id = m.territory_id AND s.role = m.role
               ) AS suppressed
        FROM territory_media m JOIN subject ON subject.id = m.territory_id
    )
    SELECT u."usageKind", u.role, u.override, u.retired, u.suppressed, ${ASSET_COLUMNS}
    FROM u ${ASSET_JOINS} ${ORDER}
`;

/**
 * Die Wappen VIELER Gebiete auf einmal (WI-0094): dieselben Spalten, dieselben Joins, dieselbe Entscheidung und dieselbe
 * veröffentlichte Variante wie `TERRITORY_QUERY` - nur fragt die Treppe des Infopanels für ihre ganze Kette EINMAL statt je
 * Zeile. 🔴 Die Unterdrückungstafel gilt hier genauso wie beim einzelnen Gebiet; der Katalogweg (`carrierQuery`) kennt sie
 * nicht und wäre deshalb die falsche Vorlage.
 */
function territoryCoatsQuery(selection: string): string {
    return `
    WITH u AS (
        SELECT 'binding' AS "usageKind", m.role, 0 AS sort_order, m.id AS usage_id, m.media_asset_id,
               m.publication_override AS override, m.retired_at IS NOT NULL AS retired,
               EXISTS (
                   SELECT 1 FROM territory_media_suppression s WHERE s.territory_id = m.territory_id AND s.role = m.role
               ) AS suppressed,
               t.public_id::text AS "carrierId"
        FROM territory_media m
        JOIN territory t ON t.id = m.territory_id
        WHERE ${selection} AND m.role = 'coat'
    )
    SELECT u."carrierId", u."usageKind", u.role, u.override, u.retired, u.suppressed, ${ASSET_COLUMNS}
    FROM u ${ASSET_JOINS} ${ORDER}
`;
}

const TERRITORY_COATS_QUERY = territoryCoatsQuery("t.public_id = ANY($1::uuid[])");

/**
 * Dieselbe Abfrage für ALLE Gebiete (WI-0121: die Karte setzt das Wappen an jeden Gebietsnamen). `$1` bleibt im Text, weil
 * die Varianten der Rollen ab `$2` zählen; ohne Verweis darauf lehnt PostgreSQL die Parameterliste ab. Er trägt `NULL`.
 * Die Entscheidung, die Unterdrückung und die Variante sind dieselben wie oben - es ändert sich nur, welche Gebiete gefragt sind
 * (die aktiven: die Karte zeichnet keine anderen).
 */
const ALL_TERRITORY_COATS_QUERY = territoryCoatsQuery("$1::uuid[] IS NULL AND t.is_active");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(database: Queryable, query: string, publicId: string): Promise<MediaPublicView[]> {
    // Eine Kennung, die keine UUID ist, kennt die Datenbank nicht; sie ist kein Fehler, nur ohne Medien.
    if (!UUID.test(publicId)) return [];
    const rows = await database.unsafe<UsageRow[]>(query, [publicId, ...VARIANT_PARAMS]);
    return toPublicViews(rows, await lesestand(database)).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
}

/** Was der Aufrufer von den Medien eines Ortes will. */
export interface PlaceMediaOptions {
    /**
     * Auch die freigegebenen Reisebilder des Ortes (Rolle `photobox`, Bildbezug `reisebild`, WI-0272 S5): Sie stehen hinter einer Ortsansicht und, ohne Ortsansicht, hinter den Typbildern
     * (`withholdTypeImages`, Vali 2026-11-09). Nur der Kopf der Infobox eines Ortes fragt danach; der Prüfer der Medienparität und die Medienverwaltung lesen weiter nur Wappen und Kopfbilder, und ein Gipfel, der
     * die Bilder seines Ortes zeigt, bekommt keine Reisebilder.
     */
    reisebilder?: boolean;
}

/**
 * Wappen und Kopfbilder eines Ortes (`place.public_id`), öffentlich erlaubt und geordnet, jedes Kopfbild mit seinem Bildbezug.
 * `withheld` sind die Typbilder, die 2B zurückhält, weil der Ort eine Ortsansicht ausliefert (ein Reisebild hält seit 2026-11-09 keines mehr zurück) (Betreiber 2026-10-11, WI-0272 §12 Frage 5). Unbekannter Ort:
 * beides leer.
 */
export async function resolvePlaceMediaParts(
    database: Queryable,
    placePublicId: string,
    options: PlaceMediaOptions = {},
): Promise<{ delivered: MediaPublicView[]; withheld: MediaPublicView[] }> {
    const views = await load(database, PLACE_QUERY, placePublicId);
    if (options.reisebilder === true) views.push(...(await load(database, PLACE_REISEBILDER_QUERY, placePublicId)));
    return withholdTypeImages(views);
}

/** Wappen und Kopfbilder eines Ortes, wie Besucher sie sehen (`resolvePlaceMediaParts` ohne die zurückgehaltenen Typbilder). */
export async function resolvePlaceMedia(
    database: Queryable,
    placePublicId: string,
    options: PlaceMediaOptions = {},
): Promise<MediaPublicView[]> {
    return (await resolvePlaceMediaParts(database, placePublicId, options)).delivered;
}

/** Das Wappen eines Herrschaftsgebiets (`territory.public_id`), wenn es öffentlich erscheinen darf. */
export function resolveTerritoryMedia(database: Queryable, territoryPublicId: string): Promise<MediaPublicView[]> {
    return load(database, TERRITORY_QUERY, territoryPublicId);
}

/**
 * Die Wappen ALLER Gebiete, die eines öffentlich zeigen dürfen, in EINER Abfrage (WI-0121): `territory.public_id` → Sicht.
 * Dieselbe Entscheidung wie `resolveTerritoryCoats` und das Wappen im Infopanel: Was dort nicht erscheint, steht auch auf der
 * Karte nicht. Ein Gebiet ohne Eintrag hat kein öffentliches Wappen.
 */
export async function resolveAllTerritoryCoats(database: Queryable): Promise<Map<string, MediaPublicView>> {
    const rows = await database.unsafe<CarrierUsageRow[]>(ALL_TERRITORY_COATS_QUERY, [null, ...VARIANT_PARAMS]);
    return viewsByCarrier(rows, await lesestand(database));
}

/**
 * Die Wappen der genannten Gebiete (`territory.public_id`), nur die öffentlich erlaubten - in EINER Abfrage (WI-0094).
 *
 * 🔴 Die Treppe „Liegt in“ nennt bis zu `AREA_TERRITORY_CHAIN_LIMIT` Ketten; ein `resolveTerritoryMedia` je Zeile wäre N+1.
 * Ein Gebiet ohne Eintrag in der Antwort hat kein Wappen - das ist kein Fehler.
 */
export function resolveTerritoryCoats(
    database: Queryable,
    territoryPublicIds: readonly string[],
): Promise<Map<string, MediaPublicView>> {
    return loadCarrierRole(database, TERRITORY_COATS_QUERY, territoryPublicIds);
}

// -------------------------------------------------------------------------------------------------------------------
// Katalogträger: viele auf einmal (MEDIA-M14)
// -------------------------------------------------------------------------------------------------------------------

/**
 * Die Einzelrollen der Kataloge: ein Werk trägt höchstens einen Umschlag, eine Karte höchstens eine Vorschau (ein Teilindex je
 * Tabelle hält das, Migrationen 0068, 0069 und 0321). Vollbilder (`map_full`) kann eine Karte seit WI-0287 Stufe 2 mehrere haben,
 * ihre Versionen: Gelesen werden sie in ihrer Reihenfolge (`version_position NULLS FIRST`, dann die Bindung), und die Einzelrolle
 * nimmt die erste, die öffentlich sein darf. Es gibt für sie keine Galerie und keine Unterdrückungstafel - `usageKind` ist immer
 * `binding`, `suppressed` immer falsch.
 */
/**
 * Die Typbilder (★ je Kategorie und Variante, Migrationen 0113 und 0314), nur die öffentlich erlaubten. Dieselbe Entscheidung, dieselben Spalten und
 * dieselbe veröffentlichte Variante wie jedes Kopfbild (Rolle `header`); ein Typbild ohne Erlaubnis fehlt. Der Träger ist `<Kategorie>:<Variante>`.
 * `$1` trägt `NULL` (die Varianten der Dateien zählen ab `$2`).
 */
const TYPE_IMAGES_QUERY = `
    WITH u AS (
        SELECT 'binding' AS "usageKind", 'header' AS role, 0 AS sort_order, t.id AS usage_id, t.media_asset_id,
               t.publication_override AS override, FALSE AS retired, FALSE AS suppressed,
               t.category || ':' || t.variant AS "carrierId"
          FROM media_type_image t
         WHERE $1::text IS NULL AND t.retired_at IS NULL
    )
    SELECT u."carrierId", u."usageKind", u.role, u.override, u.retired, u.suppressed, ${ASSET_COLUMNS}
    FROM u ${ASSET_JOINS} ${ORDER}
`;

/**
 * Die öffentlichen Typbilder je Variante (WI-0281): Kategorie → Sicht.
 * - `ki`: die KI-Variante, wenn die Policy sie erlaubt.
 * - `ohneKi`: die Ohne-KI-Variante, wenn die Policy sie erlaubt UND ihre Entstehung (noch) als ohne KI eingetragen ist (`MediaPublicView.ohneKi`).
 *   🔴 Trägt jemand das Asset später auf KI oder „unbekannt“ um, fällt es hier heraus, auch wenn es in der Variante stehen bleibt: Der Modus „Ohne
 *   KI“ zeigt dann den Platzhalter, nie das Bild.
 */
export interface TypeImageVariantViews {
    ki: Map<string, MediaPublicView>;
    ohneKi: Map<string, MediaPublicView>;
}

export async function resolveTypeImageVariants(database: Queryable): Promise<TypeImageVariantViews> {
    const rows = await database.unsafe<CarrierUsageRow[]>(TYPE_IMAGES_QUERY, [null, ...VARIANT_PARAMS]);
    const ki = new Map<string, MediaPublicView>();
    const ohneKi = new Map<string, MediaPublicView>();
    for (const [carrier, view] of viewsByCarrier(rows, await lesestand(database))) {
        const trenner = carrier.lastIndexOf(":");
        const category = carrier.slice(0, trenner);
        if (carrier.slice(trenner + 1) === "ohne_ki") {
            if (view.ohneKi === true) ohneKi.set(category, view);
        } else {
            ki.set(category, view);
        }
    }
    return { ki, ohneKi };
}

/** Was der Normalmodus zeigt (Betreiber 2026-11-05): die KI-Variante, fehlt sie, die Ohne-KI-Variante. */
export function regularTypeImages(views: TypeImageVariantViews): Map<string, MediaPublicView> {
    const found = new Map(views.ohneKi);
    for (const [category, view] of views.ki) found.set(category, view);
    return found;
}

/** Die Typbilder des Normalmodus: Kategorie → Sicht (`regularTypeImages`). Fehlt eine Kategorie, zeigt das Infopanel die eingebaute Grafik. */
export async function resolveTypeImages(database: Queryable): Promise<Map<string, MediaPublicView>> {
    return regularTypeImages(await resolveTypeImageVariants(database));
}

interface CarrierUsageRow extends UsageRow {
    carrierId: string;
}

/** Die Folge der Versionen einer Karte (Migration 0321): `version_position NULLS FIRST`, dann die Bindung; Positionen sind nie negativ. */
const CITYMAP_VERSION_SORT = "coalesce(m.version_position, -1)";

/**
 * Ein Katalogträger: dieselben Spalten, dieselben Joins, nur eine andere Bindungstabelle. `versions` (nur `citymap_media`, WI-0287 Stufe 2): mehrere aktive
 * Bindungen eines Trägers in der Folge ihrer Versionen, samt Bezeichnung (`versionLabel`); ohne gilt die Folge der Bindung.
 */
function carrierQuery(
    binding: string,
    carrier: string,
    key: string,
    role: MediaRole,
    onlyActive = false,
    versions = false,
): string {
    return `
        WITH u AS (
            SELECT 'binding' AS "usageKind", m.role, ${versions ? CITYMAP_VERSION_SORT : "0"} AS sort_order, m.id AS usage_id, m.media_asset_id,
                   m.publication_override AS override, m.retired_at IS NOT NULL AS retired, FALSE AS suppressed,
                   c.public_id::text AS "carrierId"${versions ? `, m.version_label AS "versionLabel"` : ""}
            FROM ${binding} m
            JOIN ${carrier} c ON c.id = m.${key}
            WHERE c.public_id = ANY($1::uuid[]) AND m.role = '${role}' AND m.retired_at IS NULL${onlyActive ? " AND c.is_active" : ""}
        )
        SELECT u."carrierId", u."usageKind", u.role, u.override, u.retired, u.suppressed${versions ? `, u."versionLabel"` : ""}, ${ASSET_COLUMNS}
        FROM u ${ASSET_JOINS} ${ORDER}
    `;
}

const LITERATURE_COVER_QUERY = carrierQuery("adventure_media", "adventure", "adventure_id", "literature_cover");
const CITYMAP_PREVIEW_QUERY = carrierQuery("citymap_media", "citymap", "citymap_id", "map_preview", true);
const CITYMAP_VERSIONS_QUERY = carrierQuery("citymap_media", "citymap", "citymap_id", "map_full", true, true);

/**
 * Die Einzelrolle vieler Träger auf einmal: je Träger höchstens EINE Sicht, und nur dort, wo die Entscheidung sie erlaubt.
 * Ein Träger ohne Eintrag in der Antwort hat kein Bild - das ist kein Fehler.
 */
async function loadCarrierRole(
    database: Queryable,
    query: string,
    publicIds: readonly string[],
): Promise<Map<string, MediaPublicView>> {
    const ids = [...new Set(publicIds)].filter((id) => UUID.test(id));
    if (ids.length === 0) return new Map();
    const rows = await database.unsafe<CarrierUsageRow[]>(query, [ids, ...VARIANT_PARAMS]);
    return viewsByCarrier(rows, await lesestand(database));
}

/** Je Träger höchstens EINE Sicht, und nur dort, wo die Entscheidung sie erlaubt. */
function viewsByCarrier(rows: readonly CarrierUsageRow[], stand: Lesestand): Map<string, MediaPublicView> {
    const found = new Map<string, MediaPublicView>();
    const byCarrier = new Map<string, CarrierUsageRow[]>();
    for (const row of rows) {
        const list = byCarrier.get(row.carrierId);
        if (list) list.push(row);
        else byCarrier.set(row.carrierId, [row]);
    }
    for (const [carrierId, group] of byCarrier) {
        const [view] = toPublicViews(group, stand);
        if (view) found.set(carrierId, view);
    }
    return found;
}

/** Die Umschläge der genannten Werke (`adventure.public_id`), nur die öffentlich erlaubten. */
export function resolveLiteratureCovers(
    database: Queryable,
    adventurePublicIds: readonly string[],
): Promise<Map<string, MediaPublicView>> {
    return loadCarrierRole(database, LITERATURE_COVER_QUERY, adventurePublicIds);
}

/** Die Vorschauen der genannten Karten (`citymap.public_id`), nur die öffentlich erlaubten. */
export function resolveCitymapPreviews(
    database: Queryable,
    citymapPublicIds: readonly string[],
): Promise<Map<string, MediaPublicView>> {
    return loadCarrierRole(database, CITYMAP_PREVIEW_QUERY, citymapPublicIds);
}

/** Eine Version einer Karte für Besucher (WI-0287 Stufe 2): ihre Bezeichnung, wo es eine gibt, und ihr Vollbild, wo die Entscheidung es erlaubt. */
export interface CitymapVersionView {
    label?: string;
    view?: MediaPublicView;
}

/**
 * Die Versionen der genannten Karten (`citymap.public_id`, Rolle `map_full`, WI-0287 Stufe 2): ALLE aktiven in ihrer Reihenfolge, je mit Bezeichnung und, nur wo die
 * Entscheidung es erlaubt, dem Vollbild. 🔴 Die Entscheidung fällt je Version, keine erbt die einer anderen: Eine gesperrte Spielerversion zeigt Besuchern nichts, auch
 * wenn die SL-Version öffentlich ist. EINE Abfrage für alle Karten.
 */
export async function resolveCitymapVersions(
    database: Queryable,
    citymapPublicIds: readonly string[],
): Promise<Map<string, CitymapVersionView[]>> {
    const ids = [...new Set(citymapPublicIds)].filter((id) => UUID.test(id));
    const found = new Map<string, CitymapVersionView[]>();
    if (ids.length === 0) return found;
    const rows = await database.unsafe<(CarrierUsageRow & { versionLabel: string | null })[]>(CITYMAP_VERSIONS_QUERY, [
        ids,
        ...VARIANT_PARAMS,
    ]);
    const stand = await lesestand(database);
    for (const row of rows) {
        const [view] = toPublicViews([row], stand);
        const version: CitymapVersionView = {
            ...(row.versionLabel === null ? {} : { label: row.versionLabel }),
            ...(view === undefined ? {} : { view }),
        };
        const list = found.get(row.carrierId);
        if (list) list.push(version);
        else found.set(row.carrierId, [version]);
    }
    return found;
}

/** Das Vollbild einer Karte aus ihren Versionen: das der ersten, die eines hat. */
export const firstCitymapFull = (versions: readonly CitymapVersionView[] | undefined): MediaPublicView | undefined =>
    versions?.find((version) => version.view !== undefined)?.view;

/**
 * Die Vollbilder der genannten Karten (`citymap.public_id`, Rolle `map_full`), nur die öffentlich erlaubten. Hat eine Karte mehrere
 * Versionen (WI-0287 Stufe 2), ist es die erste in ihrer Reihenfolge, die öffentlich sein darf (`firstCitymapFull`).
 *
 * 🔴 Dieselbe Entscheidung wie Umschlag und Vorschau, keine zweite Rechteliste: eine Vollkarte mit `rights_basis
 * permission` bleibt ohne Freigaberegel (`permission`, `map_full`) oder Einzelfreigabe dunkel. Am Bestand heißt das
 * heute eine leere Map - der einzige Fall (Rhôndur) trägt genau diese Rechtsbasis.
 */
export async function resolveCitymapFulls(
    database: Queryable,
    citymapPublicIds: readonly string[],
): Promise<Map<string, MediaPublicView>> {
    const found = new Map<string, MediaPublicView>();
    for (const [carrierId, versions] of await resolveCitymapVersions(database, citymapPublicIds)) {
        const view = firstCitymapFull(versions);
        if (view !== undefined) found.set(carrierId, view);
    }
    return found;
}

// -------------------------------------------------------------------------------------------------------------------
// Reisebilder auf der Karte (WI-0272 S4, Aufgabe 23)
// -------------------------------------------------------------------------------------------------------------------

/** Eine Zeile des Lesepfads der Reisebilder: die Verwendung samt Asset, dazu die Angaben der Einreichung, ihr sichtbarer Ort und die Kachel. */
interface ReisebildRow extends UsageRow {
    lageX: number;
    lageY: number;
    description: string;
    name: string | null;
    entstehung: PhotoboxCreationKind;
    nutzung: string;
    blickrichtung: number | null;
    gefaellt: number;
    ortId: string | null;
    ortName: string | null;
    ortSubtype: string | null;
    ortX: number | null;
    ortY: number | null;
    ortBands: string | null;
    kachelSha256: string | null;
    kachelWidth: number | null;
    kachelHeight: number | null;
}

/** Die Parameter: die Grenze ist `$1`, die Varianten der Rollen `$2…`, danach die vier Ecken des Ausschnitts. */
const ECKE = MEDIA_ROLES.length + 2;

/**
 * Die freigegebenen Reisebilder eines Ausschnitts (`media_submission` mit aktiver `photobox_media`, Zustand `approved`, die Stelle im Rahmen), mit allem, was die
 * Entscheidung braucht. Der Rahmen nutzt `media_submission_geom_gist` (`&&`, die Kante gehört dazu).
 *
 * - Nur Einreichungen mit veröffentlichter Hauptdatei kommen überhaupt in die Auswahl: Ohne diese Vorabprüfung füllten Bilder, die die Entscheidung ohnehin
 *   zurückhält (noch kein Abgleich), die begrenzte Auswahl.
 * - `ORDER BY s.public_id` ist eine stabile, gleichmäßige Auswahl (die Kennung ist zufällig): Dieselbe Anfrage bringt dieselben Bilder, und keine Gegend
 *   bevorzugt ein Alter. Gelesen werden `grenze + 1` Zeilen; die eine mehr sagt, dass gekappt wurde.
 * - Der Ort hängt nur dran, wenn er aktiv und nicht verborgen ist (`LEFT JOIN`); sonst fehlt er in der Antwort und das Bild gilt als frei. 🪤 Nicht über die Sicht
 *   `place_render`: Ihr `ORDER BY` verhindert das Hineinziehen der Bedingungen, die Abfrage läse jeden Ort. Die Eigenschaften (`subtype`, `capital_bands`) sind
 *   dieselben Spalten, aus denen die Sicht sie bildet.
 * - Die Kachel ist die zweite Datei des Assets (`photobox_kachel`); sie fehlt, solange der Abgleich sie nicht nachgezogen hat.
 */
function reisebilderQuery(auswahl: string): string {
    return `
    WITH u AS (
        SELECT 'binding' AS "usageKind", m.role, 0 AS sort_order, m.id AS usage_id, m.media_asset_id,
               m.publication_override AS override, m.retired_at IS NOT NULL AS retired, FALSE AS suppressed,
               s.public_id::text AS submission_id, ST_X(s.geom) AS "lageX", ST_Y(s.geom) AS "lageY",
               s.description, s.attribution_name AS name, s.creation_kind AS entstehung, s.usage_grant AS nutzung,
               s.view_direction::int AS blickrichtung,
               p.public_id::text AS "ortId", p.name AS "ortName", p.subtype AS "ortSubtype",
               ST_X(p.geom) AS "ortX", ST_Y(p.geom) AS "ortY", tcb.bands AS "ortBands",
               coalesce(pg.gefaellt, 0) AS gefaellt
          FROM media_submission s
          JOIN photobox_media m ON m.media_submission_id = s.id AND m.retired_at IS NULL
          LEFT JOIN photobox_gefaellt pg ON pg.media_submission_id = s.id
          LEFT JOIN place p ON p.id = s.place_id AND p.is_active AND NOT p.is_hidden
          LEFT JOIN territory_capital_band tcb ON tcb.place_public_id = p.public_id
         WHERE s.state = 'approved'
           AND ${auswahl}
           AND EXISTS (
               SELECT 1 FROM media_file pf
                WHERE pf.media_asset_id = m.media_asset_id AND pf.storage_class = 'published'
                  AND pf.variant = '${PUBLISHED_VARIANT.photobox}'
           )
         ORDER BY s.public_id
         LIMIT $1::int
    )
    SELECT u."usageKind", u.role, u.override, u.retired, u.suppressed, u."lageX", u."lageY", u.description, u.name, u.entstehung,
           u.nutzung, u.blickrichtung, u."ortId", u."ortName", u."ortSubtype", u."ortX", u."ortY", u."ortBands", u.gefaellt,
           k.sha256 AS "kachelSha256", k.width AS "kachelWidth", k.height AS "kachelHeight",
           ${ASSET_COLUMNS}
    FROM u ${ASSET_JOINS}
    LEFT JOIN LATERAL (
        SELECT kf.sha256, kf.width, kf.height
        FROM media_file kf
        WHERE kf.media_asset_id = a.id AND kf.storage_class = 'published' AND kf.variant = '${PHOTOBOX_KACHEL_VARIANT}'
        ORDER BY kf.created_at DESC, kf.id DESC
        LIMIT 1
    ) k ON TRUE
    ORDER BY u.submission_id
`;
}

export const REISEBILDER_QUERY = reisebilderQuery(
    `s.geom && ST_MakeEnvelope($${String(ECKE)}::float8, $${String(ECKE + 1)}::float8, $${String(ECKE + 2)}::float8, $${String(ECKE + 3)}::float8, 0)`,
);

/** Dasselbe für EINE Einreichung (`resolveReisebild`): Hinter den Varianten der Rollen steht ihre Kennung. */
const REISEBILD_EINER_QUERY = reisebilderQuery(`s.id = $${String(ECKE)}::bigint`);

/** Die Parameter der Abfrage in der Reihenfolge, die sie erwartet: Grenze + 1, die Varianten der Rollen, die vier Ecken. */
export function reisebilderParameter(ausschnitt: ReisebilderAusschnitt, grenze: number): (string | number)[] {
    return [grenze + 1, ...VARIANT_PARAMS, ausschnitt.x0, ausschnitt.y0, ausschnitt.x1, ausschnitt.y1];
}

/**
 * Die Reisebilder im Ausschnitt, die Besucher sehen dürfen (WI-0272 S4, Aufgabe 23): höchstens `grenze`, öffentlich, über die EINE Entscheidung
 * (`decidePublication`) mit den Inhaltsschaltern und dem Notaus. Ein Bild ohne öffentliche Datei, mit abgeschaltetem Schalter `media.role.photobox`, offline
 * genommen oder unter Notaus erscheint nicht. `an` ist falsch, wenn der Schalter der Rolle aus ist (dann bleibt die Liste leer, ohne die Bilder zu lesen);
 * `gekappt` heißt: Es gibt mehr als `grenze`.
 *
 * 🔴 Die Antwort trägt nur, was `ReisebildKarte` nennt: nie einen Schlüssel, nie die Prüfsumme des Originals, nie einen Zustand der Einreichung. Die Zeilen
 * laden weder die wartende Beschreibung noch die Nachricht der Redaktion.
 */
export async function resolveReisebilder(
    database: Queryable,
    ausschnitt: ReisebilderAusschnitt,
    grenze: number,
): Promise<ReisebilderAntwort> {
    const stand = await lesestand(database);
    if (stand.switches.isOff(MEDIA_ROLE_SWITCH["photobox"] ?? "media.role.photobox"))
        return { an: false, bilder: [], gekappt: false };
    const rows = await database.unsafe<ReisebildRow[]>(
        REISEBILDER_QUERY,
        reisebilderParameter(ausschnitt, grenze) as never,
    );
    const bilder: ReisebildKarte[] = [];
    for (const row of rows.slice(0, grenze)) {
        const karte = reisebildKarteVon(row, stand);
        if (karte !== undefined) bilder.push(karte);
    }
    return { an: true, bilder, gekappt: rows.length > grenze };
}

/**
 * Das Reisebild EINER freigegebenen Einreichung, wie die Karte es kennt (`PhotoboxStatus.karte`): über dieselbe Entscheidung wie `resolveReisebilder`. `undefined`, wenn Besucher es nicht sehen dürfen.
 */
export async function resolveReisebild(
    database: Queryable,
    einreichungId: string,
): Promise<ReisebildKarte | undefined> {
    const stand = await lesestand(database);
    if (stand.switches.isOff(MEDIA_ROLE_SWITCH["photobox"] ?? "media.role.photobox")) return undefined;
    const [row] = await database.unsafe<ReisebildRow[]>(REISEBILD_EINER_QUERY, [
        1,
        ...VARIANT_PARAMS,
        einreichungId,
    ] as never);
    return row === undefined ? undefined : reisebildKarteVon(row, stand);
}

/** Eine Zeile des Lesepfads als Karte; `undefined` ohne veröffentlichte Datei oder ohne Erlaubnis der Entscheidung. */
function reisebildKarteVon(row: ReisebildRow, stand: Lesestand): ReisebildKarte | undefined {
    const datei = veroeffentlichteDatei(row);
    if (datei === null || !entscheide(row, stand).allowed) return undefined;
    const kachel =
        row.kachelSha256 !== null && row.kachelWidth !== null && row.kachelHeight !== null
            ? { url: mediaPublicUrl(row.kachelSha256), breite: row.kachelWidth, hoehe: row.kachelHeight }
            : undefined;
    const ort =
        row.ortId !== null && row.ortName !== null && row.ortSubtype !== null && row.ortX !== null && row.ortY !== null
            ? {
                  id: row.ortId,
                  name: row.ortName,
                  lage: { x: row.ortX, y: row.ortY },
                  subtype: row.ortSubtype,
                  ...(row.ortBands === null ? {} : { capitalBands: row.ortBands }),
              }
            : undefined;
    return {
        id: row.assetPublicId,
        lage: { x: row.lageX, y: row.lageY },
        datei: { url: mediaPublicUrl(datei.sha256), breite: datei.width, hoehe: datei.height },
        ...(kachel === undefined ? {} : { kachel }),
        beschreibung: row.description,
        ...(row.name === null ? {} : { name: row.name }),
        entstehung: row.entstehung,
        // CC BY verlangt die Nennung der Lizenz; fehlt der Katalogeintrag, steht der Name der Lizenz trotzdem da.
        ...(row.nutzung === "cc-by-4.0"
            ? {
                  lizenz: {
                      name: row.licenseName ?? "CC BY 4.0",
                      ...(row.licenseUri === null ? {} : { uri: row.licenseUri }),
                  },
              }
            : {}),
        ...(row.blickrichtung === null ? {} : { blickrichtung: row.blickrichtung }),
        // Die anonyme Zahl „Gefällt mir“ (WI-0304); 0 lässt die Antwort so klein wie vorher.
        ...(row.gefaellt > 0 ? { gefaellt: row.gefaellt } : {}),
        ...(ort === undefined ? {} : { ort }),
    };
}
