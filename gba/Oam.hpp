// SPDX-License-Identifier: 0BSD
//
// Creates a shadow OAM and allows allocation of entries and rotation slots.
//
// Sorts shadow OAM according to priority (uint8_t), where top 2 bits determine GBA priority.
//
// Example:
//
// Oam oam; // declare global
//
// // in every vblank, copy the shadow OAM to the hardware OAM:
// oam.copy();
//
// // usage:
// int8_t handle = oam.alloc(123); // sets priority to 123
// if (handle < 0) {
//   // out of memory!
// } else {
//   oam.priority(handle, 98);     // re-sorts shadow OAM
//
//   // first API for small quick updates (handle is first parameter):
//   oam
//     .x(handle, 5)               // writes to shadow OAM immediately
//     .y(handle, 10);             // writes to shadow OAM immediately
//
//   // second API for more changes (don't have to type handle every time):
//   oam.handle(handle)            // copies shadow OAM entry to work on
//     .x(5)                       // updates copy
//     .y(10)                      // updates copy...
//     .tile(5)
//     .palette(3)
//     .done();                    // writes changes to shadow OAM
//
//   oam.free(handle);             // free the handle when finished
// }
//
// // ...rotation slots are tracked too:
// int8_t handle = oam.alloc(123); // regular OAM entry
// int8_t rot = oam.allocRotate(); // rotation index
// if (rot < 0) {
//   // out of rotation slots!
// } else {
//   oam.rotateIndex(handle, rot); // sets rotation index to the slot
//   oam.rotateIndex(handle, -1);  // removes the rotation index
//   oam.freeRotate(rot);          // free the rotation slot when finished
// }
#pragma once
#ifndef TESTS
#include "mem.hpp"
#endif
#include <stdint.h>

struct OamHandle;

static inline int oamGetY(uint16_t shadow0) {
  return shadow0 & 0xff;
}

static inline uint16_t oamSetY(uint16_t shadow0, int value) {
  return (shadow0 & 0xff00) | (value & 0xff);
}

static inline int oamGetRotateIndex(uint16_t shadow0, uint16_t shadow1) {
  if (shadow0 & 0x0100) {
    return (shadow1 >> 8) & 0x1f;
  }
  return -1;
}

static inline void oamSetRotateIndex(
  uint16_t *shadow0,
  uint16_t *shadow1,
  int8_t index,
  bool doubleSize
) {
  if (index >= 0) {
    *shadow0 = (*shadow0 & 0xfcff) | (doubleSize ? 0x0300 : 0x0100);
    *shadow1 = (*shadow1 & 0xc1ff) | (index << 9);
  } else {
    *shadow0 &= 0xfcff;
    *shadow1 &= 0xc1ff;
  }
}

static inline bool oamGetShow(uint16_t shadow0) {
  return (shadow0 & 0x0100) || !(shadow0 & 0x0200);
}

static inline uint16_t oamSetShow(uint16_t shadow0, bool value) {
  if (value) {
    if (!(shadow0 & 0x0100)) {
      return shadow0 & 0xfdff;
    } else {
      return shadow0;
    }
  } else {
    return (shadow0 & 0xfcff) | 0x0200;
  }
}

static inline int oamGetMode(uint16_t shadow0) {
  return (shadow0 >> 10) & 3;
}

static inline uint16_t oamSetMode(uint16_t shadow0, int value) {
  return (shadow0 & 0xf3ff) | ((value & 3) << 10);
}

static inline bool oamGetMosaic(uint16_t shadow0) {
  return !!(shadow0 & 0x1000);
}

static inline uint16_t oamSetMosaic(uint16_t shadow0, bool value) {
  return value
    ? (shadow0 | 0x1000)
    : (shadow0 & 0xefff);
}

static inline bool oamGetIs256(uint16_t shadow0) {
  return !!(shadow0 & 0x2000);
}

static inline uint16_t oamSetIs256(uint16_t shadow0, bool value) {
  return value
    ? (shadow0 | 0x2000)
    : (shadow0 & 0xdfff);
}

static inline int oamGetObjShape(uint16_t shadow0) {
  return shadow0 >> 14;
}

static inline uint16_t oamSetObjShape(uint16_t shadow0, int value) {
  return (shadow0 & 0x3fff) | ((value & 3) << 14);
}

static inline int oamGetX(uint16_t shadow1) {
  return shadow1 & 0x1ff;
}

