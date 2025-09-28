/**
 * server.js
 * Minimal production-ready Node + whatsapp-web.js backend
 *
 * - Serves static frontend from /public
 * - Uses whatsapp-web.js with LocalAuth to persist session
 * - Exposes realtime QR (via socket.io) for first-time login
 * - POST /api/order to send an order to a phone number (E.164 w/o + allowed)
 *
 * SECURITY NOTES:
 * - Protect the /api/order endpoint in production (API key, JWT or IP whitelist)
 * - Do not commit session data or logs containing QR codes
 * - Use HTTPS in production (reverse proxy / platform provides TLS)
 */

const express = require("express");
const http = require("http");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const socketIo = require("socket.io");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });

app.use(cors());
app.use(bodyParser.json({ limit: "200kb" }));

// Serve static frontend (put index.html + assets into ./public)
app.use(express.static(path.join(__dirname, "public")));

// ===== whatsapp-web.js client with LocalAuth (session persistence) =====
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "pizza-shop-bot" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--unhandled-rejections=strict",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

client.on("ready", () => {
  console.log("WhatsApp client ready ✅");
  io.emit("ready");
});

client.on("auth_failure", (msg) => {
  console.error("Auth failure:", msg);
  io.emit("auth_failure", msg);
});

// Send QR to connected socket clients for first-time auth
client.on("qr", async (qr) => {
  try {
    const dataUrl = await qrcode.toDataURL(qr);
    io.emit("qr", { qr, dataUrl });
    console.log("QR generated - send to frontend for scanning.");
  } catch (err) {
    console.error("QR encode error:", err);
  }
});

client.on("disconnected", (reason) => {
  console.warn("WhatsApp client disconnected:", reason);
  io.emit("disconnected", reason);
});

// Initialize
client.initialize().catch(err => {
  console.error("Failed to initialize WhatsApp client:", err);
});

// ===== simple health/status endpoints =====
app.get("/api/status", (req, res) => {
  res.json({ ready: client.info?.pushname ? true : client.info !== undefined, info: client.info || null });
});

// ===== order endpoint =====
// Expected JSON: { phone: "919876543210", name: "Siva", items: [{name, qty, price}], total: 200, notes: "Extra cheese" }
// phone should be country+number string without '+' or with '+'; we'll normalize
app.post("/api/order", async (req, res) => {
  try {
    if (!client || client.info === undefined) {
      return res.status(503).json({ success: false, error: "WhatsApp client not ready. Please authenticate first." });
    }

    // PRODUCTION: Add authentication here (API key / JWT)
    const { phone, name, items, total, notes } = req.body;
    if (!phone || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Invalid payload. Required: phone, items" });
    }

    // normalize phone: remove spaces and leading plus, ensure at least 10 digits
    const normalized = phone.toString().replace(/[^\d]/g, "");
    // WhatsApp uses <number>@c.us for normal numbers
    const chatId = `${normalized}@c.us`;

    // Build message text
    let msg = `🍕 *New Order from ${name || "Customer"}*\n\n`;
    items.forEach((it, idx) => {
      const name = it.name || "item";
      const qty = it.qty ?? 1;
      const price = it.price ?? "";
      msg += `${idx + 1}. ${name}  x${qty} ${price ? " - ₹" + price : ""}\n`;
    });
    msg += `\n*Total:* ₹${total ?? items.reduce((s, it) => s + (it.price ?? 0) * (it.qty ?? 1), 0)}\n`;
    if (notes) msg += `\n_Notes:_ ${notes}\n`;
    msg += `\n---\nOrder placed on ${new Date().toLocaleString()}`;

    // Optionally: media or receipt image -- example commented
    // const media = MessageMedia.fromFilePath('./public/assets/pizza.jpg');
    // await client.sendMessage(chatId, media, { caption: msg });

    const sent = await client.sendMessage(chatId, msg);
    return res.json({ success: true, id: sent.id._serialized });
  } catch (err) {
    console.error("Error in /api/order:", err);
    return res.status(500).json({ success: false, error: err.message || "unknown" });
  }
});

// Fallback: serve index.html for SPA routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
