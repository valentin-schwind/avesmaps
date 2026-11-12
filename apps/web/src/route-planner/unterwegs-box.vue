<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { LoreKind } from "@avesmaps3d/shared";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import { suchtreffer } from "../controls/avm-listenleiste";
import AvmText from "../controls/avm-text.vue";
import VorkommenPlakette from "../controls/vorkommen-plakette.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { t, tPlural } from "../i18n/i18n";
import { KATEGORIE_NAME, KATEGORIE_ZEICHEN } from "../search/vorkommen-ansicht";
import { formatNumber } from "./planner-model";
import { etappenText, unterwegsDeckel, unterwegsZahlen, type UnterwegsGruppe, type UnterwegsZeile } from "./unterwegs";

/**
 * „Vorkommen unterwegs“ (WI-0257 S4, neu mit S5 nach der Probierseite Fassung 3, Vali 2026-10-29 und 2026-10-30): eine Klappbox der Routendetails
 * (`AvmDisclosure`), zugeklappt mit EINER Zeile - je Art das Kategoriezeichen und die Zahl, gekürzt mit „…“. Ein Klick auf ein Zeichen öffnet die Box auf
 * dem Reiter dieser Art.
 *
 * Aufgeklappt, von oben nach unten:
 * - **Die Auswahl** als Kästchen, je gewähltem Eintrag „Name · Etappen 2 bis 6, 8 bis 80“ mit ✕; ab zwei davor „N gewählt“ und „alle entfernen“. Vor dem Namen
 *   seine Plakette in der Farbe, in der der Eintrag auf der Karte leuchtet (S5, `vorkommen-plakette.vue`). Der Name ist ein Link: Er öffnet die Infobox, und die
 *   Kamera fliegt hin (Vali 2026-10-30: „doch ein klick auf die auswahl bei den vorkommen unterwegs kann auch dahinfliegen, man sieht ja dann das ding auch in
 *   der infobox“; die Regel steht in `unterwegs-auswahl.ts`).
 * - **Die Reiterleiste des Hauses** (`FensterReiter`, klein): je Art Zeichen und Zahl, das Wort („Waren“, „Fauna“, „Flora“, „Spezies“) nur am offenen; eine Art ohne Eintrag hat keinen.
 * - **Die Suche** über die volle Breite (`AvmListenleiste`): in Name und Gegend des aktiven Reiters, die Trefferzahl steht im Reiter, Esc leert. Keine Sortierung.
 * - **Die Einträge** in der Schrift des Klappbox-Inhalts, nach Name: vorn der Kreis ○/●, der Name als Link, dahinter „ab Etappe N · Gegend“. Der Kreis oder
 *   ein Klick auf den Rest der Zeile legt den Eintrag in die Auswahl oder nimmt ihn heraus (MEHRFACHAUSWAHL); der Name öffnet die Infobox und ändert die
 *   Auswahl nicht. Nach zwölf folgt „… und N weitere“; ein gewählter bleibt sichtbar, auch wo er dahinter stünde.
 *
 * Die Auswahl gehört der App (`unterwegs-auswahl.ts`), hier wird sie nur gezeigt und gemeldet. 🔴 **Keine stille Kappung:** Die Zahl im Deckel und im Reiter
 * und die Liste stimmen immer überein.
 */
const props = defineProps<{
    gruppen: readonly UnterwegsGruppe[];
    /** Die gewählten Zeilen in der Reihenfolge der Wahl. */
    gewaehlt: readonly UnterwegsZeile[];
    /** Je gewähltem Eintrag sein Platz in der Farbtafel (`unterwegs-auswahl.ts`); ohne Angabe bleibt seine Plakette neutral. */
    farben?: ReadonlyMap<string, number> | undefined;
    /** Es wird gerade neu gerechnet: Die Auswahl ruht (wie jede andere Verknüpfung der Übersicht). */
    stale: boolean;
}>();
const emit = defineEmits<{
    /** Der Kreis oder die Zeile: den Eintrag in die Auswahl legen oder herausnehmen. */
    umschalten: [zeile: UnterwegsZeile];
    /** Das ✕ eines Kästchens. */
    entferne: [id: string];
    /** „alle entfernen“. */
    leere: [];
    /** Der Name in der Liste oder im Kästchen: die Infobox des Vorkommens öffnen (die Kamera fliegt hin), ohne die Auswahl zu ändern. */
    oeffne: [zeile: UnterwegsZeile];
}>();

