<script setup lang="ts">
import type { LoreRowView, StaettenGroup, SubjectRef, SubjectSprachTrefferSection } from "@avesmaps3d/shared";
import { computed, ref, shallowRef } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import AvmText from "../controls/avm-text.vue";
import { phoneViewport } from "../controls/phone-viewport";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import InfoLid from "./info-lid.vue";
import InfoLink from "./info-link.vue";
import InfoLoreNames from "./info-lore-names.vue";
import InfoMarked from "./info-marked.vue";
import {
    cachedLore,
    loadLore,
    loreEverywhereOf,
    loreGroupsOf,
    loreSearchLabel,
    type LoreEverywhereModel,
    type LoreGroupModel,
} from "./lore-model";
import { lineSearchable, searchGroups, searchNeedle } from "./lore-search";
import {
    cachedStaetten,
    loadStaetten,
    STAETTEN_ORDERS,
    staettenGroupsOf,
    staettenOrderMatters,
} from "./staetten-model";
import { staettenOrder } from "./staetten-order";
import { cachedSprachTreffer, loadSprachTreffer, sprachTrefferGroupsOf, sprachTrefferSuche } from "./sprache-treffer";
import type { LoreRowValue, SprachTrefferRowValue, StaettenRowValue } from "./panel-types";

/**
 * Eine der vier Vorkommenszeilen (WI-0091): ein Deckel in der Feldliste, dessen Aufschrift der Zählsatz ist („35 Handelswaren
 * gelistet“), und der seinen Inhalt erst beim ersten Aufklappen holt.
 *
 * 🔴 **Verzögert, und das ist hier nicht Feinschliff.** Die Zahl steht im Detail, die Namen kommen aus `GET {detail}/lore` -
 * einmal je Gegenstand, danach aus dem kurzen Cache (`panel-section-load.ts`). Die vier Zeilen EINES Gegenstands teilen diese
 * eine Antwort: Wer die zweite Zeile aufklappt, löst keinen zweiten Serverlauf aus.
 *
 * 🔴 **Drei Teile, und der dritte ist ein Link** (Betreiber 2026-10-06 und 2026-10-07):
 * - **„Von hier“**, **„Direkt von hier“** und **„Aus der Region“** sind Gruppen, jede mit Überschrift und Zahl, und jede mit
 *   ihrem **Buchstabenregister in zwei Spalten** (WI-0099, `info-lore-names.vue`). 🔴 **Die Überschrift steht immer**, auch bei
 *   einer einzigen Gruppe (Betreiber 2026-10-07, bewusste Abweichung von Legacy - Begründung in `loreGroupsOf`). Über das
 *   KLAPPEN entscheidet weiter die ZEILE, nie die einzelne Gruppe: unter 25 Namen in der Zeile klappt nichts, ab 25 klappen
 *   mehrere Gruppen, und nur die erste startet offen (`loreGroupsOf`).
 * - 🪤 Eine zweite Klappstufe für „Aus der Region“ war am 2026-10-06 gebaut und am Blatt abgelehnt worden („nein ‚Aus der
 *   Region‘ brauch keine eigene klappbox“) - sie zeigte bei DREI Namen einen Deckel im Deckel. Legacys Regel löst das von
 *   selbst: Unter 25 Namen in der Zeile klappt nichts, und die erste Gruppe steht ohnehin offen.
 * - **„Überall in Aventurien“** ist eine LINKZEILE auf die Landschaft „Aventurien“, keine Liste. Dort sind diese Einträge ihr
 *   eigenes „Direkt von hier“; darum reist hier kein einziger ihrer Namen mit. 🔴 **Sie steht an JEDEM Gegenstand** (Betreiber
 *   2026-10-07: „und ‚Überall in Aventurien‘ muss natürlich auch überall stehen, wenns in Aventurien ist :)“), auch an einem,
 *   der nichts Eigenes und nichts Regionales trägt - dann ist der Link der ganze Inhalt der Zeile.
 *
 * Die Zahl auf dem äußeren Deckel ist die des Servers, nicht die Länge der geholten Liste - sonst liefen Satz und Liste
 * auseinander. Scheitert die Frage, steht im Deckel eine Zeile samt „Noch einmal versuchen“, wie bei den Katalogabschnitten; der
 * Rest des Panels bleibt benutzbar.
 */
