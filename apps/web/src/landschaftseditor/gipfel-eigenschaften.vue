<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
    LANDMARKEN_ARTEN,
    LANDMARKEN_KATALOG,
    LANDMARKEN_MERKMALE,
    PEAK_HEIGHT_MAX,
    formtGelaende,
    merkmaleDerArt,
    type EditorPeakDetail,
    type LandmarkenArt,
    type LandmarkenMerkmal,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import type { Bearbeitung } from "../fenster/bearbeitung";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { Verlauf } from "../fenster/entwurf-verlauf";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import TraegerKarten from "../fenster/traeger-karten.vue";
import { useTraegerKarten } from "../fenster/traeger-karten";
import TraegerQuellen from "../fenster/traeger-quellen.vue";
import WikiBox from "../fenster/wiki-box.vue";
import { formatNumber, t } from "../i18n/i18n";
import { merkmaleGeordnet, type GipfelFelder } from "./gipfel-art";
import { landmarkenartName } from "./landschaften-liste";

/**
 * Die Eigenschaften eines Gipfels oder Vulkans im Derographie-Fenster (WI-0178 P2; EDIT-0003 T55; Orchestrierung 2026-10-18: Gipfel stehen
 * als Zeilen der Ebene Topographie, P3): Name, Höhe, „Auf der Karte anzeigen“ (dasselbe Bauteil und derselbe Wortlaut wie an der Fläche,
 * entschieden 2026-10-18) und die Lage mit „Auf der Karte verschieben“. Alles im EINEN Entwurf des Rumpfs; „Fertig“ steht in der Leiste.
 * Ohne Recht oder mit `MAP_EDITING` aus lesend.
 *
 * „Gipfel entfernen …“ (Editor-Orchestrierung 2026-10-19, wie „Fläche entfernen“): eine Rückfrage im Fenster mit den Folgen vorher (in
 * welchem Gebirge seine Höhe zählt, dass das Gelände im Umkreis neu rechnet, dass der Verlauf ihn zurückholt); „Entfernen“ schreibt sofort
 * (`peak.retire`, weich). Gelöscht liest das Fenster nur und sagt es; ↺ im Verlauf holt ihn zurück.
 *
 * **Jede Landmarkenart** (WI-0271 L4, Entwurf `review/wi-0271/landmarken-entwurf.html`): derselbe Rumpf mit den Reitern Eigenschaften ·
 * Quellen (n) · Verlauf. Identität mit Name, Landmarkenart (in Gruppen) und der gemeinsamen Wiki-Box; der Kasten **Gelände** (Höhe, Gebirge)
 * nur bei Berggipfel und Vulkan (`formtGelaende`, im Entwurf: wechselt die Art, kommt oder geht er sofort); **Merkmale** als Haken, sie ändern
 * das Kartenzeichen nie. Typbilder gibt es im Editor nicht (Vali 2026-10-31: nur im Infopanel).
 */
const props = defineProps<{
    bearbeitung: Bearbeitung<EditorPeakDetail, GipfelFelder, never>;
    /** Darf diese Sitzung schreiben (Recht und `MAP_EDITING`)? */
    darf?: boolean | undefined;
    /** Hat diese Sitzung `edit_mountains`? Sonst lässt sich die Art nicht zu Berggipfel oder Vulkan wechseln (WI-0279, E2a). */
    gelaendeFrei?: boolean | undefined;
    /** Läuft „Auf der Karte verschieben“ an diesem Gipfel? */
    zieht?: boolean | undefined;
    /** Nach „▲ Gipfel setzen …“ (P7) steht der Name markiert; die Zahl zählt den Wunsch, damit derselbe zweimal wirkt. */
    nameMarkieren?: number | undefined;
    /** Ändert die Gipfelliste eines Gebirges gerade diese Höhe (P5), der Satz dazu; dann ruht das Feld hier. */
    hoeheGesperrt?: string | undefined;
    /** Sein Verlauf (↺ an einem Entfernen); fehlt, solange keiner da ist. */
    verlauf?: Verlauf<unknown> | undefined;
    /** „Gipfel entfernen …“; fehlt ohne Schreibrecht. */
    entferne?: (() => Promise<{ ok: true } | { ok: false; satz: string }>) | undefined;
    /** Das Kartenmenü bittet um die Rückfrage; die Zahl zählt den Wunsch, damit derselbe zweimal wirkt. */
    entfernenWunsch?: number | undefined;
    kennung: string;
    /** Das Recht `manage_sources` (Reiter Quellen). */
    quellenRecht?: boolean | undefined;
}>();
const emit = defineEmits<{
    verschiebe: [an: boolean];
    /** Zuweisen, Entfernen oder ein Sync der Wiki-Box änderte die Karte: die Liste neu lesen. */
    erneut: [];
    oeffneQuelle: [sourceId: string];
}>();

