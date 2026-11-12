<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
    BESUCH_EDITOREN_URL,
    ROLES,
    SONDERROLLEN_NAMEN,
    type BesuchEditor,
    type BesuchEditoren,
} from "@avesmaps3d/shared";
import type { ObjektZiel } from "../aenderungen/aenderung-modell";
import { rollenName, sonderrollenName } from "../auth/bezeichnung";
import AvmDisclosure from "../controls/avm-disclosure.vue";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import { formatNumber, t } from "../i18n/i18n";
import EditorStatusKarte from "./editor-status-karte.vue";
import { editorKreis } from "./editor-status-modell";

/**
 * Wer im Editor ist und was er gerade tut (WI-0141b, WI-0276; Betreiber 2026-10-14: „eine liste von editoren … dass man auf einen draufklickt, sieht
 * welche ansichten er benutzt, welche rolle, wann wie oft aktiv und zuletzt online. so weiß jeder wer gerade online ist
 * und was macht“; Betreiber 2026-11-02: „wichtig is zu sehen, was ein editor gerade so treibt, für was er zuständig ist, seine rolle“).
 *
 * - **Wer da ist, steht oben und offen, die übrigen darunter und zu** (Betreiber 2026-11-03: „die, die gerade online sind oben in einem aufgeklappten panel und die, die inaktiv sind in einem zusammen geklappten panel“). Eine leere Gruppe entfällt.
 * - Jede Person ist eine Visitenkarte (`editor-status-karte.vue`), zu wie in Legacys Liste, höchstens eine offen.
 * - Der Kreis sagt den Zustand: ● bearbeitet gerade etwas, ◐ online, ○ nicht da; Legende und Zählung unter der Liste (Haus-Zeichen, wie in jeder Liste).
 * - Die Leiste jeder Liste: Suche nach Name und Zuständigkeit, der Trichter nach Grundrolle und Sonderrolle (WI-0279 E9b); er zeigt nur, was in
 *   der Liste vorkommt.
 * - 🔴 **Es wird nichts Neues über Personen erfasst.** Alles kommt aus dem, was ohnehin geführt wird: die Anmeldung (Rolle, „Verantwortlich für“, zuletzt gesehen,
 *   Gerät der jüngsten Sitzung, Tage mit einer Sitzung, die Ansicht der Sitzung), die Sperren und das Protokoll der Änderungen, das im Reiter „Änderungen“ ohnehin offen steht.
 */
const props = defineProps<{ aktiv: boolean }>();
const emit = defineEmits<{ zeigen: [ziel: ObjektZiel, id: string] }>();

const stand = ref<BesuchEditoren | undefined>(undefined);
const fehler = ref(false);
const offen = ref<string | undefined>(undefined);
const gruppeOffen = ref({ online: true, inaktiv: false });
const jetzt = ref(new Date());
let timer: ReturnType<typeof setInterval> | undefined;

/** Alle dreißig Sekunden: Anwesenheit ändert sich in Minuten, nicht in Sekunden. */
const TAKT_MS = 30_000;

