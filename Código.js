const REVIEW_SPREADSHEET_ID = '1VUai8d57pKhPjsnI8RJkQhkAlw2GL_7GbG1xd6uU5HQ';
const APP_FRONTEND_GITHUB_URL = 'https://raw.githubusercontent.com/peru-bu/inspecciones-tumbes-talara/main/github_frontend/index.html';

// Periodos de la carga historica de Tumbes 2026; no afectan inspecciones manuales.
const APP_HISTORICAL_PERIODS = {
  'CD Tumbes': { startDate: '2026-01-01', endDate: '2026-12-31' },
  'CD Talara': { startDate: '2026-10-01', endDate: '2026-10-31' }
};

const APP_CONFIG = {
  spreadsheetId: REVIEW_SPREADSHEET_ID,
  loadConfigSheet: 'CFG_Carga',
  tables: {
    centers: 'MA_Centros',
    auditors: 'MA_Auditores',
    inspections: 'MA_Inspecciones',
    equipment: 'MA_Equipos',
    questions: 'MA_Preguntas',
    inspectionRuns: 'TX_Inspecciones',
    answers: 'TX_Respuestas'
  }
};

const APP_HEADERS = {
  centers: ['centro_id', 'centro', 'activo'],
  auditors: ['auditor_id', 'auditor', 'activo'],
  inspections: ['inspeccion_id', 'inspeccion', 'hoja_origen', 'activo'],
  equipment: ['equipo_id', 'centro_id', 'centro', 'inspeccion_id', 'tipo_equipo', 'ubicacion', 'codigo', 'etiqueta', 'activo'],
  questions: ['pregunta_id', 'inspeccion_id', 'tipo_equipo', 'orden', 'pregunta', 'tipo_respuesta', 'activo'],
  inspectionRuns: ['inspeccion_registro_id', 'marca_temporal', 'fecha', 'centro_id', 'centro', 'auditor_id', 'auditor', 'inspeccion_id', 'tipo_equipo', 'equipo_id', 'ubicacion', 'codigo', 'observaciones'],
  answers: ['respuesta_id', 'inspeccion_registro_id', 'pregunta_id', 'orden', 'pregunta', 'respuesta']
};

function doGet(e) {
  appEnsureRuntimeSheets_(appSpreadsheet_());

  if (e && e.parameter && e.parameter.api === '1') {
    return appApiResponse_(e);
  }

  return HtmlService
    .createHtmlOutput(appFrontendHtml_())
    .setTitle('Inspecciones · Agencias Tumbes y Talara')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function appFrontendHtml_() {
  if (!APP_FRONTEND_GITHUB_URL) {
    return HtmlService.createHtmlOutputFromFile('Index').getContent();
  }

  try {
    const response = UrlFetchApp.fetch(APP_FRONTEND_GITHUB_URL, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      return response.getContentText();
    }
  } catch (error) {
    console.warn('No se pudo cargar el frontend desde GitHub: ' + error.message);
  }

  return HtmlService.createHtmlOutputFromFile('Index').getContent();
}

function appApiResponse_(e) {
  const callback = appSafeJsonpCallback_(e.parameter.callback);
  const fn = String(e.parameter.fn || '').trim();
  let payload;

  try {
    const args = JSON.parse(e.parameter.args || '[]');
    payload = appRunApiFunction_(fn, Array.isArray(args) ? args : []);
  } catch (error) {
    payload = {
      ok: false,
      error: error.message || String(error)
    };
  }

  const json = JSON.stringify(payload);
  const output = callback ? callback + '(' + json + ');' : json;

  return ContentService
    .createTextOutput(output)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function appRunApiFunction_(fn, args) {
  const api = {
    getInitialData: getInitialData,
    getTiposPorCentro: getTiposPorCentro,
    getEquiposPorTipo: getEquiposPorTipo,
    getFormularioInspeccion: getFormularioInspeccion,
    guardarInspeccionSinObservacion: guardarInspeccionSinObservacion,
    guardarInspeccion: guardarInspeccion,
    cargarMaestros: cargarMaestros
  };

  if (!api[fn]) {
    throw new Error('Funcion API no permitida: ' + fn);
  }

  return api[fn].apply(null, args);
}

function appSafeJsonpCallback_(callback) {
  const value = String(callback || '').trim();

  if (/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(value)) {
    return value;
  }

  return '';
}

function getInitialData() {
  const spreadsheet = appSpreadsheet_();
  appEnsureRuntimeSheets_(spreadsheet);

  return {
    readyMessage: 'Maestros cargados',
    centers: appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.centers)),
    auditors: appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.auditors))
  };
}

function getTiposPorCentro(centroId) {
  const spreadsheet = appSpreadsheet_();
  appEnsureRuntimeSheets_(spreadsheet);

  const equipos = appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.equipment))
    .filter(item => item.centro_id === centroId);
  const inspecciones = appIndexBy_(appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.inspections)), 'inspeccion_id');
  const currentMonth = appCurrentMonthKey_(spreadsheet);
  const statusByEquipment = appBuildStatusByEquipment_(
    appReadTable_(spreadsheet, APP_CONFIG.tables.inspectionRuns),
    currentMonth
  );
  const counts = {};

  equipos.forEach(item => {
    if (!counts[item.inspeccion_id]) {
      counts[item.inspeccion_id] = {
        total: 0,
        doneThisMonth: 0,
        lastInspectionDate: ''
      };
    }

    const status = statusByEquipment[item.equipo_id] || appEmptyInspectionStatus_();
    counts[item.inspeccion_id].total += 1;
    counts[item.inspeccion_id].doneThisMonth += status.doneThisMonth ? 1 : 0;
    counts[item.inspeccion_id].lastInspectionDate = appLatestDate_(
      counts[item.inspeccion_id].lastInspectionDate,
      status.lastInspectionDate
    );
  });

  const tipos = Object.keys(counts)
    .map(id => ({
      inspeccion_id: id,
      inspeccion: inspecciones[id] ? inspecciones[id].inspeccion : '',
      total: counts[id].total,
      doneThisMonth: counts[id].doneThisMonth,
      pendingThisMonth: counts[id].total - counts[id].doneThisMonth,
      lastInspectionDate: counts[id].lastInspectionDate
    }))
    .sort((a, b) => a.inspeccion.localeCompare(b.inspeccion));

  return {
    tipos
  };
}

function getEquiposPorCentro(centroId) {
  return getTiposPorCentro(centroId);
}

