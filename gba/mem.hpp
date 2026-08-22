// SPDX-License-Identifier: 0BSD
#pragma once
#include <stdint.h>

extern "C" {
  extern void memcpy32(void *dest, const void *src, uint32_t bytecount);
  extern void memcpy16(void *dest, const void *src, uint32_t bytecount);
  extern void memcpy8(void *dest, const void *src, uint32_t bytecount);
  extern void memset32(void *dest, uint32_t data, uint32_t bytecount);
  extern void memset16(void *dest, uint32_t data, uint32_t bytecount);
  extern void memset8(void *dest, uint32_t data, uint32_t bytecount);
}
