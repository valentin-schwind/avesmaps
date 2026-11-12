import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import {
    KARTE_VORSCHAU_SPERREN,
    MEDIA_BINDING_ORIGINS,
    MEDIA_EDITOR_URL,
    MEDIA_PUBLICATION_OVERRIDES,
    MEDIA_TECHNICAL_STATES,
    MediaPreview,
    MediaPrivatePreview,
    MediaUsagePublication,
} from "./media-editor.ts";
import { INHALTE_SEITEN_MAX, InhalteUmschlag } from "./inhalte-quellen.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";
import { SOURCE_TYPES } from "./subject.ts";

/**
 * Die Kartensammlung in der Medienverwaltung (WI-0068 R5, Leseansicht; Einordnung im Work Item „MAM-R5 Kartensammlung“). Eine Karte ist
 * die Zeile `citymap` aus Legacy (Migration 0069) samt Typen, Orten, Verweisen, Bezügen, Quellen und Wiki-Zuordnung; ihre Bilder sind
 * gewöhnliche Werke (`media_asset`) in den Rollen `map_full` und `map_preview` über `citymap_media`. 🔴 Kein zweites Modell: Diese
 * Verträge lesen und ändern die Tafeln aus 0069 (Bearbeiten: Betreiber 2026-10-18 „B jetzt“; Revision und Protokollziel in 0197).
 *
 * 🔴 Was unbekannt ist, bleibt `null` (die dreiwertigen Merkmale, Farbe, Art), nie `false` oder leerer Text: dieselbe Regel wie das
 * Katalogfenster (`subjects/sections/citymaps.ts`). `validToBf` 9999 ist Legacys offenes Ende und steht so da.
 */

const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const Uuid = () => Type.String({ pattern: UUID_PATTERN });

export const MEDIA_KARTEN_URL = `${MEDIA_EDITOR_URL}/citymaps`;
export const mediaKarteUrl = (id: string): string => `${MEDIA_KARTEN_URL}/${encodeURIComponent(id)}`;
/** `POST`: die Eigenschaften und Typen einer Karte ändern (`citymap.update`). */
export const mediaKarteAendernUrl = (id: string): string => `${mediaKarteUrl(id)}/update`;
/** `POST`: einen Eintrag entfernen (stilllegen, `citymap.retire`) und zurückholen (`citymap.restore`), WI-0287. */
export const mediaKarteStilllegenUrl = (id: string): string => `${mediaKarteUrl(id)}/retire`;
export const mediaKarteZurueckholenUrl = (id: string): string => `${mediaKarteUrl(id)}/restore`;
/** `POST`: ein Werk an den Eintrag binden (`citymap.image`): eine Karte kommt als weitere Version dazu, eine Vorschau ersetzt die bisherige. */
export const mediaKarteBildUrl = (id: string): string => `${mediaKarteUrl(id)}/image`;
/** `POST`: ein Bild vom Eintrag lösen (`citymap.image_remove`), eine Version der Karte oder die Vorschau; das Werk bleibt in der Liste. */
export const mediaKarteBildLoesenUrl = (id: string): string => `${mediaKarteUrl(id)}/image/remove`;
/** `POST`: Bezeichnung oder Reihenfolge einer Version der Karte (`citymap.version`), WI-0287 Stufe 2. */
export const mediaKarteVersionUrl = (id: string): string => `${mediaKarteUrl(id)}/version`;
/** `POST`: die Bilder und Angaben des Eintrags an einen anderen geben und ihn stilllegen, in einem Zug (`citymap.merge`), WI-0287 Stufe 2. */
export const mediaKarteZusammenlegenUrl = (id: string): string => `${mediaKarteUrl(id)}/merge`;
/** `POST`: die Fundstellen (Links) eines Eintrags ersetzen (`citymap.links`), WI-0287. */
export const mediaKarteLinksUrl = (id: string): string => `${mediaKarteUrl(id)}/links`;
/** `POST`: eine Publikation (Quelle) des Eintrags anhängen, ihre Fundstelle ändern, lösen, wiederherstellen oder zuerst zeigen (`citymap.sources`), WI-0287. */
export const mediaKarteQuellenUrl = (id: string): string => `${mediaKarteUrl(id)}/sources`;
/** `POST`: einen Ort oder eine Region am Eintrag anhängen, lösen oder einer nicht aufgelösten Zeile zuordnen (`citymap.places`), WI-0287 Stufe 3. */
export const mediaKarteOrteUrl = (id: string): string => `${mediaKarteUrl(id)}/places`;
/** `POST`: aus der Karte des Eintrags eine Vorschau erzeugen (`citymap.preview_generate`), WI-0287 Punkt 5. */
export const mediaKarteVorschauUrl = (id: string): string => `${mediaKarteUrl(id)}/preview`;
/** `PUT`: eine Kartendatei bis 50 MB als Rohkörper hochladen (`MediaKarteDateiKopf`, Operation `asset.upload`). */
export const MEDIA_KARTE_DATEI_URL = `${MEDIA_KARTEN_URL}/datei`;

