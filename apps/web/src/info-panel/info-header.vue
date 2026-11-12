<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PHOTOBOX_EINREICHEN_SCHALTER, type SubjectRef } from "@avesmaps3d/shared";
import AvmBildansicht from "../controls/avm-bildansicht.vue";
import ReisebildKiZeichen from "../photobox/reisebild-ki-zeichen.vue";
import { reisebilder } from "../photobox/reisebilder-zustand";
import type { AnsichtBild } from "../controls/avm-bildansicht-modell";
import { t } from "../i18n/i18n";
import type { MessageKey } from "../i18n/de";
import { reisebilderStand } from "../medien/medien-oeffnen";
import { ausgeblendet } from "../system/inhaltsstand";
import { VIEWER_CONTEXT_KEY } from "../viewer/bootstrap-viewer";
import {
    ansichtBild,
    ansichtsbilder,
    kopfOhneKi,
    folgeMitEingaengen,
    istEingang,
    istFortsetzung,
    istOrtsansicht,
    istReisebild,
    plaketteFuer,
} from "./bildbezug";
import { ladeOrtEingaenge } from "./ort-eingaenge";
import { artgrafikVon, ladeTypbilder } from "./typbilder-quelle";
import InfoCanonPill from "./info-canon-pill.vue";
import InfoHiddenPill from "./info-hidden-pill.vue";
import InfoGefahrPill from "./info-gefahr-pill.vue";
import InfoLink from "./info-link.vue";
import InfoStageHead from "./info-stage-head.vue";
import { withTrailingPunctuation } from "./panel-text";
import type { ActionRun, HeaderImage, HeaderModel } from "./panel-types";

/**
 * Der Kopf des Panels (Design Guide §16.1, Legacy `infoHeaderImageMarkup`): oben IMMER ein 16:9-Bild - die eigenen Bilder des Objekts als Folge
 * mit Blätterpfeilen und Seitenmarken, sonst die Grafik der Art -, darunter links das Wappen (nie im Bildbereich) und rechts Name,
 * Untertitel und Kanon-Etikett.
 *
 * Eine Etappe setzt ihre Titelzeile anders (WI-0063 4.7, E13, 27.13): Titel und Untertitel mittig, die Pfeile ‹ › fest an den Rändern der
 * Untertitelzeile - das ist `info-stage-head.vue`; hier steht nur das Bild darüber. Ein Weg trägt unter der Wegart Legacys Markierungszeile
 * („Ganze Straße: Perz – Helmdahl“, das Wort fett).
 *
 * 🔴 Was auf einem Bild liegt, bekommt einen eigenen Grund oder einen Schatten (Guide §16.1): Die runden Pfeile tragen eine dunkle Scheibe,
 * die Seitenmarken einen Schlagschatten - ein Bild ist kein Panel, seine Helligkeit ist unbekannt. Die Marken sind liegende Striche
 * (15 × 6), die aktuelle weiß, die übrigen halbe Punkte.
 *
 * Ein Klick auf eine Ortsansicht öffnet die Bildansicht (`AvmBildansicht`, Betreiber 2026-10-11, Guide §13.46): groß, mit ‹ › durch die
 * Ortsansichten der Folge, Esc schließt; wo man dort blättert, steht danach auch der Kopf. Ein Typbild und die Grafik der Art öffnen
 * nichts: Sie veranschaulichen nur, sie zeigen nicht den Ort.
 *
 * 🔴 **Der Bildbezug** (Betreiber 2026-10-11, „1A … 2 B … 3 A ja das gilt für alle“, Guide §16.1, `bildbezug.ts`): Jedes sichtbare Bild
 * trägt unten rechts eine kleine Beschriftung, nie oben rechts (dort sitzt am Telefon das ✕ des Panels). „Ortsansicht“ oder
 * „Ortsansichten“ mit Bildsymbol auf einer Plakette, dazu ein leiser Zoom im Bildausschnitt beim Zeigen; „Typbild“ nur als Schrift, halb
 * durchsichtig mit Schatten - durchsichtig ist nur die Schrift, nie das Bild. Pfeile, Marken und ⚙ bleiben, wie sie waren; die
 * Beschriftung nimmt keinen Klick (ein Klick auf die Fläche öffnet die Bildansicht). Das Wappen und das Kanon-Etikett gehen sie nichts an.
 *
 * Solange die Antwort fehlt, steht nur der Platzhaltergrund da (`--color-divider`): Das Bild wechselte sonst mit der Antwort.
 *
 * 🔴 **Ein Bild, das nicht lädt, zeigt GAR NICHTS** - keinen leeren Rahmen, keinen Platzhalter, keine Beschriftung. Ein Asset ohne
 * Bytes kommt vor (`technical_state`), und dann ist die Adresse ein 404. Ein gescheitertes Kopfbild fällt aus der Folge (am Ende
 * bleibt die Grafik der Art), ein gescheitertes Wappen verschwindet samt seinem Platz.
 *
 * 🔴 **„Ohne KI“ gilt auch für Typbilder** (WI-0281, Betreiber 2026-11-05): Im Modus „Ohne KI“ steht an der Stelle der Grafik der Art nur die Ohne-KI-Variante der
 * Kategorie; fehlt sie, bleibt die Fläche grau (Vali: „wenn z.b. kein no-ki typbild existiert, no-ki aber an ist, dann is grau“): kein Bild, kein Zeichen, keine
 * Beschriftung, nie die KI-Variante und nie die eingebaute Grafik. Kopfbilder, Typbilder und die graue Fläche hängen am Zustand `reisebilder.ohneKi`: Wer umschaltet,
 * sieht es sofort, auch in einem schon offenen Panel.
 *
 * **Die Nennung eines Typbilds steht, wo „Typbild“ steht** (WI-0281, Vali 2026-11-05: „da nennen wo gerade "Typbild" steht“): „Typbild · Foto: Rahja, CC BY 4.0“
 * unten rechts im Bild, nicht als Zeile darunter. Ortsansichten und Reisebilder tragen ihre Nennung weiter unter dem Bild.
 *
 * 🔴 **Der Name blinkt nicht** (WI-0088 P1): `arriving` sagt, dass der Inhalt nach einer sichtbaren Wartezeit eintrifft - dann blenden
 * Bild, Wappen, Untertitel, Markierungszeile und die Pillen ein, denn die kommen mit der Antwort. Die Titelzeile selbst steht schon da
 * (die Karte kannte den Namen) und bleibt unverändert stehen. Der Platz des Bildes ist dabei immer schon reserviert: `__media` trägt
 * `aspect-ratio: 16 / 9` samt Platzhaltergrund, die Höhe des Kopfes hängt also nicht am Bild (gemessen WI-0088).
 */
