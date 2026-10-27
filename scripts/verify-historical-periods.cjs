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
assert.equal(october.inspectionsToCreate, (tumbes + talara) * 10);
assert.equal(october.monthsByCenter['CD Talara'].length, 10);
assert.equal(october.monthsByCenter['CD Tumbes'].length, 10);
assert.equal(preview('2026-09-30', 'CD Talara').inspectionsToCreate, talara * 9);
assert.equal(preview('2026-11-20', 'CD Talara').inspectionsToCreate, talara * 10);
assert.equal(preview('2026-10-20', 'CD Chimbote').inspectionsToCreate, 0);
context.existingRuns = equipment.filter(row => row[2] === 'CD Talara')
  .map(row => ({ equipo_id: row[0], fecha: '2026-10-01' }));
assert.equal(preview('2026-10-20', 'CD Talara').inspectionsToCreate, talara * 9);

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
const noRunIds = new Set(answers.rows.slice(1).filter(row => row[5] === 'NO').map(row => row[1]));
runs.rows.slice(1).filter(row => row[0].startsWith('REG_HIST_')).forEach(row => {
  const key = row[4] + '|' + row[2].slice(0, 7);
  if (!byMonth[key]) byMonth[key] = { inspections: 0, withObservation: 0 };
  byMonth[key].inspections++;
  if (noRunIds.has(row[0])) byMonth[key].withObservation++;
  assert.ok(row[12].startsWith('GENERADO AUTOMATICAMENTE'));
});
const expectedIssuePercent = { '01': 10, '02': 6, '03': 3, '04': 0, '05': 0, '06': 3, '07': 2, '08': 0, '09': 0, '10': 0 };
Object.entries(byMonth).forEach(([key, counts]) => {
  const [agency, month] = key.split('|');
  const total = agency === 'CD Tumbes' ? tumbes : talara;
  assert.equal(counts.inspections, total);
  assert.equal(counts.withObservation, Math.round(total * expectedIssuePercent[month.slice(5)] / 100));
});
assert.equal(Object.keys(byMonth).length, 20);
answers.rows.slice(1).filter(row => row[5] === 'NO')
  .forEach(row => assert.ok(context.appHistoricalIssueType_(row[4]), 'Solo preguntas 5S/OPL'));
const cleanMonths = new Set(['04', '05', '08', '09', '10']);
const cleanRunIds = new Set(runs.rows.slice(1)
  .filter(row => cleanMonths.has(row[2].slice(5, 7)) || row[0] === 'REG_MANUAL')
  .map(row => row[0]));
answers.rows.slice(1).filter(row => cleanRunIds.has(row[1])).forEach(row => assert.equal(row[5], 'SI'));
assert.equal(runs.rows.at(-1)[12], 'Original');
const afterApply = JSON.stringify([runs.rows, answers.rows]);
context.appAplicarObservacionesHistoricas5sOpl_({ dryRun: false });
assert.equal(JSON.stringify([runs.rows, answers.rows]), afterApply, 'Repetir no debe duplicar observaciones');
console.log(JSON.stringify({ curveChecks: 'OK', periods: Object.keys(byMonth).length, observations: applied.runsWithObservation }, null, 2));
console.log(JSON.stringify({ ok: true, tumbesEquipment: tumbes, talaraEquipment: talara,
  octoberPreview: october.inspectionsToCreate, answers: october.answersToCreate,
  checks: ['periods by center', 'both agencies January-October', 'exclude other centers', 'skip existing inspections'] }, null, 2));

// Al regenerar, se omiten equipos/mes ya existentes.
context.existingRuns = runs.rows.slice(1).map(row => ({ equipo_id: row[9], fecha: row[2] }));
assert.equal(context.appCrearInspeccionesHistoricas_({ dryRun: true }).inspectionsToCreate, 0);
// Abril debe corregir observaciones generadas con una regla anterior.
const aprilRun = runs.rows.find(row => row[0].startsWith('REG_HIST_') && row[2].startsWith('2026-04'));
answers.rows.find(row => row[1] === aprilRun[0] && context.appHistoricalIssueType_(row[4]))[5] = 'NO';
context.appAplicarObservacionesHistoricas5sOpl_({ dryRun: false });
assert.ok(answers.rows.filter(row => row[1] === aprilRun[0]).every(row => row[5] === 'SI'));
