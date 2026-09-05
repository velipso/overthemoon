// SPDX-License-Identifier: 0BSD
// @ts-expect-error -- intentionally no @types/node
import fs from 'node:fs/promises';
// @ts-expect-error -- intentionally no @types/node
import path from 'node:path';
// @ts-expect-error -- intentionally no @types/node
import { inspect } from 'node:util';

declare const process: {
  argv: string[];
  exit(code?: number): never;
};

interface Chunk {
  name: string;
  attributes: Map<string, string>;
  children: Chunk[];
  depth: number;
}

const EnvelopeKindVolume    = 0 as const;
const EnvelopeKindArpeggio  = 1 as const;
const EnvelopeKindPitchAbs  = 2 as const;
const EnvelopeKindPitchRel  = 3 as const;
const EnvelopeKindDutyCycle = 4 as const;
const EnvelopeKindWave      = 5 as const;
const EnvelopeKindRepeat    = 6 as const;

type EnvelopeKind =
  | typeof EnvelopeKindVolume
  | typeof EnvelopeKindArpeggio
  | typeof EnvelopeKindPitchAbs
  | typeof EnvelopeKindPitchRel
  | typeof EnvelopeKindDutyCycle
  | typeof EnvelopeKindWave
  | typeof EnvelopeKindRepeat;

interface Envelope {
  kind: EnvelopeKind;
  loop: number;
  release: number;
  values: number[]; // int8_t
}

const VolumeMappingFull    = 0 as const;
const VolumeMappingHalf    = 1 as const;
const VolumeMappingQuarter = 2 as const;

type VolumeMapping =
  | typeof VolumeMappingFull
  | typeof VolumeMappingHalf
  | typeof VolumeMappingQuarter;

interface Instrument {
  volumeMapping: VolumeMapping;
  envelopes: Envelope[];
}

interface Pattern {
  events: number[];
}

const ChannelKindSine     = 0 as const;
const ChannelKindSquare   = 1 as const;
const ChannelKindTriangle = 2 as const;
const ChannelKindSaw      = 3 as const;
const ChannelKindWave     = 4 as const;
const ChannelKindPCM      = 5 as const;
const ChannelKindNoise    = 6 as const;

type ChannelKind =
  | typeof ChannelKindSine
  | typeof ChannelKindSquare
  | typeof ChannelKindTriangle
  | typeof ChannelKindSaw
  | typeof ChannelKindWave
  | typeof ChannelKindPCM
  | typeof ChannelKindNoise;

interface Channel {
  kind: ChannelKind;
  patterns: Pattern[];
  instances: number[];
}

interface Song {
  length: number;
  channels: Channel[];
}

interface OutputFile {
  instruments: Instrument[];
  songs: Song[];
}

function envelopeKind(type: string | undefined, relative: string | undefined): EnvelopeKind | null {
  switch (type) {
    case 'Volume': return EnvelopeKindVolume;
    case 'Arpeggio': return EnvelopeKindArpeggio;
    case 'Pitch': return relative ? EnvelopeKindPitchRel : EnvelopeKindPitchAbs;
    case 'DutyCycle': return EnvelopeKindDutyCycle;
    case 'N163Wave': return EnvelopeKindWave;
    case 'Repeat': return EnvelopeKindRepeat;
  }
  return null;
}

function instrumentVolumeMapping(volumeMapping: string | undefined): VolumeMapping {
  switch (volumeMapping) {
    case 'Full': return VolumeMappingFull;
    case 'Half': return VolumeMappingHalf;
    case 'Quarter': return VolumeMappingQuarter;
  }
  return VolumeMappingFull;
}

function channelKind(type: string | undefined): { kind: ChannelKind, octaveOffset: number } | null {
  switch (type) {
    case 'Square1':
    case 'Square2':
    case 'VRC6Square1':
    case 'VRC6Square2':
      return { kind: ChannelKindSquare, octaveOffset: 1 };
    case 'Triangle':
      return { kind: ChannelKindTriangle, octaveOffset: 0 };
    case 'Noise':
      return { kind: ChannelKindNoise, octaveOffset: 0 };
    case 'DPCM':
      return { kind: ChannelKindPCM, octaveOffset: 0 };
    case 'VRC6Saw':
      return { kind: ChannelKindSaw, octaveOffset: 1 };
    case 'N163Wave1':
    case 'N163Wave2':
    case 'N163Wave3':
    case 'N163Wave4':
    case 'N163Wave5':
    case 'N163Wave6':
    case 'N163Wave7':
    case 'N163Wave8':
      return { kind: ChannelKindWave, octaveOffset: 1 };
  }
  return null;
}

