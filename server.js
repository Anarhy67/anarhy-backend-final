const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

// ==================================================
// CONFIG
// ==================================================

const app = express();

const PORT = process.env.PORT || 10000;

const JWT_SECRET =
  process.env.JWT_SECRET || "anarhy-super-secret-change-this-later";

const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || "admin@anarhy.ru";

const DB_FILE = "anarhy.sqlite";

const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

app.use(
  cors({
    origin: true,
    credentials: false
  })
);

app.use(express.json({ limit: "2mb" }));

// ==================================================
// DATABASE
// ==================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nickname TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    avatar TEXT DEFAULT '',
    about TEXT DEFAULT '',
    xp INTEGER NOT NULL DEFAULT 0,
    level TEXT NOT NULL DEFAULT 'Rookie',
    penalties INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    videos_required INTEGER NOT NULL DEFAULT 3,
    deadline TEXT NOT NULL DEFAULT '22:00',
    xp_reward INTEGER NOT NULL DEFAULT 40,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER NOT NULL,
    video_url TEXT NOT NULL,
    text TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    xp_reward INTEGER NOT NULL DEFAULT 40,
    report_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    xp_awarded INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS penalties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// ==================================================
// MIGRATIONS FOR OLD DATABASE
// ==================================================

function addColumnIfMissing(table, column, definition) {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((item) => item.name);

  if (!columns.includes(column)) {
    db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
    );
  }
}

addColumnIfMissing("users", "avatar", "TEXT DEFAULT ''");
addColumnIfMissing("users", "about", "TEXT DEFAULT ''");
addColumnIfMissing("users", "xp", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "level", "TEXT NOT NULL DEFAULT 'Rookie'");
addColumnIfMissing("users", "penalties", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("users", "status", "TEXT NOT NULL DEFAULT 'active'");
addColumnIfMissing(
  "users",
  "created_at",
  "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"
);

addColumnIfMissing(
  "reports",
  "xp_awarded",
  "INTEGER NOT NULL DEFAULT 0"
);

// ==================================================
// DEFAULT ADMIN
// ==================================================

const adminExists = db
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(ADMIN_EMAIL);

if (!adminExists) {
  const passwordHash = bcrypt.hashSync(
    process.env.ADMIN_PASSWORD || "ChangeMe123!",
    12
  );

  db.prepare(`
    INSERT INTO users
      (name, nickname, email, password, role, status)
    VALUES
      (?, ?, ?, ?, 'admin', 'active')
  `).run(
    "ANARHY Admin",
    "admin",
    ADMIN_EMAIL,
    passwordHash
  );

  console.log("Admin account created:");
  console.log("Email:", ADMIN_EMAIL);
  console.log(
    "Password:",
    process.env.ADMIN_PASSWORD || "ChangeMe123!"
  );
}

// ==================================================
// DEFAULT TASKS
// ==================================================

const taskCount = db
  .prepare("SELECT COUNT(*) AS count FROM tasks")
  .get().count;

if (taskCount === 0) {
  const insertTask = db.prepare(`
    INSERT INTO tasks
      (title, description, videos_required, deadline, xp_reward, active)
    VALUES
      (?, ?, ?, ?, ?, 1)
  `);

  insertTask.run(
    "Нарезка #01",
    "Создай и опубликуй 3 TikTok-ролика по материалам проекта.",
    3,
    "22:00",
    40
  );

  insertTask.run(
    "Нарезка #02",
    "Создай и опубликуй 3 TikTok-ролика по материалам проекта.",
    3,
    "22:00",
    40
  );

  insertTask.run(
    "Нарезка #03",
    "Создай и опубликуй 3 TikTok-ролика по материалам проекта.",
    3,
    "22:00",
    40
  );
}

// ==================================================
// HELPERS
// ==================================================

function today() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function nowTime() {
  const now = new Date();

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function getUserById(id) {
  return db
    .prepare(`
      SELECT
        id,
        name,
        nickname,
        email,
        role,
        avatar,
        about,
        xp,
        level,
        penalties,
        status,
        created_at
      FROM users
      WHERE id = ?
    `)
    .get(id);
}

function getUserByLogin(value) {
  return db
    .prepare(`
      SELECT *
      FROM users
      WHERE LOWER(email) = LOWER(?)
         OR LOWER(nickname) = LOWER(?)
    `)
    .get(value, value);
}

function calculateLevel(xp) {
  if (xp >= 2000) return "Legend";
  if (xp >= 1200) return "Master";
  if (xp >= 700) return "Elite";
  if (xp >= 350) return "Pro";
  if (xp >= 150) return "Creator";
  return "Rookie";
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function cleanText(value, maxLength = 5000) {
  return String(value || "").trim().slice(0, maxLength);
}

function validUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function isPastDeadline(deadline) {
  return nowTime() > deadline;
}

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        ok: false,
        error: "Требуется авторизация"
      });
    }

    const token = header.slice(7);

    const payload = jwt.verify(token, JWT_SECRET);

    const user = getUserById(payload.id);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({
        ok: false,
        error: "Аккаунт заблокирован"
      });
    }

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: "Недействительный или просроченный токен"
    });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      ok: false,
      error: "Доступ только для администратора"
    });
  }

  next();
}

