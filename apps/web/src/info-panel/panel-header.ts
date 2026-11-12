import type {
    MediaCredit,
    MediaPublicView,
    MediaViewRelation,
    SubjectCanon,
    SubjectDetail,
    SubjectDetailKind,
    SubjectSubtitlePart,
    SubjectWikiLine,
} from "@avesmaps3d/shared";
import { isMessageKey, t, tPlural } from "../i18n/i18n";
import { unnamedLandscapeLabel, unnamedPathLabel } from "../i18n/unnamed";
import { gefahrenText } from "../gefahren/gefahr-texte";
import { headerGraphicOf } from "./header-graphic";
import type { PanelRules } from "./panel-extras";
import { listedParts, namedParts, typeLabel } from "./panel-text";
import type { CanonPill, HeaderImage, HeaderModel, RightsRow, SubtitleItem, WikiModel } from "./panel-types";
import { sourceTypeLabel } from "./source-model";

/**
 * Kopf und Wikizeile des Panels (WI-0063 P6, Design Guide §16.1; Legacy `infoHeaderImageMarkup`, `locationTypeLabelForDisplay`,
 * `buildSettlementPoliticalLineMarkup`, `featureKanonBadgeMarkup`, Mirror `b9657635a`): Name, Untertitel mit Art und Herrschaft,
 * Kanon-Etikett, die Bilder und das Wappen.
 */

/** Die Nennung eines Bildes als eine Zeile; nur, wo die Freigabe eine verlangt. Auch für das Typbild der Art (`typbilder-quelle.ts`, WI-0281). */
export function nennungZeile(credit: MediaCredit | undefined): string | undefined {
    if (credit === undefined) return undefined;
    const text =
        credit.attribution ?? [credit.creator, credit.licenseName].filter((part) => part !== undefined).join(", ");
    return text === "" ? undefined : text;
}

const creditLine = (view: MediaPublicView): string | undefined => nennungZeile(view.credit);

function imageOf(view: MediaPublicView): HeaderImage {
    // Ein Reisebild (WI-0272 S5): Die Nennung steht in der Plakette und der Bildansicht („Reisebild von …“); unter dem Bild bleibt nur die Lizenz, wo es eine gibt.
    const reisebild = view.role === "photobox" && view.relation === "reisebild" && view.reisebild !== undefined;
    const credit = reisebild ? view.credit?.licenseName : creditLine(view);
    // Der Bildbezug nur am Kopfbild und nur aus dem Feld des Servers; ohne Feld Typbild (Betreiber 2026-10-11, `bildbezug.ts`). Ein Reisebild ist es nur mit seinem Block.
    const relation: MediaViewRelation =
        view.relation === "place_view" ? "place_view" : reisebild ? "reisebild" : "type_image";
    return {
        id: view.id,
        url: view.url,
        width: view.width,
        height: view.height,
        ...(credit === undefined ? {} : { credit }),
        ...(view.role === "header" || reisebild ? { relation } : {}),
        ...(reisebild && view.reisebild !== undefined ? { reisebild: view.reisebild } : {}),
        ...(view.ki === true ? { ki: true as const } : {}),
    };
}

/**
 * Der Bezeichner rechts in der Pille (`project-control/migration/contracts/sources.yaml`, `kanon.raenge`, WI-0253 B-2): ein fester Name der
 * Zeile (`designatorLabel`: „Wiki Aventurica“, „Avesmaps“) schlägt die Quellen; sonst die ART, wenn alle zählenden Quellen dieselbe haben
 * (mit der Anzahl dahinter, wenn es mehrere sind: „Briefspiel (2)“, Legacy); sonst bei verschiedenen Arten nur die Anzahl („3 Quellen“).
 * Ohne eines von beiden gibt es keinen Bezeichner. 🪤 Die Zahl 1 steht nie da: Der Vertrag erlaubt die Anzahl erst ab zwei.
 */
function designatorOf(canon: SubjectCanon): string | undefined {
    if (canon.designatorLabel !== undefined) return canon.designatorLabel;
    const count = canon.designatorCount !== undefined && canon.designatorCount > 1 ? canon.designatorCount : undefined;
    if (canon.designatorType !== undefined) {
        const kind = sourceTypeLabel(canon.designatorType);
        return count === undefined ? kind : `${kind} (${String(count)})`;
    }
    return count === undefined ? undefined : tPlural("infoPanel.canon.sources", count, { n: count });
}

