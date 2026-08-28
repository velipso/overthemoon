// SPDX-License-Identifier: 0BSD
#include "xform.hpp"
#include "CmdCopyTiles256.hpp"
#include "CmdGbaFix.hpp"
#include "CmdPalette256.hpp"
#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_WRITE_IMPLEMENTATION
extern "C" {
  #include "stb_image.h"
  #include "stb_image_write.h"
}
#include <stdio.h>
#include <string.h>

static CmdCopyTiles256 cmdCopyTiles256;
static CmdGbaFix cmdGbaFix;
static CmdPalette256 cmdPalette256;
static Command *commands[] = {
  &cmdCopyTiles256,
  &cmdGbaFix,
  &cmdPalette256,
  NULL
};

static void printUsage() {
  printf(
    "xform <command> [args...]\n\n"
    "Commands:\n\n"
  );

  int maxlen = 0;
  for (int i = 0; commands[i]; i++) {
    Command *cmd = commands[i];
    int len = strlen(cmd->command);
    if (len > maxlen) maxlen = len;
  }

  for (int i = 0; commands[i]; i++) {
    Command *cmd = commands[i];
    int len = strlen(cmd->command);
    char space[102];
    int s = maxlen - len;
    if (s >= 100) s = 100;
    space[s--] = 0;
    while (s >= 0) space[s--] = ' ';
    printf("  %s%s - %s\n", cmd->command, space, cmd->about);
  }

  printf("\nDetails:\n");
  for (int i = 0; commands[i]; i++) {
    Command *cmd = commands[i];
    printf("\n");
    cmd->help();
  }
}

int main(int argc, const char **argv) {
  if (argc <= 1) {
    printUsage();
    return 0;
  }
  for (int i = 0; commands[i]; i++) {
    Command *cmd = commands[i];
    if (strcmp(argv[1], cmd->command) == 0) {
      return cmd->main(argc - 2, &argv[2]);
    }
  }
  printUsage();
  fprintf(stderr, "\nInvalid command: %s\n", argv[1]);
  return 1;
}
