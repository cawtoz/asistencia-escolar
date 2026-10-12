const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("./errors");

const cookieName = "asistencia_session";
const sessionDuration = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 100
  );
}

function verifyPassword(password, stored) {
  const [salt, expectedHex] = stored.split(":");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function createAuth(db, dataDir) {
  const loginAttempts = new Map();

  function setupTeacher() {
    const identifier = process.env.TEACHER_ID || "profesor";
    const configuredPassword = process.env.TEACHER_PASSWORD;
    if (configuredPassword && !validPassword(configuredPassword)) {
      throw new Error("TEACHER_PASSWORD debe tener entre 8 y 100 caracteres.");
    }

    const existing = db
      .prepare(
        "SELECT id, identifier, password_hash FROM users WHERE role = 'teacher' LIMIT 1",
      )
      .get();
    if (existing) {
      const changed =
        configuredPassword &&
        (existing.identifier !== identifier ||
          !verifyPassword(configuredPassword, existing.password_hash));
      if (changed) {
        db.prepare(
          "UPDATE users SET identifier = ?, password_hash = ? WHERE id = ?",
        ).run(identifier, hashPassword(configuredPassword), existing.id);
        db.prepare("DELETE FROM login_sessions WHERE user_id = ?").run(
          existing.id,
        );
      }
      return;
    }

    const generatedPassword = crypto.randomBytes(9).toString("base64url");
    const password = configuredPassword || generatedPassword;
    db.prepare(
      "INSERT INTO users (identifier, name, role, password_hash) VALUES (?, ?, 'teacher', ?)",
    ).run(identifier, "Profesor", hashPassword(password));
    if (!configuredPassword) {
      const credentialsFile = path.join(dataDir, "profesor-credenciales.txt");
      fs.writeFileSync(
        credentialsFile,
        `Usuario: ${identifier}\nContraseña: ${password}\n`,
        { mode: 0o600 },
      );
      console.log(`Credenciales iniciales del profesor en ${credentialsFile}`);
    }
  }

  function requestToken(req) {
    const cookie = (req.headers.cookie || "")
      .split("; ")
      .find((item) => item.startsWith(`${cookieName}=`));
    return cookie ? cookie.slice(cookieName.length + 1) : null;
  }

  function tokenHash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function cookieHeader(req, token, maxAge) {
    const secure =
      req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
    return `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  function sessionUser(req) {
    const token = requestToken(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    return (
      db
        .prepare(
          `
      SELECT users.id, users.identifier, users.name, users.role
      FROM login_sessions JOIN users ON users.id = login_sessions.user_id
      WHERE login_sessions.token_hash = ? AND login_sessions.expires_at > ?
    `,
        )
        .get(tokenHash(token), Date.now()) || null
    );
  }

  function requireRole(req, role) {
    const user = sessionUser(req);
    if (!user || user.role !== role) {
      throw new HttpError(
        401,
        `Inicia sesión con una cuenta de ${role === "teacher" ? "profesor" : "estudiante"}.`,
      );
    }
    return user;
  }

  function login(req, res, body) {
    const identifier = String(body.identifier || "").trim();
    const password = String(body.password || "");
    const attemptKey = `${req.socket.remoteAddress}:${identifier}`;
    const attempt = loginAttempts.get(attemptKey);
    if (
      attempt &&
      attempt.count >= 10 &&
      Date.now() - attempt.first < 15 * 60 * 1000
    ) {
      throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
    }

    const user = db
      .prepare("SELECT * FROM users WHERE identifier = ?")
      .get(identifier);
    if (
      !user ||
      password.length > 100 ||
      !verifyPassword(password, user.password_hash)
    ) {
      const recent = attempt && Date.now() - attempt.first < 15 * 60 * 1000;
      loginAttempts.set(attemptKey, {
        first: recent ? attempt.first : Date.now(),
        count: recent ? attempt.count + 1 : 1,
      });
      throw new HttpError(401, "Identificación o contraseña incorrecta.");
    }

    loginAttempts.delete(attemptKey);
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare(
      "INSERT INTO login_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
    ).run(tokenHash(token), user.id, Date.now() + sessionDuration);
    res.setHeader(
      "Set-Cookie",
      cookieHeader(req, token, Math.floor(sessionDuration / 1000)),
    );
    return {
      user: { identifier: user.identifier, name: user.name, role: user.role },
    };
  }

  function logout(req, res) {
    const token = requestToken(req);
    if (token)
      db.prepare("DELETE FROM login_sessions WHERE token_hash = ?").run(
        tokenHash(token),
      );
    res.setHeader("Set-Cookie", cookieHeader(req, "", 0));
    return { ok: true };
  }

  function findStudent(identifier) {
    const student = db
      .prepare("SELECT id FROM users WHERE identifier = ? AND role = 'student'")
      .get(identifier);
    if (!student) throw new HttpError(404, "No se encontró al estudiante.");
    return student;
  }

  function saveStudent(body) {
    const originalIdentifier = String(body.originalIdentifier || "").trim();
    const identifier = String(body.identifier || "").trim();
    const name = String(body.name || "")
      .trim()
      .replace(/\s+/g, " ");
    if (!/^\d{5,20}$/.test(identifier)) {
      throw new HttpError(
        400,
        "La identificación debe tener entre 5 y 20 números.",
      );
    }
    if (name.length < 2 || name.length > 80)
      throw new HttpError(400, "Escribe el nombre completo.");
    const duplicate = db
      .prepare("SELECT id FROM users WHERE identifier = ?")
      .get(identifier);

    if (originalIdentifier) {
      const student = findStudent(originalIdentifier);
      if (duplicate && duplicate.id !== student.id) {
        throw new HttpError(
          409,
          "Esa tarjeta de identidad ya está registrada.",
        );
      }
      db.prepare("UPDATE users SET identifier = ?, name = ? WHERE id = ?").run(
        identifier,
        name,
        student.id,
      );
      if (identifier !== originalIdentifier) {
        db.prepare("DELETE FROM login_sessions WHERE user_id = ?").run(
          student.id,
        );
      }
      return { created: false };
    }

    if (duplicate)
      throw new HttpError(409, "Ese estudiante ya existe. Usa Editar.");
    if (!validPassword(body.password)) {
      throw new HttpError(
        400,
        "La contraseña debe tener entre 8 y 100 caracteres.",
      );
    }
    db.prepare(
      "INSERT INTO users (identifier, name, role, password_hash) VALUES (?, ?, 'student', ?)",
    ).run(identifier, name, hashPassword(body.password));
    return { created: true };
  }

  function resetStudentPassword(identifierInput, passwordInput) {
    const identifier = String(identifierInput || "").trim();
    const student = findStudent(identifier);
    if (passwordInput != null && typeof passwordInput !== "string") {
      throw new HttpError(400, "La contraseña no es válida.");
    }
    const customPassword = passwordInput || "";
    if (customPassword && !validPassword(customPassword)) {
      throw new HttpError(
        400,
        "La contraseña debe tener entre 8 y 100 caracteres.",
      );
    }
    const temporaryPassword =
      customPassword || crypto.randomBytes(9).toString("base64url");
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(temporaryPassword),
      student.id,
    );
    db.prepare("DELETE FROM login_sessions WHERE user_id = ?").run(student.id);
    return { identifier, temporaryPassword };
  }

  function deleteStudent(identifierInput) {
    const identifier = String(identifierInput || "").trim();
    const result = db
      .prepare("DELETE FROM users WHERE identifier = ? AND role = 'student'")
      .run(identifier);
    if (!result.changes)
      throw new HttpError(404, "No se encontró al estudiante.");
  }

  setupTeacher();
  return {
    sessionUser,
    requireRole,
    login,
    logout,
    saveStudent,
    resetStudentPassword,
    deleteStudent,
  };
}

module.exports = { createAuth };
