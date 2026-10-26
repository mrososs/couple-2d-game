package expo.modules.lanrelay

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.SystemClock
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.java_websocket.WebSocket
import org.java_websocket.drafts.Draft
import org.java_websocket.drafts.Draft_6455
import org.java_websocket.handshake.ClientHandshake
import org.java_websocket.protocols.IProtocol
import org.java_websocket.protocols.Protocol
import org.java_websocket.server.WebSocketServer
import org.json.JSONObject
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * The host phone's side of two-phone play: the room relay on the local network (the home Wi-Fi, or
 * the host's own hotspot - no internet needed), and finding rooms on it with Android's network
 * service discovery (mDNS).
 *
 * The relay follows the room protocol in src/game/net/room.ts - the same rules as the development
 * relay in scripts/lan-relay.ts, which the tests in tests/lan exercise. In short: every connection
 * authenticates first (the host app with its host key, from this phone only; the partner once with
 * the PIN, then with the key it is given), the host's frames go to the partner and the partner's
 * to the host with `from: "guest"` set here, and nobody else hears anything.
 */
class LanRelayModule : Module() {
  private var relay: RoomRelay? = null
  private val random = SecureRandom()
  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private val resolveQueue = ArrayDeque<NsdServiceInfo>()
  private var resolving = false
  private val nsdLock = Any()

  private val nsd: NsdManager?
    get() = appContext.reactContext?.getSystemService(Context.NSD_SERVICE) as? NsdManager