const props = defineProps<{
    model: HeaderModel;
    arriving?: boolean;
    /** Die Karte steht in der Standardansicht (WI-0272 §12 Frage 6): nur dann steht „+ Eigenes Bild hinzufügen“ im Kopf eines Ortes. */
    standard?: boolean;
}>();
const emit = defineEmits<{ open: [ref: SubjectRef]; run: [run: ActionRun] }>();
/** Zeigt der verborgene Klick gerade den zweiten Text (`TextPart.wechsel`, WI-0273: x/y statt der Grade)? */
const gewechselt = ref(false);

/**
 * Der Kontext-Einstieg in die Medienverwaltung (WI-0068 §13, P3; Mockup B): Im Editor-Modus mit `view_media_private` tragen Wappen und
 * Kopfbild einen kleinen Knopf mit abstraktem Zeichen ⚙ (AGENTS „Knöpfe, die ausschließlich Backend-Nutzern dienen, tragen abstrakte
 * Zeichen“). Er öffnet genau dieses Asset; beim Kopfbild das gerade gezeigte Bild der Folge. Er steht immer da, nicht erst beim Zeigen:
 * Hover ist nie die einzige Aktion (§3.4), und am Finger gibt es keins.
 */
const medien = inject(VIEWER_CONTEXT_KEY, undefined)?.can("view_media_private") ?? false;

/** Das ⚙ am Wappen: genau dieses Asset in der Medienverwaltung (das ⚙ am Kopfbild rechnet `zahnrad`). */
function zuDenMedien(asset: string): void {
    emit("run", { type: "openMedia", asset, name: props.model.title });
}

/**
 * Die offenen Eingänge dieses Ortes (WI-0272 S5): nur für Editoren mit `view_media_private`, aus der eigenen geschützten Route (`ort-eingaenge.ts`), nie aus der öffentlichen Antwort. Ein jüngerer Ort bricht
 * die Frage des älteren ab; nach jeder Operation der Redaktion an einer Reisebild-Einreichung (`reisebilderStand`) fragt der Kopf neu, damit kein entschiedener Eingang stehen bleibt.
 */
const eingaenge = ref<HeaderImage[]>([]);
let eingangLauf: AbortController | undefined;
let eingaengeFuer: string | undefined;
function ladeEingaenge(): void {
    eingangLauf?.abort();
    const ortId = medien ? props.model.ort?.id : undefined;
    if (ortId !== eingaengeFuer) {
        eingaenge.value = [];
        eingaengeFuer = ortId;
    }
    if (ortId === undefined) return;
    const lauf = new AbortController();
    eingangLauf = lauf;
    void ladeOrtEingaenge(ortId, undefined, lauf.signal).then((liste) => {
        if (!lauf.signal.aborted) eingaenge.value = liste;
    });
}
watch(() => [props.model.ort?.id, reisebilderStand.value], ladeEingaenge, { immediate: true });
onBeforeUnmount(() => eingangLauf?.abort());

const index = ref(0);
/** Die Stelle in der Bildansicht; `null`: zu. */
const ansicht = ref<number | null>(null);
/** Die Adressen, die der Browser nicht laden konnte. Sie gehören zum Subject und werden mit ihm vergessen. */
const broken = ref<string[]>([]);
// Ein anderes Subject beginnt wieder beim ersten Bild und vergisst, was vorher nicht lud. Kam nur ein Bild hinten dazu (ein neu freigegebenes Reisebild, leise), bleibt das gezeigte stehen.
watch(
    () => [props.model.coat?.url ?? "", ...props.model.images.map((image) => image.id)].join(","),
    (neu, alt) => {
        if (istFortsetzung(alt, neu)) return;
        index.value = 0;
        ansicht.value = null;
        broken.value = [];
    },
);

/**
 * Die Folge: die Bilder des Objekts; für Editoren dahinter die offenen Eingänge des Ortes. Hat der Ort kein eigenes Bild, führt die Grafik der Art, Reisebilder und Eingänge reihen sich dahinter
 * (`folgeMitEingaengen`, Vali 2026-11-09). Ein Bild, das nicht lädt, fällt heraus.
 */
