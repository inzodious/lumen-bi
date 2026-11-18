/** Scalar functions: logical, information, math, text, date/time. */
import { formatValue } from '../../format/index.ts'
import { DaxError } from './errors.ts'
import type { Node } from './parser.ts'
import { defineFn, type Env } from './registry.ts'
import { isTable } from './table.ts'
import type { Evaluator } from './evaluator.ts'
import {
  compare,
  dateOnly,
  dayNumber,
  fromDayNumber,
  fromSerial,
  generalNumber,
  makeDate,
  MS_PER_DAY,
  parseDateText,
  serialOf,
  toBool,
  toDate,
  toNumber,
  toText,
  type Scalar
} from './values.ts'

const S = (ev: Evaluator, n: Node | undefined, env: Env): Scalar => (n ? ev.scalar(n, env) : null)
const N = (ev: Evaluator, n: Node, env: Env): number => toNumber(ev.scalar(n, env))
const T = (ev: Evaluator, n: Node, env: Env): string => toText(ev.scalar(n, env))
const missing = (n: Node | undefined) => !n || (n.kind === 'ident' && n.name === '__missing__')
const identName = (n: Node | undefined): string => (n && n.kind === 'ident' ? n.name.toUpperCase() : n && n.kind === 'string' ? n.value.toUpperCase() : '')

// ------------------------------------------------------------------------------------------------
// logical
// ------------------------------------------------------------------------------------------------

