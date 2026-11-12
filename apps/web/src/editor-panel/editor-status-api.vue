<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
    BESUCH_SCHNITTSTELLEN_URL,
    CLIENT_FEHLER_ARTEN,
    CLIENT_FEHLER_GRENZEN,
    type ApiZahlen,
    type ClientFehlerArt,
} from "@avesmaps3d/shared";
import { NUMBER_LOCALE, formatNumber, locale, t } from "../i18n/i18n";

/**
 * Der Unterreiter „API“ des Reiters „Status“ (WI-0138 V12, BESUCH-0001 §13 F): wer unsere eigenen Schnittstellen ruft.
 *
 * - **Kennzahlen**: Anfragen, Anteil der schlechten Antworten, Spitzenstunde, dazu der Takt als eigene Zahl.
 * - **Wie geantwortet wurde**: die Statusklassen, `gestorben` für Anfragen, die nie bei einer Antwort ankamen.
 * - **Wer ruft an**: die vier Zonen; der Takt steht daneben, nicht darin.
 * - **Wer fragt** (WI-0307): Herkunft, Absender von außen, Route von Dritten, alte Legacy-Pfade, Drossel von Nginx.
 * - **Meistgerufene Wege** und **häufigste Fehler**: Routennamen, nie Adressen.
 * - **Wann die Last liegt**: 24 Stunden als Band.
 * - **Fehler im Browser** (WI-0202): je Art gezählt, dazu die häufigsten bereinigten Diagnosen der letzten 14 Tage.
 *
 * Die Zahlen kommen aus `api_metric`; die Zeilen tragen weder Adressen noch Nutzlast noch Schlüssel.
 */
const props = defineProps<{ tage: number }>();

const zahlen = ref<ApiZahlen | undefined>(undefined);
const laedt = ref(false);
const fehler = ref(false);

/** Nur die jüngste Anfrage setzt die Zahlen: Eine langsame ältere überschrieb sonst den gewählten Zeitraum (wie `editor-status.vue`). */
let abruf = 0;

async function hole(): Promise<void> {
    const nummer = ++abruf;
    laedt.value = true;
    fehler.value = false;
    try {
        const antwort = await fetch(`${BESUCH_SCHNITTSTELLEN_URL}?tage=${props.tage}`, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) throw new Error(String(antwort.status));
        const neu = (await antwort.json()) as ApiZahlen;
        if (nummer === abruf) zahlen.value = neu;
    } catch {
        if (nummer !== abruf) return;
        fehler.value = true;
        zahlen.value = undefined;
    } finally {
        if (nummer === abruf) laedt.value = false;
    }
}

onMounted(hole);
watch(() => props.tage, hole);

const stundenHoechst = computed(() => Math.max(1, ...(zahlen.value?.stunden ?? [0])));

/** Große Zahlen kurz: 1,24 Mio statt 1.240.000 - im 400-Pixel-Panel zählt jede Stelle. */
function kurz(wert: number): string {
    // 🪤 Über die Sprachtafel formatiert, nicht mit toFixed: sonst stünde im deutschen Panel „2.94 Mio" mit Punkt.
    if (wert >= 1_000_000) return t("statistik.millionen", { zahl: formatNumber(wert / 1_000_000, 2) });
    if (wert >= 10_000) return t("statistik.tausend", { zahl: formatNumber(Math.round(wert / 1000), 0) });
    return formatNumber(wert, 0);
}

function anteil(liste: readonly { name: string; wert: number }[], wert: number): string {
    const hoechst = Math.max(1, ...liste.map((eintrag) => eintrag.wert));
    return `${Math.max(3, (wert / hoechst) * 100)}%`;
}

/** `/api/share/:code|not_found` wird zu Weg und Grund. */
function fehlerTeile(name: string): { weg: string; grund: string } {
    const trenner = name.lastIndexOf("|");
    return trenner < 0 ? { weg: name, grund: "" } : { weg: name.slice(0, trenner), grund: name.slice(trenner + 1) };
}

