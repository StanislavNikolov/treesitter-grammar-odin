/**
 * @file Odin grammar for tree-sitter, written for jed.
 * @license MIT
 *
 * Design notes, in order of how much they matter for the size of the
 * generated tables:
 *
 *  1. There is ONE expression hierarchy.  Odin's types are expressions --
 *     `map[string]int` and `[]Foo` are values you can pass around -- so the
 *     grammar does not carry a separate `type` nonterminal alongside
 *     `expression`.  The existing grammars do, which means every position
 *     where an expression may start also carries gotos for the whole type
 *     hierarchy; that duplication is most of their table.
 *
 *  2. Statement separation is a plain `choice(/\n/, ';')` constant, inlined at
 *     each use rather than being a rule, so it costs no nonterminal.  The
 *     lexer prefers it over the `/\s/` extra wherever the parser wants a
 *     terminator, which is how Odin's optional semicolons fall out for free.
 *
 *  3. Leaves are tokens, not one-element rules.  A rule like
 *     `boolean: choice('true','false')` is a nonterminal and costs a goto in
 *     every expression state; `token(choice('true','false'))` does not.
 *
 *  4. There is no external scanner.  One was written for Odin's nested block
 *     comments, but an external token that is also an `extra` interacts badly
 *     with the newline terminator: with two block comments on consecutive
 *     lines the parser took the newline between them as a terminator and
 *     invented an empty statement to put in front of it.  Making block
 *     comments an ordinary token fixed that whole class of failure and dropped
 *     the scanner, its build step and a parse-table column with it.
 *
 *     The cost is that a nested block comment ends at its first closing
 *     delimiter rather than its matching one.  Odin does allow nesting; it is
 *     rare enough in practice that this trade is worth the correctness
 *     elsewhere.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Binary operator precedence, matching Odin's own parser.
const PREC = {
  or_else: 1,
  ternary: 2,
  range: 3,
  logical_or: 4,
  logical_and: 5,
  comparison: 6,
  additive: 7,
  multiplicative: 8,
  unary: 9,
  cast: 10,
  postfix: 11,
  literal: 12,
};

const multiplicative = ['*', '/', '%', '%%', '&', '&~', '<<', '>>'];
const additive = ['+', '-', '|', '~'];
const comparative = ['==', '!=', '<', '<=', '>', '>='];
const assignOps = multiplicative.concat(additive)
  .map(op => op + '=')
  .concat(['=', '&&=', '||=']);

const newline = /\n/;
const terminator = choice(newline, ';');

const lineContinuation = /\\\r?\n/;

const decimal = /[0-9][0-9_]*/;

