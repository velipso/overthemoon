// SPDX-License-Identifier: 0BSD
#include "CmdPalette256.hpp"
extern "C" {
  #include "stb_image.h"
}
#include <stdio.h>
#include <string.h>
#include <stdint.h>

typedef uint32_t u32;
typedef uint16_t u16;

CmdPalette256::CmdPalette256() {
  Command::command = "palette256";
  Command::about = "Extract and collect colors from PNG files";
}

void CmdPalette256::help() {
  printf(
    "* palette256 -o <output.bin> <input.png>+ ...\n\n"
    "Scans the PNG files, converts colors to RGB555, and outputs the final\n"
    "palette to <output.bin>.\n\n"
    "  -o <output.bin>  Output file\n"
    "  <input.png>+     One or more input PNG files\n"
  );
}

static int addpalette(const char *input, u16 *palette, int *nextpal, int maxpal) {
  FILE *fp = fopen(input, "rb");
  int width, height;
  u32 *data = (u32 *)stbi_load_from_file(fp, &width, &height, NULL, 4);
  fclose(fp);
  if (data == NULL) {
    fprintf(stderr, "\nFailed to read: %s\n", input);
    return 1;
  }
  printf("Reading image: %s\n", input);
  for (int i = 0; i < width * height; i++) {
    u32 color = data[i];
    int r = (color >> 0) & 0xff;
    int g = (color >> 8) & 0xff;
    int b = (color >> 16) & 0xff;
    int a = (color >> 24) & 0xff;
    if (a != 0xff) {
      continue;
    }
    u16 rgb = (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
    bool found = false;
    for (int j = 1; j < *nextpal && !found; j++) {
      found = palette[j] == rgb;
    }
    if (!found) {
      if (*nextpal >= maxpal) {
        fprintf(stderr, "\nOut of palette space!\n");
        return 1;
      }
      palette[*nextpal] = rgb;
      *nextpal = *nextpal + 1;
    }
  }
  stbi_image_free(data);
  return 0;
}

int CmdPalette256::main(int argc, const char **argv) {
  const char *output = NULL;
  u16 palette[256] = {0};
  int nextpal = 1;
  FILE *fp;

  for (int i = 0; i < argc; i++) {
    if (strcmp(argv[i], "-o") == 0) {
      if (++i >= argc) {
        fprintf(stderr, "\nError: Missing output file after -o\n");
        return 1;
      }
      if (output) {
        fprintf(stderr, "\nError: Cannot set output file -o more than once\n");
        return 1;
      }
      output = argv[i];
    } else {
      int res = addpalette(argv[i], palette, &nextpal, 256);
      if (res != 0) {
        return res;
      }
    }
  }

  if (!output) {
    help();
    fprintf(stderr, "\nMissing output file (-o)\n");
    return 1;
  }

  printf("Palette size: %d colors\n", nextpal);
  fp = fopen(output, "wb");
  if (fp == NULL) {
    fprintf(stderr, "\nError: Failed to write: %s\n", output);
    return 1;
  }
  fwrite(palette, sizeof(palette), 1, fp);
  fclose(fp);
  return 0;
}
