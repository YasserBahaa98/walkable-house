let counter = 0;

/** Short unique id, stable enough for local projects. */
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