const detail = computed(() => props.bearbeitung.detail.value);
const stand = computed(() => props.bearbeitung.stand.value);
const geloescht = computed(() => detail.value?.state === "retired");
const schreibt = computed(() => props.darf === true && stand.value !== undefined && !geloescht.value);
const zustand = computed(() => props.bearbeitung.zustand.value);
const konflikt = computed(() => (zustand.value.art === "konflikt" ? zustand.value : undefined));
const ruht = computed(() => (zustand.value.art === "speichert" ? t("entwurf.speichert") : undefined));
const felder = computed(() => stand.value?.felder);
/** Die Art, wie der Entwurf sie gerade hat: Wechselt sie, kommt oder geht der Kasten „Gelände“ sofort. */
const art = computed((): LandmarkenArt | undefined => felder.value?.art ?? detail.value?.subtype);
const gelaende = computed(() => art.value !== undefined && formtGelaende(art.value));
const artName = computed(() => (art.value === undefined ? "" : landmarkenartName(art.value)));
/** Die Landmarkenarten in den Gruppen des Katalogs (Erhebung, Hohlform, Wasser …). */
const artOptionen = computed(() =>
    LANDMARKEN_ARTEN.filter((wert) => props.gelaendeFrei === true || !formtGelaende(wert)).map((wert) => ({
        wert,
        text: landmarkenartName(wert),
        gruppe: t(`peak.gruppe.${LANDMARKEN_KATALOG[wert].gruppe}`),
    })),
);
const merkmale = computed(() => felder.value?.merkmale ?? detail.value?.merkmale ?? []);
function schalteMerkmal(merkmal: LandmarkenMerkmal, an: boolean): void {
    const jetzt = merkmale.value.filter((m) => m !== merkmal);
    setze({ merkmale: merkmaleGeordnet(an ? [...jetzt, merkmal] : jetzt) });
}
const merkmalName = (merkmal: LandmarkenMerkmal): string => t(`peak.merkmal.${merkmal}`);
const merkmaleText = computed(() =>
    merkmale.value.length === 0
        ? t("landschaftseditor.landmarke.keineMerkmale")
        : merkmale.value.map(merkmalName).join(", "),
);
/** Die Gebirge, in deren Teilflächen der Gipfel liegt (gerechnet, `mountains`). */
const gebirgeText = computed(() => {
    const gebirge = detail.value?.mountains ?? [];
    return gebirge.length > 0 ? gebirge.map((g) => g.name).join(", ") : t("landschaftseditor.landmarke.keinGebirge");
});
const entfernenText = computed(() =>
    detail.value !== undefined && formtGelaende(detail.value.subtype)
        ? t("landschaftseditor.gipfel.entfernen")
        : t("landschaftseditor.landmarke.entfernen"),
);
type Reiter = "eigenschaften" | "quellen" | "karten" | "verlauf";
const reiter = ref<Reiter>("eigenschaften");
/** Die Karten der Kartensammlung, die diese Landmarke abbilden: Der Reiter steht nur, wenn es welche gibt. */
const karten = useTraegerKarten(
    () => (detail.value === undefined ? undefined : { kind: "peak", id: detail.value.id }),
    () => {
        if (reiter.value === "karten") reiter.value = "eigenschaften";
    },
);
const quellenZahl = ref<number | undefined>(undefined);
watch(
    () => detail.value?.id,
    () => {
        quellenZahl.value = undefined;
    },
);
// Gelöscht holt ↺ im Verlauf sie zurück: Der Reiter steht dann dort.
watch(
    geloescht,
    (ja) => {
        if (ja) reiter.value = "verlauf";
    },
    { immediate: true },
);
const reiterListe = computed(() => [
    { id: "eigenschaften" as const, name: t("landschaftseditor.reiter.eigenschaften") },
    {
        id: "quellen" as const,
        name:
            quellenZahl.value === undefined
                ? t("fenster.traegerQuellen.reiterOhne")
                : t("fenster.traegerQuellen.reiter", { n: formatNumber(quellenZahl.value, 0) }),
    },
    ...(karten.value.length > 0
        ? [
              {
                  id: "karten" as const,
                  name: t("fenster.traegerKarten.reiter", { n: formatNumber(karten.value.length, 0) }),
              },
          ]
        : []),
    { id: "verlauf" as const, name: t("landschaftseditor.reiter.verlauf") },
]);
const wikiUngespeichert = computed(() => props.bearbeitung.lage.value.ungespeichert > 0);
function wikiGeaendert(): void {
    void props.bearbeitung.neuLesen();
    emit("erneut");
}
const feldName = (feld: string): string =>
    ({
        name: t("landschaftseditor.feld.name"),
        art: t("landschaftseditor.landmarke.feld.art"),
        merkmale: t("landschaftseditor.landmarke.feld.merkmale"),
        hoehe: t("landschaftseditor.gipfel.feld.hoehe"),
        anzeigen: t("landschaftseditor.feld.anzeigen"),
        lage: t("landschaftseditor.gipfel.feld.lage"),
    })[feld] ?? feld;