const KLASSEN_NAMEN: Readonly<Record<string, Parameters<typeof t>[0]>> = {
    "2xx": "statistik.klasse.gut",
    "3xx": "statistik.klasse.weiter",
    "4xx": "statistik.klasse.abgelehnt",
    "5xx": "statistik.klasse.fehler",
    gestorben: "statistik.klasse.gestorben",
};
const ZONEN_NAMEN: Readonly<Record<string, Parameters<typeof t>[0]>> = {
    offen: "statistik.zone.offen",
    karte: "statistik.zone.karte",
    editor: "statistik.zone.editor",
    uebrige: "statistik.zone.uebrige",
};

const klassenName = (name: string): string => (KLASSEN_NAMEN[name] === undefined ? name : t(KLASSEN_NAMEN[name]!));

/** Fehler im Browser (WI-0202); ein älterer Server schickt das Feld nicht, dann fehlt der Block. */
const browserFehler = computed(() => zahlen.value?.browserFehler);
const artName = (art: string): string =>
    (CLIENT_FEHLER_ARTEN as readonly string[]).includes(art)
        ? t(`statistik.browserFehlerArt.${art as ClientFehlerArt}`)
        : art;
/** Die zweite Zeile einer Diagnose: Art, erste Stelle, Browser, Grafik, Release, Anzahl. Leeres fällt weg. */
const diagnoseSpur = (diagnose: NonNullable<ApiZahlen["browserFehler"]>["diagnosen"][number]): string =>
    [
        artName(diagnose.art),
        diagnose.stellen[0] ?? "",
        diagnose.browser,
        diagnose.grafik,
        diagnose.release,
        t("statistik.browserFehlerMal", { anzahl: formatNumber(diagnose.anzahl, 0) }),
    ]
        .filter((teil) => teil !== "")
        .join(" · ");
const zonenName = (name: string): string => (ZONEN_NAMEN[name] === undefined ? name : t(ZONEN_NAMEN[name]!));

/**
 * Wer fragt (WI-0307): Herkunft als Anteil, die Absender von außen mit erstem und letztem Tag, Route von Dritten und die alten
 * Legacy-Pfade je Tag (damit man das Auslaufen sieht). Die Drossel von Nginx (Teil B, Claudios Host-Auftrag) erscheint erst, wenn es
 * Zeilen gibt. Ein älterer Server schickt das Feld nicht, dann fehlt der Abschnitt.
 */
const werFragt = computed(() => zahlen.value?.werFragt);
const summe = (reihe: readonly number[]): number => reihe.reduce((gesamt, wert) => gesamt + wert, 0);
const herkunftGesamt = computed(() => summe((werFragt.value?.herkunft ?? []).map((eintrag) => eintrag.wert)));
const herkunftAnteil = (wert: number): string =>
    `${formatNumber(herkunftGesamt.value > 0 ? (wert / herkunftGesamt.value) * 100 : 0, 0)} %`;
const routeSumme = computed(() => summe(werFragt.value?.routeVonDritten ?? []));
const legacySumme = computed(() => summe(werFragt.value?.legacy ?? []));
const drosselSumme = computed(() => summe(werFragt.value?.drossel ?? []));