function getEquiposPorTipo(centroId, inspeccionId) {
  const spreadsheet = appSpreadsheet_();
  appEnsureRuntimeSheets_(spreadsheet);

  const currentMonth = appCurrentMonthKey_(spreadsheet);
  const statusByEquipment = appBuildStatusByEquipment_(
    appReadTable_(spreadsheet, APP_CONFIG.tables.inspectionRuns),
    currentMonth
  );
  const equipos = appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.equipment))
    .filter(item => item.centro_id === centroId && item.inspeccion_id === inspeccionId)
    .sort(appCompareEquipment_)
    .map(item => {
      const status = statusByEquipment[item.equipo_id] || appEmptyInspectionStatus_();
      return Object.assign({}, item, status);
    });

  return {
    equipos,
    currentMonth
  };
}

function getFormularioInspeccion(equipoId) {
  const spreadsheet = appSpreadsheet_();
  appEnsureRuntimeSheets_(spreadsheet);

  const equipo = appReadTable_(spreadsheet, APP_CONFIG.tables.equipment)
    .find(item => item.equipo_id === equipoId && appIsActive_(item));

  if (!equipo) {
    throw new Error('No se encontro el equipo seleccionado.');
  }

  const preguntas = appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.questions))
    .filter(item => item.inspeccion_id === equipo.inspeccion_id)
    .sort((a, b) => Number(a.orden) - Number(b.orden));
  const status = appBuildStatusByEquipment_(
    appReadTable_(spreadsheet, APP_CONFIG.tables.inspectionRuns),
    appCurrentMonthKey_(spreadsheet)
  )[equipo.equipo_id] || appEmptyInspectionStatus_();

  return {
    equipo,
    preguntas,
    status
  };
}

function guardarInspeccion(payload) {
  return appSaveInspectionWithLock_(payload, { mode: 'CON_OBSERVACION' });
}

function guardarInspeccionSinObservacion(payload) {
  return appSaveInspectionWithLock_(payload, { mode: 'SIN_OBSERVACION' });
}

function appSaveInspectionWithLock_(payload, options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    return appSaveInspection_(payload || {}, options || {});
  } finally {
    lock.releaseLock();
  }
}

function appSaveInspection_(payload, options) {
  const spreadsheet = appSpreadsheet_();
  appEnsureRuntimeSheets_(spreadsheet);

  if (!payload || !payload.equipo_id) {
    throw new Error('Selecciona un equipo.');
  }

  const equipo = appReadTable_(spreadsheet, APP_CONFIG.tables.equipment)
    .find(item => item.equipo_id === payload.equipo_id && appIsActive_(item));

  if (!equipo) {
    throw new Error('No se encontro el equipo seleccionado.');
  }

  const now = new Date();
  const auditor = appResolveAuditor_(spreadsheet, payload.auditor_id, payload.auditor);
  const preguntas = appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.questions))
    .filter(item => item.inspeccion_id === equipo.inspeccion_id)
    .sort((a, b) => Number(a.orden) - Number(b.orden));
  const respuestasPorPregunta = {};
  const mode = options.mode || payload.modo || 'CON_OBSERVACION';

  if (mode === 'SIN_OBSERVACION') {
    preguntas.forEach(pregunta => {
      respuestasPorPregunta[pregunta.pregunta_id] = 'SI';
    });
  } else {
    (payload.respuestas || []).forEach(item => {
      respuestasPorPregunta[item.pregunta_id] = String(item.respuesta || '').toUpperCase();
    });
  }

  const faltantes = preguntas.filter(pregunta => !['SI', 'NO'].includes(respuestasPorPregunta[pregunta.pregunta_id]));
  if (faltantes.length) {
    throw new Error('Responde todas las preguntas antes de guardar.');
  }

  const observaciones = mode === 'SIN_OBSERVACION' ? '' : String(payload.observaciones || '').trim();
  const tieneNo = preguntas.some(pregunta => respuestasPorPregunta[pregunta.pregunta_id] === 'NO');

  if (mode === 'CON_OBSERVACION') {
    if (!tieneNo) {
      throw new Error('Para auditar con observacion debes marcar al menos una respuesta en NO.');
    }

    if (!observaciones) {
      throw new Error('Para auditar con observacion debes escribir la observacion.');
    }
  }

  const fecha = Utilities.formatDate(now, spreadsheet.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const registroId = 'REG_' + Utilities.getUuid();

  appSheet_(spreadsheet, APP_CONFIG.tables.inspectionRuns, APP_HEADERS.inspectionRuns).appendRow([
    registroId,
    now,
    fecha,
    equipo.centro_id,
    equipo.centro,
    auditor.auditor_id,
    auditor.auditor,
    equipo.inspeccion_id,
    equipo.tipo_equipo,
    equipo.equipo_id,
    equipo.ubicacion,
    equipo.codigo,
    observaciones
  ]);

  const answerRows = preguntas.map(pregunta => [
    'RSP_' + Utilities.getUuid(),
    registroId,
    pregunta.pregunta_id,
    Number(pregunta.orden),
    pregunta.pregunta,
    respuestasPorPregunta[pregunta.pregunta_id]
  ]);

  if (answerRows.length) {
    const answerSheet = appSheet_(spreadsheet, APP_CONFIG.tables.answers, APP_HEADERS.answers);
    answerSheet
      .getRange(answerSheet.getLastRow() + 1, 1, answerRows.length, APP_HEADERS.answers.length)
      .setValues(answerRows);
  }

  return {
    ok: true,
    inspeccion_registro_id: registroId,
    message: mode === 'SIN_OBSERVACION' ? 'Inspeccion sin observacion guardada.' : 'Inspeccion con observacion guardada.'
  };
}

function reconstruirMaestros() {
  const result = appRebuildMasterData_(true);
  appCacheClearMasterTables_();
  return result;
}

function prepararConfiguracionCarga() {
  const spreadsheet = appSpreadsheet_();
  const sheet = appSheet_(
    spreadsheet,
    APP_CONFIG.loadConfigSheet,
    ['centro', 'fecha_limite']
  );

  if (sheet.getLastRow() < 2) {
    sheet.appendRow([
      'TODOS',
      Utilities.formatDate(new Date(), spreadsheet.getSpreadsheetTimeZone(), 'yyyy-MM-dd')
    ]);
  }

  const scope = appLoadScope_(spreadsheet);
  return {
    ok: true,
    sheet: APP_CONFIG.loadConfigSheet,
    centro: scope.center || 'TODOS',
    fechaLimite: scope.endDate,
    message: 'Edita CFG_Carga y luego ejecuta reconstruirMaestros().'
  };
}

