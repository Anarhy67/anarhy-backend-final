const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");

const app = express();

const PORT = process.env.PORT || 10000;
const JWT_SECRET =
  process.env.JWT_SECRET || "anarhy-development-secret-change-later";

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://anarhytiktok9.netlify.app";

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));

// --------------------------------------------------
// DATABASE
// --------------------------------------------------

const db = new Database("anarhy.sqlite");

db.pragma("journal_mode = WAL");

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
    xp_reward INTEGER NOT NULL DEFAULT 120,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    task_id INTEGER,
    video_url TEXT DEFAULT '',
    text TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    xp_reward INTEGER NOT NULL DEFAULT 40,
    report_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );
`);

// --------------------------------------------------
// DEFAULT DATA
// --------------------------------------------------

const taskCount = db
  .prepare("SELECT COUNT(*) AS count FROM tasks")
  .get().count;

if (taskCount === 0) {
  db.prepare(`
    INSERT INTO tasks
    (title, description, videos_required, deadline, xp_reward, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "Нарезка #01",
    "Опубликуй TikTok-ролик и отправь ссылку на опубликованное видео.",
    3,
    "22:00",
    40,
    1
  );

  db.prepare(`
    INSERT INTO tasks
    (title, description, videos_required, deadline, xp_reward, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "Нарезка #02",
    "Подготовь второй ролик по заданию команды.",
    3,
    "22:00",
    40,
    1
  );

  db.prepare(`
    INSERT INTO tasks
    (title, description, videos_required, deadline, xp_reward, active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "Нарезка #03",
    "Подготовь третий ролик и отправь отчёт.",
    3,
    "22:00",
    40,
    1
  );
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      nickname: user.nickname,
      role: user.role
    },
    JWT_SECRET,
    {
      expiresIn: "30d"
    }
  );
}

function getUserById(id) {
  return db
    .prepare(
      `
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
    `
    )
    .get(id);
}

function calculateLevel(xp) {
  if (xp >= 2000) return "Legend";
  if (xp >= 1200) return "Pro";
  if (xp >= 600) return "Creator";
  return "Rookie";
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      ok: false,
      error: "Требуется авторизация"
    });
  }

  const token = header.slice(7);

  try {
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
      error: "Недействительный токен"
    });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      ok: false,
      error: "Требуются права администратора"
    });
  }

  next();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// --------------------------------------------------
// BASIC ROUTES
// --------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    service: "ANARHY TikTok OS",
    version: "1.0.0"
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "online",
    service: "ANARHY TikTok OS",
    version: "1.0.0"
  });
});

// --------------------------------------------------
// AUTH
// --------------------------------------------------

app.post("/api/register", async (req, res) => {
  try {
    const {
      name,
      nickname,
      email,
      password
    } = req.body;

    if (!name || !nickname || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Заполни имя, nickname, email и пароль"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        ok: false,
        error: "Пароль должен содержать минимум 6 символов"
      });
    }

    const normalizedNickname = String(nickname)
      .trim()
      .toLowerCase();

    const normalizedEmail = String(email)
      .trim()
      .toLowerCase();

    const existingUser = db
      .prepare(
        `
        SELECT id
        FROM users
        WHERE nickname = ? OR email = ?
      `
      )
      .get(normalizedNickname, normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        ok: false,
        error: "Такой nickname или email уже зарегистрирован"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = db
      .prepare(
        `
        INSERT INTO users
        (name, nickname, email, password)
        VALUES (?, ?, ?, ?)
      `
      )
      .run(
        String(name).trim(),
        normalizedNickname,
        normalizedEmail,
        passwordHash
      );

    const user = getUserById(result.lastInsertRowid);
    const token = createToken(user);

    return res.status(201).json({
      ok: true,
      token,
      user
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка регистрации"
    });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password, nickname } = req.body;

    const loginValue = String(email || nickname || "")
      .trim()
      .toLowerCase();

    if (!loginValue || !password) {
      return res.status(400).json({
        ok: false,
        error: "Введи email/nickname и пароль"
      });
    }

    const user = db
      .prepare(
        `
        SELECT *
        FROM users
        WHERE email = ? OR nickname = ?
      `
      )
      .get(loginValue, loginValue);

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: "Неверный логин или пароль"
      });
    }

    const passwordIsValid = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordIsValid) {
      return res.status(401).json({
        ok: false,
        error: "Неверный логин или пароль"
      });
    }

    const safeUser = getUserById(user.id);
    const token = createToken(safeUser);

    return res.json({
      ok: true,
      token,
      user: safeUser
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Ошибка входа"
    });
  }
});

