import type { MediaRole } from "@avesmaps3d/shared";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import type { ClearanceState, RightsBasis } from "../media/policy.ts";
import type { ManifestItem, MediaManifest } from "./media-manifest.ts";
import {
    CLASS_ROLE,
    CLASS_SUBJECT,
    MEDIA_CLASSES,
    assetOrigin,
    bindingOrigin,
    isCachePath,
    isDegradedOriginal,
    legacyTimestamp,
    mapRights,
    noteIsRightsNote,
    stampSemantics,
    type AssetOrigin,
    type CreationMethod,
    type LegacyOrigin,
    type MediaClass,
    type SubjectKind,
} from "./media-legacy.ts";

/**
 * Aus Legacys Manifest den Plan machen: welche Assets, Rechte, Galerien, Bindungen und Unterdrückungen es im Ziel geben soll
 * (WI-0063 MEDIA-M8, Vertrag `media.yaml`). Rein: die Fachobjekte des Ziels kommen als Index herein, geschrieben wird hier nichts.
 *
 * 🔴 **Ein Ort mit genau EINEM Bild bekommt ein Titelbild, keine Galerie** (Betreiber 2026-10-12: „legacy galerien mit einem bild sind
 * titelbilder, keine galerien.“; zur Umstellung wählte er am 2026-10-17 „A, über den Zug“, entscheidungen.md). Erst ab zwei Bildern plant
 * der Lauf eine Galerie. Ein Ort hat EIN Titelbild ODER EINE Galerie (WI-0219); `media-import.ts` löst jeweils das andere.
 *
 * Zuordnung zu Objekten NUR über Kennungen (`subject_public_id`, die Legacy-UUID), nie über Namen. Ein Fachobjekt, das es im Ziel
 * nicht gibt, ist ein Befund `orphan_binding`: weder Asset noch Bindung entstehen. Ein Bild, das Legacy nur unter einer fremden
 * Adresse kennt (keine lokale Datei), ist ein Befund `external_unlocalized`: es wird nicht als lokales Asset behauptet.
 */

/** Die Fachobjekte des Ziels, nach Legacy-UUID. */
export type SubjectIndex = Record<SubjectKind, ReadonlyMap<string, { id: string; name: string | null }>>;

export interface PlannedRights {
    basis: RightsBasis;
    licenseKey: string | null;
    licenseFamily: string | null;
    clearance: ClearanceState;
    legacyRightsCode: string | null;
    creator: string | null;
    attribution: string | null;
    rightsNote: string | null;
}

export interface PlannedAsset {
    key: string;
    mediaClass: MediaClass;
    role: MediaRole;
    subjectKind: SubjectKind;
    subjectPublicId: string;
    origin: AssetOrigin;
    creationMethod: CreationMethod;
    degradedOriginal: boolean;
    ingestActorLegacy: string | null;
    /** `timestamptz`-Text (UTC) oder `null`. */
    legacyUploadedAt: string | null;
    stampSemantics: "upload" | "last_classification" | null;
    rights: PlannedRights;
    /** Legacys unklassifizierte Notiz (Kommentar und Prompt gemischt), unverändert; `null`, wenn es keine gibt. */
    legacyNoteRaw: string | null;
    legacy: {
        mediaClass: MediaClass;
        legacyOrigin: LegacyOrigin | null;
        legacySource: string | null;
        legacyForm: "string" | "object" | null;
        storedUrl: string | null;
        localUrl: string;
        sourceUrl: string | null;
        legacyPublic: boolean;
        legacyShown: boolean | null;
    };
}

export interface PlannedGalleryItem {
    key: string;
    sortOrder: number;
}

export interface PlannedGallery {
    placePublicId: string;
    /** Die Quellidentität der Galerie: `settlement-gallery:<place-public-id>`. */
    ref: string;
    items: PlannedGalleryItem[];
}

export interface PlannedBinding {
    subjectKind: SubjectKind;
    subjectPublicId: string;
    role: MediaRole;
    key: string;
    origin: "legacy" | "wiki_localized";
}

export interface PlannedSuppression {
    subjectKind: "place" | "territory";
    subjectPublicId: string;
    role: "coat";
    /** Legacys Schlüssel der Unterdrückung (`…:none`), als Verlauf. */
    key: string;
}

export interface ClassCounts {
    items: number;
    assets: number;
    orphans: number;
    external: number;
    suppressions: number;
}

