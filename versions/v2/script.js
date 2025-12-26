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
  isTyping: false,
  // v2 additions
  atmFee: 3,
  lockUnknown: false,
  withdrawLabel: "( WITHDRAW )",
  withdrawsSinceEvent: 0,
  eventActive: false,
  eventData: null,
  rarityUsed: {
    common: new Set(),
    uncommon: new Set(),
    rare: new Set()
  },
  awaitingProceed: false,
  pendingEventId: null,
  activeKeyHandler: null
};

async function typeLines(lines, delay = 500) {
  screenEl.innerHTML = "";
  for (const line of lines) {
    screenEl.innerHTML += (screenEl.innerHTML ? "\n" : "") + line;
    await sleep(delay);
  }
}

async function typeTextCharByChar(lines, charDelay = 50) {
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
      await sleep(charDelay * 11);
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

// Word-wrapping helper for event prompts (keeps ASCII box aligned)
function wrapTextByWords(text, maxLen) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    if (current.length === 0) {
      current = w;
    } else if (current.length + 1 + w.length <= maxLen) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}
function renderATM() {
  screenEl.classList.add("center");
  const feeAvailable = state.cash >= state.atmFee;
  const feeTitle = feeAvailable ? `Pay $${state.atmFee.toFixed(2).replace(/\.00$/, "")} to reset lock chance to 0` : `Need at least $${state.atmFee.toFixed(2).replace(/\.00$/, "")}`;
  const feeText = `$${state.atmFee.toFixed(2).replace(/\.00$/, "")}`;
  const feeSpan = `<span class="tt ${feeAvailable ? "action" : "disabled danger"}" data-action="fee" data-tip="${escapeAttr(feeTitle)}">${feeText}</span>`;

  const interiorWidth = 60; // number of characters between vertical bars
  const padCenter = (text) => {
    const t = String(text ?? "");
    const visible = t.length > interiorWidth ? t.slice(0, interiorWidth) : t;
    const spaces = interiorWidth - visible.length;
    const left = Math.floor(spaces / 2);
    const right = spaces - left;
    return " ".repeat(left) + visible + " ".repeat(right);
  };
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
  const lockLabel = `<span class="tt" data-tip="${escapeAttr(lockTip)}">LOCK CHANCE:</span>`;
  let lockClass = "";
  if (state.lockChance >= 50) lockClass = "danger blink";
  else if (state.lockChance >= 25) lockClass = "danger";
  else if (state.lockChance >= 15) lockClass = "warn";
  const lockValue = `<span class="tt ${lockClass}" data-tip="${escapeAttr(lockTip)}">${state.lockUnknown ? "??" : `${state.lockChance}%`}</span>`;
  const feeLabel = `<span class="tt" data-action="fee" data-tip="${escapeAttr(feeTitle)}">ATM FEE:</span>`;
  const statusContent = `${lockLabel} ${lockValue}    ${feeLabel} ${feeSpan}`;
  const statusLine = `|${centerInlineHTML(statusContent)}|`;
  const cashContent = `CASH DISPENSED: $${state.cash.toFixed(2)}`;
  const cashLine = `|${centerInlineHTML(cashContent)}|`;

  let middleLines = [];
  if (state.eventActive && state.eventData) {
    // Event view: render prompt lines and options
    const lines = state.eventData.renderLines || [];
    const optLines = state.eventData.optionLines || [];
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    for (const ln of lines) {
      middleLines.push(`|${centerBodyHTML(ln, state.messageDanger)}|`);
    }
    // pad to at least 3 lines of content
    while (middleLines.length < 3) {
      middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    }
    // add a spacer before options for better separation
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    if (optLines.length > 0) {
      const stripTags = (s) => String(s).replace(/<[^>]*>/g, "");
      const gap = "   ";
      if (optLines.length === 1) {
        middleLines.push(`|${centerInlineHTML(optLines[0])}|`);
      } else {
        const l1 = stripTags(optLines[0]).length;
        const l2 = stripTags(optLines[1]).length;
        if (l1 + gap.length + l2 <= interiorWidth) {
          const combined = optLines[0] + gap + optLines[1];
          middleLines.push(`|${centerInlineHTML(combined)}|`);
        } else {
          middleLines.push(`|${centerInlineHTML(optLines[0])}|`);
          middleLines.push(`|${centerInlineHTML(optLines[1])}|`);
        }
      }
    }
    // pad to total 5 interior lines if fewer were used
    while (middleLines.length < 7) {
      middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    }
  } else if (state.messageLines && state.messageLines.length > 0) {
    // keep same height as event view (7 interior lines)
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[0], state.messageDanger)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[1], state.messageDanger)}|`);
    middleLines.push(`|${centerBodyHTML(state.messageLines[2], state.messageDanger)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
  } else {
    const withdrawLine = state.awaitingProceed
      ? centerInlineHTML(`<span class="action" data-action="proceed">${state.withdrawLabel}</span>`)
      : centerBodyHTML(state.withdrawLabel, false);
    // keep base ATM height consistent with event view (7 interior lines)
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
    middleLines.push(`|${withdrawLine}|`);
    middleLines.push(`|${" ".repeat(interiorWidth)}|`);
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
  if (state.phase !== "intro") return;

  // If an event is active, handle option clicks regardless of locked state
  if (state.eventActive && state.eventData) {
    const t = event.target;
    if (t && t instanceof Element) {
      const optEl = t.closest('[data-action="event-opt"]');
      if (optEl) {
        const idx = Number(optEl.getAttribute("data-index") || "0");
        if (state.eventData && state.eventData.onSelect) {
          await state.eventData.onSelect(idx);
        }
        return;
      }
    }
    // Fallback: detect clicks by coordinates over option spans
    const clientX = event.clientX;
    const clientY = event.clientY;
    const optSpans = screenEl.querySelectorAll('[data-action="event-opt"]');
    for (const el of optSpans) {
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        const idx = Number(el.getAttribute("data-index") || "0");
        if (state.eventData && state.eventData.onSelect) {
          await state.eventData.onSelect(idx);
        }
        return;
      }
    }
    return; // block other clicks during events
  }

  // Awaiting proceed: only proceed if the proceed control is clicked
  if (state.awaitingProceed) {
    const t = event.target;
    const proceedEl = t && t instanceof Element ? t.closest('[data-action="proceed"]') : null;
    if (proceedEl) {
      state.awaitingProceed = false;
      state.locked = true;
      await handleWin();
      state.locked = false;
    }
    return;
  }

  if (state.isTyping || state.locked) return; // ignore during typing or locked

  // Handle ATM fee click
  const target = event.target;
  if (target && target instanceof Element && target.dataset && target.dataset.action === "fee") {
    if (state.cash >= state.atmFee) {
      state.locked = true;
      state.cash = round2(state.cash - state.atmFee);
      state.lockChance = 0;
      state.lockUnknown = false;
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
    state.atmFee = 3;
    state.lockUnknown = false;
    state.withdrawsSinceEvent = 0;
    state.locked = false;
    await showIntro();
    return;
  }

  const amt = dispenseAmount();
  state.cash = round2(state.cash + amt);
  state.successfulWithdraws += 1;
  state.lockChance = clamp(state.lockChance + state.successfulWithdraws, 0, 99);

  if (state.cash >= 20) {
    // Require clicking PROCEED to move to the win screen
    state.withdrawLabel = "( PROCEED )";
    state.awaitingProceed = true;
    renderATM();
    state.locked = false;
    return;
  }

  state.withdrawsSinceEvent += 1;
  await maybeTriggerEvent();
  if (!state.eventActive) {
    renderATM();
  }
  state.locked = false;
});