defineFn('BLANK', () => null, { max: 0 })
defineFn(['TRUE', 'FALSE'], (_ev, _a, _env, node) => node.name.toUpperCase() === 'TRUE', { max: 0 })
defineFn(
  ['IF', 'IF.EAGER'],
  (ev, a, env) => {
    if (toBool(ev.scalar(a[0], env))) return ev.value(a[1], env)
    return missing(a[2]) ? null : ev.value(a[2], env)
  },
  { min: 2, max: 3 }
)
defineFn(
  'SWITCH',
  (ev, a, env) => {
    const v = ev.scalar(a[0], env)
    let i = 1
    for (; i + 1 < a.length; i += 2) {
      const x = ev.scalar(a[i], env)
      let eq: boolean
      try {
        eq = compare(v, x) === 0
      } catch (e) {
        if (v === null || x === null) eq = false
        else throw e
      }
      if (eq) return ev.value(a[i + 1], env)
    }
    return i < a.length ? ev.value(a[i], env) : null
  },
  { min: 3 }
)
defineFn(
  'COALESCE',
  (ev, a, env) => {
    for (const x of a) {
      const v = ev.scalar(x, env)
      if (v !== null) return v
    }
    return null
  },
  { min: 1 }
)
defineFn('AND', (ev, a, env) => toBool(ev.scalar(a[0], env)) && toBool(ev.scalar(a[1], env)), { min: 2, max: 2 })
defineFn('OR', (ev, a, env) => toBool(ev.scalar(a[0], env)) || toBool(ev.scalar(a[1], env)), { min: 2, max: 2 })
defineFn('XOR', (ev, a, env) => toBool(ev.scalar(a[0], env)) !== toBool(ev.scalar(a[1], env)), { min: 2, max: 2 })
defineFn('NOT', (ev, a, env) => !toBool(ev.scalar(a[0], env)), { min: 1, max: 1 })
defineFn(
  'IFERROR',
  (ev, a, env) => {
    try {
      return ev.value(a[0], env)
    } catch (e) {
      if (e instanceof DaxError && (e.code === 'UNKNOWN_FUNCTION' || e.code === 'SYNTAX' || e.code === 'CIRCULAR')) throw e
      return ev.value(a[1], env)
    }
  },
  { min: 2, max: 2 }
)
defineFn(
  'ISERROR',
  (ev, a, env) => {
    try {
      ev.value(a[0], env)
      return false
    } catch (e) {
      if (e instanceof DaxError && (e.code === 'UNKNOWN_FUNCTION' || e.code === 'SYNTAX')) throw e
      return true
    }
  },
  { min: 1, max: 1 }
)
defineFn('ISBLANK', (ev, a, env) => ev.scalar(a[0], env) === null, { min: 1, max: 1 })
defineFn('ISNUMBER', (ev, a, env) => typeof ev.scalar(a[0], env) === 'number', { min: 1, max: 1 })
defineFn('ISTEXT', (ev, a, env) => typeof ev.scalar(a[0], env) === 'string', { min: 1, max: 1 })
defineFn('ISNONTEXT', (ev, a, env) => typeof ev.scalar(a[0], env) !== 'string', { min: 1, max: 1 })
defineFn('ISLOGICAL', (ev, a, env) => typeof ev.scalar(a[0], env) === 'boolean', { min: 1, max: 1 })
defineFn('ISDATETIME', (ev, a, env) => ev.scalar(a[0], env) instanceof Date, { min: 1, max: 1 })
// UDF type checks. Numbers are JS doubles at run time: the numeric subtype comes from the expression's declared or
// static type (UDF parameter hints, column / measure data types, literals, CONVERT); an untyped value counts as Int64
// when it is a whole number and as Double otherwise (approximation: a whole-valued double from an untyped expression
// reads as Int64).
function numericType(ev: Evaluator, n: Node, env: Env, v: unknown): 'int64' | 'double' | 'decimal' | null {
  if (typeof v !== 'number') return null
  const t = ev.exprType(n, env)
  if (t === 'int64' || t === 'double' || t === 'decimal') return t
  return Number.isInteger(v) ? 'int64' : 'double'
}
defineFn(['ISINT64', 'ISINTEGER'], (ev, a, env) => numericType(ev, a[0], env, ev.scalar(a[0], env)) === 'int64', { min: 1, max: 1 })
defineFn('ISDOUBLE', (ev, a, env) => numericType(ev, a[0], env, ev.scalar(a[0], env)) === 'double', { min: 1, max: 1 })
defineFn(['ISDECIMAL', 'ISCURRENCY'], (ev, a, env) => numericType(ev, a[0], env, ev.scalar(a[0], env)) === 'decimal', { min: 1, max: 1 })
defineFn('ISNUMERIC', (ev, a, env) => typeof ev.scalar(a[0], env) === 'number', { min: 1, max: 1 })
defineFn('ISSTRING', (ev, a, env) => typeof ev.scalar(a[0], env) === 'string', { min: 1, max: 1 })
defineFn('ISBOOLEAN', (ev, a, env) => typeof ev.scalar(a[0], env) === 'boolean', { min: 1, max: 1 })
defineFn('__UDFSCALAR', (ev, a, env) => ev.udfExprArg(a, env, false), { min: 2, max: 2 })
defineFn(['ISEVEN', 'ISODD'], (ev, a, env, node) => {
  const v = Math.trunc(N(ev, a[0], env))
  return (Math.abs(v) % 2 === 0) === (node.name.toUpperCase() === 'ISEVEN')
}, { min: 1, max: 1 })
defineFn(
  'DIVIDE',
  (ev, a, env) => {
    const d = ev.scalar(a[1], env)
    if (d === null || toNumber(d) === 0) return missing(a[2]) ? null : ev.scalar(a[2], env)
    const n = ev.scalar(a[0], env)
    if (n === null) return null
    return toNumber(n) / toNumber(d)
  },
  { min: 2, max: 3 }
)

// ------------------------------------------------------------------------------------------------
// information
// ------------------------------------------------------------------------------------------------

defineFn('USERPRINCIPALNAME', (ev) => ev.options.userPrincipalName ?? 'user@localhost', { max: 0 })
defineFn('USERNAME', (ev) => ev.options.userName ?? ev.options.userPrincipalName ?? 'LOCAL\\user', { max: 0 })
defineFn('USEROBJECTID', (ev) => ev.options.userPrincipalName ?? '00000000-0000-0000-0000-000000000000', { max: 0 })
defineFn('USERCULTURE', () => 'en-US', { max: 0 })
defineFn('CUSTOMDATA', (ev) => ev.options.customData ?? null, { max: 0 })

// ------------------------------------------------------------------------------------------------
// math
// ------------------------------------------------------------------------------------------------

function roundHalfAway(x: number, digits: number): number {
  if (!Number.isFinite(x)) return x
  if (digits >= 0) {
    const f = Math.pow(10, digits)
    return (Math.sign(x) * Math.round(Number((Math.abs(x) * f).toPrecision(15)))) / f
  }
  const f = Math.pow(10, -digits)
  return Math.sign(x) * Math.round(Number((Math.abs(x) / f).toPrecision(15))) * f
}

