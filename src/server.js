"use strict";

require("dotenv").config();
const express = require("express");
const path = require("path");
const auth = require("./lib/auth");

const app = express();

// ── Middleware ────────────────────────────────────────────────
app.use(express.json());

// ── Static frontend (public/) ─────────────────────────────────
app.use(express.static(path.join(__dirname, "../public")));

// ── API Routes (Public) ───────────────────────────────────────
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  });
});

// ── API Routes (Authenticated) ────────────────────────────────
app.use("/api/daily", auth, require("./routes/daily"));
app.use("/api/work", auth, require("./routes/work"));
app.use("/api/learn", auth, require("./routes/learn"));

// ── Fallback → serve index.html (SPA-style) ──────────────────
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ── Start (Only if run directly) ──────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n🚀  DayLog running → http://localhost:${PORT}\n`);
  });
}

module.exports = app;
