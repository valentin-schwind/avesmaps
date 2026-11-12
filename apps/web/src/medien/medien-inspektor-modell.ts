import {
    KARTENVORSCHLAG_SEGMENT_ZUSTAENDE,
    MEDIA_PRIVATE_FIELDS,
    type MamAssetSummary,
    type MediaGalleryDetail,
    type MediaAssetDetail,
    type MediaHistoryEntry,
    type MediaIngestView,
    type MediaPersonRef,
    type MediaPrivateModel,
    type MediaRepresentation,
    type MediaUsage,
    type MediaUsageResult,
} from "@avesmaps3d/shared";
import type { AnsichtBild } from "../controls/avm-bildansicht-modell";
import { darfKartenvorschlaege } from "../community/kartenvorschlaege-modell";
import { isMessageKey, t } from "../i18n/i18n";
import {
    artName,
    typName,
    datum,
    datumZeit,
    entstehungName,
    format,
    groesse,
    herkunftName,
    kurzKennung,
    pruefstandName,
    rechtsgrundName,
    technikName,
    verwendungGrund,
    zahl,
} from "./medien-text";

/**
 * Was der Inspector zeigt, als Daten (WI-0068 P3, Reihenfolge §3.3): je Abschnitt Feldzeilen „Beschriftung · Wert“. Reine Funktionen,
 * damit Vitest prüft, was erscheint - und vor allem, was NICHT erscheint.
 *
 * 🔴 **Private Felder nur, wenn die Route sie liefert** (Positivliste `MEDIA_PRIVATE_FIELDS`, WI-0068 §2 Nr. 15): Eine Zeile entsteht nur
 * für ein Feld, das in der Antwort STEHT (`Object.hasOwn`); ein Feld, das fehlt, ist keine leere Zeile, sondern keine. Ein Feld der
 * Positivliste trägt die Marke „intern“. Heute liefert jede Route alles (ein Recht für das ganze MAM, P2); liefert eine Route später
 * weniger, verschwindet die Zeile ohne Umbau. `null` heißt „nicht erfasst“ und steht da - das ist eine Auskunft, kein Loch.
 */
export interface FeldZeile {
    id: string;
    label: string;
    wert: string;
    /** Steht in der Positivliste: nur mit `view_media_private` sichtbar (Marke „intern“). */
    intern: boolean;
    /** Ein Verweis nach draußen (Lizenz, Quelle), nur http(s); er trägt ↗ aus der Hausregel. */
    verweis?: string;
    /** Die Angabe sagt selbst, ob sie in Ordnung ist (Guide §13.15: „die zweite Zeile färbt sich nach dem Zustand“). */
    ton?: "erfolg" | "warnung";
}

/** Ein Lesemodell des Vertrags; der Kern des Assets hat keine privaten Felder. */
type Modell = MediaPrivateModel | "MediaAssetCore";

export function istPrivat(modell: Modell, feld: string): boolean {
    return modell !== "MediaAssetCore" && (MEDIA_PRIVATE_FIELDS[modell] as readonly string[]).includes(feld);
}

function geliefert(objekt: object | null | undefined, feld: string): boolean {
    return objekt !== null && objekt !== undefined && Object.hasOwn(objekt, feld);
}

const nichtErfasst = (): string => t("medien.wert.nichtErfasst");
const person = (ref: MediaPersonRef | null): string | null => ref?.displayName ?? null;
const httpVerweis = (wert: string | null): string | undefined =>
    wert !== null && /^https?:\/\//i.test(wert) ? wert : undefined;