function setupMasterData() {
  return reconstruirMaestros();
}

function cargarMaestros() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = appSpreadsheet_();
    appCacheClearMasterTables_();

    const counts = {};
    APP_MASTER_TABLE_NAMES_.forEach(name => {
      const rows = appReadTableFromSheet_(spreadsheet, name);
      appCacheSetTable_(name, rows);
      counts[name] = rows.length;
    });

    return Object.assign({ ok: true, message: 'Cache de maestros actualizado' }, counts);
  } finally {
    lock.releaseLock();
  }
}

function instalarTriggerMaestros() {
  desinstalarTriggerMaestros();
  ScriptApp.newTrigger('cargarMaestrosProgramado_')
    .timeBased()
    .everyHours(6)
    .create();

  return { ok: true, message: 'Trigger de recarga de maestros instalado cada 6 horas.' };
}

function desinstalarTriggerMaestros() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'cargarMaestrosProgramado_')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function cargarMaestrosProgramado_() {
  cargarMaestros();
}

function previsualizarInspeccionesHistoricasEneroActual() {
  return appCrearInspeccionesHistoricas_({ dryRun: true });
}

function crearInspeccionesHistoricasEneroActual() {
  return appCrearInspeccionesHistoricas_({ dryRun: false });
}

function previsualizarBorrarHistoricoAncash() {
  return appBorrarHistoricoCentro_('CD Ancash', { dryRun: true });
}

function borrarHistoricoAncash() {
  return appBorrarHistoricoCentro_('CD Ancash', { dryRun: false });
}

