import {
    MEDIA_ALLOW_REASONS,
    MEDIA_DENY_REASONS,
    type MediaClearanceState,
    type MediaCreationMethod,
    type MediaKind,
    type MediaModerationState,
    type MediaPublicationOverride,
    type MediaRightsBasis,
    type MediaRole,
    type MediaTechnicalState,
    mediaSwitchKeys,
} from "@avesmaps3d/shared";

/**
 * Die EINE Entscheidung des Media Core: darf dieses Asset in dieser Rolle öffentlich erscheinen, und warum (nicht)?
 * (WI-0063 26.12, `project-control/migration/contracts/media.yaml` → `rechte.oeffentlichkeit`.)
 *
 * 🔴 Rein: keine Datenbank, kein Dateisystem, keine Uhr. Keine Fachroute baut eine eigene Liste erlaubter Lizenzen;
 * jede geht über den Resolver (`resolver.ts`) und damit über diese Funktion. Sie liefert einen Grundcode (für Tests,
 * Verifier und Befunde), keine Texte.
 *
 * Die Bedingungen gelten alle:
 *   - Die Verwendung ist nicht unterdrückt, nicht zurückgezogen und nicht `blocked`. Ein `blocked` an der Verwendung
 *     schlägt jede Regel und jede Freigabe (Einzelausnahme).
 *   - Es gibt eine veröffentlichte Repräsentation für die Rolle: WebP, nie ein SVG.
 *   - Das Asset ist ein Bild, technisch `ok`, nicht moderiert abgelehnt, nicht `unknown` und nicht `rejected`.
 *   - ENTWEDER die Freigabe eines Editors: Der Prüfstand `cleared` trägt jede bekannte Rechtsbasis, KI oder nicht, auch am eigenen
 *     Upload (Betreiber 2026-11-06, WI-0282: „grundsätzlich gilt: editoren dürfen bilder hochladen und - egal ob ki oder nicht -
 *     freigeben. geh davon aus, dass sie die lizenz beim hochladen kennen“). Ausgenommen sind `social_post` (die Weitergabe an fremde
 *     Dienste trägt eine Erlaubnis „nur für Avesmaps“ oder eine Lizenz mit Nennung nicht von selbst) und `photobox` (Moderation und Regel);
 *   - ODER aus Legacy: Public Domain oder eine Lizenz ohne Namensnennungspflicht mit `legacy_asserted`; ein eigenes Werk aus Legacy
 *     wartet auf die Prüfung (Betreiber 2026-10-11, „13: B!“: nur KI-Bilder sind ohne Prüfung öffentlich, über die KI-Regel);
 *   - ODER eine nicht widerrufene Freigaberegel (`publication_rule`, Gate G1, Option A) für (Rechtsbasis, Rolle) und,
 *     wenn die Regel einen trägt, für denselben Lizenzschlüssel und dieselbe Entstehung (Migration 0092; Betreiber
 *     2026-10-10: die Klassenregeln für Wappen und Ortsbilder gelten KI-generierten eigenen Werken, nicht jedem eigenen
 *     Werk, `migration/media-rules.ts`);
 *   - ODER die bewusste Einzelfreigabe `approved` an der Verwendung (Binding oder Galerieeintrag, für genau diese Rolle).
 *
 * Ohne Freigabe erscheinen eine Lizenz mit Namensnennung, `permission`, `fan_policy` und `legacy_assumed` nur mit Regel oder
 * Einzelfreigabe; `unknown` und `rejected` nie. Die verlangte Nennung liefert der Resolver mit (`creditRequired`), gleich auf welchem Weg.
 *
 * Dann der Einzelbild-Notaus (`suspended`, Code-Review 2026-10-16 S8-04): Was sonst öffentlich wäre, hält er zurück
 * (`publication_suspended`), gleich wo die Datei gerade liegt. Ohne `suspended` (Werkzeuge, die Dateien führen; sie fragen den Notaus
 * selbst) gilt keiner. Die Lesewege fragen ihn je Anfrage einmal (`media/notaus.ts`, `gehalteneAssets`).
 *
 * Zuletzt die Inhaltsschalter der Systemsteuerung (WI-0127 SYS-10, `switches`): Was sonst öffentlich wäre, hält ein Schalter seiner
 * Rolle, seines Rechtsgrunds, seiner Lizenzfamilie oder „ungeklärt“ zurück (`switched_off`). Erst nach allen übrigen Gründen, damit
 * das MAM bei einem ohnehin gesperrten Bild weiter den eigentlichen Grund zeigt. Ohne `switches` (Werkzeuge, die Dateien und Zählungen
 * führen) gilt kein Schalter.
 */