/** Baut die Zeilen eines Lesemodells; `wert` bekommt das Feld nur, wenn es geliefert ist. */
function zeilenVon<T extends object>(
    modell: Modell,
    objekt: T | null | undefined,
    felder: readonly {
        feld: keyof T & string;
        label: string;
        wert: (objekt: T) => string | null;
        ton?: (objekt: T) => FeldZeile["ton"];
        verweis?: (objekt: T) => string | undefined;
    }[],
    praefix: string = modell,
): FeldZeile[] {
    if (objekt === null || objekt === undefined) return [];
    return felder.flatMap((eintrag) => {
        if (!geliefert(objekt, eintrag.feld)) return [];
        const wert = eintrag.wert(objekt);
        const ton = eintrag.ton?.(objekt);
        const verweis = eintrag.verweis?.(objekt);
        return [
            {
                id: `${praefix}.${eintrag.feld}`,
                label: eintrag.label,
                wert: wert ?? nichtErfasst(),
                intern: istPrivat(modell, eintrag.feld),
                ...(ton === undefined ? {} : { ton }),
                ...(verweis === undefined ? {} : { verweis }),
            },
        ];
    });
}

/** Das Original: die private Quelldatei (Format, Maße, Größe). */
export function original(detail: MediaAssetDetail): MediaRepresentation | undefined {
    return detail.representations.find((datei) => datei.storageClass === "private_source");
}

/** Die öffentliche Vorschau: die kleinste veröffentlichte Datei (dieselbe Adresse, die Besucher abrufen). */
export function vorschau(detail: MediaAssetDetail): MediaRepresentation | undefined {
    return [...detail.representations]
        .filter((datei) => datei.storageClass === "published" && datei.url !== null)
        .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))[0];
}

/**
 * Die private Vorschau (WI-0068 P4b, geschützter Bildweg): Ohne öffentliche Datei zeigt die Medienverwaltung die gerechnete Fassung
 * über `GET …/preview/intern_…` (nur `view_media_private`, `no-store`), nie das Original.
 */
export function interneVorschau(detail: MediaAssetDetail): MediaRepresentation | undefined {
    return [...detail.representations]
        .filter((datei) => datei.storageClass === "derivative" && (datei.privateUrl ?? null) !== null)
        .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))[0];
}

/** Das Bild eines Treffers: die öffentliche Vorschau, sonst die private; `intern` sagt, welche es ist. */
export interface TrefferBild {
    url: string;
    width: number;
    height: number;
    intern: boolean;
}

export function trefferBild(eintrag: Pick<MamAssetSummary, "preview" | "privatePreview">): TrefferBild | null {
    if (eintrag.preview !== null) return { ...eintrag.preview, intern: false };
    const intern = eintrag.privatePreview ?? null;
    return intern === null ? null : { ...intern, intern: true };
}

export function eigenschaftenZeilen(detail: MediaAssetDetail): FeldZeile[] {
    const quelle = original(detail);
    const zeilen = zeilenVon("MediaAssetCore", detail.asset, [
        {
            feld: "assetType",
            label: t("medien.feld.typ"),
            wert: (a) => (a.assetType === null ? null : typName(a.assetType)),
        },
        { feld: "kind", label: t("medien.feld.art"), wert: (a) => artName(a.kind) },
        { feld: "origin", label: t("medien.feld.herkunft"), wert: (a) => herkunftName(a.origin) },
        { feld: "sourceSystem", label: t("medien.feld.quellsystem"), wert: (a) => a.sourceSystem },
        { feld: "sourceRef", label: t("medien.feld.quelle"), wert: (a) => a.sourceRef },
        {
            feld: "technicalState",
            label: t("medien.feld.technik"),
            wert: (a) => technikName(a.technicalState),
            ton: (a) => (a.technicalState === "ok" ? undefined : "warnung"),
        },
        { feld: "createdAt", label: t("medien.feld.angelegt"), wert: (a) => datumZeit(a.createdAt) },
        { feld: "updatedAt", label: t("medien.feld.geaendert"), wert: (a) => datumZeit(a.updatedAt) },
        { feld: "revision", label: t("medien.feld.revision"), wert: (a) => zahl(a.revision) },
    ]);
    if (quelle !== undefined) {
        const masse =
            quelle.width === null || quelle.height === null
                ? format(quelle.mimeType)
                : t("medien.wert.original", {
                      format: format(quelle.mimeType),
                      breite: zahl(quelle.width),
                      hoehe: zahl(quelle.height),
                  });
        zeilen.splice(1, 0, {
            id: "MediaAssetDetail.original",
            label: t("medien.feld.original"),
            wert: `${masse} · ${groesse(quelle.byteSize)}${detail.asset.degradedOriginal ? ` · ${t("medien.wert.verkleinert")}` : ""}`,
            intern: false,
            ...(detail.asset.degradedOriginal ? { ton: "warnung" as const } : {}),
        });
    }
    if (detail.legacySource !== null) {
        zeilen.push({
            id: "MediaLegacySourceView.mediaClass",
            label: t("medien.feld.legacyKlasse"),
            wert: detail.legacySource.mediaClass,
            intern: false,
        });
    }
    return zeilen;
}

