// SPDX-License-Identifier: 0BSD
#pragma once
#include "xform.hpp"

struct CmdPalette256 : Command {
  CmdPalette256();
  void help() override;
  int main(int argc, const char **argv) override;
};
