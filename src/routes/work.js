"use strict";

const router = require("express").Router();
const db = require("../lib/supabase");

async function tableExists(tableName) {
  const { error } = await db.from(tableName).select("id").limit(1);
  return !error;
}

// ── GET /api/work/topics ───────────────────────────────────
router.get("/topics", async (req, res) => {
  const topics = new Set();

  const { data: workTasks, error: tasksError } = await db
    .from("work_tasks")
    .select("topic")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: true });

  if (tasksError) return res.status(500).json({ error: tasksError.message });
  (workTasks || []).forEach((row) => {
    if (row.topic) topics.add(row.topic);
  });

  if (await tableExists("work_topics")) {
    const { data: topicRows, error: topicError } = await db
      .from("work_topics")
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

// ── POST /api/work/topics ──────────────────────────────────
router.post("/topics", async (req, res) => {
  const name = (req.body?.name || "").trim();
  const id = req.body?.id;

  if (!name) return res.status(400).json({ error: "name is required" });

  if (!(await tableExists("work_topics"))) {
    return res.status(400).json({
      error:
        "work_topics table not found. Run latest schema.sql to enable custom topic creation.",
    });
  }

  const { data, error } = await db
    .from("work_topics")
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

// ── DELETE /api/work/topics/:name ──────────────────────────
router.delete("/topics/:name", async (req, res) => {
  const { name } = req.params;

  const { error: tasksError } = await db
    .from("work_tasks")
    .delete()
    .eq("topic", name)
    .eq("user_id", req.user.id);

  if (tasksError) return res.status(500).json({ error: tasksError.message });

  if (await tableExists("work_topics")) {
    const { error: topicError } = await db
      .from("work_topics")
      .delete()
      .eq("name", name)
      .eq("user_id", req.user.id);
    
    if (topicError) return res.status(500).json({ error: topicError.message });
  }

  res.json({ success: true });
});

// ── GET /api/work  (all work tasks filtered by optional topic) ─────────
router.get("/", async (req, res) => {
  const { topic } = req.query;

  let query = db
    .from("work_tasks")
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

// ── GET /api/work/:id  (single — used by edit modal) ─────────
router.get("/:id", async (req, res) => {
  const { data, error } = await db
    .from("work_tasks")
    .select("*")
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  res.json(data);
});

// ── POST /api/work ────────────────────────────────────────────
router.post("/", async (req, res) => {
  const { id, topic, name, priority, notes, status, end_date } = req.body;

  const payload = {
    id,
    topic,
    name,
    priority,
    notes,
    status,
    created_at: new Date().toISOString(),
  };
  if (end_date !== undefined) payload.end_date = end_date;

  const { data, error } = await db
    .from("work_tasks")
    .insert({ ...payload, user_id: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ── PATCH /api/work/:id ───────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  if (!Object.prototype.hasOwnProperty.call(req.body, "end_date")) {
    delete payload.end_date;
  }

  const { data, error } = await db
    .from("work_tasks")
    .update(payload)
    .eq("id", req.params.id)
    .eq("user_id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── DELETE /api/work/:id ──────────────────────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await db
    .from("work_tasks")
    .delete()
    .eq("id", req.params.id)
    .eq("user_id", req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