/** Die Werte aus den CHECKs von 0069; die Namen in der Oberfläche sind die des Katalogs (`catalog.citymaps.*`). */
export const KARTEN_ARTEN = ["politisch", "derographisch", "topologisch", "skizze"] as const;
export const KARTEN_FARBEN = ["graustufen", "braun", "farbig"] as const;
export const KARTEN_TYPEN = [
    "ortsplan",
    "stadtplan",
    "bezirk",
    "viertel",
    "lageplan",
    "uebersicht",
    "schauplatz",
    "grundriss",
    "befestigungen",
    "dungeon",
    "hoehlen",
    "krypten",
    "katakomben",
    "schatzkarte",
    "region",
    "sonstige",
] as const;
export const KARTEN_ZUSTAENDE = ["active", "retired", "suppressed"] as const;
export const KARTEN_HERKUENFTE = ["manual", "community", "wiki", "unknown"] as const;
export const KARTEN_BILDROLLEN = ["map_full", "map_preview"] as const;
/** Worauf ein Ort einer Karte zeigt (`citymap_place`: genau eines der Ziele oder keins). */
export const KARTEN_ZIELARTEN = ["place", "territory", "region", "terrain_peak", "path"] as const;
export const KARTEN_ZIELSTAENDE = ["resolved", "unresolved", "unmatched"] as const;

export type KarteArt = (typeof KARTEN_ARTEN)[number];
export type KarteTyp = (typeof KARTEN_TYPEN)[number];

export const MAM_KARTEN_SEITE = { default: 100, max: 200 } as const;

/** `GET /api/editor/media/citymaps`: Suche über Titel, Zeichner, Verlag und die Namen der Orte. */
export const MamKartenAnfrage = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAM_KARTEN_SEITE.max })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
        /** WI-0287: auch die stillgelegten (entfernten) Einträge liefern; ohne den Schalter nur die aktiven. */
        retired: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type MamKartenAnfrage = Static<typeof MamKartenAnfrage>;

/** Eine Zeile der Liste: genug, um die Karte zu erkennen; der Kreis kommt aus der Vorschau. */
export const MamKarteZeile = Type.Object(
    {
        id: Uuid(),
        title: Type.String(),
        art: nullable(oneOf(KARTEN_ARTEN)),
        types: Type.Array(oneOf(KARTEN_TYPEN)),
        places: Type.Integer({ minimum: 0 }),
        state: oneOf(KARTEN_ZUSTAENDE),
        active: Type.Boolean(),
        validFromBf: nullable(Type.Integer()),
        validToBf: nullable(Type.Integer()),
        /** Hat die Karte überhaupt ein Bild, und ist eines davon öffentlich? */
        images: Type.Integer({ minimum: 0 }),
        publicImages: Type.Integer({ minimum: 0 }),
        /** WI-0287 Stufe 2: wie viele Karten (`map_full`, Versionen) am Eintrag hängen; die Liste nennt sie ab zwei. Ein älterer Server liefert sie nicht. */
        versions: Type.Optional(Type.Integer({ minimum: 0 })),
        preview: nullable(MediaPreview),
        privatePreview: nullable(MediaPrivatePreview),
    },
    strict,
);
export type MamKarteZeile = Static<typeof MamKarteZeile>;

