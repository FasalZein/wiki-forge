export function normalizeBody(text: string) {
  return text.replace(/\r\n/g, "\n").trimEnd();
}
