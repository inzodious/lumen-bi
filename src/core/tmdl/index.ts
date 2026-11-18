/**
 * TMDL + TMSL (model.bim) support.
 *
 *   readTmdlFiles(files)        TMDL `definition/` folder (relative path -> text) -> SemanticModel
 *   writeTmdlFiles(model)       SemanticModel -> TMDL files (byte-identical for unmodified parsed models)
 *   parseTmdlText(text)         generic TMDL declaration tree
 *   readTmsl(json) / writeTmsl  model.bim / DataModelSchema JSON <-> SemanticModel
 */
export { readTmdlFiles, type TmdlReadResult } from './read'
export { writeTmdlFiles, exprBlock, type TmdlGenericNode, type DatabaseInfo } from './write'
export { parseTmdlText, nodeSource, type TmdlNode, type TmdlDocument, type TmdlError } from './parser'
export { quoteName, qualifiedName, parseQualified, splitQualified, unquoteName, encodeTextValue, decodeTextValue } from './names'
export { clearHint } from './hints'
export { readTmsl, writeTmsl, type TmslReadResult } from './tmsl'
