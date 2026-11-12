<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, useTemplateRef } from "vue";
import {
    KARTEN_ARTEN,
    KARTEN_FARBEN,
    KARTEN_TYPEN,
    KARTENVORSCHLAG_LIMITS,
    KARTENVORSCHLAG_NUTZUNGEN,
    type KarteTyp,
} from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import { phoneViewport } from "../controls/phone-viewport";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";
import { DATEI_GRUENDE } from "../system/datei-ablehnung";
import { NUTZUNG_ZEICHEN, REISEBILD_SYMBOLE } from "../photobox/reisebild-zeichen";
import ReisebildZeichen from "../photobox/reisebild-zeichen.vue";
import { leseBildMasse } from "./datei-masse";
import {
    DREIWERTIGE,
    dateiProbe,
    dateityp,
    linkHost,
    istLink,
    masseProbe,
    zeichen,
    type DreiwertigesFeld,
    type KartenEntwurf,
    type PflichtFeld,
} from "./modell";

/**
 * Der Rumpf des Formulars „Karte vorschlagen“ (WI-0275 Stufe C; Gestaltung: Mockup Fassung 4, gebaut im Ton und mit den Bausteinen der Reisebilder). Die Hülle, der Zustand (Entwurf, Absenden, Höhe) und der
 * Fuß mit „Vorschlag senden“ stehen in `kartenvorschlag-fenster.vue`, was gerechnet wird in `modell.ts`. Die Stile `.rb*` kommen aus `photobox/formular-stil.css`, dieselben wie bei „Eigenes Bild hinzufügen“.
 *
 * - **Oben die Wahl „Link“ oder „Eigene Datei“** (zwei Chips). Beide Flächen stehen übereinander in EINER Zelle, nur die gewählte ist sichtbar: Das Formular wird beim Umschalten nicht höher oder niedriger.
 * - **Pflicht sind nur der Link beziehungsweise die Datei und der Titel**, bei einer Datei dazu das Häkchen der Erklärung. Beschreibung, Quelle, Urheber, Name und „Mehr zur Karte“ sind freiwillig; die Quelle sperrt nie.
 *   Das fehlende Feld markiert und fokussiert der Aufrufer (`fehlt`, `fokussiere`), sobald jemand auf den gesperrten Knopf drückt.
 * - **Die Datei** wird nicht neu kodiert, nur geprüft (JPEG, PNG, WebP, PDF, bis 50 MB, `modell.ts`); ein Bild zeigt die Vorschau, ein PDF ein Zeichen mit dem Dateinamen. Die Ablage nimmt die Datei auch per Ziehen.
 * - **Nutzung und Erklärung** gibt es nur bei einer Datei: Bei einem Link wird nichts hochgeladen, also auch nichts erlaubt. Die Bedingungen klappen im Formular auf (kurz, lesbar), ohne die Seite zu verlassen.
 * - **Die dreiwertigen Angaben** (Spoiler, offiziell …) beginnen auf „unbekannt“ und gehen nur mit einem gewählten Ja oder Nein hinaus.
 * - **Honigtopf** (Fachkonzept §10.5): ein Feld, das ein Mensch nie sieht (aus der Tab-Folge, `aria-hidden`, `inert`); der Aufrufer schickt es mit.
 */
const props = defineProps<{
    entwurf: KartenEntwurf;
    /** Das Pflichtfeld, das nach einem Druck auf den gesperrten Knopf fehlt: Es trägt den Warnrand. */
    fehlt?: PflichtFeld | undefined;
}>();
/** Der Entwurf ist EIN reaktives Objekt, das die Hülle anlegt und hält; die Felder hier schreiben hinein. */
const entwurf = props.entwurf;

const kennungId = useId();
const dateiFeld = useTemplateRef<HTMLInputElement>("dateiFeld");
const ablageKnopf = useTemplateRef<HTMLButtonElement>("ablageKnopf");
const linkFeld = useTemplateRef<HTMLInputElement>("linkFeld");
const titelFeld = useTemplateRef<HTMLInputElement>("titelFeld");
const vorschauFeld = useTemplateRef<HTMLInputElement>("vorschauFeld");
const hakenFeld = useTemplateRef<HTMLInputElement>("hakenFeld");
const abschnitte = {
    link: useTemplateRef<HTMLElement>("linkAbschnitt"),
    datei: useTemplateRef<HTMLElement>("dateiAbschnitt"),
    titel: useTemplateRef<HTMLElement>("titelAbschnitt"),
    vorschau: useTemplateRef<HTMLElement>("vorschauAbschnitt"),
    haken: useTemplateRef<HTMLElement>("hakenZeile"),
    ab: useTemplateRef<HTMLElement>("abAbschnitt"),
    bis: useTemplateRef<HTMLElement>("bisAbschnitt"),
};
const abFeld = useTemplateRef<HTMLInputElement>("abFeld");
const bisFeld = useTemplateRef<HTMLInputElement>("bisFeld");
const mehrFalte = useTemplateRef<HTMLDetailsElement>("mehrFalte");

