// parse_check — parse a list of .odin files and report how many ERROR/MISSING
// nodes the grammar produced, plus where the first few of them are.
//
// Usage: parse_check [-q] [-n N] <file>...
//   -q     only print the summary line
//   -n N   show at most N error sites per file (default 5)
//
// Exit status is 0 when every file parsed cleanly, 1 otherwise, so it can be
// used as a build gate.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tree_sitter/api.h>

const TSLanguage *tree_sitter_odin(void);

typedef struct {
	const char *src;
	const char *path;
	int shown;
	int limit;
	int quiet;
	long count;
} Ctx;

static void report(Ctx *c, const char *kind, TSPoint p, uint32_t at) {
	if (c->quiet || c->shown >= c->limit) return;
	c->shown++;
	uint32_t b = at;
	while (b < at + 64 && c->src[b]) b++;
	char buf[80];
	memcpy(buf, c->src + at, b - at);
	buf[b - at] = 0;
	for (char *q = buf; *q; q++) if (*q == '\n' || *q == '\t' || *q == '\r') *q = ' ';
	printf("  %s:%u:%u  %s  |%s|\n", c->path, p.row + 1, p.column + 1, kind, buf);
}

static void walk(TSNode n, Ctx *c) {
	if (!ts_node_has_error(n)) return;

	if (ts_node_is_missing(n)) {
		c->count++;
		report(c, "MISSING", ts_node_start_point(n), ts_node_start_byte(n));
		return;
	}

	uint32_t k = ts_node_child_count(n);

	if (ts_node_is_error(n)) {
		// An ERROR node often spans most of the file, so its start says
		// nothing useful.  If it contains a nested error, that one is closer
		// to the truth; otherwise the parse derailed just past the last child
		// that did parse, which is the position worth printing.
		for (uint32_t i = 0; i < k; i++) {
			if (ts_node_has_error(ts_node_child(n, i))) {
				for (uint32_t j = 0; j < k; j++) walk(ts_node_child(n, j), c);
				return;
			}
		}
		c->count++;
		if (k) {
			TSNode last = ts_node_child(n, k - 1);
			report(c, "ERROR", ts_node_end_point(last), ts_node_end_byte(last));
		} else {
			report(c, "ERROR", ts_node_start_point(n), ts_node_start_byte(n));
		}
		return;
	}

	for (uint32_t i = 0; i < k; i++) walk(ts_node_child(n, i), c);
}

int main(int argc, char **argv) {
	int quiet = 0, limit = 5, i = 1;
	for (; i < argc; i++) {
		if (!strcmp(argv[i], "-q")) quiet = 1;
		else if (!strcmp(argv[i], "-n") && i + 1 < argc) limit = atoi(argv[++i]);
		else break;
	}
	TSParser *p = ts_parser_new();
	ts_parser_set_language(p, tree_sitter_odin());
	long total = 0, bad_files = 0, files = 0, bytes = 0;
	for (; i < argc; i++) {
		FILE *f = fopen(argv[i], "rb");
		if (!f) { fprintf(stderr, "cannot open %s\n", argv[i]); continue; }
		fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
		char *buf = malloc(n + 1);
		if (fread(buf, 1, n, f) != (size_t)n) { fclose(f); free(buf); continue; }
		buf[n] = 0; fclose(f);
		files++; bytes += n;
		TSTree *t = ts_parser_parse_string(p, NULL, buf, (uint32_t)n);
		Ctx c = { .src = buf, .path = argv[i], .limit = limit, .quiet = quiet };
		walk(ts_tree_root_node(t), &c);
		if (c.count) { bad_files++; total += c.count; }
		ts_tree_delete(t); free(buf);
	}
	ts_parser_delete(p);
	printf("%ld files (%ld KB): %ld with errors, %ld error nodes\n",
	       files, bytes / 1024, bad_files, total);
	return total ? 1 : 0;
}
