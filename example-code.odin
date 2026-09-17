// example-code.odin — syntax coverage corpus for the jed Odin grammar.
//
// Every construct here is real Odin drawn from jed's own sources and from the
// Odin standard library.  The file is kept compilable so that `odin check` can
// vouch for it: if the compiler accepts it, a parse error from the grammar is
// unambiguously the grammar's fault.
//
// Build tags (`#+build windows`, `#+private`) also precede `package`; they get
// their own files in test/corpus.

#+feature dynamic-literals using-stmt

package example

import "core:fmt"
import "core:mem"
import str "core:strings"
import "base:intrinsics"
import "core:os"
import "core:slice"

foreign import kernel32 "system:Kernel32.lib"

/*
   Block comments. Odin also nests them; this grammar does not -- see
   test/corpus/nested-block-comment.odin for that known limitation.
*/

// ---------------------------------------------------------------- constants

MAX :: 1 << 20
NAME :: "jed"
PI :: 3.14159
RATIO :: f32(2.0) / 3
FLAGS :: bit_set[Direction]{.North, .South}
TABLE :: [?]int{1, 2, 3}
NEG :: -1
HEXES := [?]u8{0xff, 0b1010, 0o77, 0d99}
BIG :: 1_000_000
CHARS :: [?]rune{'a', '\n', '\u00e9', '\x41'}
RAW :: `C:\raw\string\no\escapes`
IMAG :: 3i
WHEN_CFG :: #config(MY_FLAG, false)
EMBEDDED :: #load("example-code.odin", string)

// ------------------------------------------------------------------- types

Direction :: enum u8 {
	North,
	East = 4,
	South,
	West,
}

Directions :: bit_set[Direction; u8]
SmallSet :: bit_set[0 ..< 8; u8]
RangeSet :: bit_set['a' ..= 'z']

Vec3 :: distinct [3]f32
Matrix :: matrix[4, 4]f32
Grid :: [dynamic][]int
Lookup :: map[string][dynamic]int
Multi :: [^]u8
Slice :: []rune
Fixed :: [16]byte
Nested :: ^^int
Proc :: proc(a: int, b: ^f32) -> (ok: bool)
ProcNoRet :: proc "c" (user: rawptr)
Variadic :: proc(args: ..any) -> string
Simd :: #simd[4]f32
Soa :: #soa[]Point

Point :: struct {
	x, y: f32,
}

Entity :: struct #align (16) {
	using point: Point,
	id:          u64,
	name:        string `fmt:"s"`,
	tags:        bit_set[Direction],
	children:    [dynamic]^Entity,
}

Generic :: struct($T: typeid, $N: int) where N > 0 {
	items: [N]T,
}

Value :: union {
	int,
	string,
	^Entity,
}

MaybeInt :: union #no_nil {
	int,
	bool,
}

Header :: bit_field u32 {
	version: u8  | 4,
	kind:    u8  | 4,
	length:  u16 | 16,
	flags:   u8  | 8,
}

Cursor :: struct {
	idx:    int,
	anchor: int,
}

// ------------------------------------------------------------- attributes

@(private)
internal_counter: int

@(private = "file")
file_local: int

@(require_results)
double :: proc(x: int) -> int {
	return x * 2
}

@(deferred_out = cleanup)
acquire :: proc() -> ^Entity {
	return nil
}

cleanup :: proc(e: ^Entity) {}

@(link_name = "c_entry", export)
c_entry :: proc "c" () {}

@(init)
setup :: proc "contextless" () {}

// ------------------------------------------------------ foreign procedures

@(default_calling_convention = "stdcall")
foreign kernel32 {
	@(link_name = "GetLastError")
	get_last_error :: proc() -> u32 ---

	Sleep :: proc(ms: u32) ---
}

// -------------------------------------------------------------- procedures

minmax :: proc(a, b: $T) -> (T, T) where intrinsics.type_is_ordered(T) {
	if a < b {
		return a, b
	}
	return b, a
}

widen :: proc(lo, hi: int) -> (int, int) {
	return lo - 1, hi + 1
}

named_returns :: proc(v: int) -> (lo, hi: int, ok: bool) {
	lo, hi = v, v
	ok = true
	return
}

defaulted :: proc(a: int, b := 10, c: string = "x") -> int {
	return a + b
}

variadic :: proc(prefix: string, rest: ..int) -> int {
	total := 0
	for v in rest {
		total += v
	}
	return total
}

poly_map :: proc(m: $M/map[$K]$V, key: K) -> (V, bool) {
	v, ok := m[key]
	return v, ok
}