export const MamKartenListe = Type.Object(
    {
        items: Type.Array(MamKarteZeile),
        total: Type.Integer({ minimum: 0 }),
        /** WI-0287: wie viele Einträge stillgelegt sind (unabhängig von Suche und Schalter), für das Kästchen „Stillgelegte anzeigen“. */
        retiredTotal: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type MamKartenListe = Static<typeof MamKartenListe>;

/** Ein Bild der Karte: das Werk, seine Rolle und die Entscheidung der Policy genau an dieser Stelle (dieselbe wie Reverse Usage). */
export const MamKarteBild = Type.Object(
    {
        role: oneOf(KARTEN_BILDROLLEN),
        assetId: Uuid(),
        title: nullable(Type.String()),
        origin: oneOf(MEDIA_BINDING_ORIGINS),
        override: oneOf(MEDIA_PUBLICATION_OVERRIDES),
        publication: MediaUsagePublication,
        preview: nullable(MediaPreview),
        privatePreview: nullable(MediaPrivatePreview),
        /** WI-0287 Punkt 5: der technische Stand des Werks (`pending`: wird gerechnet, das Bild erscheint von selbst). Ein älterer Server liefert ihn nicht. */
        technicalState: Type.Optional(oneOf(MEDIA_TECHNICAL_STATES)),
        /** Nur an einer erzeugten Vorschau: die Karte, aus der sie entstand (Rechte und Notaus folgen ihr); `offline`: ihr Notaus gilt gerade auch hier. */
        erzeugtAus: Type.Optional(
            nullable(Type.Object({ assetId: Uuid(), title: nullable(Type.String()), offline: Type.Boolean() }, strict)),
        ),
        /** Nur an der Karte (`map_full`): warum „Vorschau erzeugen“ gesperrt ist; `null`: es geht. */
        vorschauSperre: Type.Optional(nullable(oneOf(KARTE_VORSCHAU_SPERREN))),
        /** WI-0287 Stufe 2, nur an einer Karte (`map_full`): die Bezeichnung der Version („Spielerversion“); `null`: ohne. Ein älterer Server liefert sie nicht. */
        versionLabel: Type.Optional(nullable(Type.String())),
        /** WI-0287 Stufe 2, nur an einer Karte: ihre Stelle unter den Versionen des Eintrags, ab 0 (die erste ist die Karte, aus der eine Vorschau entsteht). */
        versionPosition: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    strict,
);
export type MamKarteBild = Static<typeof MamKarteBild>;

const Bezug = Type.Object({ id: Uuid(), title: Type.String() }, strict);

/**
 * Eine Publikation eines Eintrags (WI-0287 Stufe 1, Punkt 4): eine Quelle des Katalogs an der Karte (`citymap_source`), in der Reihenfolge am Eintrag (`position`), in jedem Zustand.
 * Die erste aktive ist der Band, den Besucher zuerst sehen. Eine Quelle, die die Redaktion im Katalog stillgelegt hat, fehlt (wie im Infopanel).
 */
export const MamKartePublikation = Type.Object(
    {
        sourceId: Uuid(),
        title: Type.String(),
        sourceType: oneOf(SOURCE_TYPES),
        offiziell: Type.Boolean(),
        url: nullable(Type.String()),
        /** Die Fundstelle („Seite 42“). */
        pages: nullable(Type.String()),
        state: oneOf(KARTEN_ZUSTAENDE),
        /** Das Umschlagbild des Werks, nie über den Namen gefunden (`InhalteUmschlag`); `null`: keins. */
        umschlag: nullable(InhalteUmschlag),
    },
    strict,
);
export type MamKartePublikation = Static<typeof MamKartePublikation>;

export const MamKarteDetail = Type.Object(
    {
        id: Uuid(),
        /** Der gesehene Stand der Karte (ADR-0020, 0197); eine Änderung schickt ihn mit. */
        revision: Type.Integer({ minimum: 1 }),
        title: Type.String(),
        art: nullable(oneOf(KARTEN_ARTEN)),
        colorMode: nullable(oneOf(KARTEN_FARBEN)),
        isMultilevel: nullable(Type.Boolean()),
        isLabeled: nullable(Type.Boolean()),
        isOfficial: nullable(Type.Boolean()),
        isSpoiler: nullable(Type.Boolean()),
        hasScale: nullable(Type.Boolean()),
        widthPx: nullable(Type.Integer()),
        heightPx: nullable(Type.Integer()),
        format: nullable(Type.String()),
        validFromBf: nullable(Type.Integer()),
        validToBf: nullable(Type.Integer()),
        author: nullable(Type.String()),
        publisher: nullable(Type.String()),
        note: nullable(Type.String()),
        /** INTERN: Legacys Schlüssel des Wiki-Baus, keine Identität. */
        legacyWikiKey: nullable(Type.String()),
        legacyOrigin: oneOf(KARTEN_HERKUENFTE),
        state: oneOf(KARTEN_ZUSTAENDE),
        active: Type.Boolean(),
        importedAt: nullable(Type.String({ format: "date-time" })),
        /** Ein Mensch hat die Karte hier geändert: Der Legacy-Zug lässt sie samt Typen, Orten und Fundstellen stehen (Befund statt Überschreiben). */
        editorHeld: Type.Boolean(),
        parent: nullable(Bezug),
        related: Type.Array(Bezug),
        types: Type.Array(oneOf(KARTEN_TYPEN)),
        places: Type.Array(
            Type.Object(
                {
                    name: Type.String(),
                    target: nullable(
                        Type.Object(
                            {
                                kind: oneOf(KARTEN_ZIELARTEN),
                                id: Uuid(),
                                name: Type.String(),
                                active: Type.Boolean(),
                                /** WI-0287 Stufe 3: der Schlüssel der Art (`place.subtype`, `region.region_type`) für die zweite Zeile; `null`: das Ziel führt keine. Ein älterer Server liefert ihn nicht. */
                                type: Type.Optional(nullable(Type.String())),
                            },
                            strict,
                        ),
                    ),
                    targetState: oneOf(KARTEN_ZIELSTAENDE),
                },
                strict,
            ),
        ),
        links: Type.Array(
            Type.Object(
                {
                    role: oneOf(["primary", "further"] as const),
                    url: Type.String(),
                    label: Type.String(),
                    isPaid: nullable(Type.Boolean()),
                },
                strict,
            ),
        ),
        sources: Type.Array(
            Type.Object({ title: Type.String(), url: nullable(Type.String()), pages: nullable(Type.String()) }, strict),
        ),
        /** WI-0287: die Publikationen in allen Zuständen, in der Reihenfolge am Eintrag (`sources` bleibt: nur die aktiven, ohne Kennung). Ein älterer Server liefert sie nicht. */
        publications: Type.Optional(Type.Array(MamKartePublikation)),
        wiki: nullable(
            Type.Object({ url: nullable(Type.String()), title: nullable(Type.String()), state: Type.String() }, strict),
        ),
        images: Type.Array(MamKarteBild),
        /**
         * WI-0287 Stufe 2, nur an einem stillgelegten Eintrag, dessen Bilder beim Entfernen an einen anderen gingen (`citymap.merge`): der Eintrag, der sie bekam. `null`: nur
         * entfernt oder aktiv. Ein älterer Server liefert ihn nicht.
         */
        handedTo: Type.Optional(nullable(Bezug)),
    },
    strict,
);
export type MamKarteDetail = Static<typeof MamKarteDetail>;

/** Grenzen der Eingabe: Legacys Obergrenzen (0069, Kopf). Die Datenbank prüft sie nicht (ein längerer Quelltext hielte den Import an), nur leere Texte und bekannte Werte. */
export const KARTE_TEXT_MAX = { title: 300, format: 120, author: 300, publisher: 160, note: 2000 } as const;

/**
 * 🔴 Nullbare Felder im ANFRAGEINHALT als Typliste `type: [X, "null"]`, nie als Vereinigung mit `Type.Null()` (`nullable` oben gilt nur
 * für Antworten; docs/regeln/entwicklung.md, ajv-Falle): Fastifys ajv wandelt in der Vereinigung schon im ersten Zweig um, und aus
 * „unbekannt“ (`null`) würde „nein“ (`false`). Belegt in `media-kartensammlung.test.ts`.
 */
const Text = (max: number) => Type.Unsafe<string | null>({ type: ["string", "null"], minLength: 1, maxLength: max });
const Dreiwertig = () => Type.Unsafe<boolean | null>({ type: ["boolean", "null"] });
const Jahr = () => Type.Unsafe<number | null>({ type: ["integer", "null"], minimum: -9999, maximum: 9999 });
const Pixel = () => Type.Unsafe<number | null>({ type: ["integer", "null"], minimum: 1, maximum: 1_000_000 });
const Wort = <T extends string>(values: readonly T[]) =>
    Type.Unsafe<T | null>({ type: ["string", "null"], enum: [...values, null] });

/**
 * Die Felder einer Karte, die sich ändern lassen; jedes optional (nur, was sich ändert, geht mit), `null` heißt „unbekannt“ (bei den
 * dreiwertigen Merkmalen, Art und Farbe) bzw. „leer“. Der Titel ist nie leer.
 */
export const MamKarteFelder = Type.Object(
    {
        title: Type.Optional(Type.String({ minLength: 1, maxLength: KARTE_TEXT_MAX.title })),
        art: Type.Optional(Wort(KARTEN_ARTEN)),
        colorMode: Type.Optional(Wort(KARTEN_FARBEN)),
        isMultilevel: Type.Optional(Dreiwertig()),
        isLabeled: Type.Optional(Dreiwertig()),
        isOfficial: Type.Optional(Dreiwertig()),
        isSpoiler: Type.Optional(Dreiwertig()),
        hasScale: Type.Optional(Dreiwertig()),
        widthPx: Type.Optional(Pixel()),
        heightPx: Type.Optional(Pixel()),
        format: Type.Optional(Text(KARTE_TEXT_MAX.format)),
        validFromBf: Type.Optional(Jahr()),
        validToBf: Type.Optional(Jahr()),
        author: Type.Optional(Text(KARTE_TEXT_MAX.author)),
        publisher: Type.Optional(Text(KARTE_TEXT_MAX.publisher)),
        note: Type.Optional(Text(KARTE_TEXT_MAX.note)),
    },
    strict,
);
export type MamKarteFelder = Static<typeof MamKarteFelder>;
export type MamKarteFeld = keyof MamKarteFelder;

/**
 * `citymap.update` (WI-0068 R5): Eigenschaften und Typen einer Karte gegen den gesehenen Stand (`baseRevision` der Karte). `types`
 * ersetzt die Menge der Typen, wenn es mitkommt. Mindestens eines von beiden.
 */
export const MamKarteAendernBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        fields: Type.Optional(MamKarteFelder),
        types: Type.Optional(Type.Array(oneOf(KARTEN_TYPEN), { uniqueItems: true, maxItems: KARTEN_TYPEN.length })),
    },
    strict,
);
export type MamKarteAendernBody = Static<typeof MamKarteAendernBody>;

/** `citymap.retire` und `citymap.restore` (WI-0287): einen Eintrag entfernen (stilllegen, nie löschen) oder zurückholen, gegen den gesehenen Stand. */
export const MamKarteStilllegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type MamKarteStilllegenBody = Static<typeof MamKarteStilllegenBody>;

/** So viele Orte nimmt das Anlegen eines Eintrags auf einmal. */
export const KARTE_ORTE_MAX = 20;

/** Das Ziel einer Zeile „Orte und Regionen“ (WI-0287 Stufe 3): ein Ort (`place.public_id`) oder eine Region (`region.public_id`). */
export const KARTE_ORTE_ZIELARTEN = ["place", "region"] as const;
export type KarteOrteZielart = (typeof KARTE_ORTE_ZIELARTEN)[number];
export const MamKarteOrtZiel = Type.Object({ kind: oneOf(KARTE_ORTE_ZIELARTEN), id: Uuid() }, strict);
export type MamKarteOrtZiel = Static<typeof MamKarteOrtZiel>;

/**
 * `citymap.create` (WI-0287 Stufe 1, Punkt 2): ein neuer Eintrag der Kartensammlung, von Hand angelegt. Der Titel ist Pflicht (`fields.title`, geprüft am Server wie beim
 * Ändern), `places` sind Orte (`place.public_id`) in der gewählten Folge. Ohne Datei und ohne Link: Die Bilder kommen danach (`citymap.image`).
 * Stufe 3: `targets` sind Orte und Regionen in der gewählten Folge (nach `places`); zusammen höchstens `KARTE_ORTE_MAX`. `places` bleibt für ältere Aufrufer.
 */
export const MamKarteAnlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        fields: MamKarteFelder,
        types: Type.Array(oneOf(KARTEN_TYPEN), { uniqueItems: true, maxItems: KARTEN_TYPEN.length }),
        places: Type.Array(Uuid(), { uniqueItems: true, maxItems: KARTE_ORTE_MAX }),
        targets: Type.Optional(Type.Array(MamKarteOrtZiel, { maxItems: KARTE_ORTE_MAX })),
    },
    strict,
);
export type MamKarteAnlegenBody = Static<typeof MamKarteAnlegenBody>;

