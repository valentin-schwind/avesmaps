import { PHOTOBOX_UNENTSCHIEDEN, type MediaAssetDetail, type MediaUsageResult } from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";

/**
 * Darf dieses Werk endgültig gelöscht werden (WI-0068 R4)? Auf „Was darf „Endgültig löschen“ in der Medienverwaltung löschen?“ wählte
 * der Betreiber am 2026-10-17 „A, nur eigene Uploads“: nur ein eigener Upload ohne jede Verwendung, auch ohne zurückgezogene. Die
 * Oberfläche sperrt den Knopf vorher mit Grund; entscheiden tut der Server im selben Schritt (`asset-delete.ts`), etwa auch bei einer
 * Zusammenführung, die der Inspector nicht kennt. Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * Zwei Ausnahmen:
 * - ein Bild aus einem Kartenvorschlag, das samt seinen erzeugten Vorschauen nur noch an stillgelegten Einträgen hängt (WI-0287; Vali 2026-11-07 „Ja, erlauben“,
 *   `detail.ausVorschlag.nurStillgelegt`). Hängt es noch an einem Eintrag, der gilt, nennt der Grund `vorschlag_aktiv`, was zu tun ist;
 * - ein PhotoBox-Bild, sobald die Einreichung entschieden ist (WI-0272; Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2, Antwort „Ja, bauen“; Knopftext der Sitzung,
 *   kein Betreiberzitat; `detail.ausPhotobox`). Offen heißt `einreichung_offen` („Erst freigeben oder ablehnen.“), eine andere Verwendung als die eigene als Reisebild `in_use`.
 *
 * 🔴 Ein Notaus hindert nicht mehr (Vali 2026-11-08, Antwort „B, löschbar“; Migration 0328): Er bleibt mit Grund, Person, Zeit und Prüfsumme stehen, nur ohne Verweis auf das
 * Werk, und sperrt dieselben Bytes weiter. Das Blatt sagt es vorher (`loeschBlatt`).
 *
 * Was sonst gesperrt bleibt, nennt der Grund wahrheitsgemäß: `legacy` nur für echte Importe, `erzeugt` für von Avesmaps erzeugte Bilder (Typbilder, Kartenvorschauen),
 * `eingesandt` für ein eingesandtes Bild ohne Einsendung.
 */
export const LOESCH_HINDERNISSE = [
    "legacy",
    "erzeugt",
    "eingesandt",
    "in_use",
    "merged",
    "vorschlag_aktiv",
    "einreichung_offen",
] as const;
export type LoeschHindernis = (typeof LOESCH_HINDERNISSE)[number];

/** Der Satz zu einem Grund (auch zu `details.reason` einer Ablehnung des Servers, WI-0291). */
export const loeschHindernisSatz = (hindernis: LoeschHindernis): string =>
    t(`medien.loeschen.hindernis.${hindernis}` as MessageKey);

/** Ist das ein Grund, den die Oberfläche kennt (`details.reason` von 409 `media_not_deletable`)? */
export const istLoeschHindernis = (wert: unknown): wert is LoeschHindernis =>
    typeof wert === "string" && (LOESCH_HINDERNISSE as readonly string[]).includes(wert);

export function loeschHindernis(detail: MediaAssetDetail): LoeschHindernis | undefined {
    if (detail.legacySource !== null) return "legacy";
    const ausVorschlag = detail.ausVorschlag;
    if (ausVorschlag !== undefined) return ausVorschlag.nurStillgelegt ? undefined : "vorschlag_aktiv";
    const ausPhotobox = detail.ausPhotobox;
    if (ausPhotobox !== undefined) {
        if (PHOTOBOX_UNENTSCHIEDEN.includes(ausPhotobox.zustand)) return "einreichung_offen";
        return ausPhotobox.anderswo > 0 ? "in_use" : undefined;
    }
    switch (detail.asset.origin) {
        case "editor_upload":
            return detail.usageCount + detail.retiredUsageCount > 0 ? "in_use" : undefined;
        case "project_generated":
            return "erzeugt";
        case "community_upload":
            return "eingesandt";
        default:
            return "legacy";
    }
}

/** Was das Blatt „Bild endgültig löschen?“ sagt, in seiner Reihenfolge (Vorbild: Entwurf „Eingänge“ Fassung 2, `zeichneLoeschen`). */
export interface LoeschBlatt {
    /** Der Zusatz unter dem Titel. */
    zusatz: string;
    /** Der Kasten „Achtung“ (Ton warnung): was das Bild an Stellen verliert und was im Verlauf bleibt; leer, wenn es nichts zu sagen gibt. */
    folgen: string[];
    /** Der Satz zum Notaus, wenn an diesem Bild einer ausgelöst wurde. */
    notaus: string | undefined;
}

/**
 * Die Sätze des Blatts. `gleich` sind die anderen Werke mit derselben Datei (`MediaUsageResult.sameFile`): Sie behalten sie. Der Notaus zählt nur, wenn er an DIESEM Werk
 * ausgelöst wurde; „bleibt gesperrt“ nur, solange er gilt.
 */
export function loeschBlatt(
    detail: MediaAssetDetail,
    gleich: MediaUsageResult["sameFile"] | undefined = undefined,
): LoeschBlatt {
    const folgen: string[] = [];
    let zusatz = t("medien.loeschen.zusatz");
    const ausVorschlag = detail.ausVorschlag?.nurStillgelegt === true ? detail.ausVorschlag : undefined;
    const ausPhotobox = detail.ausPhotobox;
    if (ausVorschlag !== undefined) {
        zusatz = t("medien.loeschen.zusatzVorschlag");
        folgen.push(t("medien.loeschen.vorschlag", { eintraege: ausVorschlag.eintraege.join(", ") }));
        if (ausVorschlag.vorschauen > 0) folgen.push(t("medien.loeschen.vorschlagVorschau"));
    } else if (ausPhotobox !== undefined) {
        zusatz = t("medien.loeschen.zusatzPhotobox");
        // Ein abgelehntes oder verfallenes Bild war nie öffentlich: Es verschwindet nirgends, nur die Einsendung verliert ihre Datei.
        if (ausPhotobox.aktiv) {
            folgen.push(
                ausPhotobox.ort === null
                    ? t("medien.loeschen.photobox.ohneOrt")
                    : t("medien.loeschen.photobox.ort", { ort: ausPhotobox.ort }),
            );
        } else if (ausPhotobox.zustand === "offline" || ausPhotobox.zustand === "withdrawn") {
            folgen.push(t("medien.loeschen.photobox.zurueckgezogen"));
        }
        folgen.push(t("medien.loeschen.photobox.verlauf"));
    }
    for (const werk of gleich ?? []) {
        folgen.push(t("medien.loeschen.gleicheDatei", { titel: werk.asset.title ?? t("medien.merge.ohneTitel") }));
    }
    const eigene = detail.suspensions.filter((eintrag) => eintrag.triggeredOn === detail.asset.id);
    const notaus =
        eigene.length === 0
            ? undefined
            : [
                  t("medien.loeschen.notaus"),
                  ...(eigene.some((eintrag) => eintrag.liftedAt === null) ? [t("medien.loeschen.notausGesperrt")] : []),
              ].join(" ");
    return { zusatz, folgen, notaus };
}