  override fun definition() = ModuleDefinition {
    Name("LanRelay")

    Events("onService", "onServiceLost")

    /** This device's IPv4 addresses a partner can reach: Wi-Fi and hotspot, never mobile data or a VPN. */
    Function("localAddresses") {
      addresses()
    }

    Function("isRunning") {
      relay != null
    }

    /** Starts the room, resolving once it listens with the host app's key, or rejecting if the port cannot be bound. */
    AsyncFunction("start") { port: Int ->
      stopRelay()
      val started = CountDownLatch(1)
      var failure: Exception? = null
      val hostKey = token(24)
      val server = RoomRelay(port, hostKey, random, onStarted = { started.countDown() }) { error ->
        failure = error
        started.countDown()
      }
      server.isReuseAddr = true
      server.connectionLostTimeout = 10
      server.start()
      if (!started.await(4, TimeUnit.SECONDS)) {
        runCatching { server.close() }
        throw CodedException("ERR_RELAY_TIMEOUT", "The relay did not start in time", null)
      }
      failure?.let {
        runCatching { server.close() }
        throw CodedException("ERR_RELAY_START", it.message ?: "The relay could not start", it)
      }
      relay = server
      mapOf("port" to port, "addresses" to addresses(), "hostKey" to hostKey)
    }

    AsyncFunction("stop") {
      stopAdvertising()
      stopRelay()
    }

    /** Lets phones on this network find the room, under the host's chosen name. */
    Function("advertise") { name: String, port: Int ->
      stopAdvertising()
      val manager = nsd ?: return@Function null
      val info = NsdServiceInfo().apply {
        serviceName = "bwbt-" + token(4).replace(Regex("[^A-Za-z0-9]"), "x")
        serviceType = SERVICE_TYPE
        setPort(port)
        // A name that does not fit a DNS-SD record is left out; the room is still found.
        runCatching { setAttribute("n", name.take(40)) }
        runCatching { setAttribute("v", "2") }
      }
      val listener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(info: NsdServiceInfo) {}
        override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {}
        override fun onServiceUnregistered(info: NsdServiceInfo) {}
        override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
      }
      registration = listener
      runCatching { manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener) }
      null
    }

    Function("stopAdvertising") {
      stopAdvertising()
    }

    /** Looks for rooms on this network, reporting each as onService and its disappearance as onServiceLost. */
    Function("startDiscovery") {
      stopDiscovery()
      val manager = nsd ?: return@Function null
      val listener = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(type: String, code: Int) {}
        override fun onStopDiscoveryFailed(type: String, code: Int) {}
        override fun onDiscoveryStarted(type: String) {}
        override fun onDiscoveryStopped(type: String) {}
        override fun onServiceFound(info: NsdServiceInfo) {
          if (info.serviceType.contains("_bwbt._tcp")) resolve(info)
        }
        override fun onServiceLost(info: NsdServiceInfo) {
          sendEvent("onServiceLost", mapOf("id" to info.serviceName))
        }
      }
      discovery = listener
      runCatching { manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
      null
    }

    Function("stopDiscovery") {
      stopDiscovery()
    }

    OnDestroy {
      stopDiscovery()
      stopAdvertising()
      stopRelay()
    }
  }

  private fun stopRelay() {
    val server = relay ?: return
    relay = null
    runCatching { server.close() }
  }

  private fun stopAdvertising() {
    val listener = registration ?: return
    registration = null
    runCatching { nsd?.unregisterService(listener) }
  }

  private fun stopDiscovery() {
    val listener = discovery ?: return
    discovery = null
    synchronized(nsdLock) { resolveQueue.clear() }
    runCatching { nsd?.stopServiceDiscovery(listener) }
  }

  /** Resolves found services one at a time (older Android versions allow only one at once). */
  private fun resolve(info: NsdServiceInfo) {
    synchronized(nsdLock) {
      resolveQueue.add(info)
      if (resolving) return
      resolving = true
    }
    resolveNext()
  }

  @Suppress("DEPRECATION")
  private fun resolveNext() {
    val next = synchronized(nsdLock) {
      val item = resolveQueue.poll()
      if (item == null) resolving = false
      item
    } ?: return
    val manager = nsd
    if (manager == null || discovery == null) {
      synchronized(nsdLock) { resolving = false; resolveQueue.clear() }
      return
    }
    val listener = object : NsdManager.ResolveListener {
      override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
        resolveNext()
      }
      override fun onServiceResolved(info: NsdServiceInfo) {
        val host = info.host
        val address = host?.hostAddress
        if (host is Inet4Address && address != null && isLocalNetwork(host)) {
          val name = info.attributes["n"]?.let { String(it, Charsets.UTF_8) } ?: info.serviceName
          sendEvent("onService", mapOf("id" to info.serviceName, "name" to name, "host" to address, "port" to info.port))
        }
        resolveNext()
      }
    }
    if (runCatching { manager.resolveService(next, listener) }.isFailure) resolveNext()
  }

  private fun token(bytes: Int): String {
    val buffer = ByteArray(bytes)
    random.nextBytes(buffer)
    return Base64.encodeToString(buffer, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }

  private fun addresses(): List<Map<String, String>> {
    val found = mutableListOf<Map<String, String>>()
    val interfaces = runCatching { NetworkInterface.getNetworkInterfaces()?.toList() }.getOrNull() ?: emptyList()
    for (iface in interfaces) {
      if (!iface.isUp || iface.isLoopback || NOT_LOCAL_INTERFACE.containsMatchIn(iface.name)) continue
      for (address in iface.inetAddresses) {
        if (address is Inet4Address && !address.isLoopbackAddress && isLocalNetwork(address)) {
          found += mapOf("name" to iface.name, "address" to (address.hostAddress ?: continue))
        }
      }
    }
    // Wi-Fi (wlan*) and hotspot (ap*, swlan*) interfaces first: they are what a partner can reach.
    return found.sortedBy { if (Regex("^(wlan|ap|swlan|softap)").containsMatchIn(it["name"] ?: "")) 0 else 1 }
  }

  companion object {
    const val SERVICE_TYPE = "_bwbt._tcp."
    /** Mobile data, VPNs and tunnels: never where a partner in the same room is. */
    val NOT_LOCAL_INTERFACE = Regex("^(rmnet|ccmni|pdp|v4-|clat|tun|ppp|dummy|ip6tnl|sit|ifb|radio|ipsec)")
  }
}