/** So lang darf die Bezeichnung einer Version sein („Spielerversion“, „SL-Version“); die Datenbank verlangt nur, dass sie nicht leer ist. */
export const KARTE_VERSION_MAX = 80;

/** Die Bezeichnung einer Version im Anfrageinhalt: als Typliste, nie als Vereinigung mit `Type.Null()` (ajv-Falle). Leer oder `null` heißt ohne. */
const Bezeichnung = () => Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: KARTE_VERSION_MAX });

/**
 * `citymap.image` (WI-0287): ein schon vorhandenes Werk an den Eintrag binden, gegen den gesehenen Stand. Die Art des Werks muss zur Rolle passen (409 `media_type_mismatch`).
 * - **Karte (`map_full`):** Seit Stufe 2 kommt sie als weitere Version dazu, ans Ende, mit `versionLabel` als Bezeichnung (leer oder ohne: keine). Hängt das Werk hier schon, 409.
 * - **Vorschau (`map_preview`):** Sie ersetzt die bisherige (die alte Bindung wird gelöst, das Werk bleibt in der Liste). `versionLabel` gibt es hier nicht (400).
 */
export const MamKarteBildBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        role: oneOf(KARTEN_BILDROLLEN),
        assetId: Uuid(),
        /** WI-0287 Stufe 2: die Bezeichnung der neuen Version (nur `map_full`). */
        versionLabel: Type.Optional(Bezeichnung()),
    },
    strict,
);
export type MamKarteBildBody = Static<typeof MamKarteBildBody>;

