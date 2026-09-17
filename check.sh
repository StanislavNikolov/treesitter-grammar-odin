#!/bin/bash
# Score the grammar: table size, and how much real Odin it parses cleanly.
#
#   ./check.sh            example-code.odin only
#   ./check.sh --stdlib   also the Odin standard library, from $ODIN_SRC
#
# Needs gcc, and the tree-sitter CLI if you want src/ regenerated first.
set -e
cd "$(dirname "$0")"

ODIN_SRC=${ODIN_SRC:-$HOME/code/Odin}
TS=${TS:-.build/tree-sitter/lib}
mkdir -p .build
[ -d "$TS" ] || git clone -q --depth 1 https://github.com/tree-sitter/tree-sitter.git .build/tree-sitter

command -v tree-sitter >/dev/null && tree-sitter generate

gcc -O0 -w -c -Isrc src/parser.c -o .build/parser.o
printf '%s states, %s large, %s B tables\n' \
	"$(sed -n 's/#define STATE_COUNT //p' src/parser.c)" \
	"$(sed -n 's/#define LARGE_STATE_COUNT //p' src/parser.c)" \
	"$(objdump -h .build/parser.o | awk '/^ *[0-9]+ \./{n=$2; gsub(/\$.*/,"",n); t[n]+=strtonum("0x" $3)} END{printf "%d", t[".rdata"]+t[".text"]+t[".data"]}')"

gcc -O2 -w -std=c11 -I"$TS/include" -I"$TS/src" -Isrc \
	-o .build/parse_check.exe tools/parse_check.c src/parser.c "$TS/src/lib.c"

# xargs may split a long file list over several runs, so add the runs up.
total() { awk '{f+=$1; k+=substr($3,2); b+=$5; e+=$8} END{printf "%d files (%d KB): %d with errors, %d error nodes\n", f, k, b, e}'; }

printf 'example-code: '; .build/parse_check.exe -q example-code.odin | total
[ "$1" = --stdlib ] || exit 0

find "$ODIN_SRC/core" "$ODIN_SRC/vendor" -name '*.odin' > .build/stdlib.txt
printf 'stdlib:       '; xargs -a .build/stdlib.txt .build/parse_check.exe -q | total
