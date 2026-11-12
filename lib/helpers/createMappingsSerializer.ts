/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
const ALPHABET = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
];
// Char codes of ALPHABET for the buffer-writing path.
const ALPHABET_CODES = new Uint8Array(64);
for (let i = 0; i < 64; i++)
  ALPHABET_CODES[i] = ALPHABET[i].charCodeAt(0);
const CH_SEMICOLON = 59; // ;
const CH_COMMA = 44; // ,
const CH_A = 65; // A
const CONTINUATION_BIT = 0x20;
/**
 * Append a VLQ-encoded signed integer to `str`. Hoisted to module scope so
 * that both serializers share a single function object and avoid allocating
 * a new closure on every call.
 */
const writeValue = (str: string, value: number): string => {
  const sign = (value >>> 31) & 1;
  const mask = value >> 31;
  const absValue = (value + mask) ^ mask;
  let data = (absValue << 1) | sign;
  for (; ;) {
    const sextet = data & 0x1f;
    data >>= 5;
    if (data === 0) {
      return str + ALPHABET[sextet];
    }
    str += ALPHABET[sextet | CONTINUATION_BIT];
  }
};
/**
 * Byte-buffer state shared by the writer variants. A plain object (not a
 * class) so the hot `add` closures capture it directly.
 */
const createBufferState = (): {
  buf: Uint8Array<ArrayBufferLike>;
  pos: number;
} => ({ buf: new Uint8Array(1024), pos: 0 });
/**
 * Ensure space for `n` more bytes.
 */
const ensure = (state: {
  buf: Uint8Array<ArrayBufferLike>;
  pos: number;
}, n: number): Uint8Array<ArrayBufferLike> => {
  const { buf, pos } = state;
  if (pos + n <= buf.length)
    return buf;
  let nextLength = buf.length * 2;
  while (nextLength < pos + n)
    nextLength *= 2;
  const next = new Uint8Array(nextLength);
  next.set(buf);
  state.buf = next;
  return next;
};
/**
 * Append a VLQ-encoded signed integer to the byte buffer. The caller must
 * have reserved space already (a 32-bit value needs at most 7 sextets).
 */