const kopfbilder = computed(() =>
    reisebilder.ohneKi.value ? kopfOhneKi(props.model.images, props.model.typbilder ?? []) : props.model.images,
);
const folge = computed(() => folgeMitEingaengen(kopfbilder.value, eingaenge.value, grafikBild.value));
const images = computed(() => folge.value.filter((image) => !broken.value.includes(image.url)));
/** Die Stelle in der Folge, nachdem ein gescheitertes Bild herausgefallen ist. */
const imageAt = computed(() => (images.value.length === 0 ? 0 : Math.min(index.value, images.value.length - 1)));
const current = computed(() => images.value[imageAt.value]);
const several = computed(() => images.value.length > 1);
const coat = computed(() =>
    props.model.coat !== undefined && !broken.value.includes(props.model.coat.url) ? props.model.coat : undefined,
);

/**
 * Die Grafik der Art: das redaktionell gewählte und freigegebene Typbild (WI-0068, Betreiber 2026-10-11), sonst die eingebaute Datei
 * des Releases. 🔴 Die Beschriftung bleibt dabei „Typbild“ — hier wechselt nur die Datei, nicht die Bedeutung (Entscheid „3 A ja das
 * gilt für alle“). Im Modus „Ohne KI“ nur die Ohne-KI-Variante, sonst der Platzhalter (WI-0281, `artgrafikVon`).
 */
const artgrafik = computed(() =>
    props.model.graphic === undefined ? undefined : artgrafikVon(props.model.graphic, reisebilder.ohneKi.value),
);
/** Das Bild der Grafik der Art, wenn eines dasteht (nicht beim Platzhalter und nicht, solange die Karte für „Ohne KI“ lädt). */
const artbild = computed(() => (artgrafik.value?.art === "bild" ? artgrafik.value.bild : undefined));
/** Die Grafik der Art als Glied der Folge: vorn, wenn Reisebilder oder Eingänge dahinter stehen. Der Platzhalter ist kein Glied. */
const grafikBild = computed<HeaderImage | undefined>(() => {
    const grafik = artbild.value;
    if (props.model.graphic === undefined || grafik === undefined) return undefined;
    return {
        id: `grafik:${props.model.graphic}`,
        url: grafik.url,
        width: grafik.width,
        height: grafik.height,
        ...(grafik.credit === undefined ? {} : { credit: grafik.credit }),
        relation: "type_image",
        grafik: true,
    };
});
/** Steht die graue Fläche da (nur „Ohne KI“, kein eigenes Bild und keine Ohne-KI-Variante der Kategorie)? */
const platzhalter = computed(() => current.value === undefined && artgrafik.value?.art === "platzhalter");
/** Die Nennung des gezeigten Bildes, sonst die der Grafik der Art (ein Ohne-KI-Typbild unter CC BY). */
const nennung = computed(() => (current.value === undefined ? artbild.value?.credit : current.value.credit));
// Einmal je Seitenaufruf; solange nichts da ist, steht die eingebaute Grafik, also gibt es keinen Zustand ohne Bild.
onMounted(() => void ladeTypbilder());

/** Was groß angesehen werden kann: die Ortsansichten und Reisebilder der Folge, in ihrer Reihenfolge. */
const ansichtsfolge = computed(() => ansichtsbilder(images.value));
/** Öffnet ein Klick auf das gezeigte Bild die Bildansicht? Bei einer Ortsansicht und einem Reisebild. */
const klickbar = computed(() => istOrtsansicht(current.value) || istReisebild(current.value));
/** Ein offener Eingang steht gerade da (nur Editoren): gestrichelt. */
const alsEingang = computed(() => istEingang(current.value));
/** Die Beschriftung des sichtbaren Bildes; keine, solange nur der Platzhaltergrund oder die graue Fläche von „Ohne KI“ steht. */
const plakette = computed(() =>
    current.value !== undefined || artbild.value !== undefined ? plaketteFuer(current.value, images.value) : undefined,
);
/** Ein Typbild trägt seine Nennung in der Beschriftung („Typbild · …“); alles andere darunter. */
const nennungImBild = computed(() => (plakette.value?.bezug === "typbild" ? nennung.value : undefined));
const nennungDarunter = computed(() => (plakette.value?.bezug === "typbild" ? undefined : nennung.value));
/** Der Text der Beschriftung. */
const plaketteText = computed(() => {
    const p = plakette.value;
    if (p === undefined) return "";
    if (nennungImBild.value !== undefined) {
        return t("infoPanel.header.bildbezug.typbildNennung", { nennung: nennungImBild.value });
    }
    return p.name === undefined ? t(p.text) : t(p.text, { name: p.name });
});

/**
 * Die Folge in der Bildansicht: die Ortsansichten und Reisebilder des Kopfes. Eine Ortsansicht trägt den Namen des Objekts und die Nennung, wo sie verlangt ist; ein Reisebild seine Bildbeschreibung und
 * „Bild von …“ wie auf der Karte (`ansichtBild`, eine Bildansicht für alle).
 */
const ansichtBilder = computed<AnsichtBild[]>(() =>
    ansichtsfolge.value.map((image) => ansichtBild(image, props.model.title)),
);
// Wo man in der Bildansicht blättert, steht danach auch der Kopf.
watch(ansicht, (stelle) => {
    if (stelle === null) return;
    const bild = ansichtsfolge.value[stelle];
    const position = images.value.findIndex((image) => image.id === bild?.id);
    if (position >= 0) index.value = position;
});

