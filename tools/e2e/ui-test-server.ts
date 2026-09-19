// Loaded only by the UI test: any backend HTTP integration is a test failure.
globalThis.fetch = async () => {
  console.error('UI_TEST_OUTBOUND_HTTP_BLOCKED');
  throw new Error('La prueba de interfaz no permite conexiones HTTP externas desde el servidor.');
};
await import('../../apps/api/dist/main.js');