/** So viele Einträge zeigt ein Reiter, bevor „… und N weitere“ kommt. */
const SICHTBAR = 12;

const offen = ref(false);
const reiter = ref<LoreKind | undefined>(undefined);
const suche = ref("");
/** Welche Reiter „… und N weitere“ aufgeklappt haben. */
const alle = ref(new Set<LoreKind>());

const deckelWorte = computed(() => unterwegsDeckel(props.gruppen));
const deckelZahlen = computed(() => unterwegsZahlen(props.gruppen));
const gewaehltIds = computed(() => new Set(props.gewaehlt.map((zeile) => zeile.id)));
/** Der Platz eines gewählten Eintrags in der Farbtafel; 0 ohne Farbe. */
const platzVon = (zeile: UnterwegsZeile): number => props.farben?.get(zeile.id) ?? 0;

/** Der aktive Reiter: der gewählte, solange es seine Art auf der Reise gibt, sonst der erste. */
const aktiv = computed<LoreKind | undefined>(() => {
    const arten = props.gruppen.map((gruppe) => gruppe.kind);
    return reiter.value !== undefined && arten.includes(reiter.value) ? reiter.value : arten[0];
});
const aktivModel = computed<LoreKind>({
    get: () => aktiv.value ?? "ware",
    set: (kind) => {
        reiter.value = kind;
    },
});

/** Die Zeilen einer Art, die die Suche trifft (in Name und Gegend). */
function treffer(gruppe: UnterwegsGruppe): readonly UnterwegsZeile[] {
    const text = suche.value.trim();
    return text === ""
        ? gruppe.zeilen
        : gruppe.zeilen.filter((zeile) => suchtreffer(`${zeile.name} ${zeile.gegend}`, text));
}

const reiterListe = computed(() =>
    props.gruppen.map((gruppe) => ({ id: gruppe.kind, name: t(KATEGORIE_NAME[gruppe.kind]) })),
);
const zahlen = computed(() => new Map(props.gruppen.map((gruppe) => [gruppe.kind, treffer(gruppe).length])));

const aktiveGruppe = computed(() => props.gruppen.find((gruppe) => gruppe.kind === aktiv.value));
const aktiveTreffer = computed(() => (aktiveGruppe.value === undefined ? [] : treffer(aktiveGruppe.value)));

/** Was der aktive Reiter zeigt: die ersten zwölf und jeden gewählten dahinter, aufgeklappt alle. */
const sichtbar = computed((): readonly UnterwegsZeile[] => {
    const liste = aktiveTreffer.value;
    if (aktiv.value === undefined || alle.value.has(aktiv.value) || liste.length <= SICHTBAR) return liste;
    const erste = liste.slice(0, SICHTBAR);
    return [...erste, ...liste.slice(SICHTBAR).filter((zeile) => gewaehltIds.value.has(zeile.id))];
});
const weitere = computed(() => aktiveTreffer.value.length - sichtbar.value.length);
const mehrKnopf = computed(() => aktiveTreffer.value.length > SICHTBAR);

// Eine neue Suche beginnt wieder mit den ersten zwölf.
watch(suche, () => {
    alle.value = new Set();
});

function umschaltenMehr(): void {
    const kind = aktiv.value;
    if (kind === undefined) return;
    const next = new Set(alle.value);
    if (!next.delete(kind)) next.add(kind);
    alle.value = next;
}

/** Ein Klick auf ein Zeichen im Deckel: die Box auf dem Reiter dieser Art öffnen (sie bleibt offen, wenn sie es schon ist). */
function zeigeArt(kind: LoreKind): void {
    reiter.value = kind;
    offen.value = true;
}

/** Ein Klick auf die Zeile außerhalb von Kreis und Name. */
function zeilenKlick(zeile: UnterwegsZeile): void {
    if (!props.stale) emit("umschalten", zeile);
}

const kreisName = (zeile: UnterwegsZeile): string =>
    gewaehltIds.value.has(zeile.id)
        ? t("planner.unterwegs.abwaehlen", { name: zeile.name })
        : t("planner.unterwegs.waehlen", { name: zeile.name });

