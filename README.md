# Inspecciones · Agencias Tumbes y Talara

Réplica local de Inspecciones Piura, con la misma interfaz, navegación, formularios, registro de inspecciones, respuestas y funciones de carga.

## Archivos

- `Código.js`: backend de Google Apps Script.
- `Index.html`: interfaz incluida en Apps Script.
- `github_frontend/index.html`: la misma interfaz para el nuevo repositorio de GitHub.
- `StaticMasterData.js`: sedes CD Tumbes y CD Talara; equipos, auditores y preguntas pendientes de los archivos de entrada.
- `archivo_base/`: carpeta para cargar los Excel de Tumbes y Talara.

No se copiaron inventarios, archivos Excel, historial Git ni conexiones de Piura/Sullana.

## Cuando lleguen los archivos

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

La versión 2 está implementada en Apps Script. La comprobación HTTP sin sesión devolvió 403 de Google; queda pendiente validar el acceso y la autorización con la cuenta propietaria. La URL de la aplicación está configurada en ambos HTML. El ID de Apps Script está en el archivo local `.clasp.json`, excluido de Git. La carga de equipos, auditores y preguntas queda pendiente de los Excel.

## Funciones históricas heredadas

Se conservaron las reglas del original con los nombres regionales sustituidos: Tumbes ocupa el lugar de Piura (enero a diciembre de 2026) y Talara el de Sullana (solo octubre de 2026). También se conserva la función opcional que genera observaciones históricas 5S/OPL. Estas funciones generan registros sintéticos; no se han ejecutado contra ninguna hoja. Revisar los periodos y reglas antes de usarlas con los nuevos datos.

La comprobación heredada `node scripts/verify-historical-periods.cjs` requiere maestros con equipos de ambas sedes. Antes de recibir los Excel, las colecciones de equipos y preguntas permanecen vacías.
