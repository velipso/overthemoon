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

function printUsage(error?: string): never {
  console.log(
    'Usage: node embed.ts -o <output> -n <path> <input.bin>\n\n' +
    'Uses path and filename of input.bin to write HPP/CPP files that embed the\n' +
    'binary data into a constant.\n\n' +
    '-o <output>  Output file (content depends on output extension)\n\n' +
    '-n <path>    Relative directory for naming identifier\n' +
    '             Ex: -n root/tgt/ root/tgt/data/palette.bin\n' +
    '             Identifier is named from input filename relative to "root/tgt/",\n' +
    '             so from "data/palette.bin" which becomes "dataPaletteBin"\n\n' +
    '<input>      Input binary file (file does not need to exist,\n' +
    '             only the path and filename are used)'
  );
  if (error) {
    console.error('\nError: %s', error);
  }
  process.exit(error ? 1 : 0);
}

const args = process.argv.slice(2);
if (args.length <= 0) {
  printUsage();
}

const outputFiles: { outputFile: string; ext: 'hpp' | 'cpp' }[] = [];
let inputFile: string | null = null;
let nameDir: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o') {
    i++;
    if (i >= args.length) {
      printUsage('Missing output file after -o');
    }
    const ext = args[i].replace(/^.*\.([^.]+)$/, '$1');
    if (ext !== 'hpp' && ext !== 'cpp') {
      printUsage(`Invalid output file extension: ${args[i]}`);
    }
    outputFiles.push({ outputFile: args[i], ext });
  } else if (args[i] === '-n') {
    i++;
    if (i >= args.length) {
      printUsage('Missing name path after -n');
    }
    if (typeof nameDir === 'string') {
      printUsage('Cannot specify multiple name paths with -n');
    }
    nameDir = args[i];
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

for (const { outputFile, ext } of outputFiles) {
  const input = path.relative(path.dirname(outputFile), inputFile);
  const { name } = path.parse(inputFile);
  const identPath = nameDir
    ? path.relative(nameDir, inputFile)
    : path.basename(inputFile);
  const identParts = identPath.split(path.sep).filter((p: string) => p !== '.' && p !== '..');
  const last = identParts.length - 1;
  if (!identParts[last].startsWith('.')) {
    identParts[last] = identParts[last].replace(/\.[^\/.]+$/, '');
  }
  for (let i = 1; i < identParts.length; i++) {
    const sub = identParts[i].split(/[^a-zA-Z0-9_]/g);
    identParts[i] = sub.map((s: string) => `${s.charAt(0).toUpperCase()}${s.substr(1)}`).join('');
  }
  const ident = identParts.join('');
  switch (ext) {
    case 'hpp':
      await fs.writeFile(outputFile,
        `// generated via scripts/embed.ts\n` +
        `#include <stdint.h>\n\n` +
        `extern "C" {\n` +
        `  alignas(4) extern const uint8_t ${ident}[];\n` +
        `  extern const uint32_t ${ident}Size;\n` +
        `}\n`
      );
      break;
    case 'cpp':
      await fs.writeFile(outputFile,
        `// generated via scripts/embed.ts\n` +
        `#include "${path.basename(outputFile).replace(/\.cpp$/, '.hpp')}"\n\n` +
        `extern "C" alignas(4) const uint8_t ${ident}[] = {\n` +
        `  #embed "${input}"\n` +
        `};\n\n` +
        `extern "C" const uint32_t ${ident}Size = sizeof(${ident});\n`
      );
      break;
    default:
      throw new Error(`Invalid output file extension: ${ext}`);
  }
}