export function entstehungZeilen(detail: MediaAssetDetail): FeldZeile[] {
    const methode: FeldZeile = {
        id: "MediaAssetCore.creationMethod",
        label: t("medien.feld.methode"),
        wert: entstehungName(detail.asset.creationMethod),
        intern: false,
    };
    const parameter = (wert: Record<string, unknown> | null): string | null =>
        wert === null ? null : JSON.stringify(wert);
    return [
        methode,
        ...zeilenVon("MediaCreationEditorView", detail.creation, [
            { feld: "tool", label: t("medien.feld.werkzeug"), wert: (c) => c.tool },
            { feld: "model", label: t("medien.feld.modell"), wert: (c) => c.model },
            { feld: "prompt", label: t("medien.feld.prompt"), wert: (c) => c.prompt },
            { feld: "negativePrompt", label: t("medien.feld.negativPrompt"), wert: (c) => c.negativePrompt },
            { feld: "parameters", label: t("medien.feld.parameter"), wert: (c) => parameter(c.parameters) },
            { feld: "legacyNoteRaw", label: t("medien.feld.legacyNotiz"), wert: (c) => c.legacyNoteRaw },
        ]),
    ];
}

/**
 * Ein Eintrag des Verlaufs in Worten, wo die Sprachtafel einen Satz hat (OPS-000101): Die Prüfung der Rechte nach ihrem Entscheid („Rechte erneut zur Prüfung gestellt“
 * statt eines bloßen `rights.reviewed`, das wie „geprüft“ las), das erneute Prüfen eines Reisebildes. Jede andere Handlung steht weiter mit ihrem Code.
 */
export function verlaufText(eintrag: Pick<MediaHistoryEntry, "action" | "decision">): string {
    const schluessel =
        eintrag.action === "rights.reviewed" && eintrag.decision !== undefined
            ? `medien.verlauf.rechte.${eintrag.decision}`
            : eintrag.action === "photobox.reopened"
              ? "medien.verlauf.photobox.reopened"
              : undefined;
    return schluessel !== undefined && isMessageKey(schluessel) ? t(schluessel) : eintrag.action;
}