function reportWithDetails(reportId) {
  return db
    .prepare(`
      SELECT
        reports.*,
        users.name AS user_name,
        users.nickname AS user_nickname,
        users.email AS user_email,
        tasks.title AS task_title,
        tasks.deadline AS task_deadline
      FROM reports
      LEFT JOIN users ON users.id = reports.user_id
      LEFT JOIN tasks ON tasks.id = reports.task_id
      WHERE reports.id = ?
    `)
    .get(reportId);
}

// ==================================================
// BASIC
// ==================================================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ANARHY TikTok OS",
    version: "2.0.0",
    status: "online"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    service: "ANARHY TikTok OS",
    version: "2.0.0",
    time: new Date().toISOString()
  });
});

// ==================================================
// AUTH
// ==================================================

app.post("/api/register", (req, res) => {
  try {
    const name = cleanText(req.body.name, 100);
    const nickname = cleanText(req.body.nickname, 50)
      .replace(/^@/, "")
      .toLowerCase();

    const email = cleanText(req.body.email, 150).toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !nickname || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Заполни все поля"
      });
    }

    if (name.length < 2) {
      return res.status(400).json({
        ok: false,
        error: "Имя слишком короткое"
      });
    }

    if (nickname.length < 3) {
      return res.status(400).json({
        ok: false,
        error: "Nickname должен быть минимум 3 символа"
      });
    }

    if (!email.includes("@")) {
      return res.status(400).json({
        ok: false,
        error: "Укажи корректный email"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Пароль должен быть минимум 6 символов"
      });
    }

    const duplicate = db
      .prepare(`
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER(?)
           OR LOWER(nickname) = LOWER(?)
      `)
      .get(email, nickname);

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "Email или nickname уже занят"
      });
    }

    const passwordHash = bcrypt.hashSync(password, 12);

    const result = db
      .prepare(`
        INSERT INTO users
          (name, nickname, email, password, role, status)
        VALUES
          (?, ?, ?, ?, 'user', 'active')
      `)
      .run(
        name,
        nickname,
        email,
        passwordHash
      );

    const user = getUserById(result.lastInsertRowid);

    res.status(201).json({
      ok: true,
      token: createToken(user),
      user
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось создать аккаунт"
    });
  }
});

app.post("/api/login", (req, res) => {
  try {
    const value = cleanText(
      req.body.email || req.body.nickname || req.body.login,
      150
    );

    const password = String(req.body.password || "");

    if (!value || !password) {
      return res.status(400).json({
        ok: false,
        error: "Введи логин и пароль"
      });
    }

    const user = getUserByLogin(value);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Неверный логин или пароль"
      });
    }

    const passwordCorrect = bcrypt.compareSync(
      password,
      user.password
    );

    if (!passwordCorrect) {
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

    res.json({
      ok: true,
      token: createToken(user),
      user: getUserById(user.id)
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Ошибка входа"
    });
  }
});

