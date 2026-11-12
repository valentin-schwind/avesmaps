<script setup lang="ts">
import { computed } from "vue";
import type { FilterAbschnitt } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import { t } from "../i18n/i18n";
import type { FilterChange, FilterGroup } from "./catalog-filter-model";

/**
 * Die Leiste der Katalogfenster (WI-0118: Literatur und Kartensammlung) als zwei Zeichen (Betreiber 2026-10-11: „generell will ich immer
 * allein das sortierung-symbol und das filter-symbol, um platz zu sparen. beim draufklicken öffnet sich das menü mit den optionen.“; Design
 * Guide §13.45), in der Leiste jeder Liste (`AvmListenleiste`): links die Freitextsuche, rechts der Trichter (`AvmFilterknopf`) und die
 * Sortierung (`AvmMenueknopf` mit `AvmSortierzeichen`).
 *
 * Sie übersetzt nur: Die Gruppen aus `catalog-filter-model.ts` (ein Filter erscheint nur, wenn er die Liste teilt; Legacy
 * `advFiltersMarkup` und `citymapFiltersMarkup`) werden Abschnitte im Blatt, jede Eingabe wird wieder ein `FilterChange`; entschieden wird
 * im Fenster, wie bisher.
 *
 * | Gruppe | im Blatt |
 * |---|---|
 * | Chips (Art) | Abschnitt „Art“, Kästchen |
 * | Auswahl (DSA-Version, Schwierigkeit, Genre) | je ein Abschnitt mit einer Wahl, „alle“ zuerst |
 * | Zeitraum | Abschnitt „bereich“, zwei Jahresfelder von–bis |
 * | Schalter vor dem Trenner (farbig, kostenlos) | Abschnitt „Eigenschaften“, Kästchen |
 * | Schalter nach dem Trenner (offiziell, Spoiler) | Abschnitt „Inhalt“, Kästchen |
 */
const props = defineProps<{
    groups: FilterGroup[];
    /** Platzhalter und Name der Suche, je Fenster (Literatur: Titel und Reihe; Kartensammlung: Titel, Zeichner, Verlag). */
    platzhalter: string;
    beschriftung: string;
}>();
/** Der Suchtext; worin gesucht wird, entscheidet das Fenster (`suchtext` der Zeilen). */
const suche = defineModel<string>("suche", { default: "" });
const emit = defineEmits<{ change: [change: FilterChange] }>();

type Schalter = Extract<FilterGroup, { kind: "toggle" }>;

/** Die Schalter, nach ihrer Seite des Trenners: vor ihm gehören sie der Liste, nach ihm sind sie die geteilten (offiziell, Spoiler). */
const schalter = computed((): { eigene: Schalter[]; geteilte: Schalter[] } => {
    const trenner = props.groups.findIndex((group) => group.kind === "divider");
    const alle = props.groups.flatMap((group, index) => (group.kind === "toggle" ? [{ group, index }] : []));
    return {
        eigene: alle.filter((eintrag) => trenner >= 0 && eintrag.index < trenner).map((eintrag) => eintrag.group),
        geteilte: alle.filter((eintrag) => trenner < 0 || eintrag.index > trenner).map((eintrag) => eintrag.group),
    };
});

const SCHALTER_ABSCHNITT = { eigene: "eigenschaften", geteilte: "inhalt" } as const;

const abschnitte = computed((): FilterAbschnitt[] => {
    const liste: FilterAbschnitt[] = [];
    for (const group of props.groups) {
        if (group.kind === "chips") {
            liste.push({
                id: group.id,
                titel: t("catalog.filter.section.type"),
                art: "mehrere",
                werte: group.options.map((option) => ({ wert: option.value, text: option.label })),
            });
        } else if (group.kind === "select") {
            liste.push({
                id: group.id,
                titel: group.placeholder,
                art: "eins",
                werte: group.options.map((option) => ({ wert: option.value, text: option.label })),
            });
        } else if (group.kind === "years") {
            liste.push({
                id: group.id,
                titel: group.label,
                art: "bereich",
                werte: [],
                bereich: { min: group.range.min, max: group.range.max, von: group.from, bis: group.to },
            });
        }
    }
    for (const seite of ["eigene", "geteilte"] as const) {
        const gruppe = schalter.value[seite];
        if (gruppe.length === 0) continue;
        liste.push({
            id: SCHALTER_ABSCHNITT[seite],
            titel: t(seite === "eigene" ? "catalog.filter.section.properties" : "catalog.filter.section.content"),
            art: "mehrere",
            werte: gruppe.map((group) => ({ wert: group.id, text: group.label })),
        });
    }
    return liste;
});

