// SPDX-License-Identifier: 0BSD
#pragma once
#include "Oam.hpp"
#include "VramObj.hpp"
#include "types/gba/SprEntry.hpp"
#include <stdint.h>

struct Spr {
  Oam &oam;
  VramObj &vramObj;
  uint32_t avail[4];
  SprEntry entries[128];

  Spr &reset();
  Spr(Oam &oam, VramObj &vramObj) : oam(oam), vramObj(vramObj) { reset(); }
  int8_t alloc(int width, int height, uint8_t priority, bool is256);
  bool isEmpty();
  Spr &free(int8_t handle);
  int width(int8_t handle);
  int height(int8_t handle);
  SprEntry &entry(int8_t handle) {
    return entries[handle];
  }

#ifdef TESTS
  static int test(bool verbose);
#endif
};
