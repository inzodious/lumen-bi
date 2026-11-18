export interface SourcePos {
  line: number;
  col: number;
}

export class DaxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DaxError";
  }
}

export class DaxSyntaxError extends DaxError {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
  ) {
    super("SYNTAX", `Syntax error at ${line}:${col}: ${message}`);
    this.name = "DaxSyntaxError";
  }
}

/** `next` tells the learner what to do instead. */
export function unsupported(what: string, next?: string): DaxError {
  return new DaxError("UNSUPPORTED", `${what} is not supported in Parity yet.${next ? ` ${next}` : ""}`);
}

export function unsupportedFunction(name: string): DaxError {
  return new DaxError("UNSUPPORTED_FUNCTION", `DAX function ${name.toUpperCase()} is not supported in Parity yet.`);
}
