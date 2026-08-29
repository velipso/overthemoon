// SPDX-License-Identifier: 0BSD
import '../scripts/animations.js';
define(() => {
  animation('heroWalkLeft', () => {
    spritesheet('dataSpritesheetsDigits8x8');
    copy(0);
    wait(10);
    repeat(2, () => {
      copy(1);
      wait(2);
      copy(0);
      wait(3);
    });
  });
});