function parseNote(note: string | undefined, octaveOffset: number): number {
  if (!note) {
    return -1;
  }
  const m = note.match(/^([A-G]#?)([0-9])$/);
  if (!m) {
    return -1;
  }
  const oct = parseFloat(m[2]) + octaveOffset;
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const n = notes.indexOf(m[1]);
  if (n < 0) {
    return -1;
  }
  return oct * 12 + n;
}

const EV_NOTE   = 0x0000;
const EV_WAIT   = 0x8000;
const EV_PATEND = 0x8100;
const EV_INST1  = 0x8200;
const EV_INST2  = 0x8300;
const EV_VOL    = 0x8400;

function num15to128(value: number) {
  return Math.round(value * 128 / 15);
}

class Events {
  length: number;
  events: { frame: number; bias: number; wait?: number; value: number[] }[];

  constructor(length: number) {
    this.length = length;
    this.events = [{
      frame: length,
      bias: 9999,
      value: [EV_PATEND]
    }];
  }

  note(
    frame: number,
    note: number,
    duration: number,
    release: number,
    attack: boolean
  ) {
    if (!Number.isInteger(note) || note < 0 || note >= 108) {
      throw new Error('Invalid note');
    }
    if (!Number.isInteger(duration) || duration < 0 || duration >= 2048) {
      throw new Error('Invalid duration');
    }
    if (!Number.isInteger(release) || release < 0) {
      throw new Error('Invalid release');
    }
    release = Math.min(duration, release);
    this.events.push({
      frame,
      bias: 999,
      wait: duration,
      // 0x8000 = attack exists
      // 0x4000 = advance by duration (if possible)
      value: [
        EV_NOTE | (note << 8) | (release & 0xff),
        (attack ? 0x8000 : 0) | 0x4000 | (((release >> 8) & 0x7) << 11) | duration
      ]
    });
  }

  instrument(frame: number, instrument: number) {
    if (!Number.isInteger(instrument) || instrument < 0) {
      throw new Error('Invalid instrument index');
    }
    if (instrument < 256) {
      this.events.push({
        frame,
        bias: 0,
        value: [EV_INST1 | instrument]
      });
    } else if (instrument < 512) {
      this.events.push({
        frame,
        bias: 0,
        value: [EV_INST2 | (instrument - 256)]
      });
    } else {
      console.error('Too many instruments; max of 512');
      process.exit(1);
    }
  }

  volume(frame: number, volume: number) {
    if (!Number.isInteger(volume) || volume < 0 || volume >= 129) {
      throw new Error('Invalid volume');
    }
    this.events.push({
      frame,
      bias: 1,
      value: [EV_VOL | volume]
    });
  }

  done(): number[] | false {
    if (this.events.length <= 1) {
      return false; // empty events
    }

    // sort events by frame + bias
    this.events.sort((a, b) => {
      const v1 = a.frame - b.frame;
      if (v1 !== 0) return v1;
      const v2 = a.bias - b.bias;
      if (v2 !== 0) return v2;
      return a.value[0] - b.value[0];
    });

    // remove automatic advancing by duration if events are in the way
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if ((e.value[0] & 0x8000) == EV_NOTE) {
        // found note event... is the next event before duration?
        const duration = e.value[1] & 0x07ff;
        if (
          i < this.events.length - 1 &&
          this.events[i + 1].frame < e.frame + duration // next event is in the way?
        ) {
          // then we can't advance by duration :(
          delete e.wait;
          e.value[1] &= 0xbfff;
        }
      }
    }

    // insert wait commands to space out events properly
    let lastFrame = 0;
    const result: number[] = [];
    for (const e of this.events) {
      let wait = e.frame - lastFrame;
      if (wait < 0) throw new Error('Bad event order?');
      while (wait > 0) {
        const w = Math.min(255, wait);
        result.push(EV_WAIT | w);
        wait -= w;
      }
      for (const v of e.value) {
        result.push(v);
      }
      lastFrame = e.frame + ('wait' in e && typeof e.wait === 'number' ? e.wait : 0);
    }
    return result;
  }
}

function printUsage(error?: string): never {
  console.log(
    'Usage: node famistudio.ts -o <output.bin> <input.txt>\n\n' +
    'Converts a FamiStudio text export (input.txt) into an event stream (output.bin)\n' +
    'that can be used by the sound engine to play songs.\n\n' +
    '-o <output.bin>  Output file\n\n' +
    '<input.txt>      Input file from FamiStudio export'
  );
  if (error) {
    console.error('\nError: %s', error);
  }
  process.exit(error ? 1 : 0);
}

function parseArgs(): { inputFile: string; outputFile: string | null } {
  const args = process.argv.slice(2);
  if (args.length <= 0) {
    printUsage();
  }

  let outputFile: string | null = null;
  let inputFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') {
      i++;
      if (i >= args.length) {
        printUsage('Missing output file after -o');
      }
      if (typeof outputFile === 'string') {
        printUsage('Cannot specify multiple output files');
      }
      outputFile = args[i];
    } else {
      if (typeof inputFile === 'string') {
        printUsage('Cannot specify multiple input files');
      }
      inputFile = args[i];
    }
  }

  if (inputFile === null) {
    printUsage('Missing input file');
  }

  return { inputFile, outputFile };
}

