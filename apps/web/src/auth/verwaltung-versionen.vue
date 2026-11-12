<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { versionGruppen, type ReleaseVoll, type VerlaufCommit } from "@avesmaps3d/shared";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import { isMessageKey, t } from "../i18n/i18n";
import CommitVerweis from "./commit-verweis.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VersionenListe from "./versionen-liste.vue";
import { suchtreffer } from "../controls/avm-listenleiste";
import { vergleichLink, wann, type Versionen } from "./versionen";

/**
 * Der Eintrag „Versionen“ der Systemsteuerung (WI-0137, VERSION-0001 §4, Blatt 1): oben das laufende Release (Commit, Datum, `RELEASE_ID`,
 * Titel, Zahlen, Vergleich auf GitHub), darunter seine Änderungen nach Arbeitspaket, Doku erst hinter „Auch Doku zeigen“ (1 B); darunter die
 * früheren Releases zugeklappt. Die Liste entsteht beim Release-Schnitt und reist mit; der Server fragt GitHub nicht.
 *
 * Über der Liste die Leiste jeder Liste (`AvmListenleiste`, Koordination 2026-10-11), hier nur mit der Suche: Versionen hat keine echten
 * Filter, und „Auch Doku zeigen“ bleibt der Aufklapper unter der Liste (Katalog-Blatt, Punkt 4).
 */
const props = defineProps<{ versionen: Versionen; telefon: boolean }>();
const mitDoku = ref(false);
/** Die Suche in den Änderungen des laufenden Release (`gesuchteGruppen`). */
const suche = ref("");
const offen = ref<Set<string>>(new Set());

onMounted(() => void props.versionen.load());

const liste = computed(() => props.versionen.liste.value);
const laufend = computed(() => liste.value?.laufend ?? null);
const pakete = computed(() =>
    laufend.value === null
        ? 0
        : versionGruppen(laufend.value.commits, laufend.value.pakete, false).filter((g) => g.id !== "sonstiges").length,
);

/**
 * Der Verlauf des laufenden Stands (Stage rollt jeden Push ohne Release-Schnitt aus): die Commits der Anwendung, Doku erst mit dem Schalter,
 * mit derselben Suche wie die Änderungen des Release.
 */
const verlaufAlle = computed(() => liste.value?.verlauf?.commits ?? []);
const verlaufZeilen = computed(() =>
    verlaufAlle.value.filter(
        (commit) =>
            (mitDoku.value || commit.anwendung) &&
            suchtreffer([commit.titel, commit.sha, ...commit.neu].join(" "), suche.value),
    ),
);
const verlaufDoku = computed(() => verlaufAlle.value.filter((commit) => !commit.anwendung).length);
const artName = (commit: VerlaufCommit): string | null => {
    const key = `versionen.art.${commit.art ?? ""}`;
    return commit.art !== null && isMessageKey(key) ? t(key) : null;
};

/** Die geladenen Commits eines früheren Release, sobald sie da sind. */
function geladen(stamm: string): ReleaseVoll | undefined {
    const eintrag = props.versionen.frueher.value[stamm];
    return typeof eintrag === "object" && eintrag !== null ? eintrag : undefined;
}

function umschalten(stamm: string): void {
    const neu = new Set(offen.value);
    if (neu.has(stamm)) neu.delete(stamm);
    else {
        neu.add(stamm);
        void props.versionen.aufklappen(stamm);
    }
    offen.value = neu;
}
</script>