const writeValueBytes = (state: {
  buf: Uint8Array<ArrayBufferLike>;
  pos: number;
}, value: number): void => {
  const { buf } = state;
  let { pos } = state;
  const sign = (value >>> 31) & 1;
  const mask = value >> 31;
  const absValue = (value + mask) ^ mask;
  let data = (absValue << 1) | sign;
  for (; ;) {
    const sextet = data & 0x1f;
    data >>= 5;
    if (data === 0) {
      buf[pos++] = ALPHABET_CODES[sextet];
      break;
    }
    buf[pos++] = ALPHABET_CODES[sextet | CONTINUATION_BIT];
  }
  state.pos = pos;
};
const bufferToString = (state: {
  buf: Uint8Array<ArrayBufferLike>;
  pos: number;
}): string => {
  if (state.pos === 0)
    return "";
  // The mappings alphabet is pure ASCII, so a latin1 decode is exact and
  // needs no re-encoding pass.
  return Buffer.from(state.buf.buffer, 0, state.pos).toString("latin1");
};
const createFullMappingsWriter = (): MappingsWriter => {
  const state = createBufferState();
  let currentLine = 1;
  let currentColumn = 0;
  let currentSourceIndex = 0;
  let currentOriginalLine = 1;
  let currentOriginalColumn = 0;
  let currentNameIndex = 0;
  let activeMapping = false;
  let activeName = false;
  let initial = true;
  return {
    add(generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) {
      if (activeMapping && currentLine === generatedLine) {
        // A mapping is still active
        if (sourceIndex === currentSourceIndex &&
          originalLine === currentOriginalLine &&
          originalColumn === currentOriginalColumn &&
          !activeName &&
          nameIndex < 0) {
          // avoid repeating the same original mapping
          return;
        }
      }
      // No mapping is active
      else if (sourceIndex < 0) {
        // avoid writing unneccessary generated mappings
        return;
      }
      // Reserve the worst case for one mapping in a single check:
      // line separators + 5 VLQ values of up to 7 sextets each.
      const lineDiff = generatedLine - currentLine;
      const buf = ensure(state, (lineDiff > 0 ? lineDiff : 1) + 35);
      if (lineDiff > 0) {
        // Consecutive lines (diff === 1) are the dominant case.
        buf[state.pos++] = CH_SEMICOLON;
        for (let i = 1; i < lineDiff; i++)
          buf[state.pos++] = CH_SEMICOLON;
        currentLine = generatedLine;
        currentColumn = 0;
        initial = false;
      }
      else if (initial) {
        initial = false;
      }
      else {
        buf[state.pos++] = CH_COMMA;
      }
      writeValueBytes(state, generatedColumn - currentColumn);
      currentColumn = generatedColumn;
      if (sourceIndex >= 0) {
        activeMapping = true;
        if (sourceIndex === currentSourceIndex) {
          buf[state.pos++] = CH_A;
        }
        else {
          writeValueBytes(state, sourceIndex - currentSourceIndex);
          currentSourceIndex = sourceIndex;
        }
        writeValueBytes(state, originalLine - currentOriginalLine);
        currentOriginalLine = originalLine;
        if (originalColumn === currentOriginalColumn) {
          buf[state.pos++] = CH_A;
        }
        else {
          writeValueBytes(state, originalColumn - currentOriginalColumn);
          currentOriginalColumn = originalColumn;
        }
        if (nameIndex >= 0) {
          writeValueBytes(state, nameIndex - currentNameIndex);
          currentNameIndex = nameIndex;
          activeName = true;
        }
        else {
          activeName = false;
        }
      }
      else {
        activeMapping = false;
      }
    },
    finish: () => bufferToString(state),
  };
};
const createFullMappingsSerializer = () => {
  let currentLine = 1;
  let currentColumn = 0;
  let currentSourceIndex = 0;
  let currentOriginalLine = 1;
  let currentOriginalColumn = 0;
  let currentNameIndex = 0;
  let activeMapping = false;
  let activeName = false;
  let initial = true;
  return (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => {
    if (activeMapping && currentLine === generatedLine) {
      // A mapping is still active
      if (sourceIndex === currentSourceIndex &&
        originalLine === currentOriginalLine &&
        originalColumn === currentOriginalColumn &&
        !activeName &&
        nameIndex < 0) {
        // avoid repeating the same original mapping
        return "";
      }
    }
    // No mapping is active
    else if (sourceIndex < 0) {
      // avoid writing unneccessary generated mappings
      return "";
    }
    let str;
    if (currentLine < generatedLine) {
      // Consecutive lines (diff === 1) are the dominant case; avoid the
      // `.repeat()` call entirely for them.
      str =
        generatedLine === currentLine + 1
          ? ";"
          : ";".repeat(generatedLine - currentLine);
      currentLine = generatedLine;
      currentColumn = 0;
      initial = false;
    }
    else if (initial) {
      str = "";
      initial = false;
    }
    else {
      str = ",";
    }
    str = writeValue(str, generatedColumn - currentColumn);
    currentColumn = generatedColumn;
    if (sourceIndex >= 0) {
      activeMapping = true;
      if (sourceIndex === currentSourceIndex) {
        str += "A";
      }
      else {
        str = writeValue(str, sourceIndex - currentSourceIndex);
        currentSourceIndex = sourceIndex;
      }
      str = writeValue(str, originalLine - currentOriginalLine);
      currentOriginalLine = originalLine;
      if (originalColumn === currentOriginalColumn) {
        str += "A";
      }
      else {
        str = writeValue(str, originalColumn - currentOriginalColumn);
        currentOriginalColumn = originalColumn;
      }
      if (nameIndex >= 0) {
        str = writeValue(str, nameIndex - currentNameIndex);
        currentNameIndex = nameIndex;
        activeName = true;
      }
      else {
        activeName = false;
      }
    }
    else {
      activeMapping = false;
    }
    return str;
  };
};
const createLinesOnlyMappingsSerializer = () => {
  let lastWrittenLine = 0;
  let currentLine = 1;
  let currentSourceIndex = 0;
  let currentOriginalLine = 1;
  return (generatedLine: number, _generatedColumn: number, sourceIndex: number, originalLine: number, _originalColumn: number, _nameIndex: number) => {
    if (sourceIndex < 0) {
      // avoid writing generated mappings at all
      return "";
    }
    if (lastWrittenLine === generatedLine) {
      // avoid writing multiple original mappings per line
      return "";
    }
    let str;
    lastWrittenLine = generatedLine;
    if (generatedLine === currentLine + 1) {
      currentLine = generatedLine;
      if (sourceIndex === currentSourceIndex) {
        if (originalLine === currentOriginalLine + 1) {
          currentOriginalLine = originalLine;
          return ";AACA";
        }
        str = ";AA";
        str = writeValue(str, originalLine - currentOriginalLine);
        currentOriginalLine = originalLine;
        return `${str}A`;
      }
      str = ";A";
      str = writeValue(str, sourceIndex - currentSourceIndex);
      currentSourceIndex = sourceIndex;
      str = writeValue(str, originalLine - currentOriginalLine);
      currentOriginalLine = originalLine;
      return `${str}A`;
    }
    str = ";".repeat(generatedLine - currentLine);
    currentLine = generatedLine;
    if (sourceIndex === currentSourceIndex) {
      if (originalLine === currentOriginalLine + 1) {
        currentOriginalLine = originalLine;
        return `${str}AACA`;
      }
      str += "AA";
      str = writeValue(str, originalLine - currentOriginalLine);
      currentOriginalLine = originalLine;
      return `${str}A`;
    }
    str += "A";
    str = writeValue(str, sourceIndex - currentSourceIndex);
    currentSourceIndex = sourceIndex;
    str = writeValue(str, originalLine - currentOriginalLine);
    currentOriginalLine = originalLine;
    return `${str}A`;
  };
};
/**
 * Lines-only mappings emit at most one short — usually constant — segment
 * per generated line, so the classic string encoding plus cons-string
 * append is already optimal there (measurably faster than byte-writing).
 * Only the full serializer, which emits per token, benefits from the byte
 * buffer. The encoding below mirrors `createLinesOnlyMappingsSerializer`,
 * inlined so `add` costs a single call.
 */
const createLinesOnlyMappingsWriter = (): MappingsWriter => {
  let mappings = "";
  let lastWrittenLine = 0;
  let currentLine = 1;
  let currentSourceIndex = 0;
  let currentOriginalLine = 1;
  return {
    add(generatedLine: number, _generatedColumn: number, sourceIndex: number, originalLine: number, _originalColumn: number, _nameIndex: number) {
      if (sourceIndex < 0) {
        // avoid writing generated mappings at all
        return;
      }
      if (lastWrittenLine === generatedLine) {
        // avoid writing multiple original mappings per line
        return;
      }
      let str;
      lastWrittenLine = generatedLine;
      if (generatedLine === currentLine + 1) {
        currentLine = generatedLine;
        if (sourceIndex === currentSourceIndex) {
          if (originalLine === currentOriginalLine + 1) {
            currentOriginalLine = originalLine;
            mappings += ";AACA";
            return;
          }
          str = ";AA";
          str = writeValue(str, originalLine - currentOriginalLine);
          currentOriginalLine = originalLine;
          mappings += `${str}A`;
          return;
        }
        str = ";A";
        str = writeValue(str, sourceIndex - currentSourceIndex);
        currentSourceIndex = sourceIndex;
        str = writeValue(str, originalLine - currentOriginalLine);
        currentOriginalLine = originalLine;
        mappings += `${str}A`;
        return;
      }
      str = ";".repeat(generatedLine - currentLine);
      currentLine = generatedLine;
      if (sourceIndex === currentSourceIndex) {
        if (originalLine === currentOriginalLine + 1) {
          currentOriginalLine = originalLine;
          mappings += `${str}AACA`;
          return;
        }
        str += "AA";
        str = writeValue(str, originalLine - currentOriginalLine);
        currentOriginalLine = originalLine;
        mappings += `${str}A`;
        return;
      }
      str += "A";
      str = writeValue(str, sourceIndex - currentSourceIndex);
      currentSourceIndex = sourceIndex;
      str = writeValue(str, originalLine - currentOriginalLine);
      currentOriginalLine = originalLine;
      mappings += `${str}A`;
    },
    finish: () => mappings,
  };
};

function createMappingsSerializer(options?: {
  columns?: boolean | undefined;
} | undefined): MappingsSerializer {
  const linesOnly = options && options.columns === false;
  return linesOnly
    ? createLinesOnlyMappingsSerializer()
    : createFullMappingsSerializer();
}
const createMappingsWriterImpl = (options?: {
  columns?: boolean | undefined;
} | undefined): MappingsWriter => {
  const linesOnly = options && options.columns === false;
  return linesOnly
    ? createLinesOnlyMappingsWriter()
    : createFullMappingsWriter();
};
export = createMappingsSerializer;
namespace createMappingsSerializer {
  export const createMappingsWriter = createMappingsWriterImpl;
}
declare namespace createMappingsSerializer {
  export { MappingsSerializer, MappingsWriter };
}
type MappingsSerializer = (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => string;
type MappingsWriter = {
  /**
   * append one mapping
   */
  add: (generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number, nameIndex: number) => void;
  /**
   * materialise the mappings string
   */
  finish: () => string;
};
