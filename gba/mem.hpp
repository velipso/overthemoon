// SPDX-License-Identifier: 0BSD
#pragma once
#include <stdint.h>

#ifdef TESTS

// define fake memcpy/memset routines for tests

#ifndef TESTS_GBA_MEM_IMPL
void memcpy32bytes(void *dest, const void *src);
void memcpy64bytes(void *dest, const void *src);
void memcpy32(void *dest, const void *src, uint32_t bytecount);
void memcpy16(void *dest, const void *src, uint32_t bytecount);
void memcpy8(void *dest, const void *src, uint32_t bytecount);
void memset32(void *dest, uint32_t data, uint32_t bytecount);
void memset16(void *dest, uint32_t data, uint32_t bytecount);
void memset8(void *dest, uint32_t data, uint32_t bytecount);
#else
void memcpy32bytes(void *dest, const void *src) {}
void memcpy64bytes(void *dest, const void *src) {}
void memcpy32(void *dest, const void *src, uint32_t bytecount) {}
void memcpy16(void *dest, const void *src, uint32_t bytecount) {}
void memcpy8(void *dest, const void *src, uint32_t bytecount) {}
void memset32(void *dest, uint32_t data, uint32_t bytecount) {}
void memset16(void *dest, uint32_t data, uint32_t bytecount) {}
void memset8(void *dest, uint32_t data, uint32_t bytecount) {}
#endif

#else
extern "C" {
  extern void memcpy32bytes(void *dest, const void *src);
  extern void memcpy64bytes(void *dest, const void *src);
  extern void memcpy32(void *dest, const void *src, uint32_t bytecount);
  extern void memcpy16(void *dest, const void *src, uint32_t bytecount);
  extern void memcpy8(void *dest, const void *src, uint32_t bytecount);
  extern void memset32(void *dest, uint32_t data, uint32_t bytecount);
  extern void memset16(void *dest, uint32_t data, uint32_t bytecount);
  extern void memset8(void *dest, uint32_t data, uint32_t bytecount);
}
#endif
