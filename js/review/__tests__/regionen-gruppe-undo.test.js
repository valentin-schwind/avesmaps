const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const events = [];
const entries = ['a', 'b'].map(id => ({ label: { publicId: id, curveLine: [[1, 2], [3, 4]], curveMax: 2, ecosystemRegionKind: 'topographie' }, marker: { setLatLng: () => events.push('position') } }));
const sandbox = { console, Map, document: undefined, window: { __featureKanon: { abweichungen: { 'region:fremd': { kanon: 'inoffiziell' } } } }, labelMarkers: entries, map: { getZoom: () => 3 } };
vm.createContext(sandbox);
for (const name of ['../../app/utils.js', '../../ui/popups.js', '../../map-features/map-features-labels.js', '../review-panels-change-log.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), sandbox);
}
let linked = true;
sandbox.avesmapsLabelIconRastern = () => events.push('icon');
sandbox.syncLabelMarkerVisibility = () => events.push('visibility');
sandbox.avesmapsLabelInfopanelNachziehen = () => events.push('panel');
sandbox.refreshLabelMarkerPopup = () => {
    for (const entry of entries) {
        assert.strictEqual(entry.label.wikiRegion?.wiki_key || '', linked ? 'neu' : '');
        assert.strictEqual(entry.label.revision, 10);
        assert.deepStrictEqual(entry.label.curveLine, [[1, 2], [3, 4]]);
        assert.strictEqual(entry.label.ecosystemRegionKind, 'topographie');
        assert.strictEqual(sandbox.resolveFeatureKanon('region', entry.label.publicId)?.kanon || '', linked ? 'offiziell' : '');
    }
    events.push('popup');
};
function group() {
    return { kanon_je_kennung: { a: linked ? { kanon: 'offiziell' } : null, b: linked ? { kanon: 'offiziell' } : null }, features: ['a', 'b'].map(id => ({ type: 'Feature', id, properties: { public_id: id, name: 'Berg', revision: 10, ...(linked ? { wiki_region: { wiki_key: 'neu' } } : {}) }, geometry: { type: 'Point', coordinates: [20, 10] } })) };
}
for (const value of [true, false]) {
    linked = value; events.length = 0;
    sandbox.applyLabelGroupAuditResponse(group());
    assert.deepStrictEqual(events, ['position', 'icon', 'popup', 'visibility', 'position', 'icon', 'popup', 'visibility', 'panel']);
}
const before = JSON.stringify([entries, sandbox.window.__featureKanon]);
const invalid = group(); delete invalid.kanon_je_kennung.b;
assert.throws(() => sandbox.applyLabelGroupAuditResponse(invalid), /Quellenhinweise fehlen/);
assert.strictEqual(JSON.stringify([entries, sandbox.window.__featureKanon]), before);
assert.strictEqual(sandbox.resolveFeatureKanon('region', 'fremd').kanon, 'inoffiziell');
console.log('OK: Regionsgruppen erneuern Daten und Kanon vor allen Popups und einmal das Infopanel.');
