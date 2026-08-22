// SPDX-License-Identifier: 0BSD
#pragma once

struct Command {
  const char *command = 0;
  const char *about = 0;
  virtual void help() = 0;
  virtual int main(int argc, const char **argv) = 0;
};

int main(int argc, const char **argv);