export function rechteZeilen(detail: MediaAssetDetail): FeldZeile[] {
    if (detail.rights === null) {
        return [
            {
                id: "rights.none",
                label: t("medien.feld.rechtsgrund"),
                wert: t("medien.wert.keineRechte"),
                intern: false,
                ton: "warnung",
            },
        ];
    }
    const zeilen = zeilenVon("MediaRightsEditorView", detail.rights, [
        {
            feld: "basis",
            label: t("medien.feld.rechtsgrund"),
            wert: (r) => rechtsgrundName(r.basis),
            ton: (r) => (r.basis === "unknown" ? "warnung" : undefined),
        },
        {
            feld: "licenseName",
            label: t("medien.feld.lizenz"),
            wert: (r) => r.licenseName ?? r.licenseKey,
            verweis: (r) => httpVerweis(r.licenseUri),
        },
        { feld: "creator", label: t("medien.feld.urheber"), wert: (r) => r.creator },
        { feld: "rightsHolder", label: t("medien.feld.rechteinhaber"), wert: (r) => r.rightsHolder },
        {
            feld: "attribution",
            label: t("medien.feld.namensnennung"),
            wert: (r) =>
                r.attribution ??
                (r.requiresAttribution === true
                    ? t("medien.wert.verlangtFehlt")
                    : r.requiresAttribution === false
                      ? t("medien.wert.nichtVerlangt")
                      : null),
            ton: (r) => (r.requiresAttribution === true && r.attribution === null ? "warnung" : undefined),
        },
        { feld: "rightsNote", label: t("medien.feld.rechtenotiz"), wert: (r) => r.rightsNote },
        {
            feld: "clearance",
            label: t("medien.feld.pruefstand"),
            wert: (r) =>
                r.reviewedAt === null
                    ? pruefstandName(r.clearance)
                    : t("medien.wert.geprueftAm", { stand: pruefstandName(r.clearance), am: datum(r.reviewedAt) }),
            ton: (r) => (r.clearance === "cleared" ? "erfolg" : "warnung"),
        },
        { feld: "reviewer", label: t("medien.feld.pruefer"), wert: (r) => person(r.reviewer) ?? r.reviewedBy },
        { feld: "legacyRightsCode", label: t("medien.feld.legacyRechte"), wert: (r) => r.legacyRightsCode },
    ]);
    if (geliefert(detail, "evidence")) {
        zeilen.push({
            id: "MediaAssetDetail.evidence",
            label: t("medien.feld.belege"),
            wert:
                detail.evidence.length === 0
                    ? t("medien.wert.keineBelege")
                    : detail.evidence
                          .map((beleg) =>
                              t(beleg.viaRule ? "medien.wert.belegRegel" : "medien.wert.beleg", {
                                  art: t(`medien.beleg.${beleg.kind}`),
                              }),
                          )
                          .join(" · "),
            intern: istPrivat("MediaAssetDetail", "evidence"),
        });
    }
    return zeilen;
}

/** Ein Eintrag der Provenienz: wer oder was das Asset hereinbrachte (WI-0068 §5). Der Hochlader ist nie der Urheber. */
export function ingestZeilen(eintrag: MediaIngestView, index: number): FeldZeile[] {
    const legacyUnbekannt = t("medien.wert.nurExportB");
    return zeilenVon(
        "MediaIngestView",
        eintrag,
        [
            { feld: "kind", label: t("medien.feld.ingestArt"), wert: (e) => t(`medien.ingest.${e.kind}`) },
            {
                feld: "migrationRunId",
                label: t("medien.feld.importiertVon"),
                wert: (e) =>
                    e.migrationRunId === null
                        ? null
                        : t("medien.wert.medienzug", { lauf: kurzKennung(e.migrationRunId) }),
            },
            { feld: "actor", label: t("medien.feld.hochgeladenVon"), wert: (e) => person(e.actor) },
            { feld: "ingestedAt", label: t("medien.feld.importiertAm"), wert: (e) => datumZeit(e.ingestedAt) },
            {
                feld: "sourceRef",
                label: t("medien.feld.quelle"),
                wert: (e) => [e.sourceSystem, e.sourceRef].filter((teil) => teil !== null).join(" · ") || null,
            },
            {
                feld: "legacyActorLabel",
                label: t("medien.feld.legacyVon"),
                wert: (e) => e.legacyActorLabel ?? (e.kind === "legacy_import" ? legacyUnbekannt : null),
            },
            {
                feld: "legacyUploadedAt",
                label: t("medien.feld.legacyAm"),
                wert: (e) =>
                    e.legacyUploadedAt === null
                        ? e.kind === "legacy_import"
                            ? legacyUnbekannt
                            : null
                        : datumZeit(e.legacyUploadedAt),
            },
            { feld: "submissionId", label: t("medien.feld.einreichung"), wert: (e) => e.submissionId },
            { feld: "originalFilename", label: t("medien.feld.dateiname"), wert: (e) => e.originalFilename },
        ],
        `MediaIngestView.${String(index)}`,
    ).filter((zeile) => !(zeile.id.endsWith(".actor") && eintrag.kind === "legacy_import" && eintrag.actor === null));
}