const ueberDerAblage = ref(false);
/** Warum die gewählte Datei nicht geht, als Satz; eine Funktion, damit er beim Wechsel der Sprache mitwechselt. */
const dateiFehler = ref<(() => string) | undefined>(undefined);
/** Die Vorschau eines gewählten Bildes (Adresse eines Blobs); bei einem PDF keine. */
const vorschauUrl = ref<string | undefined>(undefined);
const bedingungenOffen = ref(false);

function gibVorschauFrei(): void {
    if (vorschauUrl.value !== undefined) URL.revokeObjectURL(vorschauUrl.value);
    vorschauUrl.value = undefined;
}
onBeforeUnmount(gibVorschauFrei);

const istPdf = computed(() => entwurf.datei !== undefined && dateityp(entwurf.datei) === "application/pdf");

/**
 * Esc in einem Feld mit Geschriebenem schließt das Fenster nicht: Eine Beschreibung wäre mit einem Tastendruck weg (✕ bleibt der ausdrückliche Weg). Ohne Geschriebenes geht Esc wie bei jedem
 * Werkzeugfenster an die Hülle.
 */
function escImFormular(event: KeyboardEvent): void {
    if (
        entwurf.titel.trim() !== "" ||
        entwurf.beschreibung.trim() !== "" ||
        entwurf.link.trim() !== "" ||
        entwurf.datei !== undefined
    ) {
        // Im modalen Fenster kommt das Schließen von der Plattform (`cancel` nach dem Tastendruck): Das Vorgabeverhalten des Tastendrucks muss weg, nicht nur seine Weitergabe.
        event.preventDefault();
        event.stopPropagation();
    }
}

// --- Die Datei -----------------------------------------------------------------------------------------------------------------

async function waehleDatei(datei: File | undefined): Promise<void> {
    if (datei === undefined) return;
    const probe = dateiProbe(datei);
    if (!probe.ok) {
        const grund = probe.grund;
        dateiFehler.value = () => t(grund);
        return;
    }
    // WI-0291: Pixel und Kante eines Bildes liest der Browser vor dem Hochladen (der Server lehnt erst nach bis zu 50 MB ab); ein PDF hat hier keine Maße, und ein nicht lesbares Bild entscheidet der Server.
    if (dateityp(datei) !== "application/pdf") {
        const masse = await leseBildMasse(datei);
        const maesse = masse === undefined ? undefined : masseProbe(masse);
        if (maesse !== undefined && !maesse.ok) {
            const satz = DATEI_GRUENDE[maesse.grund];
            dateiFehler.value = () => satz?.({}) ?? "";
            return;
        }
    }
    dateiFehler.value = undefined;
    gibVorschauFrei();
    entwurf.datei = datei;
    if (dateityp(datei) !== "application/pdf") vorschauUrl.value = URL.createObjectURL(datei);
}
function entferneDatei(): void {
    entwurf.datei = undefined;
    dateiFehler.value = undefined;
    gibVorschauFrei();
}
function dateiGewaehlt(event: Event): void {
    const feld = event.target as HTMLInputElement;
    void waehleDatei(feld.files?.[0]);
    // Dieselbe Datei noch einmal wählen soll wieder ein Ereignis geben.
    feld.value = "";
}
function beimAblegen(event: DragEvent): void {
    ueberDerAblage.value = false;
    void waehleDatei(event.dataTransfer?.files?.[0]);
}

// --- Link, Typen, Angaben ------------------------------------------------------------------------------------------------------

const host = computed(() => linkHost(entwurf.link));
const linkSchlecht = computed(() => entwurf.link.trim() !== "" && !istLink(entwurf.link));
const vorschauSchlecht = computed(() => entwurf.vorschauLink.trim() !== "" && !istLink(entwurf.vorschauLink));

function schalteTyp(typ: KarteTyp, an: boolean): void {
    const ohne = entwurf.typen.filter((vorhanden) => vorhanden !== typ);
    entwurf.typen = an ? KARTEN_TYPEN.filter((wert) => wert === typ || ohne.includes(wert)) : ohne;
}

const nutzungen = KARTENVORSCHLAG_NUTZUNGEN.map((wert) => ({
    wert,
    text: `photobox.nutzung.${wert}` as MessageKey,
    zeichen: NUTZUNG_ZEICHEN[wert],
}));
const nutzungsErklaerung = computed(() => t(`kartenvorschlag.nutzung.erklaerung.${entwurf.nutzung}` as MessageKey));

