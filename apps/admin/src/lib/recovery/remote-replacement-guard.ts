/**
 * Guard collaborative replacement against undurable checkpoints and concurrent edits.
 * Pure decision logic so failures can be tested without an editor instance.
 */
export interface RemoteReplacementSafety {
  hadUnsavedChangesAtStart: boolean;
  checkpointDurable: boolean;
  generationAtStart: number;
  generationNow: number;
  hasUnsavedChangesNow: boolean;
}

export function canApplyRemoteReplacement(state: RemoteReplacementSafety): boolean {
  if (state.generationAtStart !== state.generationNow) return false;
  if (state.hadUnsavedChangesAtStart && !state.checkpointDurable) return false;
  if (!state.hadUnsavedChangesAtStart && state.hasUnsavedChangesNow) return false;
  return true;
}
