/**
 * Public surface of the persistence layer.
 *
 * Same rule as `@/engine`: the rest of the app imports from '@/persistence',
 * not from a module inside it. That is what lets the Supabase adapter land as
 * a new file behind `DesignLibrary` without touching a call site.
 */

export {
  createSavedDesign,
  DESIGN_SCHEMA_VERSION,
  DesignParseError,
  MAX_NAME_LENGTH,
  parseDesign,
  parseDesignJson,
  serializeDesign,
  type SavedDesign,
} from './schema.ts'
export {
  browserStorage,
  createLocalDesignLibrary,
  DesignStorageError,
  newDesignId,
  STORAGE_PREFIX,
  type DesignLibrary,
  type DesignRecord,
  type LocalDesignLibraryOptions,
} from './library.ts'
export {
  decodeDesign,
  encodeDesign,
  MAX_TOKEN_LENGTH,
  readShareToken,
  SHARE_FRAGMENT_KEY,
  shareUrl,
} from './share.ts'
