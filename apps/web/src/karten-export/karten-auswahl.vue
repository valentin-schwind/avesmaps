<script setup lang="ts">
/**
 * Der Reiter „Karten“ (WI-0280): links anhaken, rechts steht, was im ZIP liegt, und wie es weitergeht. Eine Zeile ohne Datei auf diesem Server lässt sich nicht anhaken und sagt
 * warum: Ein ZIP ohne die bestellte Karte gibt es nicht.
 */
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from "vue";
import {
    KARTEN_FRIST_VORGABE,
    KARTEN_FRISTEN,
    KARTEN_FUER_WEN_LAENGE,
    KARTEN_SVG_EBENEN,
    type KartenEintrag,
    type KartenExportStand,
    type KartenSvgEinstellungen,
    type KartenZugangArt,
    type KartenZugangNeu,
} from "@avesmaps3d/shared";
import {
    datumText,
    groesseText,
    kartenName,
    kartenText,
    speichere,
    vorschauVon,
    zeitText,
    zipAdresse,
    type KartenExportSicht,
} from "./karten-export";
import { ApiFailure } from "../auth/api";
import { formProblems } from "../auth/formular";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKopierfeld from "../controls/avm-kopierfeld.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";

const props = defineProps<{ sicht: KartenExportSicht; stand: KartenExportStand }>();

const gewaehlt = ref<ReadonlySet<string>>(new Set());
const png = computed(() => props.stand.karten.filter((k) => k.art === "png"));
const svg = computed(() => props.stand.karten.filter((k) => k.art === "svg"));
const bilder = reactive<Record<string, string | null>>({});

// Vorgewählt ist nichts Teures: das gängige Paar aus Bild und Vektor, wenn es da ist.
let vorgewaehlt = false;
watch(
    () => props.stand.karten,
    (karten) => {
        const da = new Set(karten.filter((k) => k.bytes !== null).map((k) => k.id));
        gewaehlt.value = new Set([...gewaehlt.value].filter((id) => da.has(id)));
        if (!vorgewaehlt && karten.length > 0) {
            vorgewaehlt = true;
            gewaehlt.value = new Set(["modern", "svg-roh"].filter((id) => da.has(id)));
        }
        for (const karte of karten) {
            if (karte.art === "png" && !(karte.id in bilder)) {
                bilder[karte.id] = null;
                void vorschauVon(karte.id).then((adresse) => (bilder[karte.id] = adresse));
            }
        }
    },
    { immediate: true },
);

function schalte(id: string, an: boolean): void {
    const neu = new Set(gewaehlt.value);
    if (an) neu.add(id);
    else neu.delete(id);
    gewaehlt.value = neu;
    ausgabe.value = null;
}

const pngDa = computed(() => png.value.filter((k) => k.bytes !== null));
const allePng = computed(() => pngDa.value.length > 0 && pngDa.value.every((k) => gewaehlt.value.has(k.id)));
function schalteAllePng(): void {
    const neu = new Set(gewaehlt.value);
    for (const karte of pngDa.value) {
        if (allePng.value) neu.delete(karte.id);
        else neu.add(karte.id);
    }
    gewaehlt.value = neu;
    ausgabe.value = null;
}

const imZip = computed(() => props.stand.karten.filter((k) => gewaehlt.value.has(k.id) && k.bytes !== null));
const summe = computed(() => imZip.value.reduce((n, k) => n + (k.bytes ?? 0), 0));
const heute = computed(() => props.stand.jetzt.slice(0, 10));

function faktenPng(karte: KartenEintrag): string {
    if (karte.bytes === null) return t("kartenExport.png.fehlt");
    return t("kartenExport.png.fakten", {
        pixel: formatNumber(karte.pixel ?? 0, 0),
        fassung: (karte.fassung ?? "").slice(0, 8),
        datum: karte.stand === null ? "" : datumText(karte.stand),
    });
}

// SVG erzeugen.
const svgFehler = ref<string | null>(null);
const svgLaeuft = computed(() => props.stand.svg.zustand === "laeuft");

