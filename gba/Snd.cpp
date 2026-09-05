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
  uint32_t magic;
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
  int16_t instances[];
};

struct SndChannel {
  const uint16_t *events;
  const FamiInstrument *instrument;
  struct {
    int cursor;
    int value;
  } env[8];
  int wait;

  void reset(const uint16_t *ev) {
    events = ev;
    instrument = nullptr;
    wait = 0;
  }

  const FamiEnvelope *famiEnvelope(int en) {
    return instrument
      ? (const FamiEnvelope *)&(((const uint8_t *)instrument)[instrument->envelopesOffset[en]])
      : nullptr;
  }

  void famiInstrument(const FamiInstrument *finst) {
    instrument = finst;
    if (!instrument) return;
    for (int en = 0; en < instrument->envelopesLength; en++) {
      const FamiEnvelope *fenv = famiEnvelope(en);
      env[en].cursor = 0;
      env[en].value = fenv->values[0];
    }
  }
};

struct SndSong {
  const FamiHeader &fami;
  const FamiSong &song;
  int frame;
  SndChannel channels[16];

  SndSong(const FamiHeader &fami, const FamiSong &song) : fami(fami), song(song) {
    loadColumn(0);
  }

  const uint8_t *root() {
    return (const uint8_t *)&fami;
  }

  void loadColumn(int column) {
    frame = 0;

    for (int ch = 0; ch < 16; ch++) {
      if (ch > song.channelsLength) { // channelsLength is off by one (intentional)
        channels[ch].reset(nullptr);
        continue;
      }

      const FamiChannel &channel = *(const FamiChannel *)&root()[song.channelsOffset[ch]];
      int pa = channel.instances[column];
      if (pa < 0) {
        channels[ch].reset(nullptr);
        continue;
      }

      const uint32_t *patternsOffset = (const uint32_t *)&root()[
        song.channelsOffset[ch] +
        sizeof(FamiChannel) +
        sizeof(uint16_t) * song.songLength
      ];

      channels[ch].reset((const uint16_t *)&root()[patternsOffset[pa]]);
    }
  }

  void tick() {
    bool patternEnd = false;

    for (int ch = 0; ch < 16; ch++) {
      SndChannel &channel = channels[ch];
      if (!channel.events) continue;
      if (channel.wait > 0) {
        channel.wait--;
        continue;
      }
      for (;;) {
        uint16_t ev = *channel.events++;
        if ((ev & 0x8000) == 0) {
          // double-payload
          uint16_t e2 = *channel.events++;
          int note = ev >> 8;
          int release = (ev & 0xff) | ((e2 >> 3) & 0x700);
          int duration = e2 & 0x7ff;
          bool attack = (e2 & 0x8000) != 0;
          bool autowait = (e2 & 0x4000) != 0;
          log("[%d] NOTE %d/%d/%d %s%s\n",
            ch, note, release, duration, attack ? "A" : "x", autowait ? "W" : "x");
          if (autowait) {
            channel.wait += duration;
            goto next_channel;
          }
        } else {
          // single-payload
          int param = ev & 0xff;
          switch ((ev >> 8) & 0x7f) {
            case 0x00: // WAIT
              log("[%d] WAIT\n", ch);
              channel.wait += param + 1;
              goto next_channel;
            case 0x01: // PATEND
              log("[%d] PATEND\n", ch);
              patternEnd = true;
              goto next_channel;
            case 0x02: // INST1
set_instrument:;
              log("[%d] INST %d\n", ch, param);
              {
                const uint32_t *instrumentsOffset =
                  (const uint32_t *)&root()[fami.instrumentsOffset];
                channel.famiInstrument((const FamiInstrument *)&root()[instrumentsOffset[param]]);
              }
              break;
            case 0x03: // INST2
              param += 256;
              goto set_instrument;
            case 0x04: // VOL
              log("[%d] VOL %d\n", ch, param);
              break;
          }
        }
      }
next_channel:;
    }

    if (patternEnd) {
      log("pattern end\n");
    }
  }
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

  const FamiHeader &header = *(const FamiHeader *)fami;

  int instrumentsLength = header.instrumentsLength;
  int songsLength = header.songsLength;
  int songsOffset = header.songsOffset;

  printf("header: %08x %d %d %08x %08x\n",
    header.magic, instrumentsLength, songsLength, header.instrumentsOffset, songsOffset);

  // INSTRUMENTS
  const uint32_t *instrumentsOffset = (const uint32_t *)&fami[header.instrumentsOffset];
  for (int st = 0; st < instrumentsLength; st++) {
    const FamiInstrument &instrument =
      *(const FamiInstrument *)&fami[instrumentsOffset[st]];
    printf("instrument %d, volumeMapping %d, envelopesLength %d\n",
      st, instrument.volumeMapping, instrument.envelopesLength);
    for (int en = 0; en < instrument.envelopesLength; en++) {
      const FamiEnvelope &envelope =
        *(const FamiEnvelope *)&(((const uint8_t *)&instrument)[instrument.envelopesOffset[en]]);
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

  const FamiSong &song = *(const FamiSong *)&fami[songOffset];

  int channelsLength = song.channelsLength + 1;
  int songLength = song.songLength;

  printf("channelsLength %d, songsLength %d\n", channelsLength, songLength);

  for (int ch = 0; ch < channelsLength; ch++) {
    const FamiChannel &channel = *(const FamiChannel *)&fami[song.channelsOffset[ch]];
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

  SndSong sndSong(header, song);
  for (int t = 0; t < 100; t++) {
    printf("tick\n");
    sndSong.tick();
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
