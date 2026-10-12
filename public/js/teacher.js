import { api } from "./api.js";
import { $, formatTime, renderTable, showMessage, setIcon } from "./ui.js";

import {
  initStudents,
  renderStudents,
  closeStudentDialogs,
} from "./students.js";

let refreshTimer = null;
let countdownTimer = null;
let renderedQrCode = "";
let attendanceView = "registered";
let latestTeacherState = null;
let panelActive = false;
let refreshPending = false;
let renderedAttendance = "";

function updateArrivalCountdown() {
  const session = latestTeacherState?.session;
  const target = $("arrivalCountdown");
  if (
    !session?.open ||
    session.startedAt == null ||
    session.lateMinutes == null
  ) {
    target.hidden = true;
    return;
  }

  target.hidden = false;
  const seconds = Math.max(
    0,
    Math.ceil(
      (session.startedAt + session.lateMinutes * 60_000 - Date.now()) / 1000,
    ),
  );
  $("arrivalCountdownValue").textContent = seconds
    ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")} restantes`
    : "Tiempo agotado";
}

function renderAttendance() {
  if (!latestTeacherState) return;
  const { session, rows, students } = latestTeacherState;
  const snapshot = JSON.stringify([
    attendanceView,
    session?.id,
    rows,
    students,
  ]);
  if (snapshot === renderedAttendance) return;
  renderedAttendance = snapshot;
  const registeredIds = new Set(rows.map((row) => row.studentId));
  const pending = session
    ? students.filter((student) => !registeredIds.has(student.identifier))
    : [];

  $("count").textContent = rows.length;
  $("pendingCount").textContent = pending.length;
  for (const [view, id] of [
    ["registered", "registeredFilter"],
    ["pending", "pendingFilter"],
  ]) {
    const active = attendanceView === view;
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-pressed", String(active));
  }

  if (attendanceView === "pending") {
    renderTable(
      "attendance",
      pending.map((student) => ({
        name: student.name,
        studentId: student.identifier,
      })),
      [
        ["Nombre", "name", "user"],
        ["Identificación", "studentId", "id"],
      ],
      session
        ? "Todos los estudiantes se han registrado."
        : "Abre el registro para ver quién falta.",
    );
    return;
  }

  renderTable(
    "attendance",
    rows.map((row) => ({
      ...row,
      time: formatTime(row.time),
      arrival: row.late == null ? "—" : row.late ? "Tarde" : "A tiempo",
    })),
    [
      ["Nombre", "name", "user"],
      ["Identificación", "studentId", "id"],
      ["Hora", "time", "clock"],
      ["Llegada", "arrival", "clock"],
    ],
    session
      ? "Aún no hay registros en esta clase."
      : "Abre el registro para ver la asistencia.",
  );
}
let pendingRegistrationAction = null;

function openRegistrationConfirmation(action) {
  pendingRegistrationAction = action;
  const opening = action === "start";
  const label = opening ? "Abrir registro" : "Cerrar registro";
  $("registrationDialogTitle").textContent = label;
  setIcon("registrationDialogIcon", opening ? "plus" : "close");
  $("registrationDialogDescription").textContent = opening
    ? "Se creará un código y una lista nueva. Quienes lleguen después del margen aparecerán como Tarde."
    : "El código dejará de aceptar asistencias. La lista seguirá visible.";
  $("lateMinutesField").hidden = !opening;
  if (opening) $("lateMinutesInput").value = "10";
  $("confirmRegistrationButton").textContent = label;
  $("registrationDialogMessage").hidden = true;
  $("registrationDialog").showModal();
}

function closeSidebar() {
  $("teacherSidebar").classList.remove("open");
  $("sidebarOverlay").hidden = true;
  $("menuButton").setAttribute("aria-expanded", "false");
  $("menuButton").setAttribute("aria-label", "Abrir menú");
}

