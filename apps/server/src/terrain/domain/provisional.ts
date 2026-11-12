/**
 * Der vorläufige Master einer lokalen Veröffentlichung (JOBS-0001 D6 = B, WI-0125): der vorige Master, in den die Rechenkacheln des
 * Fußabdrucks eingesetzt sind. Er gehört zu keinem vollen Lauf.
 *
 * 🔴 Seine `input_fingerprint` ist die der Eingaben, mit denen der Fußabdruck gerechnet wurde, mit diesem Präfix davor. So erkennt
 * `derive:terrain` ihn nie als „mit diesen Eingaben schon gerechnet“ (die Abfrage vergleicht die ganze Zeichenkette), und der
 * gesammelte volle Lauf rechnet und löst ihn ab. Der Prüfer liest das Präfix, um ihn als vorläufig zu benennen.
 */
export const PROVISIONAL_INPUT_PREFIX = "lokal:";
