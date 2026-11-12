import type { MediaRole, MediaUsageSubjectKind } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { activeUsagesSql } from "./usage-sql.ts";

/**
 * Der Name eines Assets aus dem Fachobjekt, an dem es hängt (WI-0068, Betreiber 2026-10-10, wörtlich: „wichtig wärs mir, dass du den
 * neuen Namen des assets, den es heut nicht gibt, aus dem name des objekts zugewiesen ist, das es hat. wenn mehrere sind, nummeriere
 * automatisch. also Gareths Wappen ist "Wappen von Gareth" bzd. "Bild von Gareth (1)" usw.“).
 *
 * Die Regel, EINE Stelle für Import (`migrate:media`), Bindungsoperationen (P4a) und Nachtrag (`media:titel`):
 *   - „<Wort der Rolle> von <Objektname>“, das Wort aus `MEDIA_TITLE_ROLES` (eine Tafel, Begründung je Wort in WI-0068);
 *   - der Name eines Werks oder einer Karte steht in „…“ (`QUOTED_SUBJECTS`): Werktitel beginnen mit Artikeln und enden oft mit einer
 *     Jahreszahl in Klammern („Die Flusslande (2023)“), unsere Nummer stünde sonst direkt daneben;
 *   - Bilder tragen IMMER eine Nummer, alle anderen Rollen nur, wenn das Objekt mehrere Assets dieser Rolle hat;
 *   - die Nummer ist der Platz in der Galerie (1, 2, …), sonst die Folge der Bindungen nach Alter; ist der Name schon an ein anderes Asset
 *     desselben Objekts in derselben Rolle vergeben, die kleinste freie Nummer;
 *   - hängt ein Asset an mehreren Objekten, gibt die ÄLTESTE aktive Bindung den Namen (die erste Verwendung ist die, für die das Bild kam;
 *     eine spätere Bindung ändert einen einmal gesetzten Namen nie, und eine neue Bindung verschiebt die Wahl nicht);
 *   - ergeben verschiedene Objekte in derselben Rolle denselben Namen, folgt bei ALLEN die Art des Objekts nach einem Komma, ohne Klammer
 *     (Betreiber 2026-10-11, wörtlich: „ah dann 12 Wappen von Fasar, Stadt ohne klammer“): „Wappen von Fasar, Stadt“ und „Wappen von
 *     Fasar, Gebiet“, „Umschlag von „Havena“, Gruppenabenteuer DSA5“ (`subjectKindLabel`). Bleibt der Name auch dann gleich, zählt eine
 *     Nummer die Objekte nach ihrer ältesten Bindung: „Umschlag von „Rohals Erben“, Spielhilfe DSA5 (1)“. Trägt das Asset dazu seine
 *     eigene Nummer (ein Bild), stehen beide in einer Klammer, das Objekt zuerst: „Bild von Eichenau, Dorf (2.1)“;
 *   - gesetzt wird ein leerer Titel, nie einer, den ein Mensch gesetzt hat (Fachprotokoll `asset.metadata_set` mit dem Feld `title`, auch
 *     ein bewusst geleerter, oder ein Name beim Hochladen). Ein Import überschreibt keinen Titel. Nur der Nachtrag (`media:titel`,
 *     `renameSystem`) benennt dazu einen Namen des Systems neu, der durch die Unterscheidung oben nicht mehr eindeutig ist; die
 *     eigene Nummer des Assets bleibt dabei.
 *   - Wird das Objekt umbenannt, folgt der Titel NICHT von selbst (Entscheidung in WI-0068): Er ist ein gespeichertes Feld mit Revision,
 *     kein Spiegel; ein Spiegel risse bei jedem Zug aus Legacy die Revisionen der Assets mit.
 */

