import {
    computed,
    getCurrentScope,
    onScopeDispose,
    ref,
    shallowRef,
    type ComputedRef,
    type Ref,
    type ShallowRef,
} from "vue";
import type { InhalteRegelTextErgebnis } from "@avesmaps3d/shared";
import { newOperationId } from "../auth/api";
import type { ApiFehler } from "../fenster/entwurf-senden";
import { t } from "../i18n/i18n";
import { alsApiFailure, istAbbruch } from "../medien/medien-client";
import type { InhalteClient } from "./inhalte-client";
import {
    haengeBlockAn,
    istAktuell,
    planLeer,
    uebernommenSatz,
    wendeErsatzAn,
    TEXT_BEISPIEL,
    type TextErsatz,
} from "./inhalte-regeln-text-modell";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";

/**
 * Der Zustand der Ansicht „Regeln als Text“ im Reiter „Vorkommen“ (WI-0254 §13 und §14): der Text, die Vorschau des letzten Prüfens, die Meldung und die Aufrufe an den Server. Die Rechnung steht in
 * `inhalte-regeln-text-modell.ts` (ohne Vue); gelesen und aufgelöst wird allein auf dem Server.
 *
 * - 🔴 **Der Text ist die einzige Quelle.** Die Vorschau gehört zum Text, der geprüft wurde (`geprueft`); ist der Text seither anders, ist sie nicht `aktuell`, und weder eine Antwort auf eine Rückfrage noch
 *   „Übernehmen“ gilt, bis neu geprüft ist. Jede Antwort auf eine Rückfrage ist ein Ersatz im Text (`wendeAn`), danach wird neu geprüft.
 * - **„Übernehmen“ ist EINE eigene Operation über alle Einträge** (Server: eine `mapOperation`, eine Transaktion), nicht der Entwurf des Fensters und nicht „Speichern“ im Fuß. Der Server liest den Text noch einmal; der
 *   Text danach ist sein `rest`. Während sie läuft, steht der Text still (`beschaeftigt`). Danach werden die Liste des Katalogs und der gewählte Eintrag neu geladen; trägt der Entwurf des gewählten Eintrags
 *   Änderungen, bleibt er stehen (kein stilles Verwerfen) und bekommt beim Speichern den Konflikt 409, den die Meldung ankündigt.
 * - **„Als Text“** holt die gespeicherten Regeln eines Eintrags als Block der Schreibweise und hängt ihn an den Text (oder ersetzt das, was noch nichts Eigenes ist), öffnet die Ansicht, markiert den Block und prüft.
 * - Fehler (403, 409, 423 `map_locked` und `map_editing_off`, 503, auch kein Netz) stehen mit dem Satz des Servers in der Vorschau, wie bei den Nachbarn; der Text bleibt stehen.
 */

/** Ein Satz zur Vorschau: neutral (übernommen) oder ein Fehler. */
export interface TextMeldung {
    readonly ton: "neutral" | "gefahr";
    readonly satz: string;
}

/** Eine Aufforderung an das Textfeld, Zeilen zu markieren (`nr` zählt, damit dieselbe Stelle zweimal hintereinander wieder gilt). */
export interface TextMarkierung {
    readonly von: number;
    readonly bis: number;
    readonly nr: number;
}

