// SPDX-License-Identifier: 0BSD
#include "Snd.hpp"
#include "Snd.iwram.hpp"
#include <stdlib.h>

#ifdef TESTS
#include <random>
#include <stdio.h>
static bool g_verbose;
#define log(fmt, ...) if (g_verbose) printf(fmt, ##__VA_ARGS__)
#else
#define log(fmt, ...)
#endif

Snd &Snd::reset() {
  return *this;
}

Snd &Snd::tick() {
  return *this;
}

#ifdef TESTS
static std::mt19937 rng(std::random_device{}());

static int rand(int size) {
  if (size <= 1) return 0;
  return std::uniform_int_distribution<int>(0, size - 1)(rng);
}

int Snd::test(bool verbose) {
  g_verbose = verbose;

/*
  example WAV parsing with IMA ADPCM compression

  FILE *fp = fopen("temp/accept.ima.wav", "rb");
  if (!fp) {
    log("failed to open\n");
    return 1;
  }
  fseek(fp, 0, SEEK_END);
  long size = ftell(fp);
  fseek(fp, 0, SEEK_SET);
  uint8_t *data = (uint8_t *)calloc(size, 1);
  uint8_t *dataEnd = &data[size];
  fread(data, 1, size, fp);
  fclose(fp);

  data += 4; // skip RIFF
  uint32_t fileSize = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  data += 8; // fileSize + WAVE
  uint16_t align;
  uint32_t sampleCount;
  while (data < dataEnd) {
    uint32_t chunkName = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    data += 4;
    uint32_t chunkSize = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
    data += 4;
    printf("%04x %c%c%c%c %d\n", chunkName, chunkName & 0xff, (chunkName >> 8) & 0xff,
      (chunkName >> 16) & 0xff, (chunkName >> 24) & 0xff, chunkSize);
    if (chunkName == 0x20746d66) { // "fmt "
      uint16_t comp = data[0] | (data[1] << 8);
      uint16_t channels = data[2] | (data[3] << 8);
      uint32_t rate = data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);
      uint32_t bps = data[8] | (data[9] << 8) | (data[10] << 16) | (data[11] << 24);
      align = data[12] | (data[13] << 8);
      uint16_t bitps = data[14] | (data[15] << 8);
      uint16_t ext = data[16] | (data[17] << 8);
      printf("comp %02X channels %d rate %d\n", comp, channels, rate);
      printf("bps %d align %d bitps %d ext %d\n", bps, align, bitps, ext);
    } else if (chunkName == 0x74636166) { // "fact"
      sampleCount = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
      printf("sampleCount? %d\n", sampleCount);
    } else if (chunkName == 0x61746164) { // "data"
      uint8_t *blockData = data;
      int16_t *output = (int16_t *)calloc(sampleCount, sizeof(int16_t));
      int16_t *outputPtr = output;
      int sampleLeft = sampleCount;
      while (sampleLeft > 0) {
        int state = sndAdpcmStateFromHeader(blockData);
        blockData += 4;
        *outputPtr++ = sndAdpcmFirstSample(state);
        sampleLeft--;
        if (sampleLeft <= 0) break;
        int outputCount = (align - 4) << 1;
        if (outputCount > sampleLeft) outputCount = sampleLeft;
        sndAdpcmOutputSet(state, blockData, outputPtr, outputCount, 16);
        // sndAdpcmOutput will advance blockData
        sampleLeft -= outputCount;
        outputPtr += outputCount;
      }
      fp = fopen("temp/accept.ima.raw", "wb");
      if (fp) {
        fwrite(output, sizeof(int16_t), sampleCount, fp);
        fclose(fp);
      }
    }
    data += chunkSize;
  }
*/

  return 0;
}
#endif
