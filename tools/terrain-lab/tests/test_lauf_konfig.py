import json

import pytest

from terrainlab.lauf.konfig import PROFIL_ORDNER, KonfigFehler, lade_konfig, parse_konfig


def _basis(**extra):
    return {"name": "t", "faelle": [{"name": "a", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau"}], **extra}


def test_vorgabe_wird_in_jeden_fall_gemischt():
    k = parse_konfig(
        {
            "name": "t",
            "vorgabe": {"rezept": {"fassung": 19}, "typ": "kettengebirge"},
            "faelle": [
                {"name": "a", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "rezept": {"roh": {"x": 1}}},
                {"name": "b", "gebirge": {"fixture": "trollzacken"}, "stufe": "saat"},
            ],
        }
    )
    a, b = k.faelle
    assert a.auftrag["rezept"] == {"fassung": 19, "roh": {"x": 1}}, "tiefe Mischung, nicht Ersetzen"
    assert b.auftrag["rezept"] == {"fassung": 19} and b.auftrag["typ"] == "kettengebirge"
    # Die Vorgabe selbst bleibt unverändert (kein Teilen von Objekten zwischen Fällen).
    a.auftrag["rezept"]["fassung"] = 1
    assert b.auftrag["rezept"]["fassung"] == 19


def test_messoptionen_gehoeren_nicht_in_den_auftrag():
    k = parse_konfig(_basis(wiederholungen=5, warm=2, phasen="alle"))
    f = k.faelle[0]
    assert (f.wiederholungen, f.warm, f.phasen) == (5, 2, "alle")
    assert "wiederholungen" not in f.auftrag and "phasen" not in f.auftrag
    k2 = parse_konfig({"name": "t", "faelle": [{"name": "a", "gebirge": {"fixture": "x"}, "stufe": "saat", "warm": 0, "wiederholungen": 1}]})
    assert (k2.faelle[0].wiederholungen, k2.faelle[0].warm) == (1, 0)


def test_matrix_erzeugt_namen_und_aufloesungen():
    k = parse_konfig({"name": "t", "matrix": [{"fixtures": ["blutzinnen", "trollzacken"], "stufe": "vorschau", "aufloesungen": [1, 2, 4]}]})
    assert [f.name for f in k.faelle] == [
        "blutzinnen-vorschau-1x", "blutzinnen-vorschau-2x", "blutzinnen-vorschau-4x",
        "trollzacken-vorschau-1x", "trollzacken-vorschau-2x", "trollzacken-vorschau-4x",
    ]
    assert k.faelle[1].auftrag["vorschau"]["aufloesung"] == 2
    assert k.faelle[1].auftrag["gebirge"] == {"fixture": "blutzinnen"}
    s = parse_konfig({"name": "t", "matrix": [{"fixtures": ["blutzinnen"], "stufe": "saat"}]})
    assert s.faelle[0].name == "blutzinnen-saat" and "vorschau" not in s.faelle[0].auftrag


@pytest.mark.parametrize(
    "roh, text",
    [
        ({"name": "t"}, "Keine Fälle"),
        ({"name": "ungültig name", "faelle": []}, "name"),
        (_basis(unbekannt=1), "Unbekannte Schlüssel"),
        (_basis(wiederholungen=0), "wiederholungen"),
        (_basis(phasen="manchmal"), "phasen"),
        (_basis(arbeiter=9), "arbeiter"),
        ({"name": "t", "faelle": [{"name": "a", "stufe": "vorschau"}]}, "gebirge und stufe"),
        ({"name": "t", "faelle": [{"name": "a", "gebirge": {"fixture": "b"}, "stufe": "saat"}] * 2}, "doppelt"),
        ({"name": "t", "matrix": [{"fixtures": [], "stufe": "saat"}]}, "fixtures"),
        ({"name": "t", "matrix": [{"fixtures": ["x"], "stufe": "unsinn"}]}, "stufe"),
    ],
)
def test_ungueltige_konfigurationen(roh, text):
    with pytest.raises(KonfigFehler, match=text):
        parse_konfig(roh)


def test_phasen_wahrheitswerte():
    assert parse_konfig(_basis(phasen=True)).faelle[0].phasen == "erster"
    assert parse_konfig(_basis(phasen=False)).faelle[0].phasen == "aus"


def test_waehle_nach_teilstring():
    k = parse_konfig({"name": "t", "matrix": [{"fixtures": ["blutzinnen", "trollzacken"], "stufe": "vorschau", "aufloesungen": [1, 2]}]})
    assert [f.name for f in k.waehle(["troll"]).faelle] == ["trollzacken-vorschau-1x", "trollzacken-vorschau-2x"]
    assert [f.name for f in k.waehle(["blutzinnen-vorschau-2x"]).faelle] == ["blutzinnen-vorschau-2x"]
    with pytest.raises(KonfigFehler, match="passt"):
        k.waehle(["gibtsnicht"])
    assert k.waehle(None) is k


def test_datei_und_profilname(tmp_path):
    datei = tmp_path / "k.json"
    datei.write_text(json.dumps(_basis()), encoding="utf-8")
    assert lade_konfig(datei).faelle[0].name == "a"
    with pytest.raises(KonfigFehler, match="gibt es nicht"):
        lade_konfig("kein-profil")
    (tmp_path / "kaputt.json").write_text("{", encoding="utf-8")
    with pytest.raises(KonfigFehler, match="JSON"):
        lade_konfig(tmp_path / "kaputt.json")


def test_eingebaute_profile_sind_gueltig():
    profile = sorted(PROFIL_ORDNER.glob("*.json"))
    assert {p.stem for p in profile} >= {"schnell", "voll", "qualitaet"}
    for p in profile:
        k = lade_konfig(p)
        assert k.faelle, p
        for f in k.faelle:
            assert f.auftrag["stufe"] in ("vorschau", "saat", "endgelaende-lokal")
            assert f.auftrag["rezept"]["fassung"] == 19, "Profile messen die offene Fassung 19 (Test) ausdrücklich"


def test_schnappschuss_wird_frueh_geprueft(tmp_path):
    from terrainlab.lauf.konfig import SCHNAPPSCHUSS_DATEIEN, pruefe_schnappschuesse

    k = parse_konfig({"name": "t", "faelle": [{"name": "e", "gebirge": {"fixture": "blutzinnen"}, "stufe": "endgelaende-lokal"}]})
    with pytest.raises(KonfigFehler, match="Schnappschuss .* unvollständig"):
        pruefe_schnappschuesse(k, tmp_path)
    ordner = tmp_path / "schnappschuss" / "aktuell"
    ordner.mkdir(parents=True)
    for name in SCHNAPPSCHUSS_DATEIEN[:-1]:
        (ordner / name).write_text("x")
    with pytest.raises(KonfigFehler, match="master.u16"):
        pruefe_schnappschuesse(k, tmp_path)
    (ordner / SCHNAPPSCHUSS_DATEIEN[-1]).write_text("x")
    pruefe_schnappschuesse(k, tmp_path)
    # Ohne Endgelände-Fall wird nichts verlangt.
    pruefe_schnappschuesse(parse_konfig(_basis()), tmp_path / "leer")
    # Ein ausdrücklich genannter Ordner hat Vorrang vor dem Standardort.
    k2 = parse_konfig({"name": "t", "faelle": [{"name": "e", "gebirge": {"fixture": "b"}, "stufe": "endgelaende-lokal", "endgelaende": {"schnappschuss": str(tmp_path / "anders")}}]})
    with pytest.raises(KonfigFehler, match="anders"):
        pruefe_schnappschuesse(k2, tmp_path)
