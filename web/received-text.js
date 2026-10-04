// Native FTextRX semantics: edits affect the current line and whole characters.
export function appendReceivedText(current, incoming, limit = 1000000) {
  for (const character of incoming) {
    if (character === '\b') {
      if (current.length > current.lastIndexOf('\n') + 1) {
        const tail = current.charCodeAt(current.length - 1);
        const pair = tail >= 0xdc00 && tail <= 0xdfff && current.length > 1 &&
          current.charCodeAt(current.length - 2) >= 0xd800 && current.charCodeAt(current.length - 2) <= 0xdbff;
        current = current.slice(0, pair ? -2 : -1);
      }
    } else if (character !== '\r' && character !== '\0') current += character;
  }
  if (current.length > limit) {
    let start = current.length - limit;
    if (current.charCodeAt(start) >= 0xdc00 && current.charCodeAt(start) <= 0xdfff) start++;
    current = current.slice(start);
  }
  return current;
}