showIntro();

// -------- v2 helpers and events ----------

function round2(n) {
  return Math.round(n * 100) / 100;
}

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, "");
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleWin() {
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
  state.atmFee = 3;
  state.lockUnknown = false;
  state.withdrawsSinceEvent = 0;
  state.withdrawLabel = "( WITHDRAW )";
  await showIntro();
}

function rarityPick() {
  // 60% common, 30% uncommon, 10% rare
  const r = Math.random() * 100;
  if (r < 60) return "common";
  if (r < 90) return "uncommon";
  return "rare";
}

function getPoolByRarity(r) {
  if (r === "common") return [1, 2, 3, 6];
  if (r === "uncommon") return [4, 11];
  return [5, 9, 10];
}

function refreshRarityIfExhausted(r) {
  const pool = getPoolByRarity(r);
  if (state.rarityUsed[r].size >= pool.length) {
    state.rarityUsed[r] = new Set();
  }
}

function pickEventIdForRarity(r) {
  refreshRarityIfExhausted(r);
  const pool = getPoolByRarity(r).filter(id => !state.rarityUsed[r].has(id));
  return pool[Math.floor(Math.random() * pool.length)];
}

async function maybeTriggerEvent() {
  if (state.eventActive) return;
  if (state.withdrawsSinceEvent % 5 !== 0) return;
  // events fire immediately after the 3rd/6th/9th withdraw, unless win/loss handled already above
  const rarity = rarityPick();
  const id = pickEventIdForRarity(rarity);
  state.rarityUsed[rarity].add(id);
  await runEvent(id);
  state.withdrawsSinceEvent = 0;
}

