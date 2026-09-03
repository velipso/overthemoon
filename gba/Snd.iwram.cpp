// SPDX-License-Identifier: 0BSD
#include "Snd.iwram.hpp"

static const int16_t adpcmStepSize[] = {
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73,
  80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494,
  544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499,
  2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487,
  12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767
};

static const int8_t adpcmIndex[] = { -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8 };

void sndAdpcmOutputSet(
  int &state,
  uint8_t *&data,
  int16_t *output,
  int count,
  int volume
) {
  int sample = (int16_t)(state & 0xffff);
  int index = (state >> 16) & 0x7f;
  bool secondHalf = state & 0x800000;
  while (count > 0) {
    int nibble;
    if (secondHalf) {
      nibble = *data >> 4;
      data++;
    } else {
      nibble = *data & 15;
    }
    secondHalf = !secondHalf;

    int stepSize = adpcmStepSize[index];
    index += adpcmIndex[nibble];
    if (index < 0) index = 0;
    else if (index > 88) index = 88;

    int difference = 0;
    if (nibble & 4) difference += stepSize;
    if (nibble & 2) difference += stepSize >> 1;
    if (nibble & 1) difference += stepSize >> 2;
    difference += stepSize >> 3;
    if (nibble & 8) difference = -difference;
    sample += difference;
    if (sample > 32767) sample = 32767;
    else if (sample < -32768) sample = -32768;

    *output++ = (sample * volume) >> 4; // SET
    count--;
  }
  state = (secondHalf ? 0x800000 : 0) | (index << 16) | sample;
}

void sndAdpcmOutputAdd(
  int &state,
  uint8_t *&data,
  int16_t *output,
  int count,
  int volume
) {
  int sample = (int16_t)(state & 0xffff);
  int index = (state >> 16) & 0x7f;
  bool secondHalf = state & 0x800000;
  while (count > 0) {
    int nibble;
    if (secondHalf) {
      nibble = *data >> 4;
      data++;
    } else {
      nibble = *data & 15;
    }
    secondHalf = !secondHalf;

    int stepSize = adpcmStepSize[index];
    index += adpcmIndex[nibble];
    if (index < 0) index = 0;
    else if (index > 88) index = 88;

    int difference = 0;
    if (nibble & 4) difference += stepSize;
    if (nibble & 2) difference += stepSize >> 1;
    if (nibble & 1) difference += stepSize >> 2;
    difference += stepSize >> 3;
    if (nibble & 8) difference = -difference;
    sample += difference;
    if (sample > 32767) sample = 32767;
    else if (sample < -32768) sample = -32768;

    *output++ += (sample * volume) >> 4; // ADD
    count--;
  }
  state = (secondHalf ? 0x800000 : 0) | (index << 16) | sample;
}
