import { Type, type Static } from "@sinclair/typebox";

/**
 * Der öffentliche Vertrag des Media Core (WI-0063 Abschnitt 26, `project-control/migration/contracts/media.yaml`).
 *
 * 🔴 Ein `MediaPublicView` ist alles, was ein Besucher von einem Medium erfährt. Er enthält NIE einen Speicherschlüssel,
 * einen Prompt, eine interne Notiz, einen Beleg, einen Login oder Uploader, einen Legacy-Rechtecode oder den
 * Clearance-Zustand: `additionalProperties: false` hält jedes weitere Feld draußen, und der Server baut die Sicht allein
 * aus `apps/server/src/media/resolver.ts` (EINE Entscheidung, `policy.ts`, keine Fachroute mit eigener Liste).
 */

/** Die Medienarten. `model_3d` trägt der Kern schon; ein Profil dafür gehört nicht zu WI-0063. */
export const MEDIA_KINDS = ["image", "model_3d"] as const;

export const MediaKind = Type.Union(
    MEDIA_KINDS.map((kind) => Type.Literal(kind)),
    { $id: "MediaKind" },
);

export type MediaKind = Static<typeof MediaKind>;

/**
 * Die Einzelrollen, die ein Fachobjekt einem Medium gibt. `coat` und `header` binden Orte und Gebiete (Migration 0064);
 * `map_full`, `map_preview` (Kartensammlung, Migration 0069) und `literature_cover` (Literatur, Migration 0068) kennen die
 * Datenbank-CHECKs schon, die Rasterpipeline (MEDIA-M7) erzeugt ihre Dateien. Eine Galerie erbt die Rolle `header`.
 * `photobox` (WI-0272, Reisebilder) ist die Rolle der freigegebenen Einreichungen von Besuchern: weder bindbar
 * (`MEDIA_BINDABLE_ROLES`) noch über den Asset-Typ wählbar (`MEDIA_ASSET_TYPE_ROLES`); eine Verwendung entsteht nur durch die
 * Freigabe einer Einreichung.
 * `social_post` (WI-0278) ist die Rolle der Bilder, die im Social Hub hochgeladen werden: kein Fachobjekt bindet sie, die Verwendung folgt aus dem Asset-Typ
 * (`readUsages`, `activeUsagesSql`).
 */
export const MEDIA_ROLES = [
    "coat",
    "header",
    "map_full",
    "map_preview",
    "literature_cover",
    "photobox",
    "social_post",
] as const;

export const MediaRole = Type.Union(
    MEDIA_ROLES.map((role) => Type.Literal(role)),
    { $id: "MediaRole" },
);

export type MediaRole = Static<typeof MediaRole>;

/**
 * Der Asset-Typ (WI-0068, Betreiber 2026-10-10): was ein Asset SELBST ist, nicht wo es hängt. Wörtlich: „wappen sind ein eigener bild
 * typ und haben nichts mit normalen bildern zu tun. sie müssen bestimmte qualitätsmerkmale erfüllen“; die Liste „das war die liste,
 * genau“. Die Rolle bleibt die Verwendung; der Typ bestimmt, in welcher Rolle ein Asset verwendet werden darf
 * (`MEDIA_ASSET_TYPE_ROLES`): ein Wappen nur als Wappen, ein Bild nie als Wappen. Orts- und Gebietswappen sind ein Typ.
 *
 * Gespeichert in `media_asset.asset_type` (Migration 0095): für den Bestand aus Legacys Klasse, bei einem Upload aus dem Typ, für den
 * hochgeladen wurde. `model_3d` hat noch keine Rolle (3D-Platzierung, P9). `social_post` (Betreiber 2026-11-03, WI-0278) ist die eigene Kategorie
 * „Social Media Posts“: Was im Social Hub hochgeladen wird, landet dort und wird nie Titelbild eines Ortes.
 */
export const MEDIA_ASSET_TYPES = ["coat", "picture", "map", "map_preview", "cover", "model_3d", "social_post"] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];

/** Die Rollen je Asset-Typ: EINE Tafel für Binden, Hochladen, Auswahl und Migration. */
export const MEDIA_ASSET_TYPE_ROLES: Readonly<Record<MediaAssetType, readonly MediaRole[]>> = {
    coat: ["coat"],
    picture: ["header"],
    map: ["map_full"],
    map_preview: ["map_preview"],
    cover: ["literature_cover"],
    model_3d: [],
    social_post: ["social_post"],
};

/**
 * Die Rolle einer Verwendung, die aus einem Asset-Typ folgt: alle Rollen außer `photobox`. Eine Rolle ohne Asset-Typ (`photobox`,
 * WI-0272) entsteht nur aus der Freigabe einer Einreichung, nie aus einem Typ.
 */
export type MediaUploadRole = Exclude<MediaRole, "photobox">;