async function runEvent(id) {
  // Router
  if (id === 1) return event1();
  if (id === 2) return event2();
  if (id === 3) return event3();
  if (id === 4) return event4();
  if (id === 5) return event5();
  if (id === 6) return event6();
  if (id === 9) return event9();
  if (id === 10) return event10();
  if (id === 11) return event11();
  // safety no-op
}

async function showEvent(prompt, options) {
  state.eventActive = true;
  state.eventData = { renderLines: [], optionLines: [], onSelect: null };
  // typing effect for prompt (may be multiple lines)
  let lines;
  if (Array.isArray(prompt)) {
    lines = prompt;
  } else {
    // Wrap long prompts into at most 2 lines to preserve alignment
    const wrapped = wrapTextByWords(String(prompt), 56);
    lines = wrapped.slice(0, 2);
  }
  let built = ["", "", ""];
  for (let li = 0; li < Math.min(3, lines.length); li++) {
    const line = lines[li];
    let current = "";
    for (let i = 0; i < line.length; i++) {
      current += line[i];
      built[li] = current;
      state.eventData.renderLines = built.slice();
      state.eventData.optionLines = [];
      renderATM();
      await sleep(50); // same speed as intro typing (smoothed)
    }
    // slight pause between lines
    await sleep(550);
  }
  // build option lines
  const optLines = [];
  const splitLabelAndTip = (text) => {
    const m = String(text).match(/^(.*?)(?:\s*\((.*)\))?\s*$/);
    const label = (m?.[1] || "").trim();
    const tip = ((m?.[2] || "").trim()) || "??";
    return { label, tip };
  };
  options.forEach((opt, idx) => {
    const { label, tip } = splitLabelAndTip(opt);
    const tipAttr = tip ? ` data-tip="${escapeAttr(tip)}"` : "";
    optLines.push(
      `<span class="action event-opt tt" role="button" tabindex="0" data-action="event-opt" data-index="${idx}"${tipAttr}>${label}</span>`
    );
  });
  state.eventData.optionLines = optLines;
  // onSelect will be set by caller
  renderATM();
  return new Promise(resolve => {
    const onKey = (e) => {
      if (state.locked || !state.eventActive) return;
      if (e.key === "1" && options.length >= 1) { cleanup(); resolve(0); }
      if (e.key === "2" && options.length >= 2) { cleanup(); resolve(1); }
      if (e.key === "Enter" && options.length >= 1) { cleanup(); resolve(0); }
    };
    function cleanup() {
      window.removeEventListener("keydown", onKey);
      state.activeKeyHandler = null;
    }
    window.addEventListener("keydown", onKey);
    state.activeKeyHandler = onKey;
    state.eventData.onSelect = async (idx) => {
      cleanup();
      resolve(idx);
    };
  });
}