/** Der Titel einer erzeugten Vorschau: `Vorschau von „<Eintrag>“` (bis 300 Zeichen Eintrag) oder ein eigener Name aus dem Konflikt. */
export const KARTE_VORSCHAU_TITEL_MAX = 400;

/**
 * `citymap.preview_generate` (WI-0287 Stufe 1, Punkt 5; OPS-000091): aus der Karte des Eintrags (`sourceAssetId`, die aktive `map_full`) eine Vorschau erzeugen, gegen den gesehenen
 * Stand. Es entsteht ein neues Werk der Art `map_preview` (Herkunft `project_generated`, Rechte und Notaus folgen der Karte), es hängt sofort als Vorschau am Eintrag, und der Worker
 * rechnet seine Datei (Jobart `citymap_preview_generate`). 409 bei stillgelegtem Eintrag, belegtem Platz der Vorschau, gesperrter Karte (`KARTE_VORSCHAU_SPERREN`) oder einer Karte,
 * die hier nicht hängt.
 */
export const MamKarteVorschauBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        sourceAssetId: Uuid(),
        title: Type.String({ minLength: 1, maxLength: KARTE_VORSCHAU_TITEL_MAX }),
    },
    strict,
);
export type MamKarteVorschauBody = Static<typeof MamKarteVorschauBody>;

