<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, shallowRef, useId, useTemplateRef, watch } from "vue";
import type { SearchEintrag } from "@avesmaps3d/shared";
import AvmText from "../controls/avm-text.vue";
import VorkommenPlakette from "../controls/vorkommen-plakette.vue";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import { etappenText, type UnterwegsZeile } from "../route-planner/unterwegs";
import { UNTERWEGS_AUSWAHL } from "../route-planner/unterwegs-auswahl";
import { fetchEintrag } from "../search/search-client";
import { KATEGORIE_NAME, KATEGORIE_ZEICHEN } from "../search/vorkommen-ansicht";
import { untertitelTeile } from "./eintrag-wo";
import InfoFields from "./info-fields.vue";
import InfoHeader from "./info-header.vue";
import type { HeaderModel, RowModel } from "./panel-types";
import { beschreibungVon, entlangDerRoute, gegendenKurz, kurzzeile, lizenzTeile } from "./vorkommen-sammel";

/**
 * Der Sammelscreen „Ausgewählte Vorkommen“ (WI-0257 S5). Das Infopanel zeigt ihn, solange in „Vorkommen unterwegs“ zwei oder mehr Einträge gewählt sind (`app.vue`,
 * `unterwegs-auswahl.ts`). Gestalt nach der Probierseite, Fassung 2 (Vali 2026-10-30: „kompakt, mit typbild, entlang der route“, dann „das passt doch jetzt so“).
 *
 * - **Kopf** wie jede Infobox (`info-header.vue`): das Typbild „Vorkommen“, das Zeichen `vorkommen` im neutralen Feld, „Ausgewählte Vorkommen“ und „Unterwegs · Start bis
 *   Ziel“; ohne gemeldete Reise „Unterwegs · N gewählt“.
 * - **Leiste:** „**N** gewählt“ links, „alle entfernen“ rechts.
 * - **Je Vorkommen eine Zeile wie ein Deckel** (Guide §16.3: Zugeklapptes zeigt seine Zusammenfassung), **entlang der Route** geordnet: die Kachel in der Farbe, in der
 *   es auf der Karte leuchtet (getönt, Kante und Zeichen in der Farbe, je Thema zur Schrift gemischt, damit auch die dunklen Plätze der Tafel im dunklen Thema lesbar
 *   bleiben), der Name mit › als Weg in die Infobox, darunter die Kurzzeile „ab Etappe N · M von K Etappen“; rechts der Winkel zum Aufklappen und ✕.
 * - **Aufgeklappt:** der erste Satz der Beschreibung über die volle Breite, darunter Art, alle Etappen und Gegenden.
 * - Die **Lizenzzeile** der Wiki-Texte steht EINMAL unter der Liste.
 *
 * 🪤 Die Gegenden bleiben Text: Ein Link auf eine Gegend ließe ein fremdes Leuchten oder Subject beginnen, und damit endete die ganze Wahl (`unterwegs-auswahl.ts`,
 * „Die Wahl folgt dem Leuchten“).
 *
 * Die Einträge kommen je Kennung aus derselben Antwort wie ihre Infobox (`GET /api/search/eintrag`, im Browser über ETag gecacht), die Etappen aus „Vorkommen unterwegs“.
 * Was noch lädt, steht schon mit Name und Kurzzeile da; was fehlt, fehlt (kein erfundenes Feld).
 */
const props = defineProps<{
    zeilen: readonly UnterwegsZeile[];
    /** Je gewähltem Eintrag sein Platz in der Farbtafel (`unterwegs-auswahl.ts`); ohne Angabe ohne Farbe. */
    farben?: ReadonlyMap<string, number> | undefined;
}>();
const emit = defineEmits<{
    /** Der Name: die Infobox des Eintrags. */
    oeffne: [zeile: UnterwegsZeile];
    /** ✕: den Eintrag aus der Auswahl nehmen. */
    entferne: [id: string];
    /** „alle entfernen“. */
    leere: [];
}>();

/** Die Reise der Wahl, wie der Planer sie meldet (`route-overview.vue`); ohne Planer (ein Bauteiltest) keine. */
const reise = inject(UNTERWEGS_AUSWAHL, undefined)?.reise;

/** Die geladenen Einträge je Kennung; `null`: gibt es nicht (mehr). Sie bleiben, solange der Sammelscreen steht: Ein ✕ lädt die anderen nicht neu. */
const eintraege = shallowRef<ReadonlyMap<string, SearchEintrag | null>>(new Map());
let frage: AbortController | undefined;

