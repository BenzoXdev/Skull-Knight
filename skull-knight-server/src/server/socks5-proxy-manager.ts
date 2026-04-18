/**
 * Server-side SOCKS5 proxy manager.
 *
 * Opens TCP listeners on the Skull Knight server. Each listener is bound to a
 * specific agent (clientId).  When an external SOCKS5 client connects, the
 * server performs the SOCKS5 handshake locally and then tunnels the
 * connection through the agent's existing WebSocket channel.
 *
 * Protocol (new message types piggybacking on the existing wire format):
 *   Server → Agent  command { commandType: "proxy_connect", id: connId, payload: { host, port } }
 *   Server → Agent  command { commandType: "proxy_data",    id: connId, payload: { data: Uint8Array } }
 *   Server → Agent  command { commandType: "proxy_close",   id: connId }
 *   Agent  → Server { type: "proxy_data",  connectionId, data: Uint8Array }
 *   Agent  → Server { type: "proxy_close", connectionId }
 *   Agent  → Server { type: "command_result", commandId: connId, ok, message }  (for proxy_connect result)
 */

import type { Socket, TCPSocketListener } from "bun";
import { v4 as uuidv4 } from "uuid";
import { encodeMessage } from "../protocol";
import * as clientManager from "../clientManager";
import { logger } from "../logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProxyEntry = {
  clientId: string;
  port: number;
  listener: TCPSocketListener<ProxySocketData>;
  /** active tunnel connections keyed by connectionId */
  connections: Map<string, TunnelConnection>;
  createdAt: number;
};

type TunnelConnection = {
  socket: Socket<ProxySocketData>;
  /** whether the agent has confirmed the target connection */
  connected: boolean;
  /** buffer data received from SOCKS client before agent confirms */
  pendingData: Buffer[];
};

type ProxySocketData = {
  connectionId: string;
  proxyPort: number;
  /** SOCKS5 handshake phase */
  phase: "greeting" | "request" | "tunneling";
  buffer: Buffer;
};

// ── State ─────────────────────────────────────────────────────────────────────

/** port → ProxyEntry */
const activeProxies = new Map<number, ProxyEntry>();

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveProxies(): Array<{
  clientId: string;
  port: number;
  connections: number;
  createdAt: number;
}> {
  const out: Array<{
    clientId: string;
    port: number;
    connections: number;
    createdAt: number;
  }> = [];
  for (const [port, entry] of activeProxies) {
    out.push({
      clientId: entry.clientId,
      port,
      connections: entry.connections.size,
      createdAt: entry.createdAt,
    });
  }
  return out;
}

export function startProxy(
  clientId: string,
  port: number,
): { ok: boolean; message: string } {
  if (activeProxies.has(port)) {
    return { ok: false, message: `Port ${port} is already in use by another proxy` };
  }

  const target = clientManager.getClient(clientId);
  if (!target) {
    return { ok: false, message: `Client ${clientId} is not connected` };
  }

  const connections = new Map<string, TunnelConnection>();

  try {
    const listener = Bun.listen<ProxySocketData>({
      hostname: "0.0.0.0",
      port,
      socket: {
        open(socket) {
          const connectionId = uuidv4();
          socket.data = {
            connectionId,
            proxyPort: port,
            phase: "greeting",
            buffer: Buffer.alloc(0),
          };
          connections.set(connectionId, {
            socket,
            connected: false,
            pendingData: [],
          });
          logger.debug(
            `[socks5] new connection ${connectionId} on port ${port}`,
          );
        },

        data(socket, data) {
          const entry = activeProxies.get(socket.data.proxyPort);
          if (!entry) {
            socket.end();
            return;
          }
          handleSocksData(socket, Buffer.from(data), entry);
        },

        close(socket) {
          const entry = activeProxies.get(socket.data.proxyPort);
          if (!entry) return;
          const connId = socket.data.connectionId;
          const tunnel = entry.connections.get(connId);
          if (tunnel) {
            entry.connections.delete(connId);
            // tell agent to close its side
            const agent = clientManager.getClient(entry.clientId);
            if (agent) {
              try {
                agent.ws.send(
                  encodeMessage({
                    type: "command",
                    commandType: "proxy_close",
                    id: connId,
                  } as any),
                );
              } catch {}
            }
          }
          logger.debug(`[socks5] connection ${connId} closed`);
        },

        error(socket, err) {
          logger.error(
            `[socks5] socket error conn=${socket.data?.connectionId}`,
            err,
          );
        },
      },
    });

    const entry: ProxyEntry = {
      clientId,
      port,
      listener,
      connections,
      createdAt: Date.now(),
    };
    activeProxies.set(port, entry);
    logger.info(
      `[socks5] proxy started on port ${port} for client ${clientId}`,
    );
    return { ok: true, message: `Proxy started on port ${port}` };
  } catch (err: any) {
    return {
      ok: false,
      message: `Failed to listen on port ${port}: ${err.message || err}`,
    };
  }
}