const HERKUNFT_NAMEN: Readonly<Record<string, Parameters<typeof t>[0]>> = {
    eigene_seite: "statistik.werFragt.herkunft.eigene_seite",
    fremde_seite: "statistik.werFragt.herkunft.fremde_seite",
    ohne_seite: "statistik.werFragt.herkunft.ohne_seite",
};
/** Die festen Namen neben echten Absendern und Seiten (`API_ABSENDER`, `api-herkunft.ts`); alles andere steht, wie es kam. */
const FESTE_NAMEN: Readonly<Record<string, Parameters<typeof t>[0]>> = {
    anders: "statistik.werFragt.name.anders",
    andere: "statistik.werFragt.name.andere",
    ohne_angabe: "statistik.werFragt.name.ohne",
    "ip-adresse": "statistik.werFragt.name.ipAdresse",
    unbekannt: "statistik.werFragt.name.unbekannt",
};
const herkunftName = (name: string): string => (HERKUNFT_NAMEN[name] === undefined ? name : t(HERKUNFT_NAMEN[name]!));
const fremderName = (name: string): string => (FESTE_NAMEN[name] === undefined ? name : t(FESTE_NAMEN[name]!));
/** `reise|dsaworld-route-check` wird „dsaworld-route-check · reise“. */
const drosselName = (name: string): string => {
    const trenner = name.indexOf("|");
    return trenner < 0 ? name : `${fremderName(name.slice(trenner + 1))} · ${name.slice(0, trenner)}`;
};