async function endEvent() {
  state.eventActive = false;
  state.eventData = null;
  state.messageDanger = false;
  if (state.activeKeyHandler) {
    window.removeEventListener("keydown", state.activeKeyHandler);
    state.activeKeyHandler = null;
  }
  // if a pending chain is queued (e.g., from code entry), run it now
  if (state.pendingEventId != null) {
    const id = state.pendingEventId;
    state.pendingEventId = null;
    await runEvent(id);
    return; // child event will render/end
  }
  renderATM();
}

// ----- Individual events -----

async function event1() {
  const idx = await showEvent("Machine hums normally.", ["Keep going (+$1)", "Push your card a little deeper (lock chance -3%)"]);
  if (idx === 0) {
    state.cash = round2(state.cash + 1);
  } else if (idx === 1) {
    state.lockChance = clamp(state.lockChance - 3, 0, 99);
  }
  await endEvent();
}

async function event2() {
  const idx = await showEvent("Camera above you moves.", ["Walk away (reset)", "Just a few more tries (+??% Lock chance)"]);
  if (idx === 0) {
    // full reset
    state.cash = 0;
    state.lockChance = 0;
    state.successfulWithdraws = 0;
    state.atmFee = 3;
    state.lockUnknown = false;
    state.withdrawsSinceEvent = 0;
    await endEvent();
    await showIntro();
    return;
  } else if (idx === 1) {
    const delta = Math.floor(Math.random() * 31) - 15; // -15..+15
    state.lockChance = clamp(state.lockChance + delta, 0, 99);
    state.lockUnknown = true;
  }
  await endEvent();
}

async function event3() {
  const idx = await showEvent("You hear something inside the machine.", ["Listen carefully", "Reach inside"]);
  let triggered = false;
  if (idx === 0) {
    if (Math.random() < 0.5) {
      await event12(); // trigger
      triggered = true;
    }
  } else if (idx === 1) {
    if (Math.random() < 0.5) {
      await event10(); // trigger
      triggered = true;
    }
  }
  if (!triggered) {
    await endEvent();
  }
}

async function event4() {
  const idx = await showEvent("A $10 corner peeks out, suspiciously.", ["Grab it (50% +$10, 50% loss)", "What’s meant for you will come (lock chance -10%)"]);
  if (idx === 0) {
    if (Math.random() < 0.5) {
      state.cash = round2(state.cash + 10);
    } else {
      // immediate loss
      state.messageLines = ["CARD RETAINED", "", "TRANSACTION CANCELLED"];
      state.messageDanger = true;
      renderATM();
      await sleep(1200);
      state.cash = 0;
      state.lockChance = 0;
      state.successfulWithdraws = 0;
      state.messageLines = null;
      state.messageDanger = false;
      state.atmFee = 3;
      state.lockUnknown = false;
      state.withdrawsSinceEvent = 0;
      await endEvent();
      await showIntro();
      return;
    }
  } else if (idx === 1) {
    state.lockChance = clamp(state.lockChance - 10, 0, 99);
  }
  await endEvent();
}

async function event5() {
  const idx = await showEvent("A string of numbers flashes briefly.", ["Try to input the numbers", "It was probably nothing..."]);
  if (idx === 0) {
    await event13();
  }
  await endEvent();
}

async function event6() {
  const idx = await showEvent("You already said you had the money.", ["Shake the machine (ATM fee -$1)", "Maybe they’ll understand (+$3)"]);
  if (idx === 0) {
    state.atmFee = Math.max(0, state.atmFee - 1);
  } else if (idx === 1) {
    state.cash = round2(state.cash + 3);
  }
  await endEvent();
}

async function event9() {
  const idx = await showEvent("Symbols blink across the screen in patterns you don’t recognize.", ["Wait for another blink", "It’s probably nothing..."]);
  if (idx === 0) {
    await event17();
  }
  await endEvent();
}

async function event10() {
  // Lucky penny — apply effect after click
  const idx = await showEvent("You found a lucky penny", ["so shiny..."]);
  if (idx === 0) {
    state.cash = round2(state.cash + 0.01);
    state.lockChance = clamp(Math.round(state.lockChance * 0.75), 0, 99);
  }
  await endEvent();
}