/**
 * Das Kanon-Etikett (Legacy `featureKanonBezeichnerText`, Regel in `sources.yaml`): links der Kanon, rechts optional der Bezeichner. Ohne
 * Bezeichner ist die Pille rund, mit Bezeichner geteilt - bei „offiziell“ genauso wie bei „inoffiziell“ (seit WI-0253 B-2: „OFFIZIELL |
 * Regionalspielhilfe“; die Datenbank erlaubt den Bezeichner auch dort).
 */
export function canonPillOf(canon: SubjectCanon | undefined): CanonPill | undefined {
    if (canon === undefined || canon.canon === "unlabelled") return undefined;
    const by = designatorOf(canon);
    return { state: canon.canon, ...(by === undefined ? {} : { by }) };
}

const textItem = (text: string): SubtitleItem[] => (text === "" ? [] : [{ parts: [{ text }] }]);

function placeSubtitle(
    detail: SubjectDetail,
    parts: readonly SubjectSubtitlePart[],
    rules: PanelRules,
): SubtitleItem[] {
    const type = parts.find((part) => part.part === "type");
    const own = parts.find((part) => part.part === "kind");
    const building = detail.facts?.find((fact) => fact.field === "buildingType" && "value" in fact);
    // Legacy `locationTypeLabelForDisplay`: die eigene Ortsart schlägt das Bauwerk des Wikis, das schlägt die Größe.
    let label =
        own?.part === "kind"
            ? own.text
            : building !== undefined && "value" in building && building.value !== ""
              ? building.value
              : type?.part === "type"
                ? typeLabel("place", type.key)
                : "";
    const zusaetze: string[] = [];
    // Die Ruine hängt an jeder Art, auch an der bloßen Größe: „Dorf (Ruine)“ wie „Festung (Ruine)“ (Kanal OPS-000094, Vali 2026-11-07:
    // „bau den fix ein“). Legacy ließ sie bei der Größe weg, und 17 Ruinen mit Wiki-Artikel sagten es nirgends (Weidensee). Kein
    // zweites Mal, wenn die Art („Festungsruine“) oder der Name („Ruine Vilarstein“) das Wort schon trägt.
    if (parts.some((part) => part.part === "ruin") && !/ruine/i.test(label) && !/ruine/i.test(detail.title ?? "")) {
        zusaetze.push(t("infoPanel.ruin"));
    }
    zusaetze.push(...merkmalZusaetze(parts));
    if (zusaetze.length > 0) label = `${label} (${zusaetze.join(", ")})`;
    const items = textItem(label);
    // Die Herrschaft (Legacy): „Hauptstadt von <dem weitesten Gebiet, dessen Hauptstadt er ist>“, sonst „in <seinem Gebiet>“.
    // Freigegeben: ALLE Gebiete, deren Hauptstadt er ist, in EINER Angabe („Hauptstadt von A, B, C“, Betreiber 2026-10-04), dazu die
    // Gebiete, deren Sitz er ist, ohne die, deren Hauptstadt er schon heißt.
    const context = rules.approved.place.context;
    const capitals = parts.flatMap((part) => (part.part === "capitalOf" ? [part.territory] : []));
    if (capitals.length > 0) {
        items.push({ parts: listedParts("infoPanel.capitalOf", context ? capitals : capitals.slice(0, 1)) });
    } else {
        const chain = detail.context?.territories?.chains[0];
        const leaf = chain?.[chain.length - 1];
        if (leaf !== undefined) items.push({ parts: namedParts("infoPanel.inTerritory", leaf.name, leaf.ref) });
    }
    if (context) {
        const capitalRefs = new Set(capitals.map((territory) => JSON.stringify(territory.ref)));
        const seats = parts.flatMap((part) =>
            part.part === "seatOf" && !capitalRefs.has(JSON.stringify(part.territory.ref)) ? [part.territory] : [],
        );
        if (seats.length > 0) items.push({ parts: listedParts("infoPanel.seatOf", seats) });
    }
    return items;
}

