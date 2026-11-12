/**
 * Der Wappenzustand der Herrschaftsgebiete aus Legacys Gebietsexport (E4, Objekt `coat`), abgebildet auf den Media Core
 * (WI-0063 P3, Vertrag `territory-details.yaml`, Abschnitt `wappenzustand`; `media.yaml`, Migration 0064).
 *
 * REINE Funktionen ohne Datenbank. 🔴 Dieser Schritt SCHREIBT KEINE Medienzeile (Vertrag `transaktionsgrenze`: der Wappenzustand wird
 * hier nicht geschrieben). Er rechnet die Abbildung nur durch (`planCoat`): Welche Gebiete bekämen eine Unterdrückung
 * (`territory_media_suppression`, „ausdrücklich kein Wappen“), welche eine Bindung (`territory_media` mit Asset), welche nichts. Der
 * Medienimport (MEDIA-M8) ruft dieselben Funktionen und schreibt; beide Importer lesen so EINE Aussage je Gebiet. Es gibt kein
 * Lizenzfeld, keinen Dateipfad und keine Wappenspalte am Gebiet: Rechte und Dateien gehören in `media_rights` und `media_asset`.
 *
 * Die Antwort (Quelle: Legacy-Mirror `024e3af3d`, `political-territories-export.php`):
 *
 *   coat: { state, source, origin, url, license_status, license, author, attribution, public, shown }
 *
 *   state    `undecided` (keine redaktionelle Entscheidung; ein Wiki-Wappen kann trotzdem gelten), `none` (ausdrücklich kein Wappen,
 *            ein leerer Override), `set` (redaktionell gesetzt: ein Override oder die eigene Spalte des Gebiets)
 *   source   welches Feld gewann: `override`, `territory` oder `staging` (nur bei öffentlicher Lizenz, sonst null)
 *   origin   was die Datei ist: `custom` (ein Upload, `…-custom.<ext>`), `wiki_localized` (eine Wiki-Datei in Legacys Speicher oder im
 *            Wappen-Zwischenspeicher, auch eine absolute Wiki-Adresse mit Kopie dort), `wiki_staging` (die Datei liegt nur im Wiki)
 *   url      die gespeicherte Adresse ohne `?v=` (bei nicht öffentlicher Lizenz oder ausgeschaltetem Herkunfts-Schalter null)
 *   public   das Lizenz-Gate von Legacy passiert; shown: zusätzlich der Schalter an und Legacy kann die Datei liefern
 *
 * Unter nicht öffentlicher Lizenz trägt die Antwort nur `state`, `public: false` und `shown: false`: Adresse, Lizenz, Herkunft und Urheber
 * fehlen dann mit Absicht (die volle Wahrheit steht im privaten Medien-Migrationsexport E5 B).
 */

export const COAT_STATES = ["undecided", "none", "set"] as const;
export const COAT_SOURCES = ["override", "territory", "staging"] as const;
export const COAT_ORIGINS = ["custom", "wiki_localized", "wiki_staging"] as const;

export type CoatState = (typeof COAT_STATES)[number];
export type CoatSource = (typeof COAT_SOURCES)[number];
export type CoatOrigin = (typeof COAT_ORIGINS)[number];

/** Die gelesene `coat`-Angabe eines Gebiets, auf bekannte Werte geprüft. */
export interface CoatFacts {
    state: CoatState;
    source: CoatSource | null;
    origin: CoatOrigin | null;
    /** Adresse ohne `?v=`, relativ zur Legacy-Wurzel (`/uploads/wappen/…`) oder absolut (Wiki); `null` ohne öffentliche Adresse. */
    url: string | null;
    licenseStatus: string | null;
    license: string | null;
    author: string | null;
    attribution: string | null;
    isPublic: boolean;
    isShown: boolean;
}

/** Was beim Lesen einer `coat`-Angabe auffiel (der Importer macht daraus Befunde). */
export type CoatReadProblem = "state_unknown" | "origin_unknown" | "source_unknown" | "url_not_text";

/**
 * Liest die `coat`-Angabe. `null`, wenn das Gebiet kein `coat`-Objekt trägt (älterer Export). Ein unbekannter `state` wird als
 * `undecided` gelesen (nie als „kein Wappen“), ein unbekanntes `origin` oder `source` als `null`; jedes steht in `problems`.
 */