function parseLine(line: string): { name: string; attributes: Map<string, string> } {
  let name = '';
  const attributes = new Map<string, string>();
  let state = 0;
  let key = '';
  let value = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    const nch = line.charAt(i + 1);
    switch (state) {
      case 0: // read name
        if (ch === ' ') {
          key = '';
          state = 1;
        } else {
          name += ch;
        }
        break;
      case 1: // read key
        if (ch === '=') {
          value = '';
          state = 2;
        } else if (ch !== ' ') {
          key += ch;
        }
        break;
      case 2: // read "value"
        if (ch === '"') {
          state = 3;
        } else {
          throw new Error('Invalid FamiStudio attribute value');
        }
        break;
      case 3: // read value
        if (ch === '"' && nch === '"') {
          value += '"';
          i++;
        } else if (ch === '"') {
          attributes.set(key, value);
          key = '';
          state = 1;
        } else {
          value += ch;
        }
        break;
    }
  }
  return { name, attributes };
}

function parseFileIntoTree(fileData: string): Chunk[] {
  const lines = fileData.split('\n');
  const root: Chunk = {
    name: 'Root',
    attributes: new Map(),
    children: [],
    depth: -1
  };
  const here = [root];
  for (let line of lines) {
    if (!line.trim()) continue;
    let tab = 0;
    while (line.charAt(tab) === ' ' || line.charAt(tab) === '\t') {
      tab++;
    }
    const { name, attributes } = parseLine(line.substr(tab));
    const chunk: Chunk = {
      name,
      attributes,
      children: [],
      depth: tab
    };
    while (tab <= here[0].depth) {
      here.shift();
    }
    while (tab > here[0].depth + 1) {
      here.unshift(here[0].children[here[0].children.length - 1]);
    }
    here[0].children.push(chunk);
  }
  return root.children;
}

