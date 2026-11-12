<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
    editorTerritoryParentConsequencesUrl,
    type EditorTerritoryParentConsequences,
    type EditorTerritoryRow,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { formatNumber, locale, t } from "../i18n/i18n";
import { artName } from "./gebiete-liste";

/**
 * „Umhängen“ am Feld „Obergebiet“ (WI-0209 D1; EDIT-0005 §7 D1, EDIT-0003 R13, F24 Ausnahme; Probierblatt `umhaengBlatt`): erst die
 * Wahl des neuen Obergebiets (Suche über die Liste des Editors, nie das Gebiet selbst oder eines seiner Untergebiete; „Keins“ macht es zur
 * Wurzel), dann ein Blatt mit den Folgen (`AvmBestaetigung` im Fenster, kein zweites Fenster). „Umhängen“ nimmt es in den Entwurf,
 * „Fertig“ schreibt es mit den übrigen Feldern als EINE Operation.
 *
 * - **Folgen** liest der Server mit derselben Regel wie N2 (`…/reparent?parent=`): je Band, unter welchem Gebiet die Karte die Flächen
 *   danach zeigt statt vorher; dazu das alte und das neue Obergebiet, die Untergebiete, die mitziehen, und die Herkunft.
 * - **✎ Eigener Wert** (`eigen`): Das Obergebiet kommt nicht mehr aus dem Import (Herkunft `override`). „Obergebiet halten“ und ↺ mit dem
 *   Wiki-Wert kommen mit G6.
 * - `vorschlag`: ein Ziel von außen (Ziehen im Baum); dann steht gleich das Blatt.
 * - **Mehrere** (`mehrere`, Mehrfachauswahl EDIT-0003 T57): EIN Obergebiet für alle gewählten, nie unter eines von ihnen oder ihre
 *   Untergebiete. Das Blatt nennt die Folgen im Baum ohne die Bänder je Gebiet (die rechnet der Server je Gebiet); `gemischt` heißt, die
 *   gewählten hängen heute unter verschiedenen.
 */
const props = defineProps<{
    gebiet: { id: string; name: string };
    /** Das Obergebiet im Entwurf; fehlt bei einer Wurzel. */
    wert: { id: string; name: string } | undefined;
    zeilen: readonly EditorTerritoryRow[];
    eigen: boolean;
    kennung: string;
    vorschlag?: { id: string; name: string } | null | undefined;
    /** Die Mehrfachauswahl: alle gewählten Gebiete; dann gilt `gebiet` nicht. */
    mehrere?: readonly { id: string; name: string }[] | undefined;
    /** Die gewählten hängen heute unter verschiedenen Obergebieten. */
    gemischt?: boolean | undefined;
}>();
const emit = defineEmits<{
    wahl: [parent: { id: string; name: string } | undefined];
    waehle: [id: string];
    vorschlagErledigt: [];
}>();

const offen = ref(false);
const suche = ref("");
/** Das Blatt: das Ziel (null heißt Wurzel) und seine Folgen, solange sie geladen werden ohne. */
const blatt = shallowRef<
    { ziel: { id: string; name: string } | null; folgen?: EditorTerritoryParentConsequences } | undefined
>();
const fehler = ref(false);
let lauf: AbortController | undefined;

/** Das Gebiet und alle seine Untergebiete nach der Liste: Darunter darf es nicht. */
const gesperrt = computed(() => {
    const kinder = new Map<string, string[]>();
    for (const z of props.zeilen)
        if (z.parent !== undefined) kinder.set(z.parent, [...(kinder.get(z.parent) ?? []), z.id]);
    const wurzeln = props.mehrere?.map((g) => g.id) ?? [props.gebiet.id];
    const raus = new Set(wurzeln);
    const offenListe = [...wurzeln];
    while (offenListe.length > 0)
        for (const k of kinder.get(offenListe.pop()!) ?? [])
            if (!raus.has(k)) {
                raus.add(k);
                offenListe.push(k);
            }
    return raus;
});
const GRENZE = 40;
const treffer = computed(() => {
    const frage = suche.value.trim().toLocaleLowerCase(locale.value);
    return props.zeilen.filter(
        (z) =>
            z.deleted !== true &&
            !gesperrt.value.has(z.id) &&
            z.id !== props.wert?.id &&
            (frage === "" || z.name.toLocaleLowerCase(locale.value).includes(frage)),
    );
});

