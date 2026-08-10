/**
 * chatgpt-web-provider entrypoint.
 *
 * Boot order: config → logger → Chrome (connect or launch) → ChatGPT page →
 * client → HTTP server on 127.0.0.1:8765. If the browser is unavailable the
 * server still starts (degraded /health); chat requests fail closed with 503.
 */

import { loadConfig } from './config.js';
import { initLogger, getLogger } from './observability/logger.js';
import { ChromeManager } from './browser/chrome.js';
import { LocatorEngine } from './semantic/locator-engine.js';
import { ChatGPTClient } from './chatgpt/client.js';
import { buildServer } from './api/server.js';
import { AdapterError } from './chatgpt/errors.js';
import { Persistence } from './persistence/sqlite.js';
import { computeUiFingerprint, saveFingerprint, fingerprintChangeSinceLast } from './healing/fingerprint.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = initLogger(config.logLevel);
  logger.info(
    { host: config.host, port: config.port, cdp: `${config.cdpHost}:${config.cdpPort}` },
    'starting chatgpt-web-provider',
  );

  const persistence = config.dbPath ? new Persistence({ dbPath: config.dbPath }) : null;
  if (persistence) {
    logger.info({ db: config.dbPath }, 'persistence enabled');
  }

  const chrome = new ChromeManager({
    chromePath: config.chromePath,
    cdpHost: config.cdpHost,
    cdpPort: config.cdpPort,
    profileDir: config.profileDir,
    launchAtStartup: config.launchChromeAtStartup,
    chatgptBaseUrl: config.chatgptBaseUrl,
    logger,
  });

  let client: ChatGPTClient | null = null;
  try {
    const page = await chrome.chatgptPage();
    const engine = new LocatorEngine({ hints: config.uiHints });
    client = new ChatGPTClient(page, engine, {
      timeoutMs: config.timeoutMs,
      responseStableMs: config.responseStableMs,
      authMarkers: config.authMarkers,
      humanMarkers: config.humanMarkers,
      rateLimitMarkers: config.rateLimitMarkers,
      chatgptBaseUrl: config.chatgptBaseUrl,
      logger,
      persistence: persistence ?? undefined,
    });
    logger.info('browser connected');
    if (persistence && client) {
      // Phase 3: fingerprint drift detection → passive inspection posture.
      try {
        const fp = await computeUiFingerprint(page);
        const changed = fingerprintChangeSinceLast(persistence, fp);
        saveFingerprint(persistence, fp);
        if (changed) {
          logger.warn({ fingerprint: fp.hash, features: fp.features }, 'UI fingerprint changed since last run; rules will be re-validated by usage');
        } else {
          logger.info({ fingerprint: fp.hash }, 'UI fingerprint matches last run');
        }
      } catch (err) {
        logger.warn({ err: String(err) }, 'fingerprint check failed (non-fatal)');
      }
      const reports = await client.resumeUnfinished().catch((err) => {
        logger.warn({ err: String(err) }, 'resume cycle failed');
        return [];
      });
      for (const r of reports) {
        logger.info({ request: r.request_id, status: r.status, error: r.error }, 'resume report');
      }
    }
  } catch (err) {
    const code = err instanceof AdapterError ? err.code : 'UNKNOWN';
    logger.warn({ code, err: String(err) }, 'browser not available at startup; running degraded');
  }

  // ---- Reconnect loop (spec §31): detect CDP loss, attempt limited
  // reconnect (connect first, relaunch Chrome as a fallback), swap the
  // client reference. Never fabricates state; fails closed meanwhile.
  let reconnecting = false;
  let connectFailures = 0;
  const connectClient = async (): Promise<ChatGPTClient | null> => {
    try {
      const page = await chrome.chatgptPage();
      const engine = new LocatorEngine({ hints: config.uiHints });
      return new ChatGPTClient(page, engine, {
        timeoutMs: config.timeoutMs,
        responseStableMs: config.responseStableMs,
        authMarkers: config.authMarkers,
        humanMarkers: config.humanMarkers,
        rateLimitMarkers: config.rateLimitMarkers,
        chatgptBaseUrl: config.chatgptBaseUrl,
        logger,
        persistence: persistence ?? undefined,
      });
    } catch (err) {
      logger.warn({ err: String(err) }, 'reconnect attempt failed');
      return null;
    }
  };
  const ensureConnected = async (): Promise<void> => {
    if (reconnecting) return;
    if (client && (await client.health())) {
      connectFailures = 0;
      return;
    }
    reconnecting = true;
    try {
      await chrome.close().catch(() => undefined); // drop stale CDP refs
      const fresh = await connectClient();
      if (fresh) {
        client = fresh;
        connectFailures = 0;
        logger.info('browser (re)connected');
      } else {
        connectFailures += 1;
        if (connectFailures >= 3) {
          // The Chrome DevTools service is wedged (ws handshake times out even
          // though /json/version answers): force-restart the Chrome process.
          logger.warn({ failures: connectFailures }, 'reconnect failed repeatedly; restarting Chrome');
          await chrome.restart().catch((err) => logger.warn({ err: String(err) }, 'chrome restart failed'));
          connectFailures = 0;
        }
      }
    } finally {
      reconnecting = false;
    }
  };
  void ensureConnected();
  setInterval(() => void ensureConnected(), 20_000);

  const app = await buildServer({
    config,
    logger,
    client: () => client,
    chrome,
  });
  await app.listen({ host: config.host, port: config.port });
  logger.info(`listening on http://${config.host}:${config.port} (model: chatgpt-web)`);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close().catch(() => undefined);
    await chrome.close().catch(() => undefined);
    persistence?.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});
