const { HttpError } = require("./errors");

function createApi(auth, attendance) {
  return function handleAction(req, res, body) {
    switch (body.action) {
      case "me":
        return { user: auth.sessionUser(req) };
      case "login":
        return auth.login(req, res, body);
      case "logout":
        return auth.logout(req, res);
      case "register":
        return attendance.register(auth.requireRole(req, "student"), body.code);
      case "studentStatus":
        return attendance.studentStatus(auth.requireRole(req, "student"));
      default:
        auth.requireRole(req, "teacher");
    }

    switch (body.action) {
      case "state":
        return attendance.teacherState();
      case "start":
        return attendance.startClass(body.lateMinutes);
      case "close":
        return attendance.closeClass();
      case "saveStudent":
        return { ...auth.saveStudent(body), state: attendance.teacherState() };
      case "resetStudentPassword":
        return auth.resetStudentPassword(body.identifier, body.password);
      case "deleteStudent":
        auth.deleteStudent(body.identifier);
        return attendance.teacherState();
      default:
        throw new HttpError(400, "Acción desconocida.");
    }
  };
}

module.exports = { createApi };
