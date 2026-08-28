// SPDX-License-Identifier: 0BSD
#pragma once
#include "xform.hpp"

struct CmdCopyTiles256 : Command {
  CmdCopyTiles256();
  void help() override;
  int main(int argc, const char **argv) override;
};
