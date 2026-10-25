package expo.modules.lanrelay

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.java_websocket.WebSocket
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.server.WebSocketServer
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The host phone's side of two-phone play: a WebSocket relay on the local network (the home Wi-Fi,
 * or the host's own hotspot - no internet needed). Every text message a client sends is passed to
 * every other client; the game itself decides who is authoritative. Both phones' game pages and
 * lobbies connect to it as ordinary WebSocket clients.
 */
class LanRelayModule : Module() {
  private var relay: Relay? = null

  override fun definition() = ModuleDefinition {
    Name("LanRelay")

    Events("onPeers")

    /** This device's IPv4 addresses on the local network, Wi-Fi and hotspot first. */
    Function("localAddresses") {
      addresses()
    }

    Function("isRunning") {
      relay != null
    }

    /** Starts the relay, resolving once it listens, or rejecting if the port cannot be bound. */
    AsyncFunction("start") { port: Int ->
      stopRelay()
      val started = CountDownLatch(1)
      var failure: Exception? = null
      val server = Relay(port, onPeers = { count -> sendEvent("onPeers", mapOf("count" to count)) }, onStarted = { started.countDown() }) { error ->
        failure = error
        started.countDown()
      }
      server.isReuseAddr = true
      server.connectionLostTimeout = 10
      server.start()
      if (!started.await(4, TimeUnit.SECONDS)) {
        throw CodedException("ERR_RELAY_TIMEOUT", "The relay did not start in time", null)
      }
      failure?.let {
        runCatching { server.stop(200) }
        throw CodedException("ERR_RELAY_START", it.message ?: "The relay could not start", it)
      }
      relay = server
      mapOf("port" to port, "addresses" to addresses())
    }

    AsyncFunction("stop") {
      stopRelay()
    }

    OnDestroy {
      stopRelay()
    }
  }

  private fun stopRelay() {
    val server = relay ?: return
    relay = null
    runCatching { server.stop(500) }
  }

  private fun addresses(): List<Map<String, String>> {
    val found = mutableListOf<Map<String, String>>()
    val interfaces = runCatching { NetworkInterface.getNetworkInterfaces()?.toList() }.getOrNull() ?: emptyList()
    for (iface in interfaces) {
      if (!iface.isUp || iface.isLoopback) continue
      for (address in iface.inetAddresses) {
        if (address is Inet4Address && !address.isLoopbackAddress) {
          found += mapOf("name" to iface.name, "address" to (address.hostAddress ?: continue))
        }
      }
    }
    // Wi-Fi (wlan*) and hotspot (ap*, swlan*) interfaces are what a partner can reach.
    return found.sortedBy { if (Regex("^(wlan|ap|swlan)").containsMatchIn(it["name"] ?: "")) 0 else 1 }
  }
}

private class Relay(
  port: Int,
  private val onPeers: (Int) -> Unit,
  private val onStarted: () -> Unit,
  private val onFailed: (Exception) -> Unit,
) : WebSocketServer(InetSocketAddress(port)) {
  override fun onStart() = onStarted()

  override fun onOpen(conn: WebSocket, handshake: ClientHandshake) = onPeers(connections.size)

  override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) = onPeers(connections.size)

  override fun onMessage(conn: WebSocket, message: String) {
    for (other in connections) {
      if (other !== conn && other.isOpen) other.send(message)
    }
  }

  override fun onError(conn: WebSocket?, ex: Exception) {
    // An error with no connection is the server itself failing, usually a port in use.
    if (conn == null) onFailed(ex)
  }
}