const wahl = computed((): Record<string, string[]> => {
    const ergebnis: Record<string, string[]> = {};
    for (const group of props.groups) {
        if (group.kind === "chips") {
            ergebnis[group.id] = group.options.filter((option) => option.active).map((option) => option.value);
        } else if (group.kind === "select" && group.value !== "") {
            ergebnis[group.id] = [group.value];
        }
    }
    for (const seite of ["eigene", "geteilte"] as const) {
        ergebnis[SCHALTER_ABSCHNITT[seite]] = schalter.value[seite]
            .filter((group) => group.active)
            .map((group) => group.id);
    }
    return ergebnis;
});

const sortierung = computed(() => props.groups.find((group) => group.kind === "sort"));

/** Das Zeichen je Ordnung der Literatur, aus der Familie aller Listen. */
const ZEICHEN: Readonly<Record<string, "zeit" | "art" | "edition" | "name">> = {
    newest: "zeit",
    type: "art",
    edition: "edition",
    alpha: "name",
};

/** Eine NEUE Wahl eines Abschnitts wird zu den Eingaben, die das Fenster kennt: je geänderter Wert ein Umschalten oder eine Auswahl. */
function setze(id: string, werte: string[]): void {
    const vorher = new Set(wahl.value[id] ?? []);
    const nachher = new Set(werte);
    const geaendert = [...new Set([...vorher, ...nachher])].filter((wert) => vorher.has(wert) !== nachher.has(wert));
    const group = props.groups.find((eintrag) => eintrag.kind !== "divider" && eintrag.id === id);
    if (group?.kind === "select") {
        emit("change", { kind: "select", id, value: werte[0] ?? "" });
    } else if (group?.kind === "chips") {
        for (const value of geaendert) emit("change", { kind: "chip", id, value });
    } else {
        for (const toggle of geaendert) emit("change", { kind: "toggle", id: toggle });
    }
}

function bereich(id: string, kante: "von" | "bis", wert: number | null): void {
    emit("change", { kind: "year", id, edge: kante === "von" ? "from" : "to", value: wert });
}

/** „Filter lösen“: jede gesetzte Eingabe zurück, über dieselben Wege wie ein Klick. Die Sortierung bleibt. */
function loesen(): void {
    for (const group of props.groups) {
        if (group.kind === "chips") {
            for (const option of group.options.filter((eintrag) => eintrag.active)) {
                emit("change", { kind: "chip", id: group.id, value: option.value });
            }
        } else if (group.kind === "select" && group.value !== "") {
            emit("change", { kind: "select", id: group.id, value: "" });
        } else if (group.kind === "toggle" && group.active) {
            emit("change", { kind: "toggle", id: group.id });
        } else if (group.kind === "years") {
            if (group.from !== null) emit("change", { kind: "year", id: group.id, edge: "from", value: null });
            if (group.to !== null) emit("change", { kind: "year", id: group.id, edge: "to", value: null });
        }
    }
}

const hatFilter = computed(() => abschnitte.value.length > 0);
const sortierWert = computed(() => {
    const group = sortierung.value;
    return group?.kind === "sort" ? (group.options.find((option) => option.active)?.value ?? "") : "";
});
const sortierOptionen = computed(() => {
    const group = sortierung.value;
    return group?.kind === "sort" ? group.options.map((option) => ({ wert: option.value, text: option.label })) : [];
});
const sortierName = computed(
    () =>
        `${t("catalog.sort.name")}: ${sortierOptionen.value.find((option) => option.wert === sortierWert.value)?.text ?? ""}`,
);
</script>

<template>
    <AvmListenleiste
        v-model="suche"
        :platzhalter="props.platzhalter"
        :beschriftung="props.beschriftung"
        testid="catalog-filters"
    >
        <AvmFilterknopf
            v-if="hatFilter"
            :abschnitte="abschnitte"
            :wahl="wahl"
            testid="catalog-filter"
            @setze="setze"
            @bereich="bereich"
            @loesen="loesen"
        />
        <AvmMenueknopf
            v-if="sortierung?.kind === 'sort'"
            :model-value="sortierWert"
            :optionen="sortierOptionen"
            :bezeichnung="sortierName"
            :menue-bezeichnung="t('catalog.sort.name')"
            im-fenster
            testid="catalog-sort"
            @update:model-value="
                (wert: string) =>
                    emit('change', {
                        kind: 'sort',
                        id: sortierung?.kind === 'sort' ? sortierung.id : 'sort',
                        value: wert,
                    })
            "
        >
            <template #zeichen="{ wert }"><AvmSortierzeichen :art="ZEICHEN[wert] ?? 'name'" /></template>
        </AvmMenueknopf>
    </AvmListenleiste>
</template>