/**
 * 🔴 **DIESELBE REZEPTUR FÜR DIE STÄTTENZEILE** (WI-0109), und das ist Legacys ausdrückliche Ansage: „Die Optik kommt von den
 * LORE-KLASSEN, und das ist Absicht. … Eine dritte Rezeptur für ‚Liste von Namen in einer Infobox-Klappzeile' wäre genau die
 * Divergenz, vor der AGENTS.md §11 warnt." Darum nimmt dieses Bauteil beide Zeilen: Deckel, Gruppenköpfe, Register und Zustände
 * sind identisch. Verschieden sind nur **wen die Zeile fragt**, **woraus die Gruppen entstehen** (Nähe gegen Art) und die
 * **Markenschwelle** (0 gegen 2) - alles drei außerhalb dieses Bauteils, in `lore-model.ts` und `staetten-model.ts`.
 *
 * Die TREFFERZEILEN einer Sprache (WI-0261; Betreiber 2026-10-31: „kannst du dich hier an das design der bisherigen item in der infobox halten“) sind der dritte
 * Nutzer, aus demselben Grund: Sie fragen je Art ihre Liste (`sprache-treffer.ts`) und gliedern sie nach dem Anteil, alles Übrige ist dieses Bauteil.
 */
const props = defineProps<{ value: LoreRowValue | StaettenRowValue | SprachTrefferRowValue }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();

/** Die Antwort, auf die die Zeile wartet - je Art der Zeile eine andere Sektion, aber nur EIN Zustand im Bauteil. */
type Answer =
    | { kind: "lore"; rows: readonly LoreRowView[] }
    | { kind: "staetten"; groups: readonly StaettenGroup[] }
    | { kind: "sprachTreffer"; section: SubjectSprachTrefferSection };

/**
 * 🪤 **Eine ROUTENETAPPE bringt ihre Antwort mit** (WI-0106): Sie ist kein Kartenobjekt, hat also keine Adresse (`ref`), unter
 * der eine Sektion nachzuholen wäre - ihre Zeilen kommen mit den Wegen ihrer Abschnitte in EINEM Lauf
 * (`route-planner/stage-lore.ts`; gemessen Median 23 Einträge und 2,0 kB je Etappe gegen Median 47 und bis zu 256 am Ort).
 * Steht `section` schon da, fragt diese Zeile nichts nach; ohne `ref` kann sie es auch nicht.
 */
function cached(): Answer | null {
    const value = props.value;
    if (value.kind === "staetten") {
        const hit = cachedStaetten(value.ref);
        return hit === undefined ? null : { kind: "staetten", groups: hit.groups };
    }
    if (value.kind === "sprachTreffer") {
        const hit = cachedSprachTreffer(value.ref, value.art);
        return hit === undefined ? null : { kind: "sprachTreffer", section: hit };
    }
    if (value.section !== undefined) return { kind: "lore", rows: value.section.rows };
    if (value.ref === undefined) return null;
    const hit = cachedLore(value.ref);
    return hit === undefined ? null : { kind: "lore", rows: hit.rows };
}

const section = shallowRef<Answer | null>(cached());
const failed = ref(false);
const pending = ref(false);

/** Die Vorkommenszeile dieser Art - `undefined` an der Stättenzeile, die keine Art hat. */
const row = computed<LoreRowView | undefined>(() => {
    const answer = section.value;
    const value = props.value;
    if (answer === null || answer.kind !== "lore" || value.kind !== "lore") return undefined;
    return answer.rows.find((entry) => entry.kind === value.loreKind);
});
const groups = computed<LoreGroupModel[]>(() => {
    const answer = section.value;
    if (answer !== null && answer.kind === "staetten") {
        return staettenGroupsOf({ count: props.value.count, groups: answer.groups }, staettenOrder.value);
    }
    if (answer !== null && answer.kind === "sprachTreffer") return sprachTrefferGroupsOf(answer.section);
    return row.value === undefined ? [] : loreGroupsOf(row.value);
});

