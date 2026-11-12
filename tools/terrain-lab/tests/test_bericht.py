"""Bericht: eine statische HTML-Datei aus einem Optimierungslauf, einer Performance-Messung und einem Commit-Vergleich (ohne Generator, ohne Netz)."""

import base64
import json
import re
from html.parser import HTMLParser

import numpy as np
import pytest

from terrainlab.__main__ import main
from terrainlab.bericht import BerichtFehler, erzeuge_bericht
from terrainlab.bericht import grafik
from terrainlab.bericht.befunde import P4, abgleich
from terrainlab.bericht.daten import erkenne
from terrainlab.bericht.seite import h, prozent, sekunden, z
from terrainlab.deskriptoren.synthetisch import fbm
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.lauf.konfig import parse_konfig
from terrainlab.lauf.perf import laufe_perf
from terrainlab.lauf.qualitaet import laufe_qualitaet
from terrainlab.lauf.vergleich import schreibe as schreibe_vergleich
from terrainlab.lauf.vergleich import vergleiche_ergebnisse
from terrainlab.optimierung import Lauf, parse_profil
from terrainlab.raster import Hoehenraster

from test_lauf_attrappe import COMMIT_A, COMMIT_B, Attrappe
from test_optimierung_attrappe import OptAttrappe, referenzen
from test_optimierung_lauf import PROFIL

pytestmark = pytest.mark.filterwarnings("error")


class Pruefer(HTMLParser):
    """Zählt Tags und merkt sich Bilder und Verweise: Das Dokument muss in sich geschlossen sein."""

    def __init__(self) -> None:
        super().__init__()
        self.tags: dict[str, int] = {}
        self.bilder: list[str] = []
        self.verweise: list[str] = []
        self.ids: set[str] = set()
        self.offen: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags[tag] = self.tags.get(tag, 0) + 1
        a = dict(attrs)
        if tag == "img":
            self.bilder.append(a.get("src", ""))
        for k in ("href", "src", "action"):
            if k in a and tag != "img":
                self.verweise.append(a[k])
        if "id" in a:
            self.ids.add(a["id"])
        if tag not in ("meta", "img", "br", "hr", "link", "input"):
            self.offen.append(tag)

    def handle_endtag(self, tag):
        assert self.offen and self.offen[-1] == tag, f"</{tag}> schließt {self.offen[-1:]}"
        self.offen.pop()


def pruefe(pfad):
    text = pfad.read_text(encoding="utf-8")
    p = Pruefer()
    p.feed(text)
    p.close()
    assert p.offen == [], f"nicht geschlossen: {p.offen}"
    assert text.startswith("<!doctype html>") and "<script" not in text, "kein JavaScript"
    assert not re.search(r"""(?:src|href)=["']https?://""", text), "nichts wird nachgeladen"
    for b in p.bilder:
        assert b.startswith("data:image/png;base64,")
        assert base64.b64decode(b.split(",", 1)[1])[:8] == b"\x89PNG\r\n\x1a\n"
    for v in p.verweise:
        assert v.startswith("#") and v[1:] in p.ids, f"Verweis ins Leere: {v}"
    return text, p


@pytest.fixture
def lauf_ordner(tmp_path, monkeypatch):
    referenzen(monkeypatch)
    cache = Zwischenspeicher(tmp_path / "cache")
    lauf = Lauf.neu(parse_profil(PROFIL), OptAttrappe(tmp_path), ordner=tmp_path / "lauf", cache=cache, melde=lambda t: None)
    assert lauf.laufe() == 0
    lauf.schliesse()
    return tmp_path / "lauf", cache


def test_zahlen_und_text_sind_deutsch_und_sicher():
    assert z(0.1234) == "0,123" and z(1234567) == "1 234 567" and z(None) == "-" and z(float("nan")) == "-" and z(True) == "ja"
    assert prozent(0.256) == "25,6 %" and sekunden(1500.0) == "1,5 s" and sekunden(None) == "-"
    assert h("<b>&\"'") == "&lt;b&gt;&amp;&quot;&#x27;"


