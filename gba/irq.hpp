// SPDX-License-Identifier: 0BSD
#pragma once

namespace Irq {
  extern "C" {
    void irq_init();
    extern void (*irq_vblank)();
    extern void (*irq_hblank)();
    extern void (*irq_vcount)();
    extern void (*irq_timer0)();
    extern void (*irq_timer1)();
    extern void (*irq_timer2)();
    extern void (*irq_timer3)();
    extern void (*irq_serial)();
    extern void (*irq_dma0)();
    extern void (*irq_dma1)();
    extern void (*irq_dma2)();
    extern void (*irq_dma3)();
    extern void (*irq_keypad)();
    extern void (*irq_gamepak)();
  }

  static inline void init() {
    irq_init();
  }

  static inline void (*vblank())() {
    return irq_vblank;
  }

  static inline void vblank(void (*f)()) {
    irq_vblank = f;
  }

  static inline void (*hblank())() {
    return irq_hblank;
  }

  static inline void hblank(void (*f)()) {
    irq_hblank = f;
  }

  static inline void (*vcount())() {
    return irq_vcount;
  }

  static inline void vcount(void (*f)()) {
    irq_vcount = f;
  }

  static inline void (*timer0())() {
    return irq_timer0;
  }

  static inline void timer0(void (*f)()) {
    irq_timer0 = f;
  }

  static inline void (*timer1())() {
    return irq_timer1;
  }

  static inline void timer1(void (*f)()) {
    irq_timer1 = f;
  }

  static inline void (*timer2())() {
    return irq_timer2;
  }

  static inline void timer2(void (*f)()) {
    irq_timer2 = f;
  }

  static inline void (*timer3())() {
    return irq_timer3;
  }

  static inline void timer3(void (*f)()) {
    irq_timer3 = f;
  }

  static inline void (*serial())() {
    return irq_serial;
  }

  static inline void serial(void (*f)()) {
    irq_serial = f;
  }

  static inline void (*dma0())() {
    return irq_dma0;
  }

  static inline void dma0(void (*f)()) {
    irq_dma0 = f;
  }

  static inline void (*dma1())() {
    return irq_dma1;
  }

  static inline void dma1(void (*f)()) {
    irq_dma1 = f;
  }

  static inline void (*dma2())() {
    return irq_dma2;
  }

  static inline void dma2(void (*f)()) {
    irq_dma2 = f;
  }

  static inline void (*dma3())() {
    return irq_dma3;
  }

  static inline void dma3(void (*f)()) {
    irq_dma3 = f;
  }

  static inline void (*keypad())() {
    return irq_keypad;
  }

  static inline void keypad(void (*f)()) {
    irq_keypad = f;
  }

  static inline void (*gamepak())() {
    return irq_gamepak;
  }

  static inline void gamepak(void (*f)()) {
    irq_gamepak = f;
  }
}
