export class DaxError extends Error {
  /** 0-based source offsets of the offending expression, when known. */
  start?: number
  end?: number
  constructor(
    public readonly code: string,
    message: string,
    span?: { start: number; end: number } | { s: number; e: number }
  ) {
    super(message)
    this.name = 'DaxError'
    if (span) {
      if ('s' in span) {
        this.start = span.s
        this.end = span.e
      } else {
        this.start = span.start
        this.end = span.end
      }
    }
  }
}

export class DaxSyntaxError extends DaxError {
  constructor(
    message: string,
    public readonly line: number,
    public readonly col: number,
    start: number,
    end: number
  ) {
    super('SYNTAX', `Syntax error at ${line}:${col}: ${message}`, { start, end })
    this.name = 'DaxSyntaxError'
  }
}

export function unknownFunction(name: string, span?: { start: number; end: number } | { s: number; e: number }): DaxError {
  return new DaxError('UNKNOWN_FUNCTION', `The function '${name.toUpperCase()}' is not supported by this engine (unknown DAX function).`, span)
}