static inline uint16_t oamSetX(uint16_t shadow1, int value) {
  return (shadow1 & 0xfe00) | (value & 0x01ff);
}

static inline bool oamGetHFlip(uint16_t shadow1) {
  return !!(shadow1 & 0x1000);
}

static inline uint16_t oamSetHFlip(uint16_t shadow1, bool value) {
  return value
    ? (shadow1 | 0x1000)
    : (shadow1 & 0xefff);
}

static inline bool oamGetVFlip(uint16_t shadow1) {
  return !!(shadow1 & 0x2000);
}

static inline uint16_t oamSetVFlip(uint16_t shadow1, bool value) {
  return value
    ? (shadow1 | 0x2000)
    : (shadow1 & 0xdfff);
}

static inline int oamGetObjSize(uint16_t shadow1) {
  return shadow1 >> 14;
}

static inline uint16_t oamSetObjSize(uint16_t shadow1, int value) {
  return (shadow1 & 0x3fff) | ((value & 3) << 14);
}

static inline int oamGetTile(uint16_t shadow2) {
  return shadow2 & 0x03ff;
}

static inline uint16_t oamSetTile(uint16_t shadow2, int value) {
  return (shadow2 & 0xfc00) | (value & 0x03ff);
}

static inline int oamGetPalette(uint16_t shadow2) {
  return shadow2 >> 12;
}

static inline uint16_t oamSetPalette(uint16_t shadow2, int value) {
  return (shadow2 & 0x0fff) | ((value & 15) << 12);
}

struct Oam {
  uint16_t shadow[512];        // shadow OAM
  uint32_t handleAvail[4];     // 128 bits flagging if a handle is available
  uint32_t rotateAvail;        // 32 bits flagging if a rotate slot is available
  int8_t handleToIndex[128];
  int8_t indexToHandle[128];
  uint8_t handlePriority[128]; // top 2 bits GBA priority, lower 6 bits are internal and affect sort
  uint8_t totalEntries;

  Oam &reset();
  Oam() { reset(); }
  int8_t alloc(uint8_t priority); // allocates entry; returns handle (0-127) or -1 for out of memory
  Oam &free(int8_t handle);
  int8_t allocRotate(); // allocates rotation slot; returns index (0-31) or -1 for out of memory
  Oam &freeRotate(int8_t index);
  Oam &priority(int8_t handle, uint8_t priority);

  uint8_t priority(int8_t handle) {
    return handlePriority[handle];
  }

  uint16_t attr0AtIndex(int index) {
    return shadow[index * 4 + 0];
  }

