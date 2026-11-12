<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { type MediaAssetDetail, type MediaUsageResult, type PhotoboxSubmissionView } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { headerGraphicUrl } from "../info-panel/header-graphic";
import { BEZUG_RUHE_MS, letztesWort, sucheBezuege, type BezugWahl } from "../photobox/bezug-suche";
import { zustandTon } from "../photobox/status-modell";
import MedienFeldliste from "./medien-feldliste.vue";
import {
    AKTION_ZEICHEN,
    BESCHREIBUNG_MAX,
    NACHRICHT_MAX,
    angabenZeilen,
    darfErneutPruefen,
    darfOffline,
    dateiStand,
    korrekturAnfrage,
    nachrichtFehler,
    pruefKnoepfe,
    veroeffentlichung,
    wahlZuKorrektur,
    wirkungNachFreigabe,
    wirkungText,
    zeigtAbgeschlossen,
    zeigtNachFreigabe,
    zeigtPruefen,
    typbildName,
    zeigtTypbildVorschau,
    type EinreichungAktion,
    type EinreichungRechte,
    type KorrekturEingabe,
    zustandName,
} from "./medien-einreichung-modell";
import { Handlung, operationsFehler, type MedienOperationen, type OperationsFehler } from "./medien-operationen";
import type { KorrekturEntwurf } from "./medien-stelle";

/**
 * Die drei Kästen des Inspectors bei einer Reisebild-Einreichung (WI-0272 S3, Aufgabe 18; Probierseite Entwurf 7): „Prüfen“, „Nach der Freigabe“ und
 * „Angaben des Einsenders“. Der Inspector hängt sie nur ein, wenn das Asset eine Einreichung hat (`MediaAssetDetail.submission`).
 *
 * - **Prüfen:** Der erste Punkt („Datei geprüft und gerechnet“) kommt aus dem technischen Zustand des Bildes und ist nie von Hand zu setzen; zwei Punkte
 *   („keine erkennbaren Personen ohne Einverständnis“, „passt zu Aventurien und zur Stelle“) sind eine Merkhilfe der Person und werden nicht gespeichert. Dann
 *   Freigeben, Rückfrage …, Ablehnen … (je mit einem Textfeld) und Korrigieren … (Stelle auf der Karte, Ort oder Bezug, Beschreibung). Jede Operation baut auf der
 *   Revision der EINREICHUNG (`submission.revision`); ein Konflikt nennt die Person, die Eingaben bleiben stehen, „Neu laden“ holt den Stand.
 * - 🔴 **Die Knöpfe stehen nach Recht und Zustand** (`medien-einreichung-modell.ts`): ohne `moderate_submissions` keiner, „Offline nehmen“ nur mit `publish_media`.
 *   Rückfrage und Ablehnung erreichen den Einsender nur über seinen persönlichen Link; das sagt ein Satz im Kasten.
 * - **Nach der Freigabe:** was die Freigabe mit dem Reisebild macht (hinter die Ortsansicht, hinter das Typbild, oder an der Stelle auf der Karte), und, wenn schon
 *   freigegeben, ob es öffentlich ist. Davor „○ Erneut zur Prüfung“ (`moderate_submissions`, Vali 2026-11-09): wieder offen, ohne Rückfrage, denn nichts endet.
 *   Neben „Offline nehmen“ steht „Endgültig löschen …“
 *   (WI-0272, Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2): Es öffnet dasselbe Blatt wie unter „Handlungen“, mit denselben Rechten (`delete_media`, frischer Passkey) und
 *   demselben Grund, wenn es gesperrt ist (`loeschenGesperrt` vom Inspector). Ohne `delete_media` steht es hier nicht.
 * - **Angaben des Einsenders:** alles, was der Einsender schickte, samt Fassung der Bedingungen. Alles intern (der Name steht nur hier).
 */