/**
 * Die Rollen, für die ein MAM-Upload ein Asset anlegen darf: die, für die `MEDIA_ASSET_TYPE_ROLES` einen Typ kennt (`MediaUploadForm.role`).
 * Abgeleitet statt von Hand geführt: Bekommt eine Rolle später einen Asset-Typ, ist sie hier ohne weiteren Eintrag dabei; ohne Typ nimmt der
 * Upload sie nicht an (400 an der Schemaprüfung, bevor Bytes geschrieben werden), statt am Typ der Rolle zu scheitern.
 */
export const MEDIA_UPLOAD_ROLES: readonly MediaUploadRole[] = MEDIA_ROLES.filter((role): role is MediaUploadRole =>
    MEDIA_ASSET_TYPES.some((type) => MEDIA_ASSET_TYPE_ROLES[type].includes(role)),
);

/** Der Typ, den eine Rolle verlangt (jede Rolle mit Typ gehört genau einem Typ; `photobox` hat keinen und wirft). */
export function assetTypeForRole(role: MediaRole): MediaAssetType {
    const found = MEDIA_ASSET_TYPES.find((type) => MEDIA_ASSET_TYPE_ROLES[type].includes(role));
    if (found === undefined) throw new Error(`Die Rolle ${role} gehört keinem Asset-Typ`);
    return found;
}

/** Darf ein Asset dieses Typs in dieser Rolle verwendet werden? Ein Asset ohne Typ (Altbestand vor 0095) nimmt jede Rolle. */
export function assetTypeAllowsRole(type: MediaAssetType | null, role: MediaRole): boolean {
    return type === null || MEDIA_ASSET_TYPE_ROLES[type].includes(role);
}

/**
 * Die öffentliche Adresse einer veröffentlichten Datei: inhaltsversioniert und unveränderlich, kein `?v=mtime`.
 * Neue Bytes ergeben eine neue Adresse.
 *
 * 🔴 `/media/` zeigt NUR auf den Bereich `published/` (MEDIA-M12) - auf Stage und Production über Nginx, lokal über
 * `apps/server/src/routes/media.ts` auf demselben Pfad mit denselben Zusagen. Diese Form ist alles, was dort
 * hereinkommen darf; beide Wege bilden sie ab und entscheiden NICHT, was öffentlich ist. Das entscheidet die Policy
 * beim Import: eine Datei entsteht unter `published/` nur mit `publish`.
 */
export const MEDIA_PUBLIC_URL_PATTERN = "^/media/sha256/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\\.webp$";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Die Adresse einer veröffentlichten Datei aus ihrer SHA-256 (kleingeschrieben, 64 Zeichen). */
export function mediaPublicUrl(sha256: string): string {
    if (!SHA256_HEX.test(sha256)) {
        throw new Error("sha256 muss 64 Hexzeichen in Kleinschreibung haben");
    }
    return `/media/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.webp`;
}

/**
 * Die Instagram-Fassung einer veröffentlichten Datei (WI-0268 C12b): Instagram nimmt über die Graph-Schnittstelle nur JPEG. Sie liegt NEBEN
 * ihrer WebP im selben Ordner, trägt denselben Hash und steht nie länger öffentlich als diese (`MediaStore`: Quarantäne und Löschen nehmen sie mit).
 * Keine Verwendung der Medienverwaltung nennt sie; nur der Social Hub erzeugt und nennt diese Adresse (`MEDIA_PUBLIC_URL_PATTERN` bleibt WebP).
 */
export const MEDIA_INSTAGRAM_URL_PATTERN = "^/media/sha256/[0-9a-f]{2}/[0-9a-f]{2}/[0-9a-f]{64}\\.ig\\.jpg$";

/** Die Adresse der Instagram-Fassung zur SHA-256 der WebP (kleingeschrieben, 64 Zeichen). */
export function mediaInstagramUrl(sha256: string): string {
    if (!SHA256_HEX.test(sha256)) {
        throw new Error("sha256 muss 64 Hexzeichen in Kleinschreibung haben");
    }
    return `/media/sha256/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.ig.jpg`;
}

/**
 * Die strukturierte Nennung, nur wenn eine bewusst freigegebene Verwendung sie verlangt. Sie ist kein Vorwand,
 * namensnennungspflichtige Medien automatisch zu zeigen (WI-0063 26.13).
 */
export const MediaCredit = Type.Object(
    {
        creator: Type.Optional(Type.String({ minLength: 1 })),
        licenseName: Type.Optional(Type.String({ minLength: 1 })),
        licenseUri: Type.Optional(Type.String({ pattern: "^https://" })),
        attribution: Type.Optional(Type.String({ minLength: 1 })),
    },
    { $id: "MediaCredit", additionalProperties: false },
);

export type MediaCredit = Static<typeof MediaCredit>;

