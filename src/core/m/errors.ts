export interface SourcePos {
  line: number;
  col: number;
}

/** A Power Query error value: `Reason: Message`, with an optional Detail. */
export class MError extends Error {
  pos?: SourcePos;
  constructor(
    readonly reason: string,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "MError";
  }

  override toString(): string {
    return `${this.reason}: ${this.message}`;
  }
}

export class MSyntaxError extends MError {
  constructor(
    message: string,
    readonly line: number,
    readonly col: number,
  ) {
    super("Expression.SyntaxError", message);
    this.pos = { line, col };
    this.name = "MSyntaxError";
  }

  override toString(): string {
    return `${this.reason}: ${this.message} (line ${this.line}, col ${this.col})`;
  }
}