function setze(neu: Partial<GipfelFelder>, verschmelze?: string): void {
    props.bearbeitung.feld((f) => ({ ...f, ...neu }), verschmelze);
}
function setzeHoehe(ereignis: Event): void {
    const roh = (ereignis.target as HTMLInputElement).value.trim();
    setze({ hoehe: roh === "" ? undefined : Number(roh) });
}
/** Der Griff „Gipfel-001“ wird beim Tippen überschrieben: erst, wenn das Feld steht (der Stand ist gelesen), und je Wunsch einmal. */
const nameFeld = ref<InstanceType<typeof AvmEingabe>>();
let markiert: number | undefined;
watch(
    [() => props.nameMarkieren, schreibt],
    async ([wunsch, bereit]) => {
        if (wunsch === undefined || wunsch === markiert || !bereit) return;
        await nextTick();
        if (nameFeld.value === undefined) return;
        markiert = wunsch;
        nameFeld.value.focus();
        nameFeld.value.select();
    },
    { immediate: true },
);
// --- „Gipfel entfernen …“ ---
const entfernenOffen = ref(false);
const entfernenSendet = ref(false);
const entfernenSatz = ref<string | undefined>(undefined);
watch(
    () => props.entfernenWunsch,
    (wunsch) => {
        if (wunsch !== undefined && !geloescht.value) entfernenOffen.value = true;
    },
    { immediate: true },
);
/** Die Folgen vorher: das Gebirge, in dem seine Höhe zählt, das Gelände (nur Berggipfel und Vulkan), der Weg zurück. */
const entfernenFolgen = computed((): string[] => {
    const gebirge = detail.value?.mountains ?? [];
    if (detail.value === undefined || !formtGelaende(detail.value.subtype))
        return [t("landschaftseditor.landmarke.folgeOhneGelaende"), t("landschaftseditor.landmarke.folgeVerlauf")];
    return [
        gebirge.length > 0
            ? t("landschaftseditor.gipfel.folgeGebirge", { namen: gebirge.map((g) => g.name).join(", ") })
            : t("landschaftseditor.gipfel.folgeGelaende"),
        t("landschaftseditor.gipfel.folgeVerlauf"),
    ];
});
const entfernenGesperrt = computed(() =>
    entfernenSendet.value
        ? t("landschaftseditor.entfernen.sendet")
        : props.bearbeitung.lage.value.aktiv
          ? t("landschaftseditor.entfernen.erstFertig")
          : undefined,
);
async function entfernen(): Promise<void> {
    if (props.entferne === undefined) return;
    entfernenSendet.value = true;
    entfernenSatz.value = undefined;
    const antwort = await props.entferne();
    entfernenSendet.value = false;
    if (antwort.ok) entfernenOffen.value = false;
    else entfernenSatz.value = antwort.satz;
}
const verlaufFeldName = (feld: string): string =>
    ({
        name: t("landschaftseditor.feld.name"),
        subtype: t("landschaftseditor.landmarke.feld.art"),
        merkmale: t("landschaftseditor.landmarke.feld.merkmale"),
        height: t("landschaftseditor.gipfel.feld.hoehe"),
        showName: t("landschaftseditor.feld.anzeigen"),
        position: t("landschaftseditor.gipfel.feld.lage"),
        active: t("verlauf.aktiv"),
    })[feld] ?? feld;