def test_bericht_zum_optimierungslauf(lauf_ordner, tmp_path):
    ordner, cache = lauf_ordner
    ziel = erzeuge_bericht([ordner], tmp_path / "b" / "bericht.html", cache=tmp_path / "cache", labor=tmp_path / "labor")
    text, p = pruefe(ziel)
    for abschnitt in ("zusammenfassung", "qualitaet", "formerhalt", "referenz", "performance", "regression", "bilder", "profile", "parameter", "anhang"):
        assert abschnitt in p.ids
    # Drei Dimensionen getrennt, kein Gesamtwert.
    assert "Plausibilität: Abstand zur Referenz" in text and "Formerhalt gegen die gezeichnete Form" in text and "Effizienz (kalter Lauf" in text
    assert "Gesamtwert" in text and "nie ein Gesamtwert" in text
    assert "Nebengipfel: Höhe an der gesetzten Lage" in text and "Kammrelief quer" in text
    assert "Sensitivität (Morris" in text and "Strategievergleich" in text and "Validierung" in text
    assert "Nach WI-0249" in text and "Gilt nur für diesen Generator-Stand" in text
    assert "Schummerung aus den echten Höhen" in text and "<img" in text
    # Bilder: Sensitivität, Pareto, Verteilungen, Querprofile, Schummerungen (Referenz, Vorgabe, Kandidat in drei Maßstäben).
    assert len(p.bilder) >= 12, len(p.bilder)
    assert len(text) < 15_000_000


def test_bild_vergleich_im_gleichen_massstab(lauf_ordner, tmp_path):
    ordner, _ = lauf_ordner
    text, p = pruefe(erzeuge_bericht([ordner], tmp_path / "b.html", cache=tmp_path / "cache", labor=tmp_path / "labor"))
    # Jedes Schummerungsbild trägt Breite und Höhe in Bildpunkten, aus Zellzahl, Zellweite und 200 m je Bildpunkt.
    masse = re.findall(r"<img src='data:image/png;base64,[^']+' width='(\d+)' height='(\d+)' alt='([^']+)'>", text)
    assert masse, "keine Schummerungsbilder"
    for breite, hoehe, alt in masse:
        zellen = re.search(r"(\d+)×(\d+) Zellen à ([\d.]+) m", text[text.index(alt):])
        assert zellen, alt
        w, hh, zg = int(zellen.group(1)), int(zellen.group(2)), float(zellen.group(3))
        assert abs(int(breite) - round(w * zg / grafik_m_je_px())) <= 1 and abs(int(hoehe) - round(hh * zg / grafik_m_je_px())) <= 1, alt


def grafik_m_je_px():
    from terrainlab.bericht.abschnitte import M_JE_PX

    return M_JE_PX


def test_schummerung_aus_echten_hoehen_deterministisch_und_massstab():
    r = fbm((60, 80), 750.0, relief_m=2000.0, seed=2)
    png1, (w, hh) = grafik.schummerung(r, 200.0)
    png2, _ = grafik.schummerung(r, 200.0)
    assert png1 == png2, "gleiche Höhen, gleiche Beleuchtung: dasselbe Bild"
    assert (w, hh) == (round(80 * 750 / 200), round(60 * 750 / 200))
    # Dasselbe Gelände in feinerer Zellweite hat denselben Bildmaßstab.
    fein = Hoehenraster(np.kron(r.hoehen, np.ones((2, 2), dtype=np.float32)), 375.0, {})
    assert grafik.schummerung(fein, 200.0)[1] == (w, hh)
    # NoData ist weiß, Gelände nicht.
    h = r.hoehen.copy()
    h[:, :20] = np.nan
    from PIL import Image
    import io

    bild = np.asarray(Image.open(io.BytesIO(grafik.schummerung(Hoehenraster(h, 750.0, {}), 200.0, massstab_km=None)[0])).convert("L"))
    assert (bild[:, :50] == 255).all() and (bild[:, 120:] < 255).mean() > 0.95
    with pytest.raises(ValueError):
        grafik.schummerung(Hoehenraster(np.full((4, 4), np.nan, dtype=np.float32), 750.0, {}), 200.0)


