import { ref, type Ref } from "vue";
import {
    KARTENSERIE_KANTEN,
    KARTENSERIE_STUECK_BYTES,
    KARTENSERIE_STUECK_PRUEFSUMME,
    KARTENSERIEN_UPLOADS_URL,
    kartenserieKachelzahl,
    kartenserieStufen,
    pngKopf,
    type KartenserieUpload,
    type KartenserieUploadZiel,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import { ApiFailure, newOperationId, postJson, putBytes, type Fetcher } from "../auth/api";
import { requestConfirmation, withConfirmation, type Need } from "../auth/bestaetigen";
import { formProblems, type Phrase } from "../auth/formular";

/**
 * Hochladen einer Kartenserie im Browser (WI-0220 Schnitt 3; Vorlage Fassung 4: „Hochladen und zerlegen“). Stückweise zu 8 MiB, je
 * Stück mit seiner Prüfsumme (SubtleCrypto); bricht die Verbindung ab, geht es am Stand des Servers weiter. Anlegen fragt den Passkey,
 * der Rest nicht. Nach dem letzten Stück reiht der Abschluss den Auftrag ein; den Rest zeigt das Lesemodell (Auftrag der Serie).
 *
 * - Aus der Datei liest der Browser vorher nur den Kopf (IHDR), nie das ganze Bild: Quadrat und Kante stehen dort.
 * - Ein Netzfehler wird fünfmal mit wachsender Pause wiederholt, dann hält das Hochladen an (Fortsetzen nimmt es wieder auf).
 */

/** Die Kennung aus dem Namen: Umlaute ausgeschrieben, nur Kleinbuchstaben, höchstens 24 (Muster der Kachelpfade). */
export function kennungAus(text: string): string {
    return text
        .toLowerCase()
        .replace(/ä/gu, "ae")
        .replace(/ö/gu, "oe")
        .replace(/ü/gu, "ue")
        .replace(/ß/gu, "ss")
        .replace(/[^a-z]/gu, "")
        .slice(0, 24);
}

export interface DateiPruefung {
    ok: boolean;
    kante: number | null;
    satz: string;
}

/** Den Kopf einer gewählten Datei prüfen: ein PNG, quadratisch, eine erlaubte Kante. */
export async function pruefeDatei(datei: File): Promise<DateiPruefung> {
    const kopf = pngKopf(new Uint8Array(await datei.slice(0, 33).arrayBuffer()));
    const mb = formatNumber(datei.size / 1024 ** 2, 0);
    if (kopf === null)
        return { ok: false, kante: null, satz: t("admin.kartenserien.hochladen.keinPng", { name: datei.name }) };
    const masse = { name: datei.name, breite: formatNumber(kopf.breite, 0), hoehe: formatNumber(kopf.hoehe, 0), mb };
    if (kopf.breite !== kopf.hoehe || kartenserieStufen(kopf.breite) === null) {
        return {
            ok: false,
            kante: null,
            satz: t("admin.kartenserien.hochladen.falscheKante", {
                ...masse,
                kanten: KARTENSERIE_KANTEN.map((k) => formatNumber(k, 0)).join(", "),
            }),
        };
    }
    return {
        ok: true,
        kante: kopf.breite,
        satz: t("admin.kartenserien.hochladen.passt", {
            ...masse,
            stufe: kartenserieStufen(kopf.breite)!,
            kacheln: formatNumber(kartenserieKachelzahl(kopf.breite), 0),
        }),
    };
}

async function pruefsumme(bytes: ArrayBuffer): Promise<string> {
    const hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HochladenStand {
    serie: string;
    art: "neu" | "ersetzen" | "quelle";
    phase: "hochladen" | "angehalten" | "abschluss" | "fertig" | "fehler";
    uploadId: string | null;
    empfangen: number;
    bytes: number;
    fehler: Phrase[];
    jobId: string | null;
}

export interface HochladenDeps {
    fetcher?: Fetcher;
    ask?: (need: Need) => Promise<boolean>;
    /** Pause vor einem erneuten Versuch (Tests: 0). */
    warte?: (ms: number) => Promise<void>;
}

export interface Hochladen {
    stand: Ref<HochladenStand | null>;
    /** Neu anlegen und hochladen; `true`, wenn der Auftrag eingereiht ist. */
    starte(datei: File, ziel: KartenserieUploadZiel, kante: number): Promise<boolean>;
    /** Einen offenen Upload mit derselben Datei fortsetzen (nach Abbruch oder Neuladen der Seite). */
    setzeFort(datei: File, upload: KartenserieUpload): Promise<boolean>;
    halteAn(): void;
    vergiss(): void;
}

export function createHochladen(deps: HochladenDeps = {}): Hochladen {
    const stand = ref<HochladenStand | null>(null);
    const ask = deps.ask ?? requestConfirmation;
    const warte = deps.warte ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
    let anhalten = false;

    const setze = (teil: Partial<HochladenStand>) => {
        if (stand.value !== null) stand.value = { ...stand.value, ...teil };
    };

    async function schicke(datei: File, uploadId: string, ab: number): Promise<boolean> {
        let versatz = ab;
        let versuche = 0;
        while (versatz < datei.size) {
            if (anhalten) {
                setze({ phase: "angehalten" });
                return false;
            }
            const bytes = await datei.slice(versatz, versatz + KARTENSERIE_STUECK_BYTES).arrayBuffer();
            try {
                const antwort = await putBytes<{ empfangen: number }>(
                    `${KARTENSERIEN_UPLOADS_URL}/${uploadId}?versatz=${versatz}`,
                    bytes,
                    { [KARTENSERIE_STUECK_PRUEFSUMME]: await pruefsumme(bytes) },
                    deps.fetcher,
                );
                versatz = antwort.empfangen;
                versuche = 0;
                setze({ empfangen: versatz });
            } catch (error) {
                const fehler = error instanceof ApiFailure ? error : undefined;
                const amServer = fehler?.details?.["empfangen"];
                if (
                    (fehler?.code === "kartenserien_versatz" || fehler?.code === "kartenserien_pruefsumme") &&
                    typeof amServer === "number"
                ) {
                    // Der Server weiß, was angekommen ist: dort weiter (ein verfälschtes Stück geht einfach noch einmal).
                    versatz = amServer;
                    setze({ empfangen: versatz });
                    if ((versuche += 1) <= 5) continue;
                }
                if (
                    (fehler === undefined || fehler.code === "network" || fehler.status >= 500) &&
                    (versuche += 1) <= 5
                ) {
                    await warte(1000 * 2 ** versuche);
                    continue;
                }
                setze({ phase: "angehalten", fehler: formProblems(error) });
                return false;
            }
        }
        return true;
    }

    async function schliesseAb(uploadId: string): Promise<boolean> {
        setze({ phase: "abschluss" });
        try {
            const quittung = await postJson<OperationReceipt>(
                `${KARTENSERIEN_UPLOADS_URL}/${uploadId}/abschluss`,
                { operationId: newOperationId() },
                deps.fetcher,
            );
            setze({ phase: "fertig", jobId: quittung.derivedWork[0]?.jobId ?? null });
            return true;
        } catch (error) {
            setze({ phase: "fehler", fehler: formProblems(error) });
            return false;
        }
    }

    return {
        stand,
        async starte(datei, ziel, kante) {
            anhalten = false;
            stand.value = {
                serie: ziel.id,
                art: ziel.art,
                phase: "hochladen",
                uploadId: null,
                empfangen: 0,
                bytes: datei.size,
                fehler: [],
                jobId: null,
            };
            let uploadId: string;
            try {
                const quittung = await withConfirmation(
                    () =>
                        postJson<OperationReceipt>(
                            KARTENSERIEN_UPLOADS_URL,
                            { operationId: newOperationId(), ziel, bytes: datei.size, kante },
                            deps.fetcher,
                        ),
                    ask,
                );
                uploadId = quittung.affected.find((a) => a.kind === "map_series_upload")!.id;
            } catch (error) {
                setze({ phase: "fehler", fehler: formProblems(error) });
                return false;
            }
            setze({ uploadId });
            return (await schicke(datei, uploadId, 0)) && schliesseAb(uploadId);
        },
        async setzeFort(datei, upload) {
            if (datei.size !== upload.bytes) {
                stand.value = {
                    serie: upload.ziel.id,
                    art: upload.ziel.art,
                    phase: "angehalten",
                    uploadId: upload.uploadId,
                    empfangen: upload.empfangen,
                    bytes: upload.bytes,
                    fehler: [{ key: "admin.kartenserien.hochladen.andereDatei" }],
                    jobId: null,
                };
                return false;
            }
            anhalten = false;
            stand.value = {
                serie: upload.ziel.id,
                art: upload.ziel.art,
                phase: "hochladen",
                uploadId: upload.uploadId,
                empfangen: upload.empfangen,
                bytes: upload.bytes,
                fehler: [],
                jobId: null,
            };
            return (await schicke(datei, upload.uploadId, upload.empfangen)) && schliesseAb(upload.uploadId);
        },
        halteAn() {
            anhalten = true;
        },
        vergiss() {
            anhalten = true;
            stand.value = null;
        },
    };
}