async function lade(ids: readonly string[]): Promise<void> {
    const fehlend = ids.filter((id) => !eintraege.value.has(id));
    if (fehlend.length === 0) return;
    frage?.abort();
    const eigene = new AbortController();
    frage = eigene;
    // Nacheinander: Die Route rechnet je Prozess nur wenige Abfragen zugleich (503 `busy`); jede Antwort steht, sobald sie da ist.
    for (const id of fehlend) {
        try {
            const antwort = await fetchEintrag(id, eigene.signal);
            if (eigene.signal.aborted) return;
            eintraege.value = new Map(eintraege.value).set(id, antwort);
        } catch (fehler) {
            if (eigene.signal.aborted) return;
            // Sichtbar, nicht verschluckt (Kap. 2.16): Die Zeile bleibt mit Name und Kurzzeile stehen.
            console.error("Eintrag nicht geladen", fehler);
        }
    }
}

watch(
    () => props.zeilen.map((zeile) => zeile.id),
    (ids) => void lade(ids),
    { immediate: true },
);
onBeforeUnmount(() => frage?.abort());

/**
 * Der Sammelscreen beginnt oben: Das Panel behielte sonst die Stelle, an der die Infobox stand. 🪤 Nur der Rollbereich des Panels rollt, nie ein Vorfahr
 * (`scrollIntoView` rollte am Telefon auch die Hülle, hinter der das eingeklappte Panel steht).
 */
const wurzel = useTemplateRef<HTMLElement>("wurzel");
onMounted(() => {
    const rollbereich = wurzel.value?.closest(".info-panel__body");
    if (rollbereich) rollbereich.scrollTop = 0;
});

const anzahl = computed(() => props.zeilen.length);
const geordnet = computed(() => entlangDerRoute(props.zeilen));

/** Die aufgeklappten Zeilen; alle beginnen zu. Ein ✕ nimmt die Kennung mit, eine wiedergewählte beginnt also wieder zu. */
const offen = ref<ReadonlySet<string>>(new Set());
watch(
    () => props.zeilen.map((zeile) => zeile.id),
    (ids) => {
        const bleibt = [...offen.value].filter((id) => ids.includes(id));
        if (bleibt.length !== offen.value.size) offen.value = new Set(bleibt);
    },
);
function klappe(id: string): void {
    const neu = new Set(offen.value);
    if (!neu.delete(id)) neu.add(id);
    offen.value = neu;
}
const basis = useId();

/** Der Platz der Farbe eines Eintrags auf der Karte; ohne Platz keine. */
function platzVon(zeile: UnterwegsZeile): number | undefined {
    return props.farben?.get(zeile.id);
}

const kopf = computed<HeaderModel>(() => {
    const r = reise?.value;
    const zweite =
        r === undefined
            ? tPlural("planner.unterwegs.anzahl", anzahl.value, { n: formatNumber(anzahl.value, 0) })
            : t("planner.unterwegs.bis", { from: r.von, to: r.bis });
    return {
        title: t("vorkommen.sammel.titel"),
        subtitle: [{ parts: [{ text: t("vorkommen.sammel.unterwegs") }] }, { parts: [{ text: zweite }] }],
        images: [],
        graphic: "vorkommen",
    };
});

/** „**N** gewählt“: Die Zahl steht fett, wo die Sprache sie hinstellt. */
const leiste = computed(() => {
    const MARKE = "\u0000";
    const [vor = "", nach = ""] = tPlural("planner.unterwegs.anzahl", anzahl.value, { n: MARKE }).split(MARKE);
    return { vor, zahl: formatNumber(anzahl.value, 0), nach };
});

/** Die Art wie im Untertitel der Infobox („Fauna · Niederer Drache“, „Ware · Metall · profan“); solange der Eintrag lädt, nur die Kategorie. */
function art(zeile: UnterwegsZeile): string {
    const e = eintraege.value.get(zeile.id);
    if (e !== undefined && e !== null) return untertitelTeile(e).join(" · ");
    return zeile.kind === "ware" ? t("eintrag.art.ware") : t(KATEGORIE_NAME[zeile.kind]);
}

function beschreibung(zeile: UnterwegsZeile): string | undefined {
    const e = eintraege.value.get(zeile.id);
    return e === undefined || e === null ? undefined : beschreibungVon(e);
}