export interface RegelTextSteuerung {
    /** Die Ansicht steht anstelle von Stammdaten und Orten. */
    readonly offen: Ref<boolean>;
    readonly text: Ref<string>;
    /** Die Vorschau des letzten Prüfens; sie gehört zum Text `geprueft`. */
    readonly ergebnis: ShallowRef<InhalteRegelTextErgebnis | undefined>;
    /** Gehört die Vorschau zum Text, wie er jetzt dasteht? */
    readonly aktuell: ComputedRef<boolean>;
    readonly prueftGerade: Ref<boolean>;
    readonly uebernimmtGerade: Ref<boolean>;
    /** Eine Anfrage läuft: Text und Antworten stehen still. */
    readonly beschaeftigt: ComputedRef<boolean>;
    readonly meldung: ShallowRef<TextMeldung | undefined>;
    readonly markierung: ShallowRef<TextMarkierung | undefined>;
    oeffne(): void;
    schliesse(): void;
    umschalten(): void;
    /** Der Mensch hat im Feld getippt: neuer Text, die Meldung des letzten Schritts geht. */
    tippe(neu: string): void;
    leere(): void;
    beispiel(): void;
    pruefe(): Promise<void>;
    /** Eine Antwort auf eine Rückfrage (oder ein Vorschlag zu einem Fehler): den Ersatz in den Text schreiben und neu prüfen. */
    wendeAn(ersatz: TextErsatz): Promise<void>;
    uebernimm(): Promise<void>;
    /** Die gespeicherten Regeln des Eintrags als Block an den Text hängen, die Ansicht öffnen und prüfen. */
    alsText(id: string): Promise<void>;
    /** Zeilen (ab 0, einschließlich) im Feld markieren lassen. */
    markiere(von: number, bis: number): void;
}

export interface RegelTextOptionen {
    client: Pick<InhalteClient, "regelTextPruefen" | "regelTextUebernehmen" | "vorkommenAlsText">;
    /** Die Steuerung des Reiters: Nach dem Übernehmen lädt sie die Liste und den gewählten Eintrag neu. */
    vorkommen?: Pick<VorkommenSteuerung, "ladeListeNeu" | "gewaehlt" | "geaendert" | "waehleDirekt"> | undefined;
    neueOperationId?: () => string;
}

/** Der Satz zu einem Fehler: der des Servers (deutsch, wie bei den Nachbarn), sonst ein eigener. */
const fehlerSatz = (fehler: Pick<ApiFehler, "message">): string =>
    fehler.message.trim() === "" ? t("inhalte.vorkommen.text.fehler.allgemein") : fehler.message;