// ==================================================
// CURRENT USER
// ==================================================

app.get("/api/me", authRequired, (req, res) => {
  res.json({
    ok: true,
    user: getUserById(req.user.id)
  });
});

// ==================================================
// PROFILE
// ==================================================

app.get("/api/profile", authRequired, (req, res) => {
  res.json({
    ok: true,
    user: getUserById(req.user.id)
  });
});

app.put("/api/profile", authRequired, (req, res) => {
  try {
    const name = cleanText(req.body.name, 100);
    const nickname = cleanText(req.body.nickname, 50)
      .replace(/^@/, "")
      .toLowerCase();

    const email = cleanText(req.body.email, 150).toLowerCase();
    const avatar = cleanText(req.body.avatar, 1000);
    const about = cleanText(req.body.about, 2000);

    if (!name || !nickname || !email) {
      return res.status(400).json({
        ok: false,
        error: "Имя, nickname и email обязательны"
      });
    }

    const duplicate = db
      .prepare(`
        SELECT id
        FROM users
        WHERE id != ?
          AND (
            LOWER(email) = LOWER(?)
            OR LOWER(nickname) = LOWER(?)
          )
      `)
      .get(
        req.user.id,
        email,
        nickname
      );

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "Email или nickname уже используется"
      });
    }

    db.prepare(`
      UPDATE users
      SET
        name = ?,
        nickname = ?,
        email = ?,
        avatar = ?,
        about = ?
      WHERE id = ?
    `).run(
      name,
      nickname,
      email,
      avatar,
      about,
      req.user.id
    );

    res.json({
      ok: true,
      user: getUserById(req.user.id)
    });
  } catch (error) {
    console.error("PROFILE UPDATE ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось сохранить профиль"
    });
  }
});

app.post("/api/profile", authRequired, (req, res) => {
  req.method = "PUT";
  return res.status(405).json({
    ok: false,
    error: "Используй PUT /api/profile"
  });
});

// ==================================================
// TASKS
// ==================================================

app.get("/api/tasks", authRequired, (req, res) => {
  const tasks = db
    .prepare(`
      SELECT *
      FROM tasks
      WHERE active = 1
      ORDER BY id ASC
    `)
    .all();

  res.json({
    ok: true,
    tasks
  });
});

app.get("/api/tasks/:id", authRequired, (req, res) => {
  const task = db
    .prepare(`
      SELECT *
      FROM tasks
      WHERE id = ?
    `)
    .get(req.params.id);

  if (!task) {
    return res.status(404).json({
      ok: false,
      error: "Задание не найдено"
    });
  }

  res.json({
    ok: true,
    task
  });
});

// ==================================================
// REPORTS
// ==================================================

app.get("/api/reports", authRequired, (req, res) => {
  const reports = db
    .prepare(`
      SELECT
        reports.*,
        tasks.title AS task_title,
        tasks.deadline AS task_deadline
      FROM reports
      LEFT JOIN tasks ON tasks.id = reports.task_id
      WHERE reports.user_id = ?
      ORDER BY reports.created_at DESC
    `)
    .all(req.user.id);

  res.json({
    ok: true,
    reports
  });
});

