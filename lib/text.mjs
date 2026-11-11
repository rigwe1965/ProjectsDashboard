// Cleaning of text the owner types for the customer to read (the name and welcome note on a demo link). It is later put into a web page, where it is also
// escaped, but it is kept free of control characters at the door as well.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
const LINE_SEPARATORS = new RegExp('[' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');
const strip = (s) => String(s ?? '').replace(LINE_SEPARATORS, ' ');

// One line: every control character and line break becomes a space, runs of spaces become one, cut to `max` characters.
export const oneLine = (s, max) => strip(s).replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// A short note: line breaks are kept (at most one blank line in a row), other control characters become spaces, cut to `max` characters.
export const noteText = (s, max) => strip(s).replace(/\r\n?/g, '\n')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
