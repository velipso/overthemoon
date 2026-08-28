// SPDX-License-Identifier: 0BSD
#include "CmdCopyTiles256.hpp"
extern "C" {
  #include "stb_image.h"
}
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

typedef uint32_t u32;
typedef uint16_t u16;
typedef uint8_t u8;

CmdCopyTiles256::CmdCopyTiles256() {
  Command::command = "copyTiles256";
  Command::about = "Copy tiles out of a PNG file into a binary file";
}

void CmdCopyTiles256::help() {
  printf(
    "* copyTiles256 -p <palette.bin> -o <output.bin> <input.8x8.png>\n\n"
    "Reads the PNG file, converts colors according to palette, and outputs\n"
    "pixel data to <output.bin>.\n\n"
    "The input filename MUST contain the tile scanning size prior to the\n"
    ".png extension (i.e., foo.8x8.png or bar.12x16.png).\n\n"
    "  -p <palette.bin>  GBA 256 color palette\n"
    "  -o <output.bin>   Output file\n"
    "  <input.8x8.png>   Input PNG files with tile dimensions in filename\n"
  );
}

static int copyTiles256(
  uint16_t *palette,
  int paletteSize,
  const char *outputFile,
  const char *inputFile,
  int tileWidth,
  int tileHeight
) {
  FILE *fp = fopen(inputFile, "rb");
  int width, height;
  u32 *data = (u32 *)stbi_load_from_file(fp, &width, &height, NULL, 4);
  u8 *out = NULL;
  int result = 0;
  fclose(fp);
  if (data == NULL) {
    fprintf(stderr, "\nFailed to read: %s\n", inputFile);
    return 1;
  }

  printf("Reading image (dimensions %dx%d): %s\n", width, height, inputFile);
  int tileCountW = width / tileWidth;
  int tileCountH = height / tileHeight;
  if ((width % tileWidth) != 0 || (height % tileHeight) != 0) {
    fprintf(
      stderr,
      "\nError: Image dimensions (%dx%d) are not a multiple of tile dimensions (%dx%d)\n",
      width, height, tileWidth, tileHeight
    );
    result = 1;
    goto cleanup;
  }

  out = (u8 *)malloc(width * height);
  for (int ty = 0, i = 0; ty < tileCountH; ty++) {
    for (int tx = 0; tx < tileCountW; tx++) {
      for (int py = 0; py < tileHeight; py++) {
        int sy = ty * tileHeight + py;
        for (int px = 0; px < tileWidth; px++) {
          int sx = tx * tileWidth + px;
          u32 color = data[sx + sy * width];
          int r = (color >> 0) & 0xff;
          int g = (color >> 8) & 0xff;
          int b = (color >> 16) & 0xff;
          int a = (color >> 24) & 0xff;

          u8 c = 0;
          if (a == 0xff) {
            // find color in palette
            r >>= 3;
            g >>= 3;
            b >>= 3;
            u16 rgb = r | (g << 5) | (b << 10);
            bool found = false;
            for (int i = 0; i < paletteSize; i++) {
              if (palette[i] == rgb) {
                c = i;
                found = true;
                break;
              }
            }
            if (!found) {
              fprintf(
                stderr,
                "\nError: Image contains color (%d, %d, %d), but palette doesn't\n",
                r, g, b
              );
              result = 1;
              goto cleanup;
            }
          }

          out[i++] = c;
        }
      }
    }
  }

  fp = fopen(outputFile, "wb");
  if (!fp) {
    fprintf(stderr, "\nError: Failed to write to output file: %s\n", outputFile);
    result = 1;
    goto cleanup;
  }
  fwrite(out, 1, width * height, fp);
  fclose(fp);

cleanup:
  if (out) free(out);
  if (data) stbi_image_free(data);
  return result;
}

int CmdCopyTiles256::main(int argc, const char **argv) {
  const char *paletteFile = NULL;
  const char *outputFile = NULL;
  const char *inputFile = NULL;

  for (int i = 0; i < argc; i++) {
    if (strcmp(argv[i], "-p") == 0) {
      if (++i >= argc) {
        fprintf(stderr, "\nError: Missing palette file after -p\n");
        return 1;
      }
      if (paletteFile) {
        fprintf(stderr, "\nError: Cannot set palette file -p more than once\n");
        return 1;
      }
      paletteFile = argv[i];
    } else if (strcmp(argv[i], "-o") == 0) {
      if (++i >= argc) {
        fprintf(stderr, "\nError: Missing output file after -o\n");
        return 1;
      }
      if (outputFile) {
        fprintf(stderr, "\nError: Cannot set output file -o more than once\n");
        return 1;
      }
      outputFile = argv[i];
    } else {
      if (inputFile) {
        fprintf(stderr, "\nError: Cannot have multiple input files\n");
        return 1;
      }
      inputFile = argv[i];
    }
  }

  if (!paletteFile) {
    help();
    fprintf(stderr, "\nMissing palette file (-p)\n");
    return 1;
  }
  if (!outputFile) {
    help();
    fprintf(stderr, "\nMissing output file (-o)\n");
    return 1;
  }
  if (!inputFile) {
    help();
    fprintf(stderr, "\nMissing input file\n");
    return 1;
  }

  // parse inputFile dimensions
  int lastPeriod1 = -1;
  int lastPeriod2 = -1;
  for (int i = 0; inputFile[i]; i++) {
    if (inputFile[i] == '.') {
      lastPeriod2 = lastPeriod1;
      lastPeriod1 = i;
    }
  }
  if (lastPeriod2 < 0) {
    fprintf(
      stderr,
      "\nError: Invalid input file; must be in format of \"foo.8x8.png\", instead got: %s\n",
      inputFile
    );
    return 1;
  }

  int width = 0;
  int height = 0;
  int state = 0;
  for (int i = lastPeriod2 + 1; i < lastPeriod1; i++) {
    char ch = inputFile[i];
    int digit = ch >= '0' && ch <= '9' ? ch - '0' : -1;
    switch (state) {
      case 0: // start width
        if (digit >= 0) {
          width = digit;
          state = 1;
        } else {
          goto fail;
        }
        break;
      case 1: // more width
        if (digit >= 0) {
          width = width * 10 + digit;
        } else if (ch == 'x') {
          state = 2;
        } else {
          goto fail;
        }
        break;
      case 2: // start height
        if (digit >= 0) {
          height = digit;
          state = 3;
        } else {
          goto fail;
        }
        break;
      case 3: // more height
        if (digit >= 0) {
          height = height * 10 + digit;
        } else {
          goto fail;
        }
        break;
    }
  }
  if (state != 3 || width <= 0 || height <= 0) {
fail:
    fprintf(
      stderr,
      "\nError: Invalid input file; must be in format of \"foo.8x8.png\", instead got: %s\n",
      inputFile
    );
    return 1;
  }

  FILE *fp = fopen(paletteFile, "rb");
  if (!fp) {
    fprintf(stderr, "\nError: Failed to read palette: %s\n", paletteFile);
    return 1;
  }
  fseek(fp, 0, SEEK_END);
  long paletteBytes = ftell(fp);
  fseek(fp, 0, SEEK_SET);
  if ((paletteBytes & 1) || paletteBytes > 512) {
    fclose(fp);
    fprintf(stderr, "\nError: Palette file is bad size: %s\n", paletteFile);
    return 1;
  }
  uint16_t palette[256];
  int paletteSize = paletteBytes >> 1;
  fread(palette, sizeof(uint16_t), paletteSize, fp);
  fclose(fp);

  return copyTiles256(palette, paletteSize, outputFile, inputFile, width, height);
}