const dreiwertigeFelder: readonly { readonly feld: DreiwertigesFeld; readonly text: MessageKey }[] = DREIWERTIGE.map(
    (feld) => ({ feld, text: `kartenvorschlag.tri.${feld}` as MessageKey }),
);
/** Die drei Schalter jeder Angabe; „unbekannt“ (leer) steht links und ist der Anfang (`modell.ts`). */
const DREIWERT_WAHL: readonly { readonly wert: "" | "ja" | "nein"; readonly text: MessageKey }[] = [
    { wert: "", text: "kartenvorschlag.unbekannt" },
    { wert: "ja", text: "kartenvorschlag.ja" },
    { wert: "nein", text: "kartenvorschlag.nein" },
];

/** Die vier Stufen der Farbigkeit: „unbekannt“ (leer) steht links und bleibt leer, nie „nein“; die übrigen sind die Farbmodus-Werte (`KARTEN_FARBEN`). */
const FARB_WAHL: readonly { readonly wert: "" | (typeof KARTEN_FARBEN)[number]; readonly text: MessageKey }[] = [
    { wert: "", text: "kartenvorschlag.unbekannt" },
    ...KARTEN_FARBEN.map((wert) => ({ wert, text: `kartenvorschlag.farbe.${wert}` as MessageKey })),
];

// --- Das fehlende Feld in Sicht und im Fokus -----------------------------------------------------------------------------------

/**
 * Das fehlende Pflichtfeld in Sicht rollen (der Rumpf rollt, der Fuß mit dem Knopf bleibt) und den Fokus hineinsetzen. Ohne Rollbewegung bei „weniger Bewegung“.
 */
function fokussiere(feld: PflichtFeld): void {
    const fokus: Record<PflichtFeld, HTMLElement | null> = {
        link: linkFeld.value,
        datei: ablageKnopf.value,
        titel: titelFeld.value,
        vorschau: vorschauFeld.value,
        haken: hakenFeld.value,
        ab: abFeld.value,
        bis: bisFeld.value,
    };
    // Die Jahre stehen in „Mehr zur Karte“: Ein zugeklapptes Feld nimmt weder Fokus noch zeigt es etwas.
    if ((feld === "ab" || feld === "bis") && mehrFalte.value !== null) mehrFalte.value.open = true;
    const reduziert = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    abschnitte[feld].value?.scrollIntoView?.({ block: "nearest", behavior: reduziert ? "auto" : "smooth" });
    fokus[feld]?.focus({ preventScroll: true });
}
/** Beim Öffnen: der Fokus auf die erste Wahl, das Feld des Links. */
function fokussiereAnfang(): void {
    (entwurf.weg === "link" ? linkFeld.value : ablageKnopf.value)?.focus({ preventScroll: true });
}
defineExpose({ fokussiere, fokussiereAnfang });
</script>