export function legacyZeilen(detail: MediaAssetDetail): FeldZeile[] {
    return zeilenVon("MediaLegacySourceView", detail.legacySource, [
        { feld: "legacyOrigin", label: t("medien.feld.legacyHerkunft"), wert: (l) => l.legacyOrigin },
        { feld: "legacySource", label: t("medien.feld.legacyQuelle"), wert: (l) => l.legacySource },
        {
            feld: "legacyPublic",
            label: t("medien.feld.legacyOeffentlich"),
            wert: (l) => t(l.legacyPublic ? "medien.wert.ja" : "medien.wert.nein"),
        },
        { feld: "localUrl", label: t("medien.feld.legacyAdresse"), wert: (l) => l.localUrl },
        {
            feld: "sourceUrl",
            label: t("medien.feld.quellAdresse"),
            wert: (l) => l.sourceUrl,
            verweis: (l) => httpVerweis(l.sourceUrl),
        },
    ]);
}

export interface DateiZeile {
    id: string;
    titel: string;
    unter: string;
    url: string | undefined;
    /** PRIVAT: der Schlüssel unter `MEDIA_ROOT`; nur, wenn die Route ihn liefert. */
    speicher: string | undefined;
    /** Das Original ist gelöscht (WI-0275): Die Zeile bleibt, gerechnet wird aus dem Master. Sonst `undefined`. */
    geloescht: string | undefined;
}

export function dateiZeilen(detail: MediaAssetDetail): DateiZeile[] {
    return detail.representations.map((datei, index) => {
        const masse =
            datei.width === null || datei.height === null
                ? ""
                : ` · ${t("medien.wert.masse", { breite: zahl(datei.width), hoehe: zahl(datei.height) })}`;
        return {
            id: `${datei.variant}-${String(index)}`,
            titel: t("medien.wert.datei", {
                variante: datei.variant,
                klasse: t(`medien.speicher.${datei.storageClass}`),
            }),
            unter: `${format(datei.mimeType)}${masse} · ${groesse(datei.byteSize)} · ${datei.sha256.slice(0, 12)}`,
            url: datei.url ?? undefined,
            speicher: geliefert(datei, "storageKey") ? datei.storageKey : undefined,
            geloescht:
                (datei.bytesDeletedAt ?? null) === null
                    ? undefined
                    : t("medien.wert.originalGeloescht", { am: datum(datei.bytesDeletedAt!) }),
        };
    });
}

/**
 * Die Mängel eines Wappens (WI-0068 P4b T2b), als Satz unter dem Satz der Freigabe: undurchsichtige Ecken (ein Wappen aus dem Editor
 * bleibt dann privat) und, im Bestand, ein nicht quadratisches Original. Ohne Mangel oder bei anderen Typen `undefined`.
 */
export function wappenMaengel(detail: MediaAssetDetail): string | undefined {
    if (detail.asset.assetType !== "coat") return undefined;
    const quelle = original(detail);
    if (quelle === undefined) return undefined;
    const maengel: string[] = [];
    if (quelle.cornersTransparent === false) maengel.push(t("medien.maengel.ecken"));
    const quadratisch = quelle.width === null || quelle.height === null || quelle.width === quelle.height;
    if (!quadratisch && detail.asset.origin !== "editor_upload")
        maengel.push(t("medien.maengel.quadrat", { breite: zahl(quelle.width!), hoehe: zahl(quelle.height!) }));
    if (maengel.length === 0) return undefined;
    const privat = quelle.cornersTransparent === false && detail.asset.origin === "editor_upload";
    return t(privat ? "medien.maengel.privat" : "medien.maengel.satz", { maengel: maengel.join(", ") });
}