def test_befund_p4_abgleich():
    assert abgleich("v12.hypsometrie", "wirkungslos") == ("ohne", "passt")
    assert abgleich("v12.hypsometrie", "stark") == ("ohne", "weicht ab") and abgleich("v12.hypsometrie", "wirkt") == ("ohne", "weicht ab") and abgleich("v12.hypsometrie", "schwach")[1] == "passt"
    assert abgleich("netz.form.talboden", "wirkungslos")[1] == "weicht ab" and abgleich("netz.form.talboden", "stark")[1] == "passt"
    assert abgleich("v12.bergform", "wirkungslos")[1] == "weicht ab", "P4: wirkt (16 %), hier exakt null: der auffälligste Unterschied des Durchstichs"
    assert abgleich("unbekannt", "stark") == ("-", "-")
    assert set(P4) >= {"muster", "v12.erosion", "netz.gratMin"} and all(e in ("ohne", "schwach", "wirkt", "stark") for e, _ in P4.values())


def _messung_und_vergleich(tmp_path):
    cache = Zwischenspeicher(tmp_path / "mc")
    konfig = parse_konfig({"name": "q", "qualitaet": {"gruppen": ["hoehe", "hang"], "ohne_teuer": True},
                           "faelle": [{"name": "eins", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "vorschau": {"aufloesung": 1}}]})
    a, b = Attrappe(commit=COMMIT_A, relief_m=1500.0), Attrappe(commit=COMMIT_B, relief_m=2500.0)
    qa = laufe_qualitaet(konfig, a, tmp_path / "qa", cache=cache)
    qb = laufe_qualitaet(konfig, b, tmp_path / "qb", cache=cache)
    v = vergleiche_ergebnisse(qa, tmp_path / "qa", qb, tmp_path / "qb", {"hoehe_relief": {"richtung": "hoeher"}})
    schreibe_vergleich(v, tmp_path / "vergleich" / "vergleich.json")
    perf_konfig = parse_konfig({"name": "p", "wiederholungen": 2, "warm": 1, "phasen": "erster",
                                "faelle": [{"name": "blutzinnen-1x", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "vorschau": {"aufloesung": 1}}]})
    laufe_perf(perf_konfig, Attrappe(), tmp_path / "perf")
    return tmp_path / "vergleich", tmp_path / "perf", tmp_path / "qa"


def test_bericht_nur_zu_messungen_und_vergleich(tmp_path):
    vergleich, perf, qualitaet = _messung_und_vergleich(tmp_path)
    assert erkenne(vergleich) == "vergleich" and erkenne(perf) == "perf" and erkenne(qualitaet) == "qualitaet"
    text, p = pruefe(erzeuge_bericht([vergleich, perf, qualitaet], tmp_path / "m.html", labor=tmp_path / "labor"))
    assert "Vergleich " in text and "Auffällige Regressionen" in text and "Messung „p“" in text and "blutzinnen-1x" in text
    assert "Phasen (Anteil an der Rechenzeit)" in text and "Qualitätsmessung „q“" in text and len(p.bilder) >= 1
    # Das Ziel hoehe_relief: höher ist besser; B hat mehr Relief, also steht eine Verbesserung im Bericht.
    assert "Verbesserungen" in text


def test_bericht_zum_lauf_mit_perf_und_vergleich(lauf_ordner, tmp_path):
    vergleich, perf, _ = _messung_und_vergleich(tmp_path)
    ordner, _ = lauf_ordner
    text, _ = pruefe(erzeuge_bericht([ordner], tmp_path / "g.html", cache=tmp_path / "cache", labor=tmp_path / "labor", perf=[perf], vergleich=[vergleich]))
    assert "Messung „p“" in text and "Vergleich " in text and "Kein Commit-Vergleich angegeben" not in text