export function readCoat(raw: unknown): { coat: CoatFacts | null; problems: CoatReadProblem[] } {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { coat: null, problems: [] };
    const bag = raw as Record<string, unknown>;
    const problems: CoatReadProblem[] = [];
    const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

    let state: CoatState = "undecided";
    if ((COAT_STATES as readonly unknown[]).includes(bag["state"])) state = bag["state"] as CoatState;
    else problems.push("state_unknown");

    let origin: CoatOrigin | null = null;
    if ((COAT_ORIGINS as readonly unknown[]).includes(bag["origin"])) origin = bag["origin"] as CoatOrigin;
    else if (bag["origin"] !== null && bag["origin"] !== undefined && bag["origin"] !== "")
        problems.push("origin_unknown");

    let source: CoatSource | null = null;
    if ((COAT_SOURCES as readonly unknown[]).includes(bag["source"])) source = bag["source"] as CoatSource;
    else if (bag["source"] !== null && bag["source"] !== undefined && bag["source"] !== "")
        problems.push("source_unknown");

    if (bag["url"] !== null && bag["url"] !== undefined && typeof bag["url"] !== "string")
        problems.push("url_not_text");
    const url = text(bag["url"]);
    return {
        coat: {
            state,
            source,
            origin,
            // Der Cachebuster gehört nicht zur Identität (Legacy nennt die Adresse „ohne ?v=“); sicherheitshalber auch hier weg.
            url: url === null ? null : url.replace(/\?v=\d+$/, ""),
            licenseStatus: text(bag["license_status"]),
            license: text(bag["license"]),
            author: text(bag["author"]),
            attribution: text(bag["attribution"]),
            isPublic: bag["public"] === true,
            isShown: bag["shown"] === true,
        },
        problems,
    };
}

/** Wo die Datei liegt, soweit die Antwort es sagt: im Upload-Ordner, im Wappen-Zwischenspeicher oder gar nicht bei Legacy. */
export type CoatFileHint = "uploads" | "cache_path" | "external_with_cache_copy" | "external_unlocalized";

/** Was der Medienimport aus dem Zustand machen würde. */
export type CoatMediaOutcome =
    /** „Ausdrücklich kein Wappen“: eine Zeile in `territory_media_suppression` (Rolle `coat`, Herkunft `legacy`). */
    | { kind: "suppression" }
    /** Eine Bindung in `territory_media` (Rolle `coat`) mit Asset; die Datei kommt aus dem Manifest (E5). */
    | { kind: "binding"; bindingOrigin: "legacy" | "wiki_localized"; legacyMediaKey: string; fileHint: CoatFileHint }
    /** Weder Bindung noch Unterdrückung: keine Zeile, kein Entscheid (nie eine Unterdrückung, nie geraten). */
    | { kind: "none"; reason: CoatNoneReason };

export type CoatNoneReason =
    "undecided" | "undecided_wiki_candidate" | "set_without_file" | "external_unlocalized" | "origin_unknown";

/** Die Befundcodes des Vertrags, die der Zustand eines Gebiets auslöst (ohne `coat_state_summary` und `coat_rights_pending`). */
export type CoatNote =
    | "coat_none_with_url"
    | "coat_set_without_file"
    | "coat_undecided_with_wiki_candidate"
    | "coat_external_unlocalized"
    | "coat_cache_path_source"
    | "coat_not_shown";

export interface CoatPlan {
    territoryPublicId: string;
    facts: CoatFacts;
    outcome: CoatMediaOutcome;
    notes: CoatNote[];
}

const UPLOADS = "/uploads/";
const CACHE = "/uploads/wappen/cache/";

function fileHintOf(url: string, origin: CoatOrigin | null): CoatFileHint {
    if (url.startsWith(CACHE)) return "cache_path";
    if (url.startsWith(UPLOADS)) return "uploads";
    // Eine absolute Adresse: bei `wiki_localized` liegt die Datei im Zwischenspeicher (Legacy nennt `wiki_localized`, wenn die Kopie
    // dort steht); die Antwort nennt den Pfad der Kopie nicht, den trägt E5. Sonst liegt sie nur im Wiki.
    return origin === "wiki_localized" ? "external_with_cache_copy" : "external_unlocalized";
}