// Die Wertelisten stehen EINMAL in `@avesmaps3d/shared` (WI-0068 P2): das MAM zeigt dieselben Codes.
export type RightsBasis = MediaRightsBasis;
export type ClearanceState = MediaClearanceState;
export type TechnicalState = MediaTechnicalState;
export type ModerationState = MediaModerationState;
export type PublicationOverride = MediaPublicationOverride;
export type CreationMethod = MediaCreationMethod;

/** Eine Freigaberegel, so wie die Entscheidung sie braucht (die Zeile aus `publication_rule`, gelesen in `rules.ts`). */
export interface PublicationRuleFacts {
    rightsBasis: RightsBasis;
    /** `null`: die Regel gilt für jede Lizenz ihrer Basis. */
    licenseKey: string | null;
    /** `null`: die Regel gilt für jede Entstehung; sonst nur für Assets mit genau dieser (`media_asset.creation_method`). */
    creationMethod: CreationMethod | null;
    /** Die Rolle des Verwendungsfalls (auch Rollen künftiger Tabellen wie `literature_cover`). */
    role: string;
    /** `revoked_on IS NOT NULL`: eine widerrufene Regel wirkt nicht. */
    revoked: boolean;
}

export interface PublicationRequest {
    /** Die Rolle, in der das Medium erscheinen soll. */
    role: MediaRole;
    asset: {
        mediaKind: MediaKind;
        technicalState: TechnicalState;
        moderationState: ModerationState;
        /** Wie es entstand (`media_asset.creation_method`); eine Regel mit Entstehung gilt nur für genau diese. */
        creationMethod: CreationMethod;
    };
    /** `null`: das Asset hat keine Rechtezeile; das gilt wie `unknown`. */
    rights: {
        basis: RightsBasis;
        clearance: ClearanceState;
        /** Der Katalogschlüssel der Lizenz; `null` bei jeder anderen Basis und bei `cc_by` ohne Version. */
        licenseKey: string | null;
        /**
         * Ob die Lizenz Namensnennung verlangt, aus dem Lizenzkatalog. `null`: keine Lizenz oder keine Aussage
         * (Legacys `cc_by` ohne Version): das gilt NIE als „verlangt keine“.
         */
        licenseRequiresAttribution: boolean | null;
        /** Die Lizenzfamilie (`media_rights.license_family`), für den Schalter `media.license.<familie>`. */
        licenseFamily?: string | null;
    } | null;
    /**
     * Die Verwendung: ein direktes Binding oder ein Galerieeintrag. Galerieeinträge erben die Rolle der Bindung ihrer
     * Galerie; `retired` gilt, wenn Eintrag ODER Galeriebindung zurückgezogen sind.
     */
    usage: {
        role: MediaRole;
        suppressed: boolean;
        retired: boolean;
        override: PublicationOverride;
    };
    /** Die veröffentlichte Repräsentation der Rolle; `null`: es gibt keine. */
    published: { mimeType: string } | null;
    /** Alle Freigaberegeln (auch widerrufene; die Entscheidung überliest sie). */
    rules: readonly PublicationRuleFacts[];
    /** Gilt für die Bytes des Originals ein Einzelbild-Notaus (`media_publication_suspension`)? Fehlt es, gilt keiner. */
    suspended?: boolean;
    /** Die Inhaltsschalter (`system/inhaltsschalter.ts`, `schalterVon`); fehlt er, gilt keiner. */
    switches?: { isOff(key: string): boolean };
}

export const ALLOW_REASONS = MEDIA_ALLOW_REASONS;

export const DENY_REASONS = MEDIA_DENY_REASONS;

export type AllowReason = (typeof ALLOW_REASONS)[number];
export type DenyReason = (typeof DENY_REASONS)[number];

export type PublicationDecision = { allowed: true; reason: AllowReason } | { allowed: false; reason: DenyReason };

const deny = (reason: DenyReason): PublicationDecision => ({ allowed: false, reason });

/**
 * Wo die Freigabe eines Editors nicht von selbst trägt (WI-0282): die Weitergabe an fremde Dienste (`social_post`) und die Reisebilder
 * der Community (`photobox`), die über ihre Moderation und die widerrufbare Regel laufen (WI-0272 §12: „Rechte geprüft“ ändert ihre
 * Sichtbarkeit nicht).
 */
const FREIGABE_TRAEGT_NICHT: ReadonlySet<string> = new Set<MediaRole>(["social_post", "photobox"]);