/**
 * Das ⚙ links oben (nur Editoren mit Recht, in jeder Kartenansicht): am Reisebild zu dessen Medienobjekt, am Eingang zu dessen Prüfung, am Kopfbild einer anderen Herkunft wie bisher zu diesem Asset, und auf der
 * Grafik der Art, an jedem Objekt, zum Typbild dieser Kategorie (Vali: „bei wappen kann ich mit dem bearbeiten-zahnrad direkt in die MAM. das geht bei typbildern und photobox bildern noch nicht“). Nur wo es gar
 * kein Bild gibt (ein Ort ohne Grafik der Art), führt es zum Korb „PhotoBox-Uploads“, dem nächsten vorhandenen Einstieg (WI-0272 S5).
 */
const zahnrad = computed<{ label: MessageKey; run: ActionRun } | undefined>(() => {
    if (!medien) return undefined;
    const bild = current.value;
    if (bild !== undefined && istEingang(bild)) {
        return {
            label: "infoPanel.media.eingang",
            run: { type: "openReisebilder", asset: bild.id, einreichung: "offen" },
        };
    }
    if (bild !== undefined && istReisebild(bild)) {
        return {
            label: "infoPanel.media.header",
            run: { type: "openReisebilder", asset: bild.id, einreichung: "erledigt" },
        };
    }
    if (bild !== undefined && bild.grafik !== true) {
        return { label: "infoPanel.media.header", run: { type: "openMedia", asset: bild.id, name: props.model.title } };
    }
    if (props.model.graphic !== undefined) {
        // Im Modus „Ohne KI“ zur Ohne-KI-Variante der Kategorie (WI-0281): Dort fehlt sie, wenn der Platzhalter steht.
        return {
            label: "infoPanel.media.typbild",
            run: {
                type: "openTypbild",
                kategorie: props.model.graphic,
                ...(reisebilder.ohneKi.value ? { variante: "ohne_ki" as const } : {}),
            },
        };
    }
    return props.model.ort === undefined
        ? undefined
        : { label: "infoPanel.media.photobox", run: { type: "openReisebilder" } };
});

/**
 * „+“ links oben, nur an einem Ort, nur in der Standardansicht (WI §12 Frage 6) und nur, solange Einreichungen angenommen werden (Schalter `photobox.submissions`). Beim Zeigen geht es auf zu „+ Eigenes Bild hinzufügen“
 * (dasselbe Wort wie der Titel des Fensters, §12 Frage 3); der Klick öffnet das Einreichungsfenster mit dem Ort als Bezug und seiner Lage als Stelle.
 */
const beitrag = computed(() =>
    props.standard === true && props.model.ort !== undefined && !ausgeblendet(PHOTOBOX_EINREICHEN_SCHALTER)
        ? props.model.ort
        : undefined,
);

/** Die Bildansicht beim gezeigten Bild öffnen. */
function oeffnen(): void {
    const stelle = ansichtsfolge.value.findIndex((image) => image.id === current.value?.id);
    if (stelle >= 0) ansicht.value = stelle;
}

function step(by: 1 | -1): void {
    const count = images.value.length;
    if (count > 1) index.value = (imageAt.value + by + count) % count;
}

/** Diese Adresse lädt nicht: das Bild wird nicht gezeigt, und niemand erfährt, dass es eines gäbe. */
function broke(url: string | undefined): void {
    if (url !== undefined && !broken.value.includes(url)) broken.value = [...broken.value, url];
}
</script>