async function erzeuge(einstellungen?: KartenSvgEinstellungen): Promise<void> {
    svgFehler.value = null;
    try {
        await props.sicht.erzeugeSvg(einstellungen);
    } catch (error) {
        svgFehler.value = fehlerText(error);
    }
}

function fehlerText(error: unknown): string {
    const [satz] = formProblems(error);
    if (satz !== undefined) return t(satz.key, satz.params);
    return error instanceof ApiFailure ? error.message : t("auth.form.failed");
}

// Eigene Einstellungen, wie auf Legacys Seite.
const eigenOffen = ref(false);
const programm = ref<KartenSvgEinstellungen["dialekt"]>("inkscape");
const groesse = ref("32768");
const strich = ref("100");
const glattWege = ref(true);
const glattFlaechen = ref(true);
const semantik = ref(true);
const passmarken = ref(false);
const ebenen = ref<ReadonlySet<string>>(new Set(KARTEN_SVG_EBENEN));
const EBENEN_NAMEN: Record<(typeof KARTEN_SVG_EBENEN)[number], MessageKey> = {
    landschaften: "kartenExport.eigen.ebene.landschaften",
    gebiete: "kartenExport.eigen.ebene.gebiete",
    wege: "kartenExport.eigen.ebene.wege",
    kraftlinien: "kartenExport.eigen.ebene.kraftlinien",
    orte: "kartenExport.eigen.ebene.orte",
    beschriftungen: "kartenExport.eigen.ebene.beschriftungen",
};

const eigeneEinstellungen = computed<KartenSvgEinstellungen | null>(() => {
    const px = Number(groesse.value);
    const prozent = Number(strich.value);
    if (!Number.isInteger(px) || px < 256 || px > 200_000) return null;
    if (!Number.isInteger(prozent) || prozent < 5 || prozent > 400) return null;
    const gewaehlteEbenen = KARTEN_SVG_EBENEN.filter((ebene) => ebenen.value.has(ebene));
    if (gewaehlteEbenen.length === 0) return null;
    return {
        dialekt: programm.value,
        groessePx: px,
        semantik: semantik.value,
        passmarken: passmarken.value,
        strichProzent: prozent,
        glattWege: glattWege.value,
        glattFlaechen: glattFlaechen.value,
        spannung: 0.5,
        ebenen: gewaehlteEbenen,
    };
});

function schalteEbene(ebene: string, an: boolean): void {
    const neu = new Set(ebenen.value);
    if (an) neu.add(ebene);
    else neu.delete(ebene);
    ebenen.value = neu;
}

// Weitergeben.
const art = ref<KartenZugangArt>("link");
const fuerWen = ref("");
const tage = reactive<Record<KartenZugangArt, string>>({
    link: String(KARTEN_FRIST_VORGABE.link),
    schluessel: String(KARTEN_FRIST_VORGABE.schluessel),
});
const fristOptionen = computed(() =>
    KARTEN_FRISTEN[art.value].map((n) => ({
        value: String(n),
        label: n === 1 ? t("kartenExport.weiter.tag") : t("kartenExport.weiter.tage", { n }),
    })),
);
const artOptionen = computed(() => [
    { value: "link", label: t("kartenExport.weiter.link") },
    { value: "schluessel", label: t("kartenExport.weiter.schluessel") },
]);
const programmOptionen = [
    { value: "inkscape", label: "Inkscape" },
    { value: "illustrator", label: "Illustrator" },
];
const ausgabe = ref<KartenZugangNeu | null>(null);
const ausgabeArt = ref<KartenZugangArt>("link");
const fehler = ref<string | null>(null);
const sendet = ref(false);
const feld = useTemplateRef<InstanceType<typeof AvmEingabe>>("feld");
const ausgabeOrt = useTemplateRef<HTMLElement>("ausgabeOrt");

const sperre = computed<string | undefined>(() => {
    if (imZip.value.length === 0) return t("kartenExport.zip.leer");
    if (fuerWen.value.trim() === "") return t("kartenExport.weiter.ohneName");
    return undefined;
});

