// SPDX-License-Identifier: 0BSD
#include "tests.hpp"
#include "TestBasic.hpp"
#include "TestOam.hpp"
#include "TestSpr.hpp"
#include "TestVramObj.hpp"
#include <stdio.h>
#include <string.h>

#define TESTS_GBA_MEM_IMPL
#include "gba/mem.hpp"
#include "gba/util/ctz32.cpp"
#include "gba/util/sin14.cpp"

static TestBasic basic;
static TestOam oam;
static TestSpr spr;
static TestVramObj vramObj;

static Test *tests[] = {
  &basic,
  &oam,
  &spr,
  &vramObj,
  NULL
};

int main(int argc, const char **argv) {
  bool verbose = false;
  bool filter = false;
  for (int j = 1; j < argc; j++) {
    if (strcmp(argv[j], "-v") == 0) {
      verbose = true;
    } else {
      filter = true;
    }
  }

  int pass = 0;
  int fail = 0;
  for (int i = 0; tests[i]; i++) {
    Test &test = *tests[i];

    if (filter) {
      bool found = false;
      for (int j = 1; j < argc && !found; j++) {
        if (strcmp(argv[j], "-v") == 0) continue;
        found = !!strstr(test.name, argv[j]);
      }
      if (!found) continue;
    }

    bool passed = test.run(verbose) == 0;
    printf("%s  %s\n", passed ? "pass" : "FAIL", test.name);
    if (passed) {
      pass++;
    } else {
      fail++;
    }
  }
  printf("pass %d / fail %d / total %d\n", pass, fail, pass + fail);
  return fail ? 1 : 0;
}