function appBorrarHistoricoCentro_(centro, options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const dryRun = Boolean(options && options.dryRun);
    const spreadsheet = appSpreadsheet_();
    const runSheet = appSheet_(spreadsheet, APP_CONFIG.tables.inspectionRuns, APP_HEADERS.inspectionRuns);
    const answerSheet = appSheet_(spreadsheet, APP_CONFIG.tables.answers, APP_HEADERS.answers);
    const result = {
      ok: true,
      dryRun: dryRun,
      centro: centro,
      runsDeleted: 0,
      answersDeleted: 0,
      rule: 'Borra unicamente registros historicos (REG_HIST_ o auditor Safety Champion) del centro indicado, en TX_Inspecciones y TX_Respuestas.'
    };

    if (runSheet.getLastRow() < 2) {
      Logger.log(JSON.stringify(result));
      return result;
    }

    const runValues = runSheet.getRange(1, 1, runSheet.getLastRow(), runSheet.getLastColumn()).getDisplayValues();
    const runHeaders = runValues[0].map(value => String(value || '').trim());
    const runIdIndex = appColumnIndexOrThrow_(runHeaders, 'inspeccion_registro_id', APP_CONFIG.tables.inspectionRuns);
    const runAuditorIndex = appColumnIndexOrThrow_(runHeaders, 'auditor', APP_CONFIG.tables.inspectionRuns);
    const runCenterIndex = appColumnIndexOrThrow_(runHeaders, 'centro', APP_CONFIG.tables.inspectionRuns);
    const registroIdsToDelete = {};
    const runRowsToDelete = [];

    runValues.slice(1).forEach((row, index) => {
      const registroId = String(row[runIdIndex] || '').trim();
      const auditorName = String(row[runAuditorIndex] || '').trim();
      const rowCentro = String(row[runCenterIndex] || '').trim();
      const isHistoricalRun = registroId.indexOf('REG_HIST_') === 0 ||
        appHeaderKey_(auditorName) === appHeaderKey_('Safety Champion');

      if (!registroId || !isHistoricalRun || rowCentro !== centro) {
        return;
      }

      registroIdsToDelete[registroId] = true;
      runRowsToDelete.push(index + 2);
    });

    result.runsDeleted = runRowsToDelete.length;

    if (answerSheet.getLastRow() >= 2) {
      const answerValues = answerSheet.getRange(1, 1, answerSheet.getLastRow(), answerSheet.getLastColumn()).getDisplayValues();
      const answerHeaders = answerValues[0].map(value => String(value || '').trim());
      const answerRunIdIndex = appColumnIndexOrThrow_(answerHeaders, 'inspeccion_registro_id', APP_CONFIG.tables.answers);
      const answerRowsToDelete = [];

      answerValues.slice(1).forEach((row, index) => {
        const registroId = String(row[answerRunIdIndex] || '').trim();
        if (registroIdsToDelete[registroId]) {
          answerRowsToDelete.push(index + 2);
        }
      });

      result.answersDeleted = answerRowsToDelete.length;

      if (!dryRun) {
        answerRowsToDelete.sort((a, b) => b - a).forEach(row => answerSheet.deleteRow(row));
      }
    }

    if (!dryRun) {
      runRowsToDelete.sort((a, b) => b - a).forEach(row => runSheet.deleteRow(row));
    }

    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function previsualizarObservacionesHistoricas5sOpl() {
  return appAplicarObservacionesHistoricas5sOpl_({ dryRun: true });
}

function aplicarObservacionesHistoricas5sOpl() {
  return appAplicarObservacionesHistoricas5sOpl_({ dryRun: false });
}

function appAplicarObservacionesHistoricas5sOpl_(options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = appSpreadsheet_();
    appEnsureMasterData_(spreadsheet);

    const timezone = spreadsheet.getSpreadsheetTimeZone();
    const scope = appLoadScope_(spreadsheet, options);
    const currentYear = scope.endDate.slice(0, 4);
    const dryRun = Boolean(options && options.dryRun);
    const runSheet = appSheet_(spreadsheet, APP_CONFIG.tables.inspectionRuns, APP_HEADERS.inspectionRuns);
    const answerSheet = appSheet_(spreadsheet, APP_CONFIG.tables.answers, APP_HEADERS.answers);
    const historicalRuleByCenter = {
      'CD Tumbes': {
        '01': 10, '02': 8, '03': 5,
        '04': 2, '05': 0, '06': 0,
        '07': 0, '08': 0, '09': 0, '10': 0
      }
    };
    const result = {
      ok: true,
      dryRun: dryRun,
      year: currentYear,
      center: scope.center || 'TODOS',
      endDate: scope.endDate,
      issuePercentByCenterAndMonth: historicalRuleByCenter,
      monthsByCenter: Object.keys(historicalRuleByCenter).reduce((acc, centro) => {
        if (scope.center && centro !== scope.center) {
          return acc;
        }
        acc[centro] = Object.keys(historicalRuleByCenter[centro])
          .sort()
          .map(month => currentYear + '-' + month)
          .filter(month => month <= scope.endDate.slice(0, 7));
        return acc;
      }, {}),
      runsReviewed: 0,
      candidateAnswers: 0,
      answersToNo: 0,
      runsWithObservation: 0,
      byType: {
        '5S': 0,
        OPL: 0
      },
      rule: 'CD Tumbes: mejora gradual con ~10%, ~8%, ~5% y ~2% de inspecciones con hallazgos de enero a abril respectivamente; mayo-octubre 100% conforme, sin recaidas. CD Talara: solo octubre de 2026, 100% conforme desde la generacion. Solo registros generados REG_HIST_ de 2026 y preguntas 5S/5 s u OPL. Seleccion deterministica por equipo/mes. No modifica inspecciones manuales ni Talara.'
    };

    if (runSheet.getLastRow() < 2 || answerSheet.getLastRow() < 2) {
      Logger.log(JSON.stringify(result));
      return result;
    }

    const runValues = runSheet.getRange(1, 1, runSheet.getLastRow(), runSheet.getLastColumn()).getDisplayValues();
    const answerValues = answerSheet.getRange(1, 1, answerSheet.getLastRow(), answerSheet.getLastColumn()).getDisplayValues();
    const runHeaders = runValues[0].map(value => String(value || '').trim());
    const answerHeaders = answerValues[0].map(value => String(value || '').trim());
    const runIdIndex = appColumnIndexOrThrow_(runHeaders, 'inspeccion_registro_id', APP_CONFIG.tables.inspectionRuns);
    const runDateIndex = appColumnIndexOrThrow_(runHeaders, 'fecha', APP_CONFIG.tables.inspectionRuns);
    const runTimestampIndex = appColumnIndexOrThrow_(runHeaders, 'marca_temporal', APP_CONFIG.tables.inspectionRuns);
    const runCenterIndex = appColumnIndexOrThrow_(runHeaders, 'centro', APP_CONFIG.tables.inspectionRuns);
    const runEquipmentIndex = appColumnIndexOrThrow_(runHeaders, 'equipo_id', APP_CONFIG.tables.inspectionRuns);
    const runObservationIndex = appColumnIndexOrThrow_(runHeaders, 'observaciones', APP_CONFIG.tables.inspectionRuns);
    const answerRunIdIndex = appColumnIndexOrThrow_(answerHeaders, 'inspeccion_registro_id', APP_CONFIG.tables.answers);
    const answerQuestionIdIndex = appColumnIndexOrThrow_(answerHeaders, 'pregunta_id', APP_CONFIG.tables.answers);
    const answerQuestionIndex = appColumnIndexOrThrow_(answerHeaders, 'pregunta', APP_CONFIG.tables.answers);
    const answerResponseIndex = appColumnIndexOrThrow_(answerHeaders, 'respuesta', APP_CONFIG.tables.answers);
    const runsById = {};
    const candidatesByRun = {};

    runValues.slice(1).forEach((row, index) => {
      const registroId = String(row[runIdIndex] || '').trim();
      const dateKey = appDateKey_(row[runDateIndex] || row[runTimestampIndex]);
      const monthKey = dateKey.slice(0, 7);
      const centro = String(row[runCenterIndex] || '').trim();
      const isHistoricalRun = registroId.indexOf('REG_HIST_') === 0;
      const monthRule = historicalRuleByCenter[centro];
      const issueChance = monthRule ? monthRule[monthKey.slice(5, 7)] : undefined;

      if (currentYear !== '2026' || !registroId || !isHistoricalRun || !dateKey || dateKey.slice(0, 4) !== currentYear ||
          dateKey > scope.endDate || (scope.center && centro !== scope.center) || !issueChance) {
        return;
      }

      result.runsReviewed += 1;
      runsById[registroId] = {
        registroId: registroId,
        sheetRow: index + 2,
        monthKey: monthKey,
        centro: centro,
        issueChance: issueChance,
        equipoId: String(row[runEquipmentIndex] || '').trim(),
        observaciones: String(row[runObservationIndex] || '').trim()
      };
    });

    answerValues.slice(1).forEach((row, index) => {
      const registroId = String(row[answerRunIdIndex] || '').trim();
      const run = runsById[registroId];

      if (!run) {
        return;
      }

      const issueType = appHistoricalIssueType_(row[answerQuestionIndex]);

      if (!issueType) {
        return;
      }

      if (!candidatesByRun[registroId]) {
        candidatesByRun[registroId] = [];
      }

      result.candidateAnswers += 1;
      candidatesByRun[registroId].push({
        sheetRow: index + 2,
        preguntaId: String(row[answerQuestionIdIndex] || '').trim(),
        pregunta: String(row[answerQuestionIndex] || '').trim(),
        issueType: issueType
      });
    });

    const responseColumnValues = answerSheet
      .getRange(2, answerResponseIndex + 1, answerSheet.getLastRow() - 1, 1)
      .getValues();
    const observationColumnValues = runSheet
      .getRange(2, runObservationIndex + 1, runSheet.getLastRow() - 1, 1)
      .getValues();

    Object.keys(candidatesByRun).forEach(registroId => {
      const run = runsById[registroId];
      const candidates = candidatesByRun[registroId];
      const shouldHaveIssue = appStableNumber_([run.monthKey, run.equipoId, registroId, '5S_OPL']) % 100 < run.issueChance;

      if (!shouldHaveIssue) {
        return;
      }

      const selected = appSelectHistoricalIssueAnswers_(run, candidates);
      const commentsByType = {};

      selected.forEach(item => {
        responseColumnValues[item.sheetRow - 2][0] = 'NO';
        commentsByType[item.issueType] = appHistoricalIssueComment_(item.issueType, [
          run.monthKey,
          run.equipoId,
          registroId,
          item.preguntaId
        ]);
        result.answersToNo += 1;
        result.byType[item.issueType] += 1;
      });

      const comments = Object.keys(commentsByType).map(type => commentsByType[type]);

      if (comments.length) {
        observationColumnValues[run.sheetRow - 2][0] = appMergeHistoricalObservation_(run.observaciones, comments);
        result.runsWithObservation += 1;
      }
    });

    if (!dryRun) {
      answerSheet
        .getRange(2, answerResponseIndex + 1, responseColumnValues.length, 1)
        .setValues(responseColumnValues);
      runSheet
        .getRange(2, runObservationIndex + 1, observationColumnValues.length, 1)
        .setValues(observationColumnValues);
    }

    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function appCrearInspeccionesHistoricas_(options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const spreadsheet = appSpreadsheet_();
    appEnsureMasterData_(spreadsheet);

    const timezone = spreadsheet.getSpreadsheetTimeZone();
    const scope = appLoadScope_(spreadsheet, options);
    const endDateParts = scope.endDate.split('-').map(Number);
    const currentYear = endDateParts[0];
    const currentMonth = endDateParts[1] - 1;
    const currentDay = endDateParts[2];
    const dryRun = Boolean(options && options.dryRun);
    const auditor = appResolveHistoricalAuditor_(spreadsheet, dryRun);
    const equipos = appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.equipment))
      .filter(equipo => !scope.center || equipo.centro === scope.center)
      .filter(equipo => Object.prototype.hasOwnProperty.call(APP_HISTORICAL_PERIODS, equipo.centro))
      .sort(appCompareEquipment_);
    const preguntasPorInspeccion = appGroupQuestionsByInspection_(
      appActiveRows_(appReadTable_(spreadsheet, APP_CONFIG.tables.questions))
    );
    const existingMonths = appBuildExistingInspectionMonthIndex_(
      appReadTable_(spreadsheet, APP_CONFIG.tables.inspectionRuns)
    );
    const runRows = [];
    const answerRows = [];
    const months = [];
    const monthsByCenter = {};
    Object.keys(APP_HISTORICAL_PERIODS).forEach(center => {
      if (!scope.center || center === scope.center) monthsByCenter[center] = [];
    });
    let skippedExisting = 0;
    let skippedOutsidePeriod = 0;
    let skippedNoValidDate = 0;

    for (let monthIndex = 0; monthIndex <= currentMonth; monthIndex += 1) {
      const monthKey = currentYear + '-' + ('0' + (monthIndex + 1)).slice(-2);
      const maxDay = monthIndex === currentMonth ? Math.min(14, currentDay) : 14;
      const validDays = appValidHistoricalInspectionDays_(currentYear, monthIndex, maxDay);
      let monthIncluded = false;

      if (!validDays.length) {
        skippedNoValidDate += equipos.length;
        continue;
      }

      equipos.forEach((equipo, equipmentIndex) => {
        const period = APP_HISTORICAL_PERIODS[equipo.centro];
        if (monthKey < period.startDate.slice(0, 7) || monthKey > period.endDate.slice(0, 7)) {
          skippedOutsidePeriod += 1;
          return;
        }
        monthIncluded = true;
        if (monthsByCenter[equipo.centro].indexOf(monthKey) === -1) {
          monthsByCenter[equipo.centro].push(monthKey);
        }
        const existingKey = equipo.equipo_id + '|' + monthKey;

        if (existingMonths[existingKey]) {
          skippedExisting += 1;
          return;
        }

        const inspectionDate = appHistoricalInspectionDate_(
          currentYear,
          monthIndex,
          validDays,
          equipo,
          equipmentIndex
        );
        const fecha = Utilities.formatDate(inspectionDate, timezone, 'yyyy-MM-dd');
        const registroId = appStableId_('REG_HIST', [monthKey, equipo.equipo_id]);
        const preguntas = preguntasPorInspeccion[equipo.inspeccion_id] || [];

        runRows.push([
          registroId,
          inspectionDate,
          fecha,
          equipo.centro_id,
          equipo.centro,
          auditor.auditor_id,
          auditor.auditor,
          equipo.inspeccion_id,
          equipo.tipo_equipo,
          equipo.equipo_id,
          equipo.ubicacion,
          equipo.codigo,
          ''
        ]);

        preguntas.forEach(pregunta => {
          answerRows.push([
            appStableId_('RSP_HIST', [registroId, pregunta.pregunta_id]),
            registroId,
            pregunta.pregunta_id,
            Number(pregunta.orden),
            pregunta.pregunta,
            'SI'
          ]);
        });

        existingMonths[existingKey] = true;
      });
      if (monthIncluded) months.push(monthKey);
    }

    const result = {
      ok: true,
      dryRun: dryRun,
      year: currentYear,
      center: scope.center || 'TODOS',
      endDate: scope.endDate,
      months: months,
      monthsByCenter: monthsByCenter,
      equipment: equipos.length,
      inspectionsToCreate: runRows.length,
      answersToCreate: answerRows.length,
      skippedExisting: skippedExisting,
      skippedOutsidePeriod: skippedOutsidePeriod,
      skippedNoValidDate: skippedNoValidDate,
      auditor: auditor.auditor,
      rule: 'CD Tumbes: enero de 2026 hasta la fecha limite. CD Talara: solo octubre de 2026 hasta la fecha limite. Dias 1 al 14, sin domingos, una inspeccion por equipo y mes si no existia.'
    };

    if (dryRun) {
      Logger.log(JSON.stringify(result));
      return result;
    }

    appAppendRows_(
      appSheet_(spreadsheet, APP_CONFIG.tables.inspectionRuns, APP_HEADERS.inspectionRuns),
      runRows,
      APP_HEADERS.inspectionRuns.length
    );
    appAppendRows_(
      appSheet_(spreadsheet, APP_CONFIG.tables.answers, APP_HEADERS.answers),
      answerRows,
      APP_HEADERS.answers.length
    );

    Logger.log(JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function appRebuildMasterData_(preserveTransactions) {
  const spreadsheet = appSpreadsheet_();
  const scope = appLoadScope_(spreadsheet);
  const data = appBuildMasterData_(scope);

  appWriteTable_(spreadsheet, APP_CONFIG.tables.centers, APP_HEADERS.centers, data.centers);
  appWriteTable_(spreadsheet, APP_CONFIG.tables.auditors, APP_HEADERS.auditors, data.auditors);
  appWriteTable_(spreadsheet, APP_CONFIG.tables.inspections, APP_HEADERS.inspections, data.inspections);
  appWriteTable_(spreadsheet, APP_CONFIG.tables.equipment, APP_HEADERS.equipment, data.equipment);
  appWriteTable_(spreadsheet, APP_CONFIG.tables.questions, APP_HEADERS.questions, data.questions);
  appEnsureTransactionSheets_(spreadsheet, preserveTransactions !== false);

  return {
    ok: true,
    center: scope.center || 'TODOS',
    endDate: scope.endDate,
    centers: data.centers.length,
    auditors: data.auditors.length,
    inspections: data.inspections.length,
    equipment: data.equipment.length,
    questions: data.questions.length
  };
}

function appBuildMasterData_(scope) {
  if (typeof APP_STATIC_MASTER_DATA === 'undefined') {
    throw new Error('No se encontro StaticMasterData.js. Genera los maestros desde archivo_base/Plantilla_Inspecciones.xlsx.');
  }

  const data = {
    centers: appCloneRows_(APP_STATIC_MASTER_DATA.centers),
    auditors: appCloneRows_(APP_STATIC_MASTER_DATA.auditors),
    inspections: appCloneRows_(APP_STATIC_MASTER_DATA.inspections),
    equipment: appCloneRows_(APP_STATIC_MASTER_DATA.equipment),
    questions: appCloneRows_(APP_STATIC_MASTER_DATA.questions)
  };

  if (!scope || !scope.center) {
    return data;
  }

  const centerKey = appHeaderKey_(scope.center);
  data.centers = data.centers.filter(row => appHeaderKey_(row[1]) === centerKey);
  if (!data.centers.length) {
    throw new Error('No se encontro el centro configurado: ' + scope.center);
  }

  const centerIds = {};
  data.centers.forEach(row => { centerIds[row[0]] = true; });
  data.equipment = data.equipment.filter(row => centerIds[row[1]]);

  const inspectionIds = {};
  data.equipment.forEach(row => { inspectionIds[row[3]] = true; });
  data.inspections = data.inspections.filter(row => inspectionIds[row[0]]);
  data.questions = data.questions.filter(row => inspectionIds[row[1]]);

  return {
    centers: data.centers,
    auditors: data.auditors,
    inspections: data.inspections,
    equipment: data.equipment,
    questions: data.questions
  };
}

function appEnsureRuntimeSheets_(spreadsheet) {
  appEnsureTransactionSheets_(spreadsheet, true);
}

function appEnsureMasterData_(spreadsheet) {
  appSeedMissingMasterTables_(spreadsheet);
  appEnsureTransactionSheets_(spreadsheet, true);
}

function appSeedMissingMasterTables_(spreadsheet) {
  const data = appBuildMasterData_(appLoadScope_(spreadsheet));
  const tables = [
    ['centers', APP_CONFIG.tables.centers, APP_HEADERS.centers, data.centers],
    ['auditors', APP_CONFIG.tables.auditors, APP_HEADERS.auditors, data.auditors],
    ['inspections', APP_CONFIG.tables.inspections, APP_HEADERS.inspections, data.inspections],
    ['equipment', APP_CONFIG.tables.equipment, APP_HEADERS.equipment, data.equipment],
    ['questions', APP_CONFIG.tables.questions, APP_HEADERS.questions, data.questions]
  ];

  tables.forEach(item => {
    const sheet = spreadsheet.getSheetByName(item[1]);
    if (!sheet || sheet.getLastRow() < 2) {
      appWriteTable_(spreadsheet, item[1], item[2], item[3]);
    }
  });
}

function appEnsureTransactionSheets_(spreadsheet, preserveRows) {
  appSheet_(spreadsheet, APP_CONFIG.tables.inspectionRuns, APP_HEADERS.inspectionRuns, preserveRows);
  appSheet_(spreadsheet, APP_CONFIG.tables.answers, APP_HEADERS.answers, preserveRows);
}

function appGroupQuestionsByInspection_(questions) {
  const groups = {};

  questions.forEach(question => {
    if (!groups[question.inspeccion_id]) {
      groups[question.inspeccion_id] = [];
    }

    groups[question.inspeccion_id].push(question);
  });

  Object.keys(groups).forEach(key => {
    groups[key].sort((a, b) => Number(a.orden) - Number(b.orden));
  });

  return groups;
}

function appBuildExistingInspectionMonthIndex_(runs) {
  const index = {};

  runs.forEach(run => {
    const equipmentId = String(run.equipo_id || '').trim();
    const dateKey = appDateKey_(run.fecha || run.marca_temporal);

    if (!equipmentId || !dateKey) {
      return;
    }

    index[equipmentId + '|' + dateKey.slice(0, 7)] = true;
  });

  return index;
}

function appHistoricalIssueType_(question) {
  const text = appHeaderKey_(question);
  const compact = text.replace(/\s+/g, '');

  if (/\b5\s*s\b/.test(text) || compact.indexOf('5s') !== -1) {
    return '5S';
  }

  if (text.indexOf('opl') !== -1) {
    return 'OPL';
  }

  return '';
}

function appSelectHistoricalIssueAnswers_(run, candidates) {
  const sorted = candidates.slice().sort((a, b) => {
    const aSeed = appStableNumber_([run.monthKey, run.equipoId, a.preguntaId, a.issueType]);
    const bSeed = appStableNumber_([run.monthKey, run.equipoId, b.preguntaId, b.issueType]);
    return aSeed - bSeed;
  });
  const selected = [];
  const types = {};

  sorted.forEach(item => {
    if (selected.length >= 2) {
      return;
    }

    if (types[item.issueType]) {
      return;
    }

    selected.push(item);
    types[item.issueType] = true;
  });

  if (!selected.length && sorted.length) {
    selected.push(sorted[0]);
  }

  return selected;
}

function appHistoricalIssueComment_(issueType, seedValues) {
  const commentsByType = {
    '5S': [
      'Falta limpieza en la zona de trabajo.',
      'Se observa material innecesario acumulado, pendiente de retirar.',
      'El area no esta ordenada, requiere clasificacion de materiales.',
      'Equipo con polvo/residuos, coordinar limpieza.',
      'Zona sin senalizacion 5S, falta estandarizar.',
      'Se encontraron herramientas fuera de su lugar asignado.',
      'Piso con manchas de aceite, riesgo de resbalones.',
      'Falta rotular ubicaciones segun el estandar 5S.',
      'Personal indica que la limpieza programada quedo pendiente.',
      'Area desordenada, se recomienda reforzar el habito de orden.'
    ],
    OPL: [
      'No se encontro la OPL del equipo en el punto de trabajo.',
      'OPL desactualizada respecto al procedimiento actual.',
      'La OPL esta danada y no se puede leer con claridad.',
      'OPL no esta visible para el personal operativo.',
      'Falta colocar la OPL correspondiente a este equipo.',
      'La OPL disponible corresponde a otro equipo, revisar.',
      'Se solicito la OPL y el personal no supo indicar su ubicacion.',
      'OPL incompleta, faltan pasos del procedimiento.',
      'La OPL esta despegada/suelta, pendiente de fijar.',
      'Vigencia de la OPL vencida, requiere actualizacion.'
    ]
  };
  const comments = commentsByType[issueType] || [];

  if (!comments.length) {
    return '';
  }

  return comments[appStableNumber_(seedValues) % comments.length];
}

function appMergeHistoricalObservation_(currentValue, comments) {
  const current = String(currentValue || '').trim();
  const cleanComments = comments.filter(appNotBlank_);

  if (!cleanComments.length) {
    return current;
  }

  const mergedComments = cleanComments.join(' ');

  if (!current) {
    return mergedComments;
  }

  const currentKey = appHeaderKey_(current);
  const missing = cleanComments.filter(comment => currentKey.indexOf(appHeaderKey_(comment)) === -1);

  if (!missing.length) {
    return current;
  }

  return current + ' ' + missing.join(' ');
}

function appValidHistoricalInspectionDays_(year, monthIndex, maxDay) {
  const days = [];
  const lastDay = Math.max(0, Math.min(14, Number(maxDay) || 0));

  for (let day = 1; day <= lastDay; day += 1) {
    const date = new Date(year, monthIndex, day, 12, 0, 0);

    if (date.getDay() !== 0) {
      days.push(day);
    }
  }

  return days;
}

function appHistoricalInspectionDate_(year, monthIndex, validDays, equipo, equipmentIndex) {
  const seed = appStableNumber_([
    year,
    monthIndex + 1,
    equipo.equipo_id,
    equipo.codigo,
    equipo.ubicacion,
    equipmentIndex
  ]);
  const day = validDays[seed % validDays.length];
  const hour = 8 + (seed % 9);
  const minute = (Math.floor(seed / 7) % 4) * 15;

  return new Date(year, monthIndex, day, hour, minute, 0);
}

function appAppendRows_(sheet, rows, columns) {
  if (!rows.length) {
    return;
  }

  const chunkSize = 500;
  let nextRow = sheet.getLastRow() + 1;

  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    sheet.getRange(nextRow, 1, chunk.length, columns).setValues(chunk);
    nextRow += chunk.length;
  }
}

function appResolveHistoricalAuditor_(spreadsheet, dryRun) {
  const auditorName = 'Safety Champion';
  const auditors = appReadTable_(spreadsheet, APP_CONFIG.tables.auditors);
  const existing = auditors.find(item => appHeaderKey_(item.auditor) === appHeaderKey_(auditorName));

  if (existing) {
    return existing;
  }

  if (dryRun) {
    return {
      auditor_id: appStableId_('AUD', [auditorName]),
      auditor: auditorName,
      activo: 'SI'
    };
  }

  return appResolveAuditor_(spreadsheet, null, auditorName, true);
}

function appResolveAuditor_(spreadsheet, auditorId, auditorName, allowCreate) {
  const auditors = appReadTable_(spreadsheet, APP_CONFIG.tables.auditors);
  const byId = auditors.find(item => item.auditor_id === auditorId && appIsActive_(item));

  if (byId) {
    return byId;
  }

  const cleanName = String(auditorName || '').trim();
  if (!cleanName) {
    throw new Error('Indica el auditor.');
  }

  const byName = auditors.find(item => appHeaderKey_(item.auditor) === appHeaderKey_(cleanName));
  if (byName) {
    return byName;
  }

  if (!allowCreate) {
    throw new Error('Selecciona un auditor del maestro.');
  }

  const newAuditor = {
    auditor_id: appStableId_('AUD', [cleanName]),
    auditor: cleanName,
    activo: 'SI'
  };

  appSheet_(spreadsheet, APP_CONFIG.tables.auditors, APP_HEADERS.auditors).appendRow([
    newAuditor.auditor_id,
    newAuditor.auditor,
    newAuditor.activo
  ]);

  return newAuditor;
}

function appSpreadsheet_() {
  if (!APP_CONFIG.spreadsheetId) {
    throw new Error('Falta configurar el ID del Google Sheet de Tumbes y Talara.');
  }
  return SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
}

function appLoadScope_(spreadsheet, options) {
  const timezone = spreadsheet.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const sheet = spreadsheet.getSheetByName(APP_CONFIG.loadConfigSheet);
  let center = '';
  let endDate = today;

  if (sheet && sheet.getLastRow() >= 2) {
    const values = sheet.getRange(2, 1, 1, 2).getDisplayValues()[0];
    center = String(values[0] || '').trim();
    endDate = String(values[1] || '').trim() || today;
  }

  if (options && Object.prototype.hasOwnProperty.call(options, 'center')) {
    center = String(options.center || '').trim();
  }
  if (options && Object.prototype.hasOwnProperty.call(options, 'endDate')) {
    endDate = String(options.endDate || '').trim();
  }

  if (!center || ['todos', 'todas', '*'].indexOf(appHeaderKey_(center)) !== -1) {
    center = '';
  } else {
    const configuredCenter = APP_STATIC_MASTER_DATA.centers.find(
      row => appHeaderKey_(row[1]) === appHeaderKey_(center)
    );
    if (!configuredCenter) {
      throw new Error('No se encontro el centro configurado: ' + center);
    }
    center = configuredCenter[1];
  }

  const dateMatch = endDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) {
    throw new Error('La fecha limite debe tener el formato AAAA-MM-DD.');
  }

  const parsedDate = new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]));
  if (parsedDate.getFullYear() !== Number(dateMatch[1]) ||
      parsedDate.getMonth() !== Number(dateMatch[2]) - 1 ||
      parsedDate.getDate() !== Number(dateMatch[3])) {
    throw new Error('La fecha limite no es valida: ' + endDate);
  }
  return {
    center: center,
    endDate: endDate
  };
}

