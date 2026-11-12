import type { MediaAllowReason, MediaDenyReason, MediaKind } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { gehalteneAssets } from "../../media/notaus.ts";
import {
    decidePublication,
    type ClearanceState,
    type CreationMethod,
    type ModerationState,
    type PublicationRuleFacts,
    type RightsBasis,
    type TechnicalState,
} from "../../media/policy.ts";
import { creditRequired } from "../../media/resolver.ts";
import { readPublicationRules } from "../../media/rules.ts";
import { inhaltsstandFuer, schalterVon } from "../../system/inhaltsstand.ts";

/**
 * Darf ein Bild der Medienverwaltung in einen Beitrag des Social Hubs (WI-0278, Vali 2026-11-03: „bestehende bilder im MAM sollten ausgewählt werden können wenn die lizenz das zulässt“)? Die Auswahl, das Freigeben und
 * der Versand fragen dieselbe Funktion, und sie fragt die EINE Entscheidung (`decidePublication`, Rolle `social_post`). So warnt die Auswahl vor genau dem, woran der Versand scheitern würde.
 *
 * - **Es ist egal, ob das Bild schon irgendwo hängt.** Die Datei des Beitrags rechnet der Auftrag bei Bedarf selbst (`beitrag-bild.ts`). Deshalb fragt die Entscheidung so, als läge die öffentliche Fassung schon vor,
 *   und ein Bild, das noch gerechnet wird, zählt nicht dagegen.
 * - **Eine Regel für eigene Werke gilt auch hier:** Vali 2026-10-10 „alle KI-generierten sind öffentlich“ (`AI_RULE_OPERATOR_QUOTE`), das hängt an keiner Rolle. Wird sie widerrufen, fällt auch dieser Weg.
 * - **Eine Erlaubnis und die Fan-Richtlinie gelten nicht von selbst:** Sie sind für ihre Verwendung erteilt (Literatur, Kartensammlung). Für Beiträge bräuchten sie eine eigene Regel der Rolle `social_post`.
 * - **Eine Lizenz mit Namensnennung lässt den Beitrag zu, wenn der Beitrag sie nennt.** Das Urteil trägt den Text (`nennung`), das Fenster warnt damit. Das gilt nur für eine geprüfte Lizenz, die kommerzielle Nutzung
 *   nicht ausschließt: Die fremden Dienste sind kommerzielle Plattformen.
 * - **Ein Bild der Kategorie „Social Media Posts“** trägt seine Einzelfreigabe in den bestätigten Rechten, wie in `readUsages`.
 */

export interface SocialBildUrteil {
    readonly erlaubt: boolean;
    readonly grund: MediaAllowReason | MediaDenyReason;
    /** Was der Beitrag nennen muss. `null`: Es muss nichts genannt werden; leer: Es muss etwas genannt werden, aber die Medienverwaltung kennt den Text nicht. */
    readonly nennung: string | null;
    /** Kann ein Dienst, der selbst abholt (Instagram), das Bild bekommen? Bei „Social Media Posts“ entsteht die öffentliche Fassung von selbst. */
    readonly oeffentlich: boolean;
    readonly typ: string | null;
}

interface FaktenRow {
    id: string;
    typ: string | null;
    media_kind: MediaKind;
    technical_state: TechnicalState;
    moderation_state: ModerationState;
    creation_method: CreationMethod;
    basis: RightsBasis | null;
    clearance: ClearanceState | null;
    license_key: string | null;
    license_family: string | null;
    license_name: string | null;
    requires_attribution: boolean | null;
    non_commercial: boolean | null;
    creator: string | null;
    attribution: string | null;
    hat_datei: boolean;
}

const geprueft = (klaerung: ClearanceState | null): boolean => klaerung === "cleared" || klaerung === "legacy_asserted";

