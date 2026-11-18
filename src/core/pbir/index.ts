/**
 * PBIR (Power BI enhanced report format) support.
 *
 *   readPbirFolder(fs, dir) / writePbirFolder(fs, dir, doc)   *.Report folder <-> ReportDocument
 *   readPbirFiles(files) / pbirToFiles(doc)                    same, on in-memory file maps
 *   convertLegacyLayout(layout)                                 PBIX Report/Layout & PBIR-legacy report.json -> PBIR
 *   resolveThemes(doc), resource helpers (mime, ResourcePackageItem -> file, data/blob URLs)
 */
export {
  readPbirFiles,
  readPbirFolder,
  pbirToFiles,
  writePbirFolder,
  writeFileMap,
  readTree,
  resolveThemes,
  applyLegacy,
  decodeText,
  deepEqual,
  type FileMap,
  type OutFileMap
} from './pbir'
export { convertLegacyLayout, convertFilters, type LegacyConversion } from './legacy'
export {
  mimeFromPath,
  makeResource,
  resourcePathForItem,
  findResource,
  resourceDataUrl,
  resourceBlobUrl,
  bytesToBase64,
  type ResourcePackageItemRef
} from './resources'
export { SCHEMA, PBIR_VERSION, PBIR_DEFINITION_VERSION } from './schemas'