/** Ein Tag kurz in der Sprache der Seite, etwa „08.11.“. */
function kurzTag(iso: string | undefined): string {
    if (iso === undefined || iso === "") return "";
    const datum = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(datum.getTime())) return iso;
    return datum.toLocaleDateString(NUMBER_LOCALE[locale.value], { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
const tageSpanne = (erster: string, letzter: string): string =>
    erster === letzter ? kurzTag(erster) : `${kurzTag(erster)} – ${kurzTag(letzter)}`;

/** Ein Verlauf je Tag als Säulen; ein einzelner Aufruf bleibt sichtbar. */
function saeulen(reihe: readonly number[]): { x: number; hoehe: number; wert: number; tag: string }[] {
    const hoechst = Math.max(1, ...reihe);
    const tage = werFragt.value?.tage ?? [];
    return reihe
        .map((wert, index) => ({
            x: index,
            hoehe: wert === 0 ? 0 : Math.max(2, (wert / hoechst) * 20),
            wert,
            tag: tage[index] ?? "",
        }))
        .filter((saeule) => saeule.wert > 0);
}
</script>

<template>
    <div class="api">
        <p v-if="laedt && !zahlen" class="api__satz">{{ t("statistik.laedt") }}</p>
        <p v-else-if="fehler" class="api__satz">{{ t("statistik.fehler") }}</p>

        <template v-if="zahlen">
            <section class="api__block">
                <h3 class="api__titel">
                    {{ t("statistik.zeitraum") }}
                    <span class="api__wert">{{ zahlen.von }} – {{ zahlen.bis }}</span>
                </h3>
                <div class="api__kacheln">
                    <div class="api__kachel">
                        <span class="api__kachelWort">{{ t("statistik.anfragen") }}</span>
                        <span class="api__kachelZahl">{{ kurz(zahlen.kennzahlen.anfragen) }}</span>
                    </div>
                    <div class="api__kachel">
                        <span class="api__kachelWort">{{ t("statistik.fehlerquote") }}</span>
                        <span class="api__kachelZahl"
                            >{{ formatNumber(zahlen.kennzahlen.fehlerquote * 100, 1) }} %</span
                        >
                    </div>
                    <div class="api__kachel">
                        <span class="api__kachelWort">{{ t("statistik.spitzenstunde") }}</span>
                        <span class="api__kachelZahl">{{
                            zahlen.kennzahlen.spitzenstunde === null
                                ? "–"
                                : `${zahlen.kennzahlen.spitzenstunde} ${t("statistik.uhr")}`
                        }}</span>
                    </div>
                </div>
                <p class="api__satz">{{ t("statistik.taktSatz", { anzahl: kurz(zahlen.kennzahlen.takt) }) }}</p>
            </section>

            <section v-if="zahlen.klassen.length > 0" class="api__block">
                <h3 class="api__titel">{{ t("statistik.antworten") }}</h3>
                <div v-for="eintrag in zahlen.klassen" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig">{{ klassenName(eintrag.name) }}</span>
                    <span class="api__spur"
                        ><i
                            :style="{ width: anteil(zahlen.klassen, eintrag.wert) }"
                            :class="{ 'is-schlecht': eintrag.name !== '2xx' && eintrag.name !== '3xx' }"
                        ></i
                    ></span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>
            </section>

            <section v-if="zahlen.zonen.length > 0" class="api__block">
                <h3 class="api__titel">
                    {{ t("statistik.werRuftAn") }} <span class="api__wert">{{ t("statistik.taktDraussen") }}</span>
                </h3>
                <div v-for="eintrag in zahlen.zonen" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig">{{ zonenName(eintrag.name) }}</span>
                    <span class="api__spur"><i :style="{ width: anteil(zahlen.zonen, eintrag.wert) }"></i></span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>
            </section>

            <section v-if="werFragt" class="api__block" data-testid="api-wer-fragt">
                <h3 class="api__titel">
                    {{ t("statistik.werFragt.titel") }}
                    <span class="api__wert">{{ t("statistik.taktDraussen") }}</span>
                </h3>
                <p v-if="werFragt.herkunft.length === 0" class="api__satz">{{ t("statistik.werFragt.keine") }}</p>
                <div v-for="eintrag in werFragt.herkunft" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig">{{ herkunftName(eintrag.name) }}</span>
                    <span class="api__spur"
                        ><i
                            :style="{ width: anteil(werFragt.herkunft, eintrag.wert) }"
                            :class="{ 'is-aussen': eintrag.name !== 'eigene_seite' }"
                        ></i
                    ></span>
                    <span class="api__balkenZahl">{{ herkunftAnteil(eintrag.wert) }}</span>
                </div>
                <p v-if="werFragt.herkunft.length > 0" class="api__satz">{{ t("statistik.werFragt.herkunftSatz") }}</p>

                <template v-if="werFragt.fremdeSeiten.length > 0">
                    <h4 class="api__unter">{{ t("statistik.werFragt.fremdeSeiten") }}</h4>
                    <div v-for="eintrag in werFragt.fremdeSeiten" :key="eintrag.name" class="api__balken">
                        <span class="api__balkenName einzeilig" :title="eintrag.name">{{
                            fremderName(eintrag.name)
                        }}</span>
                        <span class="api__spur"
                            ><i class="is-aussen" :style="{ width: anteil(werFragt.fremdeSeiten, eintrag.wert) }"></i
                        ></span>
                        <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                    </div>
                </template>

                <h4 class="api__unter">
                    {{ t("statistik.werFragt.absender") }}
                    <span class="api__wert">{{ t("statistik.werFragt.nenntSich") }}</span>
                </h4>
                <p v-if="werFragt.absender.length === 0" class="api__satz">{{ t("statistik.werFragt.keine") }}</p>
                <div
                    v-for="eintrag in werFragt.absender"
                    :key="eintrag.name"
                    class="api__absender"
                    data-testid="api-absender"
                >
                    <span class="api__balkenName einzeilig" :title="eintrag.name">{{ fremderName(eintrag.name) }}</span>
                    <span class="api__absenderTage">{{ tageSpanne(eintrag.erster, eintrag.letzter) }}</span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>

                <template v-if="werFragt.wegeVonAussen.length > 0">
                    <h4 class="api__unter">{{ t("statistik.werFragt.wege") }}</h4>
                    <div v-for="eintrag in werFragt.wegeVonAussen" :key="eintrag.name" class="api__balken">
                        <span class="api__balkenName einzeilig" :title="eintrag.name">{{ eintrag.name }}</span>
                        <span class="api__spur"
                            ><i class="is-aussen" :style="{ width: anteil(werFragt.wegeVonAussen, eintrag.wert) }"></i
                        ></span>
                        <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                    </div>
                </template>

                <h4 class="api__unter">
                    {{ t("statistik.werFragt.route") }} <span class="api__wert">{{ kurz(routeSumme) }}</span>
                </h4>
                <p v-if="routeSumme === 0" class="api__satz">{{ t("statistik.werFragt.keine") }}</p>
                <template v-else>
                    <svg
                        class="api__verlauf"
                        :viewBox="`0 0 ${werFragt.tage.length} 20`"
                        preserveAspectRatio="none"
                        role="img"
                        :aria-label="`${t('statistik.werFragt.route')}, ${t('statistik.werFragt.verlaufLabel')}`"
                        data-testid="api-verlauf-route"
                    >
                        <rect
                            v-for="saeule in saeulen(werFragt.routeVonDritten)"
                            :key="saeule.x"
                            :x="saeule.x + 0.14"
                            width="0.72"
                            :y="20 - saeule.hoehe"
                            :height="saeule.hoehe"
                            class="is-aussen"
                        >
                            <title>{{ kurzTag(saeule.tag) }}: {{ formatNumber(saeule.wert, 0) }}</title>
                        </rect>
                    </svg>
                    <div class="api__stundenWorte">
                        <span>{{ kurzTag(werFragt.tage[0]) }}</span
                        ><span v-if="werFragt.tage.length > 1">{{ kurzTag(werFragt.tage.at(-1)) }}</span>
                    </div>
                </template>

                <h4 class="api__unter">
                    {{ t("statistik.werFragt.legacy") }} <span class="api__wert">{{ kurz(legacySumme) }}</span>
                </h4>
                <p v-if="legacySumme === 0" class="api__satz">{{ t("statistik.werFragt.keine") }}</p>
                <template v-else>
                    <svg
                        class="api__verlauf"
                        :viewBox="`0 0 ${werFragt.tage.length} 20`"
                        preserveAspectRatio="none"
                        role="img"
                        :aria-label="`${t('statistik.werFragt.legacy')}, ${t('statistik.werFragt.verlaufLabel')}`"
                        data-testid="api-verlauf-legacy"
                    >
                        <rect
                            v-for="saeule in saeulen(werFragt.legacy)"
                            :key="saeule.x"
                            :x="saeule.x + 0.14"
                            width="0.72"
                            :y="20 - saeule.hoehe"
                            :height="saeule.hoehe"
                        >
                            <title>{{ kurzTag(saeule.tag) }}: {{ formatNumber(saeule.wert, 0) }}</title>
                        </rect>
                    </svg>
                    <div class="api__stundenWorte">
                        <span>{{ kurzTag(werFragt.tage[0]) }}</span
                        ><span v-if="werFragt.tage.length > 1">{{ kurzTag(werFragt.tage.at(-1)) }}</span>
                    </div>
                    <div v-for="eintrag in werFragt.legacyPfade" :key="eintrag.name" class="api__balken">
                        <span class="api__balkenName einzeilig" :title="eintrag.name">{{ eintrag.name }}</span>
                        <span class="api__spur"
                            ><i :style="{ width: anteil(werFragt.legacyPfade, eintrag.wert) }"></i
                        ></span>
                        <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                    </div>
                </template>

                <template v-if="drosselSumme > 0 || werFragt.drosselZonen.length > 0">
                    <h4 class="api__unter">
                        {{ t("statistik.werFragt.drossel") }} <span class="api__wert">{{ kurz(drosselSumme) }}</span>
                    </h4>
                    <svg
                        class="api__verlauf"
                        :viewBox="`0 0 ${werFragt.tage.length} 20`"
                        preserveAspectRatio="none"
                        role="img"
                        :aria-label="`${t('statistik.werFragt.drossel')}, ${t('statistik.werFragt.verlaufLabel')}`"
                        data-testid="api-verlauf-drossel"
                    >
                        <rect
                            v-for="saeule in saeulen(werFragt.drossel)"
                            :key="saeule.x"
                            :x="saeule.x + 0.14"
                            width="0.72"
                            :y="20 - saeule.hoehe"
                            :height="saeule.hoehe"
                            class="is-schlecht"
                        >
                            <title>{{ kurzTag(saeule.tag) }}: {{ formatNumber(saeule.wert, 0) }}</title>
                        </rect>
                    </svg>
                    <div class="api__stundenWorte">
                        <span>{{ kurzTag(werFragt.tage[0]) }}</span
                        ><span v-if="werFragt.tage.length > 1">{{ kurzTag(werFragt.tage.at(-1)) }}</span>
                    </div>
                    <div v-for="eintrag in werFragt.drosselZonen" :key="eintrag.name" class="api__balken">
                        <span class="api__balkenName einzeilig">{{ eintrag.name }}</span>
                        <span class="api__spur"
                            ><i class="is-schlecht" :style="{ width: anteil(werFragt.drosselZonen, eintrag.wert) }"></i
                        ></span>
                        <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                    </div>
                    <div v-for="eintrag in werFragt.drosselAbsender" :key="eintrag.name" class="api__balken">
                        <span class="api__balkenName einzeilig" :title="eintrag.name">{{
                            drosselName(eintrag.name)
                        }}</span>
                        <span class="api__spur"
                            ><i
                                class="is-schlecht"
                                :style="{ width: anteil(werFragt.drosselAbsender, eintrag.wert) }"
                            ></i
                        ></span>
                        <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                    </div>
                    <p class="api__satz">{{ t("statistik.werFragt.drosselSatz") }}</p>
                </template>
            </section>

            <section v-if="zahlen.wege.length > 0" class="api__block">
                <h3 class="api__titel">{{ t("statistik.wege") }}</h3>
                <div v-for="eintrag in zahlen.wege" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig" :title="eintrag.name">{{ eintrag.name }}</span>
                    <span class="api__spur"><i :style="{ width: anteil(zahlen.wege, eintrag.wert) }"></i></span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>
            </section>

            <section v-if="zahlen.fehler.length > 0" class="api__block">
                <h3 class="api__titel">{{ t("statistik.fehlerListe") }}</h3>
                <div v-for="eintrag in zahlen.fehler" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig" :title="eintrag.name">
                        {{ fehlerTeile(eintrag.name).weg }}
                        <em class="api__grund">{{ fehlerTeile(eintrag.name).grund }}</em>
                    </span>
                    <span class="api__spur"
                        ><i class="is-schlecht" :style="{ width: anteil(zahlen.fehler, eintrag.wert) }"></i
                    ></span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>
            </section>

            <section v-if="browserFehler" class="api__block">
                <h3 class="api__titel">
                    {{ t("statistik.browserFehler") }}
                    <span class="api__wert">{{
                        t("statistik.browserFehlerFrist", { tage: CLIENT_FEHLER_GRENZEN.fristTage })
                    }}</span>
                </h3>
                <p v-if="browserFehler.arten.length === 0" class="api__satz">{{ t("statistik.browserFehlerKeine") }}</p>
                <div v-for="eintrag in browserFehler.arten" :key="eintrag.name" class="api__balken">
                    <span class="api__balkenName einzeilig">{{ artName(eintrag.name) }}</span>
                    <span class="api__spur"
                        ><i class="is-schlecht" :style="{ width: anteil(browserFehler.arten, eintrag.wert) }"></i
                    ></span>
                    <span class="api__balkenZahl">{{ kurz(eintrag.wert) }}</span>
                </div>
                <div
                    v-for="(diagnose, index) in browserFehler.diagnosen"
                    :key="index"
                    class="api__diagnose"
                    data-testid="browser-diagnose"
                >
                    <span class="api__diagnoseSatz">{{
                        diagnose.meldung === "" ? diagnose.name : `${diagnose.name}: ${diagnose.meldung}`
                    }}</span>
                    <span class="api__diagnoseSpur">{{ diagnoseSpur(diagnose) }}</span>
                </div>
            </section>

            <section class="api__block">
                <h3 class="api__titel">
                    {{ t("statistik.last") }} <span class="api__wert">{{ t("statistik.ortszeit") }}</span>
                </h3>
                <div class="api__stunden">
                    <span
                        v-for="(wert, stunde) in zahlen.stunden"
                        :key="stunde"
                        class="api__stunde"
                        :title="`${stunde} ${t('statistik.uhr')}: ${formatNumber(wert, 0)}`"
                        :style="{
                            background:
                                wert === 0
                                    ? 'var(--color-panel-active)'
                                    : `color-mix(in srgb, var(--color-chart1) ${Math.round(6 + (wert / stundenHoechst) * 88)}%, var(--color-panel-active))`,
                        }"
                    ></span>
                </div>
                <div class="api__stundenWorte">
                    <span>0</span><span>6</span><span>12</span><span>18</span><span>23</span>
                </div>
            </section>

            <p class="api__fuss">
                <b>{{ t("statistik.tafelMarke") }}</b>
                {{
                    t("statistik.tafelSatz", {
                        zeilen: formatNumber(zahlen.speicher.zeilen, 0),
                        mb: formatNumber(zahlen.speicher.bytes / 1024 / 1024, 1),
                    })
                }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.api {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.api__block {
    border-top: 1px solid var(--color-divider);
    padding-top: var(--space-8);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.api__titel {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    margin: 0;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--color-text-muted);
}

.api__wert,
.api__satz {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
    text-transform: none;
    letter-spacing: 0;
}

.api__satz {
    margin: 0;
}

.api__kacheln {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
}

.api__kachel {
    display: flex;
    flex-direction: column;
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-4) var(--space-6);
}

.api__kachelWort {
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.api__kachelZahl {
    font-size: var(--font-size-subhead);
    color: var(--color-text-strong);
}

.api__balken {
    display: grid;
    grid-template-columns: 118px 1fr 48px;
    align-items: center;
    gap: var(--space-4);
    font-size: var(--font-size-caption);
}

.api__balkenName {
    min-width: 0;
}

.api__grund {
    font-style: normal;
    color: var(--color-text-muted);
}

.api__spur {
    display: block;
    height: 9px;
    background: var(--color-panel-active);
    border-radius: 2px;
    overflow: hidden;
}

.api__spur i {
    display: block;
    height: 100%;
    background: var(--color-chart3);
}

/* Was nicht gut ging, trägt die Farbe der Fehlerlinie - dieselbe wie im Verlauf der Besucher. */
.api__spur i.is-schlecht {
    background: var(--color-chart2);
}

.api__balkenZahl {
    text-align: right;
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

/* Was von außen kommt, trägt die Farbe des Lastbands: so hebt es sich von der eigenen Seite ab. */
.api__spur i.is-aussen {
    background: var(--color-chart1);
}

.api__unter {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-6);
    margin: var(--space-4) 0 0;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    color: var(--color-text-strong);
}

.api__absender {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 48px;
    align-items: baseline;
    gap: var(--space-4);
    font-size: var(--font-size-caption);
}

.api__absenderTage {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.api__verlauf {
    display: block;
    width: 100%;
    height: 32px;
    border-bottom: 1px solid var(--color-divider);
}

.api__verlauf rect {
    fill: var(--color-chart3);
}

.api__verlauf rect.is-aussen {
    fill: var(--color-chart1);
}

.api__verlauf rect.is-schlecht {
    fill: var(--color-chart2);
}

.api__diagnose {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-caption);
    min-width: 0;
}

.api__diagnoseSatz {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.api__diagnoseSpur {
    color: var(--color-text-muted);
    overflow-wrap: anywhere;
}

.api__stunden {
    display: grid;
    grid-template-columns: repeat(24, 1fr);
    gap: 1px;
}

.api__stunde {
    height: 22px;
    border-radius: 1px;
}

.api__stundenWorte {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: var(--color-text-muted);
}

.api__fuss {
    margin: 0;
    padding: var(--space-6) var(--space-8);
    background: var(--color-panel-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.api__fuss b {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}
</style>
