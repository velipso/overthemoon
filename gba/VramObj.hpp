// SPDX-License-Identifier: 0BSD
//
// Tracks usage of VRAM for object tile data.
//
// Example:
//
// VramObj vramObj; // declare global
// // ...later
// int16_t handle = vramObj.alloc256(16, 8); // 8bpp
// // or you can use vramObj.alloc16(W, H) for 4bpp
// if (handle < 0) {
//   // out of memory!
// } else {
//   int width  = VramObj::width(handle);             // returns 16
//   int height = VramObj::height(handle);            // returns 8
//   bool is256 = VramObj::is256(handle);             // return true
//   int tile   = VramObj::tile(handle);              // tile number
//   uint16_t oam0 = VramObj::oamAttr0(handle);       // encodes 256col flag + shape bits (from w/h)
//   uint16_t oam1 = VramObj::oamAttr1(handle);       // encodes size bits (from w/h)
//   uint16_t oam2 = VramObj::oamAttr2(handle);       // encodes tile number
//   int bytes  = VramObj::bytes(handle);             // size of tile data to copy
//   volatile uint16_t *dst = VramObj::addr(handle);  // VRAM destination address
//   memcpy32(dst, tileData, bytes);
//   // or, more easily:
//   VramObj::copy(handle, tileData);                 // copies tileData to VRAM using memcpy32
//   vramObj.free(handle);                            // free the handle when finished
// }
//
#pragma once
#ifndef TESTS
#include "mem.hpp"
#endif
#include <stdint.h>

struct VramObj {
  uint32_t avail[32]; // 1024 bits, for each 4bpp 8x8 cell in VRAM

  VramObj &reset(); // frees all memory
  VramObj() { reset(); }
  VramObj &resetBitmap(); // reserves first 512 tiles, frees second 512 tiles (for bitmap modes 3-5)
  bool isEmpty();
  bool isEmptyBitmap();
  bool isFull();
  int16_t alloc(int slots, int mask); // returns a handle or -1 for out of memory
  VramObj &free(int16_t handle);

  //
  // handle is in format:
  //
  //   0ZZH:HCTT:TTTT:TTTT
  //   T - tile number (0-1023)
  //   C - 256 color flag
  //   H - OAM shape (0 square, 1 horizontal, 2 vertical, 3 prohibited)
  //   Z - OAM size (0-3)
  //
  // NOTE: the gba/Oam.hpp code relies on this exact format!

  static int sizeMask(int width, int height) {
    // uses goofy GBA encoding, lower 2 bits for OAM attribute 0, upper 2 bits for OAM attribute 1
    if        (width  ==  8) {
      if      (height ==  8) return 0;
      else if (height == 16) return 2;
      else if (height == 32) return 6;
    } else if (width  == 16) {
      if      (height ==  8) return 1;
      else if (height == 16) return 4;
      else if (height == 32) return 10;
    } else if (width  == 32) {
      if      (height ==  8) return 5;
      else if (height == 16) return 9;
      else if (height == 32) return 8;
      else if (height == 64) return 14;
    } else if (width  == 64) {
      if      (height == 32) return 13;
      else if (height == 64) return 12;
    }
    return -1;
  }

  static bool validSize(int width, int height) {
    return sizeMask(width, height) >= 0;
  }

  int16_t alloc256(int width, int height) { // width and height are in pixels, must be valid GBA size
    int s = sizeMask(width, height);
    if (s < 0) return -1;
    width >>= 3;
    height >>= 3;
    return alloc(width * height * 2, (s << 11) | 0x0400);
  }

  int16_t alloc16(int width, int height) { // width and height are in pixels, must be valid GBA size
    int s = sizeMask(width, height);
    if (s < 0) return -1;
    width >>= 3;
    height >>= 3;
    return alloc(width * height, s << 11);
  }

  int16_t alloc(int width, int height, bool is256) {
    return is256
      ? alloc256(width, height)
      : alloc16(width, height);
  }

  static int tile(int16_t handle) {
    return handle & 0x3ff;
  }

  static bool is16(int16_t handle) {
    return (handle & 0x0400) == 0;
  }

  static bool is256(int16_t handle) {
    return (handle & 0x0400) != 0;
  }

  static int tileWidth(int16_t handle) {
    const int widths[] = { 1, 2, 1, -1, 2, 4, 1, -1, 4, 4, 2, -1, 8, 8, 4, -1 };
    return widths[(handle >> 11) & 15];
  }

  static int width(int16_t handle) {
    return tileWidth(handle) << 3;
  }

  static int tileHeight(int16_t handle) {
    const int heights[] = { 1, 1, 2, -1, 2, 1, 4, -1, 4, 2, 4, -1, 8, 4, 8, -1 };
    return heights[(handle >> 11) & 15];
  }

  static int height(int16_t handle) {
    return tileHeight(handle) << 3;
  }

  static uint16_t oamAttr0(int16_t handle) {
    // handle already puts 256 bit flag next to shape bits
    return ((handle >> 10) & 7) << 13;
  }

  static uint16_t oamAttr1(int16_t handle) {
    return ((handle >> 12) & 3) << 14;
  }

  static uint16_t oamAttr2(int16_t handle) {
    return tile(handle);
  }

  static uint16_t *addr(int16_t handle) {
    return reinterpret_cast<uint16_t *>(uintptr_t{0x06010000u} + (tile(handle) << 5));
  }

  static int bytes(int16_t handle) {
    return (width(handle) * height(handle)) >> (is256(handle) ? 0 : 1);
  }

#ifndef TESTS
  static __attribute__((always_inline)) inline void copy(int16_t handle, const void *src) {
    memcpy32(addr(handle), src, bytes(handle));
  }
#endif

#ifdef TESTS
  static int test(bool verbose);
#endif
};