/** Das Wort je Rolle und ob es immer eine Nummer trägt (`always`) oder nur bei mehreren Assets der Rolle am Objekt (`several`). */
export const MEDIA_TITLE_ROLES: Readonly<Record<MediaRole, { word: string; numbered: "always" | "several" }>> = {
    coat: { word: "Wappen", numbered: "several" },
    header: { word: "Bild", numbered: "always" },
    literature_cover: { word: "Umschlag", numbered: "several" },
    map_preview: { word: "Vorschau", numbered: "several" },
    map_full: { word: "Karte", numbered: "several" },
    photobox: { word: "Reisebild", numbered: "several" },
    social_post: { word: "Beitragsbild", numbered: "several" },
};

/** Fachobjekte, deren Name ein Werktitel ist: er steht in deutschen Anführungszeichen. */
const QUOTED_SUBJECTS: ReadonlySet<MediaUsageSubjectKind> = new Set(["adventure", "citymap"]);

/** Reihenfolge der Fachobjektarten, wenn zwei Bindungen gleich alt sind. */
const SUBJECT_ORDER: Readonly<Record<MediaUsageSubjectKind, number>> = {
    place: 0,
    territory: 1,
    adventure: 2,
    citymap: 3,
};

/** Ein Ort heißt nach seiner Größe; jede Stadtgröße ist „Stadt“ (Beispiel des Betreibers: Fasar führen wir als Metropole). */
const PLACE_KINDS: Readonly<Record<string, string>> = {
    metropole: "Stadt",
    grossstadt: "Stadt",
    stadt: "Stadt",
    kleinstadt: "Stadt",
    dorf: "Dorf",
    gebaeude: "Gebäude",
    stadtviertel: "Stadtviertel",
};

/** Die Art eines Werks (Legacys Vokabular in `adventure.product_type`); ein unbekanntes Wort steht groß geschrieben da. */
const WORK_KINDS: Readonly<Record<string, string>> = {
    gruppenabenteuer: "Gruppenabenteuer",
    szenario: "Szenario",
    roman: "Roman",
    kurzgeschichte: "Kurzgeschichte",
    spielhilfe: "Spielhilfe",
    anthologie: "Anthologie",
    kurzabenteuer: "Kurzabenteuer",
    soloabenteuer: "Soloabenteuer",
    regionalspielhilfe: "Regionalspielhilfe",
    kampagnenband: "Kampagnenband",
    metaband: "Metaband",
};

/** Was das Objekt über seine Art weiß (Ortsgröße; Art und Regelausgabe eines Werks). */
export interface TitleSubjectDetail {
    placeSubtype?: string | null | undefined;
    productType?: string | null | undefined;
    edition?: string | null | undefined;
}

/**
 * Die Art hinter dem Komma: „Stadt“, „Dorf“ …, „Gebiet“, bei einem Werk Art und Regelausgabe („Gruppenabenteuer DSA5“, ohne Ausgabe
 * „Roman“). `null`, wo es keine gibt (eine Karte): dann unterscheidet allein die Nummer.
 */
export function subjectKindLabel(kind: MediaUsageSubjectKind, detail: TitleSubjectDetail = {}): string | null {
    if (kind === "place") return PLACE_KINDS[detail.placeSubtype ?? ""] ?? "Ort";
    if (kind === "territory") return "Gebiet";
    if (kind !== "adventure") return null;
    const type = (detail.productType ?? "").trim();
    const word = WORK_KINDS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
    const edition = (detail.edition ?? "").trim();
    const label = [word, edition.toLowerCase() === "keine" ? "" : edition].filter((part) => part !== "").join(" ");
    return label === "" ? null : label;
}

/** Was einen Namen von dem eines anderen Objekts unterscheidet: die Art nach dem Komma, wenn nötig die Nummer des Objekts. */
export interface TitleDistinction {
    label: string | null;
    number: number | null;
}