/**
 * `citymap.image_remove` (WI-0287): ein Bild vom Eintrag lösen, gegen den gesehenen Stand. `assetId` nennt das Werk; bei der Karte ist es nötig, sobald sie mehrere Versionen hat
 * (sonst 400), die übrigen rücken auf. Ohne `assetId` (ein älterer Client) gilt das eine Bild der Rolle.
 */
export const MamKarteBildLoesenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        role: oneOf(KARTEN_BILDROLLEN),
        /** WI-0287 Stufe 2: welches Bild (bei mehreren Versionen der Karte Pflicht). */
        assetId: Type.Optional(Uuid()),
    },
    strict,
);
export type MamKarteBildLoesenBody = Static<typeof MamKarteBildLoesenBody>;

/** Die Handlungen an einer Version der Karte (WI-0287 Stufe 2): `label` setzt die Bezeichnung (leer oder `null` nimmt sie weg), `first` stellt sie an den Anfang. */
export const KARTE_VERSION_OPS = ["label", "first"] as const;
export type KarteVersionOp = (typeof KARTE_VERSION_OPS)[number];

/**
 * `citymap.version` (WI-0287 Stufe 2): eine Handlung an einer Version der Karte (`assetId`, eine aktive `map_full` des Eintrags), gegen den gesehenen Stand. Je Handlung eine
 * Operation (die Oberfläche speichert die Bezeichnung beim Verlassen des Felds). Ohne Änderung weder Revision noch Protokoll; 409 `media_not_bound`, wenn das Werk hier nicht hängt.
 */