/** Ist das Asset heute irgendwo öffentlich? Aus der Entscheidung je Verwendung (Reverse Usage), nicht aus der Datei. */
export function oeffentlich(usage: MediaUsageResult | undefined): boolean {
    return usage?.usages.some((entry) => entry.publication?.public === true) ?? false;
}

/** Der Satz unter den Pillen: warum das Asset in seiner ersten Verwendung öffentlich ist oder nicht. */
export function freigabeSatz(usage: MediaUsageResult | undefined): string | undefined {
    const erste = usage?.usages.find((entry) => entry.publication !== null);
    if (erste?.publication === null || erste?.publication === undefined) return undefined;
    return t(erste.publication.public ? "medien.freigabe.ja" : "medien.freigabe.nein", {
        grund: verwendungGrund(erste.role, erste.publication),
    });
}

/** Ein aktiver Notaus für die Bytes dieses Assets (höchstens einer, Migration 0086). */
export function aktiverNotaus(detail: MediaAssetDetail): MediaAssetDetail["suspensions"][number] | undefined {
    return detail.suspensions.find((eintrag) => eintrag.liftedAt === null);
}

/** Die Verwendungen nach Weg geordnet: erst direkt, dann über Galerien (WI-0068 §8). */
export function verwendungenGeordnet(usages: readonly MediaUsage[]): MediaUsage[] {
    return [...usages].sort((a, b) => (a.via === b.via ? 0 : a.via === "binding" ? -1 : 1));
}

/**
 * Die Folge der Bildansicht im Inspector (Betreiber 2026-10-11: „mit < und > wenns mehrere (1,2,3) oder in eine galerie gibt“): steht das
 * Asset in einer Galerie, ihre Bilder in der Reihenfolge der Galerie (zurückgezogene und solche ohne öffentliche Datei fallen weg), sonst
 * das eine Bild. `stelle` ist das gewählte Asset; ohne Bild gibt es keine Ansicht.
 */
export function ansichtFolge(
    galerien: readonly MediaGalleryDetail[],
    assetId: string,
    einzeln: AnsichtBild | undefined,
): { bilder: AnsichtBild[]; stelle: number } | undefined {
    for (const galerie of galerien) {
        const items = galerie.items.filter((item) => !item.retired && item.asset.preview !== null);
        const stelle = items.findIndex((item) => item.asset.id === assetId);
        if (stelle < 0 || items.length < 2) continue;
        return {
            bilder: items.map((item) => ({
                url: item.asset.preview!.url,
                breite: item.asset.preview!.width,
                hoehe: item.asset.preview!.height,
                titel: item.asset.title ?? (item.asset.id === assetId ? (einzeln?.titel ?? null) : null),
            })),
            stelle,
        };
    }
    return einzeln === undefined ? undefined : { bilder: [einzeln], stelle: 0 };
}

/**
 * „Vorschlag prüfen …“ am Bild eines Kartenvorschlags (WI-0068 OPS-000093): die Kennung und Nummer des Vorschlags, wenn er noch offen ist (wartet auf die Redaktion, `KARTENVORSCHLAG_SEGMENT_ZUSTAENDE.offen`) und die Sitzung
 * eines der beiden Redaktionsrechte hat; sonst `undefined`. Ein angenommener oder abgelehnter Vorschlag hat nichts mehr zu prüfen, ohne Recht gibt es den Weg in die Redaktion nicht.
 */
export function vorschlagPruefen(
    detail: MediaAssetDetail | undefined,
    rechte: readonly string[],
): { id: string; nummer: string } | undefined {
    const vorschlag = detail?.kartenvorschlag;
    if (vorschlag === undefined || !darfKartenvorschlaege(rechte)) return undefined;
    if (!(KARTENVORSCHLAG_SEGMENT_ZUSTAENDE.offen as readonly string[]).includes(vorschlag.zustand)) return undefined;
    return { id: vorschlag.id, nummer: vorschlag.nummer };
}