const num1 = (name: string, f: (x: number) => number) =>
  defineFn(
    name,
    (ev, a, env) => {
      const v = ev.scalar(a[0], env)
      if (v === null && name !== 'SIGN') return null
      return f(toNumber(v))
    },
    { min: 1, max: 1 }
  )
num1('ABS', Math.abs)
num1('INT', Math.floor)
num1('SQRT', (x) => {
  if (x < 0) throw new DaxError('ARG', 'An argument of function SQRT has the wrong data type or the result is too large or too small.')
  return Math.sqrt(x)
})
num1('EXP', Math.exp)
num1('LN', Math.log)
num1('LOG10', Math.log10)
num1('SIGN', (x) => Math.sign(x))
num1('SIN', Math.sin)
num1('COS', Math.cos)
num1('TAN', Math.tan)
num1('ASIN', Math.asin)
num1('ACOS', Math.acos)
num1('ATAN', Math.atan)
num1('SINH', Math.sinh)
num1('COSH', Math.cosh)
num1('TANH', Math.tanh)
num1('ASINH', Math.asinh)
num1('ACOSH', Math.acosh)
num1('ATANH', Math.atanh)
num1('COT', (x) => 1 / Math.tan(x))
num1('COTH', (x) => 1 / Math.tanh(x))
num1('ACOT', (x) => Math.PI / 2 - Math.atan(x))
num1('ACOTH', (x) => 0.5 * Math.log((x + 1) / (x - 1)))
num1('DEGREES', (x) => (x * 180) / Math.PI)
num1('RADIANS', (x) => (x * Math.PI) / 180)
num1('EVEN', (x) => {
  const s = x < 0 ? -1 : 1
  const r = Math.ceil(Math.abs(x))
  return s * (r % 2 === 0 ? r : r + 1)
})
num1('ODD', (x) => {
  const s = x < 0 ? -1 : 1
  const r = Math.ceil(Math.abs(x))
  return s * (r % 2 === 1 ? r : r + 1)
})
num1('FACT', (x) => {
  let r = 1
  for (let i = 2; i <= Math.floor(x); i++) r *= i
  return r
})
num1('CURRENCY', (x) => roundHalfAway(x, 4))
defineFn('PI', () => Math.PI, { max: 0 })
defineFn('RAND', () => Math.random(), { max: 0 })
defineFn('RANDBETWEEN', (ev, a, env) => {
  const lo = Math.ceil(N(ev, a[0], env))
  const hi = Math.floor(N(ev, a[1], env))
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}, { min: 2, max: 2 })
defineFn('ATAN2', (ev, a, env) => Math.atan2(N(ev, a[1], env), N(ev, a[0], env)), { min: 2, max: 2 })
defineFn('ROUND', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  return roundHalfAway(toNumber(v), Math.trunc(N(ev, a[1], env)))
}, { min: 2, max: 2 })
defineFn(['ROUNDUP', 'ROUNDDOWN'], (ev, a, env, node) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const x = toNumber(v)
  const d = Math.trunc(N(ev, a[1], env))
  const f = Math.pow(10, d)
  const scaled = Number((Math.abs(x) * f).toPrecision(15))
  const r = node.name.toUpperCase() === 'ROUNDUP' ? Math.ceil(scaled) : Math.floor(scaled)
  return (Math.sign(x) * r) / f
}, { min: 2, max: 2 })
defineFn('TRUNC', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const d = missing(a[1]) ? 0 : Math.trunc(N(ev, a[1], env))
  const f = Math.pow(10, d)
  return Math.trunc(Number((toNumber(v) * f).toPrecision(15))) / f
}, { min: 1, max: 2 })
defineFn('MROUND', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const x = toNumber(v)
  const m = N(ev, a[1], env)
  if (m === 0) return 0
  if (Math.sign(x) * Math.sign(m) < 0) throw new DaxError('ARG', 'MROUND: the number and the multiple must have the same sign.')
  return roundHalfAway(x / m, 0) * m
}, { min: 2, max: 2 })
defineFn(['CEILING', 'ISO.CEILING'], (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const x = toNumber(v)
  const m = missing(a[1]) ? 1 : Math.abs(N(ev, a[1], env))
  if (m === 0) return 0
  return Math.ceil(Number((x / m).toPrecision(15))) * m
}, { min: 1, max: 2 })
defineFn('FLOOR', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const x = toNumber(v)
  const m = missing(a[1]) ? 1 : N(ev, a[1], env)
  if (m === 0) return 0
  return Math.floor(Number((x / m).toPrecision(15))) * m
}, { min: 1, max: 2 })
defineFn('POWER', (ev, a, env) => Math.pow(N(ev, a[0], env), N(ev, a[1], env)), { min: 2, max: 2 })
defineFn('LOG', (ev, a, env) => {
  const x = N(ev, a[0], env)
  const b = missing(a[1]) ? 10 : N(ev, a[1], env)
  return Math.log(x) / Math.log(b)
}, { min: 1, max: 2 })
defineFn('MOD', (ev, a, env) => {
  const x = ev.scalar(a[0], env)
  if (x === null) return null
  const n = toNumber(x)
  const d = N(ev, a[1], env)
  if (d === 0) throw new DaxError('ARG', 'MOD: division by zero.')
  return n - d * Math.floor(n / d)
}, { min: 2, max: 2 })
defineFn('QUOTIENT', (ev, a, env) => {
  const d = N(ev, a[1], env)
  if (d === 0) throw new DaxError('ARG', 'QUOTIENT: division by zero.')
  return Math.trunc(N(ev, a[0], env) / d)
}, { min: 2, max: 2 })
function gcd(x: number, y: number): number {
  x = Math.abs(Math.trunc(x))
  y = Math.abs(Math.trunc(y))
  while (y) [x, y] = [y, x % y]
  return x
}
defineFn('GCD', (ev, a, env) => a.map((x) => N(ev, x, env)).reduce((p, c) => gcd(p, c)), { min: 1 })
defineFn('LCM', (ev, a, env) => a.map((x) => Math.trunc(N(ev, x, env))).reduce((p, c) => (p === 0 || c === 0 ? 0 : Math.abs(p * c) / gcd(p, c))), { min: 1 })
defineFn('COMBIN', (ev, a, env) => {
  const n = Math.trunc(N(ev, a[0], env))
  const k = Math.trunc(N(ev, a[1], env))
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}, { min: 2, max: 2 })
defineFn('PERMUT', (ev, a, env) => {
  const n = Math.trunc(N(ev, a[0], env))
  const k = Math.trunc(N(ev, a[1], env))
  let r = 1
  for (let i = 0; i < k; i++) r *= n - i
  return r
}, { min: 2, max: 2 })
defineFn(['BITAND', 'BITOR', 'BITXOR', 'BITLSHIFT', 'BITRSHIFT'], (ev, a, env, node) => {
  const x = BigInt(Math.trunc(N(ev, a[0], env)))
  const y = BigInt(Math.trunc(N(ev, a[1], env)))
  switch (node.name.toUpperCase()) {
    case 'BITAND':
      return Number(x & y)
    case 'BITOR':
      return Number(x | y)
    case 'BITXOR':
      return Number(x ^ y)
    case 'BITLSHIFT':
      return Number(x << y)
    default:
      return Number(x >> y)
  }
}, { min: 2, max: 2 })
defineFn('CONVERT', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  const t = identName(a[1])
  if (v === null) return null
  switch (t) {
    case 'INTEGER':
    case 'INT64':
      return Math.round(toNumber(v))
    case 'DOUBLE':
    case 'CURRENCY':
    case 'DECIMAL':
      return toNumber(v)
    case 'STRING':
      return toText(v)
    case 'BOOLEAN':
      return toBool(v)
    case 'DATETIME':
      return toDate(v)
  }
  throw new DaxError('ARG', 'CONVERT: the second argument must be INTEGER, DOUBLE, CURRENCY, STRING, BOOLEAN or DATETIME.')
}, { min: 2, max: 2 })