function appWriteTable_(spreadsheet, name, headers, rows) {
  const sheet = appSheet_(spreadsheet, name, headers, false);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  appFormatTable_(sheet, headers.length);
}

function appSheet_(spreadsheet, name, headers, preserveRows) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
  }

  if (sheet.getLastRow() === 0 || preserveRows === false) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    appFormatTable_(sheet, headers.length);
  }

  return sheet;
}

function appFormatTable_(sheet, columns) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, columns)
    .setFontWeight('bold')
    .setBackground('#eef2ff');
  sheet.autoResizeColumns(1, columns);
}

const APP_MASTER_TABLE_NAMES_ = Object.keys(APP_CONFIG.tables)
  .filter(key => key !== 'inspectionRuns' && key !== 'answers')
  .map(key => APP_CONFIG.tables[key]);
const APP_CACHE_TTL_SECONDS_ = 21600; // 6 horas
const APP_CACHE_CHUNK_SIZE_ = 45000; // caracteres; con acentos UTF-8 puede pesar 2x en bytes, bajo el limite de 100KB de CacheService

function appReadTable_(spreadsheet, name) {
  const isMasterTable = APP_MASTER_TABLE_NAMES_.indexOf(name) !== -1;

  if (isMasterTable) {
    const cached = appCacheGetTable_(name);
    if (cached) {
      return cached;
    }
  }

  const rows = appReadTableFromSheet_(spreadsheet, name);

  if (isMasterTable) {
    appCacheSetTable_(name, rows);
  }

  return rows;
}

function appReadTableFromSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const values = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
  const headers = values[0].map(value => String(value || '').trim());

  return values.slice(1)
    .filter(row => row.some(appNotBlank_))
    .map(row => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = String(row[index] || '').trim();
      });
      return item;
    });
}

function appCacheGetTable_(name) {
  try {
    const cache = CacheService.getScriptCache();
    const chunkCountRaw = cache.get('mastercache_' + name + '_count');
    if (!chunkCountRaw) {
      return null;
    }

    const chunkCount = Number(chunkCountRaw);
    const keys = [];
    for (let i = 0; i < chunkCount; i += 1) {
      keys.push('mastercache_' + name + '_' + i);
    }

    const chunks = cache.getAll(keys);
    let json = '';
    for (let i = 0; i < chunkCount; i += 1) {
      const chunk = chunks['mastercache_' + name + '_' + i];
      if (chunk === null || chunk === undefined) {
        return null;
      }
      json += chunk;
    }

    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

function appCacheSetTable_(name, rows) {
  try {
    const cache = CacheService.getScriptCache();
    const json = JSON.stringify(rows);
    const chunkCount = Math.max(1, Math.ceil(json.length / APP_CACHE_CHUNK_SIZE_));
    const values = {};
    values['mastercache_' + name + '_count'] = String(chunkCount);

    for (let i = 0; i < chunkCount; i += 1) {
      values['mastercache_' + name + '_' + i] = json.slice(i * APP_CACHE_CHUNK_SIZE_, (i + 1) * APP_CACHE_CHUNK_SIZE_);
    }

    cache.putAll(values, APP_CACHE_TTL_SECONDS_);
  } catch (error) {
    // Si el cache falla (p.ej. cuota o tamano), simplemente no se cachea.
  }
}

function appCacheClearMasterTables_() {
  const cache = CacheService.getScriptCache();
  const keys = [];

  APP_MASTER_TABLE_NAMES_.forEach(name => {
    for (let i = 0; i < 10; i += 1) {
      keys.push('mastercache_' + name + '_' + i);
    }
    keys.push('mastercache_' + name + '_count');
  });

  cache.removeAll(keys);
}

function appActiveRows_(rows) {
  return rows.filter(appIsActive_);
}

function appCloneRows_(rows) {
  return rows.map(row => row.slice());
}

function appIsActive_(row) {
  return String(row.activo || 'SI').toUpperCase() !== 'NO';
}

function appIndexBy_(rows, key) {
  return rows.reduce((index, row) => {
    index[row[key]] = row;
    return index;
  }, {});
}

function appCompareEquipment_(a, b) {
  return a.tipo_equipo.localeCompare(b.tipo_equipo) ||
    a.codigo.localeCompare(b.codigo) ||
    a.ubicacion.localeCompare(b.ubicacion);
}

function appBuildStatusByEquipment_(runs, currentMonth) {
  const statusByEquipment = {};

  runs.forEach(run => {
    const equipmentId = String(run.equipo_id || '').trim();
    const dateKey = appDateKey_(run.fecha || run.marca_temporal);

    if (!equipmentId || !dateKey) {
      return;
    }

    if (!statusByEquipment[equipmentId]) {
      statusByEquipment[equipmentId] = appEmptyInspectionStatus_();
    }

    const status = statusByEquipment[equipmentId];
    if (!status.lastInspectionDate || dateKey > status.lastInspectionDate) {
      status.lastInspectionDate = dateKey;
      status.lastAuditor = String(run.auditor || '').trim();
    }

    if (dateKey.slice(0, 7) === currentMonth) {
      status.doneThisMonth = true;
      status.doneThisMonthDate = appLatestDate_(status.doneThisMonthDate, dateKey);
    }
  });

  return statusByEquipment;
}

function appEmptyInspectionStatus_() {
  return {
    doneThisMonth: false,
    doneThisMonthDate: '',
    lastInspectionDate: '',
    lastAuditor: ''
  };
}

function appCurrentMonthKey_(spreadsheet) {
  return Utilities.formatDate(new Date(), spreadsheet.getSpreadsheetTimeZone(), 'yyyy-MM');
}

function appDateKey_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = String(value || '').trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    return [
      match[1],
      ('0' + match[2]).slice(-2),
      ('0' + match[3]).slice(-2)
    ].join('-');
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    return [
      match[3],
      ('0' + match[2]).slice(-2),
      ('0' + match[1]).slice(-2)
    ].join('-');
  }

  return '';
}

