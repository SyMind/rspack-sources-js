"use strict";

const assert = require("assert");
const { afterEach, describe, it } = require("node:test");
const createMappingsSerializer = require("webpack-sources/lib/helpers/createMappingsSerializer");
const { createMappingsWriter } = createMappingsSerializer;
const getSource = require("webpack-sources/lib/helpers/getSource");
const readMappings = require("webpack-sources/lib/helpers/readMappings");
const splitIntoLines = require("webpack-sources/lib/helpers/splitIntoLines");
const {
	disableDualStringBufferCaching,
	enableDualStringBufferCaching,
	enterStringInterningRange,
	exitStringInterningRange,
	internString,
	isDualStringBufferCachingEnabled,
} = require("../../dist/helpers/stringBufferUtils");

describe("getSource", () => {
	const baseMap = {
		version: 3,
		sources: ["a.js", "b.js"],
		names: [],
		mappings: "",
		file: "x",
	};

	it("should return null for negative index", () => {
		assert.strictEqual(getSource(baseMap, -1), null);
	});

	it("should return source as-is when no sourceRoot", () => {
		assert.strictEqual(getSource(baseMap, 0), "a.js");
		assert.strictEqual(getSource(baseMap, 1), "b.js");
	});

	it("should prefix sourceRoot without trailing slash", () => {
		assert.strictEqual(
			getSource({ ...baseMap, sourceRoot: "src" }, 0),
			"src/a.js",
		);
	});

	it("should prefix sourceRoot with trailing slash", () => {
		assert.strictEqual(
			getSource({ ...baseMap, sourceRoot: "src/" }, 0),
			"src/a.js",
		);
	});
});

describe("splitIntoLines", () => {
	it("should split simple lines", () => {
		assert.deepStrictEqual(splitIntoLines("a\nb\nc"), ["a\n", "b\n", "c"]);
	});

	it("should handle trailing newline", () => {
		assert.deepStrictEqual(splitIntoLines("a\nb\n"), ["a\n", "b\n"]);
	});

	it("should handle empty string", () => {
		assert.deepStrictEqual(splitIntoLines(""), []);
	});
});

describe("readMappings", () => {
	it("should ignore out-of-range characters", () => {
		const mappings = [];
		// The tilde char (charCode 126) is out of the ccToValue range
		readMappings("AAAA~;AAAA", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 2);
		assert.deepStrictEqual(mappings[0], [1, 0, 0, 1, 0, -1]);
	});

	it("should handle empty mappings", () => {
		const mappings = [];
		readMappings("", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 0);
	});

	it("should parse simple mapping with source", () => {
		const mappings = [];
		readMappings("AAAA", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 1);
		assert.deepStrictEqual(mappings[0], [1, 0, 0, 1, 0, -1]);
	});

	it("should parse mapping with name", () => {
		const mappings = [];
		readMappings("AAAAA", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 1);
		assert.deepStrictEqual(mappings[0], [1, 0, 0, 1, 0, 0]);
	});

	it("should parse multiple lines", () => {
		const mappings = [];
		readMappings("AAAA;AACA", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 2);
	});

	it("should preserve negative cumulative deltas (signed VLQ)", () => {
		// Second segment "CAAD" emits deltas (+1, 0, 0, -1) which drives
		// originalColumn negative. With an unsigned accumulator this would
		// wrap to 4294967295.
		const mappings = [];
		readMappings("AAAA;CAAD", (...args) => {
			mappings.push(args);
		});
		assert.strictEqual(mappings.length, 2);
		assert.deepStrictEqual(mappings[0], [1, 0, 0, 1, 0, -1]);
		assert.deepStrictEqual(mappings[1], [2, 1, 0, 1, -1, -1]);
	});
});

describe("stringBufferUtils", () => {
	afterEach(() => {
		enableDualStringBufferCaching();
	});

	it("should toggle dual string buffer caching", () => {
		assert.strictEqual(isDualStringBufferCachingEnabled(), true);
		disableDualStringBufferCaching();
		assert.strictEqual(isDualStringBufferCachingEnabled(), false);
		enableDualStringBufferCaching();
		assert.strictEqual(isDualStringBufferCachingEnabled(), true);
	});

	it("should intern strings only when interning is enabled", () => {
		const big = "a".repeat(200);
		const big2 = `${"a".repeat(199)}a`;
		// Ensure we start from a clean slate
		assert.strictEqual(internString(big), big);

		enterStringInterningRange();
		try {
			const interned1 = internString(big);
			const interned2 = internString(big2);
			assert.strictEqual(interned1, big);
			// Both strings have same content so should be deduplicated
			assert.strictEqual(interned2, interned1);
		} finally {
			exitStringInterningRange();
		}
	});

	it("should not intern short strings", () => {
		enterStringInterningRange();
		try {
			const shortStr = "short";
			assert.strictEqual(internString(shortStr), shortStr);
		} finally {
			exitStringInterningRange();
		}
	});

	it("should not intern falsy strings", () => {
		enterStringInterningRange();
		try {
			assert.strictEqual(internString(""), "");
		} finally {
			exitStringInterningRange();
		}
	});

	it("should nest interning ranges properly", () => {
		enterStringInterningRange();
		enterStringInterningRange();
		const big = "b".repeat(200);
		const interned1 = internString(big);
		exitStringInterningRange();
		// Still enabled because one range is still open
		const interned2 = internString(big);
		assert.strictEqual(interned2, interned1);
		exitStringInterningRange();
		// Now disabled; cache should be cleared, fresh string returned as-is
		const freshStr = "c".repeat(200);
		assert.strictEqual(internString(freshStr), freshStr);
	});
});