<template>
    <div class="versionen" data-testid="versionen">
        <VerwaltungLadeproblem
            :problems="props.versionen.loadProblems.value"
            :fehlt="props.versionen.unconfirmed.value"
            testid="versionen-ladefehler"
            @bestaetigen="props.versionen.confirmAgain()"
        />
        <p v-if="liste === null && props.versionen.loading.value" class="leise">{{ t("admin.loading") }}</p>
        <p
            v-else-if="liste !== null && laufend === null && verlaufAlle.length === 0"
            class="leise"
            data-testid="versionen-leer"
        >
            {{ t("versionen.empty") }}
        </p>

        <section v-if="verlaufAlle.length > 0 && laufend === null" class="verlauf" data-testid="versionen-verlauf">
            <span class="augenbraue">{{ t("versionen.verlauf") }}</span>
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('versionen.search')"
                :beschriftung="t('versionen.searchLabel')"
                testid="versionen-verlauf-leiste"
            />
            <p v-if="verlaufZeilen.length === 0" class="leise">{{ t("versionen.searchEmpty") }}</p>
            <ul v-else class="verlauf__liste">
                <li v-for="commit in verlaufZeilen" :key="commit.sha" class="verlauf__zeile">
                    <CommitVerweis :sha="commit.sha" />
                    <span v-if="artName(commit) !== null" class="verlauf__art">{{ artName(commit) }}</span>
                    <span class="verlauf__titel">{{ commit.neu[0] ?? commit.titel }}</span>
                </li>
            </ul>
            <p v-if="verlaufDoku > 0" class="leise">
                <button
                    type="button"
                    class="link schalter"
                    :aria-pressed="mitDoku"
                    data-testid="versionen-verlauf-doku"
                    @click="mitDoku = !mitDoku"
                >
                    {{ mitDoku ? t("versionen.hideDocs") : t("versionen.showDocs", { n: verlaufDoku }) }}
                </button>
            </p>
        </section>

        <template v-if="laufend !== null && liste !== null">
            <div class="kopf" data-testid="versionen-kopf">
                <span class="augenbraue">{{ t("versionen.current") }}</span>
                <div class="kopf__release">
                    <CommitVerweis :sha="laufend.bis" />
                    <span class="kopf__datum">{{ wann(laufend.datum, true) }}</span>
                    <span class="leise kopf__id">{{
                        liste.releaseId === "dev"
                            ? t("versionen.local")
                            : t("versionen.releaseId", { id: liste.releaseId })
                    }}</span>
                </div>
                <p v-if="laufend.titel !== ''" class="kopf__titel">{{ laufend.titel }}</p>
                <p class="leise kopf__zahlen">
                    {{ t("versionen.counts", { n: laufend.zahl, from: laufend.von.slice(0, 8), packages: pakete }) }}
                    <template v-if="!props.telefon">
                        ·
                        <a class="link" :href="vergleichLink(laufend)" target="_blank" rel="noopener">{{
                            t("versionen.compare")
                        }}</a>
                    </template>
                </p>
            </div>

            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('versionen.search')"
                :beschriftung="t('versionen.searchLabel')"
                testid="versionen-leiste"
            />
            <VersionenListe :release="laufend" :mit-doku="mitDoku" :suche="suche" :telefon="props.telefon" />
            <p v-if="laufend.doku > 0" class="leise">
                <button
                    type="button"
                    class="link schalter"
                    :aria-pressed="mitDoku"
                    data-testid="versionen-doku"
                    @click="mitDoku = !mitDoku"
                >
                    {{ mitDoku ? t("versionen.hideDocs") : t("versionen.showDocs", { n: laufend.doku }) }}
                </button>
            </p>

            <div v-if="liste.frueher.length > 0" class="frueher" data-testid="versionen-frueher">
                <span class="augenbraue">{{ t("versionen.earlier") }}</span>
                <ul class="frueher__liste">
                    <li v-for="release in liste.frueher" :key="release.stamm">
                        <button
                            type="button"
                            class="zu"
                            :class="{ 'zu--offen': offen.has(release.stamm) }"
                            :aria-expanded="offen.has(release.stamm)"
                            :data-testid="`versionen-frueher-${release.stamm}`"
                            @click="umschalten(release.stamm)"
                        >
                            <svg class="zu__winkel" viewBox="0 0 6 8" aria-hidden="true">
                                <path
                                    d="M1.25 1 4.5 4 1.25 7"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="1.5"
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                />
                            </svg>
                            <span class="zu__sha">{{ release.bis.slice(0, 8) }}</span>
                            <span class="zu__leise">{{ wann(release.datum, true) }}</span>
                            <span class="zu__leise">{{ t("versionen.changes", { n: release.zahl }) }}</span>
                            <span class="zu__titel einzeilig">{{ release.titel }}</span>
                        </button>
                        <div v-if="offen.has(release.stamm)" class="frueher__inhalt">
                            <p v-if="props.versionen.frueher.value[release.stamm] === 'laedt'" class="leise">
                                {{ t("admin.loading") }}
                            </p>
                            <p
                                v-else-if="props.versionen.frueher.value[release.stamm] === null"
                                class="problem"
                                role="alert"
                            >
                                {{ t("versionen.loadFailed") }}
                            </p>
                            <VersionenListe
                                v-else-if="geladen(release.stamm) !== undefined"
                                :release="geladen(release.stamm)!"
                                :mit-doku="mitDoku"
                                :telefon="props.telefon"
                            />
                        </div>
                    </li>
                </ul>
            </div>
        </template>
    </div>
</template>

<style scoped>
.versionen {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    min-width: 0;
    color: var(--color-text);
}

.verlauf,
.verlauf__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.verlauf__liste {
    margin: 0;
    padding: 0;
    list-style: none;
    gap: var(--space-4);
}

.verlauf__zeile {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    min-width: 0;
}

.verlauf__art {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.verlauf__titel {
    min-width: 0;
    overflow-wrap: anywhere;
}

.augenbraue {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.problem {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.kopf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.kopf__release {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4) var(--space-10);
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
}

.kopf__datum {
    font-variant-numeric: tabular-nums;
}

.kopf__id {
    font-variant-numeric: tabular-nums;
}

.kopf__titel {
    margin: 0;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.link {
    color: var(--color-link);
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    white-space: nowrap;
}

.link:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.link:focus-visible,
.zu:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.schalter {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
}

.frueher {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.frueher__liste {
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--color-divider);
    list-style: none;
}

.frueher__inhalt {
    padding: var(--space-6) 0 var(--space-10) var(--space-12);
    border-bottom: 1px solid var(--color-divider);
}

.zu {
    display: grid;
    grid-template-columns: var(--space-8) auto auto auto minmax(0, 1fr);
    gap: var(--space-8);
    align-items: baseline;
    width: 100%;
    padding: var(--space-6) var(--space-4);
    border: 0;
    border-bottom: 1px solid var(--color-divider);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-small);
    text-align: left;
    cursor: pointer;
    transition: background-color 120ms ease;
}

.zu:hover {
    background: var(--color-hover-wash);
}

.zu__winkel {
    width: 6px;
    height: 8px;
    color: var(--color-text-muted);
    transition: transform 120ms ease;
}

.zu--offen .zu__winkel {
    transform: rotate(90deg);
}

.zu__sha {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.zu__leise {
    color: var(--color-text-muted);
    white-space: nowrap;
}

.zu__titel {
    color: var(--color-text-muted);
}

@media (max-width: 600px) {
    .zu {
        grid-template-columns: var(--space-8) auto minmax(0, 1fr);
    }

    .zu__titel {
        grid-column: 2 / -1;
        white-space: normal;
    }

    .frueher__inhalt {
        padding-left: 0;
    }
}
</style>