export function stopProxy(port: number): { ok: boolean; message: string } {
  const entry = activeProxies.get(port);
  if (!entry) {
    return { ok: false, message: `No proxy running on port ${port}` };
  }

  // close all tunnel connections
  for (const [connId, tunnel] of entry.connections) {
    try {
      tunnel.socket.end();
    } catch {}
    // notify agent
    const agent = clientManager.getClient(entry.clientId);
    if (agent) {
      try {
        agent.ws.send(
          encodeMessage({
            type: "command",
            commandType: "proxy_close",
            id: connId,
          } as any),
        );
      } catch {}
    }
  }

  entry.listener.stop(true);
  activeProxies.delete(port);
  logger.info(`[socks5] proxy stopped on port ${port}`);
  return { ok: true, message: `Proxy on port ${port} stopped` };
}

export function stopAllProxiesForClient(clientId: string): void {
  for (const [port, entry] of activeProxies) {
    if (entry.clientId === clientId) {
      stopProxy(port);
    }
  }
}


export function handleProxyTunnelData(
  clientId: string,
  connectionId: string,
  data: Uint8Array,
): void {
  for (const entry of activeProxies.values()) {
    if (entry.clientId !== clientId) continue;
    const tunnel = entry.connections.get(connectionId);
    if (tunnel) {
      try {
        tunnel.socket.write(data);
      } catch {
        entry.connections.delete(connectionId);
      }
      return;
    }
  }
}

/** Called when the agent closes its side of a tunnel */
export function handleProxyTunnelClose(
  clientId: string,
  connectionId: string,
): void {
  for (const entry of activeProxies.values()) {
    if (entry.clientId !== clientId) continue;
    const tunnel = entry.connections.get(connectionId);
    if (tunnel) {
      entry.connections.delete(connectionId);
      try {
        tunnel.socket.end();
      } catch {}
      return;
    }
  }
}

