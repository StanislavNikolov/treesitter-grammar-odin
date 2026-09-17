# grammar-odin-jed

A tree-sitter grammar for [Odin](https://odin-lang.org), written for the
[jed](https://github.com/StanislavNikolov/jed) editor. It aims at a small parse
table without giving up coverage of real Odin.

## Where it stands

Against `tree-sitter-grammars/tree-sitter-odin`, scored over the Odin standard
library (1,568 files / 33 MB, September 2026 checkout). "Files with errors" is
the metric that matters; error-node counts move around with how a checker
reports them.

|                              | this grammar | tree-sitter-odin |
| ---------------------------- | -----------: | ---------------: |
| parser states                |        4,028 |            9,667 |
| large states                 |        1,279 |            2,214 |
| tables, uncompressed         |       952 KB |         2,226 KB |
| tables, zlib                 |        64 KB |           170 KB |
| Odin stdlib, files w/ errors | **106**/1568 |       156 / 1568 |
| jed's own sources            |    **0** / 7 |   2 files, 18 err |
| `example-code.odin`          |        **0** |    1 file, 10 err |

It also handles constructs the other grammar does not: unnamed multi-value
returns `-> (int, int)`, `[dynamic; 32]T`, and backslash line continuations.

## Design

The header comment in `grammar.js` has the detail. The short version:

1. **One expression hierarchy.** Odin's types are expressions, so there is no
   separate `type` nonterminal. Grammars that carry both make every
   expression-start state carry the type hierarchy's gotos as well, and that
   duplication is most of their table: in `tree-sitter-odin`, 1,841 of its 2,214
   large states hold gotos for `map_type`/`matrix_type`/`distinct_type` alone.
2. **Terminators are an inlined constant**, `choice(/\n/, ';')`, not a rule, so
   Odin's optional semicolons cost no nonterminal.
3. **Leaves are tokens.** `boolean: token(choice('true','false'))` is a
   terminal; `boolean: choice('true','false')` would be a nonterminal and cost
   a goto in every expression state.
4. **No external scanner**, so there is no scanner to build and no external
   token column in the table.

Two traps worth knowing, both of which cost real debugging here:

- `prec.right` with no explicit number still resolves shift/reduce races in
  favour of shifting, silently and with no conflict reported. It is why
  `for ...; i += 1 {}` and `proc() -> []byte {` had their bodies swallowed as
  compound literals.
- `compound_literal` carries `prec(-1)` so that completing an enclosing
  construct always beats forming a literal. That single change fixed the whole
  `expr {` family at once: `where N > 0 {`, `bit_field u32 {`, `switch x {`,
  procedure bodies.

## example-code.odin

The corpus. Every construct in it is real Odin drawn from jed and from the
standard library, and it is kept compilable so the compiler can vouch for it:

```bash
odin check example-code.odin -file
```

If `odin` accepts the file, a parse error is the grammar's fault and nothing
else. That check already caught a construct `tree-sitter-odin` accepts but Odin
rejects (`import { "core:os", "core:slice" }`).

## Building and checking

`src/` is committed, so consumers need only a C compiler. To regenerate after
editing `grammar.js`:

```bash
tree-sitter generate
```

`check.sh` regenerates, reports the table size, and counts how many files the
grammar fails to parse cleanly:

```bash
./check.sh                            # example-code.odin only
ODIN_SRC=~/code/Odin ./check.sh --stdlib
```

It clones tree-sitter into `.build/` on first run; set `TS` to point at an
existing checkout's `lib/` instead.

## Known limitations

- **Nested block comments** end at their first closing delimiter rather than
  the matching one. Odin allows nesting. Supporting it needs an external
  scanner, and an external token that is also an `extra` breaks the newline
  terminator: with two block comments on consecutive lines the parser took the
  newline between them as a terminator and invented an empty statement to put
  in front of it. Fixing it properly means externalising the terminator too,
  which is what `tree-sitter-odin` does.
- **Selector operands are not namespaces.** `tree-sitter-odin` has a
  `field_type` node, so `pkg.Type` can colour `pkg` distinctly. Here `a.b` is
  one `selector_expression` whatever `a` is.
- 106 standard-library files still produce errors.

## Licence

MIT, as declared in `tree-sitter.json`. A `LICENSE` file has not been added yet.