app.get("/api/me", authRequired, (req, res) => {
  res.json({
    ok: true,
    user: getUserById(req.user.id)
  });
});

// --------------------------------------------------
// PROFILE
// --------------------------------------------------

app.get("/api/profile", authRequired, (req, res) => {
  res.json({
    ok: true,
    user: getUserById(req.user.id)
  });
});

app.put("/api/profile", authRequired, (req, res) => {
  try {
    const {
      name,
      nickname,
      email,
      avatar,
      about
    } = req.body;

    const currentUser = getUserById(req.user.id);

    const nextName =
      name !== undefined ? String(name).trim() : currentUser.name;

    const nextNickname =
      nickname !== undefined
        ? String(nickname).trim().toLowerCase()
        : currentUser.nickname;

    const nextEmail =
      email !== undefined
        ? String(email).trim().toLowerCase()
        : currentUser.email;

    const nextAvatar =
      avatar !== undefined ? String(avatar) : currentUser.avatar;

    const nextAbout =
      about !== undefined ? String(about) : currentUser.about;

    const duplicate = db
      .prepare(
        `
        SELECT id
        FROM users
        WHERE (nickname = ? OR email = ?)
        AND id != ?
      `
      )
      .get(nextNickname, nextEmail, req.user.id);

    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "Такой nickname или email уже занят"
      });
    }

    db.prepare(
      `
      UPDATE users
      SET name = ?,
          nickname = ?,
          email = ?,
          avatar = ?,
          about = ?
      WHERE id = ?
    `
    ).run(
      nextName,
      nextNickname,
      nextEmail,
      nextAvatar,
      nextAbout,
      req.user.id
    );

    res.json({
      ok: true,
      user: getUserById(req.user.id)
    });
  } catch (error) {
    console.error("PROFILE ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось обновить профиль"
    });
  }
});

app.post("/api/profile", authRequired, (req, res) => {
  req.url = "/api/profile";
  return app._router.handle(req, res);
});

// --------------------------------------------------
// TASKS
// --------------------------------------------------

app.get("/api/tasks", authRequired, (req, res) => {
  const tasks = db
    .prepare(
      `
      SELECT *
      FROM tasks
      WHERE active = 1
      ORDER BY id ASC
    `
    )
    .all();

  res.json({
    ok: true,
    tasks
  });
});

