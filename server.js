const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const db = new Database(process.env.DB_FILE || "anarhy.db");

const SECRET = process.env.JWT_SECRET || "change-this-secret";

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ANARHY backend",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ANARHY backend"
  });
});

app.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("ANARHY backend running");
});