/**
 * 🔴 **DIE ORDNUNG DER STÄTTEN** (WI-0122 Nachtrag, Betreiber 2026-10-09: „kannst du neben dem suchfeld ein kleines dropdown
 * bauen, wo man alphabetisch (wie jetzt) und nach häufigkeit sortieren kann?“). Nur an den Stätten: Die Vorkommen gliedern
 * nach Herkunft („Von hier“, „Aus der Region“), und die Reihenfolge dieser Gruppen ist eine Aussage, keine Wahl.
 *
 * 🔴 **Ein Symbolknopf rechts neben dem Feld, in derselben Zeile** (zweiter Nachtrag, Betreiber 2026-10-09: „kannst du das
 * dropdown zum icon machen und rechts neben die suchmaske“): der Menüknopf des Hauses (`AvmMenueknopf`), das Zeichen zeigt die
 * aktive Ordnung (`AvmSortierzeichen`, die Familie aller Listen: alphabetisch `name`, nach Häufigkeit `menge`), der Name nennt
 * sie („Innerorts ordnen: alphabetisch“), die Wörter im Menü sind
 * die der Sortierung der Literatur (WI-0118: „alphabetisch“, „nach …“). Das Feld nimmt den Rest der Breite: Bei 400 px
 * Panelbreite bleiben ihm 189 px, genug für „Innerorts durchsuchen“ (177 px); am Telefon steht im Feld nur „Suchen“
 * (`searchPlaceholder`). Die Wahl gilt für die Sitzung (`staetten-order.ts`).
 */
const ordered = computed(() => {
    const answer = section.value;
    return (
        answer !== null &&
        answer.kind === "staetten" &&
        lineSearchable(groups.value) &&
        staettenOrderMatters({ count: props.value.count, groups: answer.groups })
    );
});
const orderOptions = computed(() => [
    { wert: "alpha", text: t("infoPanel.staetten.orderAlpha") },
    { wert: "count", text: t("infoPanel.staetten.orderCount") },
]);
const orderValue = computed({
    get: (): string => staettenOrder.value,
    set: (value: string): void => {
        staettenOrder.value = STAETTEN_ORDERS.find((order) => order === value) ?? "alpha";
    },
});
const orderLabel = computed(() =>
    t("infoPanel.staetten.orderNamed", {
        order: orderOptions.value.find((option) => option.wert === staettenOrder.value)?.text ?? "",
    }),
);
const everywhere = computed<LoreEverywhereModel | undefined>(() =>
    row.value === undefined ? undefined : loreEverywhereOf(row.value),
);
/** Die Zeile hat die Antwort noch nicht und kann sie holen. */
const failedText = computed(() =>
    props.value.kind === "staetten"
        ? t("infoPanel.staetten.failed")
        : props.value.kind === "sprachTreffer"
          ? t("sprache.treffer.failed")
          : t("infoPanel.lore.failed"),
);

async function load(): Promise<void> {
    const value = props.value;
    if (pending.value) return;
    pending.value = true;
    failed.value = false;
    try {
        if (value.kind === "staetten") {
            const answer = await loadStaetten(value.ref);
            section.value = answer === null ? null : { kind: "staetten", groups: answer.groups };
        } else if (value.kind === "sprachTreffer") {
            const answer = await loadSprachTreffer(value.ref, value.art);
            section.value = answer === null ? null : { kind: "sprachTreffer", section: answer };
        } else {
            if (value.ref === undefined) return;
            const answer = await loadLore(value.ref);
            section.value = answer === null ? null : { kind: "lore", rows: answer.rows };
        }
    } catch (error) {
        // Wie die übrigen Lader des Panels in die Konsole (WI-0202, W5-05): Bis dahin verschwand der Fehler hier ganz.
        console.error("Vorkommen nicht geladen", error);
        failed.value = true;
    } finally {
        pending.value = false;
    }
}

/** Erst beim Aufklappen, und nur einmal: ein zweites Aufklappen zeigt, was schon da ist. */
function toggled(open: boolean): void {
    if (open && section.value === null && !pending.value) void load();
}

/** Ein Objektlink öffnet das Kartenobjekt; sonst führt der Name auf seinen Wiki-Artikel, sonst steht er als Text. */
const openSubject = (ref: SubjectRef): void => emit("open", ref);