app.get("/api/tasks/:id", authRequired, (req, res) => {
  const task = db
    .prepare(
      `
      SELECT *
      FROM tasks
      WHERE id = ?
    `
    )
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

// --------------------------------------------------
// REPORTS
// --------------------------------------------------

app.get("/api/reports", authRequired, (req, res) => {
  const reports = db
    .prepare(
      `
      SELECT
        reports.*,
        tasks.title AS task_title
      FROM reports
      LEFT JOIN tasks ON tasks.id = reports.task_id
      WHERE reports.user_id = ?
      ORDER BY reports.created_at DESC
    `
    )
    .all(req.user.id);

  res.json({
    ok: true,
    reports
  });
});

app.post("/api/reports", authRequired, (req, res) => {
  try {
    const {
      taskId,
      task_id,
      videoUrl,
      video_url,
      text
    } = req.body;

    const selectedTaskId = taskId || task_id || null;
    const selectedVideoUrl = videoUrl || video_url || "";

    const task = selectedTaskId
      ? db
          .prepare("SELECT * FROM tasks WHERE id = ?")
          .get(selectedTaskId)
      : null;

    const xpReward = task ? task.xp_reward : 40;

    const result = db
      .prepare(
        `
        INSERT INTO reports
        (user_id, task_id, video_url, text, status, xp_reward, report_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(
        req.user.id,
        selectedTaskId,
        selectedVideoUrl,
        text || "",
        "pending",
        xpReward,
        today()
      );

    const report = db
      .prepare("SELECT * FROM reports WHERE id = ?")
      .get(result.lastInsertRowid);

    res.status(201).json({
      ok: true,
      report
    });
  } catch (error) {
    console.error("REPORT ERROR:", error);

    res.status(500).json({
      ok: false,
      error: "Не удалось создать отчёт"
    });
  }
});

app.get("/api/reports/:id", authRequired, (req, res) => {
  const report = db
    .prepare(
      `
      SELECT *
      FROM reports
      WHERE id = ? AND user_id = ?
    `
    )
    .get(req.params.id, req.user.id);

  if (!report) {
    return res.status(404).json({
      ok: false,
      error: "Отчёт не найден"
    });
  }

  res.json({
    ok: true,
    report
  });
});

// --------------------------------------------------
// PROGRESS
// --------------------------------------------------

app.get("/api/progress", authRequired, (req, res) => {
  const totalReports = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
    `
    )
    .get(req.user.id).count;

  const approvedReports = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
      AND status = 'approved'
    `
    )
    .get(req.user.id).count;

  const todayReports = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM reports
      WHERE user_id = ?
      AND report_date = ?
    `
    )
    .get(req.user.id, today()).count;

  res.json({
    ok: true,
    progress: {
      totalReports,
      approvedReports,
      todayReports,
      dailyTarget: 3,
      deadline: "22:00",
      testPeriodDays: 9
    }
  });
});

// --------------------------------------------------
// RATING
// --------------------------------------------------

app.get("/api/rating", authRequired, (req, res) => {
  const rating = db
    .prepare(
      `
      SELECT
        id,
        name,
        nickname,
        avatar,
        xp,
        level
      FROM users
      WHERE status = 'active'
      ORDER BY xp DESC, id ASC
      LIMIT 100
    `
    )
    .all();

  res.json({
    ok: true,
    rating
  });
});

// --------------------------------------------------
// ADMIN
// --------------------------------------------------

app.get(
  "/api/admin/users",
  authRequired,
  adminRequired,
  (req, res) => {
    const users = db
      .prepare(
        `
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
      `
      )
      .all();

    res.json({
      ok: true,
      users
    });
  }
);

app.get(
  "/api/admin/reports",
  authRequired,
  adminRequired,
  (req, res) => {
    const reports = db
      .prepare(
        `
        SELECT
          reports.*,
          users.name,
          users.nickname,
          tasks.title AS task_title
        FROM reports
        LEFT JOIN users ON users.id = reports.user_id
        LEFT JOIN tasks ON tasks.id = reports.task_id
        ORDER BY reports.created_at DESC
      `
      )
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
      const { status } = req.body;

      const allowedStatuses = [
        "pending",
        "approved",
        "rejected"
      ];

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          ok: false,
          error: "Недопустимый статус отчёта"
        });
      }

      const report = db
        .prepare("SELECT * FROM reports WHERE id = ?")
        .get(req.params.id);

      if (!report) {
        return res.status(404).json({
          ok: false,
          error: "Отчёт не найден"
        });
      }

      const updateReport = db.transaction(() => {
        db.prepare(
          `
          UPDATE reports
          SET status = ?
          WHERE id = ?
        `
        ).run(status, req.params.id);

        if (
          status === "approved" &&
          report.status !== "approved"
        ) {
          const user = getUserById(report.user_id);
          const newXp = user.xp + report.xp_reward;
          const newLevel = calculateLevel(newXp);

          db.prepare(
            `
            UPDATE users
            SET xp = ?,
                level = ?
            WHERE id = ?
          `
          ).run(newXp, newLevel, report.user_id);
        }
      });

      updateReport();

      const updatedReport = db
        .prepare("SELECT * FROM reports WHERE id = ?")
        .get(req.params.id);

      res.json({
        ok: true,
        report: updatedReport
      });
    } catch (error) {
      console.error("ADMIN REPORT ERROR:", error);

      res.status(500).json({
        ok: false,
        error: "Не удалось обновить отчёт"
      });
    }
  }
);

// --------------------------------------------------
// ERROR HANDLERS
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Маршрут не найден",
    path: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    ok: false,
    error: "Внутренняя ошибка сервера"
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `ANARHY backend running on port ${PORT}`
  );
});
