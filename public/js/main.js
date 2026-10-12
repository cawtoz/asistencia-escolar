import { api } from "./api.js";
import { $, formatTime, showMessage } from "./ui.js";
import { startTeacherPanel, stopTeacherPanel } from "./teacher.js";

let currentUser = null;

function showStudentRegistration(time, late) {
  $("studentEntry").hidden = true;
  $("studentSuccess").hidden = false;
  $("studentSuccessTitle").textContent =
    late == null
      ? "¡Todo listo!"
      : late
        ? "Llegaste tarde"
        : "Llegaste a tiempo";
  $("studentSuccessTime").hidden = !time;
  $("studentSuccessTime").textContent = time
    ? `Hora de registro: ${formatTime(time)}`
    : "";
}

async function loadStudentStatus(identifier) {
  try {
    const status = await api({ action: "studentStatus" });
    if (
      currentUser?.role !== "student" ||
      currentUser.identifier !== identifier
    )
      return;
    if (status.registered) showStudentRegistration(status.time, status.late);
    else $("studentEntry").hidden = false;
  } catch (error) {
    if (
      currentUser?.role !== "student" ||
      currentUser.identifier !== identifier
    )
      return;
    $("studentEntry").hidden = false;
    showMessage("studentMessage", error.message, true);
  }
}

function showView(user) {
  currentUser = user;
  document.body.className = user ? `view-${user.role}` : "view-login";
  $("loginView").hidden = Boolean(user);
  $("studentView").hidden = user?.role !== "student";
  $("teacherView").hidden = user?.role !== "teacher";
  if (user?.role === "teacher") {
    $("teacherAccountName").textContent = user.name;
    $("teacherAccountId").textContent = user.identifier;
  }

  $("studentEntry").hidden = true;
  $("studentSuccess").hidden = true;
  if (user?.role === "student") {
    $("studentName").textContent = user.name;
    $("studentMessage").hidden = true;
    loadStudentStatus(user.identifier);
  }
  if (user?.role === "teacher") startTeacherPanel();
  else stopTeacherPanel();
}

$("code").value = new URLSearchParams(location.search).get("codigo") || "";

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginButton").disabled = true;
  try {
    const result = await api({
      action: "login",
      identifier: $("identifier").value.trim(),
      password: $("password").value,
    });
    $("password").value = "";
    $("loginMessage").hidden = true;
    showView(result.user);
  } catch (error) {
    showMessage("loginMessage", error.message, true);
  } finally {
    $("loginButton").disabled = false;
  }
});

async function logout() {
  try {
    await api({ action: "logout" });
    showView(null);
    $("loginForm").reset();
  } catch (error) {
    showMessage(
      currentUser?.role === "teacher" ? "teacherMessage" : "studentMessage",
      error.message,
      true,
    );
  }
}
document.querySelectorAll(".logout-button").forEach((button) => {
  button.addEventListener("click", logout);
});

$("attendanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("registerButton").disabled = true;
  try {
    const result = await api({ action: "register", code: $("code").value });
    showStudentRegistration(result.time, result.late);
  } catch (error) {
    if (error.message === "Ya registraste asistencia en esta clase.") {
      await loadStudentStatus(currentUser.identifier);
    } else {
      showMessage("studentMessage", error.message, true);
    }
  } finally {
    $("registerButton").disabled = false;
  }
});

api({ action: "me" })
  .then((result) => showView(result.user))
  .catch(() => showView(null));
