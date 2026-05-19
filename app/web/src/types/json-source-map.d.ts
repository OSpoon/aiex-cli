declare module 'json-source-map' {
  export interface SourceLocation {
    line: number
    column: number
    pos: number
  }

  export interface JsonPointerLocation {
    key?: SourceLocation
    keyEnd?: SourceLocation
    value?: SourceLocation
    valueEnd?: SourceLocation
  }

  export function parse(source: string): {
    data: unknown
    pointers: Record<string, JsonPointerLocation>
  }
}