/**
 * 🔴 **DAS SUCHFELD EINER LANGEN ZEILE** (WI-0122, Betreiber 2026-10-09: „ja, B (A + Suchfeld) bauen“). Es steht ab derselben
 * Zahl, ab der die Gruppen zugeklappt starten (`lineSearchable`, 25 Namen in der Zeile) - an Stätten UND Vorkommen, weil beide
 * hier gezeichnet werden. Es filtert beim Tippen, markiert die Treffer und klappt jede Gruppe mit Treffer auf; die Regeln
 * stehen rein in `lore-search.ts`.
 *
 * 🪤 **Strg+F bleibt**: Ohne Suchwort stehen alle Gruppen als natives `<details>` da wie vorher. Escape leert ein volles Feld
 * und verbraucht die Taste (`preventDefault`, die Kaskade in `escape-cascade.ts` sieht sie dann nicht); ein leeres Feld lässt
 * sie durch.
 */
const query = ref("");
const searchable = computed(() => lineSearchable(groups.value));
const needle = computed(() => (searchable.value ? searchNeedle(query.value) : ""));
const searching = computed(() => needle.value !== "");
const result = computed(() => searchGroups(groups.value, searching.value ? query.value : ""));
const searchLabel = computed(() => {
    const value = props.value;
    if (value.kind === "staetten") return t("infoPanel.staetten.search");
    return value.kind === "sprachTreffer" ? sprachTrefferSuche(value.art) : loreSearchLabel(value.loreKind);
});
/**
 * Die Aufschrift im Feld: am Telefon nur „Suchen“ (Betreiber 2026-10-09: „ja, am telefon auf „Suchen“ kürzen“), weil dort neben
 * dem Fingerziel des Knopfs „Innerorts durchsuchen“ am Rand abriss. Der Name des Felds (`aria-label`) bleibt die lange Fassung.
 */
const searchPlaceholder = computed(() => (phoneViewport.value ? t("infoPanel.search.short") : searchLabel.value));
/** Der Satz im Deckel: am Telefon ohne Verb (WI-0098, Betreiber 2026-10-09: „ok“), dieselbe Regel wie „Suchen“. */
const summary = computed(() => (phoneViewport.value ? props.value.shortSentence : props.value.sentence));
/** „6 Treffer in 5 Arten“ an den Stätten, „6 Treffer“ an den Vorkommen, die keine Arten haben. */
const hitsText = computed(() => {
    const { hits, types } = result.value;
    const sentence = tPlural("infoPanel.search.hit", hits, { n: formatNumber(hits, 0) });
    if (props.value.kind !== "staetten") return sentence;
    return tPlural("infoPanel.staetten.hitsIn", types, { hits: sentence, m: formatNumber(types, 0) });
});
const noneText = computed(() =>
    t(props.value.kind === "staetten" ? "infoPanel.staetten.none" : "infoPanel.lore.none", { q: query.value.trim() }),
);

/** Die Zahl im Kopf einer Gruppe: während einer Suche „1 von 3“, sonst die Zahl allein. */
const countText = (group: LoreGroupModel): string =>
    group.total !== undefined && group.total !== group.count
        ? t("infoPanel.search.ofTotal", { n: String(group.count), m: String(group.total) })
        : String(group.count);

/**
 * Ein eigener Schlüssel für die Gruppen einer Suche: Beginnt sie, entstehen die Gruppen mit Treffern neu und damit OFFEN (ein
 * gebundenes `open` würde eine vorher von Hand geschlossene Gruppe nicht wieder öffnen); endet sie, kehrt der Anfangszustand
 * zurück (Stätten: alle zu, Vorkommen: die erste offen).
 */
const groupKey = (group: LoreGroupModel): string => (searching.value ? `${group.key}:suche` : group.key);

function clearSearch(): void {
    query.value = "";
}

function onSearchKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || query.value === "") return;
    event.preventDefault();
    clearSearch();
}
</script>