function oeffne(): void {
    offen.value = true;
    suche.value = "";
}
async function zeigeFolgen(ziel: { id: string; name: string } | null): Promise<void> {
    offen.value = false;
    fehler.value = false;
    blatt.value = { ziel };
    lauf?.abort();
    if (props.mehrere !== undefined) return;
    const steuer = new AbortController();
    lauf = steuer;
    try {
        const antwort = await fetch(editorTerritoryParentConsequencesUrl(props.gebiet.id, ziel?.id ?? ""), {
            signal: steuer.signal,
            cache: "no-store",
            headers: { accept: "application/json" },
        });
        if (!antwort.ok) throw new Error(String(antwort.status));
        const folgen = (await antwort.json()) as EditorTerritoryParentConsequences;
        if (lauf === steuer && blatt.value?.ziel === ziel) blatt.value = { ziel, folgen };
    } catch {
        if (lauf === steuer && !steuer.signal.aborted) fehler.value = true;
    }
}
function umhaengen(): void {
    const jetzt = blatt.value;
    if (jetzt === undefined) return;
    if (props.mehrere === undefined && (jetzt.folgen === undefined || jetzt.folgen.kreis)) return;
    blatt.value = undefined;
    emit("wahl", jetzt.ziel ?? undefined);
}
function abbrechen(): void {
    lauf?.abort();
    blatt.value = undefined;
    fehler.value = false;
}
watch(
    () => props.vorschlag,
    (ziel) => {
        if (ziel === undefined) return;
        emit("vorschlagErledigt");
        if ((ziel?.id ?? undefined) === props.wert?.id) return;
        void zeigeFolgen(ziel);
    },
    { immediate: true },
);
onBeforeUnmount(() => lauf?.abort());

const liste = (baender: readonly number[]): string =>
    new Intl.ListFormat(locale.value, { type: "conjunction" }).format(baender.map((b) => String(b)));
const name = (ref: { name: string } | undefined): string => ref?.name ?? t("gebietseditor.umhaengen.keinem");
/** Die Folgen als Zeilen, wie im Probierblatt: Titel und Satz. */
const folgenZeilen = computed((): [string, string][] => {
    if (props.mehrere !== undefined && blatt.value !== undefined) {
        const namen = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(
            props.mehrere.map((g) => g.name),
        );
        const ziel = blatt.value.ziel;
        return [
            [
                t("gebietseditor.umhaengen.neuTitel"),
                ziel
                    ? t("gebietseditor.sammel.umhaengenNeu", { namen, ziel: ziel.name })
                    : t("gebietseditor.sammel.umhaengenWurzel", { namen }),
            ],
            [t("gebietseditor.umhaengen.kartenTitel"), t("gebietseditor.umhaengen.karte")],
            [t("gebietseditor.umhaengen.herkunftTitel"), t("gebietseditor.umhaengen.herkunft")],
        ];
    }
    const f = blatt.value?.folgen;
    if (f === undefined) return [];
    const z: [string, string][] = [];
    if (f.from)
        z.push([
            t("gebietseditor.umhaengen.altTitel"),
            t("gebietseditor.umhaengen.alt", { alt: f.from.name, name: f.name }),
        ]);
    z.push(
        f.to
            ? [
                  t("gebietseditor.umhaengen.neuTitel"),
                  t("gebietseditor.umhaengen.neu", { neu: f.to.name, name: f.name }),
              ]
            : [t("gebietseditor.umhaengen.neuTitel"), t("gebietseditor.umhaengen.wurzel", { name: f.name })],
    );
    if (f.descendants > 0)
        z.push([
            t("gebietseditor.umhaengen.unterTitel"),
            t("gebietseditor.umhaengen.unter", { n: formatNumber(f.descendants, 0) }),
        ]);
    for (const w of f.changes)
        z.push([
            t("gebietseditor.umhaengen.band", { baender: liste(w.bands) }),
            t("gebietseditor.umhaengen.wechsel", { n: formatNumber(w.areas, 0), nach: name(w.to), von: name(w.from) }),
        ]);
    if (f.changes.length === 0)
        z.push([t("gebietseditor.umhaengen.kartenTitel"), t("gebietseditor.umhaengen.keinWechsel")]);
    z.push([t("gebietseditor.umhaengen.kartenTitel"), t("gebietseditor.umhaengen.karte")]);
    z.push([t("gebietseditor.umhaengen.herkunftTitel"), t("gebietseditor.umhaengen.herkunft")]);
    return z;
});
const frage = computed(() => {
    const ziel = blatt.value?.ziel;
    if (props.mehrere !== undefined) {
        const n = formatNumber(props.mehrere.length, 0);
        return ziel
            ? t("gebietseditor.sammel.umhaengenFrage", { n, ziel: ziel.name })
            : t("gebietseditor.sammel.umhaengenFrageWurzel", { n });
    }
    return ziel
        ? t("gebietseditor.umhaengen.frage", { name: props.gebiet.name, ziel: ziel.name })
        : t("gebietseditor.umhaengen.frageWurzel", { name: props.gebiet.name });
});
const sperrSatz = computed(() =>
    props.mehrere !== undefined
        ? undefined
        : fehler.value
          ? t("gebietseditor.umhaengen.fehler")
          : blatt.value?.folgen === undefined
            ? t("gebietseditor.umhaengen.laedt")
            : blatt.value.folgen.kreis
              ? t("gebietseditor.umhaengen.kreis")
              : undefined,
);
</script>

