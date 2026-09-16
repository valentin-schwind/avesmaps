const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const locations = [{ publicId: 'a', isRuined: false }, { publicId: 'b', isRuined: true }];
const markers = locations.map(location => ({ location, marker: { isPopupOpen: () => false } }));
let states = [true, false];
const events = [];
const sandbox = {
    URL, Map, console, document: undefined,
    window: { location: { href: 'https://example.test/' }, avesmapsRefreshInfopanel: () => events.push('panel') },
    MAP_FEATURES_API_URL: '/api/app/map-features.php', locationData: locations,
    findLocationMarkerByPublicId: id => markers.find(m => m.location.publicId === id),
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, features: locations.map((l, i) => ({
        id: l.publicId, properties: { revision: 10, ...(states[i] ? { is_ruined: true } : {}) },
    })) }) }),
    refreshLocationMarkerPopup: () => { assert.deepStrictEqual(locations.map(l => l.isRuined), states); events.push('popup'); },
    syncLocationNameLabelVisibility: () => { assert.deepStrictEqual(locations.map(l => l.isRuined), states); events.push('labels'); },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../review-panels-change-log.js'), 'utf8'), sandbox);
(async () => {
    const group = { revision: 10, fields: ['is_ruined'], features: locations.map(l => ({ public_id: l.publicId, revision: 10 })) };
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(events, ['popup', 'popup', 'labels', 'panel']);
    states = [false, true]; events.length = 0;
    await sandbox.applyLocationGroupAuditResponse(group);
    assert.deepStrictEqual(locations.map(l => l.isRuined), states);
    assert.deepStrictEqual(events, ['popup', 'popup', 'labels', 'panel']);
    assert.strictEqual(sandbox.formatChangeAction('set_ruined_location_group'), 'Ruinenstatus für Orte übernommen');
    assert.strictEqual(sandbox.formatChangeAction('undo_set_ruined_location_group'), 'Ruinenübernahme zurückgenommen');
    assert.strictEqual(sandbox.formatChangeAction('undo_undo_set_ruined_location_group'), 'Ruinenübernahme wiederhergestellt');
    console.log('OK: Ruinengruppe aktualisiert alle Ortsdaten vor Popup, Beschriftungen und Infopanel.');
})().catch(error => { console.error(error); process.exitCode = 1; });