function appLatestDate_(currentDate, nextDate) {
  if (!currentDate) return nextDate || '';
  if (!nextDate) return currentDate;
  return nextDate > currentDate ? nextDate : currentDate;
}

function appEquipmentLabel_(type, location, code) {
  if (code && location) return code + ' - ' + location;
  if (code) return code;
  if (location) return location;
  return type;
}

function appFindColumn_(headers, field) {
  const target = appHeaderKey_(field);
  return headers.findIndex(header => appHeaderKey_(header) === target);
}

function appColumnIndexOrThrow_(headers, field, tableName) {
  const index = appFindColumn_(headers, field);

  if (index === -1) {
    throw new Error('No se encontro la columna ' + field + ' en ' + tableName + '.');
  }

  return index;
}

function appIsBaseColumn_(header) {
  return [
    'marca temporal',
    'llave',
    'centro de distribucion',
    'fecha',
    'auditor',
    'ubicacion',
    'codigo',
    'observaciones'
  ].indexOf(appHeaderKey_(header)) !== -1;
}

function appCell_(row, index) {
  if (index < 0) return '';
  return String(row[index] || '').trim();
}

function appHeaderKey_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!:;.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function appStableId_(prefix, values) {
  const source = values.map(value => String(value || '').trim()).join('|');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, source)
    .map(byte => {
      const value = byte < 0 ? byte + 256 : byte;
      return ('0' + value.toString(16)).slice(-2);
    })
    .join('')
    .slice(0, 12)
    .toUpperCase();

  return prefix + '_' + digest;
}

function appStableNumber_(values) {
  const source = values.map(value => String(value || '').trim()).join('|');
  let hash = 0;

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) % 2147483647;
  }

  return Math.abs(hash);
}

function appNotBlank_(value) {
  return String(value || '').trim() !== '';
}
