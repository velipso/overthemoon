// SPDX-License-Identifier: 0BSD
#include "Snd.hpp"
#include "Snd.iwram.hpp"
#include <stdlib.h>

#ifdef TESTS
#include <random>
#include <stdio.h>
#include "data/songs/outro.hpp" // TODO: remove
#include <math.h> // TODO: remove
static bool g_verbose;
#define log(fmt, ...) if (g_verbose) printf(fmt, ##__VA_ARGS__)
#else
#define log(fmt, ...)
#endif

struct FamiHeader {
  uint16_t instrumentsLength;
  uint16_t songsLength;
  uint32_t instrumentsOffset;
  uint32_t songsOffset;
};

struct FamiInstrument {
  uint8_t volumeMapping;
  uint8_t envelopesLength;
  uint8_t reserved[2];
  uint32_t envelopesOffset[];
};

struct FamiEnvelope {
  uint8_t kind;
  uint8_t reserved;
  int16_t loop;
  int16_t release;
  uint16_t valuesLength;
  int8_t values[];
};

struct FamiSong {
  uint8_t channelsLength;
  uint8_t reserved;
  uint16_t songLength;
  uint32_t channelsOffset[];
};

struct FamiChannel {
  uint8_t kind;
  uint8_t reserved;
  uint16_t patternsLength;
  uint16_t instances[];
};

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

static void writeWAV(const char *file, int16_t *data, int size) {
  FILE *fp = fopen(file, "wb");
  #define U32(val)  do {            \
      uint32_t v = val;             \
      fputc(v & 0xff, fp);          \
      fputc((v >> 8) & 0xff, fp);   \
      fputc((v >> 16) & 0xff, fp);  \
      fputc((v >> 24) & 0xff, fp);  \
    } while (0)
  #define U16(val)  do {            \
      uint32_t v = val;             \
      fputc(v & 0xff, fp);          \
      fputc((v >> 8) & 0xff, fp);   \
    } while (0)
  U32(0x46464952);    // 'RIFF'
  U32(size * 2 + 36); // file size minus 'RIFF'
  U32(0x45564157);    // 'WAVE'
  U32(0x20746d66);    // 'fmt '
  U32(16);            // size of fmt chunk
  U16(1);             // audio format
  U16(1);             // mono
  U32(32768);         // sample rate
  U32(32768 * 2);     // bytes per second
  U16(2);             // block align
  U16(16);            // bits per sample
  U32(0x61746164);    // 'data'
  U32(size * 2);      // size of data chunk
  for (int i = 0; i < size; i++) {
    U16(data[i]);
  }
  #undef U32
  #undef U16
  fclose(fp);
}

static int16_t *g_out = NULL;
static int g_outSize = 0;
static int g_outTotal = 0;
static void push(int16_t v) {
  if (g_outSize >= g_outTotal) {
    g_outTotal += 2000;
    g_out = (int16_t *)realloc(g_out, sizeof(int16_t) * g_outTotal);
  }
  g_out[g_outSize++] = v;
}

int Snd::test(bool verbose) {
  g_verbose = verbose;

  int songIndex = 0;

  const uint8_t *fami = dataSongsOutro;

  const struct FamiHeader &header = *(const struct FamiHeader *)&fami[4];

  int instrumentsLength = header.instrumentsLength;
  int songsLength = header.songsLength;
  int songsOffset = header.songsOffset;

  printf("header: %d %d %08x %08x\n",
    instrumentsLength, songsLength, header.instrumentsOffset, songsOffset);

  // INSTRUMENTS
  const uint32_t *instrumentsOffset = (const uint32_t *)&fami[header.instrumentsOffset];
  for (int st = 0; st < instrumentsLength; st++) {
    const struct FamiInstrument &instrument =
      *(const struct FamiInstrument *)&fami[instrumentsOffset[st]];
    printf("instrument %d, volumeMapping %d, envelopesLength %d\n",
      st, instrument.volumeMapping, instrument.envelopesLength);
    for (int en = 0; en < instrument.envelopesLength; en++) {
      const struct FamiEnvelope &envelope =
        *(const struct FamiEnvelope *)&fami[instrument.envelopesOffset[en]];
      printf("  envelope %d, kind %d, loop %d, release %d, valuesLength %d\n",
        en, envelope.kind, envelope.loop, envelope.release, envelope.valuesLength);
      printf("   ");
      for (int v = 0; v < envelope.valuesLength; v++) {
        printf(" %d", envelope.values[v]);
      }
      printf("\n");
    }
  }

  // SONGS
  songsOffset += songIndex * 4;
  int songOffset = *(uint32_t *)&fami[songsOffset];

  const struct FamiSong &song = *(const struct FamiSong *)&fami[songOffset];

  int channelsLength = song.channelsLength + 1;
  int songLength = song.songLength;

  printf("channelsLength %d, songsLength %d\n", channelsLength, songLength);

  for (int ch = 0; ch < channelsLength; ch++) {
    const struct FamiChannel &channel = *(const struct FamiChannel *)&fami[song.channelsOffset[ch]];
    printf("channel %d, kind %d, patternsLength %d\n", ch, channel.kind, channel.patternsLength);

    const uint32_t *patternsOffset = (const uint32_t *)&fami[
      song.channelsOffset[ch] +
      sizeof(FamiChannel) +
      sizeof(uint16_t) * songLength
    ];
    for (int pa = 0; pa < channel.patternsLength; pa++) {
      printf("  pattern %d offset %08X", pa, patternsOffset[pa]);
      const uint16_t *events = (const uint16_t *)&fami[patternsOffset[pa]];
      for (int ev = 0; ; ev++) {
        if ((ev % 16) == 0) printf("\n   ");
        printf(" %02X", events[ev]);
        if (events[ev] == 0x8100) break; // PATEND
      }
      printf("\n");
    }
  }

  for (int i = 0; i < 20000; i++) {
    push(20000 * sin(i * 6.283185307179586 * 220.0 / 32768.0));
  }
  writeWAV("temp/sndout.wav", g_out, g_outSize);

/*
  example WAV parsing with IMA ADPCM compression

  ffmpeg -i input.wav \
    -ac 1 \
    -ar 32768 \
    -c:a adpcm_ima_wav \
    -map_metadata -1 \
    -fflags +bitexact \
    output.wav

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
