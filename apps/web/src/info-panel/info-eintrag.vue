<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue";
import type { SearchEintrag, SearchLeuchtAnfrage, SubjectRef } from "@avesmaps3d/shared";
import VorkommenPlakette from "../controls/vorkommen-plakette.vue";
import { vorkommenFarbeCss } from "../search/vorkommen-farben";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { fetchEintrag, leuchtenUrl } from "../search/search-client";
import { SUCH_LEUCHTEN_ZUGANG } from "../search/such-leuchten-steuerung";
import { KATEGORIE_ZEICHEN } from "../search/vorkommen-ansicht";
import { UNTERWEGS_AUSWAHL } from "../route-planner/unterwegs-auswahl";
import {
    gegendTyp,
    hatWeitere,
    publikationenVon,
    restSatz,
    sichtbareZeilen,
    untertitelTeile,
    woGruppen,
    zeilenZahl,
    type WoGruppe,
    type WoGruppeId,
    type WoZeile,
} from "./eintrag-wo";
import { headerGraphicOf } from "./header-graphic";
import InfoFields from "./info-fields.vue";
import InfoHeader from "./info-header.vue";
import InfoSourceBox from "./info-source-box.vue";
import { wikiOfLine } from "./panel-header";
import type { HeaderModel } from "./panel-types";
import { safeHref } from "./source-model";
import { lizenzTeile, tafelZeilen } from "./vorkommen-sammel";

/**
 * Das Panel eines Eintrags (WI-0257 S3b, neu gebaut mit WI-0260 nach dem abgenommenen Entwurf, Fassung 2): Flora, Fauna, Ware oder Spezies in der Hülle des Infopanels.
 *
 * - **Kopf** wie jede Infobox (`info-header.vue`): oben das Typbild der Kategorie 16:9, tauschbar über die Medienverwaltung („Typbild“), darunter links das Zeichen der Art in einem neutralen Feld, rechts Name und
 *   Untertitel („Ware · Hartwurst · profan“, sonst „Fauna · Niederer Drache“).
 * - **Feldtafel** direkt unter dem Kopf (WI-0257 S5, Vali 2026-10-30): „Beschreibung“ mit dem ersten Satz der Kurzbeschreibung („der erste satz reicht“), Lebensraum, weitere Namen
 *   und der Kontinent, wo er nicht Aventurien ist; darunter leise und sichtbar die Herkunft des Textes samt Lizenz (die Wiki Aventurica verlangt sie an jeder Kopie, CC BY-SA 3.0).
 *   Weiter unten stehen diese Felder nicht noch einmal.
 * - **Rückweg:** Hat die Auswahl von „Vorkommen unterwegs“ diese Infobox geöffnet und sind zwei oder mehr gewählt, steht zwischen Bild und Titel „‹ Ausgewählte Vorkommen (N)“ und führt
 *   zum Sammelscreen zurück (`unterwegs-auswahl.ts`).
 * - **„Wo es vorkommt“:** „Alle zeigen“, dann die Gegenden, danach die Orte (bei Waren „Herkunft“, „Verbreitung“, „Orte“), je Gruppe acht Zeilen und „Weitere anzeigen“ bis vierzig. 🔴 Keine Zahlen, keine Pillen,
 *   kein Gelb: Die Auswahl steht in der Farbe der Auswahlliste mit ●. Ein Klick auf eine Gegend lässt sie leuchten und fliegt hin (`zugang.waehle`, wie die Pillen es taten); ein Ort öffnet wie jeder Objektlink.
 *   Am Telefon klappt das Panel nach dem Klick ein (`app.vue`), die Pille „Eintrag öffnen“ holt es zurück.
 * - Der **Quellenkasten** mit der Wikizeile und den Publikationen.
 *
 * 🔴 **Alles kommt aus EINER Antwort** (`GET /api/search/eintrag`): Was dort fehlt, steht hier nicht (kein leeres Feld, keine erfundene Zeile). Wo der Eintrag nur „Aventurien“ nennt und keine Regel hat, leuchtet
 * nichts gefüllt: Der Kontinent erscheint als Umriss, und das Panel sagt es („Überall in Aventurien“).
 *
 * Kein Knopf „Nächstes Vorkommen“ und kein Sammelkorb: beides ist pausiert (WI-0257 §2).
 */
