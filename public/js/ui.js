export const $ = (id) => document.getElementById(id);

export function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

export function setIcon(id, name) {
  $(id).setAttribute("href", `#icon-${name}`);
}

export function formatTime(time) {
  const match = /^(\d{2}):(\d{2})/.exec(String(time || ""));
  if (!match) return time || "";
  const hour = Number(match[1]);
  if (hour > 23) return time;
  return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

export function showMessage(id, text, error = false) {
  const element = $(id);
  element.textContent = text;
  element.className = `message${error ? " error" : ""}`;
  element.hidden = false;
}

export function renderTable(targetId, rows, columns, emptyText) {
  const target = $(targetId);
  target.replaceChildren();
  if (!rows.length) {
    target.textContent = emptyText;
    return;
  }

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const [label, , icon] of columns) {
    const cell = document.createElement("th");
    if (icon) cell.append(createIcon(icon), document.createTextNode(label));
    else cell.textContent = label;
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const [, key] of columns) {
      const cell = document.createElement("td");
      const value = typeof key === "function" ? key(row) : row[key];
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  table.append(head, body);
  target.appendChild(table);
  return table;
}
