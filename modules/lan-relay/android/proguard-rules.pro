# Applied to the app's release build (consumerProguardFiles in build.gradle).
#
# R8 merged Java-WebSocket's WebSocketServer into the module's Relay subclass and rewrote its
# synchronized single-thread check in run(), and Android's verifier rejected the result ("expected
# to be within a catch-all for an instruction where a monitor is held"), so in release builds the
# relay could not start and no room could be opened. Keep the library's code as written.
-keep class org.java_websocket.** { *; }
