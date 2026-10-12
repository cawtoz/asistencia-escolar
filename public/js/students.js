import { api } from "./api.js";
import { $, createIcon, renderTable, showMessage, setIcon } from "./ui.js";

let editingStudentId = "";
let currentStudents = [];
let resettingStudent = null;
let deletingStudent = null;

function closeStudentDialog() {
  $("studentDialog").close();
}

function openStudentForm(student = null) {
  editingStudentId = student?.identifier || "";
  $("studentDialogTitle").textContent = student
    ? "Editar estudiante"
    : "Nuevo estudiante";
  setIcon("studentDialogIcon", student ? "edit" : "plus");
  $("studentAccountForm").hidden = false;
  $("resetStudentView").hidden = true;
  $("studentFormMessage").hidden = true;
  $("newStudentId").value = student?.identifier || "";
  $("newStudentName").value = student?.name || "";
  $("newStudentPassword").value = "";
  $("initialPasswordField").hidden = Boolean(student);
  $("newStudentPassword").required = !student;
  $("studentDialog").showModal();
  $("newStudentId").focus();
}

function openResetDialog(student) {
  resettingStudent = student;
  $("studentDialogTitle").textContent = "Restablecer clave";
  setIcon("studentDialogIcon", "lock");
  $("studentAccountForm").hidden = true;
  $("resetStudentView").hidden = false;
  $("resetPrompt").textContent =
    `Escribe una contraseña para ${student.name} o deja el campo vacío para generar una. La anterior dejará de funcionar.`;
  $("resetPrompt").hidden = false;
  $("resetPasswordInput").value = "";
  $("resetPasswordField").hidden = false;
  $("resetPasswordResult").hidden = true;
  $("resetMessage").hidden = true;
  $("confirmResetButton").hidden = false;
  $("cancelResetButton").hidden = false;
  $("doneResetButton").hidden = true;
  $("studentDialog").showModal();
}

function studentActions(student) {
  const actions = document.createElement("div");
  actions.className = "student-actions";
  for (const [label, action, icon] of [
    ["Editar", "edit", "edit"],
    ["Restablecer clave", "reset", "lock"],
    ["Eliminar", "delete", "trash"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "table-action";
    button.dataset.action = action;
    button.dataset.identifier = student.identifier;
    button.setAttribute("aria-label", `${label} de ${student.name}`);
    button.title = `${label} de ${student.name}`;
    button.append(createIcon(icon));
    actions.append(button);
  }

  return actions;
}

export function renderStudents(students) {
  if (
    JSON.stringify(students) === JSON.stringify(currentStudents) &&
    $("students").childNodes.length
  )
    return;
  currentStudents = students;
  const table = renderTable(
    "students",
    students,
    [
      ["Nombre", "name", "user"],
      ["Identificación", "identifier", "id"],
      ["Acciones", studentActions, "more"],
    ],
    "Todavía no hay estudiantes.",
  );
  if (table) table.className = "students-table";
}

export function closeStudentDialogs() {
  $("studentDialog").close();
  $("deleteStudentDialog").close();
}

export function initStudents(renderTeacher) {
  $("studentAccountForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("saveStudentButton").disabled = true;
    try {
      const result = await api({
        action: "saveStudent",
        originalIdentifier: editingStudentId,
        identifier: $("newStudentId").value.trim(),
        name: $("newStudentName").value.trim(),
        password: $("newStudentPassword").value,
      });
      renderTeacher(result.state);
      closeStudentDialog();
      showMessage(
        "accountMessage",
        result.created ? "Estudiante creado." : "Estudiante actualizado.",
      );
    } catch (error) {
      showMessage("studentFormMessage", error.message, true);
    } finally {
      $("saveStudentButton").disabled = false;
    }
  });

  $("newStudentButton").addEventListener("click", () => openStudentForm());
  for (const id of [
    "cancelStudentButton",
    "closeStudentDialogButton",
    "cancelResetButton",
    "doneResetButton",
  ]) {
    $(id).addEventListener("click", closeStudentDialog);
  }
  $("studentDialog").addEventListener("click", (event) => {
    if (event.target === $("studentDialog")) closeStudentDialog();
  });
  $("studentDialog").addEventListener("close", () => {
    $("studentAccountForm").reset();
    $("temporaryPassword").textContent = "";
    $("resetPasswordInput").value = "";
    editingStudentId = "";
    resettingStudent = null;
  });
  $("students").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const student = currentStudents.find(
      (item) => item.identifier === button.dataset.identifier,
    );
    if (!student) return;
    if (button.dataset.action === "edit") {
      openStudentForm(student);
      return;
    }
    if (button.dataset.action === "delete") {
      deletingStudent = student;
      $("deleteStudentPrompt").textContent =
        `¿Eliminar a ${student.name} (${student.identifier})? Ya no podrá iniciar sesión. Sus asistencias registradas se conservarán.`;
      $("deleteStudentMessage").hidden = true;
      $("deleteStudentDialog").showModal();
      return;
    }
    openResetDialog(student);
  });

  $("cancelDeleteStudentButton").addEventListener("click", () => {
    $("deleteStudentDialog").close();
  });
  $("deleteStudentDialog").addEventListener("close", () => {
    deletingStudent = null;
  });
  $("deleteStudentDialog").addEventListener("click", (event) => {
    if (event.target === $("deleteStudentDialog"))
      $("deleteStudentDialog").close();
  });
  $("confirmDeleteStudentButton").addEventListener("click", async () => {
    if (!deletingStudent) return;
    $("confirmDeleteStudentButton").disabled = true;
    $("cancelDeleteStudentButton").disabled = true;
    try {
      renderTeacher(
        await api({
          action: "deleteStudent",
          identifier: deletingStudent.identifier,
        }),
      );
      $("deleteStudentDialog").close();
      showMessage("accountMessage", "Estudiante eliminado.");
    } catch (error) {
      showMessage("deleteStudentMessage", error.message, true);
    } finally {
      $("confirmDeleteStudentButton").disabled = false;
      $("cancelDeleteStudentButton").disabled = false;
    }
  });

  $("confirmResetButton").addEventListener("click", async () => {
    const student = resettingStudent;
    if (!student) return;
    const passwordInput = $("resetPasswordInput");
    if (!passwordInput.reportValidity()) return;
    const password = passwordInput.value;
    $("confirmResetButton").disabled = true;
    try {
      const result = await api({
        action: "resetStudentPassword",
        identifier: student.identifier,
        password,
      });
      $("temporaryPassword").textContent = result.temporaryPassword;
      $("resetPasswordResult").hidden = false;
      $("resetPrompt").hidden = true;
      $("resetPasswordField").hidden = true;
      $("confirmResetButton").hidden = true;
      $("cancelResetButton").hidden = true;
      $("doneResetButton").hidden = false;
      $("copyPasswordButton").textContent = "Copiar";
    } catch (error) {
      showMessage("resetMessage", error.message, true);
    } finally {
      $("confirmResetButton").disabled = false;
    }
  });

  $("copyPasswordButton").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("temporaryPassword").textContent);
      $("copyPasswordButton").textContent = "Copiada";
    } catch {
      showMessage(
        "resetMessage",
        "Selecciona la contraseña para copiarla.",
        true,
      );
    }
  });
}
