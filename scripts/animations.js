// SPDX-License-Identifier: 0BSD
import { pathToFileURL } from 'node:url';
import path from 'path';
import fs from 'fs';

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error(
    `This script is intended to be used as a library.\n\n` +
    `Instead of running it directly, a separate data/animations.js file should\n` +
    `import it, and use the API to define all animations.\n\n` +
    `Then, running data/animations.js will generate the HPP/CPP files from the\n` +
    `definitions.`
  );
  process.exit(1);
}

const bodyStack = [];
const animations = [];
const spritesheets = [];
const jumpAnimations = [];
const handlers = [];
let calledDefine = false;
let insideDefine = false;
let insideAnimation = false;
let insideRepeat = false;
const DEFINE_ERROR = 'All animations must exist inside a single define(() => { ... })';

class AnimationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnimationError';
    Error.captureStackTrace(this, AnimationError);
    this.stack = this.stack
      .split('\n')
      .filter((line, i) => i === 0 || !line.includes('/scripts/animations.js'))
      .join('\n');
  }
}

function push(obj) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (bodyStack.length <= 0) {
    throw new AnimationError('Statement must be inside an animation("name", () => { ... })');
  }
  bodyStack[0].push(obj);
}

function validSymbol(symbol) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(symbol);
}

const isTrue = Symbol('isTrue');
const isFalse = { not: isTrue };
const isClone = Symbol('isClone');
const isVisible = Symbol('isVisible');
const isWorldSpace = Symbol('isWorldSpace');
const isGravityAxisX = Symbol('isGravityAxisX');
const isRotated = Symbol('isRotated');
const isFireResult = Symbol('isFireResult');

function validateCondition(condition) {
  let c = condition;
  if (c && typeof c === 'object' && 'not' in c) {
    c = c.not;
  }
  if (
    c !== isTrue &&
    c !== isClone &&
    c !== isVisible &&
    c !== isWorldSpace &&
    c !== isGravityAxisX &&
    c !== isRotated &&
    c !== isFireResult &&
    !(c && typeof c === 'object' && 'random' in c)
  ) {
    throw new AnimationError('Invalid condition; expecting isTrue, isFalse, isClone, isVisible, ' +
      'isWorldSpace, isGravityAxisX, isRotated, isFireResult, or isRandom(odds)');
  }
}

function start() {
  const args = process.argv.splice(2);
  let outputHPP = null;
  let outputCPP = null;
  let verbose = false;

  const usage = (err) => {
    const input = process.argv[1];
    const script = path.join(path.basename(path.dirname(input)), path.basename(input));
    console.log(
      `node ${script} -o <output.hpp> -o <output.cpp>\n\n` +
      `Generates animation code from definitions in input script.\n\n` +
      `-o <output.hpp>   The output HPP file\n` +
      `-o <output.cpp>   The output CPP file\n` +
      `-v                Verbose mode`
    );
    if (err) {
      console.error(`\nError: %s`, err);
    }
    process.exit(err ? 1 : 0);
  };

  if (args.length <= 0) {
    usage();
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
      i++;
      if (i >= args.length) {
        usage('Missing output file after -o');
      }
      const ext = path.extname(args[i]);
      if (ext === '.hpp') {
        if (outputHPP) {
          usage('Cannot specify multiple .hpp output files');
        }
        outputHPP = args[i];
      } else if (ext === '.cpp') {
        if (outputCPP) {
          usage('Cannot specify multiple .cpp output files');
        }
        outputCPP = args[i];
      }
    } else if (args[i] === '-v') {
      verbose = true;
    } else {
      usage(`Unknown argument: ${args[i]}`);
    }
  }

  return { verbose, outputHPP, outputCPP };
}