app.post("/api/reports", authRequired, (req, res) => {
  try {
    const taskId = Number(req.body.taskId);
    const videoUrl = cleanText(req.body.videoUrl, 2000);
    const text = cleanText(req.body.text, 3000);

    if (!taskId || !videoUrl) {
      return res.status(400).json({
        ok: false,
        error: "Укажи задание и ссылку на ролик"
      });
    }

    if (!validUrl(videoUrl)) {
      return res.status(400).json({
        ok: false,
        error: "Укажи корректную ссылку"
      });
    }

    const task = db
      .prepare(`
        SELECT *
        FROM tasks
        WHERE id = ?
          AND active = 1
      `)
      .get(taskId);

    if (!task) {
      return res.status(404).json({
        ok: false,
        error: "Активное задание не найдено"
      });
    }

    const existingReport = db
      .prepare(`
        SELECT id
        FROM reports
        WHERE user_id = ?
          AND task_id = ?
          AND report_date = ?
          AND status != 'rejected'
      `)
      .get(
        req.user.id,
        taskId,
        today()
      );

    if (existingReport) {
      return res.status(409).json({
        ok: false,
        error: "Ты уже отправлял отчёт по этому заданию сегодня"
      });
    }

    const result = db
      .prepare(`
        INSERT INTO reports
          (
            user_id,
            task_id,
            video_url,
            text,
            status,
            xp_reward,
            report_date,
            xp_awarded
          )
        VALUES
          (?, ?, ?, ?, 'pending', ?, ?, 0)
      `)
      .run(
        req.user.id,
        taskId,
        videoUrl,
        text,
        task.xp_reward,
        today()
      );

    res.status(201).json({
      ok: true,
      message: "Отчёт отправлен на проверку",
      report: reportWithDetails(result.lastInsertRowid)
    });
  } catch (error) {
    console.error("REPORT CREATE ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось отправить отчёт"
    });
  }
});

app.get("/api/reports/:id", authRequired, (req, res) => {
  const report = reportWithDetails(req.params.id);

  if (!report) {
    return res.status(404).json({
      ok: false,
      error: "Отчёт не найден"
    });
  }

  if (
    report.user_id !== req.user.id &&
    req.user.role !== "admin"
  ) {
    return res.status(403).json({
      ok: false,
      error: "Нет доступа к этому отчёту"
    });
  }

  res.json({
    ok: true,
    report
  });
});

// ==================================================
// PROGRESS
// ==================================================

