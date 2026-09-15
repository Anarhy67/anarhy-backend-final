const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();

/* CORS */
app.use(
  cors({
    origin: [
      "https://anarhytiktok.netlify.app",
      "http://localhost:3000",
      "http://localhost:5173"
    ],
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false
  })
);

app.options("*", cors());

app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "change-this-secret";

const db = new Database(process.env.DB_FILE || "anarhy.db");

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    xp INTEGER NOT NULL DEFAULT 0,
    strikes INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 100,
    deadline TEXT NOT NULL DEFAULT '22:00',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    tiktok_url TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_comment TEXT,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    UNIQUE(task_id, user_id),
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

function levelFromXp(xp) {
  if (xp >= 3000) return "Elite";
  if (xp >= 1000) return "Pro";
  return "Rookie";
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role
    },
    SECRET,
    { expiresIn: "30d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      ok: false,
      error: "Требуется авторизация"
    });
  }

  const token = header.replace("Bearer ", "");

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({
      ok: false,
      error: "Недействительный токен"
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({
      ok: false,
      error: "Доступ только для администратора"
    });
  }

  next();
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    xp: user.xp,
    level: levelFromXp(user.xp),
    strikes: user.strikes,
    streak: user.streak,
    created_at: user.created_at
  };
}

/* BASIC */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ANARHY TikTok OS",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ANARHY backend"
  });
});

/* AUTH */

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = String(
      req.body.email || `${username}@anarhy.local`
    ).trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        ok: false,
        error: "Заполни username и password"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Пароль минимум 6 символов"
      });
    }

    const exists = db
      .prepare("SELECT id FROM users WHERE username = ? OR email = ?")
      .get(username, email);

    if (exists) {
      return res.status(409).json({
        ok: false,
        error: "Username или email уже занят"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db
      .prepare(`
        INSERT INTO users
        (username, email, password_hash)
        VALUES (?, ?, ?)
      `)
      .run(username, email, passwordHash);

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(result.lastInsertRowid);

    return res.status(201).json({
      ok: true,
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка регистрации"
    });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(
      req.body.login ||
      req.body.username ||
      req.body.email ||
      ""
    ).trim();

    const password = String(req.body.password || "");

    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        error: "Введи логин и пароль"
      });
    }

    const user = db
      .prepare(`
        SELECT * FROM users
        WHERE username = ? OR email = ?
      `)
      .get(login, login);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Неверный логин или пароль"
      });
    }

    const valid = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!valid) {
      return res.status(401).json({
        ok: false,
        error: "Неверный логин или пароль"
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        ok: false,
        error: "Аккаунт заблокирован"
      });
    }

    return res.json({
      ok: true,
      token: createToken(user),
      user: publicUser(user)
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка входа"
    });
  }
});

app.get("/api/me", auth, (req, res) => {
  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.user.id);

  if (!user) {
    return res.status(404).json({
      ok: false,
      error: "Пользователь не найден"
    });
  }

  return res.json({
    ok: true,
    user: publicUser(user)
  });
});

/* TASKS */

app.get("/api/tasks", auth, (req, res) => {
  const tasks = db
    .prepare(`
      SELECT
        t.*,
        s.id AS submission_id,
        s.status AS submission_status,
        s.tiktok_url,
        s.note,
        s.admin_comment
      FROM tasks t
      LEFT JOIN submissions s
        ON s.task_id = t.id
        AND s.user_id = ?
      WHERE t.active = 1
      ORDER BY t.id ASC
    `)
    .all(req.user.id);

  return res.json({
    ok: true,
    tasks
  });
});

app.post("/api/tasks/:id/submit", auth, (req, res) => {
  const taskId = Number(req.params.id);
  const tiktok_url = String(req.body.tiktok_url || "").trim();
  const note = String(req.body.note || "");

  if (!tiktok_url) {
    return res.status(400).json({
      ok: false,
      error: "Нужна ссылка на TikTok"
    });
  }

  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ? AND active = 1")
    .get(taskId);

  if (!task) {
    return res.status(404).json({
      ok: false,
      error: "Задание не найдено"
    });
  }

  const existing = db
    .prepare(`
      SELECT id FROM submissions
      WHERE task_id = ? AND user_id = ?
    `)
    .get(taskId, req.user.id);

  if (existing) {
    return res.status(409).json({
      ok: false,
      error: "Ты уже отправлял это задание"
    });
  }

  const result = db
    .prepare(`
      INSERT INTO submissions
      (task_id, user_id, tiktok_url, note)
      VALUES (?, ?, ?, ?)
    `)
    .run(
      taskId,
      req.user.id,
      tiktok_url,
      note
    );

  return res.status(201).json({
    ok: true,
    submission_id: result.lastInsertRowid,
    message: "Отчёт отправлен на проверку"
  });
});

app.get("/api/submissions/me", auth, (req, res) => {
  const submissions = db
    .prepare(`
      SELECT
        s.*,
        t.title AS task_title,
        t.xp AS task_xp
      FROM submissions s
      JOIN tasks t ON t.id = s.task_id
      WHERE s.user_id = ?
      ORDER BY s.id DESC
    `)
    .all(req.user.id);

  return res.json({
    ok: true,
    submissions
  });
});

/* LEADERBOARD */

app.get("/api/leaderboard", auth, (req, res) => {
  const users = db
    .prepare(`
      SELECT id, username, xp, streak, strikes
      FROM users
      WHERE role = 'member'
      AND status = 'active'
      ORDER BY xp DESC, streak DESC
      LIMIT 100
    `)
    .all();

  return res.json({
    ok: true,
    leaderboard: users.map((user, index) => ({
      place: index + 1,
      ...user,
      level: levelFromXp(user.xp)
    }))
  });
});