by_ptr_arg :: proc(#by_ptr p: Point) {}
any_int_arg :: proc(#any_int n: int) {}
caller :: proc(loc := #caller_location) {}

overloaded :: proc {
	widen,
	named_returns,
}

// ------------------------------------------------------------- expressions

expressions :: proc() {
	a, b := 1, 2
	c: int = 3
	d: f32
	e: int = ---
	f: [4]int = ---

	// binary, unary, precedence
	x := a + b*3 - 4/2 %% 5
	x = a & b | ~a ~ b &~ a
	x = a << 2 >> 1
	ok := a < b && b <= 3 || a != b && !(a == b)
	y := -a + +b

	// ternary forms
	m := a if ok else b
	n := ok ? a : b

	// or_else / or_return / or_break / or_continue
	lookup: map[string]int
	v := lookup["missing"] or_else -1

	// selectors, calls, indexing, slicing
	e2 := Entity{id = 1, name = "n"}
	_ = e2.point.x
	_ = e2.children[0].id
	s := []int{1, 2, 3, 4}
	_ = s[1:3]
	_ = s[:2]
	_ = s[2:]
	_ = s[:]
	_ = len(s)
	_ = double(a)

	// implicit selector, type assertion, optional-ok
	dir: Direction = .North
	val: Value = 1
	i := val.(int)
	j, jok := val.(int)
	_ = jok
	maybe: union{int} = 1
	_ = maybe.?

	// casts
	_ = cast(f32)a
	_ = transmute(u32)f32(1.0)
	_ = auto_cast a
	_ = f64(a)

	// address-of and dereference
	p := &e2
	_ = p^
	_ = p.id

	// compound literals
	_ = Point{1, 2}
	_ = Point{x = 1, y = 2}
	_ = [?]int{1, 2, 3}
	_ = [4]int{0 = 1, 3 = 9}
	_ = []string{"a", "b"}
	_ = map[string]int{"a" = 1, "b" = 2}
	_ = bit_set[Direction]{.North}
	_ = Matrix{}
	_ = Generic(int, 4){}
	_ = (^Entity)(nil)

	// procedure literal
	fn := proc(v: int) -> int {
		return v + 1
	}
	_ = fn(1)
	inline_call := proc() {
		internal_counter += 1
		file_local = 2
	}
	_ = inline_call

	// directives on calls
	_ = #force_inline double(a)
	#no_bounds_check {
		_ = s[0]
	}
	#assert(size_of(int) == 8)

	// intrinsics and context
	_ = size_of(Entity)
	_ = align_of(Entity)
	_ = offset_of(Entity, id)
	_ = type_of(a)
	_ = typeid_of(int)
	ctx := context
	_ = ctx.allocator
	context.user_index = 1

	_ = m + n + x + y + i + j
	_ = d
	_ = f
	_ = c
	_ = dir
	_ = v
	_ = e
}

// -------------------------------------------------------------- statements

statements :: proc(F: ^Entity) -> (err: mem.Allocator_Error) {
	// if / else if / else, with initializer
	if x := 1; x > 0 {
		fmt.println("pos")
	} else if x < 0 {
		fmt.println("neg")
	} else {
		fmt.println("zero")
	}

	// do-form bodies
	if true do fmt.println("one line")
	for i := 0; i < 3; i += 1 do fmt.println(i)

	// all four for-loop forms
	for i := 0; i < 10; i += 1 {}
	for internal_counter < 10 {}
	for {
		break
	}
	items := []int{1, 2, 3}
	for item in items {}
	for item, idx in items {}
	for &item in items {}
	m: map[string]int
	for key, value in m {}
	for r in "string" {}
	for i in 0 ..< 10 {}
	for i in 0 ..= 10 {}

	// labeled loops and branches
	outer: for i in 0 ..< 3 {
		inner: for j in 0 ..< 3 {
			if j == 1 {
				continue outer
			}
			if i == 2 {
				break outer
			}
		}
	}

	// switch
	d: Direction = .North
	switch d {
	case .North, .South:
		fmt.println("vertical")
	case .East:
		fallthrough
	case .West:
		fmt.println("horizontal")
	case:
		fmt.println("none")
	}

	#partial switch d {
	case .North:
	}

	switch x := 5; x {
	case 0 ..< 5:
	case 5 ..= 10:
	case:
	}

	// type switch
	val: Value = 1
	switch v in val {
	case int:
		_ = v
	case string, ^Entity:
	case:
	}

	// when (compile-time)
	when ODIN_OS == .Windows {
		fmt.println("windows")
	} else when ODIN_OS == .Darwin {
		fmt.println("mac")
	} else {
		fmt.println("other")
	}

	// defer, in both forms
	defer fmt.println("done")
	defer {
		fmt.println("block")
	}

	// using
	p := Point{}
	using p

	// or_return in statement position
	buf := make([]byte, 16) or_return
	defer delete(buf)

	// assignment operators
	n := 0
	n += 1
	n -= 1
	n *= 2
	n /= 2
	n %= 2
	n %%= 2
	n &= 1
	n |= 1
	n ~= 1
	n &~= 1
	n <<= 1
	n >>= 1
	ok := true
	ok &&= false
	ok ||= true

	// multiple assignment and swap
	a, b := 1, 2
	a, b = b, a
	_, _ = a, b

	// nested blocks
	{
		shadow := 1
		_ = shadow
	}

	_ = F
	_ = d
	_ = items
	_ = m
	_ = ok
	_ = n
	return nil
}

// --------------------------------------------------- jed-flavoured snippets

Mode :: enum {
	Normal,
	Insert,
	Search,
}

mode: Mode
browser_open: bool
search: [dynamic]rune
unprocessed_input: [dynamic]rune
possible_mappings: [dynamic]Mapping

Mapping :: struct {
	keys: []rune,
	act:  proc(),
}

mappings := []Mapping{
	{{'i'}, proc() {mode = .Insert}},
	{{'m'}, proc() {append(&search, 'x')}},
	{{' ', 'e'}, proc() {browser_open = !browser_open; if browser_open do rebuild()}},
	{{'/'}, proc() {clear(&search); mode = .Search}},
}

rebuild :: proc() {}

main :: proc() {
	expressions()
	_ = statements(nil)
	fmt.println(minmax(1, 2))
	fmt.printfln("%v %d %s", mode, 1, NAME)
	_ = str.contains("a", "b")
	_ = os.args
	_ = slice.contains([]int{1}, 1)
	_ = get_last_error
	_ = Sleep
	_, _ = overloaded(1, 2)
	_ = double
	_ = poly_map
	_ = by_ptr_arg
	_ = any_int_arg
	_ = caller
	_ = defaulted
	_ = variadic
	_ = acquire
	_ = c_entry
	_ = setup
	_ = mappings
}