<template>
    <!-- 🔴 Ein ATTRIBUT, keine Klasse `is-arriving`: Die trüge `info-content.vue` sonst an den Kopf selbst, und dann blendete die
         Titelzeile mit ein - genau das Blinken des Namens, das hier verboten ist (gemessen WI-0088). -->
    <header class="info-header" :data-arriving="arriving === true ? '' : undefined" data-testid="info-header">
        <div
            class="info-header__media"
            :class="{ 'is-ortsansicht': klickbar, 'is-eingang': alsEingang, 'has-zahnrad': zahnrad !== undefined }"
            data-testid="info-media"
        >
            <img
                v-if="current !== undefined"
                class="info-header__img"
                :src="current.url"
                :width="current.width"
                :height="current.height"
                :data-graphic="current.grafik === true ? model.graphic : undefined"
                alt=""
                decoding="async"
                data-testid="info-header-image"
                @error="broke(current?.url)"
            />
            <img
                v-else-if="artbild !== undefined"
                class="info-header__img"
                :src="artbild.url"
                :data-graphic="model.graphic"
                :width="artbild.width"
                :height="artbild.height"
                alt=""
                decoding="async"
                data-testid="info-header-image"
            />
            <!-- „Ohne KI“ ohne geeignetes Typbild (WI-0281): grau, ohne Bild, Zeichen und Beschriftung; nie die KI-Variante. -->
            <div
                v-else-if="platzhalter"
                class="info-header__platzhalter"
                :data-graphic="model.graphic"
                data-testid="info-header-platzhalter"
            ></div>
            <button
                v-if="klickbar"
                type="button"
                class="info-header__gross"
                :aria-label="t('bildansicht.oeffnen')"
                data-testid="info-header-gross"
                @click="oeffnen"
            ></button>
            <!-- Der Bildbezug: unten rechts, nimmt keinen Klick; das Symbol ist Schmuck, der Text sagt alles. -->
            <span
                v-if="plakette !== undefined"
                class="info-header__bildbezug"
                :class="[`is-${plakette.bezug}`, { 'has-nennung': nennungImBild !== undefined, 'is-schmal': several }]"
                :data-bezug="plakette.bezug"
                data-testid="info-header-bildbezug"
            >
                <svg
                    v-if="plakette.bezug !== 'typbild'"
                    class="info-header__bildbezug-zeichen"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    focusable="false"
                    data-testid="info-header-bildbezug-zeichen"
                >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="8" cy="9" r="2" />
                    <path d="m4 17 5-5 4 3 3-3 4 5" />
                </svg>
                <span
                    class="info-header__bildbezug-text avm-versalmitte"
                    :class="{ einzeilig: nennungImBild === undefined }"
                    data-testid="info-header-bildbezug-text"
                    >{{ plaketteText }}</span
                >
            </span>
            <button
                v-if="zahnrad !== undefined"
                type="button"
                class="info-header__medien info-header__medien--bild"
                :aria-label="t(zahnrad.label)"
                :title="t(zahnrad.label)"
                data-testid="info-medien-kopfbild"
                @click="emit('run', zahnrad.run)"
            >
                ⚙
            </button>
            <!-- „+“ links oben, beim Zeigen „+ Eigenes Bild hinzufügen“; mit dem ⚙ daneben (WI-0272 S5). Rechts oben sitzt am Telefon das ✕ des Panels, unten rechts der Bildbezug. -->
            <button
                v-if="beitrag !== undefined"
                type="button"
                class="info-header__beitrag"
                :aria-label="t('photobox.titel')"
                data-testid="info-beitrag"
                @click="emit('run', { type: 'reisebildHinzufuegen', ort: beitrag })"
            >
                <span class="info-header__beitrag-plus" aria-hidden="true"
                    ><svg class="info-header__zeichen" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M8 3v10M3 8h10" /></svg
                ></span>
                <span class="info-header__beitrag-text" aria-hidden="true">{{ t("photobox.titel") }}</span>
            </button>
            <template v-if="several">
                <button
                    type="button"
                    class="info-header__nav info-header__nav--prev"
                    :aria-label="t('infoPanel.header.prev')"
                    data-testid="info-header-prev"
                    @click="step(-1)"
                >
                    <svg class="info-header__zeichen" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M10.5 3 5.5 8l5 5" />
                    </svg>
                </button>
                <button
                    type="button"
                    class="info-header__nav info-header__nav--next"
                    :aria-label="t('infoPanel.header.next')"
                    data-testid="info-header-next"
                    @click="step(1)"
                >
                    <svg class="info-header__zeichen" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M5.5 3l5 5-5 5" />
                    </svg>
                </button>
                <div
                    class="info-header__marks"
                    role="img"
                    :aria-label="t('infoPanel.header.image', { n: imageAt + 1, m: images.length })"
                >
                    <span
                        v-for="(image, position) in images"
                        :key="image.id"
                        class="info-header__mark"
                        :class="{ 'is-on': position === imageAt }"
                        data-testid="info-header-mark"
                    ></span>
                </div>
            </template>
        </div>
        <AvmBildansicht v-model="ansicht" :bilder="ansichtBilder" testid="info-bildansicht">
            <template #nennung-zusatz="{ bild }">
                <template v-if="bild.ki"> · <ReisebildKiZeichen mit-text /></template>
            </template>
        </AvmBildansicht>
        <p v-if="nennungDarunter !== undefined" class="info-header__credit" data-testid="info-header-credit">
            {{ nennungDarunter }}
        </p>
        <!-- Zwischen Bild und Titel: der Rückweg einer Infobox zum Sammelscreen „‹ Ausgewählte Vorkommen (N)“ (WI-0257 S5, `info-eintrag.vue`). -->
        <slot name="vor-titel" />
        <!-- Eine Etappe setzt Titel und Untertitel mittig, die Pfeile fest an die Ränder (27.13): eigener Baustein. -->
        <InfoStageHead
            v-if="model.stageNav !== undefined"
            :model="model"
            :nav="model.stageNav"
            @open="emit('open', $event)"
            @run="emit('run', $event)"
        />
        <div v-else class="info-header__caption">
            <!-- Das Zeichen der Art eines Vorkommens (WI-0260, `info-eintrag.vue`) steht links vom Titel, wo sonst das Wappen steht; sonst bleibt der Platz leer. -->
            <slot name="zeichen" />
            <!-- Das Wappen ist Schmuck neben dem Namen: kein Alternativtext, und fehlt die Datei, steht hier nichts. -->
            <span v-if="coat !== undefined" class="info-header__wappen">
                <img
                    class="info-header__coat"
                    :src="coat.url"
                    :width="coat.width"
                    :height="coat.height"
                    alt=""
                    data-testid="info-coat"
                    @error="broke(coat?.url)"
                />
                <button
                    v-if="medien"
                    type="button"
                    class="info-header__medien info-header__medien--wappen"
                    :aria-label="t('infoPanel.media.coat')"
                    :title="t('infoPanel.media.coat')"
                    data-testid="info-medien-wappen"
                    @click="zuDenMedien(coat.id)"
                >
                    ⚙
                </button>
            </span>
            <div class="info-header__titles">
                <h2 class="info-header__title" data-testid="info-title">{{ model.title }}</h2>
                <p v-if="model.subtitle.length > 0" class="info-header__subtitle" data-testid="info-subtitle">
                    <template v-for="(item, position) in model.subtitle" :key="position">
                        <template v-if="position > 0"> · </template>
                        <template v-for="(part, at) in withTrailingPunctuation(item.parts)" :key="at">
                            <InfoLink v-if="part.ref !== undefined" :tail="part.tail" @open="emit('open', part.ref)">{{
                                part.text
                            }}</InfoLink>
                            <!-- Der verborgene Klick (WI-0273): Grade ↔ x/y eines Kartenpunkts, ohne Hinweis. -->
                            <button
                                v-else-if="part.wechsel !== undefined"
                                type="button"
                                class="info-header__wechsel"
                                data-testid="info-subtitle-wechsel"
                                @click="gewechselt = !gewechselt"
                            >
                                {{ gewechselt ? part.wechsel : part.text }}
                            </button>
                            <template v-else>{{ part.text }}</template>
                        </template>
                    </template>
                </p>
                <p v-if="model.note !== undefined" class="info-header__note" data-testid="info-note">
                    <span class="info-header__note-label">{{ model.note.label }}</span> {{ model.note.text }}
                </p>
                <!-- Die Pillen des Kopfes in EINER Zeile: Kanon, danach „Verborgen“ (WI-0080 Nachtrag, Betreiber 2026-10-05) und „Gefahrengebiet“ (WI-0308). -->
                <div
                    v-if="model.canon !== undefined || model.hidden === true || model.gefahr !== undefined"
                    class="info-header__canon"
                >
                    <InfoCanonPill v-if="model.canon !== undefined" class="info-header__pill" :pill="model.canon" />
                    <InfoHiddenPill v-if="model.hidden === true" />
                    <InfoGefahrPill v-if="model.gefahr !== undefined" />
                </div>
                <!-- Die Arten der Gefahrenlage unter den Pillen (WI-0308), in der Gefahrfarbe. -->
                <p v-if="model.gefahr !== undefined" class="info-header__gefahr" data-testid="info-gefahr-arten">
                    {{ t("gefahr.arten", { arten: model.gefahr.arten }) }}
                </p>
                <!-- Unter den Pillen, in der Spalte des Namens (also eingerückt neben dem Wappen): die Bewertungszeile eines Orts (WI-0269, `info-bewertungszeile.vue`). -->
                <slot name="nach-pillen" />
            </div>
        </div>
    </header>