<template>
    <InfoLid :summary="summary" data-testid="info-lore-lid" @toggle="toggled">
        <p v-if="pending" class="info-lore__note" data-testid="info-lore-pending">{{ t("infoPanel.lore.loading") }}</p>
        <p v-else-if="failed" class="info-lore__note" data-testid="info-lore-failed">
            {{ failedText }}
            <button type="button" class="info-lore__retry" @click="load()">{{ t("infoPanel.lore.retry") }}</button>
        </p>
        <template v-else>
            <div v-if="searchable" class="info-lore__search">
                <div class="info-lore__suchzeile">
                    <AvmEingabe
                        v-model="query"
                        art="suche"
                        :placeholder="searchPlaceholder"
                        :aria-label="searchLabel"
                        testid="info-lore-search"
                        @keydown="onSearchKey"
                    />
                    <AvmMenueknopf
                        v-if="ordered"
                        v-model="orderValue"
                        :optionen="orderOptions"
                        :bezeichnung="orderLabel"
                        :menue-bezeichnung="t('infoPanel.staetten.order')"
                        testid="info-lore-order"
                    >
                        <template #zeichen="{ wert }"
                            ><AvmSortierzeichen :art="wert === 'count' ? 'menge' : 'name'"
                        /></template>
                    </AvmMenueknopf>
                </div>
                <p v-if="searching && result.hits > 0" class="info-lore__hits" data-testid="info-lore-hits">
                    <AvmText :text="hitsText" rolle="sekundaer" />
                </p>
            </div>
            <p v-if="searching && result.hits === 0" class="info-lore__none" data-testid="info-lore-none">
                {{ noneText }}
                <button type="button" class="info-lore__retry" @click="clearSearch()">
                    {{ t("ui.input.clearSearch") }}
                </button>
            </p>
            <template v-for="group in result.groups" :key="groupKey(group)">
                <!-- Zustand 3: klappbar. Natives `<details>` wie der Deckel selbst - nur so findet Strg+F einen Namen in einer
                     ZUgeklappten Gruppe und klappt sie auf. -->
                <details
                    v-if="group.collapsible"
                    class="info-lore__group is-grouped is-collapsible"
                    :class="{ 'is-collected': group.collected === true }"
                    :open="group.open"
                    data-testid="info-lore-group"
                    :data-collected="group.collected === true ? '' : undefined"
                >
                    <summary class="info-lore__group-head" data-testid="info-lore-group-head">
                        <span class="info-lore__group-name" data-testid="info-lore-heading"
                            ><InfoMarked :text="group.heading" :needle="group.art === true ? needle : ''"
                        /></span>
                        <span class="info-lore__group-count" data-testid="info-lore-count">{{ countText(group) }}</span>
                        <span v-if="group.mark !== undefined" class="info-lore__group-mark" data-testid="info-lore-mark"
                            ><InfoMarked :text="group.mark" :needle="needle"
                        /></span>
                    </summary>
                    <InfoLoreNames :names="group.names" :needle="needle" @open="openSubject" />
                </details>
                <!-- Zustand 2 und 1: Kopf mit Zahl, kein Pfeil. 🔴 Der Kopf steht AUCH bei einer einzigen Gruppe
                     (Betreiber 2026-10-07, `lore-model.ts` `loreGroupsOf`) - er sagt, ob die Namen abgeleitet sind. -->
                <div
                    v-else
                    class="info-lore__group is-grouped"
                    :class="{ 'is-collected': group.collected === true }"
                    data-testid="info-lore-group"
                    :data-collected="group.collected === true ? '' : undefined"
                >
                    <div class="info-lore__group-head" data-testid="info-lore-group-head">
                        <span class="info-lore__group-name" data-testid="info-lore-heading"
                            ><InfoMarked :text="group.heading" :needle="group.art === true ? needle : ''"
                        /></span>
                        <span class="info-lore__group-count" data-testid="info-lore-count">{{ countText(group) }}</span>
                        <span v-if="group.mark !== undefined" class="info-lore__group-mark" data-testid="info-lore-mark"
                            ><InfoMarked :text="group.mark" :needle="needle"
                        /></span>
                    </div>
                    <InfoLoreNames :names="group.names" :needle="needle" @open="openSubject" />
                </div>
            </template>
            <p v-if="everywhere !== undefined" class="info-lore__everywhere" data-testid="info-lore-everywhere">
                <InfoLink @open="openSubject(everywhere.ref)">{{ everywhere.label }}</InfoLink>
            </p>
        </template>
    </InfoLid>
</template>