const props = defineProps<{ id: string; title: string | undefined }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();

type Stand = "loading" | "ready" | "missing" | "error";
const stand = ref<Stand>("loading");
const eintrag = shallowRef<SearchEintrag | undefined>(undefined);
/** Kam die Antwort nach einer sichtbaren Wartezeit? Dann blenden Bild und Untertitel des Kopfes ein (`info-header.vue`); der Name steht schon da. */
const kamNachWarten = ref(false);
const zugang = inject(SUCH_LEUCHTEN_ZUGANG, undefined);
const auswahl = inject(UNTERWEGS_AUSWAHL, undefined);
/** Der Rückweg zum Sammelscreen: die Zahl der gewählten, wo es ihn gibt. */
const rueckweg = computed(() => auswahl?.rueckweg(props.id));
/** Ist der Eintrag in „Vorkommen unterwegs“ gewählt, sein Platz in der Farbtafel (der Punkt am Zeichen, WI-0257 S5); sonst 0. */
const farbPlatz = computed(() => auswahl?.farben.value.get(props.id) ?? 0);
/**
 * Hat „Vorkommen unterwegs“ den Eintrag gewählt und kennt seine Gegenden an der Route, listet „Wo es vorkommt“ nur sie (Vali 2026-10-31: „nur die gegenden anzeigen (also auch
 * mehrfachauswahl zulassen), die von der route durchkreuzt werden … und in der farbe lassen“). Ein Klick wählt eine Gegend an oder ab, „Alle an der Route“ nimmt die Wahl zurück;
 * das Leuchten bleibt das der Auswahl, in der Farbe des Zeichens, und die Auswahl endet dabei nicht. Die Marke ● trägt dieselbe Farbe.
 */
const anDerRoute = computed(() => (farbPlatz.value > 0 ? auswahl?.anDerRoute.value.get(props.id) : undefined));
const farbe = computed(() => (farbPlatz.value > 0 ? vorkommenFarbeCss(farbPlatz.value) : undefined));
const alleAnDerRoute = computed(() => anDerRoute.value?.gewaehlt.size === 0);
const routenZeilen = computed(() =>
    (anDerRoute.value?.gegenden ?? []).map((gegend) => ({
        key: gegend.key,
        name: gegend.name,
        typ: gegendTyp(gegend),
        gewaehlt: anDerRoute.value?.gewaehlt.has(gegend.key) === true,
    })),
);

let frage: AbortController | undefined;

async function lade(): Promise<void> {
    frage?.abort();
    const eigene = new AbortController();
    frage = eigene;
    stand.value = "loading";
    eintrag.value = undefined;
    kamNachWarten.value = false;
    offen.value = {};
    try {
        const antwort = await fetchEintrag(props.id, eigene.signal);
        if (eigene.signal.aborted) return;
        eintrag.value = antwort ?? undefined;
        stand.value = antwort === null ? "missing" : "ready";
        kamNachWarten.value = antwort !== null;
    } catch (fehler) {
        if (eigene.signal.aborted) return;
        console.error("Eintrag nicht geladen", fehler);
        stand.value = "error";
    }
}

/** Welche Gruppen „Weitere anzeigen“ aufgeklappt haben. */
const offen = ref<Partial<Record<WoGruppeId, boolean>>>({});

watch(
    () => props.id,
    () => void lade(),
    { immediate: true },
);
onBeforeUnmount(() => frage?.abort());

/** Aus dem Sammelscreen geöffnet, beginnt die Infobox oben (wie der Sammelscreen selbst). */
const wurzel = useTemplateRef<HTMLElement>("wurzel");
onMounted(() => {
    const rollbereich = rueckweg.value === undefined ? null : wurzel.value?.closest(".info-panel__body");
    if (rollbereich) rollbereich.scrollTop = 0;
});

