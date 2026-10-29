import { nanoid } from 'nanoid'

/** Client-minted ids let undo/redo recreate a record under the same id. */
export const newId = (prefix = 'c') => `${prefix}_${nanoid(12)}`