async function event11() {
  const idx = await showEvent("You start to understand the rhythm of the machine…", ["A big payout is all but guaranteed"]);
  if (idx === 0) {
    state.cash = round2(state.cash + 5);
  }
  await endEvent();
}

// Triggered-only events
async function event12() {
  const idx = await showEvent("Another dollar", ["so close"]);
  if (idx === 0) {
    state.cash = round2(state.cash + 1);
  }
  await endEvent();
}

async function event13() {
  // Code entry UI
  let input = "";
  let nonNumeric = false;
  const prompt = "_ _ _ _";
  await showEvent(prompt, []);
  // install temporary key handler
  return new Promise(async (resolve) => {
    function updateRender() {
      const slots = ["_", "_", "_", "_"];
      for (let i = 0; i < input.length && i < 4; i++) slots[i] = input[i];
      state.eventData.renderLines = [slots.join(" "), "", ""];
      state.eventData.optionLines = []; // no options
      renderATM();
    }
    function submit() {
      // process code
      const code = input;
      const msg = processCode(code, nonNumeric);
      state.eventData.renderLines = [msg, "", ""];
      renderATM();
      setTimeout(async () => {
        resolve();
      }, 900);
      window.removeEventListener("keydown", onKey);
      state.activeKeyHandler = null;
    }
    function onKey(e) {
      if (e.key === "Backspace") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          updateRender();
        }
        return;
      }
      if (input.length >= 4) return; // autosubmit prevents further edits
      if (/^[0-9]$/.test(e.key)) {
        input += e.key;
        updateRender();
        if (input.length === 4) {
          submit();
        }
      } else if (e.key.length === 1) {
        nonNumeric = true;
        input += e.key;
        updateRender();
        if (input.length === 4) {
          submit();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    state.activeKeyHandler = onKey;
    updateRender();
  });
}

function processCode(code, nonNumeric) {
  // mapping including non-number case
  if (nonNumeric) {
    state.withdrawLabel = "( W1THD24W )";
    return "You think differently than the rest?";
  }
  switch (code) {
    case "1234":
      state.atmFee = Math.max(0, state.atmFee - 1);
      return "This machine isn’t so secure…";
    case "6969":
      state.cash = round2(state.cash + 0.69);
      return "Funny….";
    case "0000":
      // trigger chain 14 -> (15 or 16)
      state.pendingEventId = 14;
      return "Sign in successful…";
    case "6666":
      return "This isn’t that kind of ATM";
    case "4200":
    case "0420":
      return "Is that really what you wanted to enter?";
    case "4321":
      state.cash = round2(state.cash + 3);
      return "Clever…";
    case "8008":
      return "There are cameras here…";
    default:
      return "nothing seems to happen...";
  }
}

async function event14() {
  const idx = await showEvent("Hello employee 0. Would you like to clock in?", ["Yes", "No"]);
  if (idx === 0) {
    await event15();
  } else {
    await event16();
  }
}

async function event15() {
  const idx = await showEvent("Here are your wages for the day", ["Accept"]);
  if (idx === 0) {
    state.cash = round2(state.cash + 5);
  }
  await endEvent();
}

async function event16() {
  const idx = await showEvent("Head office will be notified", ["OK"]);
  if (idx === 0) {
    state.lockChance = clamp(state.lockChance + 5, 0, 99);
  }
  await endEvent();
}

async function event17() {
  const idx = await showEvent("The symbols appear again… They appear to warn you to leave", ["Stay", "Leave"]);
  if (idx === 1) {
    await event18();
    return;
  }
  await endEvent();
}

async function event18() {
  await showEvent("you’ll have to try again tomorrow", ["OK"]);
  // restart game
  state.cash = 0;
  state.lockChance = 0;
  state.successfulWithdraws = 0;
  state.atmFee = 3;
  state.lockUnknown = false;
  state.withdrawsSinceEvent = 0;
  await endEvent();
  await showIntro();
}


