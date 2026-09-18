/** HTML helpers shared by the panel shell and the server-rendered views. */
export const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
/** Empty state for a view that could not load. */
export const emptyMarkup = text => `<div class="rounded-xl border bg-card p-12 text-center text-muted-foreground">${text}</div>`;