const props = defineProps<{
    detail: MediaAssetDetail;
    /** Die Verwendungen des Assets: Aus der Verwendung der Rolle photobox liest der Kasten, ob das Reisebild öffentlich ist. */
    verwendung: MediaUsageResult | undefined;
    rechte: EinreichungRechte;
    operationen: MedienOperationen;
    /** Die Vorschau des Reisebilds (öffentlich oder die private), für „heute · nach der Freigabe“. */
    vorschauUrl?: string | undefined;
    /** Eine Stelle, die die Person auf der Karte gewählt hat; mit ihr öffnet die Korrektur gleich. */
    neueStelle?: { x: number; y: number } | undefined;
    /** Was in der Korrektur stand, bevor die Wahl auf der Karte begann (auch nach einem Abbruch): Die Korrektur öffnet gleich damit (Review S3 I2). */
    entwurf?: KorrekturEntwurf | undefined;
    /** Lädt der Inspektor das Asset gerade neu? Bis dahin steht noch der alte Stand (und seine Revision) da; die Knöpfe bleiben gesperrt (Review S3 M6b). */
    laedt?: boolean | undefined;
    /** Darf die Sitzung endgültig löschen (`delete_media`)? Dann steht „Endgültig löschen …“ neben „Offline nehmen“. */
    darfLoeschen?: boolean | undefined;
    /** Warum das Löschen gerade nicht geht (derselbe Satz wie unter „Handlungen“); `undefined`: es geht. */
    loeschenGesperrt?: string | undefined;
}>();
const emit = defineEmits<{
    /** Eine Operation ist durch: Der Inspector lädt Asset, Liste und Zahlen neu. */
    gespeichert: [];
    /** „Neu laden“ nach einem Konflikt: Der Inspector lädt das Asset neu. */
    neuLaden: [];
    /** „Stelle auf der Karte wählen“: Das Fenster gibt die Karte frei und kommt mit der gewählten Stelle und dem Entwurf der Korrektur zurück. */
    stelleWaehlen: [entwurf: KorrekturEntwurf];
    /**
     * Die Korrektur ist zu (Abbrechen, Speichern, ein anderes Formular) oder gab es nach der Freigabe nicht: Das Fenster vergisst Stelle und Entwurf (sonst öffnete sie die Korrektur bei jedem
     * Wiederkommen). 🪤 NICHT schon beim Öffnen: Die Medienverwaltung baut ihren Inspektor beim Wiederöffnen mehrfach neu auf (Laden); jeder Aufbau muss Stelle und Entwurf noch finden.
     */
    korrekturZu: [];
    /** „Endgültig löschen …“: Der Inspector öffnet das Blatt „Bild endgültig löschen?“. */
    loeschen: [];
}>();

const s = computed<PhotoboxSubmissionView>(() => props.detail.submission as PhotoboxSubmissionView);
const knoepfe = computed(() => pruefKnoepfe(s.value, props.rechte));
const gesperrtSatz = computed(() => {
    const grund = knoepfe.value.find((knopf) => knopf.gesperrt !== undefined)?.gesperrt;
    return grund === undefined ? undefined : t(grund);
});
const datei = computed(() => dateiStand(props.detail.asset.technicalState));
/** Die beiden Punkte der Merkhilfe stehen nur dort, wo wirklich entschieden wird. */
const entscheidbar = computed(() => s.value.zustand === "pending" || s.value.zustand === "changes_requested");
const wirkung = computed(() => wirkungNachFreigabe(s.value));
const vorschau = computed(() => {
    const w = wirkung.value;
    return zeigtTypbildVorschau(w) ? { typ: w.typ, url: headerGraphicUrl(w.typ), name: typbildName(w.typ) } : undefined;
});
const oeffentlich = computed(() => (s.value.zustand === "approved" ? veroeffentlichung(props.verwendung) : undefined));
const kannOffline = computed(() => darfOffline(s.value, props.rechte));
const kannErneut = computed(() => darfErneutPruefen(s.value, props.rechte));
/** „Endgültig löschen …“ nach der Freigabe, neben „Offline nehmen“ (WI-0272). */
const kannLoeschen = computed(() => props.darfLoeschen === true && s.value.zustand === "approved");
/** Abgeschlossen (offline, zurückgezogen …): „Endgültig löschen …“ im kleinen Kasten „Abgeschlossen“ am Bild (`zeigtAbgeschlossen`). */
const kannLoeschenAbgeschlossen = computed(() => props.darfLoeschen === true && zeigtAbgeschlossen(s.value));
const angaben = computed(() => angabenZeilen(s.value));

// --- Was gerade offen ist: Rückfrage, Ablehnung, Korrektur oder die Bestätigung des Offline-Nehmens --------------------------------------------

type Modus = "rueckfrage" | "ablehnen" | "korrigieren" | "offline";
const modus = ref<Modus | undefined>(undefined);
const text = ref("");
const personen = ref(false);
const passt = ref(false);
const sendet = ref(false);
/**
 * Eine Operation ist durch, das Asset wird neu geladen (Review S3 M6b): Bis der neue Stand da ist, trüge ein zweiter Klick die ALTE Revision, bekäme `edit_conflict` und nennte die Person selbst als die,
 * die schneller war. Darum bleiben die Knöpfe bis zum Ende des Nachladens gesperrt (neues Asset oder Ende des Ladens, auch ein gescheitertes).
 */
const nachladen = ref(false);
const beschaeftigt = computed(() => sendet.value || nachladen.value);
const fehler = ref<OperationsFehler | undefined>(undefined);
/** Wo der Fehler steht: Eine Operation des Kastens „Nach der Freigabe“ (Offline nehmen) meldet dort, jede andere im Kasten „Prüfen“, nie in beiden (Review S3 M6d). */
const fehlerOrt = ref<"pruefen" | "folge">("pruefen");
const zeigeFehlerText = ref(false);
const handlungen = new Map<string, Handlung>();
const handlung = (art: string): Handlung => {
    let h = handlungen.get(art);
    if (h === undefined) {
        h = new Handlung();
        handlungen.set(art, h);
    }
    return h;
};

