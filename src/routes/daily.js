"use strict";

const router = require("express").Router();
const db = require("../lib/supabase");

// ── GET /api/daily?date=YYYY-MM-DD  (list for a day) ─────────
router.get("/", async (req, res) => {
  const { date } = req.query;
  if (!date)
    return res.status(400).json({ error: "date query param is required" });

  const { data, error } = await db
    .from("daily_tasks")
    .select("*")
    .eq("date_key", date)
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/daily/:id  (single task — used by edit modal) ────
router.get("/:id", async (req, res) => {
  const { data, error } = await db
    .from("daily_tasks")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// ── POST /api/daily ───────────────────────────────────────────
router.post("/", async (req, res) => {
  const { id, name, hours, minutes, notes, status, date_key } = req.body;

  const { data, error } = await db
    .from("daily_tasks")
    .insert({
      id,
      name,
      hours,
      minutes,
      notes,
      status,
      date_key,
      user_id: req.user.id,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── PATCH /api/daily/:id ──────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const { data, error } = await db
    .from("daily_tasks")
    .update({ ...req.body, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/daily/:id ─────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await db
    .from("daily_tasks")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