/** Unterirdisch (WI-0128 E21, EDIT-0001 D21) und ungefähre Lage (WI-0267): Merkmale des Editors, hinter der Art von Ort und Landmarke (WI-0271 §17). */
function merkmalZusaetze(parts: readonly SubjectSubtitlePart[]): string[] {
    return [
        ...(parts.some((part) => part.part === "underground") ? [t("infoPanel.underground")] : []),
        ...(parts.some((part) => part.part === "approximate") ? [t("infoPanel.approximate")] : []),
    ];
}

/** Der Untertitel eines Subjects nach Legacys Regel je Art. */
export function subtitleOf(kind: SubjectDetailKind, detail: SubjectDetail, rules: PanelRules): SubtitleItem[] {
    const parts = detail.subtitle ?? [];
    const type = parts.find((part) => part.part === "type");
    const typeText = type?.part === "type" ? typeLabel(kind, type.key) : "";
    switch (kind) {
        case "place":
            return placeSubtitle(detail, parts, rules);
        case "area":
        case "peak": {
            const zusaetze = merkmalZusaetze(parts);
            const items = textItem(zusaetze.length > 0 ? `${typeText} (${zusaetze.join(", ")})` : typeText);
            const layer = parts.find((part) => part.part === "layer");
            // Die Ebene („Vegetation“) steht in Legacys Untertitel nicht; sie ist ein Zusatz.
            if (rules.approved[kind].context && layer?.part === "layer") {
                const key = `layer.${layer.key}`;
                items.push(...textItem(isMessageKey(key) ? t(key) : layer.key));
            }
            return items;
        }
        case "path": {
            // Legacy: Der Untertitel steht bei einem Weg mit echtem Namen und bei Wasser; „Unbenannte Straße“ über „Straße“ liest sich doppelt.
            const types = parts.flatMap((part) => (part.part === "type" ? [typeLabel("path", part.key)] : []));
            const water = parts.some(
                (part) => part.part === "type" && (part.key === "Flussweg" || part.key === "Seeweg"),
            );
            // Tunnel (WI-0177, Migration 0172), wie Unterirdisch am Ort: hinter dem Wegtyp in Klammern; ohne Untertitel allein. Dahinter
            // der Satz „kein Zugang querfeldein“: Querfeldein kommt man nur an den Enden eines Tunnels hinein und hinaus.
            const tunnel = parts.find((part) => part.part === "tunnel");
            const zusatz =
                tunnel?.part === "tunnel"
                    ? t(tunnel.partial === true ? "infoPanel.tunnelTeil" : "infoPanel.tunnel")
                    : undefined;
            const satz = zusatz === undefined ? [] : [t("infoPanel.tunnelSatz")];
            const mit =
                zusatz === undefined
                    ? types
                    : types.length === 0
                      ? [zusatz]
                      : [...types.slice(0, -1), `${types.at(-1) ?? ""} (${zusatz})`];
            // Karawanenroute (WI-0177 §30, Migration 0174): das Kennzeichen vorn, der Wegtyp als Untergrund dahinter („auf Pfad,
            // Wüstenpfad“), auch ohne echten Namen; das Kennzeichen hat keine Reisewerte, die kommen vom Untergrund.
            const kennzeichen = parts.find((part) => part.part === "mark");
            if (kennzeichen?.part === "mark") {
                const name = t(
                    kennzeichen.partial === true ? "infoPanel.karawanenrouteTeil" : "infoPanel.karawanenroute",
                );
                const untergrund = types.length === 0 ? [] : [t("infoPanel.aufUntergrund", { arten: mit.join(", ") })];
                return [name, ...untergrund, ...satz].flatMap(textItem);
            }
            if (detail.title !== undefined || water) return [...mit, ...satz].flatMap(textItem);
            return zusatz === undefined ? [] : [zusatz, ...satz].flatMap(textItem);
        }
        case "powerline":
            return textItem(t("infoPanel.powerline"));
        case "territory": {
            const own = parts.find((part) => part.part === "kind");
            return textItem(own?.part === "kind" ? own.text : t("areaChoice.territory"));
        }
    }
}