function finish({ verbose, outputHPP, outputCPP }) {
  // validate jumpToAnimations
  for (const { name, unknownError } of jumpAnimations) {
    if (!animations.some(a => a.name === name)) {
      throw unknownError;
    }
  }

  const out = [];
  const add = v => out.push(v);

  const u4 = v => v & 15;
  const i4 = v => (v < 0 ? 16 + v : v) & 15;
  const u8 = v => v & 255;
  const i8 = v => (v < 0 ? 256 + v : v) & 255;
  const uang = v => (v / 3) & 255;
  const iang = v => (v < 0 ? 256 + (v / 3) : v / 3) & 255;
  const u12 = v => v & 4095;
  const i12 = v => (v < 0 ? 4096 + v : v) & 4095;
  let currentAnimationName = '?';
  const j12 = v => {
    if (v < -2048 || v > 2047) {
      throw new AnimationError(`Animation "${currentAnimationName}" has jump too large`);
    }
    return i12(v);
  };

  // no params
  const STOP        = () => add(0x0000);
  const DESTROY     = () => add(0x0001);
  const ANGOFF      = () => add(0x0002);
  const WORLDON     = () => add(0x0003);
  const WORLDOFF    = () => add(0x0004);
  const VISIBLEON   = () => add(0x0005);
  const VISIBLEOFF  = () => add(0x0006);
  const GRAVXON     = () => add(0x0007);
  const GRAVXOFF    = () => add(0x0008);
  // 0x0009-0x000f reserved

  const ISTRUE      = () => add(0x0010);
  const ISREPEAT    = () => add(0x0011);
  const ISCLONE     = () => add(0x0012);
  const ISVISIBLE   = () => add(0x0013);
  const ISWORLD     = () => add(0x0014);
  const ISGRAVX     = () => add(0x0015);
  const ISROTATED   = () => add(0x0016);
  const ISFIRERES   = () => add(0x0017);
  // 0x0018-0x001f reserved

  // 4-bit params
  const FLIP        = v => add(0x0020 | u4(v));
  const FX          = v => add(0x0030 | u4(v));
  const WAIT        = v => add(0x0040 | u4(v));
  const REPEAT      = v => add(0x0050 | u4(v));
  // 0x0060-0x00f0 reserved

  // 8-bit params
  const RANDOM8     = v => add(0x0100 | v);
  const SPRSHEET    = v => add(0x0200 | u8(v));
  const COPY        = v => add(0x0300 | u8(v));
  const JUMPANIM    = v => add(0x0400 | u8(v));
  const ISRANDOM    = v => add(0x0500 | u8(v));
  const PRIORITYSET = v => add(0x0600 | u8(v));
  const PRIORITYADD = v => add(0x0700 | i8(v));
  const ROTATEOX    = v => add(0x0800 | i8(v));
  const ROTATEOY    = v => add(0x0900 | i8(v));
  const ANGSET      = v => add(0x0a00 | uang(v));
  const ANGADD      = v => add(0x0b00 | iang(v));
  // 0x0c00-0x0f00 reserved

  // 12-bit params
  const RANDOM12    = v => add(0x1000 | v);
  const GRAVSET     = v => add(0x2000 | i12(v));
  const GRAVADD     = v => add(0x3000 | i12(v));
  const LOCXSET     = v => add(0x4000 | i12(v));
  const LOCXADD     = v => add(0x5000 | i12(v));
  const LOCYSET     = v => add(0x6000 | i12(v));
  const LOCYADD     = v => add(0x7000 | i12(v));
  const LOCDXSET    = v => add(0x8000 | i12(v));
  const LOCDXADD    = v => add(0x9000 | i12(v));
  const LOCDYSET    = v => add(0xa000 | i12(v));
  const LOCDYADD    = v => add(0xb000 | i12(v));
  // 0xc000 reserved
  const FIRE        = v => add(0xd000 | u12(v));
  const JUMPTRUE    = v => add(0xe000 | j12(v));
  const JUMPFALSE   = v => add(0xf000 | j12(v));
  const JUMPCOND    = (c, v) => c ? JUMPTRUE(v) : JUMPFALSE(v);

  class Label {
    position = false;
    rewrites = [];

    declare() {
      this.position = out.length;
      for (const { c, i } of this.rewrites) {
        // add opcode at end to get encoding, then pop it to overwrite earlier rewrite
        JUMPCOND(c, this.position - i);
        out[i] = out.pop();
      }
      return this;
    }

    JUMPTRUE() { return this.JUMPCOND(true); }
    JUMPFALSE() { return this.JUMPCOND(false); }
    JUMPCOND(c) {
      if (typeof this.position === 'number') {
        JUMPCOND(c, this.position - out.length);
      } else {
        this.rewrites.push({ c, i: out.length });
        out.push(0); // reserve for rewriting later
      }
      return this;
    }
  }

  const COND = c => {
    if (typeof c === 'object' && 'not' in c) {
      return !COND(c.not);
    }
    if (typeof c === 'object' && 'random' in c) {
      ISRANDOM(c.random);
    } else {
      switch (c) {
        case isTrue:         ISTRUE(); break;
        case isClone:        ISCLONE(); break;
        case isVisible:      ISVISIBLE(); break;
        case isWorldSpace:   ISWORLD(); break;
        case isGravityAxisX: ISGRAVX(); break;
        case isRotated:      ISROTATED(); break;
        case isFireResult:   ISFIRERES(); break;
        default:
          throw new Error(`Unknown condition: ${c}`);
      }
    }
    return true;
  };

  const animationIndex = {};
  const indexToAnimation = new Map();
  for (const { name, body } of animations) {
    currentAnimationName = name;
    animationIndex[name] = out.length;
    indexToAnimation.set(out.length, name);
    const walk = (lines) => {
      for (const line of lines) {
        switch (line.kind) {
          // no params
          case 'stop':         STOP(); break;
          case 'destroy':      DESTROY(); break;
          case 'angleClear':   ANGOFF(); break;
          case 'worldSpace':   line.enable ? WORLDON() : WORLDOFF(); break;
          case 'visible':      line.enable ? VISIBLEON() : VISIBLEOFF(); break;
          case 'gravityAxisX': line.enable ? GRAVXON() : GRAVXOFF(); break;

          // 4-bit params
          case 'flip':         FLIP((line.horizontal ? 1 : 0) | (line.vertical ? 2 : 0)); break;
          case 'fx':           FX((line.mosaic ? 4 : 0) | line.mode); break;
          case 'wait': {
            let left = line.frames;
            while (left > 0) {
              const frames = Math.min(16, left);
              WAIT(frames - 1);
              left -= frames;
            }
            break;
          }
          case 'repeat': {
            let left = line.times;
            while (left > 0) {
              const value = Math.min(16, left);
              REPEAT(value - 1);
              left -= value;
            }
            const lbl = new Label().declare();
            walk(line.body);
            ISREPEAT();
            lbl.JUMPTRUE();
            break;
          }

          // 8-bit params
          case 'spritesheet':         SPRSHEET(line.index); break;
          case 'jumpToAnimation':     JUMPANIM(line.index); break;
          case 'copy':                COPY(line.frame); break;
          case 'prioritySet':         PRIORITYSET(line.value); break;
          case 'priorityAdd':         PRIORITYADD(line.value); break;
          case 'rotateOriginX':       ROTATEOX(line.value); break;
          case 'rotateOriginY':       ROTATEOY(line.value); break;
          case 'angleSet':            ANGSET(line.value); break;
          case 'angleAdd':            ANGADD(line.value); break;
          case 'copyRandom':          RANDOM8(u8(line.low)); COPY(line.high); break;
          case 'prioritySetRandom':   RANDOM8(u8(line.low)); PRIORITYSET(line.high); break;
          case 'priorityAddRandom':   RANDOM8(i8(line.low)); PRIORITYADD(line.high); break;
          case 'rotateOriginXRandom': RANDOM8(i8(line.low)); ROTATEOX(line.high); break;
          case 'rotateOriginYRandom': RANDOM8(i8(line.low)); ROTATEOY(line.high); break;
          case 'angleSetRandom':      RANDOM8(uang(line.low)); ANGSET(line.high); break;
          case 'angleAddRandom':      RANDOM8(iang(line.low)); ANGADD(line.high); break;

          // 12-bit params
          case 'gravitySet':          GRAVSET(line.value); break;
          case 'gravityAdd':          GRAVADD(line.value); break;
          case 'localXSet':           LOCXSET(line.value); break;
          case 'localXAdd':           LOCXADD(line.value); break;
          case 'localYSet':           LOCYSET(line.value); break;
          case 'localYAdd':           LOCYADD(line.value); break;
          case 'localDXSet':          LOCDXSET(line.value); break;
          case 'localDXAdd':          LOCDXADD(line.value); break;
          case 'localDYSet':          LOCDYSET(line.value); break;
          case 'localDYAdd':          LOCDYADD(line.value); break;
          case 'gravitySetRandom':    RANDOM12(i12(line.low)); GRAVSET(line.high); break;
          case 'gravityAddRandom':    RANDOM12(i12(line.low)); GRAVADD(line.high); break;
          case 'localXSetRandom':     RANDOM12(i12(line.low)); LOCXSET(line.high); break;
          case 'localXAddRandom':     RANDOM12(i12(line.low)); LOCXADD(line.high); break;
          case 'localYSetRandom':     RANDOM12(i12(line.low)); LOCYSET(line.high); break;
          case 'localYAddRandom':     RANDOM12(i12(line.low)); LOCYADD(line.high); break;
          case 'localDXSetRandom':    RANDOM12(i12(line.low)); LOCDXSET(line.high); break;
          case 'localDXAddRandom':    RANDOM12(i12(line.low)); LOCDXADD(line.high); break;
          case 'localDYSetRandom':    RANDOM12(i12(line.low)); LOCDYSET(line.high); break;
          case 'localDYAddRandom':    RANDOM12(i12(line.low)); LOCDYADD(line.high); break;

          case 'fire': FIRE((i4(line.param) << 8) | u8(line.index)); break;

          case 'forever': {
            const lbl = new Label().declare();
            walk(line.body);
            ISTRUE();
            lbl.JUMPTRUE();
            break;
          }
          case 'doWhile': {
            const lbl = new Label().declare();
            walk(line.body);
            const c = COND(line.condition);
            lbl.JUMPCOND(c);
            break;
          }
          case 'whileDo': {
            const startLbl = new Label();
            const endLbl = new Label();
            startLbl.declare();
            const c = COND(line.condition);
            endLbl.JUMPCOND(!c);
            walk(line.body);
            ISTRUE();
            startLbl.JUMPTRUE();
            endLbl.declare();
            break;
          }
          case 'ifThen': {
            if (line.falseBody.length > 0) {
              // if-then-else
              const elseLbl = new Label();
              const endLbl = new Label();
              const c = COND(line.condition);
              elseLbl.JUMPCOND(!c);
              walk(line.trueBody);
              ISTRUE();
              endLbl.JUMPTRUE();
              elseLbl.declare();
              walk(line.falseBody);
              endLbl.declare();
            } else {
              // if-then
              const lbl = new Label();
              const c = COND(line.condition);
              lbl.JUMPCOND(!c);
              walk(line.trueBody);
              lbl.declare();
            }
            break;
          }
          default:
            console.error(line);
            throw new Error(`Unknown statement: ${line.kind}`);
        }
      }
    };
    walk(body);
  }

  if (verbose) {
    let lastIndex = false;
    const pushIndex = (name, index) => {
      if (lastIndex !== false) {
        console.log(lastIndex.name, '=>', index - lastIndex.index, 'instructions');
      }
      lastIndex = { name, index };
    };
    for (const { name, body } of animations) {
      pushIndex(name, animationIndex[name]);
    }
    pushIndex('', out.length);
    console.log('Total size:', out.length, 'instructions (' + (out.length * 2) + ' bytes)');
  }

  if (verbose || outputHPP) {
    if (verbose) console.log(`\nOutput HPP: ${outputHPP}`);
    let hpp = [
      `// generated via scripts/animations.js`,
      `#pragma once`,
      `#include <stdint.h>`,
      ``,
      `struct SprEntry;`,
      `typedef bool (*f_animFireHandler)(SprEntry &spr);`,
      ``,
      `namespace AnimData {`,
      `  extern const f_animFireHandler handlers[];`,
      `  extern const uint8_t *const spritesheets[];`,
      `  alignas(4) extern const uint16_t data[];`,
      `}`,
      ``,
      `namespace Anim {`,
    ];

    for (const { name } of animations) {
      hpp.push(`  static constexpr uint32_t ${name} = ${animationIndex[name]};`);
    }

    hpp.push('}');
    hpp.push('');
    hpp = hpp.join('\n');
    if (verbose) console.log(hpp);
    if (outputHPP) {
      fs.writeFileSync(outputHPP, hpp, 'utf8');
    }
  }

  if (verbose || outputCPP) {
    if (verbose) console.log(`\nOutput CPP: ${outputCPP}`);
    let cpp = [`// generated via scripts/animations.js`];
    if (outputHPP) {
      cpp.push(`#include "${path.relative(path.dirname(outputCPP), outputHPP)}"`);
    } else {
      cpp.push(`#include "animations.hpp"`);
    }
    if (handlers.length > 0) {
      cpp.push(``);
      for (const h of handlers) {
        cpp.push(`extern bool ${h}(SprEntry &spr);`);
      }
    }
    if (spritesheets.length > 0) {
      cpp.push(``);
      for (const s of spritesheets) {
        cpp.push(`extern const uint8_t ${s}[];`);
      }
    }
    cpp.push(
      ``,
      `namespace AnimData {`,
      `  const f_animFireHandler handlers[] = {`,
    );
    for (const h of handlers) {
      cpp.push(`    ${h},`);
    }
    cpp.push(
      `    0`,
      `  };`,
      ``,
      `  const uint8_t *const spritesheets[] = {`,
    );
    for (const s of spritesheets) {
      cpp.push(`    ${s},`);
    }
    cpp.push(
      `    0`,
      `  };`,
      ``,
      `  alignas(4) const uint16_t data[] = {`,
    );
    for (let i = 0; i < out.length; i++) {
      const name = indexToAnimation.get(i);
      if (name) cpp.push(`    // ${name}`, `   `);
      const str = `0x${`000${out[i].toString(16)}`.substr(-4)},`;
      if (cpp[cpp.length - 1].length + str.length < 78) {
        cpp[cpp.length - 1] += ` ${str}`;
      } else {
        cpp.push(`    ${str}`);
      }
    }
    if (out.length % 2) {
      cpp.push(`    0,`);
    }
    cpp.push(`  };`, `}`);

    cpp.push('');
    cpp = cpp.join('\n');
    if (verbose) console.log(cpp);
    if (outputCPP) {
      fs.writeFileSync(outputCPP, cpp, 'utf8');
    }
  }
}

