// SPDX-License-Identifier: 0BSD
import '../scripts/animations.js';
define(() => {
  for (let i = 0; i < 10; i++) {
    animation('heroWalkLeft' + i, () => {
      spritesheet('dataSpritesheetsDigits8x8');
      if (i < 5) {
        copy(0);
        wait(10);
        copy(0);
        wait(10);
      }
      repeat(2, () => {
        for (let j = 0; j < i * 2; j++) {
          copy(1);
          fire('testEvent');
        }
        wait(2);
        copy(0);
        wait(3);
      });
      if (i === 9) copy(0);
    });
  }
});