<template>
    <form
        class="rb"
        :class="{ 'rb--telefon': phoneViewport }"
        data-testid="kartenvorschlag-formular"
        novalidate
        @keydown.esc="escImFormular"
        @submit.prevent
    >
        <!-- Woher die Karte kommt -->
        <div class="rb__chips" role="radiogroup" :aria-label="t('kartenvorschlag.weg.label')">
            <label class="rb__chip" data-testid="kartenvorschlag-weg-link">
                <input v-model="entwurf.weg" class="rb__chipwahl" type="radio" name="kv-weg" value="link" />
                <ReisebildZeichen name="link" />
                <span>{{ t("kartenvorschlag.weg.link") }}</span>
            </label>
            <label class="rb__chip" data-testid="kartenvorschlag-weg-datei">
                <input v-model="entwurf.weg" class="rb__chipwahl" type="radio" name="kv-weg" value="datei" />
                <ReisebildZeichen name="hochladen" />
                <span>{{ t("kartenvorschlag.weg.datei") }}</span>
            </label>
        </div>

        <!-- Beide Flächen liegen in einer Zelle übereinander: Das Umschalten ändert die Höhe nicht. -->
        <div class="kf__stapel">
            <div
                ref="linkAbschnitt"
                class="rb__abschnitt kf__lage"
                :class="{ kf__weg: entwurf.weg !== 'link', 'is-fehlt': props.fehlt === 'link' }"
                :inert="entwurf.weg !== 'link'"
            >
                <div class="rb__platz">
                    <div class="kf__flaeche" :class="{ 'is-fehlt': props.fehlt === 'link' }">
                        <img
                            class="kf__symbol"
                            :src="REISEBILD_SYMBOLE.linkteilen"
                            alt=""
                            aria-hidden="true"
                            decoding="async"
                        />
                        <label class="kf__flaechen-titel" :for="`${kennungId}-link`">{{
                            t("kartenvorschlag.link.titel")
                        }}</label>
                        <input
                            :id="`${kennungId}-link`"
                            ref="linkFeld"
                            v-model="entwurf.link"
                            class="rb__eingabe"
                            :class="{ 'is-fehlt': props.fehlt === 'link' }"
                            type="url"
                            inputmode="url"
                            :maxlength="KARTENVORSCHLAG_LIMITS.linkMax"
                            placeholder="https://"
                            autocomplete="off"
                            spellcheck="false"
                            data-testid="kartenvorschlag-link"
                        />
                        <span
                            class="kf__fund"
                            :class="{ 'is-gut': host !== undefined, 'is-schlecht': linkSchlecht }"
                            role="status"
                            data-testid="kartenvorschlag-link-fund"
                        >
                            <template v-if="host !== undefined"
                                ><ReisebildZeichen name="haken" />{{
                                    t("kartenvorschlag.link.gut", { host })
                                }}</template
                            >
                            <template v-else-if="linkSchlecht">{{ t("kartenvorschlag.link.schlecht") }}</template>
                            <template v-else>{{ t("kartenvorschlag.link.hinweis") }}</template>
                        </span>
                    </div>
                </div>
            </div>

            <div
                ref="dateiAbschnitt"
                class="rb__abschnitt kf__lage"
                :class="{ kf__weg: entwurf.weg !== 'datei', 'is-fehlt': props.fehlt === 'datei' }"
                :inert="entwurf.weg !== 'datei'"
                role="group"
                :aria-label="t('kartenvorschlag.weg.datei')"
            >
                <div
                    class="rb__platz"
                    :class="{ 'is-drueber': ueberDerAblage }"
                    data-testid="kartenvorschlag-ablage"
                    @dragenter.prevent="ueberDerAblage = true"
                    @dragover.prevent="ueberDerAblage = true"
                    @dragleave="ueberDerAblage = false"
                    @drop.prevent="beimAblegen"
                >
                    <figure v-if="entwurf.datei !== undefined" class="rb__bild">
                        <div class="rb__rahmen">
                            <img
                                v-if="vorschauUrl !== undefined"
                                :src="vorschauUrl"
                                :alt="t('kartenvorschlag.datei.alt')"
                                data-testid="kartenvorschlag-vorschau"
                            />
                            <span v-else-if="istPdf" class="kf__pdf" data-testid="kartenvorschlag-pdf">
                                <img :src="REISEBILD_SYMBOLE.kartensammlung" alt="" aria-hidden="true" />
                                <span>{{ t("kartenvorschlag.datei.pdf") }}</span>
                                <small class="kf__pdf-seite" data-testid="kartenvorschlag-pdf-seite">{{
                                    t("kartenvorschlag.datei.pdfSeite")
                                }}</small>
                            </span>
                        </div>
                        <figcaption>
                            <span class="rb__dateiname einzeilig" :title="entwurf.datei.name">{{
                                entwurf.datei.name
                            }}</span>
                            <button
                                type="button"
                                class="rb__leise"
                                data-testid="kartenvorschlag-datei-anderes"
                                @click="dateiFeld?.click()"
                            >
                                {{ t("kartenvorschlag.datei.anderes") }}
                            </button>
                            <button
                                type="button"
                                class="rb__leise"
                                data-testid="kartenvorschlag-datei-entfernen"
                                @click="entferneDatei"
                            >
                                {{ t("photobox.bild.entfernen") }}
                            </button>
                        </figcaption>
                    </figure>
                    <button
                        v-else
                        ref="ablageKnopf"
                        type="button"
                        class="rb__ablage"
                        data-testid="kartenvorschlag-datei-waehlen"
                        @click="dateiFeld?.click()"
                    >
                        <span class="rb__ablage-symbol">
                            <img
                                class="rb__ablage-bild"
                                :src="REISEBILD_SYMBOLE.karteHochladen"
                                alt=""
                                aria-hidden="true"
                                decoding="async"
                            />
                            <span class="rb__plus"><ReisebildZeichen name="plus" /></span>
                        </span>
                        <span class="rb__ablage-titel">{{ t("kartenvorschlag.datei.waehlen") }}</span>
                        <span class="rb__ablage-ziehen">{{ t("kartenvorschlag.datei.ablage") }}</span>
                        <span class="rb__ablage-formate">{{ t("kartenvorschlag.datei.formate") }}</span>
                    </button>
                </div>
                <input
                    ref="dateiFeld"
                    class="rb__datei"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    tabindex="-1"
                    aria-hidden="true"
                    data-testid="kartenvorschlag-datei"
                    @change="dateiGewaehlt"
                />
                <AvmHinweis
                    v-if="dateiFehler !== undefined"
                    ton="gefahr"
                    rolle="alert"
                    testid="kartenvorschlag-datei-fehler"
                >
                    {{ dateiFehler() }}
                </AvmHinweis>
            </div>
        </div>

        <!-- Titel (Pflicht) -->
        <div ref="titelAbschnitt" class="rb__abschnitt">
            <label class="rb__titel" :for="`${kennungId}-titel`">
                <img
                    class="rb__sym"
                    :src="REISEBILD_SYMBOLE.kartensammlung"
                    alt=""
                    aria-hidden="true"
                    decoding="async"
                />
                {{ t("kartenvorschlag.titelfeld.label") }}
            </label>
            <input
                :id="`${kennungId}-titel`"
                ref="titelFeld"
                v-model="entwurf.titel"
                class="rb__eingabe"
                :class="{ 'is-fehlt': props.fehlt === 'titel' }"
                type="text"
                :maxlength="KARTENVORSCHLAG_LIMITS.titelMax"
                :placeholder="t('kartenvorschlag.titelfeld.platzhalter')"
                autocomplete="off"
                data-testid="kartenvorschlag-titel"
            />
        </div>

        <!-- Beschreibung (freiwillig, für Bilder und Links) -->
        <div class="rb__abschnitt">
            <div class="rb__titel">
                <label :for="`${kennungId}-beschreibung`">
                    <img
                        class="rb__sym"
                        :src="REISEBILD_SYMBOLE.papierundfeder"
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                    />
                    {{ t("kartenvorschlag.beschreibung.label") }}
                </label>
                <span class="rb__hinweis">{{ t("photobox.text.hinweis") }}</span>
                <span class="rb__zaehler" data-testid="kartenvorschlag-beschreibung-zaehler">{{
                    t("photobox.text.zaehler", {
                        n: zeichen(entwurf.beschreibung),
                        max: KARTENVORSCHLAG_LIMITS.beschreibungMax,
                    })
                }}</span>
            </div>
            <textarea
                :id="`${kennungId}-beschreibung`"
                v-model="entwurf.beschreibung"
                class="rb__eingabe"
                rows="3"
                :maxlength="KARTENVORSCHLAG_LIMITS.beschreibungMax"
                :placeholder="t('kartenvorschlag.beschreibung.platzhalter')"
                data-testid="kartenvorschlag-beschreibung"
            ></textarea>
        </div>

        <!-- Link: Quelle und Vorschaubild (beide freiwillig, die Quelle sperrt nie) -->
        <template v-if="entwurf.weg === 'link'">
            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-quelle`">
                    <img class="rb__sym" :src="REISEBILD_SYMBOLE.kompass" alt="" aria-hidden="true" decoding="async" />
                    {{ t("kartenvorschlag.quelle.label") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <input
                    :id="`${kennungId}-quelle`"
                    v-model="entwurf.quelle"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="KARTENVORSCHLAG_LIMITS.quelleMax"
                    :placeholder="t('kartenvorschlag.quelle.platzhalter')"
                    autocomplete="off"
                    data-testid="kartenvorschlag-quelle"
                />
            </div>
            <div ref="vorschauAbschnitt" class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-vorschau`">
                    <img
                        class="rb__sym"
                        :src="REISEBILD_SYMBOLE.bildmachen"
                        alt=""
                        aria-hidden="true"
                        decoding="async"
                    />
                    {{ t("kartenvorschlag.vorschau.label") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <input
                    :id="`${kennungId}-vorschau`"
                    ref="vorschauFeld"
                    v-model="entwurf.vorschauLink"
                    class="rb__eingabe"
                    :class="{ 'is-fehlt': props.fehlt === 'vorschau' || vorschauSchlecht }"
                    type="url"
                    inputmode="url"
                    :maxlength="KARTENVORSCHLAG_LIMITS.linkMax"
                    placeholder="https://"
                    autocomplete="off"
                    spellcheck="false"
                    data-testid="kartenvorschlag-vorschau-link"
                />
                <span class="rb__satz">{{ t("kartenvorschlag.vorschau.satz") }}</span>
            </div>
        </template>

        <!-- Datei: Nutzung und Erklärung -->
        <template v-else>
            <div class="rb__abschnitt" data-testid="kartenvorschlag-nutzung">
                <span :id="`${kennungId}-nutzung`" class="rb__titel">{{ t("photobox.nutzung.label") }}</span>
                <div class="rb__chips" role="radiogroup" :aria-labelledby="`${kennungId}-nutzung`">
                    <label
                        v-for="nutzung in nutzungen"
                        :key="nutzung.wert"
                        class="rb__chip"
                        :data-testid="`kartenvorschlag-nutzung-${nutzung.wert}`"
                    >
                        <input
                            v-model="entwurf.nutzung"
                            class="rb__chipwahl"
                            type="radio"
                            name="kv-nutzung"
                            :value="nutzung.wert"
                        />
                        <ReisebildZeichen :name="nutzung.zeichen" />
                        <span>{{ t(nutzung.text) }}</span>
                    </label>
                </div>
                <p class="rb__satz" data-testid="kartenvorschlag-nutzung-erklaerung">{{ nutzungsErklaerung }}</p>
            </div>

            <div ref="hakenZeile" class="rb__abschnitt">
                <label
                    class="rb__haken"
                    :class="{ 'is-fehlt': props.fehlt === 'haken' }"
                    data-testid="kartenvorschlag-haken"
                >
                    <input
                        ref="hakenFeld"
                        class="rb__haken-feld"
                        type="checkbox"
                        :checked="entwurf.haken"
                        @change="entwurf.haken = ($event.target as HTMLInputElement).checked"
                    />
                    <span class="rb__haken-kasten" aria-hidden="true"><ReisebildZeichen name="haken" /></span>
                    <span class="rb__haken-text"
                        >{{ t("photobox.haken.vor")
                        }}<button
                            type="button"
                            class="rb__verweis"
                            :aria-expanded="bedingungenOffen"
                            data-testid="kartenvorschlag-bedingungen"
                            @click.prevent="bedingungenOffen = !bedingungenOffen"
                        >
                            {{ t("photobox.haken.link") }}</button
                        >{{ t("kartenvorschlag.haken.nach") }}</span
                    >
                </label>
                <p
                    v-if="bedingungenOffen"
                    class="rb__satz kf__bedingungen"
                    data-testid="kartenvorschlag-bedingungen-text"
                >
                    {{ t("kartenvorschlag.bedingungen") }}
                </p>
            </div>
        </template>

        <!-- Urheber und Name nebeneinander -->
        <div class="rb__zeile">
            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-urheber`">
                    <img class="rb__sym" :src="REISEBILD_SYMBOLE.feder" alt="" aria-hidden="true" decoding="async" />
                    {{ t("kartenvorschlag.urheber.label") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <input
                    :id="`${kennungId}-urheber`"
                    v-model="entwurf.urheber"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="KARTENVORSCHLAG_LIMITS.urheberMax"
                    :placeholder="t('kartenvorschlag.urheber.platzhalter')"
                    data-testid="kartenvorschlag-urheber"
                />
            </div>
            <div class="rb__abschnitt">
                <label class="rb__titel" :for="`${kennungId}-name`">
                    <img class="rb__sym" :src="REISEBILD_SYMBOLE.feder" alt="" aria-hidden="true" decoding="async" />
                    {{ t("photobox.name.label") }}
                    <span class="rb__frei">{{ t("photobox.freiwillig") }}</span>
                </label>
                <input
                    :id="`${kennungId}-name`"
                    v-model="entwurf.name"
                    class="rb__eingabe"
                    type="text"
                    :maxlength="KARTENVORSCHLAG_LIMITS.nameMax"
                    :placeholder="t('photobox.name.platzhalter')"
                    autocomplete="nickname"
                    data-testid="kartenvorschlag-name"
                />
            </div>
        </div>

        <!-- Mehr zur Karte: alles freiwillig, ein Aufklappen -->
        <details ref="mehrFalte" class="kf__falte" data-testid="kartenvorschlag-mehr">
            <summary>
                <span>{{ t("kartenvorschlag.mehr.titel") }}</span>
                <span class="rb__frei">{{ t("kartenvorschlag.mehr.frei") }}</span>
                <ReisebildZeichen name="pfeil" class="kf__falte-pfeil" />
            </summary>
            <div class="kf__falte-rumpf">
                <div class="rb__abschnitt">
                    <span class="kf__klein">{{ t("kartenvorschlag.typ.label") }}</span>
                    <div class="kf__typen">
                        <label v-for="typ in KARTEN_TYPEN" :key="typ" class="rb__chip">
                            <input
                                class="rb__chipwahl"
                                type="checkbox"
                                :checked="entwurf.typen.includes(typ)"
                                @change="schalteTyp(typ, ($event.target as HTMLInputElement).checked)"
                            />
                            <span>{{ t(`catalog.citymaps.type.${typ}` as MessageKey) }}</span>
                        </label>
                    </div>
                </div>
                <div class="rb__abschnitt">
                    <label class="kf__klein" :for="`${kennungId}-art`">{{ t("kartenvorschlag.art.label") }}</label>
                    <div class="rb__wahl">
                        <select :id="`${kennungId}-art`" v-model="entwurf.art" class="rb__eingabe">
                            <option value="">{{ t("kartenvorschlag.unbekannt") }}</option>
                            <option v-for="art in KARTEN_ARTEN" :key="art" :value="art">
                                {{ t(`catalog.citymaps.art.${art}` as MessageKey) }}
                            </option>
                        </select>
                        <ReisebildZeichen name="pfeil" class="rb__pfeil" />
                    </div>
                </div>
                <div class="kf__drei">
                    <div class="kf__tri-zeile">
                        <span :id="`${kennungId}-farbe`" class="kf__klein">{{ t("kartenvorschlag.farbe.label") }}</span>
                        <span class="kf__tri" role="radiogroup" :aria-labelledby="`${kennungId}-farbe`">
                            <label v-for="wahl in FARB_WAHL" :key="wahl.wert">
                                <input
                                    v-model="entwurf.farbe"
                                    class="kf__tri-wahl"
                                    type="radio"
                                    :name="`${kennungId}-farbe`"
                                    :value="wahl.wert"
                                />
                                <span>{{ t(wahl.text) }}</span>
                            </label>
                        </span>
                    </div>
                </div>
                <div class="rb__zeile">
                    <div ref="abAbschnitt" class="rb__abschnitt">
                        <label class="kf__klein" :for="`${kennungId}-ab`">{{ t("kartenvorschlag.ab.label") }}</label>
                        <input
                            :id="`${kennungId}-ab`"
                            ref="abFeld"
                            v-model="entwurf.gueltigAb"
                            class="rb__eingabe"
                            :class="{ 'is-fehlt': props.fehlt === 'ab' }"
                            type="number"
                            inputmode="numeric"
                            :min="KARTENVORSCHLAG_LIMITS.jahrMin"
                            :max="KARTENVORSCHLAG_LIMITS.jahrMax"
                            placeholder="1027"
                        />
                    </div>
                    <div ref="bisAbschnitt" class="rb__abschnitt">
                        <label class="kf__klein" :for="`${kennungId}-bis`">{{ t("kartenvorschlag.bis.label") }}</label>
                        <input
                            :id="`${kennungId}-bis`"
                            ref="bisFeld"
                            v-model="entwurf.gueltigBis"
                            class="rb__eingabe"
                            :class="{ 'is-fehlt': props.fehlt === 'bis' }"
                            type="number"
                            inputmode="numeric"
                            :min="KARTENVORSCHLAG_LIMITS.jahrMin"
                            :max="KARTENVORSCHLAG_LIMITS.jahrMax"
                            placeholder="1045"
                        />
                    </div>
                </div>
                <div class="kf__drei">
                    <div v-for="eintrag in dreiwertigeFelder" :key="eintrag.feld" class="kf__tri-zeile">
                        <span :id="`${kennungId}-${eintrag.feld}`" class="kf__klein">{{ t(eintrag.text) }}</span>
                        <span class="kf__tri" role="radiogroup" :aria-labelledby="`${kennungId}-${eintrag.feld}`">
                            <label v-for="wert in DREIWERT_WAHL" :key="wert.wert">
                                <input
                                    v-model="entwurf[eintrag.feld]"
                                    class="kf__tri-wahl"
                                    type="radio"
                                    :name="`${kennungId}-${eintrag.feld}`"
                                    :value="wert.wert"
                                />
                                <span>{{ t(wert.text) }}</span>
                            </label>
                        </span>
                    </div>
                </div>
                <div class="rb__abschnitt">
                    <label class="kf__klein" :for="`${kennungId}-notiz`">{{ t("kartenvorschlag.notiz.label") }}</label>
                    <textarea
                        :id="`${kennungId}-notiz`"
                        v-model="entwurf.notiz"
                        class="rb__eingabe"
                        rows="2"
                        :maxlength="KARTENVORSCHLAG_LIMITS.notizMax"
                        :placeholder="t('kartenvorschlag.notiz.platzhalter')"
                    ></textarea>
                </div>
            </div>
        </details>

        <!-- Der Honigtopf: für Menschen nicht erreichbar (aus der Tab-Folge, versteckt vor Vorlesern, träge), aber im Dokument; nicht `display: none`. -->
        <div class="rb__honig" aria-hidden="true" inert data-testid="kartenvorschlag-honig">
            <input v-model="entwurf.honig" type="text" name="weitere-angaben" tabindex="-1" autocomplete="off" />
        </div>
    </form>
</template>

<style scoped src="../photobox/formular-stil.css"></style>
<style scoped>
/* Link und Datei liegen in EINER Zelle: die höhere bestimmt die Höhe, die andere ist unsichtbar und träge. */
.kf__stapel {
    display: grid;
}

.kf__lage {
    grid-area: 1 / 1;
}

.kf__weg {
    visibility: hidden;
}

/* Die Fläche des Links: dieselbe Größe wie die Ablage, aber kein Knopf, sondern ein Feld mit Zeichen, Titel und Hinweis. */
.kf__flaeche {
    display: grid;
    align-content: center;
    justify-items: stretch;
    gap: var(--space-4);
    box-sizing: border-box;
    padding: var(--space-12) var(--space-16);
    border: 2px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
    text-align: center;
    transition:
        border-color 140ms ease,
        box-shadow 140ms ease;
}

.kf__flaeche:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.kf__flaeche.is-fehlt {
    border-color: var(--color-warning);
    box-shadow: 0 0 0 var(--space-2) var(--color-warning-halo);
}

.kf__symbol {
    justify-self: center;
    width: var(--rb-ablage-symbol);
    height: var(--rb-ablage-symbol);
    object-fit: contain;
}

.kf__flaechen-titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    line-height: var(--leading-snug);
}

.kf__fund {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    min-height: calc(var(--font-size-small) * var(--leading-normal));
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.kf__fund svg {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
}

.kf__fund.is-gut {
    color: var(--color-success);
}

.kf__fund.is-schlecht {
    color: var(--color-warning-soft-text);
}

/* Ein PDF hat keine Vorschau im Browser: das gemalte Kartenzeichen mit dem Wort. */
.kf__pdf {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

.kf__pdf img {
    /* Gegen `.rb__rahmen img` der gemeinsamen Stile, das jedes Bild im Rahmen über die ganze Fläche legt. */
    position: static;
    inset: auto;
    width: var(--rb-ablage-symbol);
    height: var(--rb-ablage-symbol);
    object-fit: contain;
}

.kf__pdf-seite {
    padding-inline: var(--space-6);
    font-size: var(--font-size-small);
    text-align: center;
}

.kf__bedingungen {
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    animation: kf-ein 180ms ease;
}

@keyframes kf-ein {
    from {
        opacity: 0;
        transform: translateY(var(--space-2));
    }
}

/* „Mehr zur Karte“: ein ruhiges Aufklappen im Ton der Disclosure-Kästen. */
.kf__falte {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-disclosure-bg);
}

.kf__falte > summary {
    display: flex;
    align-items: center;
    align-content: center;
    box-sizing: border-box;
    min-height: var(--rb-feld);
    gap: var(--space-6);
    padding: var(--space-6) var(--space-10);
    border-radius: var(--radius-lg);
    color: var(--color-text-strong);
    cursor: pointer;
    font-size: var(--font-size-reading);
    list-style: none;
    transition: background-color 120ms ease;
}

.kf__falte > summary::-webkit-details-marker {
    display: none;
}

.kf__falte > summary:hover {
    background: var(--color-hover-wash);
}

.kf__falte > summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.kf__falte-pfeil {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-left: auto;
    color: var(--color-text-muted);
    transition: transform 140ms ease;
}

.kf__falte[open] .kf__falte-pfeil {
    transform: rotate(180deg);
}

.kf__falte-rumpf {
    display: grid;
    gap: var(--space-12);
    padding: var(--space-4) var(--space-10) var(--space-10);
}

.kf__klein {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.kf__typen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

/* Die Schalter haben die Höhe der Felder im Fenster (`--rb-feld`); am Telefon mindestens 44 px Trefferfläche. */
.kf__typen .rb__chip {
    padding: var(--space-4) var(--space-10);
    font-size: var(--font-size-body);
}

.kf__drei {
    display: grid;
    gap: var(--space-6);
}

.kf__tri-zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-8);
}

.kf__tri {
    display: inline-flex;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-lg);
    overflow: hidden;
}

.kf__tri label {
    position: relative;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    min-height: var(--rb-feld);
    padding: var(--space-2) var(--space-10);
    background: var(--color-panel);
    cursor: pointer;
    font-size: var(--font-size-body);
    transition: background-color 120ms ease;
}

.kf__tri label + label {
    border-left: 1px solid var(--color-button-soft-border);
}

.kf__tri label:hover {
    background: var(--color-hover-wash);
}

.kf__tri label:has(input:checked) {
    background: var(--color-button-soft-active);
    color: var(--color-text-strong);
}

.kf__tri label:has(input:focus-visible) {
    box-shadow: inset var(--focus-ring);
}

.kf__tri-wahl {
    position: absolute;
    opacity: 0;
    pointer-events: none;
}

.rb--telefon .kf__typen .rb__chip,
.rb--telefon .kf__tri label,
.rb--telefon .kf__falte > summary {
    min-height: calc(var(--avm-control-h) + var(--space-12));
}

@media (prefers-reduced-motion: reduce) {
    .kf__flaeche,
    .kf__falte > summary,
    .kf__tri label,
    .kf__falte-pfeil {
        transition: none;
    }

    .kf__bedingungen {
        animation: none;
    }
}
</style>