export function createRegelTextSteuerung(optionen: RegelTextOptionen): RegelTextSteuerung {
    const { client, vorkommen } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;

    const offen = ref(false);
    const text = ref("");
    const ergebnis = shallowRef<InhalteRegelTextErgebnis | undefined>(undefined);
    const geprueft = ref<string | undefined>(undefined);
    const prueftGerade = ref(false);
    const uebernimmtGerade = ref(false);
    const meldung = shallowRef<TextMeldung | undefined>(undefined);
    const markierung = shallowRef<TextMarkierung | undefined>(undefined);
    let markierungNr = 0;
    /** Nur die jüngste Prüfung gilt: Eine späte Antwort auf einen älteren Text überschreibt nichts. */
    let pruefNr = 0;
    let alsTextAbbruch: AbortController | undefined;

    const aktuell = computed(() => istAktuell(ergebnis.value, geprueft.value, text.value));
    const beschaeftigt = computed(() => uebernimmtGerade.value);

    function fehlerAnzeigen(satz: string): void {
        meldung.value = { ton: "gefahr", satz };
    }
    function markiere(von: number, bis: number): void {
        markierungNr += 1;
        markierung.value = { von, bis, nr: markierungNr };
    }
    function setzeText(neu: string): void {
        text.value = neu;
        meldung.value = undefined;
    }

    /** Den Text prüfen. `behalteMeldung`: die Prüfung nach dem Übernehmen lässt dessen Satz stehen (er ist das Ergebnis des Schritts); jede andere löscht die Meldung des Schritts davor. */
    async function pruefeText(behalteMeldung: boolean): Promise<void> {
        if (uebernimmtGerade.value) return;
        const gesendet = text.value;
        pruefNr += 1;
        const nr = pruefNr;
        prueftGerade.value = true;
        if (!behalteMeldung) meldung.value = undefined;
        const antwort = await client.regelTextPruefen({ text: gesendet });
        if (nr !== pruefNr) return;
        prueftGerade.value = false;
        if (antwort.ok) {
            ergebnis.value = antwort.quittung;
            geprueft.value = gesendet;
            return;
        }
        const davor = behalteMeldung ? meldung.value?.satz : undefined;
        const satz = fehlerSatz(antwort.fehler);
        fehlerAnzeigen(davor === undefined ? satz : `${davor} ${satz}`);
    }

    async function wendeAn(ersatz: TextErsatz): Promise<void> {
        if (beschaeftigt.value || !aktuell.value) return;
        const neu = wendeErsatzAn(text.value, ersatz);
        if (neu === undefined) {
            fehlerAnzeigen(t("inhalte.vorkommen.text.fehler.stelle"));
            return;
        }
        setzeText(neu);
        markiere(ersatz.zeile, ersatz.zeile);
        await pruefeText(false);
    }

    async function uebernimm(): Promise<void> {
        const vorschau = ergebnis.value;
        if (beschaeftigt.value || vorschau === undefined || !aktuell.value || planLeer(vorschau.plan)) return;
        const gesendet = text.value;
        uebernimmtGerade.value = true;
        meldung.value = undefined;
        const antwort = await client.regelTextUebernehmen({ operationId: neueOperationId(), text: gesendet });
        uebernimmtGerade.value = false;
        if (!antwort.ok) {
            fehlerAnzeigen(fehlerSatz(antwort.fehler));
            return;
        }
        const entwurfOffen = vorkommen?.geaendert.value === true;
        // Der Text ist jetzt ein anderer: Die alte Vorschau gehört nicht mehr dazu und weicht der neuen Prüfung.
        text.value = antwort.quittung.rest;
        ergebnis.value = undefined;
        geprueft.value = undefined;
        meldung.value = { ton: "neutral", satz: uebernommenSatz(antwort.quittung, entwurfOffen) };
        // Die Liste kennt neue Einträge, der gewählte Eintrag neue Regeln. Ein Entwurf mit Änderungen bleibt: Er bekommt beim Speichern den Konflikt.
        if (vorkommen !== undefined) {
            vorkommen.ladeListeNeu();
            const gewaehlt = vorkommen.gewaehlt.value;
            if (gewaehlt !== undefined && !entwurfOffen) vorkommen.waehleDirekt(gewaehlt);
        }
        await pruefeText(true);
    }

    async function alsText(id: string): Promise<void> {
        if (beschaeftigt.value) return;
        alsTextAbbruch?.abort();
        const abbruch = new AbortController();
        alsTextAbbruch = abbruch;
        offen.value = true;
        let block: string;
        try {
            block = (await client.vorkommenAlsText(id, abbruch.signal)).text;
        } catch (fehler) {
            if (istAbbruch(fehler, abbruch.signal)) return;
            const f = alsApiFailure(fehler);
            fehlerAnzeigen(fehlerSatz(f));
            return;
        }
        if (abbruch.signal.aborted) return;
        const angehaengt = haengeBlockAn(text.value, block);
        setzeText(angehaengt.text);
        markiere(angehaengt.von, angehaengt.bis);
        await pruefeText(false);
    }

    if (getCurrentScope() !== undefined) onScopeDispose(() => alsTextAbbruch?.abort());

    return {
        offen,
        text,
        ergebnis,
        aktuell,
        prueftGerade,
        uebernimmtGerade,
        beschaeftigt,
        meldung,
        markierung,
        oeffne: () => {
            offen.value = true;
        },
        schliesse: () => {
            offen.value = false;
        },
        umschalten: () => {
            offen.value = !offen.value;
        },
        tippe: (neu) => {
            if (!beschaeftigt.value) setzeText(neu);
        },
        leere: () => {
            if (beschaeftigt.value) return;
            pruefNr += 1;
            prueftGerade.value = false;
            setzeText("");
            ergebnis.value = undefined;
            geprueft.value = undefined;
        },
        beispiel: () => {
            if (beschaeftigt.value) return;
            pruefNr += 1;
            prueftGerade.value = false;
            setzeText(TEXT_BEISPIEL);
            ergebnis.value = undefined;
            geprueft.value = undefined;
        },
        pruefe: () => pruefeText(false),
        wendeAn,
        uebernimm,
        alsText,
        markiere,
    };
}