//
// Animation API
//

function define(func) {
  try {
    if (calledDefine) {
      throw new AnimationError('Cannot call define(...) more than once');
    }
    calledDefine = true;
    insideDefine = true;
    const config = start();
    func();
    finish(config);
  } catch (err) {
    if (err instanceof AnimationError) {
      const frame = err.stack
        .split('\n')
        .slice(1)
        .find(line => !line.includes('node:internal'));
      const location = frame
        ?.trim()
        .replace(/^at /, '')
        .replace(`file://${process.cwd()}/`, '');
      console.error(`${location}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  } finally {
    insideDefine = false;
  }
}

function animation(name, bodyGenerator) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (insideAnimation) {
    throw new AnimationError('Cannot call animation() inside another animation()');
  }
  if (typeof name !== 'string' || typeof bodyGenerator !== 'function') {
    throw new AnimationError('Expecting: animation(name: string, () => { ... });');
  }
  if (!validSymbol(name)) {
    throw new AnimationError(`Invalid animation name: ${name}`);
  }
  if (animations.some(a => a.name === name)) {
    throw new AnimationError(`Cannot redefine animation: ${name}`);
  }
  insideAnimation = true;
  const body = [];
  animations.push({ name, body });
  bodyStack.unshift(body);
  try {
    bodyGenerator();
    const last = body.at(-1);
    if (!last || (last.kind !== 'stop' && last.kind !== 'destroy')) {
      body.push({ kind: 'stop' });
    }
  } finally {
    insideAnimation = false;
    bodyStack.shift();
  }
}

function stop() {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  push({ kind: 'stop' });
}

function destroy() {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  push({ kind: 'destroy' });
}

function angleClear() {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  push({ kind: 'angleClear' });
}

function worldSpace(enable) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof enable !== 'boolean') {
    throw new AnimationError('Expecting: worldSpace(enable: boolean);');
  }
  push({ kind: 'worldSpace', enable });
}

function visible(enable) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof enable !== 'boolean') {
    throw new AnimationError('Expecting: visible(enable: boolean);');
  }
  push({ kind: 'visible', enable });
}

function gravityAxisX(enable) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof enable !== 'boolean') {
    throw new AnimationError('Expecting: gravityAxisX(enable: boolean);');
  }
  push({ kind: 'gravityAxisX', enable });
}

function flip(horizontal, vertical) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof horizontal !== 'boolean' || typeof vertical !== 'boolean') {
    throw new AnimationError('Expecting: flip(horizontal: boolean, vertical: boolean);');
  }
  push({ kind: 'flip', horizontal, vertical });
}

function fx(mosaic, mode) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (
    typeof mosaic !== 'boolean' ||
    !Number.isInteger(mode) || mode < 0 || mode > 3
  ) {
    throw new AnimationError('Expecting: fx(mosaic: boolean, mode: 0-3);');
  }
  push({ kind: 'fx', mosaic, mode });
}

function wait(frames) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (!Number.isInteger(frames) || frames < 1 || frames > 1000) {
    throw new AnimationError('Expecting: wait(frames: 1-1000);');
  }
  push({ kind: 'wait', frames });
}

function spritesheet(symbol) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof symbol !== 'string') {
    throw new AnimationError('Expecting: spritesheet(symbol: string);');
  }
  if (!validSymbol(symbol)) {
    throw new AnimationError(`Invalid spritesheet: ${symbol}`);
  }
  let index = spritesheets.indexOf(symbol);
  if (index < 0) {
    if (spritesheets.length >= 256) {
      throw new AnimationError('Out of spritesheets; max of 256');
    }
    index = spritesheets.length;
    spritesheets.push(symbol);
  }
  push({ kind: 'spritesheet', index });
}

function jumpToAnimation(name) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof name !== 'string') {
    throw new AnimationError('Expecting: jumpToAnimation(name: string);');
  }
  if (!validSymbol(name)) {
    throw new AnimationError(`Invalid animation name: ${name}`);
  }
  let index = jumpAnimations.findIndex(j => j.name === name);
  if (index < 0) {
    if (jumpAnimations.length >= 256) {
      throw new AnimationError('Out of jump animations; max of 256');
    }
    let unknownError;
    try {
      throw new AnimationError(`Unknown animation: ${name}`);
    } catch (err) {
      unknownError = err;
    }
    index = jumpAnimations.length;
    jumpAnimations.push({ name, unknownError });
  }
  push({ kind: 'jumpToAnimation', index });
}

function random(low, high) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof high === 'undefined') {
    if (!Number.isFinite(low)) {
      throw new AnimationError('Expecting: random(count: number) [exclusive]');
    }
    return { kind: 'randomCount', count: low };
  } else {
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new AnimationError('Expecting: random(low: number, high: number) [inclusive];');
    }
    if (low > high) {
      let t = low;
      low = high;
      high = t;
    }
    return { kind: 'randomRange', low, high };
  }
}

function validateRandomInt(value, validLow, validHigh, unit = 1) {
  if (!isRandomValue(value)) {
    throw new Error('validateRandomInt must be passed a random object');
  }
  if (value.kind === 'randomCount') {
    if (
      value.count < Math.max(2, unit) ||
      value.count > validHigh + unit ||
      !Number.isInteger(value.count / unit)
    ) {
      let range = `${Math.max(2, unit)}-${validHigh + unit}`;
      if (unit > 1) {
        range += ` divisible by ${unit}`;
      }
      throw new AnimationError(`Expecting: random(count: ${range})`);
    }
    return { low: 0, high: value.count - unit };
  } else { // randomRange
    if (
      !Number.isInteger(value.low) || value.low < validLow || value.low > validHigh ||
      !Number.isInteger(value.high) || value.high < validLow || value.high > validHigh ||
      !Number.isInteger(value.low / unit) ||
      !Number.isInteger(value.high / unit)
    ) {
      let range = `${validLow}-${validHigh}`;
      if (unit > 1) {
        range += ` divisible by ${unit}`;
      }
      throw new AnimationError(`Expecting: random(low: ${range}, high: ${range});`);
    }
    return { low: value.low, high: value.high };
  }
}

function isRandomValue(value) {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }
  return (
    (value.kind === 'randomCount' && Number.isFinite(value.count)) ||
    (value.kind === 'randomRange' && Number.isFinite(value.low) && Number.isFinite(value.high))
  );
}

function copy(frame) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (isRandomValue(frame)) {
    const { low, high } = validateRandomInt(frame, 0, 255);
    push({ kind: 'copyRandom', low, high });
  } else {
    if (!Number.isInteger(frame) || frame < 0 || frame > 255) {
      throw new AnimationError('Expecting: copy(frame: 0-255);');
    }
    push({ kind: 'copy', frame });
  }
}

function isRandom(odds) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  odds = Math.floor(odds * 256);
  if (!Number.isFinite(odds) || odds <= 0 || odds > 255) {
    throw new AnimationError('Expecting: isRandom(odds: 0.004-0.999);');
  }
  return { random: odds };
}

function prioritySet(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (isRandomValue(value)) {
    const { low, high } = validateRandomInt(value, 0, 255);
    push({ kind: 'prioritySetRandom', low, high });
  } else {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new AnimationError('Expecting: prioritySet(value: 0-255);');
    }
    push({ kind: 'prioritySet', value });
  }
}

function priorityAdd(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (isRandomValue(value)) {
    const { low, high } = validateRandomInt(value, -128, 127);
    push({ kind: 'priorityAddRandom', low, high });
  } else {
    if (!Number.isInteger(value) || value < -128 || value > 127) {
      throw new AnimationError('Expecting: priorityAdd(value: -128-127);');
    }
    push({ kind: 'priorityAdd', value });
  }
}

function rotateOriginSetAxis(kind, value, rangeError) {
  if (isRandomValue(value)) {
    const { low, high } = validateRandomInt(value, -128, 127);
    push({ kind: `${kind}Random`, low, high });
  } else {
    if (!Number.isInteger(value) || value < -128 || value > 127) {
      throw new AnimationError(rangeError);
    }
    push({ kind, value });
  }
}

function rotateOriginX(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  rotateOriginSetAxis(
    'rotateOriginX',
    value,
    'Expecting: rotateOriginX(x: -128-127);'
  );
}

function rotateOriginY(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  rotateOriginSetAxis(
    'rotateOriginY',
    value,
    'Expecting: rotateOriginY(y: -128-127);'
  );
}

function rotateOrigin(x, y) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  const rangeError = 'Expecting: rotateOrigin(x: -128-127, y: -128-127);';
  rotateOriginSetAxis('rotateOriginX', x, rangeError);
  rotateOriginSetAxis('rotateOriginY', y, rangeError);
}

function angleSet(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (isRandomValue(value)) {
    const { low, high } = validateRandomInt(value, 0, 360, 3);
    push({ kind: 'angleSetRandom', low, high });
  } else {
    if (!Number.isInteger(value) || value < 0 || value > 360 || !Number.isInteger(value / 3)) {
      throw new AnimationError('Expecting: angleSet(value: 0-360 divisible by 3);');
    }
    push({ kind: 'angleSet', value });
  }
}

function angleAdd(value) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (isRandomValue(value)) {
    const { low, high } = validateRandomInt(value, -360, 360, 3);
    push({ kind: 'angleAddRandom', low, high });
  } else {
    if (!Number.isInteger(value) || value < -360 || value > 360 || !Number.isInteger(value / 3)) {
      throw new AnimationError('Expecting: angleAdd(value: -360-360 divisible by 3);');
    }
    push({ kind: 'angleAdd', value });
  }
}

function makeSetAddValidator(format, rangeError) {
  let range = [-2048, 2047];
  let div;
  if (format === '4.8') {
    div = 256;
  } else if (format === '8.4') {
    div = 16;
  } else {
    throw new Error('Invalid format');
  }
  const rangeStr = `${range[0] / div}-${Math.floor(range[1] / div)}.999`;
  const randomLow = 2 / div;
  const randomHigh = (range[1] + 1) / div;
  return (setAdd, value) => {
    if (isRandomValue(value)) {
      if (value.kind === 'randomCount') {
        const count = Math.floor(value.count * div);
        if (!Number.isInteger(count) || count < 2 || count > range[1] + 1) {
          throw new AnimationError(
            `Expecting: random(count: ${randomLow.toFixed(3)}-${randomHigh});`
          );
        }
        return { low: 0, high: count - 1 };
      } else { // randomRange
        const low = Math.floor(value.low * div);
        const high = Math.floor(value.high * div);
        if (!Number.isFinite(low) || !Number.isFinite(high) || low < range[0] || high > range[1]) {
          throw new AnimationError(`Expecting: random(low: ${rangeStr}, high: ${rangeStr});`);
        }
        return { low, high };
      }
    } else {
      const err = rangeError.replace(/rangeStr/g, rangeStr);
      if (!Number.isFinite(value)) {
        throw new AnimationError(err);
      }
      value = Math.floor(value * div);
      if (!Number.isInteger(value) || value < range[0] || value > range[1]) {
        throw new AnimationError(err);
      }
      return value;
    }
  };
}

function makeSetAdd(kindPrefix, format) {
  const makeFunc = (setAdd, varStr) => (value) => {
    const validate = makeSetAddValidator(
      format,
      `Expecting: ${kindPrefix}${setAdd}(${varStr}: rangeStr);`
    );
    const result = validate(setAdd, value);
    if (typeof result === 'number') {
      push({ kind: `${kindPrefix}${setAdd}`, value: result });
    } else {
      push({ kind: `${kindPrefix}${setAdd}Random`, low: result.low, high: result.high });
    }
  };
  return { set: makeFunc('Set', 'value'), add: makeFunc('Add', 'value') };
}

function makeSetAddPair(funcPrefix, format, varX, varY, kindX, kindY) {
  const makeFunc = (setAdd) => (valueX, valueY) => {
    const validateX = makeSetAddValidator(
      format,
      `Expecting: ${funcPrefix}${setAdd}(${varX}: rangeStr, ${varY}: rangeStr);`
    );
    const validateY = makeSetAddValidator(
      format,
      `Expecting: ${funcPrefix}${setAdd}(${varX}: rangeStr, ${varY}: rangeStr);`
    );
    const resultX = validateX(setAdd, valueX);
    const resultY = validateY(setAdd, valueY);
    if (typeof resultX === 'number') {
      push({ kind: `${kindX}${setAdd}`, value: resultX });
    } else {
      push({ kind: `${kindX}${setAdd}Random`, low: resultX.low, high: resultX.high });
    }
    if (typeof resultY === 'number') {
      push({ kind: `${kindY}${setAdd}`, value: resultY });
    } else {
      push({ kind: `${kindY}${setAdd}Random`, low: resultY.low, high: resultY.high });
    }
  };
  return { set: makeFunc('Set'), add: makeFunc('Add') };
}

const { set: gravitySet, add: gravityAdd } = makeSetAdd('gravity', '4.8');
const { set: localXSet, add: localXAdd } = makeSetAdd('localX', '8.4');
const { set: localYSet, add: localYAdd } = makeSetAdd('localY', '8.4');
const { set: localDXSet, add: localDXAdd } = makeSetAdd('localDX', '8.4');
const { set: localDYSet, add: localDYAdd } = makeSetAdd('localDY', '8.4');
const { set: localSet, add: localAdd } = makeSetAddPair(
  'local', '8.4', 'x', 'y',
  'localX', 'localY'
);
const { set: localDSet, add: localDAdd } = makeSetAddPair(
  'localD', '8.4', 'dx', 'dy',
  'localDX', 'localDY'
);

function repeat(times, bodyGenerator) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (insideRepeat) {
    throw new AnimationError('Cannot have nested repeat(N, () => { ... });');
  }
  if (
    !Number.isInteger(times) || times < 2 || times > 255 ||
    typeof bodyGenerator !== 'function'
  ) {
    throw new AnimationError('Expecting: repeat(times: 2-255, () => { ... });');
  }
  const body = [];
  push({ kind: 'repeat', times, body });
  bodyStack.unshift(body);
  insideRepeat = true;
  try {
    bodyGenerator();
  } finally {
    insideRepeat = false;
    bodyStack.shift();
  }
}

function forever(bodyGenerator) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof bodyGenerator !== 'function') {
    throw new AnimationError('Expecting: forever(() => { ... });');
  }
  const body = [];
  push({ kind: 'forever', body });
  bodyStack.unshift(body);
  try {
    bodyGenerator();
  } finally {
    bodyStack.shift();
  }
}

function not(condition) {
  validateCondition(condition);
  if (condition && typeof condition === 'object' && 'not' in condition) {
    return condition.not;
  }
  return { not: condition };
}

function doWhile(bodyGenerator, condition) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  validateCondition(condition);
  if (typeof bodyGenerator !== 'function') {
    throw new AnimationError('Expecting: doWhile(() => { ... }, condition);');
  }
  const body = [];
  push({ kind: 'doWhile', condition, body });
  bodyStack.unshift(body);
  try {
    bodyGenerator();
  } finally {
    bodyStack.shift();
  }
}

function whileDo(condition, bodyGenerator) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  validateCondition(condition);
  if (typeof bodyGenerator !== 'function') {
    throw new AnimationError('Expecting: whileDo(condition, () => { ... });');
  }
  const body = [];
  push({ kind: 'whileDo', condition, body });
  bodyStack.unshift(body);
  try {
    bodyGenerator();
  } finally {
    bodyStack.shift();
  }
}

function ifThen(condition, trueBodyGenerator, falseBodyGenerator) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  validateCondition(condition);
  if (typeof trueBodyGenerator !== 'function') {
    throw new AnimationError('Expecting: ifThen(condition, () => { ... });');
  }
  if (typeof falseBodyGenerator !== 'function' && typeof falseBodyGenerator !== 'undefined') {
    throw new AnimationError('Expecting: ifThen(condition, () => { ... }, () => { ... });');
  }
  const trueBody = [];
  const falseBody = [];
  push({ kind: 'ifThen', condition, trueBody, falseBody });
  bodyStack.unshift(trueBody);
  try {
    trueBodyGenerator();
  } finally {
    bodyStack.shift();
  }
  if (falseBodyGenerator) {
    bodyStack.unshift(falseBody);
    try {
      falseBodyGenerator();
    } finally {
      bodyStack.shift();
    }
  }
}

function fire(symbol, param = 0) {
  if (!insideDefine) throw new Error(DEFINE_ERROR);
  if (typeof symbol !== 'string' || !Number.isInteger(param) || param < -8 || param > 7) {
    throw new AnimationError('Expecting: fire(symbol: string, param: -8-7);');
  }
  if (!validSymbol(symbol)) {
    throw new AnimationError(`Invalid fire handler: ${symbol}`);
  }
  let index = handlers.indexOf(symbol);
  if (index < 0) {
    if (handlers.length >= 256) {
      throw new AnimationError('Out of event handlers; max of 256');
    }
    index = handlers.length;
    handlers.push(symbol);
  }
  push({ kind: 'fire', index, param });
  return isFireResult;
}

Object.assign(globalThis, {
  define,           // animations: function
  animation,        // name: string, body: function
  stop,             // no args
  destroy,          // no args
  angleClear,       // no args
  worldSpace,       // enable: boolean
  gravityAxisX,     // enable: boolean
  visible,          // enable: boolean
  flip,             // horizontal: boolean, vertical: boolean
  fx,               // mosaic: boolean, mode: 0-3
  wait,             // frames: 1-1000
  spritesheet,      // symbol: string
  jumpToAnimation,  // name: string
  random,           // count: finite number | low: finite number, high: finite number
  copy,             // frame: 0-255 | random
  prioritySet,      // value: 0-255 | random
  priorityAdd,      // value: -128-127 | random
  rotateOriginX,    // x: -128-127 | random
  rotateOriginY,    // y: -128-127 | random
  rotateOrigin,     // x: -128-127 | random, y: -128-127 | random
  angleSet,         // value: 0-360 divisible by 3 | random
  angleAdd,         // value: -360-360 divisible by 3 | random
  gravitySet,       // value: -8-7.999 | random
  gravityAdd,       // value: -8-7.999 | random
  localXSet,        // value: -128-127.999 | random
  localXAdd,        // value: -128-127.999 | random
  localYSet,        // value: -128-127.999 | random
  localYAdd,        // value: -128-127.999 | random
  localDXSet,       // value: -128-127.999 | random
  localDXAdd,       // value: -128-127.999 | random
  localDYSet,       // value: -128-127.999 | random
  localDYAdd,       // value: -128-127.999 | random
  localSet,         // x: -128-127.999 | random, y: -128-127.999 | random
  localAdd,         // x: -128-127.999 | random, y: -128-127.999 | random
  localDSet,        // dx: -128-127.999 | random, dy: -128-127.999 | random
  localDAdd,        // dx: -128-127.999 | random, dy: -128-127.999 | random
  not,              // condition
  isTrue,           // condition constant
  isFalse,          // condition constant
  isClone,          // condition constant
  isVisible,        // condition constant
  isWorldSpace,     // condition constant
  isGravityAxisX,   // condition constant
  isRotated,        // condition constant
  isFireResult,     // condition constant
  isRandom,         // odds: 0.004-0.999
  repeat,           // times: 2-255, body: function
  forever,          // body: function
  doWhile,          // body: function, condition
  whileDo,          // condition, body: function
  ifThen,           // condition, trueBody: function, falseBody?: function
  fire              // symbol: string, param: -8-7
});