function felder(zeile: UnterwegsZeile): RowModel[] {
    const e = eintraege.value.get(zeile.id) ?? undefined;
    return [
        { key: "art", label: t("infoPanel.field.art"), value: { kind: "text", text: art(zeile) } },
        {
            key: "unterwegs",
            label: t("vorkommen.sammel.unterwegs"),
            value: {
                kind: "measure",
                text: tPlural("planner.unterwegs.gewaehlt", zeile.etappen.length, {
                    etappen: etappenText(zeile.etappen),
                }),
            },
        },
        ...(e === undefined
            ? []
            : [
                  {
                      key: "gegenden",
                      label: t("eintrag.gruppe.gegenden"),
                      value: { kind: "text", text: gegendenKurz(e) },
                  } as const,
              ]),
    ];
}

/** Die Lizenzzeile einmal für alle Texte, nach dem ersten Eintrag, dessen Kurzbeschreibung aus dem Wiki steht. */
const lizenz = computed(() => {
    for (const zeile of props.zeilen) {
        const e = eintraege.value.get(zeile.id);
        if (e !== undefined && e !== null && e.wiki !== undefined && beschreibungVon(e) !== undefined)
            return lizenzTeile(e, true);
    }
    return undefined;
});
</script>

<template>
    <div ref="wurzel" class="sammel" data-testid="vorkommen-sammel">
        <InfoHeader :model="kopf">
            <template #zeichen>
                <VorkommenPlakette
                    class="sammel__kopfzeichen"
                    groesse="l"
                    zeichen="vorkommen"
                    data-testid="vorkommen-sammel-zeichen"
                />
            </template>
        </InfoHeader>

        <section class="sammel__inhalt">
            <div class="sammel__leiste">
                <span data-testid="vorkommen-sammel-anzahl"
                    >{{ leiste.vor }}<b>{{ leiste.zahl }}</b
                    >{{ leiste.nach }}</span
                >
                <button
                    type="button"
                    class="sammel__link"
                    data-testid="vorkommen-sammel-alle-entfernen"
                    @click="emit('leere')"
                >
                    {{ t("planner.unterwegs.alleEntfernen") }}
                </button>
            </div>
            <ul class="sammel__liste">
                <li
                    v-for="zeile in geordnet"
                    :key="zeile.id"
                    class="sammel__zeile"
                    :class="{ 'is-offen': offen.has(zeile.id) }"
                    :data-eintrag="zeile.id"
                    data-testid="vorkommen-sammel-eintrag"
                >
                    <div class="sammel__kopf">
                        <VorkommenPlakette
                            groesse="m"
                            :zeichen="KATEGORIE_ZEICHEN[zeile.kind]"
                            :platz="platzVon(zeile)"
                            :data-kind="zeile.kind"
                        />
                        <div class="sammel__titel">
                            <button
                                type="button"
                                class="sammel__name"
                                :title="t('planner.unterwegs.oeffnen', { name: zeile.name })"
                                data-testid="vorkommen-sammel-name"
                                @click="emit('oeffne', zeile)"
                            >
                                {{ eintraege.get(zeile.id)?.name ?? zeile.name
                                }}<span class="sammel__pfeil" aria-hidden="true">&nbsp;›</span>
                            </button>
                            <p class="sammel__kurz einzeilig" data-testid="vorkommen-sammel-kurz">
                                <AvmText :text="kurzzeile(zeile, reise?.etappen)" rolle="sekundaer" />
                            </p>
                        </div>
                        <button
                            type="button"
                            class="sammel__knopf sammel__klappe"
                            :aria-expanded="offen.has(zeile.id)"
                            :aria-controls="`${basis}-${zeile.id}`"
                            :aria-label="t('vorkommen.sammel.klappen', { name: zeile.name })"
                            data-testid="vorkommen-sammel-klappe"
                            @click="klappe(zeile.id)"
                        >
                            <span class="sammel__winkel" aria-hidden="true">›</span>
                        </button>
                        <button
                            type="button"
                            class="sammel__knopf sammel__weg"
                            :aria-label="t('planner.unterwegs.entfernen', { name: zeile.name })"
                            :title="t('planner.unterwegs.beenden')"
                            data-testid="vorkommen-sammel-entfernen"
                            @click="emit('entferne', zeile.id)"
                        >
                            <span aria-hidden="true">✕</span>
                        </button>
                    </div>
                    <div
                        v-if="offen.has(zeile.id)"
                        :id="`${basis}-${zeile.id}`"
                        class="sammel__mehr"
                        data-testid="vorkommen-sammel-mehr"
                    >
                        <p v-if="beschreibung(zeile) !== undefined" class="sammel__satz">
                            {{ beschreibung(zeile) }}
                        </p>
                        <InfoFields class="sammel__felder" :rows="felder(zeile)" embedded />
                    </div>
                </li>
            </ul>
            <p v-if="lizenz !== undefined" class="sammel__lizenz" data-testid="vorkommen-sammel-lizenz">
                <template v-for="(teil, stelle) in lizenz" :key="stelle"
                    ><a v-if="teil.href !== undefined" :href="teil.href" target="_blank" rel="noopener noreferrer">{{
                        teil.text
                    }}</a
                    ><template v-else>{{ teil.text }}</template></template
                >
            </p>
        </section>
    </div>