</template>

<style scoped>
.info-header {
    display: block;
}

/* 🔴 Eingeblendet wird, was mit der Antwort NEU dazukommt - nie der Kopf als Ganzes und nie die Titelzeile (WI-0088 P1, Guide §30.8). */
.info-header[data-arriving] .info-header__img,
.info-header[data-arriving] .info-header__bildbezug,
.info-header[data-arriving] .info-header__credit,
.info-header[data-arriving] .info-header__coat,
.info-header[data-arriving] .info-header__subtitle,
.info-header[data-arriving] .info-header__note,
.info-header[data-arriving] .info-header__canon,
.info-header[data-arriving] .info-header__gefahr {
    animation: info-header-arrive 140ms ease;
}

@keyframes info-header-arrive {
    from {
        opacity: 0;
    }
}

/* 16:9, bis an die Kanten: Das Bild ist der Kopf, nichts liegt darauf außer den Pfeilen, den Marken und dem Bildbezug. */
.info-header__media {
    /* Der Durchmesser der zwei runden Knöpfe links oben, ⚙ und „+“ (Vali 31.10.: „das zahnrad kann gern denselben durchmesser haben wie das +-symbol“): einer, in beiden benutzt. */
    --info-header-knopf: var(--avesmaps-infopanel-nav);
    position: relative;
    isolation: isolate;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: var(--color-divider);
}

/* Bei einer Ortsansicht ist das ganze Bild der Knopf zur Bildansicht; Pfeile, Marken, Bildbezug und ⚙ liegen darüber (z-index 1). */
.info-header__gross {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: zoom-in;
}

.info-header__gross:focus-visible {
    outline: none;
    box-shadow: inset var(--focus-ring);
}

.info-header__img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 150ms ease;
}

/*
 * Die graue Fläche von „Ohne KI“ (WI-0281, Vali: „dann is grau“): der Platzhaltergrund des Kopfes, sonst nichts. Kein Bild, kein Zeichen, keine Beschriftung, kein
 * Klick; ⚙ und „+“ liegen wie sonst darüber.
 */
.info-header__platzhalter {
    position: absolute;
    inset: 0;
    background: var(--color-divider);
}

/*
 * Eine Ortsansicht rückt beim Zeigen ganz leise heran (Betreiber 2026-10-11: rund 2,5 % in „ca. 180 ms“), IM Bildausschnitt: Die Fläche schneidet
 * ab (`overflow: hidden`), ihre Maße bleiben. Nur mit echtem Zeiger - am Finger gibt es kein Zeigen, und ein Antippen soll nichts
 * zoomen. Ein Typbild und die Grafik der Art bleiben ruhig. 🪤 Die Dauer ist 150 ms, die nächste der drei Zeiten des Hauses (Guide §30.4,
 * `info-panel-huelle.test.ts`: 120, 150, 220 ms); „ca. 180 ms“ des Betreibers liegt dazwischen.
 */
@media (hover: hover) and (pointer: fine) {
    .info-header__media.is-ortsansicht:hover .info-header__img {
        transform: scale(1.025);
    }
}