const name = computed(() => eintrag.value?.name ?? props.title ?? "");

/** Der Kopf: das Typbild der Kategorie (über `typbildVon`, auch über die Medienverwaltung tauschbar), Name und Untertitel; solange die Antwort fehlt, nur der Name auf dem Platzhaltergrund. */
const kopf = computed<HeaderModel>(() => {
    const e = eintrag.value;
    return {
        title: name.value,
        subtitle: e === undefined ? [] : untertitelTeile(e).map((text) => ({ parts: [{ text }] })),
        images: [],
        ...(e === undefined ? {} : { graphic: headerGraphicOf("loreEntry", e.kind) }),
    };
});

const wiki = computed(() => wikiOfLine(eintrag.value?.wiki, undefined));
const publikationen = computed(() => (eintrag.value === undefined ? undefined : publikationenVon(eintrag.value)));

/** Hat das Wiki eine Kurzbeschreibung? Ohne sie (oder ohne Lizenz-Freigabe, die der Server prüft) steht keine Beschreibung da und auch keine Lizenzzeile. */
const kurz = computed(() => (eintrag.value?.kurzbeschreibung ?? "").trim() !== "");
/** Die Lizenzzeile (`vorkommen-sammel.ts`): „Text: Wiki Aventurica (Autoren) · CC BY-SA 3.0“, mit Links auf Artikel, Autoren und Lizenz. */
const lizenz = computed(() => (eintrag.value === undefined ? [] : lizenzTeile(eintrag.value)));
/**
 * Die Unterseite „Liste“ des Artikels im Wiki (WI-0299, OPS-000104; Vorschlag eines Editors): Varianten und Einzelexemplare, etwa Langschwert/Liste. Der Server nennt sie nur, wo der WikiSync sie im Dump
 * gefunden hat; ohne sie steht keine Zeile da, nie ein toter Link.
 */
const liste = computed(() => safeHref(eintrag.value?.liste));

const gruppen = computed(() => {
    const e = eintrag.value;
    return e === undefined ? [] : woGruppen(e.kind, e.wo);
});
/** Leuchtet etwas für den Eintrag? Die Liste kann kürzer sein als das Leuchten (eine Gegend ohne Namen steht nicht darin), „Alle zeigen“ gibt es trotzdem. */
const leuchtetEtwas = computed(() => {
    const e = eintrag.value;
    return e !== undefined && (e.gegenden > 0 || e.orte > 0 || zeilenZahl(e.wo) > 0);
});
/** Nennt der Eintrag nur „Aventurien“, ist der Kontinent sein einziges Ziel: Das sagt der Satz „Überall in Aventurien“, kein Eintrag der Liste. */
const ueberall = computed(() => eintrag.value?.nurKontinent === true && !leuchtetEtwas.value);
const auchGenannt = computed(() => eintrag.value?.wo.auchGenannt ?? []);

/** Die Feldtafel unter dem Kopf: Beschreibung (erster Satz), Lebensraum, weitere Namen, Kontinent. */
const zeilen = computed(() => (eintrag.value === undefined ? [] : tafelZeilen(eintrag.value)));

const aktiv = computed(() => zugang?.aktiv.value);
/** Leuchtet gerade diese Anfrage? Dann steht ihre Zeile in der Farbe der Auswahl. */
const leuchtet = (anfrage: SearchLeuchtAnfrage): boolean =>
    aktiv.value !== undefined && aktiv.value === leuchtenUrl(anfrage);
const alleGewaehlt = computed(() => eintrag.value !== undefined && leuchtet(eintrag.value.leuchten));
const gewaehlt = (zeile: WoZeile): boolean => zeile.art === "gegend" && leuchtet(zeile.gegend.ziel);

/** Eine Anfrage leuchten lassen und hinfliegen; ein zweiter Klick auf die gewählte Zeile nimmt das Leuchten zurück. */
function schalte(anfrage: SearchLeuchtAnfrage): void {
    if (zugang === undefined) return;
    if (leuchtet(anfrage)) zugang.beende();
    else zugang.waehle(anfrage);
}