/**
 * Der Name: der der Fachdomäne; ein namenloser Weg und eine namenlose Fläche heißen nach dem Satz ihrer Art
 * („Unbezeichneter Pfad", „Wald").
 *
 * 🔴 Die Fläche sagte bis WI-0105 nur ihre blanke Art („Wald") - Betreiber 2026-10-07: „‚Wald-925‘ sollte zu
 * ‚Unbezeichneter Wald‘". Seit OPS-073 (Thomas: „unbekannter“ wirke unprofessionell) sagt sie wieder nur ihre Art - als Satz der
 * Sprachtafel, nicht als blanke Art: Der Untertitel lässt sie dann weg (`subtitleUnderTitle`). Damit tragen Weg und Fläche
 * dieselbe Mechanik; welches Wort dort steht, sagt `unnamed.ts`, nicht diese Funktion.
 *
 * 🪤 Ein Gipfel behält seine blanke Art: Im Bestand trägt kein Gipfel einen Griff (gemessen 3 von 207, und die
 * drei heißen `Fläche-051`, ein Datenbefund, keine Regel). Nichts erfunden.
 */
export function titleOf(kind: SubjectDetailKind, detail: SubjectDetail, known: string | undefined): string {
    if (detail.title !== undefined && detail.title !== "") return detail.title;
    if (known !== undefined && known !== "") return known;
    const type = detail.subtitle?.find((part) => part.part === "type");
    if (type?.part === "type") {
        if (kind === "path") return unnamedPathLabel(type.key);
        if (kind === "area") return unnamedLandscapeLabel(type.key);
        const name = typeLabel(kind, type.key);
        if (name !== "") return name;
    }
    return kind === "area" ? unnamedLandscapeLabel("") : t("infoPanel.untitled");
}

/**
 * Der Untertitel unter dem Namen, den `titleOf` liefert (OPS-073): Heißt eine Fläche nach ihrer Art, weil sie keinen Namen hat
 * („Wald“, `unnamed.ts`), steht dieselbe Art nicht noch einmal darunter. Was der Untertitel sonst trägt (die Ebene, „Vegetation“),
 * bleibt. Eine Fläche mit eigenem Namen behält ihre Art im Untertitel - sie sagt dort etwas anderes als der Titel.
 *
 * 🪤 Nur Flächen: Ein namenloser Weg hat seinen eigenen Satz („Unbezeichneter Pfad“) und keinen Untertitel, der ihn wiederholt
 * (`subtitleOf`); ein Gipfel behält seine blanke Art wie bisher.
 */
export function subtitleUnderTitle(
    kind: SubjectDetailKind,
    detail: SubjectDetail,
    known: string | undefined,
    rules: PanelRules,
): SubtitleItem[] {
    const items = subtitleOf(kind, detail, rules);
    if (kind !== "area") return items;
    const title = titleOf(kind, detail, known);
    return items.filter((item) => item.parts.map((part) => part.text).join("") !== title);
}

export function headerOf(
    kind: SubjectDetailKind,
    detail: SubjectDetail,
    known: string | undefined,
    rules: PanelRules,
): HeaderModel {
    const type = detail.subtitle?.find((part) => part.part === "type");
    const typeKey = type?.part === "type" ? type.key : undefined;
    const canon = canonPillOf(detail.canon);
    const title = titleOf(kind, detail, known);
    return {
        title,
        subtitle: subtitleUnderTitle(kind, detail, known, rules),
        ...(canon === undefined ? {} : { canon }),
        // Die Pille „Verborgen“ neben dem Kanon-Etikett (WI-0080): Der Lesevertrag sagt es, der Client leitet nichts ab.
        ...(detail.hidden === true ? { hidden: true as const } : {}),
        // Die Pille „Gefahrengebiet“ und die Arten (WI-0308).
        ...(detail.gefahr === undefined ? {} : { gefahr: { arten: gefahrenText(detail.gefahr.arten) } }),
        graphic: headerGraphicOf(kind, typeKey),
        images: (detail.media?.header ?? []).map(imageOf),
        ...(detail.media?.typbilder === undefined ? {} : { typbilder: detail.media.typbilder.map(imageOf) }),
        ...(detail.media?.coat === undefined ? {} : { coat: imageOf(detail.media.coat) }),
        // Nur ein Ort mit Kennung, Art und Lage kann „+ Eigenes Bild hinzufügen“ tragen (WI-0272 S5); alles andere bleibt ohne.
        ...(kind === "place" && detail.subject.kind === "place" && typeKey !== undefined && detail.target !== undefined
            ? { ort: { id: detail.subject.id, name: title, subtype: typeKey, x: detail.target.x, y: detail.target.y } }
            : {}),
    };
}