watch(art, () => {
    ausgabe.value = null;
});

async function erstelle(): Promise<void> {
    if (sperre.value !== undefined || sendet.value) return;
    sendet.value = true;
    fehler.value = null;
    try {
        ausgabe.value = await props.sicht.erstelle({
            art: art.value,
            fuerWen: fuerWen.value.trim(),
            tage: Number(tage[art.value]),
            karten: imZip.value.map((k) => k.id),
        });
        ausgabeArt.value = art.value;
        fuerWen.value = "";
        await nextTick();
        ausgabeOrt.value?.scrollIntoView({ block: "nearest" });
    } catch (error) {
        fehler.value = fehlerText(error);
    } finally {
        sendet.value = false;
    }
}

function ansehen(): void {
    if (ausgabe.value !== null) window.open(ausgabe.value.wert, "_blank", "noopener");
}

/** Von den Reitern „Links“ und „API-Schlüssel“ aus: Hierher, passende Art, in das Feld. */
function weitergeben(neueArt: KartenZugangArt): void {
    art.value = neueArt;
    feld.value?.focus();
}
defineExpose({ weitergeben });
</script>

<template>
    <div class="auswahl" data-testid="karten-auswahl">
        <div class="auswahl__spalte">
            <div class="auswahl__kopf">
                <h3 class="auswahl__titel">{{ t("kartenExport.png.titel") }}</h3>
                <button
                    v-if="pngDa.length > 1"
                    type="button"
                    class="auswahl__wort"
                    data-testid="karten-alle-png"
                    @click="schalteAllePng"
                >
                    {{ allePng ? t("kartenExport.png.keine") : t("kartenExport.png.alle") }}
                </button>
            </div>
            <AvmKaestchen
                v-for="karte in png"
                :key="karte.id"
                art="checkbox"
                class="zeile"
                :class="{ 'is-an': gewaehlt.has(karte.id), 'is-fehlt': karte.bytes === null }"
                :checked="gewaehlt.has(karte.id)"
                :gesperrt="karte.bytes === null ? t('kartenExport.png.fehlt') : undefined"
                :testid="`karten-wahl-${karte.id}`"
                :data-testid="`karten-zeile-${karte.id}`"
                @change="(an: boolean) => schalte(karte.id, an)"
            >
                <img v-if="bilder[karte.id]" class="zeile__bild" :src="bilder[karte.id]!" alt="" />
                <span v-else class="zeile__bild" aria-hidden="true"></span>
                <span class="zeile__text">
                    <span class="zeile__name">
                        {{ kartenName(karte) }}
                        <AvmPille v-if="karte.nurEditoren">{{ t("kartenExport.png.nurEditoren") }}</AvmPille>
                    </span>
                    <span class="zeile__unter">{{ kartenText(karte) }}</span>
                    <span class="zeile__unter">{{ faktenPng(karte) }}</span>
                </span>
                <span v-if="karte.bytes !== null" class="zeile__groesse">{{ groesseText(karte.bytes) }}</span>
            </AvmKaestchen>

            <div class="auswahl__kopf">
                <h3 class="auswahl__titel">{{ t("kartenExport.svg.titel") }}</h3>
                <span v-if="svgLaeuft" class="auswahl__leise" data-testid="karten-svg-laeuft">{{
                    t("kartenExport.svg.laeuft")
                }}</span>
                <AvmKnopf v-else groesse="zeile" testid="karten-svg-erzeugen" @click="erzeuge()">{{
                    t("kartenExport.svg.erzeugen")
                }}</AvmKnopf>
            </div>
            <AvmHinweis v-if="stand.svg.zustand === 'fehler'" ton="warnung" testid="karten-svg-fehler">{{
                t("kartenExport.svg.fehler", { grund: stand.svg.fehler ?? "" })
            }}</AvmHinweis>
            <AvmHinweis v-if="svgFehler" ton="warnung" rolle="alert">{{ svgFehler }}</AvmHinweis>
            <p v-if="stand.svg.veraltet && !svgLaeuft && svg.some((k) => k.bytes !== null)" class="auswahl__leise">
                {{ t("kartenExport.svg.veraltet") }}
            </p>
            <AvmKaestchen
                v-for="karte in svg"
                :key="karte.id"
                art="checkbox"
                class="zeile zeile--klein"
                :class="{ 'is-an': gewaehlt.has(karte.id), 'is-fehlt': karte.bytes === null }"
                :checked="gewaehlt.has(karte.id)"
                :gesperrt="karte.bytes === null ? t('kartenExport.svg.fehlt') : undefined"
                :testid="`karten-wahl-${karte.id}`"
                :data-testid="`karten-zeile-${karte.id}`"
                @change="(an: boolean) => schalte(karte.id, an)"
            >
                <span class="zeile__zeichen" aria-hidden="true">
                    <svg
                        width="28"
                        height="22"
                        viewBox="0 0 28 22"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.3"
                        stroke-linecap="round"
                    >
                        <path d="M2 17C7 5 10 16 14 10s7-7 12-5" />
                        <circle cx="2" cy="17" r="1.6" fill="currentColor" />
                        <circle cx="14" cy="10" r="1.6" fill="currentColor" />
                        <circle cx="26" cy="5" r="1.6" fill="currentColor" />
                    </svg>
                </span>
                <span class="zeile__text">
                    <span class="zeile__name">{{ kartenName(karte) }}</span>
                    <span class="zeile__unter">
                        {{ kartenText(karte) }}
                        <template v-if="karte.stand">
                            · {{ t("kartenExport.svg.stand", { zeit: zeitText(karte.stand) }) }}</template
                        >
                    </span>
                </span>
                <span class="zeile__groesse">{{
                    karte.bytes === null ? t("kartenExport.svg.fehlt") : groesseText(karte.bytes)
                }}</span>
            </AvmKaestchen>

            <button
                type="button"
                class="auswahl__wort auswahl__wort--block"
                :aria-expanded="eigenOffen"
                data-testid="karten-eigen-oeffnen"
                @click="eigenOffen = !eigenOffen"
            >
                {{ t("kartenExport.eigen.oeffnen") }}
            </button>
            <div v-if="eigenOffen" class="eigen" data-testid="karten-eigen">
                <p class="eigen__satz">{{ t("kartenExport.eigen.satz") }}</p>
                <div class="feld">
                    <span class="feld__name">{{ t("kartenExport.eigen.programm") }}</span>
                    <AvmSegmente
                        :model-value="programm"
                        :options="programmOptionen"
                        :label="t('kartenExport.eigen.programm')"
                        testid="karten-eigen-programm"
                        @update:model-value="(wert: string) => (programm = wert as KartenSvgEinstellungen['dialekt'])"
                    />
                </div>
                <div class="eigen__zwei">
                    <label class="feld">
                        <span class="feld__name">{{ t("kartenExport.eigen.groesse") }}</span>
                        <AvmEingabe v-model="groesse" inputmode="numeric" data-testid="karten-eigen-groesse" />
                    </label>
                    <label class="feld">
                        <span class="feld__name">{{ t("kartenExport.eigen.strich") }}</span>
                        <AvmEingabe v-model="strich" inputmode="numeric" data-testid="karten-eigen-strich" />
                    </label>
                </div>
                <div class="feld">
                    <span class="feld__name">{{ t("kartenExport.eigen.glatt") }}</span>
                    <AvmKaestchen art="checkbox" :checked="glattWege" @change="(an: boolean) => (glattWege = an)">{{
                        t("kartenExport.eigen.glattWege")
                    }}</AvmKaestchen>
                    <AvmKaestchen
                        art="checkbox"
                        :checked="glattFlaechen"
                        @change="(an: boolean) => (glattFlaechen = an)"
                        >{{ t("kartenExport.eigen.glattFlaechen") }}</AvmKaestchen
                    >
                    <AvmKaestchen art="checkbox" :checked="semantik" @change="(an: boolean) => (semantik = an)">{{
                        t("kartenExport.eigen.semantik")
                    }}</AvmKaestchen>
                    <AvmKaestchen art="checkbox" :checked="passmarken" @change="(an: boolean) => (passmarken = an)">{{
                        t("kartenExport.eigen.passmarken")
                    }}</AvmKaestchen>
                </div>
                <div class="feld">
                    <span class="feld__name">{{ t("kartenExport.eigen.ebenen") }}</span>
                    <AvmKaestchen
                        v-for="ebene in KARTEN_SVG_EBENEN"
                        :key="ebene"
                        art="checkbox"
                        :checked="ebenen.has(ebene)"
                        @change="(an: boolean) => schalteEbene(ebene, an)"
                        >{{ t(EBENEN_NAMEN[ebene]) }}</AvmKaestchen
                    >
                </div>
                <AvmKnopf
                    :gesperrt="
                        eigeneEinstellungen === null
                            ? t('kartenExport.eigen.ungueltig')
                            : svgLaeuft
                              ? t('kartenExport.svg.laeuft')
                              : undefined
                    "
                    testid="karten-eigen-bauen"
                    @click="erzeuge(eigeneEinstellungen ?? undefined)"
                >
                    {{ t("kartenExport.eigen.bauen") }}
                </AvmKnopf>
            </div>
        </div>

        <div class="auswahl__spalte">
            <section class="kasten" :aria-label="t('kartenExport.zip.titel')">
                <h3 class="auswahl__titel">{{ t("kartenExport.zip.titel") }}</h3>
                <p class="kasten__name">{{ t("kartenExport.zip.name", { datum: heute }) }}</p>
                <ul class="zip">
                    <li v-for="karte in imZip" :key="karte.id" :data-testid="`karten-zip-${karte.id}`">
                        <span class="zip__datei">{{ karte.datei }}</span>
                        <span class="zip__zahl">{{ groesseText(karte.bytes ?? 0) }}</span>
                    </li>
                    <li class="zip__beilage">
                        <span class="zip__datei">{{ t("kartenExport.zip.beilage") }}</span>
                        <span>{{ t("kartenExport.zip.immer") }}</span>
                    </li>
                </ul>
                <div class="zip__summe">
                    <span>{{ t("kartenExport.zip.anzahl", { n: imZip.length }) }}</span>
                    <span class="zip__zahl" data-testid="karten-zip-summe">{{
                        imZip.length ? groesseText(summe) : "–"
                    }}</span>
                </div>
                <AvmKnopf
                    breit
                    :gesperrt="imZip.length === 0 ? t('kartenExport.zip.leer') : undefined"
                    testid="karten-zip-laden"
                    @click="speichere(zipAdresse(imZip.map((k) => k.id)))"
                >
                    <span aria-hidden="true">⇩ </span>{{ t("kartenExport.zip.laden") }}
                </AvmKnopf>
            </section>

            <section class="kasten" :aria-label="t('kartenExport.weiter.titel')">
                <h3 class="auswahl__titel">{{ t("kartenExport.weiter.titel") }}</h3>
                <AvmSegmente
                    v-model="art"
                    :options="artOptionen"
                    :label="t('kartenExport.weiter.art')"
                    testid="karten-weiter-art"
                />
                <label class="feld">
                    <span class="feld__name">{{ t("kartenExport.weiter.fuerWen") }}</span>
                    <AvmEingabe
                        ref="feld"
                        v-model="fuerWen"
                        :maxlength="KARTEN_FUER_WEN_LAENGE"
                        :placeholder="t('kartenExport.weiter.fuerWenPlatz')"
                        testid="karten-weiter-wen"
                    />
                </label>
                <div class="feld">
                    <span class="feld__name">{{ t("kartenExport.weiter.gueltig") }}</span>
                    <AvmSegmente
                        v-model="tage[art]"
                        :options="fristOptionen"
                        :label="t('kartenExport.weiter.gueltig')"
                        testid="karten-weiter-frist"
                    />
                </div>
                <AvmKnopf art="gefuellt" breit :gesperrt="sperre" testid="karten-weiter-erstellen" @click="erstelle">
                    {{
                        art === "link"
                            ? t("kartenExport.weiter.linkErstellen")
                            : t("kartenExport.weiter.schluesselErstellen")
                    }}
                </AvmKnopf>
                <p v-if="ausgabe === null && sperre === undefined" class="auswahl__leise">
                    {{ art === "link" ? t("kartenExport.weiter.satzLink") : t("kartenExport.weiter.satzSchluessel") }}
                </p>
                <AvmHinweis v-if="fehler" ton="warnung" rolle="alert" testid="karten-weiter-fehler">{{
                    fehler
                }}</AvmHinweis>
                <div v-if="ausgabe" ref="ausgabeOrt" class="ausgabe" data-testid="karten-weiter-ausgabe">
                    <AvmKopierfeld
                        :wert="ausgabe.wert"
                        :beschriftung="t('kartenExport.weiter.wert')"
                        testid="karten-weiter-wert"
                    />
                    <p class="auswahl__leise">{{ t("kartenExport.weiter.nurJetzt") }}</p>
                    <AvmKnopf
                        v-if="ausgabeArt === 'link'"
                        groesse="zeile"
                        testid="karten-weiter-ansehen"
                        @click="ansehen"
                    >
                        {{ t("kartenExport.weiter.ansehen") }}
                    </AvmKnopf>
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
.auswahl {
    display: grid;
    grid-template-columns: minmax(0, 1.618fr) minmax(0, 1fr);
    gap: var(--space-16);
    align-items: start;
}