app.get("/api/progress", authRequired, (req, res) => {
  const totalReports = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
    `)
    .get(req.user.id).count;

  const approvedReports = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
        AND status = 'approved'
    `)
    .get(req.user.id).count;

  const todayReports = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
        AND report_date = ?
        AND status != 'rejected'
    `)
    .get(
      req.user.id,
      today()
    ).count;

  const pendingReports = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
        AND status = 'pending'
    `)
    .get(req.user.id).count;

  const rejectedReports = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
        AND status = 'rejected'
    `)
    .get(req.user.id).count;

  res.json({
    ok: true,
    progress: {
      totalReports,
      approvedReports,
      todayReports,
      pendingReports,
      rejectedReports,
      targetPerDay: 3,
      deadline: "22:00"
    }
  });
});

// ==================================================
// RATING
// ==================================================

app.get("/api/rating", authRequired, (req, res) => {
  const rating = db
    .prepare(`
      SELECT
        id,
        name,
        nickname,
        avatar,
        xp,
        level,
        penalties,
        status
      FROM users
      WHERE role = 'user'
        AND status = 'active'
      ORDER BY xp DESC, id ASC
    `)
    .all();

  res.json({
    ok: true,
    rating
  });
});

// ==================================================
// USER PENALTIES
// ==================================================

app.get("/api/my-penalties", authRequired, (req, res) => {
  const penalties = db
    .prepare(`
      SELECT *
      FROM penalties
      WHERE user_id = ?
      ORDER BY created_at DESC
    `)
    .all(req.user.id);

  res.json({
    ok: true,
    penalties,
    total: penalties.length,
    currentPenalties: req.user.penalties
  });
});

// ==================================================
// ADMIN OVERVIEW
// ==================================================

app.get(
  "/api/admin/overview",
  authRequired,
  adminRequired,
  (req, res) => {
    const users = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'user'
      `)
      .get().count;

    const activeUsers = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'user'
          AND status = 'active'
      `)
      .get().count;

    const reports = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM reports
      `)
      .get().count;

    const pendingReports = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM reports
        WHERE status = 'pending'
      `)
      .get().count;

    const approvedReports = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM reports
        WHERE status = 'approved'
      `)
      .get().count;

    const rejectedReports = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM reports
        WHERE status = 'rejected'
      `)
      .get().count;

    const penalties = db
      .prepare(`
        SELECT COUNT(*) AS count
        FROM penalties
      `)
      .get().count;

    res.json({
      ok: true,
      overview: {
        users,
        activeUsers,
        reports,
        pendingReports,
        approvedReports,
        rejectedReports,
        penalties
      }
    });
  }
);

// ==================================================
// ADMIN USERS
// ==================================================

app.get(
  "/api/admin/users",
  authRequired,
  adminRequired,
  (req, res) => {
    const users = db
      .prepare(`
        SELECT
          id,
          name,
          nickname,
          email,
          role,
          avatar,
          about,
          xp,
          level,
          penalties,
          status,
          created_at
        FROM users
        ORDER BY created_at DESC
      `)
      .all();

    res.json({
      ok: true,
      users
    });
  }
);

app.get(
  "/api/admin/users/:id",
  authRequired,
  adminRequired,
  (req, res) => {
    const user = getUserById(req.params.id);

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    const reports = db
      .prepare(`
        SELECT
          reports.*,
          tasks.title AS task_title
        FROM reports
        LEFT JOIN tasks ON tasks.id = reports.task_id
        WHERE reports.user_id = ?
        ORDER BY reports.created_at DESC
      `)
      .all(req.params.id);

    const penalties = db
      .prepare(`
        SELECT *
        FROM penalties
        WHERE user_id = ?
        ORDER BY created_at DESC
      `)
      .all(req.params.id);

    res.json({
      ok: true,
      user,
      reports,
      penalties
    });
  }
);

// ==================================================
// ADMIN USER STATUS
// ==================================================

app.patch(
  "/api/admin/users/:id/status",
  authRequired,
  adminRequired,
  (req, res) => {
    const userId = Number(req.params.id);
    const status = cleanText(req.body.status, 30);

    if (!["active", "blocked", "paused"].includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Недопустимый статус"
      });
    }

    const user = getUserById(userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    db.prepare(`
      UPDATE users
      SET status = ?
      WHERE id = ?
    `).run(status, userId);

    res.json({
      ok: true,
      message: "Статус пользователя обновлён",
      user: getUserById(userId)
    });
  }
);

// ==================================================
// ADMIN REPORTS
// ==================================================

app.get(
  "/api/admin/reports",
  authRequired,
  adminRequired,
  (req, res) => {
    const reports = db
      .prepare(`
        SELECT
          reports.*,
          users.name AS user_name,
          users.nickname AS user_nickname,
          users.email AS user_email,
          tasks.title AS task_title,
          tasks.deadline AS task_deadline
        FROM reports
        LEFT JOIN users ON users.id = reports.user_id
        LEFT JOIN tasks ON tasks.id = reports.task_id
        ORDER BY
          CASE
            WHEN reports.status = 'pending' THEN 0
            ELSE 1
          END,
          reports.created_at DESC
      `)
      .all();

    res.json({
      ok: true,
      reports
    });
  }
);

app.patch(
  "/api/admin/reports/:id",
  authRequired,
  adminRequired,
  (req, res) => {
    try {
      const reportId = Number(req.params.id);
      const status = cleanText(req.body.status, 30);

      if (!["pending", "approved", "rejected"].includes(status)) {
        return res.status(400).json({
          ok: false,
          error: "Недопустимый статус отчёта"
        });
      }

      const report = db
        .prepare(`
          SELECT *
          FROM reports
          WHERE id = ?
        `)
        .get(reportId);

      if (!report) {
        return res.status(404).json({
          ok: false,
          error: "Отчёт не найден"
        });
      }

      const updateReport = db.transaction(() => {
        if (
          status === "approved" &&
          report.status !== "approved" &&
          report.xp_awarded === 0
        ) {
          const user = db
            .prepare(`
              SELECT xp
              FROM users
              WHERE id = ?
            `)
            .get(report.user_id);

          const newXp = user.xp + report.xp_reward;
          const newLevel = calculateLevel(newXp);

          db.prepare(`
            UPDATE users
            SET
              xp = ?,
              level = ?
            WHERE id = ?
          `).run(
            newXp,
            newLevel,
            report.user_id
          );

          db.prepare(`
            UPDATE reports
            SET
              status = 'approved',
              xp_awarded = 1
            WHERE id = ?
          `).run(reportId);
        } else {
          db.prepare(`
            UPDATE reports
            SET status = ?
            WHERE id = ?
          `).run(
            status,
            reportId
          );
        }
      });

      updateReport();

      res.json({
        ok: true,
        message: "Статус отчёта обновлён",
        report: reportWithDetails(reportId),
        user: getUserById(report.user_id)
      });
    } catch (error) {
      console.error("REPORT STATUS ERROR:", error);

      res.status(500).json({
        ok: false,
        error: "Не удалось обновить отчёт"
      });
    }
  }
);

// ==================================================
// ADMIN PENALTIES
// ==================================================

app.get(
  "/api/admin/penalties",
  authRequired,
  adminRequired,
  (req, res) => {
    const penalties = db
      .prepare(`
        SELECT
          penalties.*,
          users.name,
          users.nickname,
          users.email
        FROM penalties
        LEFT JOIN users ON users.id = penalties.user_id
        ORDER BY penalties.created_at DESC
      `)
      .all();

    res.json({
      ok: true,
      penalties
    });
  }
);

app.post(
  "/api/admin/penalties",
  authRequired,
  adminRequired,
  (req, res) => {
    try {
      const userId = Number(req.body.userId);
      const reason = cleanText(req.body.reason, 1000);

      if (!userId || !reason) {
        return res.status(400).json({
          ok: false,
          error: "Укажи пользователя и причину штрафа"
        });
      }

      const user = getUserById(userId);

      if (!user) {
        return res.status(404).json({
          ok: false,
          error: "Пользователь не найден"
        });
      }

      if (user.role === "admin") {
        return res.status(400).json({
          ok: false,
          error: "Администратору нельзя выдавать штраф"
        });
      }

      const result = db.transaction(() => {
        db.prepare(`
          INSERT INTO penalties
            (user_id, reason)
          VALUES
            (?, ?)
        `).run(
          userId,
          reason
        );

        const nextPenalties = user.penalties + 1;

        if (nextPenalties >= 3) {
          db.prepare(`
            UPDATE users
            SET
              penalties = 0,
              xp = 0,
              level = 'Rookie'
            WHERE id = ?
          `).run(userId);

          return {
            reset: true,
            penalties: 0
          };
        }

        db.prepare(`
          UPDATE users
          SET penalties = ?
          WHERE id = ?
        `).run(
          nextPenalties,
          userId
        );

        return {
          reset: false,
          penalties: nextPenalties
        };
      })();

      res.json({
        ok: true,
        message: result.reset
          ? "3 штрафа — выполнен полный reset XP и уровня"
          : "Штраф добавлен",
        reset: result.reset,
        penalties: result.penalties,
        user: getUserById(userId)
      });
    } catch (error) {
      console.error("PENALTY ERROR:", error);

      res.status(500).json({
        ok: false,
        error: "Не удалось добавить штраф"
      });
    }
  }
);

// ==================================================
// ADMIN RESET USER
// ==================================================

app.post(
  "/api/admin/users/:id/reset",
  authRequired,
  adminRequired,
  (req, res) => {
    const userId = Number(req.params.id);

    const user = getUserById(userId);

    if (!user) {
      return res.status(404).json({
        ok: false,
        error: "Пользователь не найден"
      });
    }

    db.prepare(`
      UPDATE users
      SET
        xp = 0,
        level = 'Rookie',
        penalties = 0
      WHERE id = ?
    `).run(userId);

    res.json({
      ok: true,
      message: "Пользователь сброшен",
      user: getUserById(userId)
    });
  }
);

// ==================================================
// ADMIN TASKS
// ==================================================

app.post(
  "/api/admin/tasks",
  authRequired,
  adminRequired,
  (req, res) => {
    const title = cleanText(req.body.title, 200);
    const description = cleanText(req.body.description, 2000);
    const videosRequired = Number(req.body.videosRequired || 3);
    const deadline = cleanText(req.body.deadline || "22:00", 10);
    const xpReward = Number(req.body.xpReward || 40);

    if (!title) {
      return res.status(400).json({
        ok: false,
        error: "Название задания обязательно"
      });
    }

    const result = db.prepare(`
      INSERT INTO tasks
        (
          title,
          description,
          videos_required,
          deadline,
          xp_reward,
          active
        )
      VALUES
        (?, ?, ?, ?, ?, 1)
    `).run(
      title,
      description,
      videosRequired,
      deadline,
      xpReward
    );

    res.status(201).json({
      ok: true,
      task: db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(result.lastInsertRowid)
    });
  }
);

app.patch(
  "/api/admin/tasks/:id",
  authRequired,
  adminRequired,
  (req, res) => {
    const taskId = Number(req.params.id);

    const task = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId);

    if (!task) {
      return res.status(404).json({
        ok: false,
        error: "Задание не найдено"
      });
    }

    const title =
      req.body.title !== undefined
        ? cleanText(req.body.title, 200)
        : task.title;

    const description =
      req.body.description !== undefined
        ? cleanText(req.body.description, 2000)
        : task.description;

    const videosRequired =
      req.body.videosRequired !== undefined
        ? Number(req.body.videosRequired)
        : task.videos_required;

    const deadline =
      req.body.deadline !== undefined
        ? cleanText(req.body.deadline, 10)
        : task.deadline;

    const xpReward =
      req.body.xpReward !== undefined
        ? Number(req.body.xpReward)
        : task.xp_reward;

    const active =
      req.body.active !== undefined
        ? Number(Boolean(req.body.active))
        : task.active;

    db.prepare(`
      UPDATE tasks
      SET
        title = ?,
        description = ?,
        videos_required = ?,
        deadline = ?,
        xp_reward = ?,
        active = ?
      WHERE id = ?
    `).run(
      title,
      description,
      videosRequired,
      deadline,
      xpReward,
      active,
      taskId
    );

    res.json({
      ok: true,
      task: db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(taskId)
    });
  }
);

// ==================================================
// ADMIN DEADLINES / OVERDUE
// ==================================================

app.get(
  "/api/admin/deadlines",
  authRequired,
  adminRequired,
  (req, res) => {
    const currentDate = today();

    const users = db
      .prepare(`
        SELECT
          users.id,
          users.name,
          users.nickname,
          users.email,
          users.penalties,
          tasks.id AS task_id,
          tasks.title AS task_title,
          tasks.deadline,
          COUNT(reports.id) AS reports_today
        FROM users
        CROSS JOIN tasks
        LEFT JOIN reports
          ON reports.user_id = users.id
          AND reports.task_id = tasks.id
          AND reports.report_date = ?
          AND reports.status != 'rejected'
        WHERE users.role = 'user'
          AND users.status = 'active'
          AND tasks.active = 1
        GROUP BY
          users.id,
          tasks.id
        ORDER BY users.id ASC, tasks.id ASC
      `)
      .all(currentDate);

    const overdue = users.filter((item) => {
      return (
        isPastDeadline(item.deadline) &&
        Number(item.reports_today) === 0
      );
    });

    res.json({
      ok: true,
      date: currentDate,
      time: nowTime(),
      all: users,
      overdue
    });
  }
);

// ==================================================
// ERROR HANDLERS
// ==================================================

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Маршрут не найден"
  });
});

app.use((error, req, res, next) => {
  console.error("GLOBAL ERROR:", error);

  res.status(500).json({
    ok: false,
    error: "Внутренняя ошибка сервера"
  });
});

// ==================================================
// START
// ==================================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("======================================");
  console.log("ANARHY TikTok OS backend started");
  console.log("Port:", PORT);
  console.log("Version: 2.0.0");
  console.log("Database:", DB_FILE);
  console.log("======================================");
});