describe("createMappingsSerializer / createMappingsWriter", () => {
	/**
	 * A mapping event stream covering every serializer branch: initial
	 * mapping, same-line comma separation, repeated original mapping
	 * (skipped), generated-only mapping while active / while inactive,
	 * name indices, source switches, single- and multi-line gaps,
	 * backwards original lines (sign bit) and huge deltas (VLQ
	 * continuation across several sextets).
	 * @type {[number, number, number, number, number, number][]}
	 */
	const branchEvents = [
		[1, 0, 0, 1, 0, -1],
		// exact repeat of the active original mapping -> skipped
		[1, 4, 0, 1, 0, -1],
		// generated-only mapping while a mapping is active -> written
		[1, 8, -1, -1, -1, -1],
		// generated-only mapping while inactive -> skipped
		[1, 10, -1, -1, -1, -1],
		[2, 0, 0, 2, 0, 0],
		// same line, source switch plus name -> comma separation
		[2, 5, 1, 3, 2, 1],
		// multi-line gap plus huge original line delta (VLQ continuation)
		[5, 0, 0, 900001, 0, -1],
		// same line, backwards original line (negative delta, sign bit)
		[5, 3, 0, 1, 0, -1],
		// same original column fast path ("A")
		[6, 0, 2, 5, 0, 2],
		[7, 2, 2, 6, 0, -1],
	];

	/**
	 * Long alternating stream: enough bytes to force the writer's buffer
	 * to grow past its initial capacity, with per-line repeats and gaps so
	 * the lines-only variants hit all of their branches too.
	 * @type {[number, number, number, number, number, number][]}
	 */
	const longEvents = [];
	for (let i = 0; i < 3000; i++) {
		const line = Math.floor(i / 2) + 1;
		// every fourth segment names no source, so it has no original
		// position or name either
		longEvents.push(
			i % 4 === 3
				? [line, (i % 2) * 7, -1, -1, -1, -1]
				: [
						line,
						(i % 2) * 7,
						i % 3,
						(i * 37) % 5000 || 1,
						(i % 9) * 2,
						i % 7 === 0 ? i % 5 : -1,
					],
		);
	}
	// a trailing multi-line jump
	longEvents.push([2000, 0, 0, 1, 0, -1]);

	/**
	 * @param {{ columns?: boolean } | undefined} options options
	 * @param {[number, number, number, number, number, number][]} events events
	 * @returns {{ fromSerializer: string, fromWriter: string }} both encodings
	 */
	const encodeBoth = (options, events) => {
		const serialize = createMappingsSerializer(options);
		const writer = createMappingsWriter(options);
		let fromSerializer = "";
		for (const event of events) {
			fromSerializer += serialize(...event);
			writer.add(...event);
		}
		return { fromSerializer, fromWriter: writer.finish() };
	};

	/** @type {[string, { columns?: boolean } | undefined][]} */
	const modes = [
		["full (columns: true)", undefined],
		["lines-only (columns: false)", { columns: false }],
	];
	for (const [label, options] of modes) {
		it(`${label}: writer output equals serializer output (branch stream)`, () => {
			const { fromSerializer, fromWriter } = encodeBoth(options, branchEvents);
			assert.strictEqual(fromWriter, fromSerializer);
			assert.ok(fromWriter.length > 0);
		});

		it(`${label}: writer output equals serializer output (long stream, buffer growth)`, () => {
			const { fromSerializer, fromWriter } = encodeBoth(options, longEvents);
			assert.strictEqual(fromWriter, fromSerializer);
			// must exceed the writer's initial 1024-byte buffer
			assert.ok(fromWriter.length > 2048);
		});
	}

	it("full: encodes the branch stream to the expected mappings", () => {
		const { fromSerializer } = encodeBoth(undefined, branchEvents);
		assert.strictEqual(
			fromSerializer,
			"AAAA,Q;AACAA,KCCEC;;;AD8592BF,GAh692BA;AEIAC;EACA",
		);
	});

	it("lines-only: uses the constant segment for consecutive lines", () => {
		/** @type {[number, number, number, number, number, number][]} */
		const events = [
			[1, 0, 0, 1, 0, -1],
			// consecutive generated+original line, same source -> ";AACA"
			[2, 0, 0, 2, 0, -1],
			// repeated generated line -> skipped
			[2, 5, 0, 3, 0, -1],
			// consecutive line, same source, non-consecutive original line
			[3, 0, 0, 7, 0, -1],
			// consecutive line, source switch
			[4, 0, 1, 1, 0, -1],
			// multi-line gap, same source, consecutive original line
			[7, 0, 1, 2, 0, -1],
			// multi-line gap, same source, non-consecutive original line
			[9, 0, 1, 9, 0, -1],
			// multi-line gap plus source switch
			[11, 0, 0, 4, 0, -1],
			// generated-only mapping -> skipped
			[12, 0, -1, -1, -1, -1],
		];
		const { fromSerializer, fromWriter } = encodeBoth(
			{ columns: false },
			events,
		);
		assert.strictEqual(fromWriter, fromSerializer);
		assert.strictEqual(
			fromSerializer,
			"AAAA;AACA;AAKA;ACNA;;;AACA;;AAOA;;ADLA",
		);
	});

	it("writer finish() returns an empty string when nothing was written", () => {
		for (const options of [undefined, { columns: false }]) {
			const writer = createMappingsWriter(options);
			// only skippable events
			writer.add(1, 0, -1, -1, -1, -1);
			assert.strictEqual(writer.finish(), "");
		}
	});
});
