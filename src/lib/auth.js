"use strict";

const db = require("./supabase");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const { data: { user }, error } = await db.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = user;
    req.db = db.getClient(token);
    next();
  } catch (err) {
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

module.exports = authMiddleware;
