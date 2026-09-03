// SPDX-License-Identifier: 0BSD
#pragma once
#include <stdint.h>

struct SndChannel {
  int16_t state;
  int16_t duration;
  int16_t release;
  int16_t volume;
  int16_t volumeSlideStep;
  int16_t volumeSlideTarget;
  int16_t pitch;
  int16_t pitchSlideStep;
  int16_t pitchSlideTarget;
  int16_t phase;
};

struct Snd {
#ifdef PLATFORM_GBA
  int8_t bufferDMA[1216];
#endif
  int16_t bufferTemp[552];
  int frameCount;
  int dmaWriteIndex;
  int masterVolume; // 0-16
  int sfxVolume; // 0-16
  int songVolume; // 0-16

  static constexpr uint16_t sampleCounts[32] = {
    // sample rate is 32768 samples/sec, or 1 sample every 512 cycles, so target samples per frame:
    // 280896 cycles per frame / 512 cycles per sample = 548.625 samples per frame
    // this is spread over 32 frames, most frames having 548 samples, but some having 552 samples:
    548, 548, 548, 548, 548, 548, 552,
    548, 548, 548, 548, 548, 552,
    548, 548, 548, 548, 548, 548, 552,
    548, 548, 548, 548, 548, 552,
    548, 548, 548, 548, 548, 552,
  };

  Snd &reset();
  Snd() { reset(); }
  Snd &tick();

#ifdef TESTS
  static int test(bool verbose);
#endif
};