/**
 * Die Abbildung eines Wappenzustands auf den Media Core (Vertrag `wappenzustand.abbildung_auf_media_core`):
 *
 *  - `none` → Unterdrückung; ein gleichzeitig genanntes `url` ist ein Widerspruch, der strengere Zustand `none` gilt (Befund).
 *  - `set` ohne Adresse (Legacy führt das Wappen nicht öffentlich: Lizenz-Gate) → keine Bindung aus E4; E5 B kann die Datei tragen.
 *  - `set` mit `custom` → Bindung Herkunft `legacy`; mit `wiki_localized` → Bindung Herkunft `wiki_localized`; mit `wiki_staging`
 *    (Datei nur im Wiki) → keine Bindung, nichts wird nachgeladen (kein zweiter Importpfad, `media.yaml`).
 *  - `undecided` → keine Zeile. Ein bekanntes Wiki-Wappen (`source staging`) ändert daran nichts, es wird gemeldet, nie geraten.
 *
 * Der Schlüssel der Bindung ist `territory-coat:<Kennung>:<origin>:<Adresse ohne ?v>` (`media.yaml` `identitaet`): die Kennung des
 * Gebiets ist die Identität, nicht die Adresse.
 */
export function planCoat(territoryPublicId: string, facts: CoatFacts): CoatPlan {
    const notes: CoatNote[] = [];
    let outcome: CoatMediaOutcome;
    if (facts.state === "none") {
        if (facts.url !== null) notes.push("coat_none_with_url");
        outcome = { kind: "suppression" };
    } else if (facts.state === "set") {
        if (facts.url === null) {
            notes.push("coat_set_without_file");
            outcome = { kind: "none", reason: "set_without_file" };
        } else if (facts.origin === null) {
            outcome = { kind: "none", reason: "origin_unknown" };
        } else if (facts.origin === "wiki_staging") {
            notes.push("coat_external_unlocalized");
            outcome = { kind: "none", reason: "external_unlocalized" };
        } else {
            const fileHint = fileHintOf(facts.url, facts.origin);
            if (fileHint === "cache_path") notes.push("coat_cache_path_source");
            outcome = {
                kind: "binding",
                bindingOrigin: facts.origin === "custom" ? "legacy" : "wiki_localized",
                legacyMediaKey: `territory-coat:${territoryPublicId}:${facts.origin}:${facts.url}`,
                fileHint,
            };
        }
    } else if (facts.source === "staging") {
        notes.push("coat_undecided_with_wiki_candidate");
        outcome = { kind: "none", reason: "undecided_wiki_candidate" };
    } else {
        outcome = { kind: "none", reason: "undecided" };
    }
    // Ein Wappen, das die Lizenz passiert hat, aber nicht angezeigt wird (Schalter aus oder keine Datei, die Legacy liefern kann).
    if (facts.isPublic && !facts.isShown) notes.push("coat_not_shown");
    return { territoryPublicId, facts, outcome, notes };
}

/**
 * Wie Legacys Lizenzcode nach `media.yaml` (`rechte.zuordnung_legacy_code`) für ein Gebietswappen ausgeht. Nur für den Befund
 * `coat_rights_pending`; die Rechtezeilen schreibt der Medienimport.
 *
 *  - automatisch öffentlich (Clearance `legacy_asserted`): `public_domain`, `cc0`, `ai_generated` (über die KI-Regel). Für
 *    Gebietswappen gibt es in Legacy weder Alias noch Vorgabe, die `ai_generated` erzeugen: ein solcher Wert ist eine ausdrückliche
 *    Einstufung eines Editors und sagt, was er angab, nicht ob das Wappen KI-erzeugt ist; E5 B (Stempel und Login) kann das widerlegen.
 *  - `own_work` ohne KI erst nach der Rechteprüfung (Betreiber 2026-10-11, „13: B!“: nur KI-Bilder sind automatisch öffentlich).
 *  - nie automatisch: `cc_by` (ohne Version, `needs_review`), `permission_granted`, `unknown_other`, leer oder ein unbekannter Code.
 */
export function coatRightsOutcome(licenseStatus: string | null): { automatic: boolean; reason: string } {
    switch (licenseStatus) {
        case "public_domain":
        case "cc0":
        case "ai_generated":
            return { automatic: true, reason: "legacy_asserted" };
        case "own_work":
            return { automatic: false, reason: "own_work ohne KI: erst nach der Rechteprüfung" };
        case "cc_by":
            return { automatic: false, reason: "cc_by ohne Version (needs_review)" };
        case "permission_granted":
            return { automatic: false, reason: "permission_granted (nie automatisch)" };
        case "unknown_other":
            return { automatic: false, reason: "unknown_other (nie öffentlich)" };
        case null:
            return {
                automatic: false,
                reason: "Lizenz in der Antwort nicht genannt (unter nicht öffentlicher Lizenz verschweigt Legacy sie)",
            };
        default:
            return { automatic: false, reason: `unbekannter Lizenzcode ${licenseStatus}` };
    }
}
