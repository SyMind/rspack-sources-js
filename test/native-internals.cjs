'use strict';
const binding = require('../dist/binding');

// Upstream cache assertions inspect native state without exposing JS fields.
exports.read = binding.debugSourceGetField;