function nennungVon(f: FaktenRow): string | null {
    if (f.basis === null || !creditRequired({ basis: f.basis, licenseRequiresAttribution: f.requires_attribution })) {
        return null;
    }
    const angabe = f.attribution?.trim();
    if (angabe !== undefined && angabe !== "") return angabe;
    return [f.creator?.trim(), f.license_name]
        .filter((teil) => teil !== undefined && teil !== null && teil !== "")
        .join(", ");
}

/** Die Regeln, wie sie für einen Beitrag gelten: eigene Rolle, dazu die für eigene Werke (oben) und die Zusage einer Lizenz, die der Beitrag nennt. */
function regelnFuer(f: FaktenRow, regeln: readonly PublicationRuleFacts[]): readonly PublicationRuleFacts[] {
    const uebertragen = regeln.map((regel) =>
        regel.rightsBasis === "own_work" ? { ...regel, role: "social_post" } : regel,
    );
    const lizenzMitNennung =
        f.basis === "license" &&
        f.license_key !== null &&
        f.requires_attribution === true &&
        f.non_commercial === false &&
        geprueft(f.clearance);
    if (!lizenzMitNennung) return uebertragen;
    return [
        ...uebertragen,
        {
            rightsBasis: "license",
            licenseKey: f.license_key,
            creationMethod: null,
            role: "social_post",
            revoked: false,
        },
    ];
}

/** Die Urteile mehrerer Bilder in einer Abfrage. Ein Bild, das es nicht gibt, fehlt in der Antwort. */
export async function socialBildUrteile(
    db: Queryable,
    bilder: readonly string[],
): Promise<ReadonlyMap<string, SocialBildUrteil>> {
    if (bilder.length === 0) return new Map();
    const [zeilen, regeln, stand, gehalten] = await Promise.all([
        db<FaktenRow[]>`
            SELECT a.public_id::text AS id, a.asset_type AS typ, a.media_kind, a.technical_state, a.moderation_state, a.creation_method,
                   r.rights_basis AS basis, r.clearance_state AS clearance, r.license_key, r.license_family, r.creator, r.attribution,
                   l.display_name AS license_name, l.requires_attribution, l.non_commercial,
                   EXISTS (SELECT 1 FROM public.media_file f WHERE f.media_asset_id = a.id AND f.storage_class = 'published') AS hat_datei
              FROM public.media_asset a
              LEFT JOIN public.media_rights r ON r.media_asset_id = a.id
              LEFT JOIN public.license_catalog l ON l.key = r.license_key
             WHERE a.public_id = ANY (${[...bilder]}::uuid[])
        `,
        readPublicationRules(db),
        inhaltsstandFuer(db),
        gehalteneAssets(db),
    ]);
    const switches = schalterVon(stand);
    const urteile = new Map<string, SocialBildUrteil>();
    for (const f of zeilen) {
        const eigen = f.typ === "social_post";
        const entscheidung = decidePublication({
            role: "social_post",
            asset: {
                mediaKind: f.media_kind,
                technicalState: f.technical_state === "pending" ? "ok" : f.technical_state,
                moderationState: f.moderation_state,
                creationMethod: f.creation_method,
            },
            rights:
                f.basis === null || f.clearance === null
                    ? null
                    : {
                          basis: f.basis,
                          clearance: f.clearance,
                          licenseKey: f.license_key,
                          licenseRequiresAttribution: f.requires_attribution,
                          licenseFamily: f.license_family,
                      },
            usage: {
                role: "social_post",
                suppressed: false,
                retired: false,
                override: eigen && f.clearance === "cleared" ? "approved" : "none",
            },
            published: { mimeType: "image/webp" },
            rules: regelnFuer(f, regeln),
            suspended: gehalten.publicIds.has(f.id),
            switches,
        });
        urteile.set(f.id, {
            erlaubt: entscheidung.allowed,
            grund: entscheidung.reason,
            nennung: nennungVon(f),
            oeffentlich: eigen || f.hat_datei,
            typ: f.typ,
        });
    }
    return urteile;
}