<style scoped>
.info-lore__note,
.info-lore__everywhere {
    margin: 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.info-lore__note {
    margin-top: var(--space-4);
    color: var(--color-text-strong);
}

.info-lore__everywhere {
    margin-top: var(--space-6);
}

/*
 * Das Suchfeld einer langen Zeile (WI-0122): das Feld der Fenster (`AvmEingabe`, Art „suche“, 32 px, Lupe vorn, ✕ zum Leeren),
 * über die Breite des Deckels, bei den Stätten rechts daneben der Knopf der Ordnung. Die Zahl darunter ist Sekundärtext mit
 * heller Zahl (`AvmText`, Guide §16.3); ohne Suche entfällt sie.
 */
.info-lore__search {
    margin-top: var(--space-4);
}

/*
 * Feld und Ordnung in EINER Zeile (WI-0122 zweiter Nachtrag): das Feld nimmt den Rest der Breite und darf schrumpfen, der
 * Knopf behält seine Größe. Beide sind gleich hoch - am Zeiger die Bedienhöhe, am Finger das Fingerziel des Knopfs (44 px),
 * auf das sich das Feld mit streckt. Wird das Feld am Telefon schmaler als seine Aufschrift, endet sie am Rand des Felds:
 * „…“ setzt im Haus allein `.einzeilig` (app.vue, `design-canon.test.ts`), und ein Eingabefeld trägt die Klasse nicht.
 */
.info-lore__suchzeile {
    display: flex;
    align-items: stretch;
    gap: var(--space-4);
}

.info-lore__suchzeile > :deep(.eingabe-huelle) {
    flex: 1 1 auto;
    min-width: 0;
}

.info-lore__suchzeile :deep(.eingabe-huelle > .eingabe) {
    height: 100%;
    min-height: var(--avm-control-h);
}

.info-lore__hits,
.info-lore__none {
    margin: var(--space-4) 0 0;
    overflow-wrap: anywhere;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.info-lore__none {
    margin-bottom: var(--space-2);
    color: var(--color-text-muted);
}

/*
 * 🔴 **GRUPPIERT WIRD PER LINIE UND ABSTAND, NICHT PER KASTEN** (Legacy `.avesmaps-lore__gruppe`, Design Guide §30).
 * Die erste Gruppe trägt keinen Abstand: Ihre Linie IST die Trennung zum Deckelknopf darüber - der Deckel bringt oben kein
 * Polster mit (`info-lid.vue`), und so braucht die Zeile keine zweite Sprosse.
 *
 * ⚠️ Eine einzige Gruppe trägt keinen Kopf und darum auch keine Linie: Sie gliedert nichts.
 */
.info-lore__group.is-grouped {
    display: block;
    border-top: 1px solid var(--color-divider);
    margin-top: var(--space-6);
    padding-top: var(--space-4);
}

.info-lore__group.is-grouped:first-child {
    margin-top: 0;
}

/*
 * 💣 **Die Gruppenzeile ist GRÖSSER und DUNKLER als der Deckelkopf über ihr** (12 px gegen 11 px, `--color-text-strong` gegen
 * `--color-text-muted`) - sie wirkt nur schmaler, weil Kasten, Rahmen und Polsterung fehlen. 🔴 **Nicht kleiner setzen:**
 * Legacy hatte sie bis zum 12.08.2026 als blasse Kleinversalzeile (0,72 rem, grau, gesperrt) und hat das verworfen, weil
 * zwischen zwei Blöcken von Namen „Von hier und Direkt hier“ unterging (Owner-Befund). Der Unterschied zum Deckelkopf ist
 * Linie gegen Kasten, nicht Größe.
 *
 * ⚠️ Name und Zahl stehen NEBENEINANDER und beide links (`gap`), nicht an den Rändern: `margin-left: auto` trägt allein der
 * Pfeil. Die Zahl ist der eigentliche Gewinn - „Direkt hier 98“ sagt vorher, was einen erwartet.
 *
 * 🪤 **Legacys `font-weight: 500` ist NICHT übernommen:** Die Hausschrift hat nur Regular, 500 wäre synthetisches Fett, und im
 * Haus trägt die Betonung die FARBE (`info-panel-huelle.test.ts` wacht darüber). Name und Zahl unterscheiden sich darum über
 * `--color-text-strong` gegen `--color-text-muted` - genau der Unterschied, den Legacy mit Gewicht UND Farbe macht.
 */
.info-lore__group-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-4);
    list-style: none;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.info-lore__group-head::-webkit-details-marker {
    display: none;
}

.info-lore__group-count {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

/*
 * Das Kennzeichen „Hauptsitz“ hinter der Zahl (WI-0122): Sekundärtext eine Sprosse kleiner, wie die Art in einer Zeile der
 * Sammelgruppe. Es bricht nicht um - es ist ein Wort, das zur Art gehört.
 */
.info-lore__group-mark {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

/*
 * 🔴 **DIE SAMMELGRUPPE „WEITERE STÄTTEN“ IST ABGESETZT** (WI-0122, Betreiber 2026-10-09: „kannst du "Weitere Gebäuden/Stätten"
 * visuell von den anderen punkten unterscheiden?“). Zwei Mittel, beide aus dem Kanon, keins davon ein Kasten (gruppiert wird
 * per Linie und Abstand, siehe oben):
 *
 * 1. **Mehr Luft über der Linie** - der Trenner der lesenden Abschnitte (`--space-12`, Guide „Trenner-Rhythmus“) statt der
 *    dichten Sprosse zwischen zwei Arten. Das Auge sieht: hier endet die Reihe der Arten.
 * 2. **Der Name steht kursiv**: Er ist keine Art, sondern sagt etwas ÜBER die Zeilen darunter. Kursiv ist im Haus erlaubt
 *    („Kursiv - wo es der Browser darf“: die Oberfläche neigt die Regular selbst) und trägt genau diese Rolle; Farbe und Größe
 *    bleiben die eines Gruppenkopfs. 🪤 **Nicht blass setzen:** Ein grauer Kopf ging in Legacy zwischen zwei Blöcken von Namen
 *    unter (Owner-Befund vom 12.08.2026, siehe oben).
 *
 * Hover, Fokus und Aktiv sind die jeder klappbaren Gruppe: Die Fläche färbt sich, nichts wird durchsichtig.
 */
.info-lore__group.is-grouped.is-collected:not(:first-child) {
    margin-top: var(--space-12);
}

.is-collected > .info-lore__group-head > .info-lore__group-name {
    font-style: italic;
}

/*
 * 💣 **Nur die KLAPPBARE Gruppe fühlt sich wie ein Bedienelement an.** Ein fester Kopf (Zustand 2) steht als schlichtes `<div>`
 * da - ein Zeiger darauf verspräche ein Aufklappen, das es dort nicht gibt.
 *
 * Der Hover gehört dem Kopf, nicht der Gruppe: Der Deckel darüber reagiert nur auf seinen eigenen Kopf, also bekäme eine
 * aufklappbare Gruppe sonst gar keine Rückmeldung. 🪤 **Legacys Hover ist dabei praktisch unsichtbar** - 8 px Radius auf einer
 * 17 px hohen Zeile ohne Innenabstand. Übernommen wie gemessen; ein Innenabstand mit negativem Außenabstand wäre eine
 * Abweichung und liegt dem Betreiber vor, statt still gebaut zu werden.
 */
.info-lore__group.is-collapsible > .info-lore__group-head {
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.info-lore__group.is-collapsible > .info-lore__group-head:hover,
.info-lore__group.is-collapsible > .info-lore__group-head:active {
    background: var(--color-button-soft-hover);
}

.info-lore__group.is-collapsible > .info-lore__group-head:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Der Pfeil steht im STYLESHEET, nicht im Markup: Er beschreibt einen Zustand, den das `<details>` selbst führt - im Markup
 * wäre er eine zweite Stelle, die ihn kennt.
 *
 * ⚠️ **Andere Zeichen als der Deckel, und das ist Absicht:** Der Deckel kippt zwischen zwei SENKRECHTEN Richtungen (U+25BE auf
 * U+25B4), die Gruppe zwischen waagerecht und senkrecht (U+25B8 auf U+25BE). Und sie ist blassgrau, nicht in Linkfarbe: Die
 * Gruppe ist die kleinere Handlung.
 */
.info-lore__group.is-collapsible > .info-lore__group-head::after {
    content: "\25b8";
    margin-left: auto;
    color: var(--color-text-muted);
}

.info-lore__group.is-collapsible[open] > .info-lore__group-head::after {
    content: "\25be";
}

@media (prefers-reduced-motion: reduce) {
    .info-lore__group.is-collapsible > .info-lore__group-head {
        transition: none;
    }
}

.info-lore__retry {
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    transition: color 120ms ease;
}

.info-lore__retry:hover {
    color: var(--color-link-hover);
}

.info-lore__retry:active {
    color: var(--color-link-hover);
}

.info-lore__retry:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-lore__retry {
        transition: none;
    }
}
</style>
