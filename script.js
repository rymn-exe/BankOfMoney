const screenEl = document.getElementById("screen");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rollPercent = pct => Math.random() * 100 < pct;

function dispenseAmount() {
  const r = Math.random() * 100;
  if (r < 1) return 10;
  if (r < 6) return 5;
  return 1 + Math.floor(Math.random() * 3); // 1-3
}

const state = {
  phase: "intro",
  cash: 0,
  lockChance: 0,
  successfulWithdraws: 0,
  locked: false,
  messageLines: null,
  messageDanger: false,
  isTyping: false
};

async function typeLines(lines, delay = 500) {
  screenEl.innerHTML = "";
  for (const line of lines) {
    screenEl.innerHTML += (screenEl.innerHTML ? "\n" : "") + line;
    await sleep(delay);
  }
}

async function typeTextCharByChar(lines, charDelay = 24) {
  screenEl.textContent = "";
  screenEl.classList.remove("center");
  state.isTyping = true;
  let aborted = false;
  const onAbort = () => { aborted = true; };
  // Defer attaching the click listener so the current click (that triggered typing) doesn't abort immediately
  await sleep(0);
  window.addEventListener("click", onAbort, { once: true });
  for (let lineIdx = 0; lineIdx < lines.length && !aborted; lineIdx++) {
    const line = lines[lineIdx];
    for (let i = 0; i < line.length && !aborted; i++) {
      screenEl.textContent += line[i];
      await sleep(charDelay);
    }
    if (lineIdx < lines.length - 1 && !aborted) {
      screenEl.textContent += "\n";
      await sleep(charDelay * 10);
    }
  }
  state.isTyping = false;
  return aborted;
}

async function waitForClick() {
  return new Promise(resolve => {
    window.addEventListener("click", resolve, { once: true });
  });
}

function renderATM() {
  screenEl.classList.add("center");
  const feeAvailable = state.cash >= 3;
  const feeTitle = feeAvailable ? "Pay $3 to reset lock chance to 0" : "Need at least $3";
  const feeSpan = `<span class="tt ${feeAvailable ? "action" : "disabled danger"}" data-action="fee" data-tip="${feeTitle}">$3</span>`;

  const interiorWidth = 42; // number of characters between vertical bars
  const padCenter = (text) => {
    const t = String(text ?? "");
    const visible = t.length > interiorWidth ? t.slice(0, interiorWidth) : t;
    const spaces = interiorWidth - visible.length;
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    return " ".repeat(left) + visible + " ".repeat(right);
  };
  const stripTags = (s) => String(s).replace(/<[^>]*>/g, "");
  const padInlineHTML = (content) => {
    const displayLen = stripTags(content).length;
    const spaces = Math.max(0, interiorWidth - displayLen);
    return content + " ".repeat(spaces);
  };
  const centerInlineHTML = (content) => {
    const displayLen = stripTags(content).length;
    const spaces = Math.max(0, interiorWidth - displayLen);
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    return " ".repeat(left) + content + " ".repeat(right);
  };
  const centerBodyHTML = (text, danger = false) => {
    const t = String(text ?? "");
    const visible = t.length > interiorWidth ? t.slice(0, interiorWidth) : t;
    const spaces = interiorWidth - visible.length;
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    const core = danger ? `<span class="danger">${visible}</span>` : visible;
    return " ".repeat(left) + core + " ".repeat(right);
  };

  const headerContent = `<span class="mustard">BANK</span> OF <span class="mustard">MONEY</span> ATM`;
  const headerLine = `|${centerInlineHTML(headerContent)}|`;
  const lockTip = `Chance card is retained on next withdraw`;
  const lockLabel = `<span class="tt" data-tip="${lockTip}">LOCK CHANCE:</span>`;
  const lockValue = `<span class="tt" data-tip="${lockTip}">${state.lockChance}%</span>`;
  const feeLabel = `<span class="tt" data-action="fee" data-tip="${feeTitle}">ATM FEE:</span>`;
  const statusContent = `${lockLabel} ${lockValue}    ${feeLabel} ${feeSpan}`;
  const statusLine = `|${centerInlineHTML(statusContent)}|`;
  const cashContent = `CASH DISPENSED: $${state.cash}`;
  const cashLine = `|${centerInlineHTML(cashContent)}|`;

  let middleLines = [];
  if (state.messageLines && state.messageLines.length > 0) {
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[0], state.messageDanger)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[1], state.messageDanger)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[2], state.messageDanger)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
  } else {
    const withdrawLine = centerBodyHTML("( WITHDRAW )", false);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${withdrawLine}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
  }

  const topBorder = `+${"-".repeat(interiorWidth)}+`;
  const bottomBorder = topBorder;
  const spacer = `|${" ".repeat(interiorWidth)}|`;

  screenEl.innerHTML =
`${topBorder}
${headerLine}
${spacer}
${statusLine}
${middleLines.join("\n")}
${cashLine}
${bottomBorder}`;
}

async function showIntro() {
  const aborted = await typeTextCharByChar([
    "You need $20.",
    "Rumour has it the ATM in the warehouse dispenses money.",
    "You already told them you had the cash."
  ]);
  if (!aborted) {
    await waitForClick();
  }
  renderATM();
}

screenEl.addEventListener("click", async (event) => {
  if (state.phase !== "intro" || state.locked) return;
  if (state.isTyping) return; // ignore clicks that abort intro typing

  // Handle ATM fee click
  const target = event.target;
  if (target && target instanceof Element && target.dataset && target.dataset.action === "fee") {
    if (state.cash >= 3) {
      state.locked = true;
      state.cash -= 3;
      state.lockChance = 0;
      renderATM();
      state.locked = false;
    }
    return;
  }

  state.locked = true;

  if (state.lockChance > 0 && rollPercent(state.lockChance)) {
    state.messageLines = ["CARD RETAINED", "", "TRANSACTION CANCELLED"];
    state.messageDanger = true;
    renderATM();
    await sleep(1200);
    state.cash = 0;
    state.lockChance = 0;
    state.successfulWithdraws = 0;
    state.messageLines = null;
    state.messageDanger = false;
    state.locked = false;
    await showIntro();
    return;
  }

  const amt = dispenseAmount();
  state.cash += amt;
  state.successfulWithdraws += 1;
  state.lockChance = clamp(state.lockChance + state.successfulWithdraws, 0, 99);

  if (state.cash >= 20) {
    const aborted = await typeTextCharByChar([
      "You paid them off.",
      "For now..."
    ]);
    if (!aborted) {
      await waitForClick();
    }
    state.cash = 0;
    state.lockChance = 0;
    state.successfulWithdraws = 0;
    state.locked = false;
    await showIntro();
    return;
  }

  renderATM();
  state.locked = false;
});

showIntro();