// ------------------------------------------------------------------------------------------------
// text
// ------------------------------------------------------------------------------------------------

defineFn('CONCATENATE', (ev, a, env) => T(ev, a[0], env) + T(ev, a[1], env), { min: 2, max: 2 })
defineFn('CONCAT', (ev, a, env) => a.map((x) => T(ev, x, env)).join(''), { min: 1 })
defineFn(['UPPER', 'LOWER'], (ev, a, env, node) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return ''
  const t = toText(v)
  return node.name.toUpperCase() === 'UPPER' ? t.toUpperCase() : t.toLowerCase()
}, { min: 1, max: 1 })
defineFn('LEN', (ev, a, env) => [...T(ev, a[0], env)].length, { min: 1, max: 1 })
defineFn(['LEFT', 'RIGHT'], (ev, a, env, node) => {
  const t = T(ev, a[0], env)
  const n = missing(a[1]) ? 1 : Math.trunc(N(ev, a[1], env))
  if (n < 0) throw new DaxError('ARG', `The second argument of ${node.name.toUpperCase()} must be zero or a positive number.`)
  return node.name.toUpperCase() === 'LEFT' ? t.slice(0, n) : n === 0 ? '' : t.slice(-n)
}, { min: 1, max: 2 })
defineFn('MID', (ev, a, env) => {
  const t = T(ev, a[0], env)
  const s = Math.trunc(N(ev, a[1], env))
  const n = Math.trunc(N(ev, a[2], env))
  if (s < 1 || n < 0) throw new DaxError('ARG', 'MID: the start position must be at least 1 and the length non-negative.')
  return t.substr(s - 1, n)
}, { min: 3, max: 3 })
defineFn('TRIM', (ev, a, env) => T(ev, a[0], env).trim().replace(/ {2,}/g, ' '), { min: 1, max: 1 })
defineFn('LTRIM', (ev, a, env) => T(ev, a[0], env).replace(/^\s+/, ''), { min: 1, max: 1 })
defineFn('RTRIM', (ev, a, env) => T(ev, a[0], env).replace(/\s+$/, ''), { min: 1, max: 1 })
defineFn('CLEAN', (ev, a, env) => T(ev, a[0], env).replace(/[\x00-\x1f]/g, ''), { min: 1, max: 1 })
defineFn('REPT', (ev, a, env) => {
  const n = Math.trunc(N(ev, a[1], env))
  if (n < 0) throw new DaxError('ARG', 'REPT: the number of times must be non-negative.')
  return T(ev, a[0], env).repeat(n)
}, { min: 2, max: 2 })
defineFn('EXACT', (ev, a, env) => T(ev, a[0], env) === T(ev, a[1], env), { min: 2, max: 2 })
defineFn('SUBSTITUTE', (ev, a, env) => {
  const t = T(ev, a[0], env)
  const old = T(ev, a[1], env)
  const nu = T(ev, a[2], env)
  if (old === '') return t
  if (missing(a[3])) return t.split(old).join(nu)
  const inst = Math.trunc(N(ev, a[3], env))
  let idx = -1
  for (let k = 0; k < inst; k++) {
    idx = t.indexOf(old, idx + 1)
    if (idx < 0) return t
  }
  return t.slice(0, idx) + nu + t.slice(idx + old.length)
}, { min: 3, max: 4 })
defineFn('REPLACE', (ev, a, env) => {
  const t = T(ev, a[0], env)
  const s = Math.trunc(N(ev, a[1], env))
  const n = Math.trunc(N(ev, a[2], env))
  return t.slice(0, s - 1) + T(ev, a[3], env) + t.slice(s - 1 + n)
}, { min: 4, max: 4 })