/** Private ranges home networks and hotspots use; anything else is beyond the local network. */
internal fun isLocalNetwork(address: InetAddress): Boolean {
  if (address.isLoopbackAddress || address.isSiteLocalAddress || address.isLinkLocalAddress) return true
  val b = address.address
  if (address is Inet4Address) {
    // Carrier-grade NAT space (100.64.0.0/10), which some phone hotspots hand out.
    return (b[0].toInt() and 0xff) == 100 && (b[1].toInt() and 0xc0) == 64
  }
  // IPv6 unique local addresses (fc00::/7).
  return address is Inet6Address && (b[0].toInt() and 0xfe) == 0xfc
}

/** The room protocol's numbers: src/game/net/room.ts. */
private object Room {
  const val VERSION = 2
  const val PATH = "/bwbt"
  const val AUTH_TIMEOUT_MS = 5000L
  const val MAX_PENDING = 4
  const val MAX_PER_ROLE = 3
  const val GUEST_MAX_CHARS = 4096
  const val HOST_MAX_BYTES = 1 shl 20
  const val GUEST_RATE_PER_SEC = 120.0
  const val GUEST_BURST = 240.0
  const val MAX_VIOLATIONS = 40
  const val MAX_PIN_FAILURES = 5
  const val PIN_SPACING_MS = 400L

  const val CLOSED = 4000
  const val AUTH_TIMEOUT = 4001
  const val BAD_AUTH = 4002
  const val BUSY = 4003
  const val ABUSE = 4008
  const val WRONG_PIN = 4401
  const val FORBIDDEN = 4403
  const val FULL = 4409
  const val BAD_KEY = 4410
  const val VERSION_MISMATCH = 4426
  const val SLOW_DOWN = 4429

  val DENY_CODES = mapOf(
    "pin" to WRONG_PIN, "full" to FULL, "key" to BAD_KEY, "version" to VERSION_MISMATCH,
    "forbidden" to FORBIDDEN, "malformed" to BAD_AUTH, "busy" to BUSY, "slow" to SLOW_DOWN,
  )
  val KEY = Regex("^[A-Za-z0-9_-]{16,64}$")
  val PIN = Regex("^\\d{6}$")
}

private class Peer(val address: InetAddress?) {
  var role: String? = null
  var tokens = Room.GUEST_BURST
  var refilledAt = SystemClock.elapsedRealtime()
  var violations = 0
  var timeout: ScheduledFuture<*>? = null
  val openedAt = SystemClock.elapsedRealtimeNanos()
}

