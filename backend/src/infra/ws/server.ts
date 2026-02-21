import http from "http";
import { randomUUID } from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import type { AppContext } from "../../common/request-context";
import { isAppError } from "../../common/errors";
import type { StreamEvent } from "../events/event-bus";
import type { WsRouter } from "./router";
import type { WsResponse } from "./protocol";

export type WsServerClient = {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>;
  authUserId: string | null;
  authUser: {
    userId: string;
    username: string;
    roles: string[];
    sessionId?: string;
  } | null;
};

type WsServerOptions = {
  port: number;
  wsPath: string;
};

export class WsAppServer {
  private readonly httpServer: http.Server;
  private readonly wsServer: WebSocketServer;
  private readonly clients = new Map<string, WsServerClient>();
  private eventUnsubscribe: (() => void) | null = null;

  constructor(
    private readonly app: AppContext,
    private readonly router: WsRouter,
    private readonly options: WsServerOptions,
  ) {
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    this.wsServer = new WebSocketServer({ noServer: true });
  }

  async start(): Promise<void> {
    this.httpServer.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (url.pathname !== this.options.wsPath) {
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.wsServer.emit("connection", ws, req);
      });
    });

    this.wsServer.on("connection", (socket) => this.handleConnection(socket));

    this.eventUnsubscribe = this.app.eventBus.subscribe((event) => this.broadcastEvent(event));

    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.options.port, resolve);
    });

    this.app.logger.info(
      {
        module: "ws",
        port: this.options.port,
        path: this.options.wsPath,
      },
      "WS server started",
    );
  }

  async stop(): Promise<void> {
    this.eventUnsubscribe?.();
    for (const client of this.clients.values()) {
      client.socket.close();
    }
    await new Promise<void>((resolve, reject) => {
      this.wsServer.close((err) => (err ? reject(err) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleConnection(socket: WebSocket): void {
    const client: WsServerClient = {
      id: randomUUID(),
      socket,
      subscriptions: new Set<string>(),
      authUserId: null,
      authUser: null,
    };
    this.clients.set(client.id, client);
    this.updateActiveConnections();
    this.broadcastOnlineCount();

    socket.on("message", async (message) => {
      try {
        this.updateActiveConnections();
        const raw = message.toString();
        const response = await this.router.handleRawMessage(this.app, client, raw);
        this.send(client, response);
      } catch (error) {
        this.app.logger.error({ err: error, clientId: client.id }, "WS message handler failed");
      }
    });

    socket.on("close", () => {
      this.clients.delete(client.id);
      this.updateActiveConnections();
      this.broadcastOnlineCount();
    });

    socket.on("error", (error) => {
      this.app.logger.warn({ err: error, clientId: client.id }, "WS socket error");
    });
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }

    if (url.pathname === "/metrics") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(this.app.metrics));
      return;
    }

    if (req.method === "GET" && url.pathname === "/site/settings") {
      this.handlePublicSiteSettings(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/oxapay") {
      this.handleOxaPayWebhook(req, res);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "Not found" }));
  }

  private handlePublicSiteSettings(req: http.IncomingMessage, res: http.ServerResponse): void {
    const explicitHost = req.headers["x-site-host"];
    const forwardedHost = req.headers["x-forwarded-host"];
    const requestHost =
      (typeof explicitHost === "string" ? explicitHost : "") ||
      (typeof forwardedHost === "string" ? forwardedHost : "") ||
      (typeof req.headers.host === "string" ? req.headers.host : "");

    this.app.services.adminService
      .getPublicSiteSettings({ host: requestHost })
      .then((data) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, data }));
      })
      .catch((error) => {
        this.app.logger.error({ err: error, module: "site.settings" }, "Failed to load public site settings");
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "Failed to load site settings" }));
      });
  }

  private handleOxaPayWebhook(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readRawBody(req)
      .then(async (payload) => {
        let jsonPayload: Record<string, unknown> = {};
        if (payload.trim()) {
          const parsed = JSON.parse(payload) as unknown;
          if (parsed && typeof parsed === "object") {
            jsonPayload = parsed as Record<string, unknown>;
          }
        }

        const hmacHeader = typeof req.headers.hmac === "string" ? req.headers.hmac : null;
        await this.app.services.walletService.handleOxaPayWebhook(jsonPayload, payload, hmacHeader);
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
      })
      .catch((error) => {
        if (isAppError(error) && (error.code === "FORBIDDEN" || error.code === "VALIDATION_ERROR")) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid");
          return;
        }
        if (error instanceof SyntaxError) {
          res.writeHead(400, { "content-type": "text/plain" });
          res.end("invalid");
          return;
        }
        this.app.logger.error({ err: error, module: "wallet.oxapay.webhook" }, "OxaPay webhook failed");
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      });
  }

  private readRawBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > 1_000_000) {
          reject(new Error("Payload too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });

      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw);
      });

      req.on("error", (error) => {
        reject(error);
      });
    });
  }

  private send(client: WsServerClient, response: WsResponse<unknown>): void {
    if (client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    client.socket.send(JSON.stringify(response));
  }

  private broadcastEvent(event: StreamEvent): void {
    const payload: WsResponse<Record<string, unknown>> = {
      type: event.type,
      requestId: `event:${event.eventId ?? randomUUID()}`,
      ok: true,
      serverTs: Date.now(),
      data: event.payload,
      eventId: event.eventId,
      stateVersion: event.version,
    };

    for (const client of this.clients.values()) {
      if (client.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const userTargeted = Boolean(event.userId);
      const allowsUser = event.userId ? client.authUserId === event.userId : false;
      const allowsSubscription =
        client.subscriptions.has("*") ||
        client.subscriptions.has(event.aggregateType) ||
        client.subscriptions.has(event.type);

      if ((userTargeted && !allowsUser) || (!userTargeted && !allowsSubscription)) {
        continue;
      }
      client.socket.send(JSON.stringify(payload));
    }
  }

  private broadcastOnlineCount(): void {
    const onlineCount = this.updateActiveConnections();
    const payload: WsResponse<{ count: number }> = {
      type: "chat.online",
      requestId: `event:online:${randomUUID()}`,
      ok: true,
      serverTs: Date.now(),
      data: {
        count: onlineCount,
      },
      eventId: randomUUID(),
      stateVersion: Date.now(),
    };

    for (const client of this.clients.values()) {
      if (client.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      client.socket.send(JSON.stringify(payload));
    }
  }

  private updateActiveConnections(): number {
    let online = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        online += 1;
        continue;
      }
      if (client.socket.readyState === WebSocket.CLOSING || client.socket.readyState === WebSocket.CLOSED) {
        this.clients.delete(clientId);
      }
    }

    this.app.metrics.activeConnections = online;
    return online;
  }
}