export function derivedMediaTitle(
    role: MediaRole,
    subjectKind: MediaUsageSubjectKind,
    subjectName: string,
    number: number | null,
    distinction?: TitleDistinction,
): string {
    const name = subjectName.trim();
    const shown = QUOTED_SUBJECTS.has(subjectKind) ? `„${name}“` : name;
    const label = distinction?.label ? `, ${distinction.label}` : "";
    const numbers = [distinction?.number ?? null, number].filter((entry): entry is number => entry !== null);
    const suffix = numbers.length === 0 ? "" : ` (${numbers.map(String).join(".")})`;
    return `${MEDIA_TITLE_ROLES[role].word} von ${shown}${label}${suffix}`;
}

/** Die eigene Nummer eines Namens nach der Regel ohne Unterscheidung, `null` ohne Nummer; `undefined`, wenn er nicht so gebaut ist. */
function plainNumber(title: string, plain: string): number | null | undefined {
    if (title === plain) return null;
    const match = title.startsWith(`${plain} (`) ? /^ \((\d+)\)$/.exec(title.slice(plain.length)) : null;
    return match === null ? undefined : Number(match[1]);
}

/** Eine aktive Verwendung, wie die Namensregel sie braucht. */
export interface TitleUsage {
    assetId: string;
    subjectKind: MediaUsageSubjectKind;
    subjectId: string;
    subjectName: string;
    role: MediaRole;
    via: "binding" | "gallery";
    /** Platz in der Galerie (`sort_order`); `null` bei einer direkten Bindung. */
    position: number | null;
    /** Anlage der Bindung oder des Galerieeintrags. */
    boundAt: Date;
    /** Die Art des Objekts für die Unterscheidung gleicher Namen (`subjectKindLabel`); fehlt sie, unterscheidet die Nummer. */
    subjectLabel?: string | null | undefined;
}

/** Ein Asset mit seinem Titel und ob ein Mensch ihn gesetzt hat (im Inspector oder als Name beim Hochladen). */
export interface TitleAsset {
    assetId: string;
    title: string | null;
    humanTitle: boolean;
}

const isEmpty = (title: string | null): boolean => title === null || title.trim() === "";
const groupKey = (usage: TitleUsage): string => `${usage.subjectKind}:${usage.subjectId}:${usage.role}`;

function byGroupOrder(a: TitleUsage, b: TitleUsage): number {
    return (
        (a.via === "binding" ? 0 : 1) - (b.via === "binding" ? 0 : 1) ||
        (a.position ?? 0) - (b.position ?? 0) ||
        a.boundAt.getTime() - b.boundAt.getTime() ||
        Number(a.assetId) - Number(b.assetId)
    );
}

function byAge(a: TitleUsage, b: TitleUsage): number {
    return (
        a.boundAt.getTime() - b.boundAt.getTime() ||
        (a.via === "binding" ? 0 : 1) - (b.via === "binding" ? 0 : 1) ||
        SUBJECT_ORDER[a.subjectKind] - SUBJECT_ORDER[b.subjectKind] ||
        a.subjectId.localeCompare(b.subjectId) ||
        a.role.localeCompare(b.role)
    );
}

const subjectKey = (usage: TitleUsage): string => `${usage.subjectKind}:${usage.subjectId}`;

/**
 * Je Objekt und Rolle die Unterscheidung, wo verschiedene Objekte denselben Namen ergäben (Betreiber 2026-10-11). Die Objekte stehen
 * nach ihrer ältesten Bindung in der Rolle; danach zählt die Nummer, wo auch die Art gleich ist.
 */