function waehle(zeile: WoZeile): void {
    if (zeile.art === "ort") emit("open", zeile.ort.ref);
    else schalte(zeile.gegend.ziel);
}

/** Der Satz unter einer Gruppe, deren Liste nicht alles nennt: wie viele Gegenden leuchten, ohne dazustehen („Alle zeigen“ zeigt sie). */
function restText(gruppe: WoGruppe): string | undefined {
    const rest = restSatz(gruppe.zeilen, offen.value[gruppe.id] === true, gruppe.weitere);
    if (rest === undefined) return undefined;
    return rest.key === "eintrag.rest.orte" ? t(rest.key) : tPlural(rest.key, rest.n, { n: formatNumber(rest.n, 0) });
}

const zeigeMehr = (id: WoGruppeId): void => {
    offen.value = { ...offen.value, [id]: offen.value[id] !== true };
};
</script>

<template>
    <div ref="wurzel" class="info-eintrag" data-testid="info-eintrag" :data-status="stand">
        <InfoHeader :model="kopf" :arriving="kamNachWarten">
            <template #vor-titel>
                <button
                    v-if="rueckweg !== undefined"
                    type="button"
                    class="info-eintrag__zurueck"
                    data-testid="info-eintrag-zurueck"
                    @click="auswahl?.zurueck()"
                >
                    <span aria-hidden="true">‹ </span>{{ t("vorkommen.sammel.titel") }}
                    <span class="info-eintrag__zurueck-n">({{ formatNumber(rueckweg, 0) }})</span>
                </button>
            </template>
            <template #zeichen>
                <!-- Solange die Art unbekannt ist, hält eine leere Plakette die Stelle: Der Name springt nicht, wenn das Zeichen kommt. -->
                <VorkommenPlakette
                    class="info-eintrag__zeichen"
                    groesse="l"
                    :zeichen="eintrag === undefined ? undefined : KATEGORIE_ZEICHEN[eintrag.kind]"
                    :platz="farbPlatz"
                    :data-kind="eintrag?.kind"
                    :data-testid="eintrag === undefined ? undefined : 'info-eintrag-zeichen'"
                />
            </template>
        </InfoHeader>

        <p v-if="stand === 'loading'" class="info-eintrag__hinweis" data-testid="info-loading">
            {{ t("infoPanel.loading") }}
        </p>
        <p v-else-if="stand === 'missing'" class="info-eintrag__hinweis" data-testid="info-missing">
            {{ t("infoPanel.missing") }}
        </p>
        <div v-else-if="stand === 'error'" class="info-eintrag__hinweis">
            <p class="info-eintrag__fehler" data-testid="info-error">{{ t("infoPanel.error") }}</p>
            <button type="button" class="info-eintrag__nochmal" data-testid="info-retry" @click="lade()">
                {{ t("infoPanel.retry") }}
            </button>
        </div>

        <template v-if="stand === 'ready' && eintrag !== undefined">
            <section
                v-if="zeilen.length > 0 || liste !== undefined"
                class="info-eintrag__kurz"
                data-testid="info-eintrag-kurz"
            >
                <InfoFields v-if="zeilen.length > 0" :rows="zeilen" embedded />
                <p v-if="liste !== undefined" class="info-eintrag__unterseite">
                    <a :href="liste" target="_blank" rel="noopener noreferrer" data-testid="info-eintrag-liste-wiki">{{
                        t("eintrag.liste")
                    }}</a>
                </p>
                <p v-if="kurz" class="info-eintrag__lizenz" data-testid="info-eintrag-lizenz">
                    <template v-for="(teil, stelle) in lizenz" :key="stelle"
                        ><a
                            v-if="teil.href !== undefined"
                            :href="teil.href"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ teil.text }}</a
                        ><template v-else>{{ teil.text }}</template></template
                    >
                </p>
            </section>

            <section class="info-eintrag__wo" data-testid="info-eintrag-wo">
                <h3 class="info-eintrag__frage">{{ t("eintrag.wo.titel") }}</h3>
                <template v-if="anDerRoute !== undefined">
                    <ul class="info-eintrag__liste info-eintrag__liste--alle">
                        <li>
                            <button
                                type="button"
                                class="info-eintrag__row"
                                :class="{ 'is-markiert': alleAnDerRoute }"
                                :aria-pressed="alleAnDerRoute"
                                data-testid="info-eintrag-alle-route"
                                @click="auswahl?.alleAnDerRoute(id)"
                            >
                                <span class="info-eintrag__marke" :style="{ color: farbe }" aria-hidden="true">{{
                                    alleAnDerRoute ? "●" : ""
                                }}</span>
                                <span class="info-eintrag__row-name">{{ t("eintrag.zeigeAlleRoute") }}</span>
                                <span></span>
                            </button>
                        </li>
                    </ul>
                    <template v-if="routenZeilen.length > 0">
                        <h4 class="info-eintrag__gruppe" data-testid="info-eintrag-gruppe" data-gruppe="route">
                            {{ t("eintrag.gruppe.route") }}
                        </h4>
                        <ul class="info-eintrag__liste" data-testid="info-eintrag-liste">
                            <li v-for="zeile in routenZeilen" :key="zeile.key">
                                <button
                                    type="button"
                                    class="info-eintrag__row"
                                    :class="{ 'is-markiert': zeile.gewaehlt }"
                                    :aria-pressed="zeile.gewaehlt"
                                    data-art="gegend"
                                    data-testid="info-eintrag-zeile"
                                    @click="auswahl?.schalteGegend(id, zeile.key)"
                                >
                                    <span class="info-eintrag__marke" :style="{ color: farbe }" aria-hidden="true">{{
                                        zeile.gewaehlt ? "●" : ""
                                    }}</span>
                                    <span class="info-eintrag__row-name">{{ zeile.name }}</span>
                                    <span class="info-eintrag__row-typ einzeilig">{{ zeile.typ }}</span>
                                </button>
                            </li>
                        </ul>
                    </template>
                </template>
                <p v-else-if="ueberall" class="info-eintrag__ueberall" data-testid="info-eintrag-ueberall">
                    <svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="10" /></svg>
                    <span>
                        {{ t("eintrag.ueberall") }}
                        <small>{{ t("eintrag.ueberall.hinweis") }}</small>
                    </span>
                </p>
                <p v-else-if="!leuchtetEtwas" class="info-eintrag__zeile" data-testid="info-eintrag-kein-ort">
                    {{ t("eintrag.keinOrt") }}
                </p>
                <template v-else>
                    <ul class="info-eintrag__liste info-eintrag__liste--alle">
                        <li>
                            <button
                                type="button"
                                class="info-eintrag__row"
                                :class="{ 'is-markiert': alleGewaehlt }"
                                :aria-pressed="alleGewaehlt"
                                data-testid="info-eintrag-alle"
                                @click="schalte(eintrag.leuchten)"
                            >
                                <span class="info-eintrag__marke" aria-hidden="true">{{
                                    alleGewaehlt ? "●" : ""
                                }}</span>
                                <span class="info-eintrag__row-name">{{ t("eintrag.zeigeAlle") }}</span>
                                <span></span>
                            </button>
                        </li>
                    </ul>
                    <template v-for="gruppe in gruppen" :key="gruppe.id">
                        <h4 class="info-eintrag__gruppe" data-testid="info-eintrag-gruppe" :data-gruppe="gruppe.id">
                            {{ t(gruppe.titel) }}
                        </h4>
                        <ul class="info-eintrag__liste" data-testid="info-eintrag-liste">
                            <li
                                v-for="zeile in sichtbareZeilen(gruppe.zeilen, offen[gruppe.id] === true)"
                                :key="zeile.key"
                            >
                                <button
                                    type="button"
                                    class="info-eintrag__row"
                                    :class="{ 'is-markiert': gewaehlt(zeile) }"
                                    :aria-pressed="zeile.art === 'gegend' ? gewaehlt(zeile) : undefined"
                                    :data-art="zeile.art"
                                    data-testid="info-eintrag-zeile"
                                    @click="waehle(zeile)"
                                >
                                    <span class="info-eintrag__marke" aria-hidden="true">{{
                                        gewaehlt(zeile) ? "●" : ""
                                    }}</span>
                                    <span class="info-eintrag__row-name">{{ zeile.name }}</span>
                                    <span class="info-eintrag__row-typ einzeilig">{{ zeile.typ }}</span>
                                </button>
                            </li>
                        </ul>
                        <button
                            v-if="hatWeitere(gruppe.zeilen)"
                            type="button"
                            class="info-eintrag__mehr"
                            :aria-expanded="offen[gruppe.id] === true"
                            data-testid="info-eintrag-mehr"
                            @click="zeigeMehr(gruppe.id)"
                        >
                            {{ t(offen[gruppe.id] === true ? "eintrag.weniger" : "eintrag.mehr") }}
                        </button>
                        <p
                            v-if="restText(gruppe) !== undefined"
                            class="info-eintrag__rest"
                            data-testid="info-eintrag-rest"
                        >
                            {{ restText(gruppe) }}
                        </p>
                    </template>
                </template>
                <p
                    v-if="anDerRoute === undefined && auchGenannt.length > 0"
                    class="info-eintrag__auch"
                    data-testid="info-eintrag-auch"
                >
                    <span>{{ t("eintrag.auchGenannt") }}</span> {{ auchGenannt.join(", ") }}
                </p>
            </section>

            <InfoSourceBox :key="eintrag.id" :wiki="wiki" :entries="publikationen" />
        </template>
    </div>