const etappenSatz = (zeile: UnterwegsZeile): string =>
    tPlural("planner.unterwegs.gewaehlt", zeile.etappen.length, { etappen: etappenText(zeile.etappen) });

const platzhalter = computed(() => (aktiv.value === undefined ? "" : t(`planner.unterwegs.suche.${aktiv.value}`)));
</script>

<template>
    <AvmDisclosure
        v-model:open="offen"
        :label="t('planner.unterwegs.heading')"
        :secondary-title="deckelWorte"
        summary-one-line
        data-testid="route-unterwegs"
        toggle-testid="unterwegs-toggle"
    >
        <!--
            Der Deckel nennt je Art das Kategoriezeichen mit der Zahl, nicht die Wörter (Betreiber 2026-10-29, Antwortknopf: „Zeichen statt Wörter“): So bleibt er einzeilig.
            Die Wörter der Infobox stehen im `title` und als Name des Bildes für den Screenreader. Ein Klick auf ein Zeichen öffnet die Box auf seinem Reiter (S5); für die Tastatur
            tun es der Deckel und die Reiter, deshalb sind die Zeichen keine eigenen Knöpfe im Knopf des Deckels.
        -->
        <template #secondary>
            <span class="unterwegs__zahlen" role="img" :aria-label="deckelWorte" data-testid="unterwegs-zahlen">
                <span
                    v-for="eintrag in deckelZahlen"
                    :key="eintrag.kind"
                    class="unterwegs__zahl"
                    :data-kind="eintrag.kind"
                    data-testid="unterwegs-deckel-art"
                    @click.stop.prevent="zeigeArt(eintrag.kind)"
                    ><VorkommenPlakette
                        class="unterwegs__zahl-zeichen"
                        groesse="s"
                        :zeichen="KATEGORIE_ZEICHEN[eintrag.kind]" /><AvmText :text="eintrag.zahl" rolle="sekundaer"
                /></span>
            </span>
        </template>
        <div class="unterwegs">
            <div v-if="gewaehlt.length > 0" class="unterwegs__wahlen" data-testid="unterwegs-wahl">
                <div class="unterwegs__wahlen-kopf">
                    <span class="unterwegs__wahlen-titel"
                        >{{ t("vorkommen.sammel.titel")
                        }}<AvmText
                            v-if="gewaehlt.length >= 2"
                            :text="` (${formatNumber(gewaehlt.length, 0)})`"
                            rolle="sekundaer"
                    /></span>
                    <button
                        v-if="gewaehlt.length >= 2"
                        type="button"
                        class="unterwegs__linkknopf"
                        data-testid="unterwegs-alle-entfernen"
                        @click="emit('leere')"
                    >
                        {{ t("planner.unterwegs.alleEntfernen") }}
                    </button>
                </div>
                <p
                    v-for="zeile in gewaehlt"
                    :key="zeile.id"
                    class="unterwegs__kaestchen"
                    :data-eintrag="zeile.id"
                    data-testid="unterwegs-kaestchen"
                >
                    <span class="unterwegs__kaestchen-text"
                        ><VorkommenPlakette
                            class="unterwegs__kaestchen-zeichen"
                            groesse="s"
                            :zeichen="KATEGORIE_ZEICHEN[zeile.kind]"
                            :platz="platzVon(zeile)" /><button
                            type="button"
                            class="unterwegs__kaestchen-name"
                            :title="t('planner.unterwegs.oeffnen', { name: zeile.name })"
                            :disabled="stale"
                            data-testid="unterwegs-kaestchen-name"
                            @click="emit('oeffne', zeile)"
                        >
                            {{ zeile.name }}</button
                        ><AvmText :text="` · ${etappenSatz(zeile)}`" rolle="sekundaer"
                    /></span>
                    <button
                        type="button"
                        class="unterwegs__kaestchen-weg"
                        :aria-label="t('planner.unterwegs.entfernen', { name: zeile.name })"
                        :title="t('planner.unterwegs.beenden')"
                        data-testid="unterwegs-beenden"
                        @click="emit('entferne', zeile.id)"
                    >
                        <span aria-hidden="true">✕</span>
                    </button>
                </p>
            </div>

            <FensterReiter
                v-if="aktiv !== undefined"
                v-model="aktivModel"
                class="unterwegs__reiter"
                :reiter="reiterListe"
                :beschriftung="t('planner.unterwegs.reiter')"
                kennung="unterwegs"
                klein
            >
                <template #reiter="{ eintrag, aktiv: offen }">
                    <span class="unterwegs__reiter-inhalt" :title="offen ? undefined : eintrag.name"
                        ><VorkommenPlakette groesse="s" :zeichen="KATEGORIE_ZEICHEN[eintrag.id]" /><span
                            class="unterwegs__reiter-text avm-versalmitte"
                            ><span
                                class="unterwegs__reiter-wort"
                                :class="{ 'is-verdeckt': !offen }"
                                data-testid="unterwegs-reiter-wort"
                                >{{ eintrag.name }}{{ " " }}</span
                            ><span class="unterwegs__reiter-zahl" data-testid="unterwegs-reiter-zahl">{{
                                formatNumber(zahlen.get(eintrag.id) ?? 0, 0)
                            }}</span></span
                        ></span
                    >
                </template>
            </FensterReiter>

            <div
                v-if="aktiv !== undefined"
                :id="`unterwegs-inhalt-${aktiv}`"
                class="unterwegs__tafel"
                role="tabpanel"
                :aria-labelledby="`unterwegs-reiter-${aktiv}`"
            >
                <AvmListenleiste
                    v-model="suche"
                    :platzhalter="platzhalter"
                    :beschriftung="platzhalter"
                    testid="unterwegs-suche"
                />
                <ul v-if="sichtbar.length > 0" class="unterwegs__liste" :class="{ 'is-gesperrt': stale }">
                    <li
                        v-for="zeile in sichtbar"
                        :key="zeile.id"
                        class="unterwegs__zeile"
                        :class="{ 'is-gewaehlt': gewaehltIds.has(zeile.id) }"
                        data-testid="unterwegs-eintrag"
                        :data-eintrag="zeile.id"
                        :data-kind="zeile.kind"
                        @click="zeilenKlick(zeile)"
                    >
                        <button
                            type="button"
                            class="unterwegs__kreis"
                            :aria-pressed="gewaehltIds.has(zeile.id)"
                            :aria-label="kreisName(zeile)"
                            :disabled="stale"
                            data-testid="unterwegs-kreis"
                            @click.stop="emit('umschalten', zeile)"
                        >
                            <AvmKreis
                                :fuellung="gewaehltIds.has(zeile.id) ? 'voll' : 'leer'"
                                :name="kreisName(zeile)"
                            />
                        </button>
                        <span class="unterwegs__text"
                            ><button
                                type="button"
                                class="unterwegs__name"
                                :title="t('planner.unterwegs.oeffnen', { name: zeile.name })"
                                :disabled="stale"
                                data-testid="unterwegs-name"
                                @click.stop="emit('oeffne', zeile)"
                            >
                                {{ zeile.name }}</button
                            >{{ " "
                            }}<AvmText :text="t('planner.unterwegs.ab', { n: zeile.ab })" rolle="sekundaer" /><template
                                v-if="zeile.gegend !== ''"
                                ><AvmText text=" · " rolle="sekundaer" /><span
                                    class="unterwegs__gegend"
                                    data-testid="unterwegs-gegend"
                                    >{{ zeile.gegend }}</span
                                ></template
                            ></span
                        >
                    </li>
                </ul>
                <p v-else class="unterwegs__leer" data-testid="unterwegs-leer">{{ t("planner.unterwegs.leer") }}</p>
                <button
                    v-if="mehrKnopf"
                    type="button"
                    class="unterwegs__mehr"
                    :aria-expanded="aktiv !== undefined && alle.has(aktiv)"
                    data-testid="unterwegs-mehr"
                    @click="umschaltenMehr"
                >
                    {{
                        aktiv !== undefined && alle.has(aktiv)
                            ? t("planner.unterwegs.weniger")
                            : t("planner.unterwegs.mehr", { n: formatNumber(weitere, 0) })
                    }}
                </button>
            </div>
        </div>
    </AvmDisclosure>