function distinctionsOf(usages: readonly TitleUsage[]): Map<string, TitleDistinction> {
    const byName = new Map<string, Map<string, TitleUsage>>();
    for (const usage of [...usages].sort(byAge)) {
        const name = `${usage.role}|${derivedMediaTitle(usage.role, usage.subjectKind, usage.subjectName, null)}`;
        const subjects = byName.get(name) ?? new Map<string, TitleUsage>();
        if (!subjects.has(subjectKey(usage))) subjects.set(subjectKey(usage), usage);
        byName.set(name, subjects);
    }
    const result = new Map<string, TitleDistinction>();
    for (const subjects of byName.values()) {
        if (subjects.size < 2) continue;
        const byLabel = new Map<string, TitleUsage[]>();
        for (const first of subjects.values()) {
            const same = byLabel.get(first.subjectLabel ?? "") ?? [];
            same.push(first);
            byLabel.set(first.subjectLabel ?? "", same);
        }
        for (const same of byLabel.values()) {
            for (const [index, first] of same.entries()) {
                result.set(groupKey(first), {
                    label: first.subjectLabel ?? null,
                    number: same.length > 1 ? index + 1 : null,
                });
            }
        }
    }
    return result;
}

/**
 * Die Namen für die Assets ohne Titel (rein, ohne Datenbank). `only`: nur diese Assets benennen (eine Bindungsoperation); die übrigen
 * Assets ihrer Gruppen zählen trotzdem für Platz und vergebene Namen. `renameSystem` (nur der Nachtrag): dazu jeder Name des Systems,
 * der jetzt eine Unterscheidung braucht, mit seiner eigenen Nummer. Ergebnis: Asset → Name.
 */
export function planAssetTitles(
    usages: readonly TitleUsage[],
    assets: readonly TitleAsset[],
    only?: ReadonlySet<string>,
    options: { renameSystem?: boolean } = {},
): Map<string, string> {
    const assetById = new Map(assets.map((asset) => [asset.assetId, asset]));
    // Die Quelle des Namens je Asset: seine älteste aktive Verwendung.
    const source = new Map<string, TitleUsage>();
    for (const usage of [...usages].sort(byAge)) {
        if (!source.has(usage.assetId)) source.set(usage.assetId, usage);
    }
    // Je Fachobjekt und Rolle die Assets in ihrer Folge (Galerie nach Platz, sonst nach Alter), jedes einmal.
    const groups = new Map<string, TitleUsage[]>();
    for (const usage of [...usages].sort(byGroupOrder)) {
        const group = groups.get(groupKey(usage)) ?? [];
        if (!group.some((entry) => entry.assetId === usage.assetId)) group.push(usage);
        groups.set(groupKey(usage), group);
    }

    const distinctions = distinctionsOf(usages);

    const planned = new Map<string, string>();
    for (const key of [...groups.keys()].sort()) {
        const group = groups.get(key)!;
        const distinction = distinctions.get(key);
        const nameable = (usage: TitleUsage): TitleAsset | undefined => {
            const asset = assetById.get(usage.assetId);
            return asset !== undefined &&
                !asset.humanTitle &&
                source.get(usage.assetId) === usage &&
                (only === undefined || only.has(usage.assetId))
                ? asset
                : undefined;
        };
        const used = new Set(
            group.map((usage) => assetById.get(usage.assetId)?.title?.trim() ?? "").filter((title) => title !== ""),
        );
        for (const [index, usage] of group.entries()) {
            const asset = nameable(usage);
            if (asset === undefined) continue;
            const title = (number: number | null): string =>
                derivedMediaTitle(usage.role, usage.subjectKind, usage.subjectName, number, distinction);
            if (!isEmpty(asset.title)) {
                // Ein Name des Systems ohne die Unterscheidung, die er jetzt braucht: neu, mit seiner eigenen Nummer.
                if (options.renameSystem !== true || distinction === undefined) continue;
                const plain = derivedMediaTitle(usage.role, usage.subjectKind, usage.subjectName, null);
                const own = plainNumber(asset.title!.trim(), plain);
                if (own === undefined || used.has(title(own))) continue;
                used.add(title(own));
                planned.set(usage.assetId, title(own));
                continue;
            }
            const numbered = MEDIA_TITLE_ROLES[usage.role].numbered === "always" || group.length > 1;
            let name = title(numbered ? index + 1 : null);
            if (used.has(name)) {
                let free = 1;
                while (used.has(title(free))) free += 1;
                name = title(free);
            }
            used.add(name);
            planned.set(usage.assetId, name);
        }
    }
    return planned;
}