function oeffne(neu: Modus): void {
    // Rückfrage und Ablehnen teilen sich den Text: Beim Wechsel zwischen den beiden bleibt, was getippt ist (Review S3 M6a).
    const textBleibt =
        (neu === "rueckfrage" || neu === "ablehnen") && (modus.value === "rueckfrage" || modus.value === "ablehnen");
    modus.value = neu;
    fehler.value = undefined;
    zeigeFehlerText.value = false;
    if (!textBleibt) text.value = "";
    if (neu === "korrigieren") korrekturOeffnen();
}

function schliesse(): void {
    modus.value = undefined;
    fehler.value = undefined;
    zeigeFehlerText.value = false;
}

/** Eine Operation: gesendet wird, solange keine läuft; danach zu, und der Inspector lädt neu. Ein Fehler steht an dieser Stelle, die Eingaben bleiben. */
async function lauf(art: string, aufruf: (operationId: string) => Promise<unknown>): Promise<void> {
    if (beschaeftigt.value) return;
    sendet.value = true;
    fehler.value = undefined;
    fehlerOrt.value = art === "offline" || art === "erneut" ? "folge" : "pruefen";
    try {
        await handlung(art).fuehreAus(aufruf);
        modus.value = undefined;
        text.value = "";
        // Der Inspektor lädt das Asset neu: Bis es da ist, bleiben die Knöpfe gesperrt.
        nachladen.value = true;
        emit("gespeichert");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}

// Das Nachladen ist zu Ende: ein neues Asset ist da, oder das Laden hat aufgehört (auch ein gescheitertes ließe die Knöpfe sonst auf immer gesperrt).
watch(
    () => props.detail,
    () => {
        nachladen.value = false;
    },
);
watch(
    () => props.laedt,
    (jetzt, vorher) => {
        if (vorher === true && jetzt !== true) nachladen.value = false;
    },
);
// Ändert sich der Zustand der Einreichung (jemand war schneller, „Neu laden“), gilt das offene Formular nicht mehr: Die nächste Operation wäre wieder ein 409 `photobox_transition` (Review S3 M6c).
watch(
    () => s.value.zustand,
    () => {
        if (modus.value !== undefined) schliesse();
    },
);

const basis = (operationId: string) => ({ operationId, baseRevision: s.value.revision });

function freigeben(): void {
    void lauf("freigeben", (operationId) => props.operationen.reisebildFreigeben(s.value.publicId, basis(operationId)));
}

function rueckfrageSenden(): void {
    if (nachrichtFehler(text.value) !== undefined) {
        zeigeFehlerText.value = true;
        return;
    }
    const nachricht = text.value.trim();
    void lauf("rueckfrage", (operationId) =>
        props.operationen.reisebildRueckfrage(s.value.publicId, { ...basis(operationId), nachricht }),
    );
}

function ablehnenSenden(): void {
    if (nachrichtFehler(text.value) !== undefined) {
        zeigeFehlerText.value = true;
        return;
    }
    const grund = text.value.trim();
    void lauf("ablehnen", (operationId) =>
        props.operationen.reisebildAblehnen(s.value.publicId, { ...basis(operationId), grund }),
    );
}

function offlineNehmen(): void {
    void lauf("offline", (operationId) => props.operationen.reisebildOffline(s.value.publicId, basis(operationId)));
}

/** Erneut zur Prüfung: ohne Rückfrage, denn nichts endet; die nächste Entscheidung steht danach im Kasten „Prüfen“. */
function erneutPruefen(): void {
    void lauf("erneut", (operationId) =>
        props.operationen.reisebildErneutPruefen(s.value.publicId, basis(operationId)),
    );
}

function auswahl(aktion: EinreichungAktion): void {
    if (aktion === "freigeben" || aktion === "uebernehmen") freigeben();
    else if (aktion === "rueckfrage") oeffne("rueckfrage");
    else if (aktion === "ablehnen") oeffne("ablehnen");
    else oeffne("korrigieren");
}

const nachrichtProblem = computed(() => (zeigeFehlerText.value ? nachrichtFehler(text.value) : undefined));
const nachrichtLaenge = computed(() => [...text.value].length);

/** „Neu laden“ nach einem Konflikt oder einem Zustand, der die Handlung nicht mehr erlaubt: Die Eingaben bleiben stehen. */
const neuLadenNoetig = computed(
    () => fehler.value?.konflikt !== undefined || fehler.value?.code === "photobox_transition",
);
function neuLaden(): void {
    fehler.value = undefined;
    emit("neuLaden");
}

// --- Korrigieren -----------------------------------------------------------------------------------------------------------------------------

const korrekturBeschreibung = ref("");
const korrekturLage = ref<{ x: number; y: number } | undefined>(undefined);
const korrekturOrt = ref<KorrekturEingabe["ort"]>(undefined);
const korrekturBezug = ref<KorrekturEingabe["bezug"]>(undefined);
const suche = ref("");
const treffer = ref<BezugWahl[]>([]);
const sucheFehlt = ref(false);
let sucheTimer: ReturnType<typeof setTimeout> | undefined;
let sucheLauf: AbortController | undefined;

/** Vor der Freigabe lässt sich alles berichtigen, danach nur die Beschreibung (`photobox/redaktion.ts`). */
const nurBeschreibung = computed(() => s.value.zustand === "approved");

/** Die Stelle von der Karte, bis die Korrektur sie übernommen hat. */
const wartendeStelle = ref<{ x: number; y: number } | undefined>(undefined);

function korrekturOeffnen(): void {
    korrekturBeschreibung.value =
        s.value.zustand === "approved" ? (s.value.wartendeBeschreibung ?? s.value.beschreibung) : s.value.beschreibung;
    korrekturLage.value = wartendeStelle.value;
    wartendeStelle.value = undefined;
    korrekturOrt.value = undefined;
    korrekturBezug.value = undefined;
    suche.value = "";
    treffer.value = [];
    sucheFehlt.value = false;
}

/** Der Stand der Korrektur, wie er mit zur Karte geht (und von dort zurückkommt). */
const entwurfJetzt = (): KorrekturEntwurf => ({
    beschreibung: korrekturBeschreibung.value,
    lage: korrekturLage.value,
    ort: korrekturOrt.value,
    bezug: korrekturBezug.value,
    suche: suche.value,
});

// Aus der Kartenwahl zurück, mit Stelle oder (Esc) ohne: Die Korrektur steht gleich offen, mit allem, was in ihr stand, und mit der neuen Stelle, wenn es eine gibt.
watch(
    () => [props.neueStelle, props.entwurf] as const,
    ([stelle, entwurf]) => {
        if (stelle === undefined && entwurf === undefined) return;
        // Nach der Freigabe lässt sich nur die Beschreibung ändern: Dort öffnet nichts, und es gibt nichts zu behalten.
        if (nurBeschreibung.value) {
            emit("korrekturZu");
            return;
        }
        if (modus.value === "korrigieren" && entwurf === undefined) {
            if (stelle !== undefined) korrekturLage.value = stelle;
        } else {
            wartendeStelle.value = stelle ?? entwurf?.lage;
            oeffne("korrigieren");
            if (entwurf !== undefined) {
                korrekturBeschreibung.value = entwurf.beschreibung;
                korrekturOrt.value = entwurf.ort;
                korrekturBezug.value = entwurf.bezug;
                suche.value = entwurf.suche;
            }
        }
    },
    { immediate: true },
);
watch(modus, (jetzt, vorher) => {
    if (vorher === "korrigieren" && jetzt !== "korrigieren") emit("korrekturZu");
});
// Stand ein Suchtext da, als die Wahl begann, fragt die Suche noch einmal (die Trefferliste ist nicht mitgereist).
onMounted(() => {
    if (suche.value !== "" && treffer.value.length === 0) sucheAendern(suche.value);
});

const eingabe = computed<KorrekturEingabe>(() => ({
    beschreibung: korrekturBeschreibung.value,
    lage: korrekturLage.value,
    ort: korrekturOrt.value,
    bezug: korrekturBezug.value,
}));
const anfrage = computed(() => korrekturAnfrage(s.value, eingabe.value));
const korrekturFehlt = computed(() =>
    anfrage.value === undefined ? t("medien.einreichung.korrektur.nichts") : undefined,
);

/** Der Ort und der Bezug, wie sie nach der Korrektur stünden (die Wahl, sonst die der Einreichung). */
const ortAnzeige = computed(() =>
    korrekturOrt.value === undefined ? (s.value.ort?.name ?? undefined) : (korrekturOrt.value?.name ?? undefined),
);
const bezugAnzeige = computed(() => {
    if (korrekturBezug.value === null) return undefined;
    if (korrekturBezug.value !== undefined) return korrekturBezug.value.name;
    return s.value.bezug === undefined ? undefined : s.value.bezug.id.replace(/^name:/, "");
});

function sucheAendern(wert: string): void {
    suche.value = wert;
    if (sucheTimer !== undefined) clearTimeout(sucheTimer);
    sucheLauf?.abort();
    const wort = letztesWort(wert);
    if (wort === undefined) {
        treffer.value = [];
        sucheFehlt.value = false;
        return;
    }
    sucheTimer = setTimeout(() => {
        sucheLauf = new AbortController();
        const signal = sucheLauf.signal;
        sucheBezuege(wort, signal)
            .then((gefunden) => {
                if (signal.aborted) return;
                treffer.value = gefunden;
                sucheFehlt.value = false;
            })
            .catch(() => {
                if (!signal.aborted) sucheFehlt.value = true;
            });
    }, BEZUG_RUHE_MS);
}

function trefferWaehlen(wahl: BezugWahl): void {
    const korrektur = wahlZuKorrektur(wahl);
    if (korrektur.ort !== undefined) korrekturOrt.value = korrektur.ort;
    if (korrektur.bezug !== undefined) korrekturBezug.value = korrektur.bezug;
    suche.value = "";
    treffer.value = [];
}

function korrekturSenden(): void {
    const rumpf = anfrage.value;
    if (rumpf === undefined) return;
    void lauf("korrigieren", (operationId) =>
        props.operationen.reisebildKorrigieren(s.value.publicId, { ...basis(operationId), ...rumpf }),
    );
}

onBeforeUnmount(() => {
    if (sucheTimer !== undefined) clearTimeout(sucheTimer);
    sucheLauf?.abort();
});
</script>

<template>
    <div class="medien-einreichung" data-testid="medien-einreichung">
        <!-- ===== Prüfen ===== -->
        <FensterKarte
            v-if="zeigtPruefen(s)"
            :titel="t('medien.einreichung.pruefen')"
            data-testid="medien-einreichung-pruefen"
        >
            <template #etikett>
                <AvmPille :ton="zustandTon(s.zustand)" testid="medien-einreichung-zustand">{{
                    zustandName(s.zustand)
                }}</AvmPille>
            </template>
            <p v-if="!rechte.moderieren" class="medien-einreichung__satz" data-testid="medien-einreichung-kein-recht">
                {{ t("medien.einreichung.keinRecht") }}
            </p>
            <template v-else>
                <div class="medien-einreichung__haken">
                    <AvmKaestchen
                        art="checkbox"
                        :checked="datei === 'geprueft'"
                        gesperrt=""
                        testid="medien-einreichung-datei"
                    >
                        {{ t(`medien.einreichung.datei.${datei}` as MessageKey) }}
                    </AvmKaestchen>
                    <template v-if="entscheidbar">
                        <AvmKaestchen
                            art="checkbox"
                            :checked="personen"
                            testid="medien-einreichung-personen"
                            @change="personen = $event"
                        >
                            {{ t("medien.einreichung.personen") }}
                        </AvmKaestchen>
                        <AvmKaestchen
                            art="checkbox"
                            :checked="passt"
                            testid="medien-einreichung-passt"
                            @change="passt = $event"
                        >
                            {{ t("medien.einreichung.passt") }}
                        </AvmKaestchen>
                    </template>
                </div>

                <p v-if="gesperrtSatz" class="medien-einreichung__satz" data-testid="medien-einreichung-gesperrt">
                    {{ gesperrtSatz }}
                </p>
                <div
                    v-if="knoepfe.length > 0"
                    class="medien-einreichung__knoepfe"
                    data-testid="medien-einreichung-knoepfe"
                >
                    <AvmKnopf
                        v-for="knopf in knoepfe"
                        :key="knopf.aktion"
                        :art="
                            knopf.aktion === 'freigeben' || knopf.aktion === 'uebernehmen'
                                ? 'gefuellt'
                                : knopf.aktion === 'ablehnen'
                                  ? 'gefahr'
                                  : undefined
                        "
                        groesse="zeile"
                        :gesperrt="knopf.gesperrt === undefined ? (beschaeftigt ? '' : undefined) : ''"
                        :testid="`medien-einreichung-${knopf.aktion}`"
                        @click="auswahl(knopf.aktion)"
                    >
                        <template #zeichen>{{ AKTION_ZEICHEN[knopf.aktion] }}</template>
                        {{ t(`medien.einreichung.knopf.${knopf.aktion}` as MessageKey) }}
                    </AvmKnopf>
                </div>
                <p v-if="entscheidbar" class="medien-einreichung__satz" data-testid="medien-einreichung-nur-link">
                    {{ t("medien.einreichung.nurLink") }}
                </p>

                <!-- Rückfrage und Ablehnung: ein Textfeld -->
                <form
                    v-if="modus === 'rueckfrage' || modus === 'ablehnen'"
                    class="medien-einreichung__form"
                    novalidate
                    :data-testid="`medien-einreichung-${modus}-form`"
                    @submit.prevent="modus === 'rueckfrage' ? rueckfrageSenden() : ablehnenSenden()"
                >
                    <label class="medien-einreichung__label" :for="`medien-einreichung-${modus}-text`">{{
                        t(`medien.einreichung.nachricht.${modus}` as MessageKey)
                    }}</label>
                    <AvmTextbereich
                        :id="`medien-einreichung-${modus}-text`"
                        v-model="text"
                        :zeilen="3"
                        :ungueltig="nachrichtProblem !== undefined"
                        :gesperrt="sendet ? '' : undefined"
                        :maxlength="NACHRICHT_MAX + 200"
                        :testid="`medien-einreichung-${modus}-text`"
                    />
                    <span
                        class="medien-einreichung__zaehler"
                        :class="{ 'is-zuviel': nachrichtLaenge > NACHRICHT_MAX }"
                        >{{
                            t("medien.einreichung.nachricht.zaehler", { n: nachrichtLaenge, max: NACHRICHT_MAX })
                        }}</span
                    >
                    <p
                        v-if="nachrichtProblem"
                        class="medien-einreichung__befund"
                        data-testid="medien-einreichung-nachricht-fehler"
                    >
                        {{ t(nachrichtProblem) }}
                    </p>
                    <div class="medien-einreichung__fuss">
                        <AvmKnopf
                            groesse="zeile"
                            :testid="`medien-einreichung-${modus}-abbrechen`"
                            @click="schliesse"
                            >{{ t("medien.bearbeiten.abbrechen") }}</AvmKnopf
                        >
                        <AvmKnopf
                            :art="modus === 'ablehnen' ? 'gefahr' : 'gefuellt'"
                            groesse="zeile"
                            typ="submit"
                            :gesperrt="beschaeftigt ? t('medien.bearbeiten.sendet') : undefined"
                            :testid="`medien-einreichung-${modus}-senden`"
                            >{{ t(`medien.einreichung.senden.${modus}` as MessageKey) }}</AvmKnopf
                        >
                    </div>
                </form>

                <!-- Korrigieren: Stelle, Ort oder Bezug, Beschreibung -->
                <form
                    v-if="modus === 'korrigieren'"
                    class="medien-einreichung__form"
                    novalidate
                    data-testid="medien-einreichung-korrigieren-form"
                    @submit.prevent="korrekturSenden"
                >
                    <p v-if="nurBeschreibung" class="medien-einreichung__satz">
                        {{ t("medien.einreichung.korrektur.nurBeschreibung") }}
                    </p>
                    <label class="medien-einreichung__label" for="medien-einreichung-korrektur-text">{{
                        t("medien.einreichung.korrektur.beschreibung")
                    }}</label>
                    <AvmTextbereich
                        id="medien-einreichung-korrektur-text"
                        v-model="korrekturBeschreibung"
                        :zeilen="3"
                        :gesperrt="sendet ? '' : undefined"
                        :maxlength="BESCHREIBUNG_MAX"
                        testid="medien-einreichung-korrektur-text"
                    />
                    <template v-if="!nurBeschreibung">
                        <div class="medien-einreichung__zeile">
                            <span class="medien-einreichung__label">{{
                                t("medien.einreichung.korrektur.stelle")
                            }}</span>
                            <span data-testid="medien-einreichung-korrektur-stelle">{{
                                korrekturLage === undefined
                                    ? `${s.lage.x} / ${s.lage.y}`
                                    : t("medien.einreichung.korrektur.stelleNeu", {
                                          x: korrekturLage.x,
                                          y: korrekturLage.y,
                                      })
                            }}</span>
                            <AvmKnopf
                                groesse="zeile"
                                testid="medien-einreichung-stelle-waehlen"
                                @click="emit('stelleWaehlen', entwurfJetzt())"
                            >
                                <template #zeichen>✚</template>
                                {{ t("medien.einreichung.korrektur.stelleWaehlen") }}
                            </AvmKnopf>
                        </div>
                        <div class="medien-einreichung__zeile">
                            <span class="medien-einreichung__label">{{ t("medien.einreichung.korrektur.bezug") }}</span>
                            <span class="medien-einreichung__chips">
                                <span
                                    v-if="ortAnzeige !== undefined"
                                    class="medien-einreichung__chip"
                                    data-testid="medien-einreichung-chip-ort"
                                >
                                    {{ t("medien.einreichung.korrektur.ort", { name: ortAnzeige }) }}
                                    <button
                                        type="button"
                                        :aria-label="t('medien.einreichung.korrektur.entfernen')"
                                        :title="t('medien.einreichung.korrektur.entfernen')"
                                        @click="korrekturOrt = null"
                                    >
                                        ✕
                                    </button>
                                </span>
                                <span
                                    v-if="bezugAnzeige !== undefined"
                                    class="medien-einreichung__chip"
                                    data-testid="medien-einreichung-chip-bezug"
                                >
                                    {{ t("medien.einreichung.korrektur.bezugChip", { name: bezugAnzeige }) }}
                                    <button
                                        type="button"
                                        :aria-label="t('medien.einreichung.korrektur.entfernen')"
                                        :title="t('medien.einreichung.korrektur.entfernen')"
                                        @click="korrekturBezug = null"
                                    >
                                        ✕
                                    </button>
                                </span>
                            </span>
                        </div>
                        <AvmEingabe
                            art="suche"
                            :model-value="suche"
                            :placeholder="t('medien.einreichung.korrektur.suche')"
                            :aria-label="t('medien.einreichung.korrektur.suche')"
                            maxlength="80"
                            testid="medien-einreichung-suche"
                            @update:model-value="sucheAendern"
                        />
                        <ul
                            v-if="treffer.length > 0"
                            class="medien-einreichung__treffer"
                            data-testid="medien-einreichung-treffer"
                        >
                            <li v-for="wahl in treffer" :key="`${wahl.art}:${wahl.id}`">
                                <button type="button" @click="trefferWaehlen(wahl)">
                                    <span>{{ wahl.name }}</span>
                                    <span class="medien-einreichung__klein">{{ wahl.typ }}</span>
                                </button>
                            </li>
                        </ul>
                        <p v-else-if="sucheFehlt" class="medien-einreichung__satz">
                            {{ t("medien.einreichung.korrektur.sucheFehlt") }}
                        </p>
                    </template>
                    <div class="medien-einreichung__fuss">
                        <span v-if="korrekturFehlt" class="medien-einreichung__klein">{{ korrekturFehlt }}</span>
                        <AvmKnopf
                            groesse="zeile"
                            testid="medien-einreichung-korrigieren-abbrechen"
                            @click="schliesse"
                            >{{ t("medien.bearbeiten.abbrechen") }}</AvmKnopf
                        >
                        <AvmKnopf
                            art="gefuellt"
                            groesse="zeile"
                            typ="submit"
                            :gesperrt="
                                beschaeftigt
                                    ? t('medien.bearbeiten.sendet')
                                    : korrekturFehlt === undefined
                                      ? undefined
                                      : ''
                            "
                            testid="medien-einreichung-korrigieren-senden"
                            >{{ t("medien.einreichung.korrektur.speichern") }}</AvmKnopf
                        >
                    </div>
                </form>

                <AvmHinweis
                    v-if="fehler && fehlerOrt === 'pruefen'"
                    :ton="fehler.ton"
                    rolle="alert"
                    testid="medien-einreichung-fehler"
                    >{{ fehler.text }}</AvmHinweis
                >
                <AvmKnopf
                    v-if="neuLadenNoetig && fehlerOrt === 'pruefen'"
                    groesse="zeile"
                    testid="medien-einreichung-neu-laden"
                    @click="neuLaden"
                >
                    <template #zeichen>↺</template>
                    {{ t("medien.bearbeiten.neuLaden") }}
                </AvmKnopf>
            </template>
        </FensterKarte>

        <!-- ===== Abgeschlossen: der Zustand und „Endgültig löschen …“ am Bild ===== -->
        <FensterKarte
            v-if="kannLoeschenAbgeschlossen"
            :titel="t('medien.einreichung.abgeschlossen')"
            data-testid="medien-einreichung-abgeschlossen"
        >
            <p class="medien-einreichung__satz">
                {{ t("medien.einreichung.abgeschlossenSatz", { zustand: zustandName(s.zustand) }) }}
            </p>
            <div class="medien-einreichung__knoepfe">
                <AvmKnopf
                    art="gefahr"
                    groesse="zeile"
                    :gesperrt="loeschenGesperrt"
                    testid="medien-einreichung-loeschen"
                    @click="emit('loeschen')"
                >
                    <template #zeichen>✕</template>
                    {{ t("medien.handlung.loeschen") }}
                </AvmKnopf>
            </div>
        </FensterKarte>

        <!-- ===== Nach der Freigabe ===== -->
        <FensterKarte
            v-if="zeigtNachFreigabe(s)"
            :titel="t('medien.einreichung.nachFreigabe')"
            data-testid="medien-einreichung-folge"
        >
            <p
                class="medien-einreichung__satz medien-einreichung__satz--stark"
                data-testid="medien-einreichung-wirkung"
            >
                {{ wirkungText(wirkung) }}
            </p>
            <div
                v-if="vorschau && vorschauUrl"
                class="medien-einreichung__vorher"
                data-testid="medien-einreichung-vorher"
            >
                <figure>
                    <img :src="vorschau.url" :alt="vorschau.name" />
                    <figcaption>{{ t("medien.einreichung.vorher") }}</figcaption>
                </figure>
                <span aria-hidden="true">→</span>
                <figure>
                    <img :src="vorschauUrl" alt="" />
                    <figcaption>{{ t("medien.einreichung.nachher") }}</figcaption>
                </figure>
            </div>
            <p
                v-if="oeffentlich"
                class="medien-einreichung__satz"
                :class="{ 'is-warnung': !oeffentlich.oeffentlich }"
                data-testid="medien-einreichung-veroeffentlichung"
            >
                {{ oeffentlich.text }}
            </p>
            <template v-if="kannErneut || kannOffline || kannLoeschen">
                <div v-if="modus !== 'offline'" class="medien-einreichung__knoepfe">
                    <AvmKnopf
                        v-if="kannErneut"
                        groesse="zeile"
                        :gesperrt="beschaeftigt ? t('medien.bearbeiten.sendet') : undefined"
                        testid="medien-einreichung-erneut"
                        @click="erneutPruefen"
                    >
                        <template #zeichen>{{ AKTION_ZEICHEN.erneut }}</template>
                        {{ t("medien.einreichung.knopf.erneut") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="kannOffline"
                        art="gefahr"
                        groesse="zeile"
                        testid="medien-einreichung-offline"
                        @click="oeffne('offline')"
                    >
                        <template #zeichen>{{ AKTION_ZEICHEN.offline }}</template>
                        {{ t("medien.einreichung.knopf.offline") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="kannLoeschen"
                        art="gefahr"
                        groesse="zeile"
                        :gesperrt="loeschenGesperrt"
                        testid="medien-einreichung-loeschen"
                        @click="emit('loeschen')"
                    >
                        <template #zeichen>✕</template>
                        {{ t("medien.handlung.loeschen") }}
                    </AvmKnopf>
                </div>
                <!-- „Erneut zur Prüfung“ fragt nicht nach: Ein Fehler steht unter den Knöpfen, mit „Neu laden“ bei einem Konflikt. -->
                <template v-if="modus !== 'offline' && fehler && fehlerOrt === 'folge'">
                    <AvmHinweis :ton="fehler.ton" rolle="alert" testid="medien-einreichung-erneut-fehler">{{
                        fehler.text
                    }}</AvmHinweis>
                    <AvmKnopf
                        v-if="neuLadenNoetig"
                        groesse="zeile"
                        testid="medien-einreichung-erneut-neu-laden"
                        @click="neuLaden"
                    >
                        <template #zeichen>↺</template>
                        {{ t("medien.bearbeiten.neuLaden") }}
                    </AvmKnopf>
                </template>
                <div
                    v-if="modus === 'offline'"
                    class="medien-einreichung__form"
                    data-testid="medien-einreichung-offline-frage"
                >
                    <p class="medien-einreichung__satz">{{ t("medien.einreichung.offline.warnung") }}</p>
                    <div class="medien-einreichung__fuss">
                        <AvmKnopf groesse="zeile" testid="medien-einreichung-offline-abbrechen" @click="schliesse">{{
                            t("medien.bearbeiten.abbrechen")
                        }}</AvmKnopf>
                        <AvmKnopf
                            art="gefahr"
                            groesse="zeile"
                            :gesperrt="beschaeftigt ? t('medien.bearbeiten.sendet') : undefined"
                            testid="medien-einreichung-offline-senden"
                            @click="offlineNehmen"
                        >
                            <template #zeichen>{{ AKTION_ZEICHEN.offline }}</template>
                            {{ t("medien.einreichung.knopf.offline") }}
                        </AvmKnopf>
                    </div>
                    <AvmHinweis
                        v-if="fehler && fehlerOrt === 'folge'"
                        :ton="fehler.ton"
                        rolle="alert"
                        testid="medien-einreichung-offline-fehler"
                        >{{ fehler.text }}</AvmHinweis
                    >
                    <!-- Auch wer nur `publish_media` hat, sieht den Kasten „Prüfen“ nicht: Das Neuladen steht dort, wo der Konflikt steht (Review S3 M6d). -->
                    <AvmKnopf
                        v-if="neuLadenNoetig && fehlerOrt === 'folge'"
                        groesse="zeile"
                        testid="medien-einreichung-offline-neu-laden"
                        @click="neuLaden"
                    >
                        <template #zeichen>↺</template>
                        {{ t("medien.bearbeiten.neuLaden") }}
                    </AvmKnopf>
                </div>
            </template>
        </FensterKarte>

        <!-- ===== Angaben des Einsenders ===== -->
        <FensterKarte :titel="t('medien.einreichung.angaben')" data-testid="medien-einreichung-angaben">
            <template #etikett>
                <AvmPille testid="medien-intern">{{ t("medien.intern") }}</AvmPille>
            </template>
            <MedienFeldliste :zeilen="angaben" testid="medien-einreichung-angaben-liste" />
        </FensterKarte>
    </div>
</template>

<style scoped>
.medien-einreichung {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.medien-einreichung__haken {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.medien-einreichung__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.medien-einreichung__satz--stark {
    color: var(--color-text-strong);
}

.medien-einreichung__satz.is-warnung {
    color: var(--color-warning-soft-text);
}

.medien-einreichung__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.medien-einreichung__form {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.medien-einreichung__label {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.medien-einreichung__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    font-size: var(--font-size-small);
}

.medien-einreichung__zaehler,
.medien-einreichung__klein {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-einreichung__zaehler.is-zuviel,
.medien-einreichung__befund {
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-caption);
}

.medien-einreichung__befund {
    margin: 0;
}

.medien-einreichung__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4);
}

.medien-einreichung__chips {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.medien-einreichung__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    font-size: var(--font-size-caption);
}

/* Das ✕ ist ein Ziel für den Finger (Review S3 M8): 24 × 24 statt 14 px; der negative Rand lässt den Chip so hoch bleiben, wie er war. */
.medien-einreichung__chip button {
    display: inline-grid;
    place-items: center;
    min-width: var(--icon-lg);
    min-height: var(--icon-lg);
    margin: calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) calc(-1 * var(--space-4)) 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-einreichung__chip button:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.medien-einreichung__chip button:active {
    background: var(--color-active-wash);
}

.medien-einreichung__chip button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-einreichung__treffer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.medien-einreichung__treffer button {
    display: flex;
    width: 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-einreichung__treffer button:hover {
    background: var(--color-hover-wash);
}

.medien-einreichung__treffer button:active {
    background: var(--color-active-wash);
}

.medien-einreichung__treffer button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Vorher und Nachher: das Typbild, das das Reisebild im Kopf ersetzt, neben dem Reisebild. Inhaltsbilder werden nie umgefärbt. */
.medien-einreichung__vorher {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.medien-einreichung__vorher figure {
    display: flex;
    flex: 1 1 0;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    margin: 0;
}

.medien-einreichung__vorher img {
    display: block;
    width: 100%;
    height: auto;
    max-height: var(--icon-banner);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    object-fit: contain;
}

.medien-einreichung__vorher figcaption {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .medien-einreichung__chip button,
    .medien-einreichung__treffer button {
        transition: none;
    }
}
</style>
