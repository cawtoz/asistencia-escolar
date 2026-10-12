const crypto = require("node:crypto");
const { HttpError } = require("./errors");

function createAttendance(db, timeZone) {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function nowParts() {
    const parts = dateFormatter.formatToParts(new Date());
    const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      time: `${p.hour}:${p.minute}:${p.second}`,
    };
  }

  function latestSession() {
    return (
      db
        .prepare(
          "SELECT id, code, date, open, started_at AS startedAt, late_minutes AS lateMinutes FROM sessions ORDER BY id DESC LIMIT 1",
        )
        .get() || null
    );
  }

  function teacherState() {
    const session = latestSession();
    const rows = session
      ? db
          .prepare(
            "SELECT student_id AS studentId, name, time, late FROM attendance WHERE session_id = ? ORDER BY id",
          )
          .all(session.id)
      : [];
    const students = db
      .prepare(
        "SELECT identifier, name FROM users WHERE role = 'student' ORDER BY name",
      )
      .all();
    return { session, rows, students };
  }

  function studentStatus(student) {
    const session = latestSession();
    if (!session || session.date !== nowParts().date) {
      return { registered: false };
    }
    const record = db
      .prepare(
        "SELECT time, late FROM attendance WHERE session_id = ? AND student_id = ?",
      )
      .get(session.id, student.identifier);
    return record
      ? { registered: true, time: record.time, late: record.late }
      : { registered: false };
  }

  function startClass(lateMinutesInput = 10) {
    const lateMinutes = Number(lateMinutesInput);
    if (
      !Number.isInteger(lateMinutes) ||
      lateMinutes < 0 ||
      lateMinutes > 120
    ) {
      throw new HttpError(400, "El margen debe ser de 0 a 120 minutos.");
    }
    db.prepare("UPDATE sessions SET open = 0 WHERE open = 1").run();
    db.prepare(
      "INSERT INTO sessions (code, date, open, started_at, late_minutes) VALUES (?, ?, 1, ?, ?)",
    ).run(
      String(crypto.randomInt(100000, 1000000)),
      nowParts().date,
      Date.now(),
      lateMinutes,
    );
    return teacherState();
  }

  function closeClass() {
    const session = latestSession();
    if (session)
      db.prepare("UPDATE sessions SET open = 0 WHERE id = ?").run(session.id);
    return teacherState();
  }

  function register(student, codeInput) {
    const code = String(codeInput || "").trim();
    if (!/^\d{6}$/.test(code))
      throw new HttpError(400, "Escribe el código de 6 números.");
    const current = nowParts();
    const session = latestSession();
    if (
      !session ||
      !session.open ||
      session.date !== current.date ||
      session.code !== code
    ) {
      throw new HttpError(
        400,
        "El código no está activo. Pide al profesor el código actual.",
      );
    }
    const late =
      session.startedAt == null
        ? null
        : Number(Date.now() > session.startedAt + session.lateMinutes * 60_000);
    try {
      db.prepare(
        "INSERT INTO attendance (session_id, student_id, name, time, late) VALUES (?, ?, ?, ?, ?)",
      ).run(session.id, student.identifier, student.name, current.time, late);
    } catch (error) {
      if (error.message.includes("UNIQUE")) {
        throw new HttpError(409, "Ya registraste asistencia en esta clase.");
      }
      throw error;
    }
    return { name: student.name, time: current.time, late };
  }

  return { teacherState, studentStatus, startClass, closeClass, register };
}

module.exports = { createAttendance };