function parseTreeIntoOut(rootChildren: Chunk[]): OutputFile {
  const out: OutputFile = {
    instruments: [],
    songs: [],
  };

  const project = rootChildren.find(c => c.name === 'Project');
  if (!project) {
    throw new Error('Missing "Project"');
  }

  // validate project
  const tempoMode = project.attributes.get('TempoMode');
  if (tempoMode !== 'FamiStudio') {
    console.error(`Unsupported tempo mode "${tempoMode}"; only "FamiStudio" supported`);
    process.exit(1);
  }
  const expansions = project.attributes.get('Expansions')?.split(',') ?? [];
  for (const e of expansions) {
    if (e !== 'VRC6' && e !== 'N163') {
      console.error(`Unsupported expansion "${e}"; only "VRC6" and "N163" supported`);
      process.exit(1);
    }
  }

  // parse envelope-based instruments
  const instrumentNameToIndex = new Map<string, number>();
  const instruments = project.children.filter(c => c.name === 'Instrument');
  for (const instrument of instruments) {
    // TODO: convert N163Wave presets to regular instruments if possible
    // Sine, Triangle, Sawtooth, Square50%, Square25%
    // allows for triangle with volume! :)
    const instrumentName = instrument.attributes.get('Name');
    if (!instrumentName) {
      throw new Error('Missing instrument name');
    }
    const envelopes = instrument.children.filter(c => c.name === 'Envelope');
    if (envelopes.length > 0) {
      const envs: Envelope[] = [];
      for (const envelope of envelopes) {
        const attr = envelope.attributes;
        const kind = envelopeKind(attr.get('Type'), attr.get('Relative'));
        if (kind === null) {
          console.error('Invalid envelope:', envelope);
          process.exit(1);
        }
        const loop = parseFloat(attr.get('Loop') ?? '');
        const release = parseFloat(attr.get('Release') ?? '');
        const values = (attr.get('Values')?.split(',') || []).map(parseFloat);
        envs.push({
          kind,
          loop: isNaN(loop) ? -1 : loop,
          release: isNaN(release) ? -1 : release,
          values
        });
      }

      instrumentNameToIndex.set(instrumentName, out.instruments.length);
      out.instruments.push({
        volumeMapping: instrumentVolumeMapping(instrument.attributes.get('Vrc6SawMasterVolume')),
        envelopes: envs
      });
    } else {
      instrumentNameToIndex.set(instrumentName, -1); // empty instrument
    }
    //const dpcmMapping = instrument.children.filter(c => c.name === 'DPCMMapping');
    // TODO: do something with dpcmMapping
  }

  // parse songs
  const songs = project.children.filter(c => c.name === 'Song');
  for (const song of songs) {
    const songLength = parseFloat(song.attributes.get('Length') ?? '');
    const patternLength = parseFloat(song.attributes.get('PatternLength') ?? '');
    const noteLength = parseFloat(song.attributes.get('NoteLength') ?? '');
    if (isNaN(songLength) || isNaN(patternLength) || isNaN(noteLength)) {
      throw new Error('Invalid song attributes');
    }
    const chans: Channel[] = [];
    const channels = song.children.filter(c => c.name === 'Channel');
    for (const channel of channels) {
      const chanKind = channelKind(channel.attributes.get('Type'));
      if (!chanKind) {
        console.error('Invalid channel:', channel);
        process.exit(1);
      }
      const { kind, octaveOffset } = chanKind;

      const patts: Pattern[] = [];
      const patterns = channel.children.filter(c => c.name === 'Pattern');
      const patternNameToIndex = new Map<string, number>();
      for (const pattern of patterns) {
        const patternName = pattern.attributes.get('Name');
        if (!patternName) {
          throw new Error('Missing pattern name');
        }
        const events = new Events(patternLength * noteLength);

        // TODO: generate event stream
        let lastInstrument = -1;
        const notes = pattern.children.filter(c => c.name === 'Note');
        for (const note of notes) {
          const attr = [...note.attributes.entries()];
          const getAttr = (name: string): string => {
            const i = attr.findIndex(a => a[0] === name);
            if (i < 0) {
              return '';
            }
            return attr.splice(i, 1)[0][1];
          };

          // TODO: account for groove
          const frame = parseFloat(getAttr('Time'));
          if (isNaN(frame)) {
            throw new Error('Invalid time field in pattern note');
          }

          const volume = parseFloat(getAttr('Volume'));
          if (!isNaN(volume)) {
            events.volume(frame, num15to128(volume));
          }

          const thisInstrument = instrumentNameToIndex.get(getAttr('Instrument'));
          if (typeof thisInstrument === 'number') {
            if (thisInstrument !== lastInstrument) {
              events.instrument(frame, thisInstrument);
              lastInstrument = thisInstrument;
            }
          }

          const noteVal = parseNote(getAttr('Value'), octaveOffset);
          if (noteVal >= 0) {
            const duration = parseFloat(getAttr('Duration'));
            if (isNaN(duration)) {
              throw new Error('Note missing Duration');
            }
            let release = parseFloat(getAttr('Release'));
            if (isNaN(release)) {
              release = duration;
            }
            const attack = getAttr('Attack') !== 'False';
            events.note(frame, noteVal, duration, release, attack);
            // TODO: arpeggio
            // TODO: slide note
          }

          // TODO: handle unknown attrs: if (attr.length > 0) console.log(attr);
        }

        const evs = events.done();
        if (evs) {
          patternNameToIndex.set(patternName, patts.length);
          patts.push({ events: evs });
        } else {
          patternNameToIndex.set(patternName, -1);
        }
      }

      const insts: number[] = [];
      for (let i = 0; i < songLength; i++) {
        insts.push(-1);
      }
      const instances = channel.children.filter(c => c.name === 'PatternInstance');
      for (const instance of instances) {
        const time = parseFloat(instance.attributes.get('Time') ?? '');
        const patternName = instance.attributes.get('Pattern') ?? '';
        const index = patternNameToIndex.get(patternName);
        if (isNaN(time) || typeof index === 'undefined') {
          throw new Error('Invalid pattern instance');
        }
        insts[time] = index;
      }

      if (insts.some(i => i >= 0)) {
        chans.push({
          kind,
          patterns: patts,
          instances: insts,
        });
      }
    }
    out.songs.push({
      length: songLength,
      channels: chans
    });
  }

  return out;
}

