/**
 * The development stand-in for the host phone's relay (modules/lan-relay), for trying two-phone
 * play in two browser tabs: every text message from one client goes to every other client. The
 * Android app does not use this; its host phone runs the same relay natively.
 *
 *   npm run relay        (listens on ws://0.0.0.0:7777)
 */
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 7777);
const server = new WebSocketServer({ port, host: '0.0.0.0' });

server.on('connection', (socket, request) => {
  console.log(`+ ${request.socket.remoteAddress} (${server.clients.size} connected)`);
  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = data.toString();
    for (const other of server.clients) if (other !== socket && other.readyState === 1) other.send(text);
  });
  socket.on('close', () => console.log(`- (${server.clients.size} connected)`));
});

console.log(`dev relay listening on ws://0.0.0.0:${port}`);
