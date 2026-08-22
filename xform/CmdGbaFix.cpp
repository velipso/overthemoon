// SPDX-License-Identifier: 0BSD
#include "CmdGbaFix.hpp"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdint.h>

CmdGbaFix::CmdGbaFix() {
  Command::command = "gbafix";
  Command::about = "Fix the GBA header";
}

void CmdGbaFix::help() {
  printf(
    "* gbafix <input.gba> [-t title] [-g gamecode] [-m makercode] [-v version] [-p]\n\n"
    "Overwrites the GBA header of the input with the provided arguments, then\n"
    "calculates the correct CRC checksum.\n\n"
    "  <input.gba>    File to modify\n"
    "  -t title       Game title (12 char max)\n"
    "  -g gamecode    Game code (4 chars)\n"
    "  -m makercode   Maker code (2 chars)\n"
    "  -v version     Version (0-255)\n"
    "  -p             Pad ROM size to multiple of 2\n"
  );
}

static int gbafix(
  const char *input,
  const char *title,
  const char *gamecode,
  const char *makercode,
  int version,
  bool pad
) {
  FILE *fp = fopen(input, "r+b");

  int8_t header[0xc0];
  if (fread(&header, sizeof(header), 1, fp) != 1) {
    fclose(fp);
    fprintf(stderr, "\nFailed to read header: %s\n", input);
    return 1;
  }

  if (title) {
    for (int i = 0; title[i]; i++) {
      header[0xa0 + i] = title[i];
    }
  }
  if (gamecode) {
    for (int i = 0; gamecode[i]; i++) {
      header[0xac + i] = gamecode[i];
    }
  }
  if (makercode) {
    for (int i = 0; makercode[i]; i++) {
      header[0xb0 + i] = makercode[i];
    }
  }
  if (version >= 0 && version < 256) {
    header[0xbc] = version;
  }

  int8_t crc = 0;
  for (int n = 0xa0; n < 0xbd; n++) {
    crc += header[n];
  }
  header[0xbd] = -(0x19 + crc);
  fseek(fp, 0, SEEK_SET);
  fwrite(&header, sizeof(header), 1, fp);

  fseek(fp, 0, SEEK_END);
  long size = ftell(fp);
  if (pad) { // pad with 0xff to the next power of 2
    // round up to next power of 2
    long p = size;
    p--;
    p |= p >> 1;
    p |= p >> 2;
    p |= p >> 4;
    p |= p >> 8;
    p |= p >> 16;
    p++;

    if (size > 10000) {
      printf("ROM size: %ldK + %ld bytes padding = %ldK\n", size >> 10, p - size, p);
    } else {
      printf("ROM size: %ld bytes + %ld bytes padding = %ld bytes\n", size, p - size, p);
    }

    while (size < p) {
      fputc(0xff, fp);
      size++;
    }
  } else {
    if (size > 10000) {
      printf("ROM size: %ldK\n", size >> 10);
    } else {
      printf("ROM size: %ld bytes\n", size);
    }
  }

  fclose(fp);
  return 0;
}

int CmdGbaFix::main(int argc, const char **argv) {
  const char *input = NULL;
  const char *title = NULL;
  const char *gamecode = NULL;
  const char *makercode = NULL;
  int version = -1;
  bool pad = false;

  const char *err = "Invalid arguments";
  for (int i = 0; i < argc; i++) {
    if (strcmp(argv[i], "-t") == 0) {
      if (++i >= argc) { err = "Missing title after -t"; goto error; }
      if (title) { err = "Cannot set title -t more than once"; goto error; }
      title = argv[i];
      if (strlen(title) > 12) { err = "Title too long"; goto error; }
    } else if (strcmp(argv[i], "-g") == 0) {
      if (++i >= argc) { err = "Missing game code after -g"; goto error; }
      if (gamecode) { err = "Cannot set game code -g more than once"; goto error; }
      gamecode = argv[i];
      if (strlen(gamecode) != 4) { err = "Game code must be 4 characters"; goto error; }
    } else if (strcmp(argv[i], "-m") == 0) {
      if (++i >= argc) { err = "Missing maker code after -m"; goto error; }
      if (makercode) { err = "Cannot set maker code -m more than once"; goto error; }
      makercode = argv[i];
      if (strlen(makercode) != 2) { err = "Maker code must be 2 characters"; goto error; }
    } else if (strcmp(argv[i], "-v") == 0) {
      if (++i >= argc) { err = "Missing version after -v"; goto error; }
      if (version >= 0) { err = "Cannot set version -v more than once"; goto error; }
      version = atoi(argv[i]);
      if (version < 0 || version >= 256) { err = "Version must be 0-255"; goto error; }
    } else if (strcmp(argv[i], "-p") == 0) {
      pad = true;
    } else {
      if (input) { err = "Cannot have multiple inputs"; goto error; }
      input = argv[i];
    }
  }

  printf(
    "Fixing GBA header:\n"
    "  input:      %s\n"
    "  title:      %s\n"
    "  game code:  %s\n"
    "  maker code: %s\n"
    "  version:    %d\n"
    "  padding:    %s\n",
    input, title, gamecode, makercode, version, pad ? "enabled" : "disabled"
  );

  return gbafix(input, title, gamecode, makercode, version, pad);
error:
  fprintf(stderr, "\nError: %s\n", err);
  return 1;
}
