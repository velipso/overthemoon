// SPDX-License-Identifier: 0BSD
    .section    .text, "x"
    .global     irq_init
    .equ REG_IE, 0x04000200
    .equ REG_IF, 0x04000202
    .equ REG_IME, 0x04000208
    .cpu        arm7tdmi
    .thumb
    .thumb_func
irq_init:
    // disable interrupts during setup
    ldr   r0, =REG_IME
    ldrb  r2, [r0]
    movs  r1, #0
    strb  r1, [r0]

    // clear handlers
    ldr   r0, =irq_vblank
    str   r1, [r0, # 0] // vblank
    str   r1, [r0, # 4] // hblank
    str   r1, [r0, # 8] // vcount
    str   r1, [r0, #12] // timer0
    str   r1, [r0, #16] // timer1
    str   r1, [r0, #20] // timer2
    str   r1, [r0, #24] // timer3
    str   r1, [r0, #28] // serial
    str   r1, [r0, #32] // dma0
    str   r1, [r0, #36] // dma1
    str   r1, [r0, #40] // dma2
    str   r1, [r0, #44] // dma3
    str   r1, [r0, #48] // keypad
    str   r1, [r0, #52] // gamepak

    // set IRQ handler
    ldr   r0, =0x03007ffc
    ldr   r1, =irq_handler
    str   r1, [r0]

    // clear IE
    ldr   r0, =REG_IE
    movs  r1, #0
    strh  r1, [r0]

    // clear IF
    ldr   r0, =REG_IF
    ldr   r1, =0x3fff
    strh  r1, [r0]

    // restore IME
    ldr   r0, =REG_IME
    strb  r2, [r0]

    bx    lr

    .align 4
    .pool
    .end