</template>

<style scoped>
.sammel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-bottom: var(--space-16);
}

/* Das Zeichen im Kopf: dieselbe Plakette wie in der Infobox eines Vorkommens (`info-eintrag__zeichen`). */
.sammel__kopfzeichen {
    margin-right: var(--space-10);
}

.sammel__inhalt {
    padding: var(--space-6) var(--info-pad-x) var(--space-12);
}

.sammel__leiste {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-8);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.sammel__leiste b {
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
    font-weight: var(--font-weight-bold);
}

/* Leise Links in der Farbe des Hauses, unterstrichen beim Zeigen (wie die Lizenzzeile). */
.sammel__link {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: color 120ms ease;
}

.sammel__link:hover,
.sammel__link:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.sammel__link:focus-visible,
.sammel__name:focus-visible,
.sammel__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.sammel__liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile wie ein Deckel: Kachel, Name mit Kurzzeile, Pfeil, ✕. */
.sammel__zeile {
    border-bottom: 1px solid var(--color-divider);
}

.sammel__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-6) 0;
}

.sammel__titel {
    flex: 1 1 auto;
    min-width: 0;
}

.sammel__name {
    display: block;
    max-width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-tight);
    overflow-wrap: anywhere;
    text-align: left;
    transition: color 120ms ease;
}

.sammel__name:hover,
.sammel__name:active {
    color: var(--color-link-hover);
    text-decoration: underline;
}

/* Das › sagt, dass der Name in die Infobox führt: in der Linkfarbe, wie der Pfeil eines Deckels. */
.sammel__pfeil {
    color: var(--color-link);
}

.sammel__kurz {
    margin: 1px 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.sammel__knopf {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--avesmaps-infopanel-close);
    height: var(--avesmaps-infopanel-close);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.sammel__knopf:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.sammel__knopf:active {
    background: var(--color-active-wash);
}

/*
 * Der Winkel zum Aufklappen in der Linkfarbe: „aufklappen“ ist eine Handlung (wie im Deckel, `info-lid.vue`). Er zeigt zu nach rechts und dreht aufgeklappt nach
 * unten (Probierseite, Fassung 2); ▾ des Deckels ist in der Hausschrift neben 26 px großen Knöpfen zu klein.
 */
.sammel__klappe {
    color: var(--color-link);
    font-size: var(--font-size-subhead);
}

.sammel__klappe:hover {
    color: var(--color-link-hover);
}

.sammel__winkel {
    display: block;
    line-height: 1;
    transition: transform 120ms ease;
}

.sammel__zeile.is-offen .sammel__winkel {
    transform: rotate(90deg);
}

/* Aufgeklappt: unter dem Namen eingerückt, die Beschreibung als Fließtext über die volle Breite, darunter die Feldtafel. */
.sammel__mehr {
    padding: 0 0 var(--space-8) calc(var(--icon-sm) + var(--space-6) + var(--space-6));
}

.sammel__satz {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.sammel__felder {
    margin-top: var(--space-6);
}

/* Die Herkunft der Texte EINMAL unter der Liste, leise wie in der Infobox (die Lizenz verlangt die Nennung). */
.sammel__lizenz {
    margin: var(--space-8) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

.sammel__lizenz a {
    border-radius: var(--radius-sm);
    color: var(--color-link);
    text-decoration: none;
}

.sammel__lizenz a:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.sammel__lizenz a:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .sammel__link,
    .sammel__name,
    .sammel__knopf,
    .sammel__winkel {
        transition: none;
    }
}
</style>