/*
 * Der Bildbezug (Betreiber 2026-10-11, Mockup `project-control/mockups/bildbezug-2026-10-11.html`): unten rechts, über dem Bild und unter
 * nichts Bedienbarem - die Pfeile sitzen mittig an den Rändern, die Marken unten mittig. Die Ortsansicht als kleine Plakette auf der
 * dunklen Scheibe der Pfeile (`media*`, Guide §16.1: was auf einem Bild liegt, bekommt einen eigenen Grund), Rand halb weiß.
 */
.info-header__bildbezug {
    position: absolute;
    right: var(--space-8);
    bottom: var(--space-8);
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-media-mark-muted);
    border-radius: var(--radius-sm);
    background: var(--color-media-nav);
    color: var(--color-media-text);
    font-size: var(--font-size-caption);
    line-height: 1;
    white-space: nowrap;
    text-shadow: var(--shadow-media-mark);
    pointer-events: none;
    /* Ein langer Name der Nennung kürzt (`.einzeilig`), die Plakette bleibt im Bild. */
    max-width: calc(100% - 2 * var(--space-8));
}

.info-header__bildbezug-text {
    min-width: 0;
}

/* Ein offener Eingang (nur Editoren): gestrichelt in der Farbe der Auswahl, auf der Plakette wie als Rahmen im Bild. */
.info-header__bildbezug.is-eingang {
    border: 1px dashed var(--color-map-selection);
}

.info-header__media.is-eingang::after {
    content: "";
    position: absolute;
    inset: var(--space-4);
    z-index: 1;
    border: 2px dashed var(--color-map-selection);
    border-radius: var(--radius-sm);
    pointer-events: none;
}

.info-header__bildbezug-zeichen {
    flex: 0 0 auto;
    width: calc(var(--font-size-caption) + var(--space-2) / 2);
    height: calc(var(--font-size-caption) + var(--space-2) / 2);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
}

/* Das Typbild: nur die Schrift, ohne Rahmen und Grund, halb durchsichtig (nur sie, nie das Bild) mit wahrnehmbarem Schatten. */
.info-header__bildbezug.is-typbild {
    right: var(--space-12);
    bottom: var(--space-12);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-media-mark-muted);
    text-shadow: var(--shadow-media-label);
}

/*
 * Ein Typbild mit Nennung (WI-0281: „Typbild · Foto: …“): Die Nennung ist Pflicht der Lizenz und wird nicht gekürzt; sie bricht rechtsbündig nach oben um. Stehen
 * die Seitenmarken unten mittig, bleibt sie in der rechten Hälfte neben ihnen.
 */
.info-header__bildbezug.is-typbild.has-nennung {
    max-width: calc(100% - 2 * var(--space-12));
    line-height: 1.25;
    text-align: right;
    white-space: normal;
}

.info-header__bildbezug.is-typbild.has-nennung.is-schmal {
    max-width: calc(50% - 3 * var(--space-12));
}

.info-header__nav {
    position: absolute;
    top: 50%;
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--avesmaps-infopanel-nav);
    height: var(--avesmaps-infopanel-nav);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-media-nav);
    color: var(--color-media-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-title);
    line-height: 1;
    transform: translateY(-50%);
    transition: background-color 120ms ease;
}

/* Die Zeichen sind gezeichnet, nicht gesetzt: Ein „+“ oder „‹“ der Schrift sitzt nie in der Mitte des Kreises (Vali 2026-11-02: „vertikal nicht richtig zentriert“). */
.info-header__zeichen {
    display: block;
    width: var(--font-size-title);
    height: var(--font-size-title);
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
}

.info-header__nav--prev {
    left: var(--space-6);
}

.info-header__nav--next {
    right: var(--space-6);
}

.info-header__nav:hover,
.info-header__nav:active {
    background: var(--color-media-nav-hover);
}