  Oam &attr0AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 0] = value;
    return *this;
  }

  uint16_t attr1AtIndex(int index) {
    return shadow[index * 4 + 1];
  }

  Oam &attr1AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 1] = value;
    return *this;
  }

  uint16_t attr2AtIndex(int index) {
    return shadow[index * 4 + 2];
  }

  Oam &attr2AtIndex(int index, uint16_t value) {
    shadow[index * 4 + 2] = value;
    return *this;
  }

  uint16_t attr0(int8_t handle) {
    return attr0AtIndex(handleToIndex[handle]);
  }

  Oam &attr0(int8_t handle, uint16_t value) {
    return attr0AtIndex(handleToIndex[handle], value);
  }

  uint16_t attr1(int8_t handle) {
    return attr1AtIndex(handleToIndex[handle]);
  }

  Oam &attr1(int8_t handle, uint16_t value) {
    return attr1AtIndex(handleToIndex[handle], value);
  }

  uint16_t attr2(int8_t handle) {
    return attr2AtIndex(handleToIndex[handle]);
  }

  Oam &attr2(int8_t handle, uint16_t value) {
    return attr2AtIndex(handleToIndex[handle], value);
  }

  //
  // attr0 broken down
  //

  int y(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetY(shadow[k]);
  }

  Oam &y(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetY(shadow[k], value);
    return *this;
  }

  int8_t rotateIndex(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetRotateIndex(shadow[k], shadow[k + 1]);
  }

  Oam &rotateIndex(int8_t handle, int8_t index, bool doubleSize = false) {
    int k = handleToIndex[handle] * 4;
    oamSetRotateIndex(&shadow[k], &shadow[k + 1], index, doubleSize);
    return *this;
  }

  bool show(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetShow(shadow[k]);
  }

  Oam &show(int8_t handle, bool value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetShow(shadow[k], value);
    return *this;
  }

  int mode(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetMode(shadow[k]);
  }

  Oam &mode(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetMode(shadow[k], value);
    return *this;
  }

  bool mosaic(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetMosaic(shadow[k]);
  }

  Oam &mosaic(int8_t handle, bool value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetMosaic(shadow[k], value);
    return *this;
  }

  bool is256(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetIs256(shadow[k]);
  }

  Oam &is256(int8_t handle, bool value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetIs256(shadow[k], value);
    return *this;
  }

  int objShape(int8_t handle) {
    int k = handleToIndex[handle] * 4;
    return oamGetObjShape(shadow[k]);
  }

  Oam &objShape(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4;
    shadow[k] = oamSetObjShape(shadow[k], value);
    return *this;
  }

  //
  // attr1 broken down
  //

  int x(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 1;
    return oamGetX(shadow[k]);
  }

  Oam &x(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4 + 1;
    shadow[k] = oamSetX(shadow[k], value);
    return *this;
  }

  bool hFlip(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 1;
    return oamGetHFlip(shadow[k]);
  }

  Oam &hFlip(int8_t handle, bool value) {
    int k = handleToIndex[handle] * 4 + 1;
    shadow[k] = oamSetHFlip(shadow[k], value);
    return *this;
  }

  bool vFlip(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 1;
    return oamGetVFlip(shadow[k]);
  }

  Oam &vFlip(int8_t handle, bool value) {
    int k = handleToIndex[handle] * 4 + 1;
    shadow[k] = oamSetVFlip(shadow[k], value);
    return *this;
  }

  int objSize(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 1;
    return oamGetObjSize(shadow[k]);
  }

  Oam &objSize(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4 + 1;
    shadow[k] = oamSetObjSize(shadow[k], value);
    return *this;
  }

  //
  // attr2 broken down
  //

  int tile(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 2;
    return oamGetTile(shadow[k]);
  }

  Oam &tile(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4 + 2;
    shadow[k] = oamSetTile(shadow[k], value);
    return *this;
  }

  int palette(int8_t handle) {
    int k = handleToIndex[handle] * 4 + 2;
    return oamGetPalette(shadow[k]);
  }

  Oam &palette(int8_t handle, int value) {
    int k = handleToIndex[handle] * 4 + 2;
    shadow[k] = oamSetPalette(shadow[k], value);
    return *this;
  }

  // VramObj handles encode Oam data, so can copy directly
  Oam &fromVramObj(int8_t handle, int16_t vramObjHandle) {
    // vramObjHandle is in format:
    //   0ZZH:HCTT:TTTT:TTTT
    //   T - tile number (0-1023)
    //   C - 256 color flag
    //   H - OAM shape (0 square, 1 horizontal, 2 vertical, 3 prohibited)
    //   Z - OAM size (0-3)
    int k = handleToIndex[handle] * 4;
    shadow[k + 0] = (shadow[k + 0] & 0x1fff) | ((vramObjHandle & 0x1c00) << 3);
    shadow[k + 1] = (shadow[k + 1] & 0x3fff) | ((vramObjHandle & 0x6000) << 1);
    shadow[k + 2] = (shadow[k + 2] & 0xfc00) | (vramObjHandle & 0x03ff);
    return *this;
  }

  //
  // attr3
  //

  int16_t PA(int8_t index) {
    return shadow[index * 16 + 3];
  }

  void PA(int8_t index, int16_t value) {
    shadow[index * 16 + 3] = value;
  }

  int16_t PB(int8_t index) {
    return shadow[index * 16 + 7];
  }

  void PB(int8_t index, int16_t value) {
    shadow[index * 16 + 7] = value;
  }

  int16_t PC(int8_t index) {
    return shadow[index * 16 + 11];
  }

  void PC(int8_t index, int16_t value) {
    shadow[index * 16 + 11] = value;
  }

  int16_t PD(int8_t index) {
    return shadow[index * 16 + 15];
  }

  void PD(int8_t index, int16_t value) {
    shadow[index * 16 + 15] = value;
  }

  inline OamHandle handle(int8_t handle);

#ifndef TESTS
  __attribute__((always_inline)) inline void copy() {
    memcpy32(reinterpret_cast<uint16_t *>(0x07000000u), shadow, 1024);
  }
#endif

#ifdef TESTS
  static int test(bool verbose);
#endif
};