export const MamKarteVersionBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        assetId: Uuid(),
        op: oneOf(KARTE_VERSION_OPS),
        /** Nur bei `label`: die neue Bezeichnung. */
        label: Type.Optional(Bezeichnung()),
    },
    strict,
);
export type MamKarteVersionBody = Static<typeof MamKarteVersionBody>;

/**
 * `citymap.merge` (WI-0287 Stufe 2, „Bilder an anderen Eintrag geben“): die Bilder des Eintrags an `targetId` geben und ihn stilllegen, in EINER Operation, gegen den gesehenen Stand
 * beider Einträge (`baseRevision` hier, `targetBaseRevision` am Ziel). Jede Karte wird eine weitere Version des Ziels; dasselbe Werk wird dort nicht doppelt geführt. Die erste Karte
 * bekommt `versionLabel` als Bezeichnung (hängt sie dort schon ohne eine, bekommt sie die dort). Die Vorschau zieht mit, wenn das Ziel keine hat. Fundstellen, Publikationen und Orte,
 * die dort fehlen, kommen dazu. 409 bei stillgelegtem Ziel (`citymap_target_retired`) und Ziel gleich Quelle (`citymap_merge_self`). Die Bezeichnung im Anfrageinhalt als Typliste.
 */
export const MamKarteZusammenlegenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        targetId: Uuid(),
        targetBaseRevision: Type.Integer({ minimum: 1 }),
        versionLabel: Type.Optional(Bezeichnung()),
    },
    strict,
);
export type MamKarteZusammenlegenBody = Static<typeof MamKarteZusammenlegenBody>;

/** Grenzen der Fundstellen: Die Datenbank prüft nur http(s) und nicht-leere Beschriftungen; die Längen setzt der Vertrag. */
export const KARTE_LINKS_MAX = 20;
export const KARTE_LINK_MAX = { url: 2000, label: 200 } as const;
/** Der Rückfall, wenn die Beschriftung leer bleibt (0069: Legacys `map_url_label`). */
export const KARTE_LINK_LABEL_VORGABE = "Karte";