const lage = computed(() => {
    const f = felder.value ?? (detail.value ? { x: detail.value.position[0], y: detail.value.position[1] } : undefined);
    return f === undefined ? "" : `${formatNumber(f.x, 2)} · ${formatNumber(f.y, 2)}`;
});
</script>

<template>
    <div class="gipfel" :data-testid="`${kennung}-gipfel`">
        <p v-if="!detail" class="gipfel__leer">{{ t("landschaftseditor.gipfel.laedt") }}</p>
        <template v-else>
            <div class="gipfel__kopf">
                <strong>{{ detail.name }}</strong>
                <small :data-testid="`${kennung}-gipfel-art-kopf`"
                    >{{ artName }} · {{ t("layer.topographie") }} ·
                    {{
                        gelaende
                            ? t("landschaftseditor.landmarke.formtGelaende")
                            : t("landschaftseditor.landmarke.ohneGelaende")
                    }}</small
                >
            </div>
            <p v-if="geloescht" class="gipfel__geloescht" role="status" :data-testid="`${kennung}-gipfel-geloescht`">
                {{ t("landschaftseditor.gipfel.geloescht") }}
            </p>
            <EntwurfKonflikt
                v-if="konflikt"
                :bearbeitung="bearbeitung"
                :konflikt="konflikt"
                :feld-name="feldName"
                :kennung="kennung"
            />
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('landschaftseditor.reiter')"
                :kennung="`${kennung}-gipfel`"
            />
            <div
                :id="`${kennung}-gipfel-inhalt-${reiter}`"
                class="gipfel__rumpf"
                role="tabpanel"
                :data-testid="`${kennung}-gipfel-${reiter}`"
            >
                <template v-if="reiter === 'eigenschaften'">
                    <section class="gipfel__abschnitt">
                        <h4 class="gipfel__titel">{{ t("landschaftseditor.abschnitt.identitaet") }}</h4>
                        <FensterFeldzeilen>
                            <dt>{{ t("landschaftseditor.feld.name") }}</dt>
                            <dd v-if="schreibt && stand">
                                <AvmEingabe
                                    ref="nameFeld"
                                    :model-value="stand.felder.name"
                                    :gesperrt="ruht"
                                    :aria-label="t('landschaftseditor.feld.name')"
                                    :testid="`${kennung}-gipfel-name`"
                                    @update:model-value="(name: string) => setze({ name }, 'name')"
                                    @blur="bearbeitung.feldVerlassen()"
                                />
                            </dd>
                            <dd v-else>{{ detail.name }}</dd>
                            <dt>{{ t("landschaftseditor.landmarke.feld.art") }}</dt>
                            <dd v-if="schreibt && stand">
                                <AvmAuswahl
                                    :model-value="stand.felder.art"
                                    :optionen="artOptionen"
                                    :gesperrt="ruht"
                                    :aria-label="t('landschaftseditor.landmarke.feld.art')"
                                    :testid="`${kennung}-gipfel-art`"
                                    @update:model-value="(wert: string) => setze({ art: wert as LandmarkenArt })"
                                />
                            </dd>
                            <dd v-else>{{ artName }}</dd>
                        </FensterFeldzeilen>
                        <WikiBox
                            :id="detail.id"
                            art="gipfel"
                            :recht="schreibt ? 'schreiben' : 'lesen'"
                            :ungespeichert="wikiUngespeichert"
                            :felder="[]"
                            :lesestand="detail.revision"
                            :kennung="`${kennung}-gipfel`"
                            @geaendert="wikiGeaendert"
                        />
                    </section>
                    <section v-if="gelaende" class="gipfel__abschnitt" :data-testid="`${kennung}-gipfel-gelaende`">
                        <h4 class="gipfel__titel">
                            {{ t("landschaftseditor.landmarke.abschnitt.gelaende") }}
                            <small>{{ t("landschaftseditor.landmarke.nurBergUndVulkan") }}</small>
                        </h4>
                        <FensterFeldzeilen>
                            <dt>{{ t("landschaftseditor.gipfel.feld.hoehe") }}</dt>
                            <dd v-if="schreibt && stand">
                                <AvmFeld
                                    type="number"
                                    min="0"
                                    :max="String(PEAK_HEIGHT_MAX)"
                                    step="1"
                                    class="gipfel__zahl"
                                    :value="stand.felder.hoehe ?? ''"
                                    :placeholder="t('landschaftseditor.gipfel.ohneHoehe')"
                                    :disabled="ruht !== undefined || hoeheGesperrt !== undefined"
                                    :title="hoeheGesperrt"
                                    :aria-label="t('landschaftseditor.gipfel.feld.hoehe')"
                                    :data-testid="`${kennung}-gipfel-hoehe`"
                                    @change="setzeHoehe"
                                />
                            </dd>
                            <dd v-else>
                                {{
                                    detail.height === undefined
                                        ? t("landschaftseditor.gipfel.ohneHoehe")
                                        : t("scale.schritt", { n: formatNumber(detail.height, 0) })
                                }}
                            </dd>
                            <dt>{{ t("landschaftseditor.landmarke.feld.gebirge") }}</dt>
                            <dd :data-testid="`${kennung}-gipfel-gebirge`">{{ gebirgeText }}</dd>
                        </FensterFeldzeilen>
                        <p class="gipfel__hinweis">{{ t("landschaftseditor.landmarke.gelaendeHinweis") }}</p>
                    </section>
                    <section class="gipfel__abschnitt" :data-testid="`${kennung}-gipfel-merkmale`">
                        <h4 class="gipfel__titel">
                            {{ t("landschaftseditor.landmarke.feld.merkmale") }}
                            <small>{{ t("landschaftseditor.landmarke.merkmaleHinweis") }}</small>
                        </h4>
                        <div v-if="schreibt && stand" class="gipfel__haken">
                            <AvmKaestchen
                                v-for="merkmal in art === undefined ? LANDMARKEN_MERKMALE : merkmaleDerArt(art)"
                                :key="merkmal"
                                art="checkbox"
                                :checked="merkmale.includes(merkmal)"
                                :gesperrt="ruht"
                                :testid="`${kennung}-gipfel-merkmal-${merkmal}`"
                                @change="(an: boolean) => schalteMerkmal(merkmal, an)"
                            >
                                {{ merkmalName(merkmal) }}
                            </AvmKaestchen>
                        </div>
                        <p v-else class="gipfel__lesen">{{ merkmaleText }}</p>
                    </section>
                    <section class="gipfel__abschnitt">
                        <h4 class="gipfel__titel">{{ t("landschaftseditor.gipfel.abschnitt.karte") }}</h4>
                        <FensterFeldzeilen>
                            <dt>{{ t("landschaftseditor.gipfel.feld.beschriftung") }}</dt>
                            <dd>
                                <AvmKaestchen
                                    art="checkbox"
                                    :checked="stand?.felder.anzeigen ?? detail.showName"
                                    :gesperrt="schreibt ? ruht : t('landschaftseditor.gipfel.nurLesen')"
                                    :testid="`${kennung}-gipfel-anzeigen`"
                                    @change="(an: boolean) => setze({ anzeigen: an })"
                                >
                                    {{ t("landschaftseditor.feld.anzeigen") }}
                                </AvmKaestchen>
                            </dd>
                            <dt>{{ t("landschaftseditor.gipfel.feld.lage") }}</dt>
                            <dd class="gipfel__lage">
                                <span :data-testid="`${kennung}-gipfel-lage`">{{ lage }}</span>
                                <AvmKnopf
                                    v-if="schreibt"
                                    groesse="zeile"
                                    :gesperrt="ruht"
                                    :testid="`${kennung}-gipfel-verschieben`"
                                    @click="emit('verschiebe', zieht !== true)"
                                >
                                    {{
                                        zieht
                                            ? t("landschaftseditor.beschriftung.verschiebenEnde")
                                            : t("landschaftseditor.beschriftung.verschieben")
                                    }}
                                </AvmKnopf>
                            </dd>
                        </FensterFeldzeilen>
                    </section>
                    <section
                        v-if="schreibt && entferne"
                        class="gipfel__abschnitt"
                        :data-testid="`${kennung}-gipfel-entfernen`"
                    >
                        <AvmBestaetigung
                            v-if="entfernenOffen"
                            :frage="t('landschaftseditor.gipfel.entfernenFrage', { name: detail.name })"
                            :bestaetigen="t('landschaftseditor.entfernen.knopf')"
                            :gesperrt="entfernenGesperrt"
                            :testid="`${kennung}-gipfel-entfernen-frage`"
                            @bestaetigen="void entfernen()"
                            @abbrechen="entfernenOffen = false"
                        >
                            <ul class="gipfel__folgen">
                                <li v-for="(satz, i) in entfernenFolgen" :key="i">{{ satz }}</li>
                            </ul>
                        </AvmBestaetigung>
                        <AvmKnopf
                            v-else
                            art="gefahr"
                            groesse="zeile"
                            :gesperrt="entfernenGesperrt"
                            :testid="`${kennung}-gipfel-entfernen-oeffnen`"
                            @click="entfernenOffen = true"
                        >
                            {{ entfernenText }}
                        </AvmKnopf>
                        <p v-if="entfernenSatz" class="gipfel__fehler" role="alert">{{ entfernenSatz }}</p>
                    </section>
                </template>
                <TraegerKarten v-else-if="reiter === 'karten'" :karten="karten" :kennung="`${kennung}-gipfel`" />
                <TraegerQuellen
                    v-else-if="reiter === 'quellen'"
                    :id="detail.id"
                    kind="peak"
                    :recht="quellenRecht === true"
                    :schreibt="schreibt"
                    :kennung="`${kennung}-gipfel`"
                    @zahl="(n: number) => (quellenZahl = n)"
                    @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                />
                <template v-else>
                    <EntwurfVerlauf v-if="verlauf" :verlauf="verlauf" :kennung="kennung" :feld-name="verlaufFeldName" />
                    <p v-else class="gipfel__leer">{{ t("landschaftseditor.gipfel.laedt") }}</p>
                </template>
            </div>
        </template>
    </div>
</template>

<style scoped>
.gipfel {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.gipfel__leer {
    margin: 0;
    color: var(--color-text-muted);
}

.gipfel__kopf {
    display: grid;
    gap: var(--space-2);
}

.gipfel__kopf strong {
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.gipfel__kopf small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Wie die Abschnitte der Fläche (`landschaftseditor-fenster.vue`). */
.gipfel__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.gipfel__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.gipfel__geloescht {
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
    color: var(--color-text);
}

.gipfel__folgen {
    margin: 0;
    padding-left: var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gipfel__fehler {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-small);
}

.gipfel__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.gipfel__titel small {
    margin-left: var(--space-4);
    color: var(--color-text-muted);
    letter-spacing: normal;
    text-transform: none;
}

.gipfel__hinweis,
.gipfel__lesen {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.gipfel__haken {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-10);
}

.gipfel__lage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    font-variant-numeric: tabular-nums;
}
</style>