</template>

<style scoped>
.info-eintrag {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-bottom: var(--space-16);
}

/*
 * Das Zeichen der Art im Kopf, links vom Titel: die Plakette der Vorkommen (`vorkommen-plakette.vue`), neutral (Betreiber 2026-10-30: „das grün im icon … in einer
 * unserer neutralen farben“), nur so hoch wie Titel und Untertitel zusammen. Ein gewählter Eintrag trägt sie in seiner Farbe auf der Karte (WI-0257 S5; „nicht
 * icon + farben sondern farbiges icon“): Nach dem Flug aus dem Sammelscreen sieht man so, in welcher Farbe er leuchtet.
 */
.info-eintrag__zeichen {
    margin-right: var(--space-10);
}

.info-eintrag__hinweis {
    margin: 0;
    padding: var(--space-6) var(--info-pad-x);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

.info-eintrag__fehler {
    margin: 0;
}

.info-eintrag__nochmal {
    margin-top: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.info-eintrag__nochmal:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-eintrag__nochmal:active {
    background: var(--color-button-soft-active);
}

.info-eintrag__nochmal:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Der Rückweg zum Sammelscreen (WI-0257 S5): eine Zeile zwischen Bild und Titel, ein leiser Link in der Farbe des Hauses, die Zahl gedämpft.
 */
.info-eintrag__zurueck {
    display: block;
    margin: var(--space-8) var(--info-pad-x) 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    transition: color 120ms ease;
}

.info-eintrag__zurueck:hover,
.info-eintrag__zurueck:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-eintrag__zurueck:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-eintrag__zurueck-n {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

/* Die Feldtafel steht gleich unter dem Kopf; die Herkunft des Textes darunter leise, aber sichtbar (die Lizenz verlangt die Nennung an jeder Kopie). */
.info-eintrag__kurz {
    padding: 0 var(--info-pad-x) var(--space-8);
}

/*
 * Die Unterseite „Liste“ im Wiki (WI-0299): ein Verweis nach draußen in der Farbe der Links, das ↗ aus der Hausregel (`a[target="_blank"]::after`, `styles/canon.css`). Mindestliste §30.5: Ruhe ohne
 * Unterstrich, Hover und Aktiv in der Hover-Farbe mit Unterstrich, Fokus mit dem Ring, Übergang 120 ms auf die Farbe. Gesperrt gibt es nicht: Ohne Unterseite steht die Zeile nicht da.
 */
.info-eintrag__unterseite {
    margin: var(--space-6) 0 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.info-eintrag__unterseite a {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: none;
    transition: color 120ms ease;
}

.info-eintrag__unterseite a:hover,
.info-eintrag__unterseite a:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-eintrag__unterseite a:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-eintrag__lizenz {
    margin: var(--space-6) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

.info-eintrag__lizenz a {
    color: var(--color-link);
    text-decoration: none;
}

.info-eintrag__lizenz a:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-eintrag__lizenz a:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-eintrag__wo {
    padding: var(--space-8) var(--info-pad-x) var(--space-12);
    border-top: 1px solid var(--color-divider);
}

.info-eintrag__frage {
    margin: var(--space-4) 0 var(--space-6);
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: normal;
}

.info-eintrag__gruppe {
    display: flex;
    align-items: baseline;
    margin: var(--space-8) 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Die Liste ist ein Kasten wie die Auswahlliste „Hier liegen N Flächen“: Fläche `panel-soft`, 1 px Rand, die Zeilen darin. */
.info-eintrag__liste {
    margin: 0;
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.info-eintrag__liste--alle {
    margin-bottom: var(--space-2);
}

/* Eine Zeile wie in der Auswahlliste (`area-choice-menu.vue`): Marke, Name, Art. Gewählt = Schrift in der Farbe der Auswahl, davor ●. */
.info-eintrag__row {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-2) var(--space-8);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: left;
    transition: background-color 120ms ease;
}

.info-eintrag__row:hover {
    background: var(--color-hover-wash);
}

.info-eintrag__row:active {
    background: var(--color-active-wash);
}

.info-eintrag__row:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-eintrag__marke {
    color: var(--color-list-selection-text);
    font-size: var(--font-size-caption);
}

.info-eintrag__row-name {
    min-width: 0;
    color: var(--color-text-strong);
    hyphens: auto;
    overflow-wrap: anywhere;
}

.info-eintrag__row-typ {
    max-width: 11em;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: right;
}

.info-eintrag__row.is-markiert .info-eintrag__row-name,
.info-eintrag__row.is-markiert .info-eintrag__row-typ {
    color: var(--color-list-selection-text);
}

.info-eintrag__mehr {
    align-self: flex-start;
    margin-top: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition: color 120ms ease;
}

.info-eintrag__mehr:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-eintrag__mehr:active {
    color: var(--color-link-hover);
}

.info-eintrag__mehr:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Die Sätze trennen nicht von selbst („Gegen-den“ liest sich wie ein Fehler); der Kanon trennt sonst überall (`hyphens: auto`). */
.info-eintrag__rest,
.info-eintrag__zeile {
    margin: var(--space-4) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    hyphens: manual;
    line-height: var(--leading-normal);
}

.info-eintrag__zeile {
    margin-top: var(--space-8);
}

.info-eintrag__zeile::first-letter {
    text-transform: uppercase;
}

/* Die Namen trennen nicht von selbst: „Silberbach-tal“ läse sich wie ein anderer Name. */
.info-eintrag__auch {
    margin: var(--space-8) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    hyphens: manual;
    line-height: var(--leading-normal);
    overflow-wrap: anywhere;
}

.info-eintrag__auch span {
    color: var(--color-text);
}

.info-eintrag__ueberall {
    display: flex;
    align-items: center;
    gap: var(--space-10);
    margin: var(--space-2) 0 0;
    padding: var(--space-8) var(--space-10);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
    color: var(--color-text);
}

.info-eintrag__ueberall svg {
    flex: none;
    width: var(--icon-lg);
    height: var(--icon-lg);
    fill: none;
    stroke: var(--color-text-muted);
    stroke-width: 1.6;
    stroke-dasharray: 3 2.5;
}

.info-eintrag__ueberall small {
    display: block;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    hyphens: manual;
}

@media (prefers-reduced-motion: reduce) {
    .info-eintrag__row,
    .info-eintrag__mehr,
    .info-eintrag__nochmal,
    .info-eintrag__zurueck,
    .info-eintrag__unterseite a {
        transition: none;
    }
}
</style>
