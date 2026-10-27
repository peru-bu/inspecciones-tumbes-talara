const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readXlsxFile = require('read-excel-file/node');

const ROOT = path.resolve(__dirname, '..');
const EQUIPMENT_FILES = fs.readdirSync(path.join(ROOT, 'archivo_base'))
  .filter(name => /^Plantilla_Inspecciones.*\.xlsx$/i.test(name) && !name.startsWith('~$'))
  .sort()
  .map(name => path.join(ROOT, 'archivo_base', name));
const QUESTIONS_FILE = path.join(ROOT, 'archivo_base', 'Base de muestra.xlsx');
const OUTPUT_FILE = path.join(ROOT, 'StaticMasterData.js');
const ALLOWED_CENTERS = new Map([['cd tumbes', 'CD Tumbes'], ['cd talara', 'CD Talara']]);

const QUESTION_SOURCE_BY_TEMPLATE_SHEET = {
  'Alarma CI': 'Alarma Contra Incendio',
  DetectorHumo: 'Detector de Humo',
  'Luces de Emergencia': 'L-Emerg.',
  'Gabinete MCI': 'Equipos_Emergencia',
  Gabinete: 'Equipos_Emergencia',
  Pozo_Tierra: 'Pozos a Tierra',
  Tableros_E: 'Tableros_Electricos',
  'Rack y Estanterias': 'Racks',
  'Equipos de Emergencia': 'Equipos_Emergencia',
  'Equipo de Control': 'Equipo_Control',
  'Equipo de Elevación': 'Equipos_Elevacion',
  FlotaT2: 'Flota_T2',
};

const BASE_COLUMNS = new Set([
  'marca temporal',
  'llave',
  'centro de distribucion',
  'fecha',
  'auditor',
  'ubicacion',
  'codigo',
  'observaciones',
]);