/**
 * Der Bildbezug eines Kopfbildes (Betreiber 2026-10-11, wörtlich „1A … 2 B … 3 A ja das gilt für alle“; Arbeitsanweisung
 * `project-control/work-items/bildbezug-ortsansicht-typbild-2026-10-11.md`): `place_view` stellt den Ort ausdrücklich dar
 * („Ortsansicht“), `type_image` veranschaulicht ihn nur („Typbild“). Eine Eigenschaft der VERWENDUNG, nicht des Assets: Der Server
 * rechnet sie je Verwendung (`apps/server/src/media/image-relation.ts`), ein Editor übersteuert sie (Operation `header.relation`).
 * 🔴 Ein fehlender oder unbekannter Wert ist nie eine Ortsansicht.
 */
export const MEDIA_IMAGE_RELATIONS = ["place_view", "type_image"] as const;
export type MediaImageRelation = (typeof MEDIA_IMAGE_RELATIONS)[number];
export const MediaImageRelation = Type.Union(MEDIA_IMAGE_RELATIONS.map((relation) => Type.Literal(relation)));

/**
 * Der Bildbezug, den eine öffentliche Sicht tragen darf: die zwei des Kopfbildes (`MediaImageRelation`) und `reisebild` (WI-0272 S5): ein freigegebenes Reisebild, das am Ort im Kopf steht.
 * 🔴 Ein Editor übersteuert `reisebild` nie (`MEDIA_IMAGE_RELATIONS` bleibt, was die Operation `header.relation` setzt); der Wert entsteht nur aus der Freigabe einer Einreichung.
 */
export const MEDIA_VIEW_RELATIONS = [...MEDIA_IMAGE_RELATIONS, "reisebild"] as const;
export type MediaViewRelation = (typeof MEDIA_VIEW_RELATIONS)[number];
export const MediaViewRelation = Type.Union(MEDIA_VIEW_RELATIONS.map((relation) => Type.Literal(relation)));

/**
 * Was Besucher über ein Reisebild im Kopf eines Ortes erfahren (WI-0272 S5): die Bildbeschreibung, den freiwilligen Namen der Nennung und die Entstehung. Dieselben Angaben nennt die Karte
 * (`ReisebildKarte`); mehr nicht: keine Stelle, kein Schlüssel, kein Zustand.
 *
 * 🪤 Die Liste der Entstehungen steht hier ein zweites Mal (`PHOTOBOX_CREATION_KINDS`, `photobox-sicht.ts`): `media.ts` ist ein Blattmodul, und `photobox-sicht.ts` erreicht es über `subject.ts`.
 * Der Test `media-reisebild.test.ts` hält beide gleich.
 */
export const MEDIA_REISEBILD_ENTSTEHUNG = ["drawing", "photo", "ai_generated", "avesmaps_capture"] as const;
export const MediaReisebild = Type.Object(
    {
        beschreibung: Type.String({ minLength: 1 }),
        name: Type.Optional(Type.String({ minLength: 1 })),
        entstehung: Type.Union(MEDIA_REISEBILD_ENTSTEHUNG.map((art) => Type.Literal(art))),
    },
    { additionalProperties: false },
);
export type MediaReisebild = Static<typeof MediaReisebild>;

export const MediaPublicView = Type.Object(
    {
        /** Die `public_id` des Assets, nicht die SHA-256 der Datei. */
        id: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
        role: MediaRole,
        url: Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN }),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        mimeType: Type.String({ pattern: "^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$" }),
        credit: Type.Optional(MediaCredit),
        /**
         * Der Bildbezug (`MediaViewRelation`): bei der Rolle `header` immer gesetzt (Ortsansicht oder Typbild), bei einem Reisebild im Kopf eines Ortes (Rolle `photobox`, WI-0272 S5) `reisebild`;
         * jede andere Rolle trägt ihn nie. Optional, damit ein Client der Vorversion und eine Antwort der Vorversion einander ertragen: Fehlt er, gilt Typbild.
         */
        relation: Type.Optional(MediaViewRelation),
        /** Nur bei `relation: "reisebild"` (WI-0272 S5): Beschreibung, Nennung und Entstehung des Reisebildes. */
        reisebild: Type.Optional(MediaReisebild),
        /**
         * Nur an einem Kopfbild und nur, wenn es als KI-generiert gekennzeichnet ist (`media_asset.creation_method`, WI-0272): Der Filter „Ohne KI“ liest es. Fehlt es, heißt das nicht „KI-frei“: Die
         * Herkunft kann auch unbekannt sein.
         */
        ki: Type.Optional(Type.Literal(true)),
        /**
         * Nur an einem Kopfbild und nur, wenn seine Entstehung als ohne KI eingetragen ist (Foto, Zeichnung, Scan; `OHNE_KI_CREATION_METHODS`, WI-0281): Der
         * Modus „Ohne KI“ lässt ein Typbild nur damit stehen. 🔴 Fehlt es, heißt das nicht „KI“, aber auch nie „ohne KI“: Unbekannte Herkunft bleibt unbekannt.
         */
        ohneKi: Type.Optional(Type.Literal(true)),
    },
    { $id: "MediaPublicView", additionalProperties: false },
);

export type MediaPublicView = Static<typeof MediaPublicView>;
