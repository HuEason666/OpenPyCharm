/** CDP probe: welcome -> open sample_project -> open main.py -> inspect editor. */
const list = await fetch("http://127.0.0.1:9223/json/list").then((r) => r.json());
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let msgId = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

function send(method, params) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.error) return { __error: r.error.message };
  return r.result?.result?.value ?? null;
}

async function clickAt(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findRow(name) {
  const raw = await evaluate(`(() => {
    const rows = [...document.querySelectorAll("[role='treeitem']")];
    const row = rows.find((el) => el.textContent.trim() === ${JSON.stringify(name)});
    if (!row) return null;
    const r = row.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  if (!raw || typeof raw !== "string") return null;
  return JSON.parse(raw);
}

// Already in project view?
let row = await findRow("main.py");
if (!row) {
  // Welcome screen: click the recent project entry.
  const recent = await evaluate(`(() => {
    const els = [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && e.textContent.trim() === "sample_project" && e.getBoundingClientRect().width > 0,
    );
    const el = els[els.length - 1] ?? els[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  console.log("RECENT:", JSON.stringify(recent));
  if (!recent || typeof recent !== "string") {
    const dump = await evaluate(`document.body.innerText.replace(/\\n+/g, " | ").slice(0, 300)`);
    console.log("PAGE DUMP:", JSON.stringify(dump));
    console.log("welcome recent entry not found");
    ws.close();
    process.exit(0);
  }
  const p = JSON.parse(recent);
  await clickAt(p.x, p.y);
  await sleep(2500);
  row = await findRow("main.py");
}
console.log("ROW:", row ? JSON.stringify(row) : "not found");
if (!row) {
  ws.close();
  process.exit(0);
}

await clickAt(row.x, row.y);
await sleep(1500);

const probe = await evaluate(`(() => {
  const c = document.querySelector(".cm-content");
  if (!c) return JSON.stringify({ err: "NO .cm-content" });
  const r = c.getBoundingClientRect();
  const cs = getComputedStyle(c);
  const line = c.querySelector(".cm-line");
  const gut = document.querySelector(".cm-gutters");
  const gr = gut ? gut.getBoundingClientRect() : null;
  return JSON.stringify({
    textLen: c.textContent.length,
    textHead: JSON.stringify(c.textContent.slice(0, 50)),
    whiteSpace: cs.whiteSpace,
    font: cs.fontFamily.slice(0, 40),
    contentH: Math.round(r.height),
    gutterH: gr ? Math.round(gr.height) : null,
    firstLineHTML: line ? line.innerHTML.slice(0, 120) : null,
  });
})()`);
console.log("PROBE:", probe);

ws.close();
process.exit(0);