</template>

<style scoped>
/*
 * Die Zeichen im Deckel (WI-0257 S4): je Art die Plakette mit ihrer Zahl, in einer Reihe, so eng, dass der Deckel einzeilig bleibt (die kleinste Plakette,
 * 2 px zur Zahl, 6 px zwischen den Arten). Der Deckel kürzt am Ende mit „…“ (Betreiber 2026-10-30, `summary-one-line`, `.einzeilig`): Dafür stehen Zeichen und
 * Zahlen inline statt im Flex-Kasten - die Auslassungspunkte setzt der Browser nur in einer Zeile aus Text und Inline-Kästen.
 * Seit S5 öffnet ein Klick auf ein Zeichen die Box auf seinem Reiter: Beim Zeigen trägt es die Lasur der Zeilen (§30.1).
 */
.unterwegs__zahlen {
    white-space: nowrap;
}

.unterwegs__zahl {
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.unterwegs__zahl + .unterwegs__zahl {
    margin-left: var(--space-4);
}

@media (hover: hover) {
    .unterwegs__zahl:hover {
        background: var(--color-hover-wash);
        box-shadow: 0 0 0 2px var(--color-hover-wash);
    }
}

.unterwegs__zahl:active {
    background: var(--color-active-wash);
}

/* Die Plakette steht inline (`inline-grid`), nicht als Block: Sonst bricht der Deckel nach jedem Zeichen um, statt am Ende mit „…“ zu kürzen. */
.unterwegs__zahl .unterwegs__zahl-zeichen {
    /*
     * 🔴 Die Plakette (18 px) zieht die Zeile des Deckels (16 px) nicht auf: Der Deckel bleibt 22 px hoch wie jede einzeilige Klappbox (`.avm-klappbox-kopf`, Betreiber 2026-10-07).
     * Seit der einen Plakette (c986efde7) stand er bei 24 px. Sie steht mittig in der Zeile und ragt je 1 px ins Polster; `.disclosure--einzeilig` lässt dafür Platz.
     */
    margin-block: calc((var(--icon-sm) - var(--icon-kachel)) / 2);
    margin-right: calc(var(--space-2) / 2);
    vertical-align: top;
}

.unterwegs {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

/*
 * Die Kästchen der Auswahl: das Gold der Karte in der Schrift der Box, nur Füllung und Kante (Probierseite Fassung 3, `.wahl`).
 * Dazu ein Rahmen mit der Überschrift „Ausgewählte Vorkommen“ (Betreiber 2026-10-30: „kannst du da einen rahmen drumrum machen und
 * ‚Ausgewählte Vorkommen‘ drüberschreiben?“), derselbe Name wie der Sammelscreen im Infopanel; ab zwei die Zahl und „alle entfernen“.
 */
.unterwegs__wahlen {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.unterwegs__wahlen-titel {
    color: var(--color-text-strong);
}

.unterwegs__wahlen-kopf {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    line-height: var(--leading-normal);
}

.unterwegs__linkknopf {
    margin: 0;
    padding: 0 var(--space-2);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.unterwegs__linkknopf:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.unterwegs__linkknopf:active {
    color: var(--color-link-hover);
}

.unterwegs__linkknopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.unterwegs__kaestchen {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
    line-height: var(--leading-normal);
}

.unterwegs__kaestchen-text {
    min-width: 0;
    overflow-wrap: anywhere;
    hyphens: manual;
}

.unterwegs__kaestchen-zeichen {
    margin-right: var(--space-4);
}

/* Der Name im Kästchen ist ein Link wie der Name in der Liste: Er öffnet die Infobox, die Kamera fliegt hin. In der Schrift des Kästchens, beim Zeigen unterstrichen. */
.unterwegs__kaestchen-name {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: inherit;
    transition: color 120ms ease;
}

.unterwegs__kaestchen-name:hover:not(:disabled),
.unterwegs__kaestchen-name:active:not(:disabled) {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.unterwegs__kaestchen-name:disabled {
    cursor: default;
}

.unterwegs__kaestchen-name:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.unterwegs__kaestchen :deep(.avm-text--sekundaer),
.unterwegs__kaestchen :deep(.avm-wert) {
    color: inherit;
}

.unterwegs__kaestchen-weg {
    display: grid;
    flex: none;
    align-self: center;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
    margin-block: calc(-1 * var(--space-2));
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    line-height: 1;
    transition: background-color 120ms ease;
}

.unterwegs__kaestchen-weg:hover {
    background: var(--color-hover-wash);
}

.unterwegs__kaestchen-weg:active {
    background: var(--color-active-wash);
}

.unterwegs__kaestchen-weg:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Die Reiter tragen das Zeichen der Infobox (14 px, 2 px zum Wort) vor Wort und Zahl (Vali 2026-10-30: „bei S5 fehlen die symbole aus der infobox“); Schrift,
 * Polster und Abstände der kleinen Leiste setzt `FensterReiter` (`klein`). Die Zahl hat Ziffern gleicher Breite, damit der Reiter beim Suchen nicht springt.
 *
 * Das Wort steht nur am offenen Reiter, die übrigen zeigen Zeichen und Zahl (Vali 2026-10-31: „nur beim aktiv ausgewählten den titel, inaktive bekommen
 * ihr symbol“). Das verdeckte Wort bleibt für Vorleser im Namen des Reiters und steht beim Zeigen im `title`. Die Hülle hat keine eigene Box, damit
 * Zeichen und Text Kinder des Reiters bleiben und dessen Abstand behalten.
 */
.unterwegs__reiter-inhalt {
    display: contents;
}

.unterwegs__reiter-wort.is-verdeckt {
    position: absolute;
    overflow: hidden;
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    white-space: nowrap;
}

.unterwegs__reiter-zahl {
    font-variant-numeric: tabular-nums;
}

.unterwegs__tafel {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

/* Die Liste in der Schrift des Klappbox-Inhalts und mit dem Zeilenabstand des Gebietsbaums darüber (Fassung 2). */
.unterwegs__liste {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    line-height: var(--leading-normal);
    list-style: none;
}

/* Gesperrt, solange neu gerechnet wird (§30.2: Deckkraft heißt „geht gerade nicht“). */
.unterwegs__liste.is-gesperrt {
    opacity: 0.55;
}

.unterwegs__zeile {
    display: grid;
    grid-template-columns: 19px minmax(0, 1fr);
    align-items: start;
    column-gap: 2px;
    padding: 1px var(--space-4) 1px 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.unterwegs__liste.is-gesperrt .unterwegs__zeile {
    cursor: default;
}

@media (hover: hover) {
    .unterwegs__liste:not(.is-gesperrt) .unterwegs__zeile:not(.is-gewaehlt):hover {
        background: var(--color-hover-wash);
    }

    /* Über dem Namen gilt der Name (ein Link), nicht die Zeile: Die Lasur der Zeile tritt zurück. */
    .unterwegs__liste:not(.is-gesperrt) .unterwegs__zeile:not(.is-gewaehlt):hover:has(.unterwegs__name:hover) {
        background: transparent;
    }
}

.unterwegs__zeile.is-gewaehlt {
    background: var(--color-active-wash);
}

/* Der Kreis sitzt mittig in der ersten Textzeile (`1lh`). */
.unterwegs__kreis {
    display: grid;
    place-items: center;
    height: 1lh;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    font: inherit;
}

.unterwegs__kreis:disabled {
    cursor: default;
}

.unterwegs__kreis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.unterwegs__kreis :deep(.avm-kreis) {
    transform: translateY(-1px);
}

.unterwegs__text {
    min-width: 0;
    overflow-wrap: anywhere;
    hyphens: manual;
}

/* Der Name ist ein Link: Gold, beim Zeigen unterstrichen; er öffnet die Infobox. */
.unterwegs__name {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: inherit;
    transition: color 120ms ease;
}

.unterwegs__name:hover:not(:disabled) {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.unterwegs__name:active:not(:disabled) {
    color: var(--color-link-hover);
}

.unterwegs__name:disabled {
    cursor: default;
}

.unterwegs__name:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.unterwegs__gegend {
    color: var(--color-text-muted);
}

.unterwegs__leer {
    margin: 0;
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

.unterwegs__mehr {
    align-self: flex-start;
    margin: 0;
    padding: var(--space-2) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.unterwegs__mehr:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.unterwegs__mehr:active {
    color: var(--color-link-hover);
}

.unterwegs__mehr:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .unterwegs__zahl,
    .unterwegs__linkknopf,
    .unterwegs__kaestchen-name,
    .unterwegs__kaestchen-weg,
    .unterwegs__zeile,
    .unterwegs__name,
    .unterwegs__mehr {
        transition: none;
    }
}
</style>