function selectPanel(panelId) {
  for (const panel of document.querySelectorAll(".dashboard-panel")) {
    panel.hidden = panel.id !== panelId;
  }
  for (const button of document.querySelectorAll(".nav-button")) {
    const active = button.dataset.panel === panelId;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
  closeSidebar();
}

async function refreshTeacher() {
  if (refreshPending || !panelActive) return;
  refreshPending = true;
  const previousState = latestTeacherState;
  try {
    const state = await api({ action: "state" });
    if (panelActive && latestTeacherState === previousState)
      renderTeacher(state);
  } catch (error) {
    if (panelActive) showMessage("teacherMessage", error.message, true);
  } finally {
    refreshPending = false;
  }
}

function renderTeacher(state) {
  latestTeacherState = state;
  updateArrivalCountdown();
  const session = state.session;
  const info = $("sessionInfo");
  const qr = $("qr");
  $("sessionBlock").hidden = !session?.open;
  if (!session?.open && $("codeDialog").open) $("codeDialog").close();

  if (!session) {
    qr.replaceChildren();
    renderedQrCode = "";
    info.textContent = "";
    $("sessionBadge").textContent = "Sin clase";
    $("sessionBadge").className = "status-badge";
  } else {
    const visibleCode = session.open ? session.code : "";
    if (info.textContent !== visibleCode) info.textContent = visibleCode;

    $("sessionBadge").textContent = session.open
      ? "Registro abierto"
      : "Registro cerrado";
    $("sessionBadge").className =
      `status-badge${session.open ? " is-open" : ""}`;

    if (session.open) {
      const link = new URL(location.origin);
      link.searchParams.set("codigo", session.code);
      if (window.QRCode && renderedQrCode !== session.code) {
        qr.replaceChildren();
        new QRCode(qr, { text: link.href, width: 190, height: 190 });
        renderedQrCode = session.code;
      }
    } else {
      qr.replaceChildren();
      renderedQrCode = "";
    }
  }

  $("startButton").hidden = Boolean(session?.open);
  $("showCodeButton").hidden = !session?.open;
  $("closeButton").hidden = !session?.open;
  renderAttendance();

  renderStudents(state.students);
  $("studentCount").textContent = state.students.length;
}

export function startTeacherPanel() {
  panelActive = true;
  selectPanel("codePanel");
  refreshTeacher();
  if (!refreshTimer) refreshTimer = setInterval(refreshTeacher, 3000);
  if (!countdownTimer)
    countdownTimer = setInterval(updateArrivalCountdown, 1000);
}

export function stopTeacherPanel() {
  panelActive = false;
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
  closeSidebar();
  closeStudentDialogs();
  if ($("codeDialog").open) $("codeDialog").close();
  if ($("registrationDialog").open) $("registrationDialog").close();
}

$("menuButton").addEventListener("click", () => {
  const open = !$("teacherSidebar").classList.contains("open");
  $("teacherSidebar").classList.toggle("open", open);
  $("sidebarOverlay").hidden = !open;
  $("menuButton").setAttribute("aria-expanded", String(open));
  $("menuButton").setAttribute(
    "aria-label",
    open ? "Cerrar menú" : "Abrir menú",
  );
});
$("sidebarOverlay").addEventListener("click", closeSidebar);
$("registeredFilter").addEventListener("click", () => {
  attendanceView = "registered";
  renderAttendance();
});
$("pendingFilter").addEventListener("click", () => {
  attendanceView = "pending";
  renderAttendance();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSidebar();
});
document.querySelectorAll(".nav-button").forEach((button) => {
  button.addEventListener("click", () => selectPanel(button.dataset.panel));
});

$("startButton").addEventListener("click", () => {
  openRegistrationConfirmation("start");
});

$("showCodeButton").addEventListener("click", () => {
  $("codeDialog").showModal();
});
$("closeCodeDialogButton").addEventListener("click", () => {
  $("codeDialog").close();
});
$("codeDialog").addEventListener("click", (event) => {
  if (event.target === $("codeDialog")) $("codeDialog").close();
});

$("closeButton").addEventListener("click", () => {
  openRegistrationConfirmation("close");
});

$("cancelRegistrationButton").addEventListener("click", () => {
  $("registrationDialog").close();
});
$("registrationDialog").addEventListener("close", () => {
  pendingRegistrationAction = null;
});
$("registrationDialog").addEventListener("click", (event) => {
  if (event.target === $("registrationDialog")) $("registrationDialog").close();
});
$("confirmRegistrationButton").addEventListener("click", async () => {
  const action = pendingRegistrationAction;
  if (!action) return;
  if (action === "start" && !$("lateMinutesInput").reportValidity()) return;
  $("confirmRegistrationButton").disabled = true;
  $("cancelRegistrationButton").disabled = true;
  try {
    renderTeacher(
      await api({
        action,
        ...(action === "start"
          ? { lateMinutes: Number($("lateMinutesInput").value) }
          : {}),
      }),
    );
    $("registrationDialog").close();
    if (action === "start") $("codeDialog").showModal();
  } catch (error) {
    showMessage("registrationDialogMessage", error.message, true);
  } finally {
    $("confirmRegistrationButton").disabled = false;
    $("cancelRegistrationButton").disabled = false;
  }
});

initStudents(renderTeacher);