def test_fehler_und_befehl(lauf_ordner, tmp_path, capsys):
    ordner, _ = lauf_ordner
    with pytest.raises(BerichtFehler):
        erzeuge_bericht([tmp_path / "gibt-es-nicht"])
    (tmp_path / "x.json").write_text(json.dumps({"format": "unbekannt"}), encoding="utf-8")
    with pytest.raises(BerichtFehler):
        erkenne(tmp_path / "x.json")
    with pytest.raises(BerichtFehler):
        erkenne(tmp_path)
    assert main(["bericht", str(tmp_path / "nix")]) == 2
    ziel = tmp_path / "cli" / "b.html"
    assert main(["bericht", str(ordner), "--ausgabe", str(ziel), "--cache", str(tmp_path / "cache")]) == 0
    assert ziel.exists() and "Bericht:" in capsys.readouterr().out
    pruefe(ziel)


def test_bericht_ohne_raster_im_zwischenspeicher_meldet_statt_abzubrechen(lauf_ordner, tmp_path):
    ordner, _ = lauf_ordner
    text, _ = pruefe(erzeuge_bericht([ordner], tmp_path / "leer.html", cache=tmp_path / "nichts-da", labor=tmp_path / "labor"))
    assert "nicht mehr" in text or "Zwischenspeicher" in text


def test_aeltere_vergleichsdatei_ohne_geaendert_wird_gelesen(tmp_path):
    """Die Vergleichsdateien früherer Läufe tragen nicht alle Schlüssel der heutigen (``geaendert``): Der Bericht liest sie trotzdem."""
    vergleich, _, _ = _messung_und_vergleich(tmp_path)
    datei = vergleich / "vergleich.json"
    j = json.loads(datei.read_text(encoding="utf-8"))
    for f in j["faelle"]:
        f.pop("geaendert", None)
    datei.write_text(json.dumps(j), encoding="utf-8")
    text, _ = pruefe(erzeuge_bericht([vergleich], tmp_path / "alt.html", labor=tmp_path / "labor"))
    assert "Vergleich " in text


def _nachmessung(lauf_ordner, tmp_path):
    from terrainlab.optimierung.nachmessung import nachmessen

    ordner, cache = lauf_ordner
    datei = next(ordner.glob("vorschlag-probe-*.json"))
    v = json.loads(datei.read_text(encoding="utf-8"))
    v["typen"]["kettengebirge"].update(status="bestaetigt", kandidat={"v12.rauschen": 0.3, "v12.koernung": 5.0, "v12.gibtsnicht": 1})
    neu = tmp_path / "vorschlag.json"
    neu.write_text(json.dumps(v), encoding="utf-8")
    nachmessen(neu, "HEAD", OptAttrappe(tmp_path / "n"), ordner=tmp_path / "nm", cache=cache)
    return tmp_path / "nm"


def test_bericht_zur_nachmessung_allein_und_zum_lauf(lauf_ordner, tmp_path):
    nm = _nachmessung(lauf_ordner, tmp_path)
    assert erkenne(nm) == "nachmessung" and erkenne(nm / "nachmessung.json") == "nachmessung"
    text, p = pruefe(erzeuge_bericht([nm], tmp_path / "nm.html", labor=tmp_path / "labor"))
    assert "Nachmessung am neuen Generator-Stand" in p.ids or "nachmessung" in p.ids
    assert "Nachmessung: Vorschlag vom Stand" in text and "Validierung gegen andere reale Gebirge" in text and "Weggefallen (kennt der neue Stand nicht)" in text
    assert "Abstand damals" in text and "Formkomponente (1 = erhalten)" in text
    ordner, _ = lauf_ordner
    text2, p2 = pruefe(erzeuge_bericht([ordner], tmp_path / "lauf+nm.html", cache=tmp_path / "cache", labor=tmp_path / "labor", nachmessung=[nm]))
    assert "nachmessung" in p2.ids and "anhang" in p2.ids and "Nachmessung: Vorschlag vom Stand" in text2