/**
 * `citymap.links` (WI-0287 Stufe 1, Punkt 3): die Fundstellen eines Eintrags ersetzen, gegen den gesehenen Stand. Die Menge gilt in der gegebenen Folge: die erste Zeile ist der
 * Karten-Link (`primary`), die übrigen sind `further`. Was wegfällt, wird stillgelegt, was schon einmal da war, lebt wieder auf. `isPaid` ist dreiwertig (`null` = unbekannt); im
 * Anfrageinhalt als Typliste, nie als Vereinigung mit `Type.Null()` (ajv-Falle). Die Adresse beginnt mit http oder https und kommt nur einmal vor (sonst 400).
 */
export const MamKarteLinksBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        links: Type.Array(
            Type.Object(
                {
                    url: Type.String({ minLength: 1, maxLength: KARTE_LINK_MAX.url }),
                    label: Type.String({ maxLength: KARTE_LINK_MAX.label }),
                    isPaid: Type.Unsafe<boolean | null>({ type: ["boolean", "null"] }),
                },
                strict,
            ),
            { maxItems: KARTE_LINKS_MAX },
        ),
    },
    strict,
);
export type MamKarteLinksBody = Static<typeof MamKarteLinksBody>;

/**
 * Die Handlungen an den Publikationen eines Eintrags (WI-0287 Stufe 1, Punkt 4), je eine Operation (sofort speichern, Betreiber 2026-10-28): `add` hängt eine Quelle des Katalogs an
 * (eine gelöste lebt an ihrem Platz wieder auf, eine neue kommt ans Ende), `pages` setzt die Fundstelle, `remove` löst, `restore` holt zurück, `first` stellt sie an den Anfang (sie wird
 * der Band). Eine neue Quelle im Verzeichnis anzulegen gehört nicht hierher (`source.create`, `manage_sources`).
 */
export const KARTE_QUELLEN_OPS = ["add", "pages", "remove", "restore", "first"] as const;
export type KarteQuellenOp = (typeof KARTE_QUELLEN_OPS)[number];

/**
 * `citymap.sources` (WI-0287): eine Handlung an einer Publikation, gegen den gesehenen Stand des Eintrags (`baseRevision`). `pages` gilt bei `add` und `pages` (leer oder `null` leert sie);
 * im Anfrageinhalt als Typliste, nie als Vereinigung mit `Type.Null()` (ajv-Falle).
 */
export const MamKarteQuellenBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        op: oneOf(KARTE_QUELLEN_OPS),
        sourceId: Uuid(),
        pages: Type.Optional(Type.Unsafe<string | null>({ type: ["string", "null"], maxLength: INHALTE_SEITEN_MAX })),
    },
    strict,
);
export type MamKarteQuellenBody = Static<typeof MamKarteQuellenBody>;

/** Die Handlungen an den Orten und Regionen eines Eintrags (WI-0287 Stufe 3), je eine Operation (sofort speichern): anhängen, lösen, einer nicht aufgelösten Zeile ein Ziel geben. */
export const KARTE_ORTE_OPS = ["add", "remove", "resolve"] as const;
export type KarteOrteOp = (typeof KARTE_ORTE_OPS)[number];

/**
 * `citymap.places` (WI-0287 Stufe 3): eine Handlung an den Orten und Regionen eines Eintrags, gegen den gesehenen Stand (`baseRevision`).
 * - `add`: `target` hängt an (409 `citymap_target_present`, wenn es schon aktiv hängt; 400, wenn es das Ziel nicht gibt, es stillgelegt oder außerhalb der Kartendomäne ist).
 * - `remove`: `index` nennt die Zeile (Stelle in der Liste der aktiven Zeilen, wie die Detailantwort sie liefert); sie wird stillgelegt, nie gelöscht.
 * - `resolve`: `index` nennt eine nicht aufgelöste Zeile (sonst 409 `citymap_place_resolved`), `target` ist ihr Ziel; der Rohname bleibt.
 */
export const MamKarteOrteBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Integer({ minimum: 1 }),
        action: oneOf(KARTE_ORTE_OPS),
        index: Type.Optional(Type.Integer({ minimum: 0 })),
        target: Type.Optional(MamKarteOrtZiel),
    },
    strict,
);
export type MamKarteOrteBody = Static<typeof MamKarteOrteBody>;
