// SPDX-License-Identifier: 0BSD
#pragma once
#include <stdint.h>

extern const uint8_t ctz32_bitpos[32];

static inline int ctz32(uint32_t v) {
  if (v == 0) return 32;
  return ctz32_bitpos[((v & -v) * 0x077cb531) >> 27];
}
