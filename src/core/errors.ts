export class ArchipelagoError extends Error {
  readonly valid?: string[];
  constructor(message: string, valid?: string[]) {
    super(message);
    this.name = new.target.name;
    if (valid) this.valid = valid;
  }
  toJSON(): { error: string; valid?: string[] } {
    return this.valid ? { error: this.message, valid: this.valid } : { error: this.message };
  }
}

/** A slug or id that does not exist. `valid` lists what would have been accepted. */
export class NotFoundError extends ArchipelagoError {}

/** A write that contradicts the model, e.g. a strait between non-siblings. */
export class ConflictError extends ArchipelagoError {}
