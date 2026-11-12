import { onBeforeUnmount, ref, type Ref } from "vue";
import {
    KARTEN_EXPORT_URL,
    KARTEN_PAKET_URL,
    KARTEN_SVG_GLATT,
    KARTEN_SVG_ROH,
    KARTENSERIE_THUMB_VORGABE,
    type KartenEintrag,
    type KartenExportStand,
    type KartenPaketSicht,
    type KartenSvgEinstellungen,
    type KartenZugangArt,
    type KartenZugangNeu,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import { createReadConfirmation, neededConfirmation, withConfirmation, type Need } from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";
import { formatNumber, t } from "../i18n/i18n";
import { kachelUrl, kachelVorlage } from "../kartenserien/kartenserie-kacheln";

/**
 * Das Fenster „Karten herunterladen“ (WI-0280): Stand lesen, Zugänge anlegen und zurücknehmen, SVG in Auftrag geben. Solange ein Bau läuft, liest es den Stand alle paar
 * Sekunden nach; sonst nur nach einer Handlung.
 */

const NACHLESEN_MS = 4000;

export function groesseText(bytes: number): string {
    if (bytes < 1e9) return `${formatNumber(Math.max(1, Math.round(bytes / 1e6)), 0)} MB`;
    return `${formatNumber(bytes / 1e9, 2)} GB`;
}

export function datumText(wert: string): string {
    return new Date(wert).toLocaleDateString(document.documentElement.lang || undefined, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

export function zeitText(wert: string): string {
    return new Date(wert).toLocaleString(document.documentElement.lang || undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Der Name einer Karte: Serien heißen wie im Katalog, die SVG-Abzüge wie in der Sprachtafel. */
export function kartenName(eintrag: KartenEintrag): string {
    if (eintrag.id === KARTEN_SVG_ROH) return t("kartenExport.svg.roh.name");
    if (eintrag.id === KARTEN_SVG_GLATT) return t("kartenExport.svg.glatt.name");
    if (eintrag.art === "svg") return t("kartenExport.svg.eigen.name");
    return eintrag.name;
}

export function kartenText(eintrag: KartenEintrag): string {
    if (eintrag.id === KARTEN_SVG_ROH) return t("kartenExport.svg.roh.text");
    if (eintrag.id === KARTEN_SVG_GLATT) return t("kartenExport.svg.glatt.text");
    return eintrag.beschreibung;
}

/** Das Bild einer Serie: dieselbe Stelle in jeder (Gareth), damit man die Serien an ihr vergleichen kann; dasselbe wie im Fächer der Vorgabe. */
export async function vorschauVon(serie: string): Promise<string | null> {
    const vorlage = await kachelVorlage(serie);
    return vorlage === null ? null : kachelUrl(vorlage, 5, KARTENSERIE_THUMB_VORGABE.x, KARTENSERIE_THUMB_VORGABE.y);
}

export interface KartenExportSicht {
    stand: Ref<KartenExportStand | null>;
    probleme: Ref<Phrase[]>;
    /** Der zweite Faktor fehlt noch: Das Recht ist Stufe V, auch für den Kartographen. */
    unbestaetigt: Ref<Need | null>;
    bestaetige(): void;
    lade(): Promise<void>;
    erstelle(eingabe: {
        art: KartenZugangArt;
        fuerWen: string;
        tage: number;
        karten: readonly string[];
    }): Promise<KartenZugangNeu>;
    stelleNeuAus(id: string): Promise<KartenZugangNeu>;
    nimmZurueck(id: string): Promise<void>;
    erzeugeSvg(einstellungen?: KartenSvgEinstellungen): Promise<void>;
}

export function useKartenExport(fetcher?: Fetcher): KartenExportSicht {
    const stand = ref<KartenExportStand | null>(null);
    const probleme = ref<Phrase[]>([]);
    const unbestaetigt = ref<Need | null>(null);
    const reads = createReadConfirmation();
    reads.onOffer(() => lade());
    let uhr: ReturnType<typeof setTimeout> | undefined;
    let beendet = false;

    async function lade(): Promise<void> {
        clearTimeout(uhr);
        try {
            stand.value = await withConfirmation(
                () => getJson<KartenExportStand>(`${KARTEN_EXPORT_URL}/stand`, fetcher),
                reads.ask,
            );
            probleme.value = [];
            unbestaetigt.value = null;
        } catch (error) {
            probleme.value = formProblems(error);
            unbestaetigt.value = neededConfirmation(error);
        }
        if (!beendet && stand.value?.svg.zustand === "laeuft") uhr = setTimeout(() => void lade(), NACHLESEN_MS);
    }

    onBeforeUnmount(() => {
        beendet = true;
        clearTimeout(uhr);
    });

    return {
        stand,
        probleme,
        unbestaetigt,
        bestaetige: () => reads.offer(),
        lade,
        async erstelle(eingabe) {
            const neu = await postJson<KartenZugangNeu>(
                `${KARTEN_EXPORT_URL}/zugaenge`,
                { operationId: newOperationId(), ...eingabe, karten: [...eingabe.karten] },
                fetcher,
            );
            await lade();
            return neu;
        },
        async stelleNeuAus(id) {
            const neu = await postJson<KartenZugangNeu>(
                `${KARTEN_EXPORT_URL}/zugaenge/${id}/neu`,
                { operationId: newOperationId() },
                fetcher,
            );
            await lade();
            return neu;
        },
        async nimmZurueck(id) {
            await postJson<OperationReceipt>(
                `${KARTEN_EXPORT_URL}/zugaenge/${id}/weg`,
                { operationId: newOperationId() },
                fetcher,
            );
            await lade();
        },
        async erzeugeSvg(einstellungen) {
            await postJson<OperationReceipt>(
                `${KARTEN_EXPORT_URL}/svg`,
                { operationId: newOperationId(), ...(einstellungen === undefined ? {} : { einstellungen }) },
                fetcher,
            );
            await lade();
        },
    };
}

/** Lädt eine Adresse, die als Anhang antwortet: Der Browser speichert, die Seite bleibt stehen. */
export function speichere(adresse: string): void {
    const verweis = document.createElement("a");
    verweis.href = adresse;
    verweis.rel = "noopener";
    document.body.append(verweis);
    verweis.click();
    verweis.remove();
}

export function zipAdresse(ids: readonly string[]): string {
    return `${KARTEN_EXPORT_URL}/paket.zip?ids=${encodeURIComponent(ids.join(","))}`;
}

/** Die Empfängerseite liest ihren Link: Das Token geht im Kopf, nie in der Adresse. */
export function oeffnePaket(token: string, fetcher: Fetcher = fetch): Promise<KartenPaketSicht> {
    const mitToken: Fetcher = (adresse, init) =>
        fetcher(adresse, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
    return getJson<KartenPaketSicht>(`${KARTEN_PAKET_URL}/oeffnen`, mitToken);
}