private class RoomRelay(
  port: Int,
  private val hostKey: String,
  private val random: SecureRandom,
  private val onStarted: () -> Unit,
  private val onFailed: (Exception) -> Unit,
) : WebSocketServer(
  InetSocketAddress(port),
  // The frame size limit is enforced while reading, so nothing larger is ever buffered.
  listOf<Draft>(Draft_6455(emptyList(), listOf<IProtocol>(Protocol("")), Room.HOST_MAX_BYTES)),
) {
  private val lock = Any()
  private val timers = Executors.newSingleThreadScheduledExecutor()
  val room: String = hex(8)
  private var pin: String? = newPin()
  private var guestKey: String? = null
  private var pinFailures = 0
  private var failedAttempts = 0
  private var lastPinCheck = 0L

  override fun onStart() = onStarted()

  override fun onError(conn: WebSocket?, ex: Exception) {
    // An error with no connection is the server itself failing, usually a port in use.
    if (conn == null) onFailed(ex)
  }

  override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
    val address = conn.remoteSocketAddress?.address
    val path = handshake.resourceDescriptor ?: ""
    if (!path.startsWith(Room.PATH) || address == null || !isLocalNetwork(address)) {
      conn.close(Room.FORBIDDEN, "forbidden")
      return
    }
    synchronized(lock) {
      val pending = connections.count { it !== conn && it.getAttachment<Peer>()?.role == null }
      if (pending >= Room.MAX_PENDING) {
        conn.close(Room.BUSY, "busy")
        return
      }
      val peer = Peer(address)
      conn.setAttachment(peer)
      peer.timeout = timers.schedule({ if (peer.role == null) conn.close(Room.AUTH_TIMEOUT, "auth timeout") }, Room.AUTH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
    }
  }

  override fun onClose(conn: WebSocket, code: Int, reason: String?, remote: Boolean) {
    val peer = conn.getAttachment<Peer>() ?: return
    peer.timeout?.cancel(false)
    if (peer.role != null) synchronized(lock) { notifyHosts() }
  }

  override fun onMessage(conn: WebSocket, message: String) {
    val peer = conn.getAttachment<Peer>() ?: return
    when (peer.role) {
      null -> synchronized(lock) { authenticate(conn, peer, message) }
      "host" -> fromHost(message)
      else -> fromGuest(conn, peer, message)
    }
  }

  override fun onMessage(conn: WebSocket, message: ByteBuffer) {
    conn.getAttachment<Peer>()?.let { violation(conn, it) }
  }

  /** Closes every connection with "room closed" (a code that means do not retry), then the server. */
  fun close() {
    for (c in connections) runCatching { c.close(Room.CLOSED, "room closed") }
    runCatching { stop(500) }
    timers.shutdownNow()
  }

  // -----------------------------------------------------------------------------------------------

  private fun authenticate(conn: WebSocket, peer: Peer, text: String) {
    val auth = parseAuth(text) ?: return deny(conn, "malformed")
    if (auth.version != Room.VERSION) return deny(conn, "version")
    if (auth.role == "host") {
      if (peer.address?.isLoopbackAddress != true || auth.key == null || !sameSecret(auth.key, hostKey)) return deny(conn, "forbidden")
      return admit(conn, peer, "host", null)
    }
    if (auth.key != null) {
      val key = guestKey
      if (key == null || !sameSecret(auth.key, key)) return deny(conn, "key")
      return admit(conn, peer, "guest", null)
    }
    if (guestKey != null) return deny(conn, "full")
    val now = SystemClock.elapsedRealtime()
    if (now - lastPinCheck < Room.PIN_SPACING_MS) return deny(conn, "slow")
    lastPinCheck = now
    val current = pin
    if (current == null || auth.pin == null || !sameSecret(auth.pin, current)) {
      failedAttempts++
      if (++pinFailures >= Room.MAX_PIN_FAILURES) {
        pin = newPin()
        pinFailures = 0
      }
      notifyHosts()
      return deny(conn, "pin")
    }
    val key = token(24)
    guestKey = key
    pin = null
    pinFailures = 0
    admit(conn, peer, "guest", key)
  }

  /** At most a few connections per role: a new one replaces the oldest (a page that was reloaded). */
  private fun admit(conn: WebSocket, peer: Peer, role: String, key: String?) {
    val existing = byRole(role)
    if (existing.size >= Room.MAX_PER_ROLE) existing.first().close(Room.BUSY, "replaced")
    peer.role = role
    peer.timeout?.cancel(false)
    val authed = control("authed").put("role", role).put("room", room)
    if (key != null) authed.put("key", key)
    runCatching { conn.send(authed.toString()) }
    notifyHosts()
  }

  private fun deny(conn: WebSocket, reason: String) {
    runCatching { if (conn.isOpen) conn.send(control("denied").put("reason", reason).toString()) }
    conn.close(Room.DENY_CODES[reason] ?: Room.FORBIDDEN, reason)
  }

  private fun fromHost(text: String) {
    if (text.length <= 128 && text.contains("\"ctl\"")) {
      val frame = runCatching { JSONObject(text) }.getOrNull()
      if (frame?.optString("ch") == "ctl") {
        if (frame.optString("t") == "reset") synchronized(lock) { reset() }
        return
      }
    }
    for (guest in byRole("guest")) runCatching { guest.send(text) }
  }

  private fun fromGuest(conn: WebSocket, peer: Peer, text: String) {
    val now = SystemClock.elapsedRealtime()
    peer.tokens = minOf(Room.GUEST_BURST, peer.tokens + (now - peer.refilledAt) / 1000.0 * Room.GUEST_RATE_PER_SEC)
    peer.refilledAt = now
    if (peer.tokens < 1 || text.length > Room.GUEST_MAX_CHARS) return violation(conn, peer)
    peer.tokens -= 1
    val message = runCatching { JSONObject(text) }.getOrNull() ?: return violation(conn, peer)
    val channel = message.optString("ch")
    if (channel != "lobby" && channel != "game") return violation(conn, peer)
    // Whatever the partner claims, the host hears it as coming from the partner.
    val stamped = message.put("from", "guest").toString()
    for (host in byRole("host")) runCatching { host.send(stamped) }
  }

  private fun violation(conn: WebSocket, peer: Peer) {
    if (++peer.violations >= Room.MAX_VIOLATIONS) conn.close(Room.ABUSE, "abuse")
  }

  /** The host forgets the partner: their key stops working, and a new PIN is shown. */
  private fun reset() {
    guestKey = null
    pin = newPin()
    pinFailures = 0
    failedAttempts = 0
    for (guest in byRole("guest")) guest.close(Room.BAD_KEY, "reset")
    timers.schedule({ synchronized(lock) { notifyHosts() } }, 50, TimeUnit.MILLISECONDS)
  }

  private fun notifyHosts() {
    val state = control("room")
      .put("room", room)
      .put("pin", pin ?: JSONObject.NULL)
      .put("paired", guestKey != null)
      .put("guests", byRole("guest").size)
      .put("failures", failedAttempts)
      .toString()
    for (host in byRole("host")) runCatching { host.send(state) }
  }

  private fun byRole(role: String): List<WebSocket> =
    connections.filter { it.isOpen && it.getAttachment<Peer>()?.role == role }.sortedBy { it.getAttachment<Peer>()?.openedAt ?: 0L }

  /** Control frames start with the channel, as the clients expect: {"ch":"ctl","t":...}. */
  private fun control(type: String) = JSONObject().put("ch", "ctl").put("t", type)

  private fun newPin(): String = String.format(java.util.Locale.ROOT, "%06d", random.nextInt(1_000_000))

  private fun token(bytes: Int): String {
    val buffer = ByteArray(bytes)
    random.nextBytes(buffer)
    return Base64.encodeToString(buffer, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }

  private fun hex(bytes: Int): String {
    val buffer = ByteArray(bytes)
    random.nextBytes(buffer)
    return buffer.joinToString("") { "%02x".format(it) }
  }
}

private class AuthFrame(val version: Int, val role: String, val key: String?, val pin: String?)

/** A client's first frame, read strictly: null for anything that is not a well-formed auth frame. */
private fun parseAuth(text: String): AuthFrame? {
  if (text.length > 512) return null
  val frame = runCatching { JSONObject(text) }.getOrNull() ?: return null
  if (frame.optString("t") != "auth" || !frame.has("v")) return null
  val version = frame.optInt("v", -1)
  val role = frame.optString("role")
  if (role != "host" && role != "guest") return null
  val key = frame.optString("key").takeIf { Room.KEY.matches(it) }
  val pin = frame.optString("pin").takeIf { Room.PIN.matches(it) }
  if (key == null && pin == null) return null
  if (role == "host" && key == null) return null
  return AuthFrame(version, role, key, pin)
}

/** Compares two short secrets in time that does not depend on where they differ. */
private fun sameSecret(a: String, b: String): Boolean {
  if (a.length != b.length) return false
  var diff = 0
  for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
  return diff == 0
}
