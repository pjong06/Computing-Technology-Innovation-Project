'use strict';

function registerBackendShutdown({ server, cameraAI, mqttClient, processRef = process, timeoutMs = 20000 }) {
  let pending;
  function shutdown() {
    if (pending) return pending;
    pending = (async () => {
      const timer = setTimeout(() => processRef.exit(1), timeoutMs);
      timer.unref?.();
      try {
        await Promise.all([
          new Promise(resolve => server.close(resolve)),
          cameraAI.stop(),
          mqttClient ? new Promise(resolve => mqttClient.end(false, {}, resolve)) : Promise.resolve(),
        ]);
        clearTimeout(timer);
        processRef.exit(0);
      } catch {
        clearTimeout(timer);
        processRef.exit(1);
      }
    })();
    return pending;
  }
  processRef.once('SIGTERM', shutdown);
  processRef.once('SIGINT', shutdown);
  return shutdown;
}
module.exports = { registerBackendShutdown };