interface UsageRow {
    asset_id: string;
    subject_kind: MediaUsageSubjectKind;
    subject_id: string;
    subject_name: string;
    role: MediaRole;
    via: "binding" | "gallery";
    position: number | null;
    bound_at: Date;
    place_subtype: string | null;
    product_type: string | null;
    edition: string | null;
}

/**
 * Die Verwendungen, die die Namen der genannten Assets bestimmen: ihre eigenen, alle der Gruppen (Fachobjekt und Rolle), in denen sie
 * hängen, und die anderer Objekte gleichen Namens in derselben Rolle (für die Unterscheidung). Ohne Liste alle. Nur Verwendungen an
 * einem Fachobjekt mit Namen (eine Galerie ohne Bindung gibt keinen). Dazu je Objekt, was seine Art sagt.
 */
async function readTitleUsages(tx: Queryable, assetIds: readonly string[] | null): Promise<TitleUsage[]> {
    const rows = await tx.unsafe<UsageRow[]>(
        `WITH u AS MATERIALIZED (${activeUsagesSql("")})
         SELECT u.asset_id::text AS asset_id, u.subject_kind, u.subject_id, u.subject_name, u.role, u.via, u.position, u.bound_at,
                p.subtype AS place_subtype, w.product_type, w.edition
           FROM u
           LEFT JOIN place p ON u.subject_kind = 'place' AND p.public_id::text = u.subject_id
           LEFT JOIN adventure w ON u.subject_kind = 'adventure' AND w.public_id::text = u.subject_id
          WHERE u.subject_id IS NOT NULL AND u.role IS NOT NULL AND btrim(coalesce(u.subject_name, '')) <> ''
            AND ($1::bigint[] IS NULL
                 OR u.asset_id = ANY($1::bigint[])
                 OR (u.subject_kind, u.subject_id, u.role) IN (
                        SELECT subject_kind, subject_id, role FROM u WHERE asset_id = ANY($1::bigint[]))
                 OR (u.role, btrim(u.subject_name)) IN (
                        SELECT role, btrim(subject_name) FROM u WHERE asset_id = ANY($1::bigint[])))`,
        [assetIds === null ? null : (assetIds as string[])] as never[],
    );
    return rows.map((row) => ({
        assetId: row.asset_id,
        subjectKind: row.subject_kind,
        subjectId: row.subject_id,
        subjectName: row.subject_name,
        role: row.role,
        via: row.via,
        position: row.position,
        boundAt: row.bound_at,
        subjectLabel: subjectKindLabel(row.subject_kind, {
            placeSubtype: row.place_subtype,
            productType: row.product_type,
            edition: row.edition,
        }),
    }));
}

/**
 * Titel und „ein Mensch hat ihn gesetzt“ der genannten Assets: Fachprotokoll `asset.metadata_set` mit dem Feld `title`, oder ein Name
 * beim Hochladen im Editor (ein Upload mit Titel, den nicht die Bindung abgeleitet hat, `asset.title_derived`).
 */
async function readTitleAssets(tx: Queryable, assetIds: readonly string[]): Promise<TitleAsset[]> {
    if (assetIds.length === 0) return [];
    const rows = await tx.unsafe<{ id: string; title: string | null; human: boolean }[]>(
        `SELECT a.id::text AS id, a.title,
                (EXISTS (SELECT 1 FROM media_audit_event e
                          WHERE e.media_asset_public_id = a.public_id AND e.action = 'asset.metadata_set'
                            AND e.details -> 'fields' ? 'title')
                 OR (a.origin = 'editor_upload' AND btrim(coalesce(a.title, '')) <> ''
                     AND NOT EXISTS (SELECT 1 FROM media_audit_event e
                                      WHERE e.media_asset_public_id = a.public_id AND e.action = 'asset.title_derived'))) AS human
           FROM media_asset a
          WHERE a.id = ANY($1::bigint[])`,
        [assetIds as string[]],
    );
    return rows.map((row) => ({ assetId: row.id, title: row.title, humanTitle: row.human }));
}

