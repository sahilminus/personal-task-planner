"use strict";

const router = require("express").Router();
const db = require("../lib/supabase");

async function tableExists(tableName) {
  const { error } = await db.from(tableName).select("id").limit(1);
  return !error;
}

// ── GET /api/learn/topics ───────────────────────────────────
router.get("/topics", async (req, res) => {
  const topics = new Set();

  const { data: noteTopics, error: notesError } = await db
    .from("learn_notes")
    .select("topic")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: true });

  if (notesError) return res.status(500).json({ error: notesError.message });
  (noteTopics || []).forEach((row) => {
    if (row.topic) topics.add(row.topic);
  });

  if (await tableExists("learn_topics")) {
    const { data: topicRows, error: topicError } = await db
      .from("learn_topics")
      .select("name")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: true });

    if (topicError) return res.status(500).json({ error: topicError.message });
    (topicRows || []).forEach((row) => {
      if (row.name) topics.add(row.name);
    });
  }

  res.json(Array.from(topics).map((name) => ({ name })));
});

// ── POST /api/learn/topics ──────────────────────────────────
router.post("/topics", async (req, res) => {
  const name = (req.body?.name || "").trim();
  const id = req.body?.id;

  if (!name) return res.status(400).json({ error: "name is required" });

  if (!(await tableExists("learn_topics"))) {
    return res.status(400).json({
      error:
        "learn_topics table not found. Run latest schema.sql to enable custom topic creation.",
    });
  }

  const { data, error } = await db
    .from("learn_topics")
    .insert({ id, name, user_id: req.user.id, created_at: new Date().toISOString() })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Topic already exists" });
    }
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

// ── DELETE /api/learn/topics/:name ─────────────────────────
router.delete("/topics/:name", async (req, res) => {
  const { name } = req.params;

  const { error: tasksError } = await db
    .from("learn_notes")
    .delete()
    .eq("topic", name)
    .eq("user_id", req.user.id);

  if (tasksError) return res.status(500).json({ error: tasksError.message });

  if (await tableExists("learn_topics")) {
    const { error: topicError } = await db
      .from("learn_topics")
      .delete()
      .eq("name", name)
      .eq("user_id", req.user.id);
    
    if (topicError) return res.status(500).json({ error: topicError.message });
  }

  res.json({ success: true });
});

// ── GET /api/learn?topic=hld ──────────────────────────────────
router.get("/", async (req, res) => {
  const { topic } = req.query;
  
  let query = db
    .from("learn_notes")
    .select("*")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });
  
  if (topic) {
    query = query.eq("topic", topic);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── GET /api/learn/:id  (single — used by edit modal) ────────
router.get("/:id", async (req, res) => {
  const { data, error } = await db
    .from("learn_notes")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// ── POST /api/learn ───────────────────────────────────────────
router.post("/", async (req, res) => {
  const { id, topic, title, content, tags, status, start_date, end_date } =
    req.body;

  const { data, error } = await db
    .from("learn_notes")
    .insert({
      id,
      topic,
      title,
      content,
      tags,
      status,
      start_date,
      end_date,
      user_id: req.user.id,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    if (
      error.code === "42703" ||
      /start_date|end_date|status/.test(error.message || "")
    ) {
      return res.status(400).json({
        error:
          "learn_notes is missing new columns (status/start_date/end_date). Run latest schema.sql migration.",
      });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// ── PATCH /api/learn/:id ──────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const { data, error } = await db
    .from("learn_notes")
    .update({ ...req.body, user_id: req.user.id, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .select()
    .single();

  if (error) {
    if (
      error.code === "42703" ||
      /start_date|end_date|status/.test(error.message || "")
    ) {
      return res.status(400).json({
        error:
          "learn_notes is missing new columns (status/start_date/end_date). Run latest schema.sql migration.",
      });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ── DELETE /api/learn/:id ─────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await db
    .from("learn_notes")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