/* ADMIN */

app.get("/api/admin/stats", auth, adminOnly, (req, res) => {
  const users = db
    .prepare("SELECT COUNT(*) AS count FROM users")
    .get().count;

  const tasks = db
    .prepare("SELECT COUNT(*) AS count FROM tasks WHERE active = 1")
    .get().count;

  const pending = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM submissions
      WHERE status = 'pending'
    `)
    .get().count;

  return res.json({
    ok: true,
    stats: {
      users,
      active_tasks: tasks,
      pending_submissions: pending
    }
  });
});

app.get("/api/admin/users", auth, adminOnly, (req, res) => {
  const users = db
    .prepare(`
      SELECT id, username, email, role, status,
             xp, strikes, streak, created_at
      FROM users
      ORDER BY id DESC
    `)
    .all();

  return res.json({
    ok: true,
    users: users.map(publicUser)
  });
});

app.post("/api/admin/tasks", auth, adminOnly, (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const xp = Number(req.body.xp) || 100;
  const deadline = String(req.body.deadline || "22:00");

  if (!title || !description) {
    return res.status(400).json({
      ok: false,
      error: "Нужны title и description"
    });
  }

  const result = db
    .prepare(`
      INSERT INTO tasks
      (title, description, xp, deadline)
      VALUES (?, ?, ?, ?)
    `)
    .run(
      title,
      description,
      xp,
      deadline
    );

  return res.status(201).json({
    ok: true,
    task_id: result.lastInsertRowid
  });
});

app.get("/api/admin/submissions", auth, adminOnly, (req, res) => {
  const submissions = db
    .prepare(`
      SELECT
        s.*,
        u.username,
        u.email,
        t.title AS task_title,
        t.xp AS task_xp
      FROM submissions s
      JOIN users u ON u.id = s.user_id
      JOIN tasks t ON t.id = s.task_id
      ORDER BY
        CASE WHEN s.status = 'pending' THEN 0 ELSE 1 END,
        s.id DESC
    `)
    .all();

  return res.json({
    ok: true,
    submissions
  });
});

app.patch(
  "/api/admin/submissions/:id",
  auth,
  adminOnly,
  (req, res) => {
    const submissionId = Number(req.params.id);
    const status = req.body.status;
    const admin_comment = String(
      req.body.admin_comment || ""
    );

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Статус должен быть approved или rejected"
      });
    }

    const submission = db
      .prepare(`
        SELECT s.*, t.xp AS task_xp
        FROM submissions s
        JOIN tasks t ON t.id = s.task_id
        WHERE s.id = ?
      `)
      .get(submissionId);

    if (!submission) {
      return res.status(404).json({
        ok: false,
        error: "Отчёт не найден"
      });
    }

    if (submission.status !== "pending") {
      return res.status(409).json({
        ok: false,
        error: "Этот отчёт уже проверен"
      });
    }

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(submission.user_id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    const xpAward =
      status === "approved"
        ? submission.task_xp
        : 0;

    const strikes =
      status === "rejected"
        ? Math.min(user.strikes + 1, 3)
        : user.strikes;

    const updateSubmission = db.prepare(`
      UPDATE submissions
      SET status = ?,
          admin_comment = ?,
          reviewed_at = CURRENT_TIMESTAMP,
          xp_awarded = ?
      WHERE id = ?
    `);

    const updateUser = db.prepare(`
      UPDATE users
      SET xp = xp + ?,
          strikes = ?
      WHERE id = ?
    `);

    const transaction = db.transaction(() => {
      updateSubmission.run(
        status,
        admin_comment,
        xpAward,
        submissionId
      );

      updateUser.run(
        xpAward,
        strikes,
        submission.user_id
      );
    });

    transaction();

    return res.json({
      ok: true,
      message:
        status === "approved"
          ? "Отчёт одобрен, XP начислен"
          : "Отчёт отклонён, strike начислен"
    });
  }
);

app.patch(
  "/api/admin/users/:id",
  auth,
  adminOnly,
  (req, res) => {
    const userId = Number(req.params.id);
    const status = req.body.status;
    const role = req.body.role;

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    if (
      status &&
      !["active", "blocked", "pending"].includes(status)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Недопустимый статус"
      });
    }

    if (
      role &&
      !["member", "admin"].includes(role)
    ) {
      return res.status(400).json({
        ok: false,
        error: "Недопустимая роль"
      });
    }

    db.prepare(`
      UPDATE users
      SET status = COALESCE(?, status),
          role = COALESCE(?, role)
      WHERE id = ?
    `).run(
      status || null,
      role || null,
      userId
    );

    return res.json({
      ok: true,
      message: "Пользователь обновлён"
    });
  }
);

/* BOOTSTRAP ADMIN */

async function ensureAdmin() {
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    console.log(
      "ADMIN_USERNAME / ADMIN_PASSWORD не заданы"
    );
    return;
  }

  const existing = db
    .prepare("SELECT id FROM users WHERE username = ?")
    .get(adminUsername);

  if (!existing) {
    const passwordHash = await bcrypt.hash(
      adminPassword,
      10
    );

    db.prepare(`
      INSERT INTO users
      (username, email, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run(
      adminUsername,
      `${adminUsername}@anarhy.local`,
      passwordHash
    );

    console.log("Admin account created");
  }
}

ensureAdmin()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `ANARHY TikTok OS running on port ${PORT}`
      );
    });
  })
  .catch((error) => {
    console.error("Startup error:", error);
    process.exit(1);
  });