function serializeOut(out: OutputFile): number[] {
  // serialize to bytes
  const bytes: number[] = [0x66, 0x61, 0x6d, 0x69]; // "fami"
  const write8 = (v: number) => bytes.push(v & 0xff);
  const align16 = () => { while (bytes.length & 1) write8(0); };
  const align32 = () => { while (bytes.length & 3) write8(0); };
  const write16 = (v: number) => { write8(v); write8(v >> 8); };
  const write32 = (v: number) => { write8(v); write8(v >> 8); write8(v >> 16); write8(v >> 24); };
  const rewrite8 = () => {
    const i = bytes.length;
    write8(0);
    return (v: number) => {
      bytes[i] = v & 0xff;
    };
  };
  const rewrite16 = () => {
    const i = bytes.length;
    write16(0);
    return (v: number) => {
      bytes[i] = v & 0xff;
      bytes[i + 1] = (v >> 8) & 0xff;
    };
  };
  const rewrite32 = () => {
    const i = bytes.length;
    write32(0);
    return (v: number) => {
      bytes[i] = v & 0xff;
      bytes[i + 1] = (v >> 8) & 0xff;
      bytes[i + 2] = (v >> 16) & 0xff;
      bytes[i + 3] = (v >> 24) & 0xff;
    };
  };

  write16(out.instruments.length);
  write16(out.songs.length);
  align32();
  const instrumentsOffset = rewrite32();
  const songsOffset = rewrite32();

  instrumentsOffset(bytes.length);
  const instRewrite = out.instruments.map(() => rewrite32());
  for (const instrument of out.instruments) {
    align32();
    instRewrite.shift()?.(bytes.length);
    write8(instrument.volumeMapping);
    write8(instrument.envelopes.length);
    write8(0); // reserved
    write8(0); // reserved
    const envRewrite = instrument.envelopes.map(() => rewrite32());
    for (const env of instrument.envelopes) {
      align32();
      envRewrite.shift()?.(bytes.length);
      write8(env.kind);
      write8(0); // reserved
      write16(env.loop);
      write16(env.release);
      write16(env.values.length);
      for (const v of env.values) {
        write8(v < 0 ? 256 + v : v);
      }
    }
  }

  align32();
  songsOffset(bytes.length);
  const songRewrite = out.songs.map(() => rewrite32());
  for (const song of out.songs) {
    align32();
    songRewrite.shift()?.(bytes.length);
    if (song.channels.length < 1) throw new Error('No channels');
    if (song.channels.length > 16) throw new Error('Too many channels');
    write8(song.channels.length - 1);
    write8(0); // reserved
    write16(song.length);
    const chanRewrite = song.channels.map(() => rewrite32());
    for (const channel of song.channels) {
      align32();
      chanRewrite.shift()?.(bytes.length);
      write8(channel.kind);
      write8(0); // reserved
      write16(channel.patterns.length);
      if (channel.instances.length !== song.length) {
        throw new Error("Instance length doesn't match song length");
      }
      for (const inst of channel.instances) {
        write16(inst);
      }
      const pattRewrite = channel.patterns.map(() => rewrite32());
      for (const pattern of channel.patterns) {
        align32();
        pattRewrite.shift()?.(bytes.length);
        for (const ev of pattern.events) {
          write16(ev);
        }
      }
    }
  }

  // end of file
  align32();
  return bytes;
}

// main program
const { inputFile, outputFile } = parseArgs();
const tree = parseFileIntoTree(await fs.readFile(inputFile, 'utf8'));
const out = parseTreeIntoOut(tree);
const bytes = serializeOut(out);
if (outputFile) {
  await fs.writeFile(outputFile, new Uint8Array(bytes));
} else {
  for (let i = 0; i < bytes.length; i += 16) {
    console.log(bytes.slice(i, i + 16).map(v => `0${v.toString(16)}`.substr(-2)).join(' '));
  }
  console.log(bytes.length, 'bytes');
}

/*
TODO:

DPCM samples:
- initial value (DmcInitialValueDiv2) 0-63 (I think), default 32
- data (bytes)
{GenerateAttribute("Name", sample.Name)}
{ConditionalGenerateAttribute("DmcInitialValue", sample.DmcInitialValueDiv2, sample.DmcInitialValueDiv2 != 32)}
{GenerateAttribute("Data", String.Join("", sample.ProcessedData.Select(x => $"{x:x2}")))}");

Instruments:
- DPCM Mapping

Arpeggios:
- Length: 0-?
- Loop point (optional)
- Values (int8_t[] comma separated)

note octaves are incorrect (surprise)
for Triangle, it's correct, ranging from C0-B7
everything else, it's off by one, ranging from C1-B8

Songs:
- Length
- LoopPoint
- PatternLength
- BeatLength
- NoteLength
- Groove? -- must use Groove to re-time events
*/