function wildcardRegex(find: string): RegExp {
  let src = ''
  for (let i = 0; i < find.length; i++) {
    const ch = find[i]
    if (ch === '~' && (find[i + 1] === '*' || find[i + 1] === '?')) {
      src += '\\' + find[++i]
    } else if (ch === '*') src += '[\\s\\S]*'
    else if (ch === '?') src += '[\\s\\S]'
    else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(src, 'i')
}
defineFn(['SEARCH', 'FIND'], (ev, a, env, node) => {
  const fn = node.name.toUpperCase()
  const find = T(ev, a[0], env)
  const within = T(ev, a[1], env)
  const start = missing(a[2]) ? 1 : Math.trunc(N(ev, a[2], env))
  let pos = -1
  if (fn === 'FIND') pos = within.indexOf(find, start - 1)
  else {
    const m = wildcardRegex(find).exec(within.slice(start - 1))
    pos = m ? m.index + start - 1 : -1
  }
  if (pos >= 0) return pos + 1
  if (!missing(a[3])) return ev.scalar(a[3], env)
  throw new DaxError('NOT_FOUND', `The search Text provided to function '${fn}' could not be found in the given text.`)
}, { min: 2, max: 4 })
defineFn('CONTAINSSTRING', (ev, a, env) => wildcardRegex(T(ev, a[1], env)).test(T(ev, a[0], env)), { min: 2, max: 2 })
defineFn('CONTAINSSTRINGEXACT', (ev, a, env) => T(ev, a[0], env).includes(T(ev, a[1], env)), { min: 2, max: 2 })
defineFn('UNICHAR', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const n = Math.trunc(toNumber(v))
  if (n <= 0 || n > 0x10ffff) throw new DaxError('ARG', 'UNICHAR: the code point is out of range.')
  return String.fromCodePoint(n)
}, { min: 1, max: 1 })
defineFn('CHAR', (ev, a, env) => {
  const n = Math.trunc(N(ev, a[0], env))
  if (n < 1 || n > 255) throw new DaxError('ARG', 'CHAR: the code must be between 1 and 255.')
  return String.fromCharCode(n)
}, { min: 1, max: 1 })
defineFn(['UNICODE', 'CODE'], (ev, a, env) => {
  const t = T(ev, a[0], env)
  if (!t) throw new DaxError('ARG', 'The argument is an empty text.')
  return t.codePointAt(0)!
}, { min: 1, max: 1 })
defineFn('COMBINEVALUES', (ev, a, env) => {
  const d = T(ev, a[0], env)
  return a.slice(1).map((x) => T(ev, x, env)).join(d)
}, { min: 3 })
defineFn('VALUE', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  if (typeof v === 'number') return v
  return toNumber(typeof v === 'string' ? v.replace(/\$/g, '') : v)
}, { min: 1, max: 1 })
defineFn('FIXED', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const d = missing(a[1]) ? 2 : Math.trunc(N(ev, a[1], env))
  const noCommas = !missing(a[2]) && toBool(ev.scalar(a[2], env))
  const x = roundHalfAway(toNumber(v), d)
  const fmt = (noCommas ? '0' : '#,0') + (d > 0 ? '.' + '0'.repeat(d) : '')
  return formatValue(x, fmt)
}, { min: 1, max: 3 })
defineFn('FORMAT', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  const fmt = missing(a[1]) ? '' : T(ev, a[1], env)
  if (v === null && fmt === '') return ''
  return formatValue(v, fmt)
}, { min: 1, max: 3 })
defineFn('DATEVALUE', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const d = v instanceof Date ? v : typeof v === 'string' ? parseDateText(v) : fromSerial(toNumber(v))
  if (!d) throw new DaxError('TYPE', `Cannot convert value '${toText(v)}' of type Text to type Date.`)
  return dateOnly(d)
}, { min: 1, max: 1 })
defineFn('TIMEVALUE', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  if (v === null) return null
  const d = v instanceof Date ? v : typeof v === 'string' ? parseDateText(v) : fromSerial(toNumber(v))
  if (!d) throw new DaxError('TYPE', `Cannot convert value '${toText(v)}' of type Text to type Date.`)
  const ms = d.getTime() - dayNumber(d) * MS_PER_DAY
  return fromSerial(ms / MS_PER_DAY)
}, { min: 1, max: 1 })