/** Der Name der Quelle in der Wikizeile: der Korpus nennt ihn, sonst heißt die Wiki Aventurica so. */
const wikiLabel = (wiki: SubjectWikiLine | undefined): string => {
    const corpus = wiki?.corpus;
    if (corpus?.label !== undefined) return corpus.label;
    return corpus?.key === "wiki-aventurica.de"
        ? t("infoPanel.source.wiki")
        : (corpus?.key ?? t("infoPanel.source.wiki"));
};

/**
 * Die Wikizeile - die erste Zeile des Quellenkastens - samt Rechtetafel hinter dem ⓘ (Legacy `rechteMarkup`): Kanon, Verknüpfung (woher die Angaben stammen), Lizenz mit
 * Link, Nennung, Adresse. 🔴 Der Lizenzhinweis steht IMMER in der Tafel, wo es einen gibt: Die Lizenz der Wiki-Texte verlangt ihn an
 * jeder Kopie (Legacy `popups.js`); ohne Lizenzangabe steht keine Zeile da, es wird keine erfunden.
 */
export function wikiOf(detail: SubjectDetail): WikiModel | undefined {
    return wikiOfLine(detail.wiki, detail.canon);
}

/** Dieselbe Wikizeile aus ihren Teilen: Auch der Eintrag eines Vorkommens (`info-eintrag.vue`) trägt sie, ohne ein `SubjectDetail` zu sein (er hat keinen Kanon). */
export function wikiOfLine(
    wiki: SubjectWikiLine | undefined,
    subjectCanon: SubjectCanon | undefined,
): WikiModel | undefined {
    if (wiki === undefined) return undefined;
    const label = wikiLabel(wiki);
    const canon = canonPillOf(subjectCanon);
    // Legacy (Betreiber 2026-09-03, `buildSourceListMarkup`): rechts in der Halbpille steht die ART der Zeile, nicht noch einmal der Name -
    // „Wiki Aventurica | Wiki Aventurica“ wäre derselbe Name zweimal; „offiziell“ ist an der Wikizeile immer die ganze Pille (der Bezeichner
    // des Objekts, etwa „Regionalspielhilfe“, gehört in den Kopf, nicht an die Wiki).
    const pill: CanonPill | undefined =
        canon === undefined
            ? undefined
            : canon.state === "official"
              ? { state: "official" }
              : { state: "unofficial", by: t("infoPanel.source.wikiKind") };
    const rights: RightsRow[] = [];
    if (canon !== undefined) {
        rights.push({
            key: "kanon",
            label: t("infoPanel.source.rightsKanon"),
            text:
                canon.state === "official"
                    ? t("infoPanel.source.kanonOfficial")
                    : t("infoPanel.source.kanonUnofficial", { art: "" }),
        });
    }
    rights.push({
        key: "link",
        label: t("infoPanel.source.rightsLink"),
        text: t("infoPanel.source.linkText", { wiki: label }),
    });
    if (wiki.license !== undefined) {
        rights.push({
            key: "license",
            label: t("infoPanel.source.rightsLicense"),
            text: wiki.license.name,
            ...(wiki.license.uri === undefined ? {} : { href: wiki.license.uri }),
        });
    }
    if (wiki.attribution !== undefined && wiki.attribution !== label) {
        rights.push({ key: "attribution", label: t("infoPanel.source.rightsAttribution"), text: wiki.attribution });
    }
    rights.push({ key: "address", label: t("infoPanel.source.rightsAddress"), text: wiki.url, href: wiki.url });
    return { label, url: wiki.url, ...(pill === undefined ? {} : { canon: pill }), rights };
}
