// SPDX-License-Identifier: 0BSD
    .section    .iwram, "ax"
    .global     atomicBitSet
    .global     atomicBitClear
    .cpu        arm7tdmi
    .arm

atomicBitSet: // (uint32_t *addr, uint32_t mask)
    mrs   r2, cpsr        // save original CPSR
    orr   r3, r2, #0x80
    msr   cpsr_c, r3      // IRQ off
    ldr   r3, [r0]
    tst   r3, r1
    bne   1f
    orr   r3, r3, r1
    str   r3, [r0]
    msr   cpsr_c, r2      // restore IRQ state
    mov   r0, #1
    bx    lr
1:  msr   cpsr_c, r2
    mov   r0, #0
    bx    lr

atomicBitClear: // (uint32_t *addr, uint32_t mask)
    mrs   r2, cpsr        // save original CPSR
    orr   r3, r2, #0x80
    msr   cpsr_c, r3      // IRQ off
    ldr   r3, [r0]
    bics  r12, r1, r3
    bne   1f
    bic   r3, r3, r1
    str   r3, [r0]
    msr   cpsr_c, r2      // restore IRQ state
    mov   r0, #1
    bx    lr
1:  msr   cpsr_c, r2
    mov   r0, #0
    bx    lr
    .align 4
    .end