// PATH functions (parent-child hierarchies)
defineFn('PATHLENGTH', (ev, a, env) => {
  const p = T(ev, a[0], env)
  return p === '' ? 0 : p.split('|').length
}, { min: 1, max: 1 })
defineFn(['PATHITEM', 'PATHITEMREVERSE'], (ev, a, env, node) => {
  const parts = T(ev, a[0], env).split('|').filter((x) => x !== '')
  const pos = Math.trunc(N(ev, a[1], env))
  const arr = node.name.toUpperCase() === 'PATHITEM' ? parts : [...parts].reverse()
  const v = arr[pos - 1]
  if (v === undefined) return null
  const type = missing(a[2]) ? 0 : Math.trunc(N(ev, a[2], env))
  return type === 1 ? Number(v) : v
}, { min: 2, max: 3 })
defineFn('PATHCONTAINS', (ev, a, env) => {
  const parts = T(ev, a[0], env).split('|')
  const item = T(ev, a[1], env).toLowerCase()
  return parts.some((p) => p.toLowerCase() === item)
}, { min: 2, max: 2 })

// ------------------------------------------------------------------------------------------------
// date / time
// ------------------------------------------------------------------------------------------------

const D = (ev: Evaluator, n: Node, env: Env): Date | null => toDate(ev.scalar(n, env))

