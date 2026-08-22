//
// typelib - Struct/union code generator for C
// by Sean Connelly (@velipso), https://sean.fun
// Project Home: https://github.com/velipso/typelib
// SPDX-License-Identifier: 0BSD
//
// @ts-expect-error -- intentionally no @types/node
import fs from 'node:fs/promises';
// @ts-expect-error -- intentionally no @types/node
import path from 'node:path';
// @ts-expect-error -- intentionally no @types/node
import { inspect } from 'node:util';

declare const process: {
  cwd(): string;
  argv: string[];
  exit(code?: number): never;
};

const LIB = 'typelib';

interface BasicType {
  kind: 'basic';
  signed: boolean;
  bits: number;
}

interface Location {
  file: string;
  line: number;
  chr: number;
}

interface ContextError {
  err: string;
  loc: Location;
}

interface Context {
  error(error: ContextError): null;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// util
//

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
const isAlpha = (ch: string) => (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
const isDigit = (ch: string) => ch >= '0' && ch <= '9';
const isHex = (ch: string) =>
  (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
const isSpecial1 = (ch: string) => '<,>~!@%^&*()-+={[}]|;/.?:'.indexOf(ch) >= 0;
const isSpecial2 = (ch: string) => (['<<', '>>', '!=', '==', '<=', '>=', '&&', '||']).includes(ch);
const isKeyword = (ident: string) => (['include', 'enum', 'struct', 'union']).includes(ident);
const typeToStr = (type: BasicType) => `${type.signed ? 'i' : 'u'}${type.bits}`;
const isType = (ident: string): BasicType | null | { error: string } => {
  if (ident === 'int') {
    return { kind: 'basic', signed: true, bits: 32 };
  }
  const m = ident.match(/^(u|i)([0-9]+)$/);
  if (!m) return null;
  if (m[2].startsWith('0')) {
    return { error: `Invalid type: ${ident}` };
  }
  const bits = parseFloat(m[2]);
  if (isNaN(bits) || bits < 1 || bits > 32) {
    return { error: `Invalid type: ${ident}` };
  }
  return { kind: 'basic', signed: m[1] === 'i', bits };
};

function nextPowerOf2(n: number) {
  n = (n - 1) >>> 0;
  n |= n >>> 1;
  n |= n >>> 2;
  n |= n >>> 4;
  n |= n >>> 8;
  n |= n >>> 16;
  return (n + 1) >>> 0;
}

function replaceExt(file: string, ext: string) {
  file = file.replace(/\.+$/, '');
  const p = file.lastIndexOf('.');
  if (p > 0) { // don't count '.' at start of hidden files
    file = file.substr(0, p);
  }
  return `${file}.${ext}`;
}

const validExt = (file: string) => /\.(h|c|hpp|cpp|js|ts)$/.test(file);

function assertNever(val: never): never {
  console.error('Unexpected never value:', val);
  throw new Error('Unexpected never value');
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// lexer
//

interface TokenGeneric<TKind extends string> {
  kind: TKind;
  loc: Location;
}

interface TokenEOF extends TokenGeneric<'eof'> {}

interface TokenIdent extends TokenGeneric<'ident'> {
  str: string;
}

interface TokenKeyword extends TokenGeneric<'keyword'> {
  str: string;
}

interface TokenNumber extends TokenGeneric<'number'> {
  value: number;
}

interface TokenSpecial extends TokenGeneric<'special'> {
  str: string;
}

interface TokenString extends TokenGeneric<'string'> {
  str: string;
}

interface TokenType extends TokenGeneric<'type'> {
  str: string;
  type: BasicType;
}

type Token =
  | TokenEOF
  | TokenIdent
  | TokenKeyword
  | TokenNumber
  | TokenSpecial
  | TokenString
  | TokenType;

type LexState =
  | 'start'
  | 'line-comment'
  | 'block-comment'
  | 'ident'
  | 'number'
  | 'number-base'
  | 'string'
  | 'string-esc';

function lex(file: string, fileData: string, ctx: Context) {
  const tokens: Token[] = [];

  let state: LexState = 'start';
  let line = 1;
  let chr = 1;
  let str = '';
  let numberBase = 10;
  let hasError = false;

  const loc = (): Location => ({ file, line, chr });
  const pushError = (err: string) => {
    hasError = true;
    ctx.error({ err, loc: { file, line, chr } });
  };

  for (let i = 0; i <= fileData.length; i++) {
    const ch = i < fileData.length ? fileData.charAt(i) : '\n';
    const nch = i < fileData.length - 1 ? fileData.charAt(i + 1) : '\n';
    switch (state) {
      case 'start': {
        if (ch === '/' && nch === '/') {
          state = 'line-comment';
        } else if (ch === '/' && nch === '*') {
          state = 'block-comment';
        } else if (isAlpha(ch) || ch === '_') {
          str = ch;
          state = 'ident';
        } else if (ch === '0' && (nch === 'x' || nch === 'b' || nch === 'c')) {
          str = '';
          numberBase = nch === 'x' ? 16 : nch === 'b' ? 2 : 8;
          state = 'number-base';
        } else if (isDigit(ch)) {
          str = ch;
          numberBase = 10;
          state = 'number';
        } else if (ch === '"') {
          str = '';
          state = 'string';
        } else if (isSpecial2(ch + nch)) {
          tokens.push({ kind: 'special', str: ch + nch, loc: loc() });
          i++;
          chr++;
        } else if (isSpecial1(ch)) {
          tokens.push({ kind: 'special', str: ch, loc: loc() });
        } else if (!isSpace(ch)) {
          pushError(`Unexpected character: "${ch}"`);
        }
        break;
      }
      case 'line-comment': {
        if (ch === '\n') {
          state = 'start';
        }
        break;
      }
      case 'block-comment': {
        if (ch === '*' && nch === '/') {
          i++;
          chr++;
          state = 'start';
        }
        break;
      }
      case 'ident': {
        if (isAlpha(ch) || isDigit(ch) || ch === '_') {
          str += ch;
        } else {
          const type = isType(str);
          if (type) {
            if ('error' in type) {
              pushError(type.error);
            } else {
              tokens.push({ kind: 'type', str, type, loc: loc() });
            }
          } else if (isKeyword(str)) {
            tokens.push({ kind: 'keyword', str, loc: loc() });
          } else {
            tokens.push({ kind: 'ident', str, loc: loc() });
          }
          str = '';
          state = 'start';
          i--;
          continue;
        }
        break;
      }
      case 'number': {
        if (
          (numberBase === 10 && isDigit(ch)) ||
          (numberBase === 16 && isHex(ch)) ||
          (numberBase === 2 && ch >= '0' && ch <= '1') ||
          (numberBase === 8 && ch >= '0' && ch <= '7')
        ) {
          str += ch;
        } else if (ch !== '_') {
          if (str.length <= 0) {
            pushError('Invalid number');
          } else {
            let value = 0;
            for (let i = 0; i < str.length; i++) {
              const ch = str.charAt(i);
              value = value * numberBase + (
                isDigit(ch) ? ch.charCodeAt(0) - '0'.charCodeAt(0)
                : ch >= 'a' && ch <= 'f'
                ? ch.charCodeAt(0) - 'a'.charCodeAt(0) + 10
                : ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10
              );
              if (value > 0xffffffff) {
                pushError('Number too large');
                value = 0xffffffff;
                break;
              }
            }
            tokens.push({ kind: 'number', value, loc: loc() });
          }
          str = '';
          state = 'start';
          i--;
          continue;
        }
        break;
      }
      case 'number-base': {
        state = 'number'; // skip 'x', 'b', or 'c'
        break;
      }
      case 'string': {
        if (ch === '\\') {
          state = 'string-esc';
        } else if (ch === '"') {
          tokens.push({ kind: 'string', str, loc: loc() });
          str = '';
          state = 'start';
        } else {
          str += ch;
        }
        break;
      }
      case 'string-esc': {
        str += ch;
        state = 'string';
        break;
      }
    }

    // advance line/chr
    if (i < fileData.length) {
      if (ch === '\n') {
        line++;
        chr = 1;
      } else {
        chr++;
      }
    }
  }

  switch (state) {
    case 'start':
    case 'line-comment':
      break;
    case 'block-comment':
      pushError('Missing close of block comment');
      break;
    case 'ident':
    case 'number':
    case 'number-base':
    case 'string':
    case 'string-esc':
      pushError('Unexpected end of stream');
      break;
  }

  return hasError ? null : tokens;
}

class TokenReader {
  i: number;
  tokens: Token[];
  file: string;

  constructor(tokens: Token[], file: string) {
    this.i = 0;
    this.tokens = tokens;
    this.file = file;
  }

  isEmpty() {
    return this.i >= this.tokens.length;
  }

  isType() {
    return this.peek().kind === 'type';
  }

  isIdent() {
    return this.peek().kind === 'ident';
  }

  isSpecial(str: string) {
    const tok = this.peek();
    return tok.kind === 'special' && tok.str === str;
  }

  takeKeyword(keyword: string): TokenKeyword | null {
    const tok = this.peek();
    if (tok.kind === 'keyword' && tok.str === keyword) {
      this.i++;
      return tok;
    }
    return null;
  }

  takeIdent(): TokenIdent | null {
    const tok = this.peek();
    if (tok.kind === 'ident') {
      this.i++;
      return tok;
    }
    return null;
  }

  takeType(): TokenType | null {
    const tok = this.peek();
    if (tok.kind === 'type') {
      this.i++;
      return tok;
    }
    return null;
  }

  takeSpecial(str: string): TokenSpecial | null {
    const tok = this.peek();
    if (tok.kind === 'special' && tok.str === str) {
      this.i++;
      return tok;
    }
    return null;
  }

  takeSpecialOrError(str: string, ctx: Context): true | null {
    if (!this.takeSpecial(str)) {
      return ctx.error(this.error(`Expecting "${str}"`));
    }
    return true;
  }

  takeError(err: string): ContextError {
    const tok = this.take();
    return { err, loc: tok.loc };
  }

  error(err: string): ContextError {
    const tok = this.peek();
    return { err, loc: tok.loc };
  }

  eof(): Token {
    if (this.tokens.length <= 0) {
      return { kind: 'eof', loc: { file: this.file, line: 1, chr: 1 } };
    }
    return { kind: 'eof', loc: this.tokens[this.tokens.length - 1].loc };
  }

  take(): Token {
    if (this.i >= this.tokens.length) {
      return this.eof();
    }
    return this.tokens[this.i++];
  }

  peek(): Token {
    if (this.i >= this.tokens.length) {
      return this.eof();
    }
    return this.tokens[this.i];
  }

  prevLoc(): Location {
    if (this.tokens.length <= 0) {
      return { file: this.file, line: 1, chr: 1 };
    }
    return this.tokens[Math.max(0, this.i - 1)].loc;
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// parser
//

interface SyntaxGeneric<TKind extends string> {
  kind: TKind;
  loc: Location;
}

interface SyntaxExprBinary extends SyntaxGeneric<'binary'> {
  op: TokenSpecial;
  left: SyntaxExpr;
  right: SyntaxExpr;
}

interface SyntaxExprCall extends SyntaxGeneric<'call'> {
  symbol: TokenIdent[];
  args: SyntaxExpr[];
}

type SyntaxExprNumber = TokenNumber;

interface SyntaxExprSymbol extends SyntaxGeneric<'symbol'> {
  symbol: TokenIdent[];
}

interface SyntaxExprTernary extends SyntaxGeneric<'ternary'> {
  condition: SyntaxExpr;
  whenTrue: SyntaxExpr;
  whenFalse: SyntaxExpr;
}

interface SyntaxExprUnary extends SyntaxGeneric<'unary'> {
  op: TokenSpecial;
  value: SyntaxExpr;
}

type SyntaxExpr =
  | SyntaxExprBinary
  | SyntaxExprCall
  | SyntaxExprNumber
  | SyntaxExprSymbol
  | SyntaxExprTernary
  | SyntaxExprUnary;

interface SyntaxNoteAlign extends SyntaxGeneric<'align'> {
  expr: SyntaxExpr;
}

interface SyntaxNoteBreak extends SyntaxGeneric<'break'> {}

interface SyntaxNoteCount extends SyntaxGeneric<'count'> {
  field: TokenIdent;
}

interface SyntaxNoteStart extends SyntaxGeneric<'start'> {
  expr: SyntaxExpr;
}

interface SyntaxNoteTag extends SyntaxGeneric<'tag'> {
  expr: SyntaxExpr;
}

type SyntaxNote =
  | SyntaxNoteAlign
  | SyntaxNoteBreak
  | SyntaxNoteCount
  | SyntaxNoteStart
  | SyntaxNoteTag;

type SyntaxType = TokenType | TokenIdent[];

interface SyntaxField extends SyntaxGeneric<'field'> {
  type: SyntaxType;
  bitFields: SyntaxField[] | null;
  name: TokenIdent | null;
  array: SyntaxExpr | null;
  notes: SyntaxNote[];
}

interface SyntaxEnum extends SyntaxGeneric<'enum'> {
  name: TokenIdent;
  options: { option: TokenIdent; value: SyntaxExpr | null }[];
}

interface SyntaxStruct extends SyntaxGeneric<'struct'> {
  name: TokenIdent;
  notes: SyntaxNote[];
  fields: SyntaxField[];
  children: SyntaxStatement[];
}

interface SyntaxVariantEmpty extends SyntaxGeneric<'variant.empty'> {
  name: TokenIdent;
  notes: SyntaxNote[];
}

interface SyntaxVariantStruct extends SyntaxGeneric<'variant.struct'> {
  name: TokenIdent;
  notes: SyntaxNote[];
  fields: SyntaxField[];
}

interface SyntaxVariantSubtype extends SyntaxGeneric<'variant.subtype'> {
  name: TokenIdent;
  notes: SyntaxNote[];
  subtype: SyntaxType;
}

type SyntaxVariant =
  | SyntaxVariantEmpty
  | SyntaxVariantStruct
  | SyntaxVariantSubtype;

interface SyntaxUnion extends SyntaxGeneric<'union'> {
  name: TokenIdent;
  notes: SyntaxNote[];
  variants: SyntaxVariant[];
  children: SyntaxStatement[];
}

interface SyntaxConstValue extends SyntaxGeneric<'const'> {
  type: SyntaxType;
  name: TokenIdent;
  params: null;
  expr: SyntaxExpr;
}

interface SyntaxConstFunction extends SyntaxGeneric<'const'> {
  type: SyntaxType;
  name: TokenIdent;
  params: { type: SyntaxType; name: TokenIdent }[];
  expr: SyntaxExpr;
}

type SyntaxConst = SyntaxConstValue | SyntaxConstFunction;
type SyntaxStatement = SyntaxEnum | SyntaxStruct | SyntaxUnion | SyntaxConst;

const binaryPrecedence = new Map<string, number>([
  ['||', 1],
  ['&&', 2],
  ['==', 3],
  ['!=', 3],
  ['<', 3],
  ['<=', 3],
  ['>', 3],
  ['>=', 3],
  ['|', 4],
  ['^', 5],
  ['&', 6],
  ['<<', 7],
  ['>>', 7],
  ['+', 8],
  ['-', 8],
  ['*', 9],
  ['/', 9],
  ['%', 9],
]);

function syntaxTypeLoc(type: SyntaxType) {
  return Array.isArray(type) ? type[0].loc : type.loc;
}

function parseExpr(
  toks: TokenReader,
  minPrecedence: number,
  ctx: Context
): SyntaxExpr | null {
  const parsePrimary = (): SyntaxExpr | null => {
    const tok = toks.peek();
    if (tok.kind === 'number') {
      toks.take();
      return tok;
    } else if (tok.kind === 'ident') {
      toks.take();
      const symbol = [tok];

      while (toks.takeSpecial('.')) {
        const ident = toks.takeIdent();
        if (!ident) return null;
        symbol.push(ident);
      }

      if (!toks.takeSpecial('(')) {
        return { kind: 'symbol', symbol, loc: symbol[0].loc };
      }

      const args: SyntaxExpr[] = [];
      while (!toks.isSpecial(')')) {
        const arg = parseExpr(toks, 0, ctx);
        if (!arg) return null;
        args.push(arg);
        if (!toks.takeSpecial(',')) {
          break;
        }
      }
      if (!toks.takeSpecialOrError(')', ctx)) return null;

      return { kind: 'call', symbol, args, loc: symbol[0].loc };
    } else if (
      tok.kind === 'special' &&
      (tok.str === '+' || tok.str === '-' || tok.str === '~' || tok.str === '!')
    ) {
      toks.take();
      const op = tok;

      const value = parseExpr(toks, 999, ctx);
      if (!value) {
        return ctx.error({ err: 'Expecting expression after unary operator', loc: op.loc });
      }

      return { kind: 'unary', op, value, loc: op.loc };
    } else if (toks.takeSpecial('(')) {
      const expr = parseExpr(toks, 0, ctx);
      if (!expr) return null;
      if (!toks.takeSpecialOrError(')', ctx)) return null;
      return expr;
    }
    return ctx.error(toks.error('Expecting expression'));
  };

  let left = parsePrimary();
  if (!left) return null;

  while (!toks.isEmpty()) {
    const op = toks.peek();

    if (op.kind !== 'special') {
      break;
    }
    const precedence = binaryPrecedence.get(op.str);
    if (!precedence || precedence < minPrecedence) {
      break;
    }

    toks.take();

    const right = parseExpr(toks, precedence + 1, ctx);
    if (!right) {
      return ctx.error(toks.error(`Expecting expression after "${op.str}"`));
    }

    left = { kind: 'binary', op, left, right, loc: op.loc };
  }

  // lower precedence than all binary operators and right-associative.
  if (minPrecedence === 0) {
    const ternary = toks.takeSpecial('?');
    if (ternary) {
      const whenTrue = parseExpr(toks, 0, ctx);
      if (!whenTrue) return null;

      if (!toks.takeSpecialOrError(':', ctx)) return null;

      const whenFalse = parseExpr(toks, 0, ctx);
      if (!whenFalse) return null;

      left = { kind: 'ternary', condition: left, whenTrue, whenFalse, loc: ternary.loc };
    }
  }

  return left;
}

function parseNotes(toks: TokenReader, ctx: Context): SyntaxNote[] | null {
  const notes: SyntaxNote[] = [];
  while (toks.takeSpecial('@')) {
    const name = toks.takeIdent();
    if (!name) {
      return ctx.error(toks.error('Expecting annotation name'));
    }
    const { str: kind, loc } = name;
    switch (kind) {
      case 'align':
      case 'start':
      case 'tag': {
        if (!toks.takeSpecialOrError('(', ctx)) return null;
        const expr = parseExpr(toks, 0, ctx);
        if (!expr) return null;
        if (!toks.takeSpecialOrError(')', ctx)) return null;
        notes.push({ kind, expr, loc });
        break;
      }
      case 'count': {
        if (!toks.takeSpecialOrError('(', ctx)) return null;
        const field = toks.takeIdent();
        if (!field) {
          return ctx.error(toks.error('Expecting field for @count'));
        }
        if (!toks.takeSpecialOrError(')', ctx)) return null;
        notes.push({ kind, field, loc });
        break;
      }
      case 'break': {
        notes.push({ kind, loc });
        break;
      }
      default:
        return ctx.error({ err: `Unknown annotation: ${kind}`, loc: name.loc });
    }
  }
  return notes;
}

function parseType(toks: TokenReader, ctx: Context): SyntaxType | null {
  let type;
  if (toks.isType()) {
    type = toks.takeType();
  } else {
    const ident = toks.takeIdent();
    if (!ident) {
      return ctx.error(toks.error('Expecting type'));
    }
    type = [ident];
    while (toks.takeSpecial('.')) {
      const ident = toks.takeIdent();
      if (!ident) {
        return ctx.error(toks.error('Expecting identifier'));
      }
      type.push(ident);
    }
  }
  return type;
}

function parseSemiColon(toks: TokenReader, emitError: boolean, ctx: Context): true | null {
  if (toks.takeSpecial(';')) return true;
  if (emitError) {
    ctx.error(toks.error('Expecting semi-colon at end of statement'));
  }
  // consume next semi-colon or consume until next close brace
  while (!toks.isEmpty() && !toks.isSpecial(';') && !toks.isSpecial('}')) {
    toks.take();
  }
  toks.takeSpecial(';');
  return null;
}

function parseField(
  toks: TokenReader,
  insideFailure: boolean,
  isBitField: boolean,
  ctx: Context
): SyntaxField | SyntaxConst | null {
  let statement: SyntaxField | null = null;
  const type = parseType(toks, ctx);
  if (type) {
    let bitFields: SyntaxField[] | null = null;
    if (!isBitField && toks.isSpecial('{')) {
      bitFields = parseBitFields(toks, insideFailure, ctx);
      if (!bitFields) return null;
    }
    const name = toks.takeIdent();
    if (!Array.isArray(type) && !isBitField && !bitFields && name && (
      toks.isSpecial('(') ||
      toks.isSpecial('=')
    )) {
      return parseConstBody(toks, type, name, ctx);
    }
    let array: SyntaxExpr | null = null;
    if (toks.takeSpecial('[')) {
      array = parseExpr(toks, 0, ctx);
      if (!array) return null;
      if (!toks.takeSpecialOrError(']', ctx)) return null;
    }
    const notes = parseNotes(toks, ctx);
    if (!notes) return null;
    statement = {
      kind: 'field',
      type,
      bitFields,
      name,
      array,
      notes,
      loc: name ? name.loc : syntaxTypeLoc(type)
    };
  } else if (!insideFailure) {
    ctx.error(toks.takeError('Invalid statement'));
  }
  return statement;
}

function parseBitFields(
  toks: TokenReader,
  insideFailure: boolean,
  ctx: Context
): SyntaxField[] | null {
  if (!toks.takeSpecialOrError('{', ctx)) return null;
  const fields: SyntaxField[] = [];
  let hasError = false;
  while (!toks.isEmpty() && !toks.isSpecial('}')) {
    const statement = parseField(toks, insideFailure, true, ctx);
    if (!parseSemiColon(toks, !!statement, ctx)) hasError = true;
    if (statement) {
      if (statement.kind === 'const') {
        return ctx.error({
          err: `Invalid const statement in bit field`,
          loc: statement.loc
        });
      }
      fields.push(statement);
    } else {
      hasError = true;
    }
    insideFailure = !statement;
  }
  if (!toks.takeSpecialOrError('}', ctx)) return null;
  return hasError ? null : fields;
}

function parseEnum(toks: TokenReader, loc: Location, ctx: Context): SyntaxEnum | null {
  const name = toks.takeIdent();
  if (!name) {
    return ctx.error(toks.error('Expecting name'));
  }
  if (!toks.takeSpecialOrError('{', ctx)) return null;

  const options: SyntaxEnum['options'] = [];
  while (!toks.isSpecial('}')) {
    const option = toks.takeIdent();
    if (!option) {
      return ctx.error(toks.error('Expecting enum option'));
    }
    let value: SyntaxExpr | null = null;
    if (toks.takeSpecial('=')) {
      value = parseExpr(toks, 0, ctx);
      if (!value) return null;
    }
    options.push({ option, value });
    if (!toks.takeSpecial(',')) {
      break;
    }
  }

  if (!toks.takeSpecialOrError('}', ctx)) return null;

  return { kind: 'enum', name, options, loc };
}

function parseStructStatement(
  toks: TokenReader,
  insideFailure: boolean,
  ctx: Context
): SyntaxStatement | SyntaxField | null {
  let statement: SyntaxStatement | SyntaxField | null = null;
  if (toks.takeKeyword('enum')) {
    statement = parseEnum(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('struct')) {
    statement = parseStruct(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('union')) {
    statement = parseUnion(toks, toks.prevLoc(), ctx);
  } else if (toks.isType() || toks.isIdent()) {
    statement = parseField(toks, insideFailure, false, ctx);
  } else if (!insideFailure) {
    ctx.error(toks.takeError('Invalid statement'));
  }

  if (!parseSemiColon(toks, !!statement, ctx)) return null;

  return statement;
}

function parseStructBody(
  toks: TokenReader,
  kind: 'struct',
  name: TokenIdent,
  notes: SyntaxNote[],
  loc: Location,
  ctx: Context
): SyntaxStruct | null;

function parseStructBody(
  toks: TokenReader,
  kind: 'variant.struct',
  name: TokenIdent,
  notes: SyntaxNote[],
  loc: Location,
  ctx: Context
): SyntaxVariantStruct | null;

function parseStructBody(
  toks: TokenReader,
  kind: 'struct' | 'variant.struct',
  name: TokenIdent,
  notes: SyntaxNote[],
  loc: Location,
  ctx: Context
): SyntaxStruct | SyntaxVariantStruct | null {
  if (!toks.takeSpecialOrError('{', ctx)) return null;

  const fields: SyntaxField[] = [];
  const children: SyntaxStatement[] = [];

  let insideFailure = false;
  let hasError = false;
  while (!toks.isEmpty() && !toks.isSpecial('}')) {
    const statement = parseStructStatement(toks, insideFailure, ctx);
    if (statement) {
      if (
        statement.kind === 'const' ||
        statement.kind === 'enum' ||
        statement.kind === 'struct' ||
        statement.kind === 'union'
      ) {
        if (kind === 'struct') {
          children.push(statement);
        } else {
          return ctx.error({
            err: `Cannot have ${statement.kind} inside of union variant`,
            loc: statement.loc
          });
        }
      } else if (statement.kind === 'field') {
        fields.push(statement);
      } else {
        assertNever(statement);
      }
    } else {
      hasError = true;
    }
    insideFailure = !statement;
  }

  if (!toks.takeSpecialOrError('}', ctx)) return null;

  return hasError ? null : kind === 'struct'
    ? { kind, name, notes, fields, children, loc }
    : { kind, name, notes, fields, loc };
}

function parseStruct(toks: TokenReader, loc: Location, ctx: Context): SyntaxStruct | null {
  const name = toks.takeIdent();
  if (!name) {
    return ctx.error(toks.error('Expecting struct name'));
  }
  const notes = parseNotes(toks, ctx);
  if (!notes) return null;
  return parseStructBody(toks, 'struct', name, notes, loc, ctx);
}

function parseVariant(toks: TokenReader, ctx: Context): SyntaxVariant | SyntaxConst | null {
  // goofy parsing because we need to look ahead to see if we're dealing with a const
  const nameInType = parseType(toks, ctx);
  if (!nameInType) {
    return ctx.error(toks.error('Expecting name for union variant'));
  }
  if (
    !Array.isArray(nameInType) || // name is a basic type -> const
    nameInType.length > 1 ||      // name is `Foo.Bar` (a type) -> const
    toks.isIdent()                // `Foo Bar`, so name (Foo) is a type -> const
  ) {
    return parseConstBody(toks, nameInType, null, ctx);
  }
  const name = nameInType[0];

  if (name.str.charAt(0).toLowerCase() === name.str.charAt(0)) {
    return ctx.error({
      err: `Union variant "${name.str}" must start with uppercase character`,
      loc: name.loc
    });
  }

  let statement: SyntaxVariant | null = null;
  if (toks.takeSpecial('(')) {
    const subtype = parseType(toks, ctx);
    if (!subtype) {
      return ctx.error(toks.error('Expecting subtype inside union variant'));
    }
    if (!toks.takeSpecialOrError(')', ctx)) return null;
    const notes = parseNotes(toks, ctx);
    if (!notes) return null;
    statement = {
      kind: 'variant.subtype',
      name,
      notes,
      subtype,
      loc: name.loc
    };
  } else {
    const notes = parseNotes(toks, ctx);
    if (!notes) return null;
    if (toks.isSpecial('{')) {
      statement = parseStructBody(toks, 'variant.struct', name, notes, name.loc, ctx);
    } else {
      statement = { kind: 'variant.empty', name, notes, loc: name.loc };
    }
  }

  return statement;
}

function parseUnionStatement(
  toks: TokenReader,
  insideFailure: boolean,
  ctx: Context
): SyntaxStatement | SyntaxVariant | null {
  let statement: SyntaxStatement | SyntaxVariant | null = null;
  if (toks.takeKeyword('enum')) {
    statement = parseEnum(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('struct')) {
    statement = parseStruct(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('union')) {
    statement = parseUnion(toks, toks.prevLoc(), ctx);
  } else if (toks.isType()) {
    statement = parseConst(toks, ctx);
  } else if (toks.isIdent()) {
    statement = parseVariant(toks, ctx);
  } else if (!insideFailure) {
    ctx.error(toks.takeError('Invalid statement'));
  }

  if (!parseSemiColon(toks, !!statement, ctx)) return null;

  return statement;
}

function parseUnion(toks: TokenReader, loc: Location, ctx: Context): SyntaxUnion | null {
  const name = toks.takeIdent();
  if (!name) {
    return ctx.error(toks.error('Expecting union name'));
  }

  const notes = parseNotes(toks, ctx);
  if (!notes) return null;

  if (!toks.takeSpecialOrError('{', ctx)) return null;

  const variants: SyntaxVariant[] = [];
  const children: SyntaxUnion['children'] = [];

  let insideFailure = false;
  let hasError = false;
  while (!toks.isEmpty() && !toks.isSpecial('}')) {
    const statement = parseUnionStatement(toks, insideFailure, ctx);
    if (statement) {
      if (
        statement.kind === 'const' ||
        statement.kind === 'enum' ||
        statement.kind === 'struct' ||
        statement.kind === 'union'
      ) {
        children.push(statement);
      } else if (
        statement.kind === 'variant.empty' ||
        statement.kind === 'variant.subtype' ||
        statement.kind === 'variant.struct'
      ) {
        variants.push(statement);
      } else {
        assertNever(statement);
      }
    } else {
      hasError = true;
    }
    insideFailure = !statement;
  }

  if (!toks.takeSpecialOrError('}', ctx)) return null;

  return hasError ? null : { kind: 'union', name, notes, variants, children, loc };
}

function parseConstBody(
  toks: TokenReader,
  type: SyntaxType,
  name: TokenIdent | null,
  ctx: Context
): SyntaxConst | null {
  // name could be null if it hasn't been consumed yet
  if (!name) {
    name = toks.takeIdent();
    if (!name) {
      return ctx.error(toks.error('Expecting const name'));
    }
  }

  let params: SyntaxConst['params'] = null;
  if (toks.takeSpecial('(')) {
    params = [];
    while (!toks.isSpecial(')')) {
      const type = parseType(toks, ctx);
      if (!type) return null;
      const name = toks.takeIdent();
      if (!name) {
        return ctx.error(toks.error('Expecting parameter name'));
      }
      params.push({ type, name });
      if (!toks.takeSpecial(',')) {
        break;
      }
    }
    if (!toks.takeSpecial(')')) {
      return ctx.error(toks.error('Expecting ")"'));
    }
  }

  if (!toks.takeSpecialOrError('=', ctx)) return null;

  const expr = parseExpr(toks, 0, ctx);
  if (!expr) return null;

  return { kind: 'const', type, name, params, expr, loc: name.loc };
}

function parseConst(toks: TokenReader, ctx: Context): SyntaxConst | null {
  const type = parseType(toks, ctx);
  if (!type) {
    return ctx.error(toks.error('Expecting type of constant value'));
  }
  return parseConstBody(toks, type, null, ctx);
}

function parseStatement(
  toks: TokenReader,
  insideFailure: boolean,
  ctx: Context
): SyntaxStatement | null {
  let statement: SyntaxStatement | null = null;
  if (toks.takeKeyword('enum')) {
    statement = parseEnum(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('struct')) {
    statement = parseStruct(toks, toks.prevLoc(), ctx);
  } else if (toks.takeKeyword('union')) {
    statement = parseUnion(toks, toks.prevLoc(), ctx);
  } else if (toks.isType() || toks.isIdent()) {
    statement = parseConst(toks, ctx);
  } else if (!insideFailure) {
    ctx.error(toks.takeError('Invalid statement'));
  }

  if (!parseSemiColon(toks, !!statement, ctx)) return null;

  return statement;
}

function parseStatements(
  toks: TokenReader,
  ctx: Context
): SyntaxStatement[] | null {
  const statements: SyntaxStatement[] = [];
  let insideFailure = false;
  let hasError = false;
  while (!toks.isEmpty()) {
    const statement = parseStatement(toks, insideFailure, ctx);
    if (statement) {
      statements.push(statement);
    } else {
      hasError = true;
      while (toks.takeSpecial('}'));
    }
    insideFailure = !statement;
  }
  return hasError ? null : statements;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// symbol table builder
//

interface SymbolNodeGeneric<
  TKind extends string,
  TStatement extends SyntaxStatement | SyntaxVariantStruct,
  TData
> {
  kind: TKind;
  state: 'start' | 'building' | 'built' | 'emitting' | 'emitted' | 'error';
  name: string[];
  fullFile: string;
  statement: TStatement;
  data: TData | null;
}

interface SymbolNodeConstValueData {
  type: BasicType;
  value: bigint;
}

interface SymbolNodeConstValue extends SymbolNodeGeneric<
  'const.value',
  SyntaxConstValue,
  SymbolNodeConstValueData
> {}

type ConstExpr =
  | { kind: 'number'; value: number }
  | { kind: 'unary'; op: string; value: ConstExpr }
  | { kind: 'binary'; op: string; left: ConstExpr; right: ConstExpr; loc: Location }
  | { kind: 'ternary'; condition: ConstExpr; whenTrue: ConstExpr; whenFalse: ConstExpr }
  | { kind: 'param'; name: string }
  | { kind: 'symbol'; sym: SymbolNodeConstValue }
  | { kind: 'call'; sym: SymbolNodeConstFunction; args: ConstExpr[] }

interface SymbolNodeConstFunctionData {
  type: BasicType;
  params: { type: BasicType; name: string }[];
  expr: ConstExpr;
}

interface SymbolNodeConstFunction extends SymbolNodeGeneric<
  'const.function',
  SyntaxConstFunction,
  SymbolNodeConstFunctionData
> {}

interface SymbolNodeEnumData {
  type: BasicType;
  smallType: BasicType;
  options: { name: string; value: number }[];
}

interface SymbolNodeEnum extends SymbolNodeGeneric<'enum', SyntaxEnum, SymbolNodeEnumData> {}

interface BuiltFields {
  size: number;
  smallSize: number;
  fields: SymbolNodeStructDataField[];
  requireAlign: number;
}

interface SymbolNodeStructDataField {
  type: TypeNode;
  bitFields: BuiltFields | null;
  name: string | null;
  array: number | null;
  align: number;
  offset: number;
  smallOffset: number;
  size: number;
  smallSize: number;
  start: number | null;
  count: string | null;
  broken: boolean;
}

interface SymbolNodeStructData {
  align: number;
  size: number;
  fields: SymbolNodeStructDataField[];
}

interface SymbolNodeStruct
extends SymbolNodeGeneric<'struct', SyntaxStruct | SyntaxVariantStruct, SymbolNodeStructData> {
  children: SymbolMap;
}

interface SymbolNodeUnionDataVariant {
  name: string;
  tag: number;
  isSubtype: boolean;
  struct: SymbolNodeStruct | SymbolNodeUnion | null;
}

interface SymbolNodeUnionData {
  tagType: BasicType;
  align: number;
  size: number;
  variants: SymbolNodeUnionDataVariant[];
}

interface SymbolNodeUnion extends SymbolNodeGeneric<'union', SyntaxUnion, SymbolNodeUnionData>{
  children: SymbolMap;
}

type SymbolNode =
  | SymbolNodeConstValue
  | SymbolNodeConstFunction
  | SymbolNodeEnum
  | SymbolNodeStruct
  | SymbolNodeUnion;

type SymbolMap = Map<string, SymbolNode>;

type TypeNode =
  | BasicType
  | SymbolNodeEnum
  | SymbolNodeStruct
  | SymbolNodeUnion;

type UnderlyingTypeNode =
  | BasicType
  | SymbolNodeStruct
  | SymbolNodeUnion;

function makeSymbolNodeConstValue(
  name: string[],
  fullFile: string,
  statement: SyntaxConstValue
): SymbolNodeConstValue {
  return { kind: 'const.value', state: 'start', name, fullFile, statement, data: null };
}

function makeSymbolNodeConstFunction(
  name: string[],
  fullFile: string,
  statement: SyntaxConstFunction
): SymbolNodeConstFunction {
  return { kind: 'const.function', state: 'start', name, fullFile, statement, data: null };
}

function makeSymbolNodeEnum(
  name: string[],
  fullFile: string,
  statement: SyntaxEnum
): SymbolNodeEnum {
  return { kind: 'enum', state: 'start', name, fullFile, statement, data: null };
}

function makeSymbolNodeStruct(
  name: string[],
  fullFile: string,
  statement: SyntaxStruct | SyntaxVariantStruct,
  children: SymbolMap
): SymbolNodeStruct {
  return { kind: 'struct', state: 'start', name, fullFile, statement, children, data: null };
}

function makeSymbolNodeUnion(
  name: string[],
  fullFile: string,
  statement: SyntaxUnion,
  children: SymbolMap
): SymbolNodeUnion {
  return { kind: 'union', state: 'start', name, fullFile, statement, children, data: null };
}

function convertConstToType(value: bigint, type: BasicType): bigint {
  const range = 1n << BigInt(type.bits);
  value = ((value % range) + range) % range;
  if (type.signed && value >= range / 2n) {
    value -= range;
  }

  return value;
}

function validateStorageType(
  hint: string,
  type: TypeNode,
  loc: Location,
  ctx: Context
): type is BasicType {
  if (
    type.kind !== 'basic' ||
    (type.bits !== 8 && type.bits !== 16 && type.bits !== 32)
  ) {
    ctx.error({ err: `${hint} must be one of u8/u16/u32/i8/i16/i32`, loc });
    return false;
  }
  return true;
}

function evalExprBigUnary(op: string, v: bigint) {
  switch (op) {
    case '+': return v;
    case '-': return -v;
    case '~': return -v - 1n;
    case '!': return v === 0n ? 1n : 0n;
    default:
      throw new Error(`Unknown unary op: ${op}`);
  }
}

function evalExprBigBinary(op: string, left: bigint, right: bigint, loc: Location, ctx: Context) {
  switch (op) {
    case '||': return left !== 0n || right !== 0n ? 1n : 0n;
    case '&&': return left !== 0n && right !== 0n ? 1n : 0n;
    case '==': return left === right ? 1n : 0n;
    case '!=': return left !== right ? 1n : 0n;
    case '<': return left < right ? 1n : 0n;
    case '<=': return left <= right ? 1n : 0n;
    case '>': return left > right ? 1n : 0n;
    case '>=': return left >= right ? 1n : 0n;
    case '|': return left | right;
    case '^': return left ^ right;
    case '&': return left & right;
    case '<<': return left << right;
    case '>>': return left >> right;
    case '+': return left + right;
    case '-': return left - right;
    case '*': return left * right;
    case '/':
      if (right === 0n) {
        return ctx.error({ err: 'Division by zero', loc });
      }
      return left / right;
    case '%':
      if (right === 0n) {
        return ctx.error({ err: 'Division by zero', loc });
      }
      return left % right;
    default:
      throw new Error(`Unknown binary op: ${op}`);
  }
}

function evalConstExprBig(
  expr: ConstExpr,
  params: Map<string, bigint>,
  ctx: Context
): bigint | null {
  switch (expr.kind) {
    case 'number': return BigInt(expr.value);
    case 'unary': {
      const v = evalConstExprBig(expr.value, params, ctx);
      if (v === null) return null;
      return evalExprBigUnary(expr.op, v);
    }
    case 'binary': {
      const left = evalConstExprBig(expr.left, params, ctx);
      if (left === null) return null;
      const right = evalConstExprBig(expr.right, params, ctx);
      if (right === null) return null;
      return evalExprBigBinary(expr.op, left, right, expr.loc, ctx);
    }
    case 'ternary': {
      const condition = evalConstExprBig(expr.condition, params, ctx);
      if (condition === null) return null;
      const whenTrue = evalConstExprBig(expr.whenTrue, params, ctx);
      if (whenTrue === null) return null;
      const whenFalse = evalConstExprBig(expr.whenFalse, params, ctx);
      if (whenFalse === null) return null;
      return condition !== 0n ? whenTrue : whenFalse;
    }
    case 'param': {
      const value = params.get(expr.name);
      if (typeof value === 'undefined') {
        throw new Error(`Missing const parameter: ${expr.name}`);
      }
      return value;
    }
    case 'symbol': {
      if (!expr.sym.data) {
        throw new Error('Const value data is null');
      }
      return expr.sym.data.value;
    }
    case 'call': {
      if (!expr.sym.data) {
        throw new Error('Const function data is null');
      }

      const newParams = new Map<string, bigint>();
      for (let i = 0; i < expr.args.length; i++) {
        const value = evalConstExprBig(expr.args[i], params, ctx);
        if (value === null) return null;

        const param = expr.sym.data.params[i];
        if (!param) throw new Error('Const function argument count mismatch');
        newParams.set(param.name, convertConstToType(value, param.type));
      }

      const result = evalConstExprBig(expr.sym.data.expr, newParams, ctx);
      if (result === null) return null;

      return convertConstToType(result, expr.sym.data.type);
    }
    default: assertNever(expr);
  }
}

function evalExprBig(
  expr: SyntaxExpr,
  symbols: SymbolMap[],
  params: Map<string, bigint> | null,
  ctx: Context
): bigint | null {
  switch (expr.kind) {
    case 'number': return BigInt(expr.value);
    case 'unary': {
      const v = evalExprBig(expr.value, symbols, params, ctx);
      if (v === null) return null;
      return evalExprBigUnary(expr.op.str, v);
    }
    case 'binary': {
      const left = evalExprBig(expr.left, symbols, params, ctx);
      if (left === null) return null;
      const right = evalExprBig(expr.right, symbols, params, ctx);
      if (right === null) return null;
      return evalExprBigBinary(expr.op.str, left, right, expr.loc, ctx);
    }
    case 'ternary': {
      const condition = evalExprBig(expr.condition, symbols, params, ctx);
      if (condition === null) return null;
      const whenTrue = evalExprBig(expr.whenTrue, symbols, params, ctx);
      if (whenTrue === null) return null;
      const whenFalse = evalExprBig(expr.whenFalse, symbols, params, ctx);
      if (whenFalse === null) return null;
      return condition !== 0n ? whenTrue : whenFalse;
    }
    case 'symbol': {
      if (params && expr.symbol.length === 1) {
        const value = params.get(expr.symbol[0].str);
        if (typeof value !== 'undefined') return value;
      }

      const sym = buildSymbol(expr.symbol.map(t => t.str), symbols, expr.loc, ctx);
      if (!sym) return null;

      if (sym.kind === 'const.value') {
        if (!sym.data) {
          throw new Error('Const value data is null');
        }
        return sym.data.value;
      }

      if (sym.kind === 'const.function') {
        return ctx.error({ err: 'Missing parameters', loc: expr.loc });
      }
      return ctx.error({ err: `Cannot use ${sym.kind} as a constant`, loc: expr.loc });
    }
    case 'call': {
      const sym = buildSymbol(expr.symbol.map(t => t.str), symbols, expr.loc, ctx);
      if (!sym) return null;

      if (sym.kind !== 'const.function') {
        return ctx.error({ err: 'Cannot call non-function', loc: expr.loc });
      }
      if (!sym.data) {
        throw new Error('Const function data is null');
      }
      if (sym.data.params.length !== expr.args.length) {
        return ctx.error({ err: 'Wrong number of parameters', loc: expr.loc });
      }

      const newParams = new Map<string, bigint>();
      for (let i = 0; i < expr.args.length; i++) {
        const value = evalExprBig(expr.args[i], symbols, params, ctx);
        if (value === null) return null;

        const param = sym.data.params[i];
        newParams.set(param.name, convertConstToType(value, param.type));
      }

      const result = evalConstExprBig(sym.data.expr, newParams, ctx);
      if (result === null) return null;

      return convertConstToType(result, sym.data.type);
    }
    default: assertNever(expr);
  }
}

function evalExpr(
  expr: SyntaxExpr,
  symbols: SymbolMap[],
  params: Map<string, bigint> | null,
  ctx: Context
): number | null {
  const result = evalExprBig(expr, symbols, params, ctx);
  return result === null ? null : Number(result);
}

function underlyingType(type: TypeNode): UnderlyingTypeNode {
  if (type.kind === 'enum') {
    if (!type.data) {
      throw new Error('Enum missing data');
    }
    return type.data.type;
  }
  return type;
}

function typeFromRange(range: [number, number], loc: Location, ctx: Context): BasicType | null {
  const signed = range[0] < 0;
  let bits = 1;
  for (; bits <= 32; bits++) {
    const min = signed ? -(2 ** (bits - 1)) : 0;
    const max = signed ? (2 ** (bits - 1)) - 1 : (2 ** bits) - 1;
    if (range[0] >= min && range[1] <= max) {
      break;
    }
  }
  if (bits > 32) {
    return ctx.error({
      err: `Range of values too large (${range[0]} to ${range[1]})`,
      loc,
    });
  }
  return { kind: 'basic', signed, bits };
}

function buildType(typeAST: SyntaxType, symbols: SymbolMap[], ctx: Context): TypeNode | null {
  if (Array.isArray(typeAST)) {
    const result = buildSymbol(
      typeAST.map(t => t.str),
      symbols,
      typeAST[0].loc,
      ctx
    );
    if (!result) return null;
    if (result.kind === 'enum' || result.kind === 'struct' || result.kind === 'union') {
      return result;
    } else if (result.kind === 'const.value' || result.kind === 'const.function') {
      return ctx.error({ err: `Expecting type`, loc: typeAST[0].loc });
    }
    assertNever(result);
  }
  return typeAST.type;
}

function buildField(
  fieldAST: SyntaxField,
  isBitField: boolean,
  offset: number,
  smallOffset: number,
  symbols: SymbolMap[],
  loc: Location,
  ctx: Context
): SymbolNodeStructDataField | null {
  const name = fieldAST.name?.str ?? null;

  const type = buildType(fieldAST.type, symbols, ctx);
  if (!type) return null;
  if (isBitField && type.kind !== 'basic' && type.kind !== 'enum') {
    return ctx.error({ err: `Invalid bit field type`, loc });
  }

  let bitFields: BuiltFields | null = null;
  if (!isBitField && fieldAST.bitFields) {
    bitFields = buildFields(fieldAST.bitFields, type, symbols, loc, ctx);
    if (!bitFields) return null;
  }

  let bits: number;
  let size: number;
  let smallSize: number;
  let align: number;
  if (type.kind === 'basic') {
    bits = align = size = smallSize = type.bits;
  } else if (type.kind === 'enum') {
    if (!type.data) {
      throw new Error('Built type data is null');
    }
    bits = align = size = type.data.type.bits;
    smallSize = type.data.smallType.bits;
  } else if (type.kind === 'struct' || type.kind === 'union') {
    if (!type.data) {
      throw new Error('Built type data is null');
    }
    bits = size = smallSize = type.data.size;
    align = type.data.align;
  } else {
    assertNever(type);
  }

  let array: number | null = null;
  if (fieldAST.array) {
    array = evalExpr(fieldAST.array, symbols, null, ctx);
    if (array === null) return null;
    if (array <= 0) {
      return ctx.error({ err: `Invalid array length: ${array}`, loc });
    }
    size *= array;
    smallSize *= array;
  }

  let start: number | null = null;
  let count: string | null = null;
  let broken = false;
  for (const note of fieldAST.notes) {
    if (type.kind === 'basic' && note.kind === 'start') {
      if (start === null) {
        start = evalExpr(note.expr, symbols, null, ctx);
        if (start === null) return null;
        if (start < 0 && !type.signed) {
          return ctx.error({
            err: `Cannot have unsigned field with negative @start`,
            loc: note.loc
          });
        }
      } else {
        return ctx.error({ err: `Cannot specify @start multiple times`, loc: note.loc });
      }
    } else if (note.kind === 'count') {
      if (count === null) {
        count = note.field.str;
      } else {
        return ctx.error({ err: `Cannot specify @count multiple times`, loc: note.loc });
      }
    } else if (!isBitField && type.kind === 'basic' && note.kind === 'break') {
      if (!broken) {
        if (bits !== 16 && bits !== 32) {
          return ctx.error({
            err: `Cannot specify @break on field with ${bits} bits`,
            loc: note.loc
          });
        }
        align = 8;
        broken = true;
      } else {
        return ctx.error({ err: `Cannot specify @break multiple times`, loc: note.loc });
      }
    } else {
      return ctx.error({ err: `Invalid annotation on field: @${note.kind}`, loc: note.loc });
    }
  }

  return {
    type,
    bitFields,
    name,
    array,
    align,
    offset,
    smallOffset,
    size,
    smallSize,
    start,
    count,
    broken
  };
}

function validateCounts(
  eachField: (eachFunc: (field: SymbolNodeStructDataField, loc: Location) => true | null) => true | null,
  findField: (name: string) => { field: SymbolNodeStructDataField | null, containerArray: number | null },
  ctx: Context
): true | null {
  // validate @count's point to valid fields
  return eachField((field, loc) => {
    if (!field.count) return true;

    if (field.array === null) {
      return ctx.error({ err: `Only arrays can have @count`, loc });
    }

    if (field.count === field.name) {
      return ctx.error({ err: `Cannot point @count to itself`, loc });
    }

    const { field: count, containerArray } = findField(field.count);
    if (!count) {
      return ctx.error({ err: `Field "${field.count}" referenced by @count doesn't exist`, loc });
    }
    if (containerArray) {
      return ctx.error({ err: `Field "${field.count}" cannot be inside an array`, loc });
    }

    const countType = count.type;
    if (countType.kind !== 'basic') {
      return ctx.error({ err: `Field "${field.count}" cannot contain a count`, loc });
    }

    if (count.array !== null) {
      return ctx.error({
        err: `Field "${field.name}" cannot use "${field.count}" as @count because it's an array`,
        loc,
      });
    }

    if (count.start !== null) {
      return ctx.error({
        err: `Field "${field.count}" cannot have @start due to @count on "${field.name}"`,
        loc,
      });
    }

    const max = 2 ** (countType.bits - (countType.signed ? 1 : 0)) - 1;
    if (field.array > max) {
      return ctx.error({
        err: `Field "${field.count}" cannot count up to ` +
          `"${field.name}[${field.array}]" (max ${max})`,
        loc
      });
    }

    return true;
  });
}

function buildFields(
  fieldsAST: SyntaxField[],
  containerType: TypeNode | null,
  symbols: SymbolMap[],
  loc: Location,
  ctx: Context
): BuiltFields | null {
  // process fields
  const fields: SymbolNodeStructDataField[] = [];

  const hasName = (name: string) =>
    fields.some(f => f.name === name || f.bitFields?.fields.some(b => b.name === name));

  let size = 0;
  let smallSize = 0;
  let requireAlign = 8;
  for (const fieldAST of fieldsAST) {
    const field = buildField(
      fieldAST,
      !!containerType,
      size,
      smallSize,
      symbols,
      fieldAST.loc,
      ctx
    );
    if (!field) return null;
    const baseType = underlyingType(field.type);
    switch (baseType.kind) {
      case 'basic': {
        if (!containerType && baseType.bits !== 8 && baseType.bits !== 16 && baseType.bits !== 32) {
          return ctx.error({
            err: `Invalid field size (${baseType.bits} bit${baseType.bits === 1 ? '' : 's'}); ` +
              `must be 8, 16, or 32 bits${fieldAST.name ? `: "${fieldAST.name.str}"` : ''}`,
            loc: fieldAST.loc
          });
        }
        if (!field.broken) {
          requireAlign = Math.max(requireAlign, baseType.bits);
        }
        break;
      }
      case 'struct':
      case 'union':
        if (!baseType.data) {
          throw new Error('Missing struct/union data');
        }
        requireAlign = Math.max(requireAlign, baseType.data.align);
        break;
      default:
        assertNever(baseType);
    }
    size += field.size;
    smallSize += field.smallSize;
    if (field.name && hasName(field.name)) {
      return ctx.error({
        err: `Cannot redefine "${field.name}"`,
        loc: fieldAST.loc
      });
    }
    if (field.bitFields) {
      const bitFieldsAST = fieldAST.bitFields;
      if (!bitFieldsAST) {
        throw new Error('Bit fields AST has gone missing');
      }
      for (let i = 0; i < field.bitFields.fields.length; i++) {
        const name = field.bitFields.fields[i].name;
        if (name && hasName(name)) {
          return ctx.error({
            err: `Cannot redefine "${name}"`,
            loc: bitFieldsAST[i].loc
          });
        }
      }
    }
    fields.push(field);
  }

  if (containerType) {
    // if we have bitFields, then the type needs to be a basic type
    if (containerType.kind !== 'basic') {
      return ctx.error({ err: `Cannot specify bit fields with non-primitive type`, loc });
    }
    const container = containerType.bits;
    if (container !== 8 && container !== 16 && container !== 32) {
      return ctx.error({
        err: `Invalid container for bit fields; ` +
          `expecting 8, 16, or 32 bits, instead got ${container}`,
        loc,
      });
    }
    if (smallSize > container) {
      return ctx.error({
        err: `Bit fields (${smallSize} bits) overflow container (${container} bits)`,
        loc,
      });
    } else if (smallSize < container) {
      return ctx.error({
        err: `Bit fields (${smallSize} bit${smallSize === 1 ? '' : 's'}) ` +
          `don't fill container (${container} bits)`,
        loc,
      });
    }
  }

  return { size, smallSize, fields, requireAlign };
}

function buildEnum(
  enu: SymbolNodeEnum,
  symbols: SymbolMap[],
  ctx: Context
) {
  let range: [number, number] = [0, 0];
  let options: SymbolNodeEnumData['options'] = [];
  let nextValue = 0;
  for (const option of enu.statement.options) {
    const value = option.value ? evalExpr(option.value, symbols, null, ctx) : nextValue;
    if (value === null) return null;
    nextValue = value + 1;
    range[0] = Math.min(range[0], value);
    range[1] = Math.max(range[1], value);
    if (options.some(opt => opt.name === option.option.str)) {
      return ctx.error({
        err: `Cannot redefine "${option.option.str}"`,
        loc: option.option.loc
      });
    }
    if (options.some(opt => opt.value === value)) {
      return ctx.error({
        err: `Cannot reuse enum value ${value}`,
        loc: option.option.loc
      });
    }
    options.push({ name: option.option.str, value });
  }

  // figure out best type
  const smallType = typeFromRange(range, enu.statement.loc, ctx);
  if (!smallType) return null;
  const type = { ...smallType, bits: Math.max(8, nextPowerOf2(smallType.bits)) }

  enu.data = { type, smallType, options };

  return true;
}

function buildStruct(
  struct: SymbolNodeStruct,
  isVariant: boolean,
  symbols: SymbolMap[],
  ctx: Context
): true | null {
  let noteAlign: number | null = null;
  for (const note of struct.statement.notes) {
    if (note.kind === 'align') {
      if (noteAlign !== null) {
        return ctx.error({ err: `Cannot specify @align multiple times`, loc: note.loc });
      } else {
        noteAlign = evalExpr(note.expr, symbols, null, ctx);
        if (noteAlign === null) return null;
        if (noteAlign !== 8 && noteAlign !== 16 && noteAlign !== 32) {
          return ctx.error({ err: `Invalid @align; must be one of 8, 16, or 32`, loc: note.loc });
        }
      }
    } else if (isVariant && note.kind === 'tag') {
      // ignore @tag on union variants
    } else {
      return ctx.error({ err: `Invalid annotation on struct: @${note.kind}`, loc: note.loc });
    }
  }

  // build all fields
  const fieldsData = buildFields(
    struct.statement.fields,
    null,
    struct.children ? [struct.children, ...symbols] : symbols,
    struct.statement.loc,
    ctx
  )
  if (!fieldsData) return null;
  const { size, fields, requireAlign } = fieldsData;

  // calculate alignment
  let align = requireAlign;
  if (noteAlign) {
    if (noteAlign < align) {
      return ctx.error({
        err: `Invalid @align(${noteAlign}); struct requires at least ${align} bit alignment`,
        loc: struct.statement.loc
      });
    }
    align = noteAlign;
  }

  // validate @count's
  const validCounts = validateCounts(
    func => {
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const fieldAST = struct.statement.fields[i];
        if (!func(field, fieldAST.loc)) {
          return null;
        }
        if (field.bitFields) {
          const bitFieldsAST = fieldAST.bitFields;
          if (!bitFieldsAST) {
            throw new Error('Bit fields AST has gone missing');
          }
          for (let j = 0; j < field.bitFields.fields.length; j++) {
            if (!func(field.bitFields.fields[j], bitFieldsAST[j].loc)) {
              return null;
            }
          }
        }
      }
      return true;
    },
    name => {
      for (const field of fields) {
        if (field.name === name) {
          return { field, containerArray: null };
        }
        if (field.bitFields) {
          for (const bf of field.bitFields.fields) {
            if (bf.name === name) {
              return { field: bf, containerArray: field.array };
            }
          }
        }
      }
      return { field: null, containerArray: null };
    },
    ctx
  );
  if (!validCounts) return null;

  // validate struct alignment
  if ((size % align) !== 0) {
    return ctx.error({
      err: `Struct "${struct.statement.name.str}" (size of ${size} bits) ` +
        `is misaligned (alignment of ${align} bits); needs ${align - (size % align)} more bits`,
      loc: struct.statement.loc,
    });
  }

  // validate member alignment
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.broken) continue;
    const fieldAST = struct.statement.fields[i];
    if ((field.offset % field.align) !== 0) {
      return ctx.error({
        err: `Field misaligned${field.name ? `: "${field.name}"` : ''}`,
        loc: fieldAST.loc
      });
    }
  }

  struct.data = { align, size, fields };

  return true;
}

function buildUnion(
  union: SymbolNodeUnion,
  symbols: SymbolMap[],
  ctx: Context
): true | null {
  let noteAlign = null;
  for (const note of union.statement.notes) {
    if (note.kind === 'align') {
      if (noteAlign !== null) {
        return ctx.error({ err: `Cannot specify @align multiple times`, loc: note.loc });
      } else {
        noteAlign = evalExpr(note.expr, symbols, null, ctx);
        if (noteAlign === null) return null;
        if (noteAlign !== 8 && noteAlign !== 16 && noteAlign !== 32) {
          return ctx.error({ err: `Invalid @align; must be one of 8, 16, or 32`, loc: note.loc });
        }
      }
    } else {
      return ctx.error({ err: `Invalid annotation on union: @${note.kind}`, loc: note.loc });
    }
  }

  const range: [number, number] = [0, 0];
  let nextTag = 0;
  let requireAlign = 8;
  const variants: SymbolNodeUnionDataVariant[] = [];
  let payloadSize = 0;
  const innerSymbols = [union.children, ...symbols];
  for (const variant of union.statement.variants) {
    const name = variant.name.str;
    let tag = null;
    for (const note of variant.notes) {
      if (note.kind === 'tag') {
        if (tag !== null) {
          return ctx.error({ err: `Cannot specify @tag multiple times`, loc: note.loc });
        } else {
          tag = evalExpr(note.expr, innerSymbols, null, ctx);
          if (tag === null) return null;
        }
      } else {
        return ctx.error({ err: `Invalid annotation on "${name}": @${note.kind}`, loc: note.loc });
      }
    }
    if (tag === null) tag = nextTag;
    nextTag = tag + 1;
    range[0] = Math.min(range[0], tag);
    range[1] = Math.max(range[1], tag);

    if (variants.some(v => v.name === name)) {
      return ctx.error({
        err: `Cannot redefine "${name}"`,
        loc: variant.name.loc
      });
    }
    if (variants.some(v => v.tag === tag)) {
      return ctx.error({
        err: `Cannot reuse union tag value ${tag}`,
        loc: variant.name.loc
      });
    }

    let struct: SymbolNodeStruct | SymbolNodeUnion | null = null;
    let isSubtype = false;
    switch (variant.kind) {
      case 'variant.empty': break;
      case 'variant.subtype': {
        const subtype = buildType(variant.subtype, innerSymbols, ctx);
        if (!subtype) return null;
        if (subtype.kind !== 'struct' && subtype.kind !== 'union') {
          return ctx.error({
            err: `Union subtype must be a struct or union`,
            loc: syntaxTypeLoc(variant.subtype),
          });
        }
        struct = subtype;
        isSubtype = true;
        break;
      }
      case 'variant.struct':
        struct = makeSymbolNodeStruct([...union.name, name], union.fullFile, variant, new Map());
        struct.state = 'building';
        if (!buildStruct(struct, true, innerSymbols, ctx)) return null;
        struct.state = 'built';
        break;
      default:
        assertNever(variant);
    }

    if (struct) {
      if (!struct.data) {
        throw new Error('Struct data type is null');
      }
      requireAlign = Math.max(requireAlign, struct.data.align);
      payloadSize = Math.max(payloadSize, struct.data.size);
    }
    variants.push({ name, tag, struct, isSubtype });
  }

  // figure out best type for tag
  const tagType = typeFromRange(range, union.statement.loc, ctx);
  if (!tagType) return null;
  requireAlign = Math.max(requireAlign, nextPowerOf2(tagType.bits));

  // calculate alignment
  let align = requireAlign;
  if (noteAlign) {
    if (noteAlign < align) {
      return ctx.error({
        err: `Invalid @align(${noteAlign}); union requires at least ${align} bit alignment`,
        loc: union.statement.loc
      });
    }
    align = noteAlign;
  }

  // align tag type
  tagType.bits = align;

  // round up payload size to nearest align
  payloadSize = Math.ceil(payloadSize / align) * align;

  union.data = {
    tagType,
    align,
    size: tagType.bits + payloadSize,
    variants
  };

  return true;
}

function buildConstValue(
  cons: SymbolNodeConstValue,
  symbols: SymbolMap[],
  ctx: Context
): true | null {
  const type = buildType(cons.statement.type, symbols, ctx);
  if (!type) return null;
  if (!validateStorageType('Constant', type, syntaxTypeLoc(cons.statement.type), ctx)) return null;

  const value = evalExprBig(cons.statement.expr, symbols, null, ctx);
  if (value === null) return null;
  cons.data = { type, value: convertConstToType(value, type) };

  return true;
}

function buildConstFunction(
  cons: SymbolNodeConstFunction,
  symbols: SymbolMap[],
  ctx: Context
): true | null {
  const type = buildType(cons.statement.type, symbols, ctx);
  if (!type) return null;
  if (!validateStorageType('Constant', type, syntaxTypeLoc(cons.statement.type), ctx)) return null;

  const params: SymbolNodeConstFunctionData['params'] = [];
  for (const { type, name } of cons.statement.params) {
    const paramType = buildType(type, symbols, ctx);
    if (!paramType) return null;
    if (!validateStorageType('Parameter', paramType, syntaxTypeLoc(type), ctx)) return null;
    if (params.some(p => p.name === name.str)) {
      return ctx.error({ err: `Cannot redefine "${name.str}"`, loc: name.loc });
    }
    params.push({ type: paramType, name: name.str });
  }

  function walk(expr: SyntaxExpr): ConstExpr | null {
    switch (expr.kind) {
      case 'number':
        return { kind: 'number', value: expr.value };
      case 'unary': {
        const value = walk(expr.value);
        if (!value) return null;
        return { kind: 'unary', op: expr.op.str, value };
      }
      case 'binary': {
        const left = walk(expr.left);
        if (!left) return null;
        const right = walk(expr.right);
        if (!right) return null;
        return { kind: 'binary', op: expr.op.str, left, right, loc: expr.loc };
      }
      case 'ternary': {
        const condition = walk(expr.condition);
        if (!condition) return null;
        const whenTrue = walk(expr.whenTrue);
        if (!whenTrue) return null;
        const whenFalse = walk(expr.whenFalse);
        if (!whenFalse) return null;
        return { kind: 'ternary', condition, whenTrue, whenFalse };
      }
      case 'symbol': {
        if (expr.symbol.length === 1 && params.some(p => p.name === expr.symbol[0].str)) {
          return { kind: 'param', name: expr.symbol[0].str };
        }

        const sym = buildSymbol(expr.symbol.map(t => t.str), symbols, expr.loc, ctx);
        if (!sym) return null;

        if (sym.kind === 'const.value') {
          if (!sym.data) {
            throw new Error('Symbol data is null');
          }
          return { kind: 'symbol', sym };
        } else if (sym.kind === 'const.function') {
          return ctx.error({ err: 'Missing parameters', loc: expr.loc });
        }

        return ctx.error({ err: `Cannot use ${sym.kind} as a constant`, loc: expr.loc });
      }
      case 'call': {
        const sym = buildSymbol(expr.symbol.map(t => t.str), symbols, expr.loc, ctx);
        if (!sym) return null;

        if (sym.kind !== 'const.function') {
          return ctx.error({
            err: 'Cannot call non-function',
            loc: expr.loc
          });
        }
        if (!sym.data) {
          throw new Error('Const data is null');
        }
        if (sym.data.params.length !== expr.args.length) {
          return ctx.error({
            err: 'Wrong number of parameters',
            loc: expr.loc
          });
        }

        const args: ConstExpr[] = [];
        for (let i = 0; i < expr.args.length; i++) {
          const v = walk(expr.args[i]);
          if (v === null) return null;
          args.push(v);
        }

        return { kind: 'call', sym, args };
      }
      default:
        assertNever(expr);
    }
  }

  const expr = walk(cons.statement.expr);
  if (!expr) return null;

  cons.data = { type, params, expr };

  return true;
}

function buildSymbol(
  names: string[],
  symbols: SymbolMap[],
  loc: Location,
  ctx: Context
): SymbolNode | null {
  // lookup
  let sym: SymbolNode | undefined;
  for (const map of symbols) {
    sym = map.get(names[0]);
    for (let i = 1; i < names.length && sym; i++) {
      sym = 'children' in sym ? sym.children.get(names[i]) : undefined;
    }
    if (sym) break;
  }
  if (!sym) {
    return ctx.error({ err: `Unknown symbol: ${names.join('.')}`, loc });
  }

  // if already built, return it
  if (sym.state === 'built') {
    return sym;
  }
  if (sym.state === 'error') {
    return null;
  }

  // if in process of building it, then we have circular dependencies, so fail
  if (sym.state === 'building') {
    return ctx.error({ err: `Cannot fully build: ${names.join('.')}`, loc });
  }

  // otherwise, start building it!
  if (sym.state !== 'start') {
    throw new Error(`Unexpected sym state: ${sym.state}`);
  }
  sym.state = 'building';
  const buildChildren = () => {
    if (!('children' in sym)) return true;
    return buildSymbols([sym.children, ...symbols], ctx);
  };
  const ok = () => {
    sym.state = 'built';
    if (!buildChildren()) {
      return null;
    }
    return sym;
  };
  const bail = () => {
    sym.state = 'error';
    buildChildren();
    return null;
  };

  switch (sym.kind) {
    case 'const.value': return buildConstValue(sym, symbols, ctx) ? ok() : bail();
    case 'const.function': return buildConstFunction(sym, symbols, ctx) ? ok() : bail();
    case 'enum': return buildEnum(sym, symbols, ctx) ? ok() : bail();
    case 'struct': return buildStruct(sym, false, symbols, ctx) ? ok() : bail();
    case 'union': return buildUnion(sym, symbols, ctx) ? ok() : bail();
    default: assertNever(sym);
  }
}

function buildSymbols(symbols: SymbolMap[], ctx: Context): true | null {
  for (const [k, v] of symbols[0].entries()) {
    const result = buildSymbol([k], symbols, v.statement.loc, ctx);
    if (!result) return null;
  }
  return true;
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// build context
//

interface Include {
  file: string;
  fullFile: string;
  includes: Include[];
}

interface ProcessFileInnerResult {
  fullFile: string;
  includes: Include[];
}

type ProcessFileResult = { result: ProcessFileInnerResult } | { errors: true, circular?: true }

class Builder {
  fileState = new Map<string, { inProgress: true } | ProcessFileResult>();
  symbols: SymbolMap = new Map();

  async processIncludes(
    toks: TokenReader,
    fullFile: string,
    ctx: Context
  ): Promise<Include[] | null> {
    const includes = [];
    let hasError = false;
    while (toks.takeKeyword('include')) {
      const file = toks.take();
      if (file.kind !== 'string') {
        ctx.error({
          err: 'Invalid statement; expecting `include "filename.type";`',
          loc: file.loc
        });
        hasError = true;
        continue;
      }
      if (!toks.takeSpecial(';')) {
        ctx.error(toks.error('Expecting ";"'));
        hasError = true;
        continue;
      }
      if (path.basename(file.str).toLowerCase() === `${LIB}.type`.toLowerCase()) {
        ctx.error({
          err: `Cannot use reserved filename: ${file.str}`,
          loc: file.loc
        });
        hasError = true;
        continue;
      }
      const result = await this.processFile(path.dirname(fullFile), file.str, ctx);
      if ('errors' in result) {
        hasError = true;
        if ('circular' in result) {
          ctx.error({
            err: `Circular dependency when including "${file.str}"`,
            loc: file.loc
          });
        }
      } else {
        includes.push({
          file: file.str,
          fullFile: result.result.fullFile,
          includes: result.result.includes,
        });
      }
    }
    return hasError ? null : includes;
  }

  registerSymbols(statements: SyntaxStatement[], fullFile: string, ctx: Context): true | null {
    const here: SymbolMap[] = [this.symbols];

    const addSymbol = (name: string, value: SymbolNode, loc: Location): true | null => {
      if (here[0].get(name)) {
        return ctx.error({ err: `Cannot redefine "${name}"`, loc });
      }
      here[0].set(name, value);
      return true;
    };

    const processStatements = (root: string[], statements: SyntaxStatement[]) => {
      for (const statement of statements) {
        const { str: name, loc } = statement.name;
        const fullName = [...root, name];
        switch (statement.kind) {
          case 'const': {
            const node = statement.params
              ? makeSymbolNodeConstFunction(fullName, fullFile, statement)
              : makeSymbolNodeConstValue(fullName, fullFile, statement);
            if (!addSymbol(name, node, loc)) return null;
            break;
          }
          case 'enum': {
            const node = makeSymbolNodeEnum(fullName, fullFile, statement);
            if (!addSymbol(name, node, loc)) return null;
            break;
          }
          case 'struct': {
            const children: SymbolMap = new Map();
            const node = makeSymbolNodeStruct(fullName, fullFile, statement, children);
            if (!addSymbol(name, node, loc)) return null;
            here.unshift(children);
            if (!processStatements(fullName, statement.children)) return null;
            here.shift();
            break;
          }
          case 'union': {
            const children: SymbolMap = new Map();
            const node = makeSymbolNodeUnion(fullName, fullFile, statement, children);
            if (!addSymbol(name, node, loc)) return null;
            here.unshift(children);
            if (!processStatements(fullName, statement.children)) return null;
            here.shift();
            break;
          }
          default:
            assertNever(statement);
        }
      }
      return true;
    };

    return processStatements([], statements);
  }

  async processFileInner(
    file: string,
    fullFile: string,
    ctx: Context
  ): Promise<ProcessFileInnerResult | null> {
    // lex
    const fileData = await fs.readFile(fullFile, 'utf8');
    const tokens = lex(file, fileData, ctx);
    if (!tokens) return null;
    const tokenReader = new TokenReader(tokens, file);

    // process includes
    const includes = await this.processIncludes(tokenReader, fullFile, ctx);
    if (!includes) return null;

    // parse statements
    const statements = parseStatements(tokenReader, ctx);
    if (!statements) return null;

    // initialize symbol table
    if (!this.registerSymbols(statements, fullFile, ctx)) return null;

    // build symbol table
    if (!buildSymbols([this.symbols], ctx)) return null;

    return { fullFile, includes };
  }

  async processFile(
    cwd: string,
    file: string,
    ctx: Context
  ): Promise<ProcessFileResult> {
    const fullFile = path.resolve(cwd, file);
    const state = this.fileState.get(fullFile);
    if (state) {
      if ('result' in state) {
        return state;
      }
      return { errors: true, circular: true };
    } else {
      this.fileState.set(fullFile, { inProgress: true });
    }
    const result = await this.processFileInner(file, fullFile, ctx);
    const newState: ProcessFileResult = result ? { result } : { errors: true };
    this.fileState.set(fullFile, newState);
    return newState;
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// emitter
//

function emitStart(sym: SymbolNode): true | null {
  switch (sym.state) {
    case 'error': throw new Error('Unexpected error while emitting');
    case 'emitting': throw new Error('Circular emit');
    case 'emitted': return null;
    case 'built': sym.state = 'emitting'; return true;
    default: throw new Error(`Unexpected symbol state while emitting: ${sym.state}`);
  }
}

function emitEnd(sym: SymbolNode) {
  sym.state = 'emitted';
}

class Emitter {
  fullFile: string;
  cFile: CXXFile;
  cppFile: CXXFile;

  constructor(fullFile: string, cFile: CXXFile, cppFile: CXXFile) {
    this.fullFile = fullFile;
    this.cFile = cFile;
    this.cppFile = cppFile;
  }

  emitConstValue(sym: SymbolNodeConstValue) {
    if (!emitStart(sym)) return;

    this.cFile.pushConstValue(sym);
    this.cppFile.pushConstValue(sym);

    emitEnd(sym);
  }

  emitConstFunction(sym: SymbolNodeConstFunction) {
    if (!emitStart(sym)) return;

    this.cFile.pushConstFunction(sym);
    this.cppFile.pushConstFunction(sym);

    emitEnd(sym);
  }

  emitEnum(sym: SymbolNodeEnum) {
    if (!emitStart(sym)) return;

    this.cFile.pushEnum(sym);
    this.cppFile.pushEnum(sym);

    emitEnd(sym);
  }

  emitStruct(sym: SymbolNodeStruct) {
    if (!emitStart(sym)) return;

    if (!sym.data) {
      throw new Error('Struct data missing');
    }
    this.emitSymbols(sym.children);
    for (const field of sym.data.fields) {
      this.emitSymbol(field.type);
    }
    if (sym.data.fields.length > 0) {
      this.cFile.pushStruct(sym);
    }
    this.cppFile.pushStruct(sym);

    emitEnd(sym);
  }

  emitUnion(sym: SymbolNodeUnion) {
    if (!emitStart(sym)) return;

    if (!sym.data) {
      throw new Error('Union missing data');
    }
    this.emitSymbols(sym.children);
    for (const variant of sym.data.variants) {
      if (variant.struct) {
        this.emitSymbol(variant.struct);
      }
    }
    if (sym.data.variants.length > 0) {
      this.cFile.pushUnion(sym);
    }
    this.cppFile.pushUnion(sym);

    emitEnd(sym);
  }

  emitSymbol(sym: SymbolNode | BasicType) {
    if (sym.kind === 'basic' || sym.fullFile !== this.fullFile) return;
    switch (sym.kind) {
      case 'const.value': this.emitConstValue(sym); return;
      case 'const.function': this.emitConstFunction(sym); return;
      case 'enum': this.emitEnum(sym); return;
      case 'struct': this.emitStruct(sym); return;
      case 'union': this.emitUnion(sym); return;
      default: assertNever(sym);
    }
  }

  emitSymbols(symbols: SymbolMap) {
    if (!symbols) return;
    for (const sym of symbols.values()) {
      if (sym.fullFile === this.fullFile) {
        this.emitSymbol(sym);
      }
    }
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// C/CPP emitter
//

abstract class Formatter {
  abstract name(...args: (string | string[])[]): string;
  abstract cName(...args: (string | string[])[]): string;
  abstract type(type: TypeNode, upgrade: boolean): string;
  abstract cType(type: TypeNode, upgrade: boolean): string;
  abstract tagName(union: SymbolNodeUnion): string;
  abstract tagType(union: SymbolNodeUnion): string;
  abstract containerType(type: TypeNode, upgrade: boolean): string;
  abstract printValue(type: TypeNode, val: string, pad: string, upgrade: boolean): string;
}

class CFormatter extends Formatter {
  name(...args: (string | string[])[]): string {
    return args
      .map(g => Array.isArray(g) ? g.filter(Boolean).join('_') : g)
      .filter(Boolean)
      .join('_');
  }

  cName(...args: (string | string[])[]): string {
    return this.name(...args);
  }

  type(type: TypeNode, upgrade: boolean): string {
    switch (type.kind) {
      case 'basic': return typeToStr(upgrade ? { ...type, bits: 32 } : type);
      case 'enum': return `enum ${this.name(type.name)}`;
      case 'struct':
      case 'union': return `struct ${this.name(type.name)}`;
      default: assertNever(type);
    }
  }

  cType(type: TypeNode, upgrade: boolean): string {
    return this.type(type, upgrade);
  }

  tagName(union: SymbolNodeUnion): string {
    return this.name('Tag', union.name);
  }

  tagType(union: SymbolNodeUnion): string {
    return `enum ${this.tagName(union)}`;
  }

  containerType(type: TypeNode, upgrade: boolean): string {
    return type.kind === 'basic'
      ? this.type({ ...type, bits: Math.max(8, nextPowerOf2(type.bits)) }, upgrade)
      : this.type(type, upgrade);
  }

  printValue(type: TypeNode, val: string, pad: string, upgrade: boolean): string {
    switch (type.kind) {
      case 'basic': return cPrintInt(upgrade ? { ...type, bits: 32 } : type, val);
      case 'enum':
      case 'struct':
      case 'union': return `${this.cName(type.name)}_printPad(${val}, ${pad});`;
      default: assertNever(type);
    }
  }
}

class CPPFormatter extends Formatter {
  name(...args: (string | string[])[]): string {
    return args
      .map(g => Array.isArray(g) ? g.filter(Boolean).join('::') : g)
      .filter(Boolean)
      .join('::');
  }

  cName(...args: (string | string[])[]): string {
    return args
      .map(g => Array.isArray(g) ? g.filter(Boolean).join('_') : g)
      .filter(Boolean)
      .join('_');
  }

  type(type: TypeNode, upgrade: boolean): string {
    switch (type.kind) {
      case 'basic': return typeToStr(upgrade ? { ...type, bits: 32 } : type);
      case 'enum': return this.name(type.name);
      case 'struct':
      case 'union': return this.name(type.name);
      default: assertNever(type);
    }
  }

  cType(type: TypeNode, upgrade: boolean): string {
    switch (type.kind) {
      case 'basic': return typeToStr(upgrade ? { ...type, bits: 32 } : type);
      case 'enum': return this.cName(type.name);
      case 'struct':
      case 'union': return this.cName(type.name);
      default: assertNever(type);
    }
  }

  tagName(union: SymbolNodeUnion): string {
    return this.cName('Tag', union.name);
  }

  tagType(union: SymbolNodeUnion): string {
    return this.tagName(union);
  }

  containerType(type: TypeNode, upgrade: boolean): string {
    return type.kind === 'basic'
      ? this.type({ ...type, bits: Math.max(8, nextPowerOf2(type.bits)) }, upgrade)
      : this.type(type, upgrade);
  }

  printValue(type: TypeNode, val: string, pad: string, upgrade: boolean): string {
    switch (type.kind) {
      case 'basic': return cPrintInt(upgrade ? { ...type, bits: 32 } : type, val);
      case 'enum':
      case 'struct':
      case 'union': return `${this.cName(type.name)}_printPad(${val}, ${pad});`;
      default: assertNever(type);
    }
  }
}

function cUint32(num: number): string {
  if (num < 0) num += 0x100000000;
  let str = num.toString(16);
  while (
    str.length < 2 ||
    (str.length > 2 && str.length < 4) ||
    (str.length > 4 && str.length < 8)
  ) str = `0${str}`;
  return `UINT32_C(0x${str})`;
}

function cStr(str: string) {
  return JSON.stringify(str);
}

function applyGetStart(expr: string, start: number | null) {
  if (start === null || start === 0) {
    return expr;
  }
  return `((${expr}) ${start < 0 ? `- ${-start}` : `+ ${start}`})`;
}

function applySetStart(expr: string, start: number | null) {
  if (start === null || start === 0) {
    return expr;
  }
  return applyGetStart(expr, -start);
}

function cGetBitField(
  bf: SymbolNodeStructDataField,
  signed: boolean,
  data: string,
  index: string | null,
  cpp: boolean
): string[] {
  const size = bf.array === null ? bf.smallSize : bf.smallSize / bf.array;

  let x = `${32 - size - bf.smallOffset}`;
  if (index !== null) {
    x = `(${x} - ${size} * ${index})`;
  }

  const get = `((${signed ? 'i32' : 'u32'})(((u32)${data}) << ${x})) >> ${32 - size}`;
  const cast = cpp && bf.type.kind === 'enum'
    ? `static_cast<${bf.type.name.join('_')}>`
    : '';

  return [`return ${cast}(${applyGetStart(get, bf.start)});`];
}

function cSetBitField(
  bf: SymbolNodeStructDataField,
  data: string,
  index: string | null,
  value: string
): string[] {
  const size = bf.array === null ? bf.smallSize : bf.smallSize / bf.array;

  value = applySetStart(`((u32)${value})`, bf.start);

  return [
    `u32 mask = ${cUint32((2 ** size) - 1)};`,
    `u32 offset = ${index === null
      ? `${bf.smallOffset}`
      : `${bf.smallOffset === 0 ? '' : `${bf.smallOffset} + `}${size} * ${index}`};`,
    `return (((u32)${data}) & ~(mask << offset)) | ((${value} & mask) << offset);`,
  ];
}

function pushCommentBitFields(out: string[], prefix: string, bitFields: BuiltFields | null) {
  if (!bitFields) return;
  const bits = [];
  const labels = [];
  const labelStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
  const maxBitlen = bitFields.fields
    .map(bf => `${bf.smallSize}`.length)
    .reduce((a, b) => Math.max(a, b), 0);
  const bitlen = (num: number) => `${' '.repeat(maxBitlen - `${num}`.length)}${num}`;
  for (let i = 0; i < bitFields.fields.length; i++) {
    const bf = bitFields.fields[i];
    const label = labelStr.charAt(i);
    for (let b = 0; b < bf.smallSize; b++) {
      bits.unshift(label);
    }
    labels.push(`${prefix}// ${label}[${bitlen(bf.smallSize)}] - ${bf.name || '(reserved)'}${
      (bf.array ? `[${bf.array}]` : '')}`);
  }
  if (bits.length === 16) {
    bits.splice(8, 0, ':');
  } else if (bits.length === 32) {
    bits.splice(24, 0, ':');
    bits.splice(16, 0, ':');
    bits.splice(8, 0, ':');
  }
  out.push(`${prefix}// ${bits.join('')}`);
  for (const lbl of labels) {
    out.push(lbl);
  }
}

function cPrintPad(pad: string) {
  return pad.includes('+')
    ? `p->pad(p->ctx, ${pad});`
    : `if (${pad} > 0) p->pad(p->ctx, ${pad});`;
}

function cPrintStr(str: string) {
  return `p->str(p->ctx, ${cStr(str)});`;
}

function cPrintInt(type: BasicType, val: string) {
  return `p->${type.signed ? 'i' : 'u'}${Math.max(8, nextPowerOf2(type.bits))}(p->ctx, ${val});`;
}

function cPrintNewline() {
  return 'p->newline(p->ctx);'
}

function isParentChildName(parent: string[], child: string[]) {
  if (parent.length + 1 !== child.length) return false;
  for (let i = 0; i < parent.length; i++) {
    if (parent[i] !== child[i]) return false;
  }
  return true;
}

interface CXXMethod {
  isConst: boolean;
  isMut: boolean;
  isPointer: boolean;
  fieldName: string;
  name(): string;
  cppName(): string;
  call(...args: (string | false)[]): string;
  isStruct(name: string[]): boolean;
  isConstFunc(name: string[]): boolean;
  asConst(): CXXMethod;
  asMut(): CXXMethod;
}

class CXXFile {
  includes: Include[];
  file: string;
  cpp: boolean;
  fmt: Formatter;
  defines: [string, string][] = [];
  constValues: {
    type: BasicType;
    name: string[];
  }[] = [];
  enums: {
    type: BasicType;
    name: string[];
    options: { name: string; value: number }[];
  }[] = [];
  structsAndUnions: (
    { kind: 'struct', data: { struct: SymbolNodeStruct; fieldNames: string[] } } |
    { kind: 'union', data: { union: SymbolNodeUnion } }
  )[] = [];
  staticInlines: {
    returnType: string;
    method: CXXMethod;
    args: [string, string][];
    body: string[];
  }[] = [];
  printers: {
    objName: string;
    objType: string;
    body: string[];
  }[] = [];

  constructor(includes: Include[], file: string, cpp: boolean) {
    this.includes = includes;
    this.file = file;
    this.cpp = cpp;
    this.fmt = cpp ? new CPPFormatter() : new CFormatter();
  }

  method(
    method: string,
    structName: string[],
    fieldName: string,
    fieldType: 'f' | 'b' | 'v' | 'x'
  ): CXXMethod {
    // fieldType
    // f - field (will end with '_' for cpp)
    // b - bit field
    // v - union variant
    // x - neither
    const fieldNameTrim = this.cpp && fieldType === 'f'
      ? fieldName.substr(0, fieldName.length - 1) // remove '_'
      : fieldName;
    const makeMethod = (isConst: boolean, isMut: boolean) => {
      const name = () => {
        const methodField = `${method}${fieldNameTrim.charAt(0).toUpperCase()}${
          fieldNameTrim.substr(1)}`;
        const parts = [...structName, methodField];
        if (isConst) parts.push('const');
        if (isMut) parts.push('mut');
        return parts.join('_');
      };
      const cppName = () => {
        if (method === 'get' || method === 'set') {
          return fieldType === 'v'
            ? `${fieldNameTrim.charAt(0).toLowerCase()}${fieldNameTrim.substr(1)}`
            : fieldNameTrim;
        }
        return `${method}${fieldNameTrim.charAt(0).toUpperCase()}${fieldNameTrim.substr(1)}`;
      };
      const call = (...args: (string | false)[]) => {
        return `${name()}(${args.filter(a => !!a).join(', ')})`;
      };
      const isStruct = (name: string[]) => {
        if (name.length !== structName.length) return false;
        for (let i = 0; i < name.length; i++) {
          if (name[i] !== structName[i]) return false;
        }
        return true;
      };
      return {
        isConst,
        isMut,
        isPointer: method === 'first',
        fieldName,
        cppName,
        name,
        call,
        isStruct,
        isConstFunc: () => false,
        asConst: () => makeMethod(true, false),
        asMut: () => makeMethod(false, true),
      };
    };
    return makeMethod(false, false);
  }

  pushStaticInline(
    returnType: string,
    method: CXXMethod,
    args: [string, string][],
    body: string[]
  ) {
    this.staticInlines.push({
      returnType,
      method,
      args,
      body
    });
  }

  pushStaticInlineConstArg(
    returnType: string,
    method: CXXMethod,
    constArg: [string, string],
    restArgs: [string, string][],
    body: string[]
  ) {
    if (!returnType.endsWith('*')) {
      // if the constant function is returning a basic type, then just make the argument constant
      this.pushStaticInline(
        returnType,
        method,
        [[`const ${constArg[0]}`, constArg[1]], ...restArgs],
        body
      );
      return;
    }

    // otherwise, make two versions of the function
    // 1. _const, where params and return type are `const`
    // 2. _mut, where params and return type are mutable
    this.pushStaticInline(
      `const ${returnType}`,
      method.asConst(),
      [[`const ${constArg[0]}`, constArg[1]], ...restArgs],
      body
    );
    const mutArgs = [constArg, ...restArgs];
    this.pushStaticInline(
      returnType,
      method.asMut(),
      mutArgs,
      [`return ${
        this.cpp
        ? `const_cast<${returnType}>`
        : `(${returnType})`}(${
        method.asConst().call(...mutArgs.map(m => m[1].replace(/\*/, '')))});`]
    );

    if (!this.cpp) {
      // use _Generic to select between the two, so if a caller uses a const pointer parameter,
      // they receive a const pointer result
      const args = restArgs.map((_, i) => `a${i + 2}`);
      args.unshift('obj');
      this.defines.push([
        `${method.name()}(${args.join(', ')})`,
        `_Generic((obj), ` +
          `${constArg[0]} *: ${method.asMut().name()}, ` +
          `const ${constArg[0]} *: ${method.asConst().name()}` +
        `)(${args.join(', ')})`
      ]);
    }
  }

  pushPrinter(objName: string, objType: string, body: string[]) {
    this.printers.push({
      objName,
      objType,
      body
    });
  }

  pushConstFunction(cons: SymbolNodeConstFunction) {
    if (!cons.data) {
      throw new Error('Const missing data');
    }
    const walk = (expr: ConstExpr): string => {
      switch (expr.kind) {
        case 'number': return `${expr.value}`;
        case 'unary':
          return `${expr.op}${walk(expr.value)}`;
        case 'binary':
          return `(${walk(expr.left)} ${expr.op} ${walk(expr.right)})`;
        case 'ternary':
          return `(${walk(expr.condition)} ? ${walk(expr.whenTrue)} : ${walk(expr.whenFalse)})`;
        case 'param':
          return this.fmt.name(expr.name);
        case 'symbol':
          return this.fmt.name(expr.sym.name);
        case 'call':
          return `${this.fmt.name(expr.sym.name)}(${expr.args.map(walk).join(', ')})`;
        default:
          assertNever(expr);
      }
    };
    this.pushStaticInline(
      this.fmt.type(cons.data.type, false),
      {
        isConst: false,
        isMut: false,
        isPointer: false,
        fieldName: cons.name[cons.name.length - 1],
        name: () => this.fmt.cName(cons.name),
        cppName: () => this.fmt.cName(cons.name),
        call: () => { throw new Error('Unimplemeneted'); },
        isStruct: () => false,
        isConstFunc: (name: string[]) => {
          if (name.length + 1 !== cons.name.length) return false;
          for (let i = 0; i < name.length; i++) {
            if (name[i] !== cons.name[i]) return false;
          }
          return true;
        },
        asConst: () => { throw new Error('Unimplemented'); },
        asMut: () => { throw new Error('Unimplemented'); },
      },
      cons.data.params.map(({ type, name }) => [this.fmt.type(type, false), this.fmt.name(name)]),
      [
        ...cons.data.params.map(({ name }) => `(void)${this.fmt.name(name)};`),
        `return ${walk(cons.data.expr)};`
      ]
    );
  }

  pushConstValue(cons: SymbolNodeConstValue) {
    if (!cons.data) {
      throw new Error('Const missing data');
    }
    this.defines.push([ this.fmt.cName(cons.name), `${cons.data.value}` ]);
    this.constValues.push({ type: cons.data.type, name: cons.name });
  }

  pushCEnum(type: BasicType, name: string[], options: { name: string; value: number }[]) {
    this.enums.push({ type, name, options });

    if (this.cpp) {
      for (const option of options) {
        this.defines.push([
          this.fmt.cName(name, option.name),
          `${this.fmt.cName(name)}::${option.name}`
        ]);
      }
    }

    this.pushPrinter(
      this.fmt.cName(name),
      this.cpp ? this.fmt.cName(name) : `enum ${this.fmt.cName(name)}`,
      [
        cPrintPad('pad'),
        'switch (obj) {',
        ...options.map(({ name: oname, value }) =>
          `  case ${this.fmt.cName(name, oname)}: ${cPrintStr(oname)} break;`),
        '  default:',
        `    ${cPrintStr(name.join('_') + '<')}`,
        `    ${cPrintInt(type,
          this.cpp
          ? `static_cast<${this.fmt.type(type, false)}>(obj)`
          : 'obj'
        )}`,
        `    ${cPrintStr('>')}`,
        '    break;',
        '}',
      ]
    );
  }

  pushEnum(enu: SymbolNodeEnum) {
    if (!enu.data) {
      throw new Error('Enum missing data');
    }
    this.pushCEnum(enu.data.type, enu.name, enu.data.options);
  }

  pushStructFieldArray(
    structName: string[],
    fieldName: string,
    array: number,
    isBasic: boolean,
    count: string | null,
    getType: string,
    objType: string,
    argObj: [string, string],
    argOut: [string, string],
    argValue: [string, string],
    methodGet: CXXMethod,
    methodSet: CXXMethod,
    isBitField: boolean
  ) {
    const methodMax = this.method('max', structName, fieldName, isBitField ? 'b' : 'f');
    const methodCount = this.method('count', structName, fieldName, isBitField ? 'b' : 'f');
    const methodPop = this.method('pop', structName, fieldName, isBitField ? 'b' : 'f');
    const methodPush = this.method('push', structName, fieldName, isBitField ? 'b' : 'f');
    const methodClear = this.method('clear', structName, fieldName, isBitField ? 'b' : 'f');

    this.pushStaticInline(
      'u32',
      methodMax,
      [],
      [`return ${array};`]
    );

    if (count === null) {
      return;
    }

    const methodGetCount = this.method('get', structName, count, 'x');
    const methodSetCount = this.method('set', structName, count, 'x');

    this.defines.push([methodCount.name(), methodGetCount.name()]);

    if (isBasic) {
      this.pushStaticInline(
        getType,
        methodPop,
        [argObj],
        [
          `u32 index = ${methodGetCount.call('obj')} - 1;`,
          `${getType} value = ${methodGet.call('obj', 'index')};`,
          `${methodSetCount.call('obj', 'index')};`,
          'return value;',
        ]
      );
    } else {
      this.pushStaticInline(
        objType,
        methodPop,
        [argObj, argOut],
        [
          `u32 index = ${methodGetCount.call('obj')} - 1;`,
          `*out = *${methodGet.call('obj', 'index')};`,
          `${methodSetCount.call('obj', 'index')};`,
          'return obj;',
        ]
      );
    }

    this.pushStaticInline(
      'u32',
      methodPush,
      [argObj, argValue],
      [
        `u32 index = ${methodGetCount.call('obj')};`,
        `${methodSet.call('obj', 'index', 'value')};`,
        `${methodSetCount.call('obj', 'index + 1')};`,
        `return index;`,
      ]
    );

    this.pushStaticInline(
      objType,
      methodClear,
      [argObj],
      [`return ${methodSetCount.call('obj', '0')};`]
    );
  }

  pushStructField(struct: SymbolNodeStruct, field: SymbolNodeStructDataField, name: string) {
    if (!struct.data) {
      throw new Error('Struct missing data');
    }

    const utype = underlyingType(field.type);

    function isBasic(type: UnderlyingTypeNode): type is BasicType {
      return type.kind === 'basic';
    }

    const getType = isBasic(utype)
      ? this.fmt.type(field.type, field.start !== null)
      : `${this.fmt.cType(field.type, false)} *`;
    const objType = `${this.fmt.cType(struct, false)} *`;

    type Arg = [string, string];
    const argObj: Arg = [this.fmt.cType(struct, false), '*obj'];
    const argOut: Arg = [`${this.fmt.cType(field.type, false)}`, '*out'];
    const argIndex: Arg = ['u32', 'index'];
    const argBIndex: Arg = ['u32', 'bindex'];
    const argValue: Arg = isBasic(utype)
      ? [getType, 'value']
      : [`const ${this.fmt.cType(field.type, false)}`, '*value'];

    const methodGet = this.method('get', struct.name, name, 'f');
    const methodSet = this.method('set', struct.name, name, 'f');
    const methodFirst = this.method('first', struct.name, name, 'f');
    const methodMax = this.method('max', struct.name, name, 'f');
    const methodCount = this.method('count', struct.name, name, 'f');
    const methodPop = this.method('pop', struct.name, name, 'f');
    const methodPush = this.method('push', struct.name, name, 'f');

    const objIndex = field.array === null ? `obj->${name}` : `obj->${name}[index]`;

    let get: string[], set: string[];
    if (isBasic(utype)) {
      // field is basic/enum
      if (!field.broken) {
        if (this.cpp && field.type.kind === 'enum') {
          get = [`${this.fmt.cType(field.type, false)} result = ${objIndex};`];
        } else {
          get = [`u32 result = (u32)${objIndex};`];
        }
        set = [`${objIndex} = value;`];
      } else {
        const k = (index: number) => `obj->${name}[${field.array === null ? '' : 'k + '}${index}]`
        const bits = field.size / (field.array ? field.array : 1);
        if (bits === 16) {
          const signed = utype.signed;
          get = [
            `${signed ? 'i' : 'u'}32 result = (`,
            `  (((u32)${k(1)}) << 8) | `,
            `  ((u32)${k(0)})`,
            ');',
          ];
          if (signed) {
            get.push('result = ((i32)(((u32)result) << 16)) >> 16;');
          }

          set = [
            `${k(0)} = (((u32)value) << 24) >> 24;`,
            `${k(1)} = (((u32)value) << 16) >> 24;`,
          ];
        } else if (bits === 32) {
          get = [
            'u32 result = (',
            `  (((u32)${k(3)}) << 24) | `,
            `  (((u32)${k(2)}) << 16) | `,
            `  (((u32)${k(1)}) << 8) | `,
            `  ((u32)${k(0)})`,
            ');',
          ];
          set = [
            `${k(0)} = (((u32)value) << 24) >> 24;`,
            `${k(1)} = (((u32)value) << 16) >> 24;`,
            `${k(2)} = (((u32)value) << 8) >> 24;`,
            `${k(3)} = (((u32)value) << 0) >> 24;`,
          ];
        } else {
          throw new Error('Unknown field size on broken field');
        }
        if (field.array) {
          const kv = `u32 k = index * ${bits / 8};`
          get.unshift(kv);
          set.unshift(kv);
        }
      }

      if (field.start !== null) {
        get.push(`result = ${applyGetStart('result', field.start)};`);
        set.unshift(`value = ${applySetStart('value', field.start)};`);
      }
      get.push('return result;');
      set.push('return obj;');
    } else {
      // field is struct/union
      get = [`return &${objIndex};`];
      set = [
        `${objIndex} = *value;`,
        'return obj;',
      ];
    }

    this.pushStaticInlineConstArg(
      getType,
      methodGet,
      argObj,
      field.array === null ? [] : [argIndex],
      get
    );
    this.pushStaticInline(
      objType,
      methodSet,
      field.array === null ? [argObj, argValue] : [argObj, argIndex, argValue],
      set
    );

    if (field.array !== null) {
      this.pushStaticInlineConstArg(
        this.cpp
        ? `${this.fmt.type(field.type, false)} *`
        : `${this.fmt.type(underlyingType(field.type), false)} *`,
        methodFirst,
        argObj,
        [],
        [`return &obj->${name}[0];`]
      );
      this.pushStructFieldArray(
        struct.name,
        name,
        field.array,
        isBasic(utype),
        field.count,
        getType,
        objType,
        argObj,
        argOut,
        argValue,
        methodGet,
        methodSet,
        false
      );
    }

    if (field.bitFields) {
      if (!isBasic(utype)) {
        throw new Error('Cannot have bitFields on struct/union');
      }
      for (const bf of field.bitFields.fields) {
        if (!bf.name) continue;

        if (bf.type.kind !== 'basic' && bf.type.kind !== 'enum') {
          throw new Error("BitField type isn't basic");
        }
        const signed = bf.type.kind === 'basic' ? bf.type.signed : false;

        const methodFGet = this.method('fget', struct.name, bf.name, 'b');
        const methodFSet = this.method('fset', struct.name, bf.name, 'b');
        const methodBGet = this.method('get', struct.name, bf.name, 'b');
        const methodBSet = this.method('set', struct.name, bf.name, 'b');
        const methodBMax = this.method('max', struct.name, bf.name, 'b');
        const methodBCount = this.method('count', struct.name, bf.name, 'b');
        const methodBPop = this.method('pop', struct.name, bf.name, 'b');
        const methodBPush = this.method('push', struct.name, bf.name, 'b');

        const argData: Arg = [this.fmt.type(field.type, false), 'data'];
        const argValue: Arg = [this.fmt.containerType(bf.type, bf.start !== null), 'value'];
        const paramObj = field.array === null ? 'obj' : 'obj, index';

        const getType = this.fmt.containerType(bf.type, bf.start !== null);

        this.pushStaticInline(
          this.fmt.containerType(bf.type, false),
          methodFGet,
          bf.array === null
          ? [argData]
          : [argData, argBIndex],
          cGetBitField(bf, signed, 'data', bf.array ? 'bindex' : null, this.cpp)
        );
        this.pushStaticInline(
          this.fmt.type(field.type, false),
          methodFSet,
          bf.array === null
          ? [argData, argValue]
          : [argData, argBIndex, argValue],
          cSetBitField(bf, `data`, bf.array ? 'bindex' : null, 'value')
        );

        const bfIndex = bf.array === null ? false : 'bindex';
        this.pushStaticInlineConstArg(
          getType,
          methodBGet,
          argObj,
          bf.array === null
          ? (field.array === null ? [] : [argIndex])
          : (field.array === null ? [argBIndex] : [argIndex, argBIndex]),
          [`return ${methodFGet.call(false, methodGet.call(paramObj), bfIndex)};`],
        );
        this.pushStaticInline(
          objType,
          methodBSet,
          bf.array === null
          ? (field.array === null
            ? [argObj, argValue]
            : [argObj, argIndex, argValue])
          : (field.array === null
            ? [argObj, argBIndex, argValue]
            : [argObj, argIndex, argBIndex, argValue]),
          [`return ${methodSet.call(
              paramObj,
              methodFSet.call(false, methodGet.call(paramObj), bfIndex, 'value')
            )};`]
        );

        if (bf.array !== null) {
          this.pushStructFieldArray(
            struct.name,
            bf.name,
            bf.array,
            true,
            bf.count,
            getType,
            objType,
            argObj,
            ['', ''],
            argValue,
            methodBGet,
            methodBSet,
            true
          );
        }
      }
    }
  }

  pushPrinterArray(
    tab: string,
    printer: string[],
    name: string,
    array: number,
    count: CXXMethod | null,
    type: TypeNode,
    upgrade: boolean,
    methodGet: string,
    i: string
  ) {
    printer.push(tab + cPrintPad('pad + 2'));
    printer.push(tab + cPrintStr(`${name}: [`));
    printer.push(tab + cPrintNewline());

    const countExpr = count ? count.call('obj') : `${array}`;

    printer.push(tab + `for (u32 ${i} = 0, ${i}Max = ${countExpr}; ${i} < ${i}Max; ${i}++) {`);
    printer.push(tab + `  ${cPrintPad('pad + 4')}`);
    printer.push(tab + `  ${this.fmt.printValue(type, methodGet, 'pad + 4', upgrade)}`);
    printer.push(tab + `  ${cPrintNewline()}`);
    printer.push(tab + '}');

    printer.push(tab + cPrintPad('pad + 2'));
    printer.push(tab + cPrintStr(']'));
    printer.push(tab + cPrintNewline());
  }

  pushStruct(struct: SymbolNodeStruct) {
    if (!struct.data) {
      throw new Error('Struct missing data');
    }
    const fieldNames: string[] = [];
    let reserved = 1;
    for (let { name } of struct.data.fields) {
      if (!name) {
        do {
          name = `reserved${reserved++}`;
        } while (struct.data.fields.some(
          f => f.name === name || f.bitFields?.fields.some(b => b.name === name)
        ));
      }
      fieldNames.push(this.cpp ? `${name}_` : name);
    }

    this.structsAndUnions.push({ kind: 'struct', data: { struct, fieldNames } });

    for (let i = 0; i < struct.data.fields.length; i++) {
      this.pushStructField(struct, struct.data.fields[i], fieldNames[i]);
    }

    const printer: string[] = [
      cPrintPad('pad'),
      cPrintStr(`${this.fmt.name(struct.name)} {`),
      cPrintNewline(),
    ];

    for (const field of struct.data.fields) {
      if (field.bitFields === null) {
        if (!field.name) continue;

        const methodGet = this.method('get', struct.name, field.name, 'x');

        if (field.array === null) {
          printer.push(cPrintPad('pad + 2'));
          const space = field.type.kind === 'basic' || field.type.kind === 'enum' ? ' ' : '';
          printer.push(cPrintStr(`${field.name}:${space}`));

          const value =
            (field.type.kind === 'struct' || field.type.kind === 'union'
              ? methodGet.asConst()
              : methodGet
            ).call('obj');
          if (field.type.kind === 'basic') {
            printer.push(this.fmt.printValue(field.type, value, 'pad + 2', field.start !== null));
            printer.push(cPrintNewline());
          } else if (field.type.kind === 'enum') {
            printer.push(this.fmt.printValue(field.type, value, '0', false));
            printer.push(cPrintNewline());
          } else {
            printer.push(cPrintNewline());
            printer.push(this.fmt.printValue(field.type, value, 'pad + 4', false));
            printer.push(cPrintNewline());
          }
        } else {
          this.pushPrinterArray(
            '',
            printer,
            field.name,
            field.array,
            field.count ? this.method('count', struct.name, field.name, 'x') : null,
            field.type,
            field.start !== null,
            methodGet.call('obj', 'index'),
            'index'
          );
        }
      } else if (field.array === null) {
        for (const bf of field.bitFields.fields) {
          if (!bf.name) continue;

          const methodGet = this.method('get', struct.name, bf.name, 'b');

          if (bf.array === null) {
            const value = methodGet.call('obj');
            printer.push(cPrintPad('pad + 2'));
            printer.push(cPrintStr(`${bf.name}: `));
            printer.push(this.fmt.printValue(bf.type, value, 'pad + 2', bf.start !== null));
            printer.push(cPrintNewline());
          } else {
            this.pushPrinterArray(
              '',
              printer,
              bf.name,
              bf.array,
              bf.count ? this.method('count', struct.name, bf.name, 'b') : null,
              bf.type,
              bf.start !== null,
              methodGet.call('obj', 'bindex'),
              'bindex'
            );
          }
        }
      } else {
        // array + bitfield
        printer.push(cPrintPad('pad + 2'));
        printer.push(cPrintStr(`${field.name}: [`));
        printer.push(cPrintNewline());

        const countExpr = field.count ? `${field.count}(obj)` : `${field.array}`;

        printer.push('pad += 2;');
        printer.push(`for (u32 index = 0, indexMax = ${countExpr}; index < indexMax; index++) {`);
        const tab = '  ';
        for (const bf of field.bitFields.fields) {
          if (!bf.name) continue;

          const methodGet = this.method('get', struct.name, bf.name, 'b');

          if (bf.array === null) {
            const value = methodGet.call('obj', 'index');
            printer.push(tab + cPrintPad('pad + 2'));
            printer.push(tab + cPrintStr(`${bf.name}: `));
            printer.push(tab + this.fmt.printValue(bf.type, value, 'pad + 2', bf.start !== null));
            printer.push(tab + cPrintNewline());
          } else {
            this.pushPrinterArray(
              tab,
              printer,
              bf.name,
              bf.array,
              bf.count ? this.method('count', struct.name, bf.name, 'b') : null,
              bf.type,
              bf.start !== null,
              methodGet.call('obj', 'index', 'bindex'),
              'bindex'
            );
          }
        }
        printer.push('}');
        printer.push('pad -= 2;');

        printer.push(cPrintPad('pad + 2'));
        printer.push(cPrintStr(']'));
        printer.push(cPrintNewline());
      }
    }

    printer.push(cPrintPad('pad'));
    printer.push(cPrintStr('}'));

    this.pushPrinter(this.fmt.cName(struct.name), `${this.fmt.cType(struct, false)} *`, printer);
  }

  pushUnion(union: SymbolNodeUnion) {
    if (!union.data) {
      throw new Error('Union missing data');
    }

    this.structsAndUnions.push({ kind: 'union', data: { union } });

    this.pushCEnum(
      union.data.tagType,
      ['Tag', ...union.name],
      union.data.variants.map(v => ({ name: v.name, value: v.tag }))
    );

    this.pushStaticInline(
      this.fmt.tagType(union),
      this.method('tag', union.name, 'of', 'x'),
      [[`const struct ${this.fmt.cName(union.name)}`, '*obj']],
      [`return (${this.fmt.tagType(union)})obj->tag;`,]
    );

    for (const variant of union.data.variants) {
      const fullTagName = this.fmt.cName(this.fmt.tagName(union), variant.name);
      this.pushStaticInline(
        'bool',
        this.method('is', union.name, variant.name, 'v'),
        [[`const struct ${this.fmt.cName(union.name)}`, '*obj']],
        [`return obj->tag == ${fullTagName};`]
      );
      if (variant.struct) {
        this.pushStaticInlineConstArg(
          `${this.fmt.cType(variant.struct, false)} *`,
          this.method('get', union.name, variant.name, 'v'),
          [`struct ${this.fmt.cName(union.name)}`, '*obj'],
          [],
          [`return &obj->u.${variant.name};`],
        );
        this.pushStaticInline(
          `struct ${this.fmt.cName(union.name)} *`,
          this.method('set', union.name, variant.name, 'v'),
          [
            [`struct ${this.fmt.cName(union.name)}`, '*obj'],
            [`const ${this.fmt.cType(variant.struct, false)}`, '*value'],
          ],
          [
            `obj->tag = ${this.fmt.cName(this.fmt.tagName(union), variant.name)};`,
            `obj->u.${variant.name} = *value;`,
            'return obj;',
          ]
        );
      } else {
        this.pushStaticInline(
          `struct ${this.fmt.cName(union.name)} *`,
          this.method('set', union.name, variant.name, 'v'),
          [[`struct ${this.fmt.cName(union.name)}`, '*obj']],
          [
            `obj->tag = ${this.fmt.cName(this.fmt.tagName(union), variant.name)};`,
            'return obj;',
          ]
        );
      }
    }

    const printer: string[] = [
      cPrintPad('pad'),
      cPrintStr(`${this.fmt.name(union.name)} {`),
      cPrintNewline(),
      cPrintPad('pad + 2'),
      `switch (${this.method('tag', union.name, 'of', 'x').call('obj')}) {`,
    ];

    for (const variant of union.data.variants) {
      printer.push(`  case ${this.fmt.cName(this.fmt.tagName(union), variant.name)}:`);
      if (variant.struct) {
        printer.push(
          `    ${this.fmt.cName(variant.struct.name)}_printPad(` +
          `${this.method('get', union.name, variant.name, 'v').asConst().call('obj')}, pad + 4);`
        );
      } else {
        printer.push(`    ${cPrintStr(variant.name)}`);
      }
      printer.push('    break;');
    }
    printer.push('  default:');
    printer.push(`    ${this.fmt.tagName(union)}_printPad(${
      this.method('tag', union.name, 'of', 'x').call('obj')}, 0);`);
    printer.push('    break;');
    printer.push('}');
    printer.push(cPrintNewline());
    printer.push(cPrintPad('pad'));
    printer.push(cPrintStr('}'));

    this.pushPrinter(this.fmt.cName(union.name), `${this.fmt.cType(union, false)} *`, printer);
  }

  output(): [string, string] {
    const h: string[] = [
      '#pragma once',
      `#include "${LIB}.${this.cpp ? 'hpp' : 'h'}"`,
    ];
    const c: string[] = [
      `#include "${replaceExt(path.basename(this.file), this.cpp ? 'hpp' : 'h')}"`
    ];
    for (const include of this.includes) {
      h.push(`#include "${replaceExt(include.file, this.cpp ? 'hpp' : 'h')}"`);
    }

    if (this.defines.length > 0) h.push('');
    for (const define of this.defines) {
      h.push(`#define ${define[0]} ${define[1]}`);
    }

    if (this.enums.length > 0) h.push('');
    for (const enu of this.enums) {
      if (this.cpp) {
        h.push(`enum class ${this.fmt.cName(enu.name)} : ${this.fmt.containerType(enu.type, false)} {`);
      } else {
        h.push(`enum ${this.fmt.cName(enu.name)} {`);
      }
      for (let i = 0; i < enu.options.length; i++) {
        const option = enu.options[i];
        const comma = i < enu.options.length - 1 ? ',' : '';
        h.push(`  ${this.cpp ? option.name : this.fmt.name(enu.name, option.name)} = ${
          option.value}${comma}`);
      }
      h.push('};');
    }

    if (this.structsAndUnions.length > 0) h.push('');
    for (const { kind, data } of this.structsAndUnions) {
      if (kind === 'struct') {
        h.push(`struct ${this.fmt.cName(data.struct.name)};`);
      } else { // union
        h.push(`struct ${this.fmt.cName(data.union.name)};`);
      }
    }

    if (this.staticInlines.length > 0) h.push('');
    for (let { returnType, method, args } of this.staticInlines) {
      if (!returnType.endsWith('*')) returnType += ' ';
      h.push(`STATIC_INLINE ${returnType}${method.name()}(${
        args.map(arg => arg.join(' ')).join(', ') || 'void'
      });`);
    }

    if (this.printers.length > 0) {
      h.push('');
      h.push('#ifdef TYPELIB_PRINT');
    }
    for (const { objName, objType } of this.printers) {
      h.push(`void ${objName}_printPad(` +
        `const ${objType}${objType.endsWith('*') ? '' : ' '}obj, int pad);`);
      h.push(`STATIC_INLINE void ${objName}_print(` +
        `const ${objType}${objType.endsWith('*') ? '' : ' '}obj) {`);
      h.push(`  const struct TypeLibPrinter *p = TYPELIB_GET_PRINTER;`);
      h.push(`  ${objName}_printPad(obj, 0);`);
      h.push(`  ${cPrintNewline()}`);
      h.push('}');
    }
    if (this.printers.length > 0) {
      h.push('#else');
    }
    for (const { objName, objType } of this.printers) {
      h.push(`#define ${objName}_printPad(a, b)`);
      h.push(`#define ${objName}_print(a)`);
    }
    if (this.printers.length > 0) {
      h.push('#endif');
    }

    if (this.printers.length > 0) {
      c.push('');
      c.push('#ifdef TYPELIB_PRINT');
    }
    for (const { objName, objType, body } of this.printers) {
      c.push(`void ${objName}_printPad(` +
        `const ${objType}${objType.endsWith('*') ? '' : ' '}obj, int pad) {`);
      c.push(`  const struct TypeLibPrinter *p = TYPELIB_GET_PRINTER;`);
      for (const line of body) {
        c.push(`  ${line}`);
      }
      c.push('}');
    }
    if (this.printers.length > 0) {
      c.push('#endif');
    }

    for (const { kind, data } of this.structsAndUnions) {
      h.push('');
      let name: string[] = [];
      let align = 1;
      if (kind === 'struct') {
        const { struct, fieldNames } = data;
        if (!struct.data) {
          throw new Error('Missing struct data');
        }
        name = struct.name;
        align = struct.data.align / 8;
        h.push(`struct ${this.cpp ? `alignas(${align}) ` : ''}${this.fmt.cName(struct.name)} {`);

        if (this.cpp) {
          let hadChild = false;
          const checkChild = (name: string[]) => {
            if (isParentChildName(struct.name, name)) {
              h.push(`  using ${name[name.length - 1]} = ${this.fmt.cName(name)};`);
              hadChild = true;
            }
          };
          for (const { name } of this.enums) {
            checkChild(name);
          }
          for (const child of this.structsAndUnions) {
            checkChild(child.kind === 'struct' ? child.data.struct.name : child.data.union.name);
          }
          for (const { type, name } of this.constValues) {
            if (isParentChildName(struct.name, name)) {
              h.push(`  static constexpr ${this.fmt.type(type, false)} ${
                name[name.length - 1]} = ${this.fmt.cName(name)};`);
              hadChild = true;
            }
          }
          if (hadChild && struct.data.fields.length > 0) h.push('');
        }

        for (let i = 0; i < struct.data.fields.length; i++) {
          const field = struct.data.fields[i];
          const name = fieldNames[i];
          const baseType = this.cpp ? field.type : underlyingType(field.type);
          if (baseType.kind === 'basic' && field.broken) {
            let parts = baseType.bits / 8;
            if (parts === 2 || parts === 4) {
              h.push(`  u8 ${name}[${parts * (field.array ? field.array : 1)}];`);
            } else {
              throw new Error(`Unexpected broken base type bits: ${baseType.bits}`);
            }
          } else {
            h.push(`  ${this.fmt.cType(baseType, false)} ${name}${
              field.array ? `[${field.array}]` : ''};`);
          }
          pushCommentBitFields(h, '  ', field.bitFields);
        }
      } else { // union
        const { union } = data;
        if (!union.data) {
          throw new Error('Union data missing');
        }
        name = union.name;
        align = union.data.align / 8;
        h.push(`struct ${this.cpp ? `alignas(${align}) ` : ''}${this.fmt.cName(union.name)} {`);
        if (this.cpp) {
          const checkChild = (name: string[]) => {
            if (isParentChildName(union.name, name)) {
              h.push(`  using ${name[name.length - 1]} = ${this.fmt.cName(name)};`);
            }
          };
          for (const { name } of this.enums) {
            checkChild(name);
          }
          for (const child of this.structsAndUnions) {
            checkChild(child.kind === 'struct' ? child.data.struct.name : child.data.union.name);
          }
          for (const { type, name } of this.constValues) {
            if (isParentChildName(union.name, name)) {
              h.push(`  static constexpr ${this.fmt.type(type, false)} ${
                name[name.length - 1]} = ${this.fmt.cName(name)};`);
            }
          }
          h.push(`  using Tag = ${this.fmt.cName('Tag', ...union.name)};`);
          h.push('');
          h.push(`  Tag tag;`);
        } else {
          h.push(`  ${this.fmt.cType(union.data.tagType, false)} tag;`);
        }
        if (union.data.size > union.data.tagType.bits) {
          // find unique name for payload
          let payloadName = 'payload';
          for (let i = 2;; i++) {
            if (!union.data.variants.some(v => v.name === payloadName)) {
              break;
            }
            payloadName = `payload${i}`;
          }
          h.push(`  union {`);
          h.push(
            `    ${this.fmt.cType(union.data.tagType, false)} ${payloadName}[` +
            `${(union.data.size - union.data.tagType.bits) / union.data.align}];`
          );
          for (const variant of union.data.variants) {
            if (variant.struct) {
              h.push(`    ${this.fmt.cType(variant.struct, false)} ${variant.name};`);
            } else {
              h.push(`    // ${variant.name} (empty)`);
            }
          }
          h.push(`  } u;`);
        }
      }

      if (this.cpp) {
        for (let { returnType, method, args } of this.staticInlines) {
          if (!method.isConstFunc(name)) continue;
          h.push('');
          h.push(`  static ${returnType} ${method.fieldName}(${
            args.map(arg => arg.join(' ')).join(', ')}) {`);
          h.push(`    return ${method.name()}(${args.map(arg => arg[1]).join(', ')});`);
          h.push('  }');
        }
        for (let { returnType, method, args } of this.staticInlines) {
          if (!method.isStruct(name)) continue;
          let star = '';
          if (!method.isPointer && returnType.endsWith('*')) {
            star = '*';
            returnType = `${returnType.substr(0, returnType.length - 1)}&`;
          } else if (!returnType.endsWith('*')) {
            returnType += ' ';
          }
          h.push('');
          const isStatic = args.length === 0 || args[0][1] === 'data';
          const staticArgs = isStatic ? args : args.slice(1);
          h.push(`  ${isStatic ? 'static ' : ''}${returnType}${method.cppName()}(${
              staticArgs.map(arg => arg.join(' ')).join(', ')
            }) ${method.isConst || args[0]?.[0].startsWith('const') ? 'const ' : ''}{`);
          h.push(`    return ${star}${
              method.call(
                isStatic ? false : 'this',
                ...staticArgs.map(m => m[1].replace(/\*/g, ''))
              )
            };`);
          h.push(`  }`);
        }
        h.push('');
        h.push('  void print() const {');
        h.push(`    ${this.fmt.cName(name)}_print(this);`);
        h.push('  }');
      }

      h.push(`}${this.cpp ? '' : ` STRUCT_ATTRIBUTE_ALIGN(${align})`};`);
    }

    if (this.staticInlines.length > 0) h.push('');
    for (let { returnType, method, args, body } of this.staticInlines) {
      if (!returnType.endsWith('*')) returnType += ' ';
      h.push(`STATIC_INLINE ${returnType}${method.name()}(${
        args.map(arg => arg.join(' ')).join(', ') || 'void'
      }) {`);
      for (const line of body) {
        h.push(`  ${line}`);
      }
      h.push('}');
    }

    h.push('');
    c.push('');
    return [h.join('\n'), c.join('\n')];
  }
}

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// generator
//

async function generate(
  cwd: string,
  inputFile: string
): Promise<{ h: string; c: string; hpp: string; cpp: string } | { errors: string[] }> {
  if (path.basename(inputFile).toLowerCase() === `${LIB}.type`.toLowerCase()) {
    return { errors: [`Fatal Error: Reserved filename: ${inputFile}`] };
  }
  const errors: string[] = [];
  const ctx: Context = {
    error: ({ err, loc }) => {
      if (loc) {
        errors.push(`${loc.file}:${loc.line}:${loc.chr}: ${err}`);
      } else {
        errors.push(`${err}`);
      }
      return null;
    }
  };
  const builder = new Builder();
  const buildResult = await builder.processFile(cwd, inputFile, ctx);
  if ('errors' in buildResult) {
    return { errors };
  }
  const { result: { fullFile, includes } } = buildResult;
  const cFile = new CXXFile(includes, fullFile, false);
  const cppFile = new CXXFile(includes, fullFile, true);
  const ir = new Emitter(fullFile, cFile, cppFile);
  ir.emitSymbols(builder.symbols);
  const [h, c] = cFile.output();
  const [hpp, cpp] = cppFile.output();
  return { h, c, hpp, cpp };
}

const libH = `#pragma once
#include <stdint.h>
#include <stdbool.h>

#ifndef INLINE
#define INLINE inline __attribute__((always_inline))
#endif

#ifndef STATIC_INLINE
#define STATIC_INLINE static INLINE
#endif

#ifndef STRUCT_ATTRIBUTE_ALIGN
#define STRUCT_ATTRIBUTE_ALIGN(n) __attribute__((aligned(n)))
#endif

typedef uint8_t  u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int8_t   i8;
typedef int16_t  i16;
typedef int32_t  i32;

#ifdef TYPELIB_PRINT
struct TypeLibPrinter {
  void *ctx;
  void (*pad)(void *ctx, int count);
  void (*str)(void *ctx, const char *s);
  void (*i8)(void *ctx, i8 v);
  void (*u8)(void *ctx, u8 v);
  void (*i16)(void *ctx, i16 v);
  void (*u16)(void *ctx, u16 v);
  void (*i32)(void *ctx, i32 v);
  void (*u32)(void *ctx, u32 v);
  void (*newline)(void *ctx);
};
#ifndef TYPELIB_GET_PRINTER
#define TYPELIB_GET_PRINTER typelib_printer
extern const struct TypeLibPrinter *typelib_printer;
#endif
#endif
`;

const libCXX = `#include <stdio.h>

static void print_pad(void *ctx, int count) {
  (void)ctx;
  while (count-- > 0) {
    printf(" ");
  }
}

static void print_str(void *ctx, const char *s) {
  (void)ctx;
  printf("%s", s);
}

static void print_i8(void *ctx, i8 v) {
  (void)ctx;
  if (v < 0) {
    printf("-0x%02x", (u32)(-(i32)v));
  } else {
    printf("0x%02x", (u32)v);
  }
}

static void print_u8(void *ctx, u8 v) {
  (void)ctx;
  printf("0x%02x", v);
}

static void print_i16(void *ctx, i16 v) {
  (void)ctx;
  if (v < 0) {
    printf("-0x%04x", (u32)(-(i32)v));
  } else {
    printf("0x%04x", (u32)v);
  }
}

static void print_u16(void *ctx, u16 v) {
  (void)ctx;
  printf("0x%04x", v);
}

static void print_i32(void *ctx, i32 v) {
  (void)ctx;
  if (v < 0) {
    // avoid overflow for INT32_MIN
    u32 mag = (u32)(-(v + 1)) + 1;
    printf("-0x%08x", mag);
  } else {
    printf("0x%08x", (u32)v);
  }
}

static void print_u32(void *ctx, u32 v) {
  (void)ctx;
  printf("0x%08x", v);
}

static void print_newline(void *ctx) {
  (void)ctx;
  printf("\\n");
}

static const struct TypeLibPrinter printer = {
  .ctx = 0,
  .pad = print_pad,
  .str = print_str,
  .i8 = print_i8,
  .u8 = print_u8,
  .i16 = print_i16,
  .u16 = print_u16,
  .i32 = print_i32,
  .u32 = print_u32,
  .newline = print_newline
};
`;

const libC = `#include "${LIB}.h"

#if defined(TYPELIB_PRINT) && defined(TYPELIB_PRINTER_STDIO)
${libCXX}
const struct TypeLibPrinter *typelib_printer = &printer;
#endif
`;

const libHPP = `#pragma once
#include <stdint.h>

#ifndef INLINE
#define INLINE inline __attribute__((always_inline))
#endif

#ifndef STATIC_INLINE
#define STATIC_INLINE static INLINE
#endif

typedef uint8_t  u8;
typedef uint16_t u16;
typedef uint32_t u32;
typedef int8_t   i8;
typedef int16_t  i16;
typedef int32_t  i32;

#ifdef TYPELIB_PRINT
struct TypeLibPrinter {
  void *ctx;
  void (*pad)(void *ctx, int count);
  void (*str)(void *ctx, const char *s);
  void (*i8)(void *ctx, i8 v);
  void (*u8)(void *ctx, u8 v);
  void (*i16)(void *ctx, i16 v);
  void (*u16)(void *ctx, u16 v);
  void (*i32)(void *ctx, i32 v);
  void (*u32)(void *ctx, u32 v);
  void (*newline)(void *ctx);
};
#ifndef TYPELIB_GET_PRINTER
#define TYPELIB_GET_PRINTER typelib_printer
extern "C" const struct TypeLibPrinter *typelib_printer;
#endif
#endif
`;

const libCPP = `#include "${LIB}.hpp"

#if defined(TYPELIB_PRINT) && defined(TYPELIB_PRINTER_STDIO)
${libCXX}
const struct TypeLibPrinter *typelib_printer = &printer;
#endif
`;

//////////////////////////////////////////////////////////////////////////////////////////////////
//
// main
//

function printUsage() {
  console.log(
    'Usage: node typelib.ts [-i <in.type> -o <out.ext>] [-s <out.ext>] [-x]\n' +
    '\n' +
    '-i <in.type>    Process <in.type> as input\n' +
    '\n' +
    '-o <out.ext>    Output results from previous input\n' +
    '\n' +
    '                Generates output based on output file extension:\n' +
    '                  .h    C header file\n' +
    '                  .c    C source file\n' +
    '                  .hpp  C++ header file\n' +
    '                  .cpp  C++ source file\n' +
    '\n' +
    '-s <out.ext>    Output standard library to file (required for runtime)\n' +
    `                Output file must be named ${LIB}.ext, with a valid\n` +
    `                extension (${LIB}.h, ${LIB}.c, etc)\n` +
    '\n' +
    '-x              Debug mode; output results to stdout'
  );
}

async function main(cwd: string, args: string[]) {
  if (args.length <= 0) {
    printUsage();
    return 0;
  }

  const jobs: { input: string; output: string[] }[] = [];
  const libs: string[] = [];
  let debugMode = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i') {
      i++;
      if (i < args.length) {
        jobs.push({ input: args[i], output: [] });
      } else {
        printUsage();
        console.error('\nMissing input file after -i');
        return 1;
      }
    } else if (args[i] === '-o') {
      i++;
      if (i < args.length) {
        if (jobs.length > 0) {
          if (!validExt(args[i])) {
            console.error(`\nInvalid output file extension: ${args[i]}`);
            return 1;
          }
          jobs[jobs.length - 1].output.push(args[i]);
        } else {
          printUsage();
          console.error('\nCannot output without specifying input first');
          return 1;
        }
      } else {
        printUsage();
        console.error('\nMissing output file after -o');
        return 1;
      }
    } else if (args[i] === '-s') {
      i++;
      if (i < args.length) {
        if (!validExt(args[i])) {
          printUsage();
          console.error(`\nInvalid standard library output file extension: ${args[i]}`);
          return 1;
        }
        if (path.basename(args[i]).replace(/\.[^.]+/g, '') !== LIB) {
          printUsage();
          console.error(`\nInvalid standard library filename: ${args[i]}\n` +
            `The filename must be: ${LIB}${args[i].replace(/^.*(\.[^.]+)$/, '$1')}`);
          return 1;
        }
        libs.push(args[i]);
      } else {
        printUsage();
        console.error('\nMissing standard library output file after -s');
        return 1;
      }
    } else if (args[i] === '-x') {
      debugMode = true;
    } else {
      printUsage();
      console.error(`\nInvalid option: ${args[i]}`);
      return 1;
    }
  }

  type Write = { hint: string; file: string; data: string };
  const writes: Write[]  = [];
  const addWrites = (hint: string, ext: string, data: string, files: string[]) => {
    for (const file of files.filter(f => f.endsWith(ext))) {
      writes.push({ hint, file, data });
    }
  };

  for (const { input, output } of jobs) {
    const result = await generate(cwd, input);
    if ('errors' in result) {
      for (const err of result.errors) {
        console.error(err);
      }
      return 1;
    } else {
      const hint = path.basename(input);
      addWrites(`${hint} (H file)`, '.h', result.h, output);
      addWrites(`${hint} (C file)`, '.c', result.c, output);
      addWrites(`${hint} (HPP file)`, '.hpp', result.hpp, output);
      addWrites(`${hint} (CPP file)`, '.cpp', result.cpp, output);
      // TODO: js file
    }
  }

  const hint = 'Standard library';
  addWrites(hint, '.h', libH, libs);
  addWrites(hint, '.c', libC, libs);
  addWrites(hint, '.hpp', libHPP, libs);
  addWrites(hint, '.cpp', libCPP, libs);

  const writeFile = async ({ hint, file, data }: Write) => {
    if (debugMode) {
      console.log(`/**** ${hint} ****/\n\n${data}`);
      return;
    }
    await fs.writeFile(file, data);
    console.log(`${hint}:`, file);
  };
  for (const write of writes) {
    await writeFile(write);
  }

  return 0;
}

await main(process.cwd(), process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    console.error(err);
    throw err;
  }
);