struct OamHandle {
  Oam &oam;
  int8_t handle;
  uint16_t shadow0;
  uint16_t shadow1;
  uint16_t shadow2;

  OamHandle &priority(uint8_t priority) {
    oam.priority(handle, priority);
    shadow2 = (shadow2 & 0xf3ff) | ((priority >> 6) << 10);
    return *this;
  }

  uint8_t priority() {
    return oam.handlePriority[handle];
  }

  //
  // attr0 broken down
  //

  uint16_t attr0() {
    return shadow0;
  }

  OamHandle &attr0(uint16_t value) {
    shadow0 = value;
    return *this;
  }

  uint8_t y() {
    return oamGetY(shadow0);
  }

  OamHandle &y(int value) {
    shadow0 = oamSetY(shadow0, value);
    return *this;
  }

  int8_t rotateIndex() {
    return oamGetRotateIndex(shadow0, shadow1);
  }

  OamHandle &rotateIndex(int8_t index, bool doubleSize = false) {
    oamSetRotateIndex(&shadow0, &shadow1, index, doubleSize);
    return *this;
  }

  bool show() {
    return oamGetShow(shadow0);
  }

  OamHandle &show(bool value) {
    shadow0 = oamSetShow(shadow0, value);
    return *this;
  }

  int mode() {
    return oamGetMode(shadow0);
  }

  OamHandle &mode(int value) {
    shadow0 = oamSetMode(shadow0, value);
    return *this;
  }

  bool mosaic() {
    return oamGetMosaic(shadow0);
  }

  OamHandle &mosaic(bool value) {
    shadow0 = oamSetMosaic(shadow0, value);
    return *this;
  }

  bool is256() {
    return oamGetIs256(shadow0);
  }

  OamHandle &is256(bool value) {
    shadow0 = oamSetIs256(shadow0, value);
    return *this;
  }

  int objShape() {
    return oamGetObjShape(shadow0);
  }

  OamHandle &objShape(int value) {
    shadow0 = oamSetObjShape(shadow0, value);
    return *this;
  }

  //
  // attr1 broken down
  //

  uint16_t attr1() {
    return shadow1;
  }

  OamHandle &attr1(uint16_t value) {
    shadow1 = value;
    return *this;
  }

  int x() {
    return oamGetX(shadow1);
  }

  OamHandle &x(int value) {
    shadow1 = oamSetX(shadow1, value);
    return *this;
  }

  bool hFlip() {
    return oamGetHFlip(shadow1);
  }

  OamHandle &hFlip(bool value) {
    shadow1 = oamSetHFlip(shadow1, value);
    return *this;
  }

  bool vFlip() {
    return oamGetVFlip(shadow1);
  }

  OamHandle &vFlip(bool value) {
    shadow1 = oamSetVFlip(shadow1, value);
    return *this;
  }

  int objSize() {
    return oamGetObjSize(shadow1);
  }

  OamHandle &objSize(int value) {
    shadow1 = oamSetObjSize(shadow1, value);
    return *this;
  }

  //
  // attr2 broken down
  //

  uint16_t attr2() {
    return shadow2;
  }

  OamHandle &attr2(uint16_t value) {
    shadow2 = value;
    return *this;
  }

  int tile() {
    return oamGetTile(shadow2);
  }

  OamHandle &tile(int value) {
    shadow2 = oamSetTile(shadow2, value);
    return *this;
  }

  int palette() {
    return oamGetPalette(shadow2);
  }

  OamHandle &palette(int value) {
    shadow2 = oamSetPalette(shadow2, value);
    return *this;
  }

  OamHandle &fromVramObj(int16_t vramObjHandle) {
    shadow0 = (shadow0 & 0x1fff) | ((vramObjHandle & 0x1c00) << 3);
    shadow1 = (shadow1 & 0x3fff) | ((vramObjHandle & 0x6000) << 1);
    shadow2 = (shadow2 & 0xfc00) | (vramObjHandle & 0x03ff);
    return *this;
  }

  void done() {
    int k = oam.handleToIndex[handle] * 4;
    oam.shadow[k + 0] = shadow0;
    oam.shadow[k + 1] = shadow1;
    oam.shadow[k + 2] = shadow2;
  }
};

inline OamHandle Oam::handle(int8_t handle) {
  int k = handleToIndex[handle] * 4;
  return { *this, handle, shadow[k + 0], shadow[k + 1], shadow[k + 2] };
}
