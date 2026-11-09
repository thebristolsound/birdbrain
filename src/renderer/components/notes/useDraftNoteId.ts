import { useCallback, useRef, useState } from 'react'

/**
 * The id of the note a New note card or Add Note modal is drafting, once the
 * Tag action has written it out (#391).
 *
 * No current screen keeps either form mounted across close and reopen: the card
 * has no host, and the captures route unmounts the modal on close. A host that
 * did keep one mounted would let a `notes:create` still in flight at reset
 * resolve into the next draft and point its Save at the earlier note (#873,
 * #890). Each reset starts a new draft session, and a create only binds the
 * session it started in.
 */
export function useDraftNoteId() {
  const [draftNoteId, setDraftNoteId] = useState<string | null>(null)
  const session = useRef(0)

  const resetDraftNoteId = useCallback(() => {
    session.current += 1
    setDraftNoteId(null)
  }, [])

  const bindCreated = useCallback(async (create: () => Promise<{ id: string }>) => {
    const startedIn = session.current
    const { id } = await create()
    if (session.current === startedIn) setDraftNoteId(id)
    return id
  }, [])

  return { draftNoteId, resetDraftNoteId, bindCreated }
}