function key(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!:;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function clean(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\r\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function stableId(prefix, values) {
  return `${prefix}_${crypto
    .createHash('md5')
    .update(values.map(clean).join('|'))
    .digest('hex')
    .slice(0, 12)
    .toUpperCase()}`;
}

function columnIndex(headers, name) {
  const target = key(name);
  return headers.findIndex(header => key(header) === target);
}

function cell(row, index) {
  if (index < 0) return '';
  return clean(row[index]);
}

function equipmentLabel(code, equipment, location) {
  return [code, equipment, location].filter(Boolean).join(' - ');
}

function sortRows(rows, indexes) {
  return rows.sort((a, b) => {
    for (const index of indexes) {
      const compared = String(a[index] || '').localeCompare(String(b[index] || ''));
      if (compared) return compared;
    }
    return 0;
  });
}

async function main() {
  if (!EQUIPMENT_FILES.length) {
    throw new Error('No se encontraron plantillas de equipos en archivo_base.');
  }
  const [equipmentSheetsByFile, questionSheets] = await Promise.all([
    Promise.all(EQUIPMENT_FILES.map(file => readXlsxFile(file))),
    readXlsxFile(QUESTIONS_FILE),
  ]);

  // Conserva el archivo de origen; los equipos repetidos entre plantillas
  // se combinan usando su identificador estable.
  const equipmentSheets = equipmentSheetsByFile.flatMap((sheets, index) =>
    sheets.map(sheet => ({ ...sheet, sourceFile: path.basename(EQUIPMENT_FILES[index]) })),
  );

  const questionsBySheet = new Map(questionSheets.map(sheet => [sheet.sheet, sheet]));
  const centers = new Map();
  const auditors = new Map();
  const inspections = new Map();
  const equipment = new Map();
  const questions = [];
  const excludedEquipment = [];

  for (const sheet of questionSheets) {
    const headers = (sheet.data[0] || []).map(clean);
    const auditorIndex = columnIndex(headers, 'auditor');

    for (const row of sheet.data.slice(1)) {
      const auditor = cell(row, auditorIndex);
      if (!auditor) continue;
      const auditorId = stableId('AUD', [auditor]);
      auditors.set(auditorId, [auditorId, auditor, 'SI']);
    }
  }

  for (const sheet of equipmentSheets) {
    if (sheet.sheet.startsWith('P_')) continue; // hojas de parametros/listas, no son plantillas de inspeccion

    const headers = (sheet.data[0] || []).map(clean);
    const indexes = {
      code: columnIndex(headers, '#Num'),
      center: columnIndex(headers, 'CD'),
      location: columnIndex(headers, 'Ubicación'),
      equipment: columnIndex(headers, 'Equipo'),
    };
    for (const required of ['code', 'center', 'location']) {
      if (indexes[required] < 0) throw new Error('Falta columna obligatoria ' + required + ' en ' + sheet.sheet);
    }
    const questionSourceName = QUESTION_SOURCE_BY_TEMPLATE_SHEET[sheet.sheet] || sheet.sheet;
    const questionSheet = questionsBySheet.get(questionSourceName);

    if (!questionSheet) {
      throw new Error(`No question source found for template sheet "${sheet.sheet}" (${questionSourceName}).`);
    }

    const inspectionId = stableId('INS', [sheet.sheet]);
    const isNewInspection = !inspections.has(inspectionId);
    const source = `${sheet.sourceFile}:${sheet.sheet}|Preguntas:${questionSourceName}`;
    inspections.set(inspectionId, [
      inspectionId,
      sheet.sheet,
      isNewInspection ? source : inspections.get(inspectionId)[2] + ';' + source,
      'SI',
    ]);

    // Las preguntas se generan una sola vez por tipo de inspeccion: si otra
    // hoja de una sede distinta comparte el mismo nombre (ej. "Botiquines"
    // en Tumbes y Talara), ya comparten inspectionId y sus preguntas.
    if (isNewInspection) {
      const questionHeaders = (questionSheet.data[0] || []).map(clean);
      let order = 0;
      questionHeaders.forEach((header, index) => {
        if (!header || BASE_COLUMNS.has(key(header))) return;
        order += 1;
        questions.push([
          stableId('PRE', [inspectionId, index + 1, header]),
          inspectionId,
          sheet.sheet,
          order,
          header,
          'SI_NO',
          'SI',
        ]);
      });
    }

    for (const row of sheet.data.slice(1)) {
      const sourceCenter = cell(row, indexes.center);
      const center = ALLOWED_CENTERS.get(key(sourceCenter));
      const code = cell(row, indexes.code);
      const location = cell(row, indexes.location);
      const equipmentName = cell(row, indexes.equipment) || sheet.sheet;

      if (!sourceCenter || (!code && !location)) continue;
      if (!center) {
        excludedEquipment.push({ sourceFile: sheet.sourceFile, sheet: sheet.sheet, center: sourceCenter, code, location });
        continue;
      }

      const centerId = stableId('CEN', [center]);
      const equipmentId = stableId('EQP', [center, sheet.sheet, code, location, equipmentName]);
      centers.set(centerId, [centerId, center, 'SI']);
      equipment.set(equipmentId, [
        equipmentId,
        centerId,
        center,
        inspectionId,
        equipmentName,
        location,
        code,
        equipmentLabel(code, equipmentName, location),
        'SI',
      ]);
    }
  }

  const usedInspections = new Set([...equipment.values()].map(row => row[3]));
  if (centers.size !== 2) throw new Error('Se esperaban equipos de Tumbes y Talara. Revisa la columna CD.');

  const data = {
    excludedEquipment,
    generatedAt: new Date().toISOString(),
    sourceEquipmentFile: EQUIPMENT_FILES.map(file => path.relative(ROOT, file).replace(/\\/g, '/')),
    sourceQuestionsFile: 'archivo_base/Base de muestra.xlsx',
    centers: sortRows([...centers.values()], [1]),
    auditors: sortRows([...auditors.values()], [1]),
    inspections: sortRows([...inspections.values()].filter(row => usedInspections.has(row[0])), [1]),
    equipment: sortRows([...equipment.values()], [2, 4, 6, 5]),
    questions: sortRows(questions.filter(row => usedInspections.has(row[1])), [2, 3]),
  };

  fs.writeFileSync(
    OUTPUT_FILE,
    `var APP_STATIC_MASTER_DATA = ${JSON.stringify(data, null, 2)};\n`,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        output: path.relative(ROOT, OUTPUT_FILE),
        centers: data.centers.length,
        auditors: data.auditors.length,
        inspections: data.inspections.length,
        equipment: data.equipment.length,
        questions: data.questions.length,
        excludedEquipment,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exit(1);
});
