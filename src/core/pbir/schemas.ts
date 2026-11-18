/** `$schema` URLs written for new / converted PBIR files (latest published versions). */
const BASE = 'https://developer.microsoft.com/json-schemas/fabric'

export const SCHEMA = {
  definitionProperties: `${BASE}/item/report/definitionProperties/2.0.0/schema.json`,
  report: `${BASE}/item/report/definition/report/3.0.0/schema.json`,
  version: `${BASE}/item/report/definition/versionMetadata/1.0.0/schema.json`,
  pagesMetadata: `${BASE}/item/report/definition/pagesMetadata/1.0.0/schema.json`,
  page: `${BASE}/item/report/definition/page/2.0.0/schema.json`,
  visualContainer: `${BASE}/item/report/definition/visualContainer/2.4.0/schema.json`,
  visualContainerMobileState: `${BASE}/item/report/definition/visualContainerMobileState/2.3.0/schema.json`,
  bookmarksMetadata: `${BASE}/item/report/definition/bookmarksMetadata/1.0.0/schema.json`,
  bookmark: `${BASE}/item/report/definition/bookmark/1.4.0/schema.json`,
  reportExtension: `${BASE}/item/report/definition/reportExtension/1.0.0/schema.json`,
  platform: `${BASE}/gitIntegration/platformProperties/2.0.0/schema.json`,
  pbip: `${BASE}/pbip/pbipProperties/1.0.0/schema.json`,
  semanticModelDefinition: `${BASE}/item/semanticModel/definitionProperties/1.0.0/schema.json`
} as const

/** PBIR `version.json` value written for new reports. */
export const PBIR_VERSION = '2.0.0'
/** `definition.pbir` version for the PBIR (enhanced) format. */
export const PBIR_DEFINITION_VERSION = '4.0'
