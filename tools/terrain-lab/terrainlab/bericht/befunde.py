"""Was die Untersuchung der Regler erwarten ließ (WI-0249 P4, ``project-control/discovery/wi-0249-regler/befund.md``) neben dem, was die Sensitivität misst.

Die Klassen sind die des P4-Befunds in Anteilen der Kammhöhe (ohne Wirkung 0,0 %, schwach unter 3 %, wirkt 3 bis 15 %, stark darüber), gemessen am Rückennetz in der
groben Vorschau mit Talboden des Typs. Die Sensitivität des Labors misst etwas Verwandtes (Wirkung auf Abstand zur Referenz und Formverlust, relativ zum stärksten Parameter);
beide Skalen sind nicht gleich, darum gilt als Abweichung erst ein Abstand von zwei Klassen („P4: wirkt, hier wirkungslos“, „P4: schwach, hier stark“, „P4: ohne, hier wirkt“).
Die Abweichungen sind Gesprächsstoff, kein Fehler einer der beiden Seiten: P4 misst die Höhe in Prozent der Kammhöhe an den Vorgaben des Typs, der Morris-Lauf die Wirkung auf Abstand und Formverlust im ganzen Suchraum samt Wechselwirkung mit dem Muster.
"""

from __future__ import annotations

# Parametername → (Erwartung, Text). Erwartung: ohne | schwach | wirkt | stark.
P4: dict[str, tuple[str, str]] = {
    "v12.hypsometrie": ("ohne", "grobe Vorschau 0,0 % (der Regler wird dort nicht gelesen); wirkt erst bei abgeleitetem Talboden, dort nur von 0,1 bis rund 0,4"),
    "v12.plateau": ("wirkt", "im Rückennetz die Kammschärfe, 10 % der Kammhöhe; übersteuert den Typwert form.schaerfe"),
    "v12.rauschen": ("schwach", "3,4 % im Rückennetz (unter „zellen“ 5 bis 10 %); übersteuert form.rauschen"),
    "v12.einschnitt": ("schwach", "1,0 %; wirkt nur mit Flüssen im Gebirge"),
    "v12.erosion": ("schwach", "2,2 % im Rückennetz (form.erhalt blendet die unerodierte Form wieder ein); übersteuert form.erosion"),
    "v12.talbreite": ("schwach", "2,5 %; nur mit Gewässern"),
    "v12.koernung": ("schwach", "1,8 % unter „rauschen“, 3 bis 4 % unter „zellen“; übersteuert form.koernung"),
    "v12.stufen": ("schwach", "1,1 %; unter „zellen“ exakt 0"),
    "v12.bergform": ("wirkt", "16 % im Rückennetz (Exponent des Rückenquerschnitts); in der V12 nur an überragenden Gipfeln"),
    "v12.sattel": ("schwach", "0,8 % im Rückennetz"),
    "muster": ("wirkt", "3,9 % im Rückennetz"),
    "netz.struktur.welle": ("ohne", "höchstens 0,6 %"),
    "netz.struktur.astAbstand": ("schwach", "nur beim größten Gebirge sichtbar"),
    "netz.struktur.astLaenge": ("schwach", "schwach bis wirkt, nur beim größten Gebirge sichtbar"),
    "netz.form.breite": ("stark", "6 bis 25 % der Kammhöhe: größter Formregler nach dem Talboden"),
    "netz.form.schaerfe": ("ohne", "übersteuert durch plateau (exakt 0,0 %)"),
    "netz.form.talboden": ("stark", "grobe Vorschau 26 bis 49 %; im Geländepfad fast tot (nur Untergrenze der Suche)"),
    "netz.form.rauschen": ("ohne", "übersteuert durch rauschen"),
    "netz.form.koernung": ("ohne", "übersteuert durch koernung"),
    "netz.form.randBreite": ("wirkt", "3 bis 7 %"),
    "netz.form.erosion": ("ohne", "übersteuert durch erosion"),
    "netz.form.erhalt": ("wirkt", "3 bis 8 %"),
    "netz.form.grat": ("wirkt", "4 bis 9 %"),
    "netz.form.gratBreite": ("schwach", "2 bis 5 %"),
    "netz.band.ziel": ("ohne", "grobe Vorschau 0,0 % (durch hypsometrie > 0 übersteuert)"),
    "netz.gratMin": ("ohne", "grob 0,0 %; wirkt nur in der Ableitung des Talbodens"),
}

_GEMESSEN = {"wirkungslos": 0, "ohne Messung": 0, "schwach": 1, "wirkt": 2, "stark": 3}
_ERWARTET = {"ohne": 0, "schwach": 1, "wirkt": 2, "stark": 3}


def abgleich(name: str, klasse: str) -> tuple[str, str]:
    """(Erwartung, Urteil) zu einem Parameter: ``passt``, ``weicht ab`` (zwei Klassen Abstand) oder ``-`` ohne P4-Angabe. Der Text steht in ``P4``."""
    p = P4.get(name)
    if p is None:
        return "-", "-"
    e, g = _ERWARTET[p[0]], _GEMESSEN.get(klasse, 0)
    return p[0], "weicht ab" if abs(e - g) >= 2 else "passt"
