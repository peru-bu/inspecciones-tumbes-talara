const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Logger: { log() {} },
  Utilities: { formatDate: date => {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  } },
});
vm.runInContext(fs.readFileSync(path.join(root, 'Código.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'StaticMasterData.js'), 'utf8'), context);

context.appSpreadsheet_ = () => ({ getSpreadsheetTimeZone: () => 'America/Lima' });
context.appEnsureMasterData_ = () => {};
context.appResolveHistoricalAuditor_ = () => ({ auditor_id: 'AUD_TEST', auditor: 'Prueba' });
context.appStableId_ = (prefix, values) => prefix + '_' + values.join('|');
context.appReadTable_ = (_, table) => {
  const keys = {
    MA_Equipos: ['equipo_id', 'centro_id', 'centro', 'inspeccion_id', 'tipo_equipo', 'ubicacion', 'codigo', 'etiqueta', 'activo'],
    MA_Preguntas: ['pregunta_id', 'inspeccion_id', 'tipo_equipo', 'orden', 'pregunta', 'tipo_respuesta', 'activo'],
  };
  if (table === 'TX_Inspecciones') return context.existingRuns || [];
  const rows = table === 'MA_Equipos' ? context.APP_STATIC_MASTER_DATA.equipment : context.APP_STATIC_MASTER_DATA.questions;
  return rows.map(row => Object.fromEntries(keys[table].map((key, i) => [key, row[i]])));
};
const equipment = context.APP_STATIC_MASTER_DATA.equipment;
const tumbes = equipment.filter(row => row[2] === 'CD Tumbes').length;
const talara = equipment.filter(row => row[2] === 'CD Talara').length;
assert.ok(tumbes > 0 && talara > 0);

function preview(endDate, center = '') {
  context.appLoadScope_ = () => ({ center, endDate });
  return context.appCrearInspeccionesHistoricas_({ dryRun: true });
}
const october = preview('2026-10-20');
assert.equal(october.inspectionsToCreate, tumbes * 10 + talara);
assert.deepEqual(Array.from(october.monthsByCenter['CD Talara']), ['2026-10']);
assert.equal(october.monthsByCenter['CD Tumbes'].length, 10);
assert.equal(preview('2026-09-30', 'CD Talara').inspectionsToCreate, 0);
assert.equal(preview('2026-11-20', 'CD Talara').inspectionsToCreate, talara);
assert.equal(preview('2026-10-20', 'CD Chimbote').inspectionsToCreate, 0);
context.existingRuns = equipment.filter(row => row[2] === 'CD Talara')
  .map(row => ({ equipo_id: row[0], fecha: '2026-10-01' }));
assert.equal(preview('2026-10-20', 'CD Talara').inspectionsToCreate, 0);

// Ejecuta la generacion y la curva completas sobre hojas en memoria.
const headers = vm.runInContext('APP_HEADERS', context);
function memorySheet(header) {
  const rows = [Array.from(header)];
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => header.length,
    getRange(row, column, count, width) {
      const read = () => rows.slice(row - 1, row - 1 + count)
        .map(values => values.slice(column - 1, column - 1 + width));
      return { getValues: read, getDisplayValues: read, setValues(values) {
        values.forEach((valuesRow, i) => valuesRow.forEach((value, j) => {
          rows[row - 1 + i][column - 1 + j] = value;
        }));
      } };
    },
  };
}
const runs = memorySheet(headers.inspectionRuns);
const answers = memorySheet(headers.answers);
context.existingRuns = [];
context.appLoadScope_ = () => ({ center: '', endDate: '2026-10-20' });
context.appSheet_ = (_, name) => name === 'TX_Inspecciones' ? runs : answers;
context.appAppendRows_ = (sheet, rows) => sheet.rows.push(...rows.map(row => Array.from(row)));
context.appCrearInspeccionesHistoricas_({ dryRun: false });
// Un registro manual del mismo auditor debe conservar su respuesta original.
runs.rows.push(['REG_MANUAL', '', '2026-01-05', '', 'CD Tumbes', '', 'Safety Champion', '', '', 'MANUAL', '', '', 'Original']);
answers.rows.push(['RSP_MANUAL', 'REG_MANUAL', 'PRE_MANUAL', 1, '¿Se cumple con 5s?', 'SI']);
const snapshot = JSON.stringify([runs.rows, answers.rows]);
const curvePreview = context.appAplicarObservacionesHistoricas5sOpl_({ dryRun: true });
assert.equal(JSON.stringify([runs.rows, answers.rows]), snapshot, 'La previsualizacion no debe escribir');
const applied = context.appAplicarObservacionesHistoricas5sOpl_({ dryRun: false });
assert.equal(applied.answersToNo, curvePreview.answersToNo);
const byMonth = {};
runs.rows.slice(1).filter(row => row[4] === 'CD Tumbes' && row[0] !== 'REG_MANUAL').forEach(row => {
  const month = row[2].slice(0, 7);
  if (!byMonth[month]) byMonth[month] = { inspections: 0, withObservation: 0 };
  byMonth[month].inspections++;
  if (row[12]) byMonth[month].withObservation++;
});
Object.entries(byMonth).forEach(([month, counts]) => {
  assert.equal(counts.inspections, tumbes);
  if (month < '2026-05') {
    assert.ok(counts.withObservation > 0);
    assert.ok(counts.withObservation / counts.inspections < 0.15, 'Los hallazgos iniciales deben ser moderados');
  }
  else assert.equal(counts.withObservation, 0, `${month} debe quedar 100% conforme`);
});
const unchangedRunIds = new Set(runs.rows.slice(1)
  .filter(row => row[4] === 'CD Talara' || row[2] >= '2026-05-01' || row[0] === 'REG_MANUAL')
  .map(row => row[0]));
answers.rows.slice(1).filter(row => unchangedRunIds.has(row[1])).forEach(row => assert.equal(row[5], 'SI'));
assert.equal(runs.rows.at(-1)[12], 'Original');
const afterApply = JSON.stringify([runs.rows, answers.rows]);
context.appAplicarObservacionesHistoricas5sOpl_({ dryRun: false });
assert.equal(JSON.stringify([runs.rows, answers.rows]), afterApply, 'Repetir no debe duplicar observaciones');
console.log(JSON.stringify({ curveChecks: 'OK', byMonth }, null, 2));
console.log(JSON.stringify({ ok: true, tumbesEquipment: tumbes, talaraEquipment: talara,
  octoberPreview: october.inspectionsToCreate, answers: october.answersToCreate,
  checks: ['periods by center', 'Talara before/after October', 'exclude other centers', 'skip existing inspections'] }, null, 2));