module.exports = grammar({
  name: 'odin',

  word: $ => $.identifier,

  extras: $ => [
    $.comment,
    $.block_comment,
    // A backslash at end of line continues the statement, so the newline it
    // hides must never reach the parser as a terminator.
    lineContinuation,
    /\s/,
  ],

  supertypes: $ => [
    $._expression,
    $._statement,
  ],

  inline: $ => [
    $._body,
    $._simple_statement,
  ],

  conflicts: $ => [
    // --- conflicts added while iterating; reviewed below ---
    [$.procedure_type],
    [$.argument, $.parenthesized_expression],
    [$.directive_tag],
    [$.directive_expression, $.directive_tag],
    [$._expression, $.literal_element],
    [$.range_clause, $._expression],
    [$.parenthesized_expression, $.parameter],
    [$.literal_value, $.bit_field_type],
    [$._expression, $.enum_member],
    [$.literal_value, $.enum_type],
    [$.switch_statement, $.literal_value],
    [$.expression_list, $.literal_element],
    [$.expression_statement, $.literal_element],
    [$.block, $.literal_value],
    [$.parameter],
    [$.attributed_declaration],
    // `name:` may start a label or a typed declaration.
    [$.labeled_statement, $._expression],
  ],

  rules: {
    source_file: $ => seq(
      repeat($.file_tag),
      repeat(seq($._statement, terminator)),
      optional($._statement),
    ),

    // `#+build windows`, `#+private file`, `#+feature dynamic-literals`
    file_tag: _ => token(seq('#+', /[^\n]*/)),

    // ----------------------------------------------------------- statements

    _statement: $ => choice(
      $.package_clause,
      $.import_declaration,
      $.foreign_block,
      $.value_declaration,
      $.assignment_statement,
      $.if_statement,
      $.when_statement,
      $.for_statement,
      $.switch_statement,
      $.return_statement,
      $.defer_statement,
      $.using_statement,
      $.break_statement,
      $.continue_statement,
      $.fallthrough_statement,
      $.labeled_statement,
      $.block,
      $.directive_statement,
      $.attributed_declaration,
      $.expression_statement,
    ),

    // Statements allowed in an `if`/`for` header before the `;`.
    _simple_statement: $ => choice(
      $.value_declaration,
      $.assignment_statement,
      $.expression_statement,
    ),

    package_clause: $ => seq('package', field('name', $.identifier)),

    import_declaration: $ => seq(
      optional('foreign'),
      'import',
      optional(field('alias', $.identifier)),
      choice(
        field('path', $.string),
        seq('{', commaSep1(field('path', $.string)), optional(','), '}'),
      ),
    ),

    foreign_block: $ => seq(
      'foreign',
      optional(field('library', $.identifier)),
      '{',
      repeat(seq($._statement, terminator)),
      optional($._statement),
      '}',
    ),

    attributed_declaration: $ => seq(
      repeat1($.attribute),
      $._statement,
    ),

    attribute: $ => seq(
      '@',
      choice(
        $.identifier,
        seq('(', commaSep1($.attribute_entry), optional(','), ')'),
      ),
    ),

    attribute_entry: $ => seq(
      field('name', $.identifier),
      optional(seq('=', field('value', $._expression))),
    ),

    // `a :: 1`, `a := 1`, `a: int`, `a: int = 1`, `a: int : 1`, `a, b := 1, 2`
    value_declaration: $ => seq(
      field('name', $.expression_list),
      choice(
        seq('::', field('value', $.expression_list)),
        seq(':=', field('value', $.expression_list)),
        seq(
          ':',
          field('type', $._expression),
          optional(choice(
            seq('=', field('value', $.expression_list)),
            seq(':', field('value', $.expression_list)),
          )),
        ),
      ),
    ),

    assignment_statement: $ => seq(
      field('left', $.expression_list),
      field('operator', choice(...assignOps)),
      field('right', $.expression_list),
    ),

    expression_statement: $ => $._expression,

    block: $ => seq(
      '{',
      repeat(seq($._statement, terminator)),
      optional($._statement),
      '}',
    ),

    // `{ ... }` or `do <statement>`
    _body: $ => choice($.block, seq('do', $._statement)),

    if_statement: $ => prec.right(seq(
      'if',
      optional(seq(field('initializer', $._simple_statement), ';')),
      field('condition', $._expression),
      field('consequence', $._body),
      optional(seq('else', field('alternative', choice($.if_statement, $._body)))),
    )),

    when_statement: $ => prec.right(seq(
      'when',
      field('condition', $._expression),
      field('consequence', $.block),
      optional(seq('else', field('alternative', choice($.when_statement, $.block)))),
    )),

    for_statement: $ => seq(
      'for',
      optional(choice(
        $.range_clause,
        seq(
          optional($._simple_statement), ';',
          optional($._expression), ';',
          optional($._simple_statement),
        ),
        $._expression,
      )),
      field('body', $._body),
    ),

    // The bound variables are always plain identifiers in Odin.  Allowing a
    // full expression here would make `for a, b in c` ambiguous with the
    // expression list `a, (b in c)`.
    range_clause: $ => seq(
      commaSep1(seq(optional('&'), field('name', $.identifier))),
      'in',
      field('range', $._expression),
    ),

    switch_statement: $ => seq(
      'switch',
      optional(seq($._simple_statement, ';')),
      optional(seq(
        field('value', $._expression),
        optional(seq('in', field('type', $._expression))),
      )),
      '{',
      repeat($.case_clause),
      '}',
    ),

    case_clause: $ => seq(
      'case',
      optional($.expression_list),
      ':',
      repeat(seq($._statement, terminator)),
      optional($._statement),
    ),

    return_statement: $ => prec.right(seq('return', optional($.expression_list))),
    defer_statement: $ => seq('defer', $._statement),
    using_statement: $ => seq('using', $.expression_list),
    break_statement: $ => prec.right(seq('break', optional(field('label', $.identifier)))),
    continue_statement: $ => prec.right(seq('continue', optional(field('label', $.identifier)))),
    fallthrough_statement: _ => prec.left('fallthrough'),

    directive_statement: $ => prec.right(PREC.unary, seq($.directive, $._statement)),

    labeled_statement: $ => seq(
      field('label', $.identifier),
      ':',
      choice($.for_statement, $.switch_statement, $.if_statement, $.block),
    ),

    // ---------------------------------------------------------- expressions

    // No `prec.right` here: it would silently resolve the shift/reduce at
    // `expr •  {` in favour of shifting, turning every `for ...; i += 1 {}`
    // body into a compound literal.  The conflict list handles it instead.
    expression_list: $ => commaSep1($._expression),

    _expression: $ => choice(
      $.identifier,
      $.number,
      $.float,
      $.string,
      $.character,
      $.boolean,
      $.nil,
      $.uninitialized,
      $.context,

      $.unary_expression,
      $.binary_expression,
      $.ternary_expression,
      $.in_expression,
      $.range_expression,
      $.or_expression,
      $.cast_expression,

      $.call_expression,
      $.selector_expression,
      $.implicit_selector,
      $.index_expression,
      $.slice_expression,
      $.type_assertion,
      $.deref_expression,
      $.parenthesized_expression,
      $.compound_literal,
      $.literal_value,

      $.pointer_type,
      $.variadic_type,
      $.polymorphic_type,
      $.array_type,
      $.map_type,
      $.bit_set_type,
      $.matrix_type,
      $.struct_type,
      $.union_type,
      $.enum_type,
      $.bit_field_type,
      $.procedure_type,
      $.procedure_literal,
      $.procedure_group,
      $.distinct_type,
      $.directive_expression,
    ),

    unary_expression: $ => prec.right(PREC.unary, seq(
      field('operator', choice('+', '-', '!', '~', '&', 'auto_cast')),
      field('argument', $._expression),
    )),

    binary_expression: $ => {
      const table = [
        [PREC.logical_or, ['||']],
        [PREC.logical_and, ['&&']],
        [PREC.comparison, comparative],
        [PREC.additive, additive],
        [PREC.multiplicative, multiplicative],
      ];
      return choice(...table.flatMap(([precedence, ops]) =>
        ops.map(op => prec.left(precedence, seq(
          field('left', $._expression),
          field('operator', op),
          field('right', $._expression),
        )))));
    },

    ternary_expression: $ => choice(
      prec.right(PREC.ternary, seq(
        field('condition', $._expression), '?',
        field('consequence', $._expression), ':',
        field('alternative', $._expression),
      )),
      prec.right(PREC.ternary, seq(
        field('consequence', $._expression),
        choice('if', 'when'),
        field('condition', $._expression),
        'else',
        field('alternative', $._expression),
      )),
    ),

    in_expression: $ => prec.left(PREC.comparison, seq(
      field('left', $._expression),
      field('operator', choice('in', 'not_in')),
      field('right', $._expression),
    )),

    range_expression: $ => prec.left(PREC.range, seq(
      field('start', $._expression),
      choice('..<', '..='),
      field('end', $._expression),
    )),

    or_expression: $ => choice(
      prec.left(PREC.or_else, seq($._expression, 'or_else', $._expression)),
      prec(PREC.postfix, seq($._expression, choice('or_return', 'or_break', 'or_continue'))),
    ),

    cast_expression: $ => prec.right(PREC.cast, seq(
      choice('cast', 'transmute'),
      '(', field('type', $._expression), ')',
      field('value', $._expression),
    )),

    call_expression: $ => prec(PREC.postfix, seq(
      field('function', $._expression),
      field('arguments', $.argument_list),
    )),

    argument_list: $ => seq(
      '(',
      optional(seq(commaSep1($.argument), optional(','))),
      ')',
    ),

    argument: $ => choice(
      seq(field('name', $.identifier), '=', field('value', $._expression)),
      $._expression,
    ),

    selector_expression: $ => prec(PREC.postfix, seq(
      field('operand', $._expression),
      '.',
      field('field', $.identifier),
    )),

    implicit_selector: $ => seq('.', field('field', $.identifier)),

    index_expression: $ => prec(PREC.postfix, seq(
      field('operand', $._expression),
      '[', field('index', commaSep1($._expression)), ']',
    )),

    slice_expression: $ => prec(PREC.postfix, seq(
      field('operand', $._expression),
      '[', optional($._expression), ':', optional($._expression), ']',
    )),

    type_assertion: $ => prec(PREC.postfix, seq(
      field('operand', $._expression),
      '.',
      choice(seq('(', field('type', $._expression), ')'), '?'),
    )),

    deref_expression: $ => prec(PREC.postfix, seq($._expression, '^')),

    parenthesized_expression: $ => seq('(', $._expression, ')'),

    // No static precedence: where `expr {` could close an enclosing construct
    // (`where N > 0 {`, `bit_field u32 {`, `switch x {`) the conflict list lets
    // both readings run and the one that completes wins.  The dynamic
    // precedence only breaks ties that survive that far, and it prefers NOT
    // forming a literal.
    compound_literal: $ => prec.dynamic(-1, prec(-1, seq(
      field('type', $._expression),
      $.literal_value,
    ))),

    literal_value: $ => seq(
      '{',
      optional(seq(commaSep1($.literal_element), optional(','))),
      '}',
    ),

    literal_element: $ => choice(
      seq(field('key', $._expression), '=', field('value', $._expression)),
      $._expression,
      $.literal_value,
    ),

    // ------------------------------------------------- types-as-expressions

    pointer_type: $ => prec.right(PREC.unary, seq('^', field('element', $._expression))),
    variadic_type: $ => prec.right(PREC.unary, seq('..', field('element', $._expression))),
    polymorphic_type: $ => prec.right(PREC.unary, seq('$', field('element', $._expression))),
    distinct_type: $ => prec.right(seq('distinct', field('element', $._expression))),

    array_type: $ => prec.right(seq(
      '[',
      optional(choice(
        seq('dynamic', optional(seq(';', field('capacity', $._expression)))),
        '^', '?', field('length', $._expression),
      )),
      ']',
      field('element', $._expression),
    )),

    map_type: $ => prec.right(seq(
      'map', '[', field('key', $._expression), ']', field('value', $._expression),
    )),

    bit_set_type: $ => seq(
      'bit_set', '[',
      field('element', $._expression),
      optional(seq(';', field('backing', $._expression))),
      ']',
    ),

    matrix_type: $ => prec.right(seq(
      'matrix', '[',
      field('rows', $._expression), ',', field('columns', $._expression),
      ']', field('element', $._expression),
    )),

    struct_type: $ => prec.right(seq(
      'struct',
      optional($.parameter_list),
      repeat($.directive_tag),
      optional($.where_clause),
      $.field_declaration_list,
    )),

    field_declaration_list: $ => seq(
      '{',
      optional(seq(commaSep1($.field_declaration), optional(','))),
      '}',
    ),

    field_declaration: $ => seq(
      repeat($.directive_tag),
      optional('using'),
      field('name', commaSep1($.identifier)),
      ':',
      repeat($.directive_tag),
      field('type', $._expression),
      repeat($.directive_tag),
      optional(field('tag', $.string)),
    ),

    union_type: $ => prec.right(seq(
      'union',
      optional($.parameter_list),
      repeat($.directive_tag),
      optional($.where_clause),
      '{',
      optional(seq(commaSep1(field('member', $._expression)), optional(','))),
      '}',
    )),

    enum_type: $ => prec.right(seq(
      'enum',
      optional(field('backing', $._expression)),
      '{',
      optional(seq(commaSep1($.enum_member), optional(','))),
      '}',
    )),

    enum_member: $ => seq(
      field('name', $.identifier),
      optional(seq('=', field('value', $._expression))),
    ),

    bit_field_type: $ => seq(
      'bit_field',
      field('backing', $._expression),
      '{',
      optional(seq(commaSep1($.bit_field_member), optional(','))),
      '}',
    ),

    bit_field_member: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $._expression),
      '|',
      field('width', $._expression),
    ),

    procedure_type: $ => seq(
      'proc',
      optional(field('convention', $.string)),
      $.parameter_list,
      optional(seq('->', field('result', $._procedure_result))),
      repeat($.directive_tag),
    ),

    _procedure_result: $ => choice($.parameter_list, $._expression),

    // Binds tighter than `compound_literal` so that `proc() { ... }` is a
    // procedure body rather than a literal whose type is a procedure type.
    procedure_literal: $ => prec.right(PREC.literal + 1, seq(
      $.procedure_type,
      optional($.where_clause),
      field('body', choice($.block, $.uninitialized)),
    )),

    procedure_group: $ => seq(
      'proc',
      '{',
      optional(seq(commaSep1($._expression), optional(','))),
      '}',
    ),

    parameter_list: $ => seq(
      '(',
      optional(seq(commaSep1($.parameter), optional(','))),
      ')',
    ),

    parameter: $ => choice(
      seq(
        field('name', commaSep1($._expression)),
        ':',
        repeat($.directive_tag),
        field('type', $._expression),
        optional(seq('=', field('default', $._expression))),
      ),
      seq(field('name', commaSep1($._expression)), ':=', field('default', $._expression)),
      seq(repeat($.directive_tag), field('type', $._expression)),
    ),

    where_clause: $ => seq('where', commaSep1($._expression)),

    // `#force_inline f()`, `#soa []T`, `#config(X, false)`, `#caller_location`
    directive_expression: $ => choice(
      seq($.directive, field('arguments', $.argument_list)),
      prec.right(PREC.unary, seq($.directive, $._expression)),
      $.directive,
    ),

    // A directive in modifier position: `struct #align(16)`, `x: T #subtype`.
    // It never reaches forward for an expression, so it cannot swallow a `{`
    // the way `when !#exists(LIB) { ... }` used to.
    directive_tag: $ => seq($.directive, optional($.argument_list)),

    directive: _ => token(seq('#', /[a-zA-Z_][a-zA-Z0-9_]*/)),

    // -------------------------------------------------------------- lexemes

    identifier: _ => /[_\p{XID_Start}][_\p{XID_Continue}]*/u,

    number: _ => token(choice(
      seq('0', /[xX]/, /[0-9a-fA-F_]+/),
      seq('0', /[bB]/, /[01_]+/),
      seq('0', /[oO]/, /[0-7_]+/),
      seq('0', /[dD]/, /[0-9_]+/),
      seq('0', /[zZ]/, /[0-9abAB_]+/),
      seq(decimal, optional(/[ijk]/)),
    )),

    // The fractional part must have a digit so that `0..<8` cannot lex as
    // `0.` followed by `.<8`.
    float: _ => token(choice(
      seq(decimal, '.', decimal, optional(seq(/[eE]/, optional(/[+-]/), decimal)), optional(/[ijk]/)),
      seq(decimal, /[eE]/, optional(/[+-]/), decimal, optional(/[ijk]/)),
      // `.5` -- a float with no integer part, as in `pen - {0, .1*sz}`.
      seq('.', decimal, optional(seq(/[eE]/, optional(/[+-]/), decimal)), optional(/[ijk]/)),
      seq('0', /[hH]/, /[0-9a-fA-F_]+/),
    )),

    // The closing delimiters are `token.immediate` so that no extra can be
    // lexed inside the literal.  With a plain '"' the lexer is free to treat a
    // `//` in the text as a comment, which broke strings like
    // `"// GENERATED -- DO NOT EDIT.\n"`.
    string: $ => choice(
      seq('"', repeat(choice($.escape_sequence, token.immediate(prec(1, /[^"\\\n]+/)))), token.immediate('"')),
      seq('`', repeat(token.immediate(/[^`]+/)), token.immediate('`')),
    ),

    character: $ => seq(
      '\'',
      choice($.escape_sequence, token.immediate(/[^'\\\n]/)),
      token.immediate('\''),
    ),

    escape_sequence: _ => token.immediate(seq('\\', choice(
      /[abefnrtv\\'"0]/,
      /x[0-9a-fA-F]{2}/,
      /u[0-9a-fA-F]{4}/,
      /U[0-9a-fA-F]{8}/,
    ))),

    boolean: _ => token(choice('true', 'false')),
    nil: _ => 'nil',
    uninitialized: _ => '---',
    context: _ => 'context',

    comment: _ => token(seq('//', /[^\n]*/)),

    block_comment: _ => token(seq('/*', repeat(choice(/[^*]/, /\*[^/]/)), '*/')),
  },
});

/** @param {RuleOrLiteral} rule */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}