<template>
    <div class="umhaengen" :data-testid="`${kennung}-obergebiet-wahl`">
        <div class="umhaengen__zeile">
            <span v-if="gemischt" class="umhaengen__gemischt">{{ t("fenster.sammel.gemischt") }}</span>
            <button v-else-if="wert" type="button" class="umhaengen__verweis" @click="emit('waehle', wert.id)">
                {{ wert.name }}
            </button>
            <span v-else>{{ t("gebietseditor.obergebiet.keins") }}</span>
            <span v-if="eigen" class="umhaengen__eigen" :title="t('gebietseditor.umhaengen.eigen')">✎</span>
            <button
                v-if="!offen && !blatt"
                type="button"
                class="umhaengen__verweis"
                :data-testid="`${kennung}-obergebiet-aendern`"
                @click="oeffne"
            >
                {{ t("gebietseditor.umhaengen.aendern") }}
            </button>
            <button v-if="offen" type="button" class="umhaengen__verweis" @click="offen = false">
                {{ t("gebietseditor.hauptstadt.abbrechen") }}
            </button>
        </div>
        <template v-if="offen">
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('gebietseditor.umhaengen.suche')"
                :placeholder="t('gebietseditor.umhaengen.suche')"
                :testid="`${kennung}-obergebiet-suche`"
            />
            <ul class="umhaengen__liste" :data-testid="`${kennung}-obergebiet-liste`">
                <li v-if="wert || gemischt">
                    <button type="button" class="umhaengen__wahl" data-wurzel @click="zeigeFolgen(null)">
                        <span class="einzeilig">{{ t("gebietseditor.obergebiet.keins") }}</span>
                    </button>
                </li>
                <li v-for="zeile in treffer.slice(0, GRENZE)" :key="zeile.id">
                    <button
                        type="button"
                        class="umhaengen__wahl"
                        :data-gebiet="zeile.id"
                        @click="zeigeFolgen({ id: zeile.id, name: zeile.name })"
                    >
                        <span class="einzeilig">{{ zeile.name }}</span>
                        <small v-if="zeile.type" class="einzeilig">{{ artName(zeile.type) }}</small>
                    </button>
                </li>
            </ul>
            <p v-if="treffer.length > GRENZE" class="umhaengen__satz">
                {{ t("gebietseditor.hauptstadt.weitere", { n: formatNumber(treffer.length - GRENZE, 0) }) }}
            </p>
        </template>
        <AvmBestaetigung
            v-if="blatt"
            :frage="frage"
            :bestaetigen="t('gebietseditor.umhaengen.bestaetigen')"
            :gesperrt="sperrSatz"
            :testid="`${kennung}-umhaengen-blatt`"
            @bestaetigen="umhaengen"
            @abbrechen="abbrechen"
        >
            <ul v-if="folgenZeilen.length > 0" class="umhaengen__folgen" :data-testid="`${kennung}-umhaengen-folgen`">
                <li v-for="([titel, satz], i) in folgenZeilen" :key="i">
                    <b>{{ titel }}:</b> {{ satz }}
                </li>
            </ul>
        </AvmBestaetigung>
    </div>
</template>

<style scoped>
.umhaengen {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.umhaengen__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-8);
}

.umhaengen__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-accent-strong);
    font: inherit;
    cursor: pointer;
}

.umhaengen__verweis:hover {
    text-decoration: underline;
}

.umhaengen__eigen {
    color: var(--color-text-muted);
}

.umhaengen__gemischt {
    color: var(--color-placeholder);
    font-style: italic;
}

.umhaengen__liste {
    display: grid;
    max-height: 220px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.umhaengen__wahl {
    display: grid;
    width: 100%;
    padding: var(--space-4) var(--space-8);
    border: 0;
    border-bottom: 1px solid var(--color-border);
    background: none;
    color: var(--color-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.umhaengen__wahl:hover {
    background: var(--color-active-wash);
}

.umhaengen__wahl small {
    color: var(--color-text-muted);
}

.umhaengen__satz {
    margin: 0;
    color: var(--color-text-muted);
}

.umhaengen__folgen {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-12);
}
</style>