defineFn(['DATE', 'DATEFROMPARTS'], (ev, a, env) => {
  let y = Math.trunc(N(ev, a[0], env))
  const m = Math.trunc(N(ev, a[1], env))
  const d = Math.trunc(N(ev, a[2], env))
  if (y >= 0 && y < 1900) y += 1900
  return makeDate(y, m, d)
}, { min: 3, max: 3 })
defineFn('TIME', (ev, a, env) => {
  const h = Math.trunc(N(ev, a[0], env))
  const mi = Math.trunc(N(ev, a[1], env))
  const s = Math.trunc(N(ev, a[2], env))
  const total = ((((h * 3600 + mi * 60 + s) % 86400) + 86400) % 86400) * 1000
  return fromSerial(total / MS_PER_DAY)
}, { min: 3, max: 3 })
const part = (name: string, f: (d: Date) => number) =>
  defineFn(
    name,
    (ev, a, env) => {
      const v = ev.scalar(a[0], env)
      const d = v === null ? fromSerial(0) : toDate(v)!
      return f(d)
    },
    { min: 1, max: 1 }
  )
part('YEAR', (d) => d.getUTCFullYear())
part('MONTH', (d) => d.getUTCMonth() + 1)
part('DAY', (d) => d.getUTCDate())
part('HOUR', (d) => d.getUTCHours())
part('MINUTE', (d) => d.getUTCMinutes())
part('SECOND', (d) => d.getUTCSeconds())
part('QUARTER', (d) => Math.floor(d.getUTCMonth() / 3) + 1)
defineFn('WEEKDAY', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  const d = v === null ? fromSerial(0) : toDate(v)!
  const rt = missing(a[1]) ? 1 : Math.trunc(N(ev, a[1], env))
  const w = d.getUTCDay() // 0 = Sunday
  if (rt === 2) return w === 0 ? 7 : w
  if (rt === 3) return w === 0 ? 6 : w - 1
  return w + 1
}, { min: 1, max: 2 })
export function weekNum(d: Date, rt: number): number {
  if (rt === 21) {
    // ISO 8601
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    const day = t.getUTCDay() || 7
    t.setUTCDate(t.getUTCDate() + 4 - day)
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
    return Math.ceil(((t.getTime() - y0.getTime()) / MS_PER_DAY + 1) / 7)
  }
  const start = rt === 2 || rt === 11 ? 1 : rt >= 12 && rt <= 17 ? rt - 10 : 0 // first day of week (0 = Sunday)
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const offset = (jan1.getUTCDay() - start + 7) % 7
  const doy = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - jan1.getTime()) / MS_PER_DAY)
  return Math.floor((doy + offset) / 7) + 1
}
defineFn('WEEKNUM', (ev, a, env) => {
  const v = ev.scalar(a[0], env)
  const d = v === null ? fromSerial(0) : toDate(v)!
  return weekNum(d, missing(a[1]) ? 1 : Math.trunc(N(ev, a[1], env)))
}, { min: 1, max: 2 })
defineFn('TODAY', (ev) => dateOnly(ev.now()), { max: 0 })
defineFn('NOW', (ev) => ev.now(), { max: 0 })
defineFn('UTCNOW', (ev) => {
  const d = (ev.options.now ?? (() => new Date()))()
  return new Date(d.getTime())
}, { max: 0 })
defineFn('UTCTODAY', (ev) => {
  const d = (ev.options.now ?? (() => new Date()))()
  return dateOnly(new Date(d.getTime()))
}, { max: 0 })
function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + n
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const r = makeDate(y, m + 1, Math.min(d.getUTCDate(), last))
  r.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
  return r
}
export { addMonths }
defineFn('EOMONTH', (ev, a, env) => {
  const d = D(ev, a[0], env)
  if (d === null) return null
  const n = Math.trunc(N(ev, a[1], env))
  return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1 + n + 1, 0)
}, { min: 2, max: 2 })
defineFn('EDATE', (ev, a, env) => {
  const d = D(ev, a[0], env)
  if (d === null) return null
  return dateOnly(addMonths(d, Math.trunc(N(ev, a[1], env))))
}, { min: 2, max: 2 })
defineFn('DATEDIFF', (ev, a, env) => {
  const d1 = D(ev, a[0], env)
  const d2 = D(ev, a[1], env)
  const iv = identName(a[2])
  if (d1 === null || d2 === null) return null
  const t1 = d1.getTime()
  const t2 = d2.getTime()
  switch (iv) {
    case 'SECOND':
      return Math.floor(t2 / 1000) - Math.floor(t1 / 1000)
    case 'MINUTE':
      return Math.floor(t2 / 60000) - Math.floor(t1 / 60000)
    case 'HOUR':
      return Math.floor(t2 / 3600000) - Math.floor(t1 / 3600000)
    case 'DAY':
      return dayNumber(d2) - dayNumber(d1)
    case 'WEEK': {
      // weeks start on Sunday: count Sunday boundaries crossed
      const w = (d: Date) => Math.floor((dayNumber(d) + 4) / 7) // 1970-01-01 is Thursday; +4 aligns weeks to Sunday
      return w(d2) - w(d1)
    }
    case 'MONTH':
      return (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth()
    case 'QUARTER':
      return (d2.getUTCFullYear() - d1.getUTCFullYear()) * 4 + Math.floor(d2.getUTCMonth() / 3) - Math.floor(d1.getUTCMonth() / 3)
    case 'YEAR':
      return d2.getUTCFullYear() - d1.getUTCFullYear()
  }
  throw new DaxError('ARG', 'The third argument of DATEDIFF must be SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER or YEAR.')
}, { min: 3, max: 3 })
defineFn('YEARFRAC', (ev, a, env) => {
  let d1 = D(ev, a[0], env)
  let d2 = D(ev, a[1], env)
  if (!d1 || !d2) return null
  if (d1 > d2) [d1, d2] = [d2, d1]
  const basis = missing(a[2]) ? 0 : Math.trunc(N(ev, a[2], env))
  const y1 = d1.getUTCFullYear()
  const m1 = d1.getUTCMonth() + 1
  let dd1 = d1.getUTCDate()
  const y2 = d2.getUTCFullYear()
  const m2 = d2.getUTCMonth() + 1
  let dd2 = d2.getUTCDate()
  const days = dayNumber(d2) - dayNumber(d1)
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  switch (basis) {
    case 0: {
      const lastFeb = (y: number, m: number, d: number) => m === 2 && d === (isLeap(y) ? 29 : 28)
      if (lastFeb(y1, m1, dd1) && lastFeb(y2, m2, dd2)) dd2 = 30
      if (dd2 === 31 && dd1 >= 30) dd2 = 30
      if (dd1 === 31 || lastFeb(y1, m1, dd1)) dd1 = 30
      return ((y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1)) / 360
    }
    case 1: {
      let avg: number
      if (y1 === y2) avg = isLeap(y1) ? 366 : 365
      else if (y2 - y1 === 1 && (m2 < m1 || (m2 === m1 && dd2 <= dd1))) {
        const feb29 = (y: number) => isLeap(y)
        avg = (feb29(y1) && m1 <= 2) || (feb29(y2) && (m2 > 2 || (m2 === 2 && dd2 === 29))) ? 366 : 365
      } else {
        let total = 0
        for (let y = y1; y <= y2; y++) total += isLeap(y) ? 366 : 365
        avg = total / (y2 - y1 + 1)
      }
      return days / avg
    }
    case 2:
      return days / 360
    case 3:
      return days / 365
    case 4:
      if (dd1 === 31) dd1 = 30
      if (dd2 === 31) dd2 = 30
      return ((y2 - y1) * 360 + (m2 - m1) * 30 + (dd2 - dd1)) / 360
  }
  throw new DaxError('ARG', 'YEARFRAC: basis must be 0 to 4.')
}, { min: 2, max: 3 })
defineFn('NETWORKDAYS', (ev, a, env) => {
  const d1 = D(ev, a[0], env)
  const d2 = D(ev, a[1], env)
  if (!d1 || !d2) return null
  const wk = missing(a[2]) ? 1 : Math.trunc(N(ev, a[2], env))
  const weekend: Record<number, number[]> = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6], 11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6] }
  const off = new Set(weekend[wk] ?? [6, 0])
  const holidays = new Set<number>()
  if (!missing(a[3])) {
    const h = ev.value(a[3], env)
    if (isTable(h)) for (const v of h.column(0)) if (v !== null) holidays.add(dayNumber(toDate(v)!))
  }
  let a0 = dayNumber(d1)
  let b0 = dayNumber(d2)
  const sign = a0 <= b0 ? 1 : -1
  if (sign < 0) [a0, b0] = [b0, a0]
  let n = 0
  for (let d = a0; d <= b0; d++) {
    const wd = fromDayNumber(d).getUTCDay()
    if (!off.has(wd) && !holidays.has(d)) n++
  }
  return n * sign
}, { min: 2, max: 4 })

export { generalNumber, serialOf, roundHalfAway, wildcardRegex }