/**
 * Trägt die Rechtelage allein, ohne Regel und Einzelfreigabe? Die Freigabe eines Editors (`cleared`) trägt jede bekannte Rechtsbasis
 * (`unknown` ist vorher abgewiesen), außer in den Rollen von `FREIGABE_TRAEGT_NICHT`. Sonst Public Domain und eine
 * Lizenz, die ausdrücklich keine Namensnennung verlangt, auch mit `legacy_asserted`. Ein eigenes Werk nur nach der Prüfung: Legacys
 * Angabe „eigenes Werk“ reicht nicht mehr (Betreiber 2026-10-11, Frage 3, „13: B!“); die eigenen KI-Bilder aus Legacy trägt die KI-Regel
 * (`media-rules.ts`).
 */
function rightsCarry(role: MediaRole, rights: NonNullable<PublicationRequest["rights"]>): boolean {
    if (rights.clearance === "cleared" && !FREIGABE_TRAEGT_NICHT.has(role)) return true;
    const checked = rights.clearance === "cleared" || rights.clearance === "legacy_asserted";
    switch (rights.basis) {
        case "public_domain":
            return checked;
        case "own_work":
            return rights.clearance === "cleared";
        case "license":
            return checked && rights.licenseRequiresAttribution === false;
        default:
            return false;
    }
}

/** Trägt eine nicht widerrufene Regel genau diese Rechtsbasis (und Lizenz und Entstehung) in genau dieser Rolle? */
function ruleCovers(request: PublicationRequest, rights: NonNullable<PublicationRequest["rights"]>): boolean {
    return request.rules.some(
        (rule) =>
            !rule.revoked &&
            rule.rightsBasis === rights.basis &&
            rule.role === request.role &&
            (rule.licenseKey === null || rule.licenseKey === rights.licenseKey) &&
            (rule.creationMethod === null || rule.creationMethod === request.asset.creationMethod),
    );
}

/** Warum eine Rechtelage nicht automatisch trägt (nur aufgerufen, wenn weder Regel noch Einzelfreigabe vorliegt). */
function whyNotAutomatic(role: MediaRole, rights: NonNullable<PublicationRequest["rights"]>): DenyReason {
    // Sonst fehlt einer Lizenz mit Nennung nur noch die Freigabe; die Nennung selbst liefert der Resolver.
    if (FREIGABE_TRAEGT_NICHT.has(role) && rights.basis === "license" && rights.licenseRequiresAttribution !== false) {
        return "attribution_required";
    }
    if (rights.basis === "permission") return "permission_needs_approval";
    if (rights.basis === "fan_policy") return "fan_policy_needs_approval";
    if (rights.clearance === "legacy_assumed") return "legacy_assumed";
    return "clearance_pending";
}

export function decidePublication(request: PublicationRequest): PublicationDecision {
    const decision = decideWithoutSwitches(request);
    const { switches, rights } = request;
    if (!decision.allowed) return decision;
    if (request.suspended === true) return deny("publication_suspended");
    if (switches === undefined) return decision;
    const keys = mediaSwitchKeys({
        role: request.role,
        rightsBasis: rights?.basis ?? null,
        licenseFamily: rights?.licenseFamily ?? null,
        clearance: rights?.clearance ?? null,
    });
    return keys.some((key) => switches.isOff(key)) ? deny("switched_off") : decision;
}

function decideWithoutSwitches(request: PublicationRequest): PublicationDecision {
    const { asset, rights, usage, published } = request;

    // Was die Verwendung selbst ausschließt. Eine Freigabe gilt nur für die Rolle ihrer Verwendung.
    if (usage.role !== request.role) return deny("role_mismatch");
    if (asset.mediaKind !== "image") return deny("kind_not_public");
    if (usage.suppressed) return deny("suppressed");
    if (usage.retired) return deny("retired");
    if (usage.override === "blocked") return deny("blocked");

    // Was das Asset selbst ausschließt, auch gegen eine Regel und eine Einzelfreigabe.
    if (asset.technicalState !== "ok") return deny("technical_state_not_ok");
    if (asset.moderationState === "rejected") return deny("moderation_rejected");
    if (asset.moderationState === "pending") return deny("moderation_pending");
    if (rights === null) return deny("rights_missing");
    if (rights.basis === "unknown") return deny("rights_unknown");
    if (rights.clearance === "rejected") return deny("clearance_rejected");

    // Ohne öffentlich auslieferbare Datei gibt es nichts zu erlauben; ein SVG ist nie eine.
    if (published === null) return deny("no_published_representation");
    if (published.mimeType === "image/svg+xml") return deny("svg_not_public");
    if (published.mimeType !== "image/webp") return deny("not_webp");

    if (rightsCarry(request.role, rights)) return { allowed: true, reason: "automatic" };
    if (ruleCovers(request, rights)) return { allowed: true, reason: "rule" };
    if (usage.override === "approved") return { allowed: true, reason: "override_approved" };
    return deny(whyNotAutomatic(request.role, rights));
}
