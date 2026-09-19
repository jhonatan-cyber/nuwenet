/** HTML helpers shared by the panel shell and the server-rendered views. */
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
/** Empty state for a view that could not load. */
export const emptyMarkup = (text: string): string => `<div class="rounded-xl border bg-card p-12 text-center text-muted-foreground">${text}</div>`;
