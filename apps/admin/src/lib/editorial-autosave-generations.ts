/**
 * Local edit generations are independent of network request sequencing.
 * In particular, a response for a snapshot taken before a later edit cannot
 * acknowledge that later edit (even if no second request has started yet).
 */
export interface SaveTicket {
  readonly sequence: number;
  readonly generation: number;
}

export class EditorialAutosaveGenerations {
  private generation = 0;
  private sequence = 0;

  markEdited(): number {
    this.generation += 1;
    return this.generation;
  }

  beginSave(): SaveTicket {
    return { sequence: ++this.sequence, generation: this.generation };
  }

  acknowledge(ticket: SaveTicket): { latestRequest: boolean; latestEdit: boolean } {
    const latestRequest = ticket.sequence === this.sequence;
    return { latestRequest, latestEdit: latestRequest && ticket.generation === this.generation };
  }

  isCurrent(ticket: SaveTicket): boolean {
    return this.acknowledge(ticket).latestEdit;
  }

  get currentGeneration(): number {
    return this.generation;
  }

  /** Used only after the author confirms a destructive revision replacement. */
  reset(): void {
    this.generation += 1;
    this.sequence += 1;
  }
}
