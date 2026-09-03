// SPDX-License-Identifier: 0BSD
#pragma once
#include <stdint.h>

void sndAdpcmOutputSet(int &state, uint8_t *&data, int16_t *output, int count, int volume);
void sndAdpcmOutputAdd(int &state, uint8_t *&data, int16_t *output, int count, int volume);

static inline int sndAdpcmStateFromHeader(uint8_t *data) {
  int index = data[2];
  if (index > 88) index = 88;
  return data[0] | (data[1] << 8) | (index << 16);
}

static inline int16_t sndAdpcmFirstSample(int state) {
  return (int16_t)(state & 0xffff);
}
