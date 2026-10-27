# Inspecciones · Agencias Tumbes y Talara

Réplica local de Inspecciones Piura, con la misma interfaz, navegación, formularios, registro de inspecciones, respuestas y funciones de carga.

## Archivos

- `Código.js`: backend de Google Apps Script.
- `Index.html`: interfaz incluida en Apps Script.
- `github_frontend/index.html`: la misma interfaz para el nuevo repositorio de GitHub.
- `StaticMasterData.js`: maestros generados desde la plantilla cargada: 82 equipos de Tumbes, 67 de Talara, 15 tipos de inspección, 118 preguntas y 1 auditor.
- `archivo_base/`: carpeta para cargar los Excel de Tumbes y Talara.

No se copiaron inventarios, archivos Excel, historial Git ni conexiones de Piura/Sullana.

## Regenerar los maestros desde los archivos

Conservar el formato del proyecto original:

1. Colocar las plantillas de equipos como `Plantilla_Inspecciones*.xlsx` en `archivo_base/`. Columnas: `#Num`, `CD`, `Ubicación`, `Equipo`. Los nombres de las sedes se toman de la columna `CD`.
2. Colocar el archivo de preguntas como `archivo_base/Base de muestra.xlsx`.
3. Ejecutar `npm ci` y `node scripts/generate-static-master-data.cjs`.
4. Revisar los maestros generados antes de ejecutar la carga en Apps Script.

## Conexiones configuradas

- Repositorio: https://github.com/peru-bu/inspecciones-tumbes-talara
- Frontend remoto: https://raw.githubusercontent.com/peru-bu/inspecciones-tumbes-talara/main/github_frontend/index.html
- Apps Script: https://script.google.com/home/projects/1QUW7Pm7v91ao2R3OdkAQ02JRSujzgmvOMpp0160_C4R8--70W3_rLEdV/edit
- Google Sheet: https://docs.google.com/spreadsheets/d/1VUai8d57pKhPjsnI8RJkQhkAlw2GL_7GbG1xd6uU5HQ/edit
- Aplicación web: https://script.google.com/macros/s/AKfycbxTveQj0B-B-JH21_NvXnQDpxuZeXrsRQnTpYhu83CWCDcTm8YgPMSLYQ2pg3ZZh3tUgA/exec

La comprobación HTTP sin sesión devolvió 403 de Google; queda pendiente validar el acceso y la autorización con la cuenta propietaria. La URL de la aplicación está configurada en ambos HTML. El ID de Apps Script está en el archivo local `.clasp.json`, excluido de Git. StaticMasterData.js contiene los maestros preparados para cargar desde Apps Script. Los dos equipos de Alarma CI marcados como CD Chimbote están excluidos provisionalmente y figuran en excludedEquipment.

## Generar desde Apps Script

Después de sincronizar el código, ejecutar en este orden:

1. `reconstruirMaestros()`: carga los equipos y preguntas de StaticMasterData.js en las tablas MA_, conservando las transacciones.
2. `prepararConfiguracionCarga()`: permite revisar en CFG_Carga el centro (TODOS para ambas agencias) y la fecha límite (por ejemplo 2026-10-27).
3. `crearInspeccionesHistoricasEneroActual()`: genera una inspección por equipo y mes en ambas agencias de enero a octubre de 2026, sin duplicar los equipos/mes existentes.
4. `aplicarObservacionesHistoricas5sOpl()`: aplica las observaciones generadas a preguntas 5S/OPL, preservando las inspecciones manuales.

Curva objetivo de inspecciones conformes: enero 90%, febrero 94%, marzo 97%, abril y mayo 100%, junio 97%, julio 98%, agosto a octubre 100%. Los conteos se redondean por agencia y mes. Las filas automáticas REG_HIST_ están identificadas como GENERADO AUTOMATICAMENTE - escenario historico 2026; son un escenario generado, no constancia de inspecciones realizadas.

Las funciones `previsualizarInspeccionesHistoricasEneroActual()` y `previsualizarObservacionesHistoricas5sOpl()` muestran los recuentos antes de aplicar. El script `node scripts/verify-historical-periods.cjs` comprueba los periodos, la curva de ambas agencias, los meses al 100%, la conservación de registros manuales y la repetición sin duplicados.

La subida del código no ejecuta estas funciones ni carga registros en la hoja.