.auswahl__spalte {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
}

.auswahl__kopf {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
    min-height: var(--space-24);
}

.auswahl__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.auswahl__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.auswahl__wort {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 120ms ease;
}

.auswahl__wort:hover {
    color: var(--color-text-strong);
}

.auswahl__wort:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.auswahl__wort--block {
    justify-self: start;
}

.auswahl__spalte > .zeile {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    gap: var(--space-8);
    align-items: center;
    padding: var(--space-4) var(--space-8) var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.zeile:hover {
    background: var(--color-hover-wash);
}

.zeile.is-an {
    border-color: var(--color-border-strong);
    background: var(--color-active-wash);
}

.zeile.is-fehlt {
    background: var(--color-panel-soft);
    cursor: default;
}

.zeile__bild {
    display: block;
    width: var(--avm-fenster-kachel);
    max-width: 3.75rem;
    height: 3.75rem;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    object-fit: cover;
}

.zeile__zeichen {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.75rem;
    height: 2.5rem;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    color: var(--color-text-muted);
}

.zeile__text {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.zeile__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.zeile__groesse {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.eigen {
    display: grid;
    gap: var(--space-8);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.eigen__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.eigen__zwei {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8);
}

.feld {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.feld__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.kasten {
    display: grid;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.kasten__name {
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.zip {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    font-size: var(--font-size-small);
    list-style: none;
}

.zip li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-8);
    min-width: 0;
}

.zip__datei {
    min-width: 0;
    overflow-wrap: anywhere;
}

.zip__zahl {
    flex: none;
    font-variant-numeric: tabular-nums;
}

.zip__beilage {
    color: var(--color-text-muted);
}

.zip__summe {
    display: flex;
    justify-content: space-between;
    gap: var(--space-8);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-strong);
}

.ausgabe {
    display: grid;
    gap: var(--space-4);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
}

@media (max-width: 860px) {
    .auswahl {
        grid-template-columns: minmax(0, 1fr);
    }
}

@media (max-width: 600px) {
    .zeile {
        grid-template-columns: auto auto minmax(0, 1fr);
    }

    .zeile__groesse {
        grid-column: 3;
    }

    .zeile__bild,
    .zeile__zeichen {
        width: 3rem;
        height: 3rem;
    }
}
</style>