export interface MediaPlan {
    kind: MediaManifest["kind"];
    mediaRevision: string;
    assets: PlannedAsset[];
    galleries: PlannedGallery[];
    bindings: PlannedBinding[];
    suppressions: PlannedSuppression[];
    byClass: Record<MediaClass, ClassCounts>;
    findings: Finding[];
}

const isSuppressionKey = (item: ManifestItem): boolean =>
    item.suppressed &&
    item.key.endsWith(":none") &&
    (item.mediaClass === "settlement_coat" || item.mediaClass === "territory_coat");

/** Ein Befund über Objekte, hinter dem Namen des Fachobjekts aus dem Index. */
class FindingBag {
    private readonly byCode = new Map<string, { message: string; objects: FindingObject[] }>();

    add(code: string, message: string, object: FindingObject): void {
        const entry = this.byCode.get(code) ?? { message, objects: [] };
        entry.objects.push(object);
        this.byCode.set(code, entry);
    }

    toFindings(): Finding[] {
        return [...this.byCode.entries()].map(([code, entry]) =>
            createFinding(code, entry.message, { eintraege: entry.objects.length }, entry.objects),
        );
    }
}

export function planMedia(manifest: MediaManifest, index: SubjectIndex): MediaPlan {
    const bag = new FindingBag();
    const assets: PlannedAsset[] = [];
    const bindings: PlannedBinding[] = [];
    const suppressions: PlannedSuppression[] = [];
    const galleryItems = new Map<string, (PlannedGalleryItem & { origin: PlannedBinding["origin"] })[]>();
    const byClass = Object.fromEntries(
        MEDIA_CLASSES.map((name) => [name, { items: 0, assets: 0, orphans: 0, external: 0, suppressions: 0 }]),
    ) as Record<MediaClass, ClassCounts>;
    const takenRoles = new Set<string>();
    let unparsableStamps = 0;

    for (const item of manifest.items) {
        const counts = byClass[item.mediaClass];
        counts.items += 1;
        const subjectKind = CLASS_SUBJECT[item.mediaClass];
        const subject = index[subjectKind].get(item.subjectPublicId);
        // Der Name nennt Objekt UND Datei: ein Ort mit zehn Ortsbildern steht sonst zehnmal untereinander.
        const file = item.localUrl?.split("/").pop();
        const object: FindingObject = {
            table: subjectKind,
            publicId: item.subjectPublicId,
            name:
                subject === undefined
                    ? item.key
                    : file === undefined
                      ? subject.name
                      : `${subject.name ?? ""} / ${file}`,
        };

        if (subject === undefined) {
            counts.orphans += 1;
            bag.add(
                "orphan_binding",
                "Medien, deren Fachobjekt es in Avesmaps3D nicht gibt; weder Asset noch Bindung angelegt",
                object,
            );
            continue;
        }

        if (isSuppressionKey(item)) {
            counts.suppressions += 1;
            suppressions.push({
                subjectKind: subjectKind === "territory" ? "territory" : "place",
                subjectPublicId: item.subjectPublicId,
                role: "coat",
                key: item.key,
            });
            continue;
        }
        if (item.localUrl === null) {
            counts.external += 1;
            bag.add(
                "external_unlocalized",
                "Medien, die Legacy nur unter einer fremden Adresse kennt (keine Datei in seinem Speicher); gemeldet, nicht geladen, nicht als lokales Asset behauptet",
                { ...object, name: item.storedUrl ?? item.key },
            );
            continue;
        }

        const role = CLASS_ROLE[item.mediaClass];
        // Ein Einzelwappen je Fachobjekt und Rolle: ein zweiter Eintrag derselben Rolle wäre eine zweite aktive Bindung.
        if (item.mediaClass !== "settlement_image") {
            const slot = `${subjectKind}|${item.subjectPublicId}|${role}`;
            if (takenRoles.has(slot)) {
                bag.add(
                    "duplicate_binding_role",
                    "Fachobjekte mit zwei Medien in derselben Einzelrolle; nur das erste übernommen",
                    object,
                );
                continue;
            }
            takenRoles.add(slot);
        }

        const rights = mapRights({
            mediaClass: item.mediaClass,
            code: item.rightsCode,
            origin: item.origin,
            hasStamp: item.uploadedAt !== null,
        });
        if (rights.assumedDefault) {
            bag.add(
                "assumed_default_license",
                "Medien mit Legacy-Vorgabe statt Einstufung: legacy_assumed (Prüfmarker, kein Nachweis)",
                object,
            );
        }
        if (rights.unresolved && !rights.ccByWithoutVersion) {
            bag.add("rights_unresolved", "Medien mit ungeklärter Rechtslage (unknown): nie öffentlich", object);
        }
        if (rights.ccByWithoutVersion) {
            bag.add(
                "cc_by_without_version",
                "Medien unter cc_by ohne Version: needs_review, keine Version erfunden",
                object,
            );
        }
        if (rights.unknownCode) {
            bag.add(
                "legacy_rights_code_unknown",
                "Medien mit einem Rechtecode, den Legacys Katalog nicht kennt: unknown",
                {
                    ...object,
                    name: `${item.key} (${item.rightsCode ?? ""})`,
                },
            );
        }
        if (item.mediaClass === "territory_coat" && item.legacySource === "staging") {
            // Keine redaktionelle Entscheidung (state undecided), aber Legacy zeigt das Wappen des Wiki-Stands, wenn seine Lizenz es
            // durchlässt. Es wird gebunden, mit Herkunft wiki_localized: jede Entscheidung eines Editors (Wappen oder Unterdrückung)
            // gewinnt, und ob es öffentlich ist, sagt allein die Policy aus den Rechten (eine Wiki-Adresse ist nie eine Freigabe).
            bag.add(
                "wiki_candidate_bound",
                "Gebiete ohne redaktionelle Wappenentscheidung, deren Wiki-Wappen Legacy zeigt (Quelle staging): gebunden mit Herkunft wiki_localized, jeder Entscheid eines Editors gewinnt",
                object,
            );
        }
        if (isCachePath(item.localUrl)) {
            bag.add(
                "cache_path_source",
                "Wappen aus Legacys Wappen-Zwischenspeicher (Proxy-Cache): die Datei wird geholt, die Herkunft ist gekennzeichnet",
                object,
            );
        }
        if (item.suppressed) {
            // Karte und Werk nicht genehmigt: das Bild gehört weiter zu seinem Objekt; ob das Objekt erscheint, regelt dessen Zustand.
            bag.add(
                "subject_not_approved",
                "Medien, deren Karte oder Werk in Legacy nicht genehmigt ist; Asset und Bindung bleiben, das Objekt bestimmt die Sichtbarkeit",
                object,
            );
        }
        if (item.uploadedAt !== null && legacyTimestamp(item.uploadedAt) === null) unparsableStamps += 1;

        const stamp = legacyTimestamp(item.uploadedAt);
        const noteIsRights = noteIsRightsNote(item.mediaClass);
        const rightsNote = [item.licenseText, noteIsRights ? item.note : null]
            .filter((part): part is string => part !== null)
            .join("\n");
        assets.push({
            key: item.key,
            mediaClass: item.mediaClass,
            role,
            subjectKind,
            subjectPublicId: item.subjectPublicId,
            origin: assetOrigin(item.origin),
            creationMethod: rights.creationMethod,
            degradedOriginal: isDegradedOriginal(item.mediaClass, item.origin),
            ingestActorLegacy: item.uploadedBy,
            legacyUploadedAt: stamp,
            stampSemantics: stamp === null ? null : stampSemantics(item.mediaClass),
            rights: {
                basis: rights.basis,
                licenseKey: rights.licenseKey,
                licenseFamily: rights.licenseFamily,
                clearance: rights.clearance,
                legacyRightsCode: item.rightsCode,
                creator: item.author,
                attribution: item.attribution,
                rightsNote: rightsNote === "" ? null : rightsNote,
            },
            legacyNoteRaw: noteIsRights ? null : item.note,
            legacy: {
                mediaClass: item.mediaClass,
                legacyOrigin: item.origin,
                legacySource: item.legacySource,
                legacyForm: item.legacyForm,
                storedUrl: item.storedUrl,
                localUrl: item.localUrl,
                sourceUrl: item.sourceUrl,
                legacyPublic: item.legacyPublic,
                legacyShown: item.shown,
            },
        });
        counts.assets += 1;

        if (item.mediaClass === "settlement_image") {
            const list = galleryItems.get(item.subjectPublicId) ?? [];
            list.push({ key: item.key, sortOrder: item.sortOrder, origin: bindingOrigin(item.origin) });
            galleryItems.set(item.subjectPublicId, list);
        } else {
            bindings.push({
                subjectKind,
                subjectPublicId: item.subjectPublicId,
                role,
                key: item.key,
                origin: bindingOrigin(item.origin),
            });
        }
    }

    // Eine Unterdrückung und eine Bindung derselben Rolle schließen sich aus (Schema). Nennt ein Manifest beides, gewinnt das Medium.
    const bound = new Set(
        bindings.map((binding) => `${binding.subjectKind}|${binding.subjectPublicId}|${binding.role}`),
    );
    for (const suppression of [...suppressions]) {
        if (!bound.has(`${suppression.subjectKind}|${suppression.subjectPublicId}|${suppression.role}`)) continue;
        suppressions.splice(suppressions.indexOf(suppression), 1);
        byClass[suppression.subjectKind === "territory" ? "territory_coat" : "settlement_coat"].suppressions -= 1;
        bag.add(
            "suppression_and_binding_conflict",
            "Fachobjekte, für die das Manifest ein Wappen UND dessen Unterdrückung nennt; das Wappen gilt",
            {
                table: suppression.subjectKind,
                publicId: suppression.subjectPublicId,
                name: suppression.key,
            },
        );
    }

    // Genau ein Bild: ein Titelbild (Bindung der Rolle header). Ab zwei: eine Galerie in Legacys Reihenfolge.
    const galleries: PlannedGallery[] = [];
    for (const [placePublicId, items] of [...galleryItems.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const [einzig] = items;
        if (items.length === 1 && einzig !== undefined) {
            bindings.push({
                subjectKind: "place",
                subjectPublicId: placePublicId,
                role: "header",
                key: einzig.key,
                origin: einzig.origin,
            });
            continue;
        }
        galleries.push({
            placePublicId,
            ref: `settlement-gallery:${placePublicId}`,
            items: [...items]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
                .map(({ key, sortOrder }) => ({ key, sortOrder })),
        });
    }

    const findings = bag.toFindings();
    if (unparsableStamps > 0) {
        findings.push(
            createFinding(
                "bad_upload_stamp",
                `${String(unparsableStamps)} Hochladestempel sind kein lesbarer Zeitpunkt; ohne Stempel übernommen`,
                { eintraege: unparsableStamps },
            ),
        );
    }
    if (manifest.kind === "private") {
        const stamped = assets.filter(
            (asset) => asset.mediaClass === "settlement_image" && asset.legacyUploadedAt !== null,
        );
        if (stamped.length > 0) {
            findings.push(
                createFinding(
                    "stamp_semantics",
                    "Der Stempel eines Ortsbildes ist die LETZTE Einstufung in Legacy, nicht der Upload (stamp_semantics last_classification am Asset)",
                    { ortsbilder: stamped.length },
                ),
            );
        }
    } else {
        findings.push(
            createFinding(
                "wappen_state_unknown",
                "Das öffentliche Manifest (Export A) kennt keine Unterdrückungen (coat_none, leerer Gebiets-Override): nichts als Unterdrückung geschrieben und keine zurückgezogen, bis Export B vorliegt",
                {},
            ),
        );
    }

    return {
        kind: manifest.kind,
        mediaRevision: manifest.mediaRevision,
        assets,
        galleries,
        bindings,
        suppressions,
        byClass,
        findings,
    };
}

/**
 * Export A ist eine Teilmenge von Export B: jeder Eintrag von A muss in B stehen, und B darf ihn nicht als „nicht gezeigt“ führen.
 * Eine Abweichung heißt, dass die zwei Dateien nicht von demselben Zug stammen (Befund, B gewinnt).
 */
export function comparePublicToPrivate(publicManifest: MediaManifest, privateManifest: MediaManifest): Finding | null {
    const privateByKey = new Map(privateManifest.items.map((item) => [item.key, item]));
    const drift: FindingObject[] = [];
    for (const item of publicManifest.items) {
        const other = privateByKey.get(item.key);
        if (other === undefined || other.shown === false) {
            drift.push({ table: CLASS_SUBJECT[item.mediaClass], publicId: item.subjectPublicId, name: item.key });
        }
    }
    if (drift.length === 0) return null;
    return createFinding(
        "public_manifest_drift",
        `${String(drift.length)} Einträge des öffentlichen Manifests (A) fehlen im privaten (B) oder gelten dort als nicht gezeigt; die Dateien stammen nicht vom selben Zug, B gilt`,
        { eintraege: drift.length },
        drift,
    );
}