.info-header__nav:focus-visible {
    outline: none;
    background: var(--color-media-nav-hover);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-header__marks {
    position: absolute;
    right: 0;
    bottom: var(--space-2);
    left: 0;
    z-index: 1;
    display: flex;
    justify-content: center;
    gap: var(--space-2);
    pointer-events: none;
}

.info-header__mark {
    width: var(--avesmaps-infopanel-mark-h);
    height: var(--avesmaps-infopanel-mark-h);
    border-radius: calc(var(--avesmaps-infopanel-mark-h) / 2);
    background: var(--color-media-mark-muted);
    box-shadow: var(--shadow-media-mark);
    transition:
        width 150ms ease,
        background-color 150ms ease;
}

/* Der aktuelle Strich: 15 × 6, weiß; die übrigen sind halbe Punkte. */
.info-header__mark.is-on {
    width: var(--avesmaps-infopanel-mark-w);
    background: var(--color-media-text);
}

.info-header__credit {
    margin: 0;
    padding: var(--space-2) var(--info-pad-x) 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

/* Titelzeile unter dem Bild: Wappen links (kein Abstand - die Wappengrafiken bringen ihren Rand mit), Name und Untertitel rechts. */
.info-header__caption {
    display: flex;
    align-items: center;
    padding: var(--space-8) var(--info-pad-x) var(--space-10);
}

/* Die Hülle des Wappens trägt nur den Knopf der Medienverwaltung; sie ist genau so groß wie das Bild. */
.info-header__wappen {
    position: relative;
    flex: 0 0 auto;
    display: block;
    line-height: 0;
}

.info-header__coat {
    flex: 0 0 auto;
    display: block;
    width: var(--icon-hero);
    height: var(--icon-hero);
    object-fit: contain;
}

/*
 * Der Knopf der Medienverwaltung (WI-0068 P3): ein abstraktes Zeichen auf einer dunklen Scheibe, denn was auf einem Bild liegt, bekommt
 * einen eigenen Grund (Guide §16.1) - dieselbe Scheibe wie die Blätterpfeile, kleiner.
 */
.info-header__medien {
    position: absolute;
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--icon-lg);
    height: var(--icon-lg);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-media-nav);
    color: var(--color-media-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: 1;
    transition: background-color 120ms ease;
}

.info-header__medien--bild {
    top: var(--space-6);
    left: var(--space-6);
    width: var(--info-header-knopf);
    height: var(--info-header-knopf);
    font-size: var(--font-size-subhead);
}

/*
 * „+“ links oben (WI-0272 S5): rund wie das ⚙, im Ruhezustand nur das Zeichen; beim Zeigen mit echtem Zeiger geht es zu „+ Eigenes Bild hinzufügen“ auf (Vali 31.10.). Am Finger gibt es kein Zeigen: dort
 * bleibt es das runde „+“, und es reicht nie an das ✕ rechts oben heran. Mit dem ⚙ daneben rückt es rechts davon (wie die Probierseite 7.1).
 */
.info-header__beitrag {
    position: absolute;
    top: var(--space-6);
    left: var(--space-6);
    z-index: 1;
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    height: var(--info-header-knopf);
    min-width: var(--info-header-knopf);
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: calc(var(--info-header-knopf) / 2);
    background: var(--color-media-nav);
    color: var(--color-media-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: 1;
    white-space: nowrap;
    transition: background-color 120ms ease;
}

.info-header__media.has-zahnrad .info-header__beitrag {
    left: calc(var(--space-6) + var(--info-header-knopf) + var(--space-4));
}

.info-header__beitrag-plus {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: var(--info-header-knopf);
    height: var(--info-header-knopf);
    font-size: var(--font-size-title);
    line-height: 1;
}

.info-header__beitrag-text {
    max-width: 0;
    overflow: hidden;
    transition:
        max-width 150ms ease,
        padding 150ms ease;
}

.info-header__beitrag:hover,
.info-header__beitrag:active {
    background: var(--color-media-nav-hover);
}

.info-header__beitrag:focus-visible {
    outline: none;
    background: var(--color-media-nav-hover);
    box-shadow: var(--focus-ring);
}

@media (hover: hover) and (pointer: fine) {
    .info-header__beitrag:hover .info-header__beitrag-text,
    .info-header__beitrag:focus-visible .info-header__beitrag-text {
        max-width: 20em;
        padding-right: var(--space-8);
    }
}

.info-header__medien--wappen {
    right: 0;
    bottom: 0;
}

.info-header__medien:hover,
.info-header__medien:active {
    background: var(--color-media-nav-hover);
}

.info-header__medien:focus-visible {
    outline: none;
    background: var(--color-media-nav-hover);
    box-shadow: var(--focus-ring);
}

.info-header__titles {
    min-width: 0;
}

/* Name 20 px (Guide §16.1); Betonung über die Farbe, nicht das Gewicht. */
.info-header__title {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-tight);
}

/* Der verborgene Klick sieht aus wie der Text um ihn herum: kein Zeigerwechsel, keine Wäsche; nur die Tastatur sieht den Ring. */
.info-header__wechsel {
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: inherit;
    cursor: inherit;
}

.info-header__wechsel:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-header__subtitle {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/* Legacy `info-header__markierung`: eine Zeile unter der Wegart, das Wort betont - in dieser Hausschrift über die Farbe, nicht das Gewicht. */
.info-header__note {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.info-header__note-label {
    color: var(--color-text-strong);
}

.info-header__canon {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-top: var(--space-6);
}

/* Die Arten der Gefahrenlage (WI-0308): eine kleine Zeile in der Gefahrfarbe unter den Pillen. */
.info-header__gefahr {
    margin: var(--space-2) 0 0;
    color: var(--color-danger);
    font-size: var(--font-size-small);
}

/* 🪤 Beide Pillen bleiben in einer Zeile, auch bei 360 px und langem Bezeichner: Die Kanon-Pille darf schrumpfen, und ihr rechtes Feld
   endet dann an der Kontur des Etiketts (so wie allein). Ohne das stünde die Pille „Verborgen“ außerhalb des Panels. */
.info-header__pill {
    flex-shrink: 1;
    min-width: 0;
}

@media (prefers-reduced-motion: reduce) {
    .info-header__nav,
    .info-header__medien,
    .info-header__beitrag,
    .info-header__beitrag-text,
    .info-header__mark,
    .info-header__img {
        transition: none;
    }

    /* Kein Heranrücken der Ortsansicht (Guide §30.6). */
    .info-header__media.is-ortsansicht:hover .info-header__img {
        transform: none;
    }

    /* Kein Übergang, nur der fertige Inhalt (Guide §30.6, WI-0088 A8). */
    .info-header[data-arriving] .info-header__img,
    .info-header[data-arriving] .info-header__bildbezug,
    .info-header[data-arriving] .info-header__credit,
    .info-header[data-arriving] .info-header__coat,
    .info-header[data-arriving] .info-header__subtitle,
    .info-header[data-arriving] .info-header__note,
    .info-header[data-arriving] .info-header__canon,
    .info-header[data-arriving] .info-header__gefahr {
        animation: none;
    }
}
</style>