/**
 * Der Name, den ein NEUES Asset nach der Regel bekäme, wenn es jetzt an das Objekt gebunden würde (WI-0068 P4b 7b): ein gedachtes Asset
 * ohne Titel mit einer Bindung von jetzt. Ein neues Wappen ersetzt das bisherige (dessen Bindung zählt nicht), ein neues Titelbild kommt
 * hinten an die Galerie. Dieselbe Rechnung wie beim Binden (`planAssetTitles`), also derselbe Name, solange sich dazwischen nichts ändert.
 */
export async function suggestedTitles(
    tx: Queryable,
    subject: { kind: MediaUsageSubjectKind; publicId: string; name: string; placeSubtype?: string | null },
    roles: readonly MediaRole[],
): Promise<Map<MediaRole, string | null>> {
    const result = new Map<MediaRole, string | null>(roles.map((role) => [role, null]));
    if (subject.name.trim() === "" || roles.length === 0) return result;
    const all = await readTitleUsages(tx, null);
    const assets = await readTitleAssets(tx, [...new Set(all.map((usage) => usage.assetId))]);
    const NEU = "0";
    for (const role of roles) {
        const gleich = (usage: TitleUsage): boolean =>
            usage.subjectKind === subject.kind && usage.subjectId === subject.publicId && usage.role === role;
        const usages = role === "header" ? all : all.filter((usage) => !gleich(usage));
        const position =
            role === "header" ? Math.max(-1, ...all.filter(gleich).map((usage) => usage.position ?? -1)) + 1 : null;
        const neu: TitleUsage = {
            assetId: NEU,
            subjectKind: subject.kind,
            subjectId: subject.publicId,
            subjectName: subject.name,
            role,
            via: role === "header" ? "gallery" : "binding",
            position,
            boundAt: new Date(),
            subjectLabel: subjectKindLabel(subject.kind, { placeSubtype: subject.placeSubtype ?? null }),
        };
        const plan = planAssetTitles(
            [...usages, neu],
            [...assets, { assetId: NEU, title: null, humanTitle: false }],
            new Set([NEU]),
        );
        result.set(role, plan.get(NEU) ?? null);
    }
    return result;
}

export interface NamedAsset {
    assetId: string;
    publicId: string;
    title: string;
    revision: number;
    role: MediaRole;
    subject: string;
}

/** Ein Name des Systems, den der Nachtrag unterscheidet (`renameSystem`). */
export interface RenamedAsset extends NamedAsset {
    before: string;
}

export interface TitleResult {
    /** Die benannten Assets (in dieser Transaktion geschrieben). */
    named: NamedAsset[];
    /** Die neu benannten Namen des Systems (nur mit `renameSystem`). */
    renamed: RenamedAsset[];
    /** Assets ohne Titel, die ein Mensch bewusst leer ließ: nicht angefasst. */
    keptHuman: number;
    /** Assets ohne Titel und ohne aktive Verwendung an einem Fachobjekt: es gibt keinen Namen. */
    withoutSubject: number;
}

/**
 * Benennt die Assets ohne Titel nach der Regel oben, in der Transaktion des Aufrufers (Import, Bindung, Nachtrag). Ohne `assetIds` alle.
 * `renameSystem` (nur der Nachtrag): dazu die Namen des Systems, die jetzt eine Unterscheidung brauchen. Wiederholbar: ein zweiter Lauf
 * findet nichts mehr und schreibt nichts.
 */
