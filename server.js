// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

const app = express();
const server = http.createServer(app);

// 🔑 Replace with your actual GitHub Pages domain
const GITHUB_PAGES_ORIGIN = "https://siva0304.github.io/msg/";

// CORS middleware for REST API
app.use(cors({
  origin: GITHUB_PAGES_ORIGIN,
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"],
  credentials: true
}));

// Parse JSON
app.use(express.json());

// Socket.io with CORS config
const io = new Server(server, {
  cors: {
    origin: GITHUB_PAGES_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true }
});

// Handle WhatsApp QR and events
client.on("qr", async (qr) => {
  console.log("QR RECEIVED", qr);
  const dataUrl = await qrcode.toDataURL(qr);
  io.emit("qr", { dataUrl });
});

client.on("ready", () => {
  console.log("WhatsApp client is ready!");
  io.emit("ready");
});

// Example API route for orders
app.post("/api/order", async (req, res) => {
  const { phone, name, items, total, notes } = req.body;
  try {
    const orderText = `
📦 *New Pizza Order*
👤 Name: ${name}
📱 Phone: ${phone}
🍕 Items:
${items.map(i => `- ${i.name} x${i.qty}`).join("\n")}
💰 Total: ₹${total}
📝 Notes: ${notes || "N/A"}
    `;

    // Send WhatsApp message
    await client.sendMessage(`${phone}@c.us`, orderText);
    res.json({ success: true, message: "Order sent to WhatsApp!" });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ success: false, error: "Failed to send order." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Initialize WhatsApp client
client.initialize();