async function hole(): Promise<void> {
    try {
        const antwort = await fetch(BESUCH_EDITOREN_URL, {
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) throw new Error(String(antwort.status));
        stand.value = (await antwort.json()) as BesuchEditoren;
        jetzt.value = new Date();
        fehler.value = false;
    } catch {
        fehler.value = true;
    }
}

function starte(): void {
    if (timer !== undefined) return;
    void hole();
    timer = setInterval(() => void hole(), TAKT_MS);
}
function halte(): void {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
}
onMounted(() => props.aktiv && starte());
watch(
    () => props.aktiv,
    (an) => (an ? starte() : halte()),
);
onBeforeUnmount(halte);

const alle = computed(() => stand.value?.editoren ?? []);
const wahl = ref<FilterWahl>({});
const suche = ref("");
const sonderrollenVon = (person: BesuchEditor): string[] =>
    (person.sonderrollen ?? []).map((zeile) => zeile.sonderrolle);
const editoren = computed(() => {
    const rollen = wahl.value["grundrolle"] ?? [];
    const sonder = wahl.value["sonderrolle"] ?? [];
    const gesucht = suche.value.trim().toLocaleLowerCase();
    return alle.value.filter(
        (person) =>
            `${person.name} ${person.verantwortung ?? ""}`.toLocaleLowerCase().includes(gesucht) &&
            (rollen.length === 0 || rollen.includes(person.rolle)) &&
            (sonder.length === 0 || sonderrollenVon(person).some((name) => sonder.includes(name))),
    );
});
const abschnitte = computed<FilterAbschnitt[]>(() => [
    {
        id: "grundrolle",
        titel: t("editoren.filter.grundrolle"),
        art: "mehrere",
        werte: [...ROLES].reverse().flatMap((rolle) => {
            const zahl = alle.value.filter((person) => person.rolle === rolle).length;
            return zahl === 0 ? [] : [{ wert: rolle, text: rollenName(rolle), zahl }];
        }),
    },
    {
        id: "sonderrolle",
        titel: t("editoren.filter.sonderrolle"),
        art: "mehrere",
        werte: SONDERROLLEN_NAMEN.flatMap((name) => {
            const zahl = alle.value.filter((person) => sonderrollenVon(person).includes(name)).length;
            return zahl === 0 ? [] : [{ wert: name, text: sonderrollenName(name), zahl }];
        }),
    },
]);
const da = computed(() => editoren.value.filter((person) => editorKreis(person) !== "leer"));
const uebrige = computed(() => editoren.value.filter((person) => editorKreis(person) === "leer"));
const gruppen = computed(() =>
    [
        { id: "online" as const, name: t("editoren.gruppe.online"), personen: da.value },
        { id: "inaktiv" as const, name: t("editoren.gruppe.inaktiv"), personen: uebrige.value },
    ].filter((gruppe) => gruppe.personen.length > 0),
);
const zahlen = computed(() => ({
    voll: editoren.value.filter((person) => editorKreis(person) === "voll").length,
    halb: editoren.value.filter((person) => editorKreis(person) === "halb").length,
    "halb-rechts": 0,
    leer: uebrige.value.length,
}));

/** Woran jemand sitzt, als Name. Eine unbekannte Kennung zeigt sich nicht — lieber nichts als ein roher Schlüssel. */
const ANSICHTEN: Readonly<Record<string, Parameters<typeof t>[0]>> = {
    "karte.standard": "view.standard",
    "karte.political": "view.political",
    "karte.landscapes": "view.landscapes",
    "karte.powerlines": "view.powerlines",
    "karte.none": "view.none",
    planer: "editoren.ansicht.planer",
    "editor.aenderungen": "nav.editorpanel.aenderungen",
    "editor.karteninhalte": "nav.editorpanel.karteninhalte",
    "editor.status": "nav.editorpanel.status",
    "editor.orte": "editoren.ansicht.orte",
    "editor.medien": "editoren.ansicht.medien",
    "editor.system": "editoren.ansicht.system",
};
const ansichtName = (ansicht: string | null): string | null => {
    const schluessel = ansicht === null ? undefined : ANSICHTEN[ansicht];
    return schluessel === undefined ? null : t(schluessel);
};
</script>

<template>
    <section class="editoren">
        <h3 class="editoren__titel">{{ t("editoren.titel") }}</h3>
        <AvmListenleiste
            v-if="alle.length > 0"
            v-model="suche"
            :platzhalter="t('editoren.suche.platzhalter')"
            :beschriftung="t('editoren.suche.name')"
            testid="editoren-leiste"
        >
            <AvmFilterknopf
                :abschnitte="abschnitte"
                :wahl="wahl"
                testid="editoren-filter"
                @setze="(abschnitt, werte) => (wahl = { ...wahl, [abschnitt]: werte })"
                @loesen="wahl = {}"
            />
        </AvmListenleiste>
        <p v-if="fehler" class="editoren__satz">{{ t("statistik.fehler") }}</p>
        <p v-else-if="stand && stand.editoren.length === 0" class="editoren__satz">{{ t("editoren.leer") }}</p>

        <template v-else>
            <div class="editoren__gruppen" data-testid="editoren-liste">
                <AvmDisclosure
                    v-for="gruppe in gruppen"
                    :key="gruppe.id"
                    v-model:open="gruppeOffen[gruppe.id]"
                    :label="gruppe.name"
                    :secondary="formatNumber(gruppe.personen.length, 0)"
                    :toggle-testid="`editoren-gruppe-${gruppe.id}`"
                >
                    <ul class="editoren__liste">
                        <li v-for="person in gruppe.personen" :key="person.id">
                            <EditorStatusKarte
                                :person="person"
                                :offen="offen === person.id"
                                :jetzt="jetzt"
                                :ansicht-name="person.online ? ansichtName(person.ansicht) : null"
                                @klappe="offen = offen === person.id ? undefined : person.id"
                                @zeigen="(ziel: ObjektZiel, id: string) => emit('zeigen', ziel, id)"
                            />
                        </li>
                    </ul>
                </AvmDisclosure>
            </div>
            <AvmKreisLegende
                v-if="stand"
                :namen="{
                    voll: t('editoren.kreis.bearbeitet'),
                    halb: t('editoren.kreis.online'),
                    leer: t('editoren.kreis.weg'),
                }"
                :zahlen="zahlen"
                :beschriftung="t('editoren.legende')"
                testid="editoren-legende"
            />
        </template>
    </section>
</template>

<style scoped>
.editoren {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.editoren__titel {
    margin: 0;
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--color-text-muted);
}

.editoren__satz {
    margin: 0;
    font-size: var(--font-size-caption);
    color: var(--color-text-muted);
}

.editoren__gruppen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.editoren__liste {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}
</style>