export async function nameUntitledAssets(
    tx: Queryable,
    options: { assetIds?: readonly string[]; renameSystem?: boolean } = {},
): Promise<TitleResult> {
    const scope = options.assetIds ?? null;
    if (scope !== null && scope.length === 0) return { named: [], renamed: [], keptHuman: 0, withoutSubject: 0 };
    const usages = await readTitleUsages(tx, scope);
    const assets = await readTitleAssets(tx, [...new Set(usages.map((usage) => usage.assetId))]);
    const only = scope === null ? undefined : new Set(scope);
    const all = planAssetTitles(usages, assets, only, { renameSystem: options.renameSystem === true });
    const titleOf = new Map(assets.map((asset) => [asset.assetId, asset.title]));
    const plan = new Map([...all].filter(([id]) => isEmpty(titleOf.get(id) ?? null)));
    const renames = [...all].filter(([id]) => !isEmpty(titleOf.get(id) ?? null));

    const [untitled] = await tx.unsafe<{ without_subject: number }[]>(
        `SELECT count(*)::int AS without_subject
           FROM media_asset a
          WHERE (a.title IS NULL OR btrim(a.title) = '')
            AND ($1::bigint[] IS NULL OR a.id = ANY($1::bigint[]))
            AND NOT (a.id = ANY($2::bigint[]))`,
        [scope === null ? null : (scope as string[]), [...new Set(usages.map((usage) => usage.assetId))]] as never[],
    );
    const inScope = (assetId: string): boolean => only === undefined || only.has(assetId);
    const keptHuman = assets.filter(
        (asset) => inScope(asset.assetId) && isEmpty(asset.title) && asset.humanTitle,
    ).length;

    const sourceOf = new Map<string, TitleUsage>();
    for (const usage of [...usages].sort(byAge)) if (!sourceOf.has(usage.assetId)) sourceOf.set(usage.assetId, usage);
    const described = (row: { id: string; public_id: string; title: string; revision: number }): NamedAsset => {
        const usage = sourceOf.get(row.id)!;
        return {
            assetId: row.id,
            publicId: row.public_id,
            title: row.title,
            revision: row.revision,
            role: usage.role,
            subject: `${usage.subjectKind}:${usage.subjectId}`,
        };
    };
    const byId = (a: NamedAsset, b: NamedAsset): number => Number(a.assetId) - Number(b.assetId);

    const renamedRows =
        renames.length === 0
            ? []
            : await tx.unsafe<{ id: string; public_id: string; title: string; revision: number; before: string }[]>(
                  `UPDATE media_asset a
                      SET title = v.title, updated_at = now()
                     FROM unnest($1::bigint[], $2::text[], $3::text[]) AS v(id, title, before)
                    WHERE a.id = v.id AND a.title = v.before
                   RETURNING a.id::text AS id, a.public_id::text AS public_id, a.title, a.revision::int AS revision, v.before`,
                  [
                      renames.map(([id]) => id),
                      renames.map(([, title]) => title),
                      renames.map(([id]) => titleOf.get(id)!),
                  ] as never[],
              );
    const renamed = renamedRows.map((row) => ({ ...described(row), before: row.before })).sort(byId);

    const ids = [...plan.keys()];
    if (ids.length === 0) return { named: [], renamed, keptHuman, withoutSubject: untitled?.without_subject ?? 0 };
    const rows = await tx.unsafe<{ id: string; public_id: string; title: string; revision: number }[]>(
        `UPDATE media_asset a
            SET title = v.title, updated_at = now()
           FROM unnest($1::bigint[], $2::text[]) AS v(id, title)
          WHERE a.id = v.id AND (a.title IS NULL OR btrim(a.title) = '')
         RETURNING a.id::text AS id, a.public_id::text AS public_id, a.title, a.revision::int AS revision`,
        [ids, ids.map((id) => plan.get(id)!)] as never[],
    );
    const named = rows.map(described).sort(byId);
    return { named, renamed, keptHuman, withoutSubject: untitled?.without_subject ?? 0 };
}