export function handleProxyConnectResult(
  clientId: string,
  connectionId: string,
  ok: boolean,
): void {
  for (const entry of activeProxies.values()) {
    if (entry.clientId !== clientId) continue;
    const tunnel = entry.connections.get(connectionId);
    if (!tunnel) return;

    if (ok) {
      tunnel.connected = true;
      // send SOCKS5 success response
      //  VER | REP | RSV | ATYP | BND.ADDR (4 bytes)  | BND.PORT (2 bytes)
      tunnel.socket.write(
        Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      logger.debug(`[socks5] tunnel established (conn=${connectionId})`);
      // flush any data that arrived between handshake and connect
      for (const buf of tunnel.pendingData) {
        sendDataToAgent(entry.clientId, connectionId, buf);
      }
      tunnel.pendingData = [];
    } else {
      logger.debug(`[socks5] tunnel rejected by agent (conn=${connectionId})`);
      // SOCKS5 connection-refused reply
      tunnel.socket.write(
        Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      tunnel.socket.end();
      entry.connections.delete(connectionId);
    }
    return;
  }
}

function handleSocksData(
  socket: Socket<ProxySocketData>,
  incoming: Buffer,
  entry: ProxyEntry,
) {
  const { connectionId, phase } = socket.data;

  if (phase === "tunneling") {
    const tunnel = entry.connections.get(connectionId);
    if (!tunnel) {
      socket.end();
      return;
    }
    if (!tunnel.connected) {
      tunnel.pendingData.push(incoming);
      return;
    }
    sendDataToAgent(entry.clientId, connectionId, incoming);
    return;
  }

  socket.data.buffer = Buffer.concat([socket.data.buffer, incoming]);
  const buf = socket.data.buffer;

  if (phase === "greeting") {
    if (buf.length < 2) return;
    const ver = buf[0];
    const nmethods = buf[1];
    if (ver !== 5) {
      socket.end();
      entry.connections.delete(connectionId);
      return;
    }
    if (buf.length < 2 + nmethods) return;

    socket.write(Buffer.from([0x05, 0x00]));
    socket.data.phase = "request";
    socket.data.buffer = buf.subarray(2 + nmethods);

    if (socket.data.buffer.length > 0) {
      handleSocksData(socket, Buffer.alloc(0), entry);
    }
    return;
  }

  if (phase === "request") {
    if (buf.length < 4) return;
    const ver = buf[0];
    const cmd = buf[1];
    const atyp = buf[3];

    if (ver !== 5) {
      socket.end();
      entry.connections.delete(connectionId);
      return;
    }
    if (cmd !== 1) {
      socket.write(
        Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      socket.end();
      entry.connections.delete(connectionId);
      return;
    }

    let host: string;
    let portOffset: number;

    switch (atyp) {
      case 1: {
        if (buf.length < 10) return;
        host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
        portOffset = 8;
        break;
      }
      case 3: {
        if (buf.length < 5) return;
        const domainLen = buf[4];
        if (buf.length < 5 + domainLen + 2) return;
        host = buf.subarray(5, 5 + domainLen).toString("utf8");
        portOffset = 5 + domainLen;
        break;
      }
      case 4: {
        if (buf.length < 22) return;
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) {
          parts.push(buf.readUInt16BE(4 + i).toString(16));
        }
        host = parts.join(":");
        portOffset = 20;
        break;
      }
      default: {
        socket.write(
          Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
        );
        socket.end();
        entry.connections.delete(connectionId);
        return;
      }
    }

    const port = buf.readUInt16BE(portOffset);
    logger.debug(
      `[socks5] CONNECT request → ${host}:${port} (conn=${connectionId})`,
    );

    socket.data.phase = "tunneling";
    socket.data.buffer = Buffer.alloc(0);

    const agent = clientManager.getClient(entry.clientId);
    if (!agent) {
      socket.write(
        Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]),
      );
      socket.end();
      entry.connections.delete(connectionId);
      return;
    }

    agent.ws.send(
      encodeMessage({
        type: "command",
        commandType: "proxy_connect",
        id: connectionId,
        payload: { host, port },
      } as any),
    );

    const remaining = buf.subarray(portOffset + 2);
    if (remaining.length > 0) {
      const tunnel = entry.connections.get(connectionId);
      if (tunnel) tunnel.pendingData.push(remaining);
    }
    return;
  }
}

function sendDataToAgent(
  clientId: string,
  connectionId: string,
  data: Buffer | Uint8Array,
): void {
  const agent = clientManager.getClient(clientId);
  if (!agent) return;
  try {
    agent.ws.send(
      encodeMessage({
        type: "command",
        commandType: "proxy_data",
        id: connectionId,
        payload: { data: new Uint8Array(data) },
      } as any),
    );
  } catch (err) {
    logger.error(`[socks5] failed to send data to agent ${clientId}`, err);
  }
}
