const state = {
  category: "all",
  intensity: 18,
  currentRequest: null,
  voterId: getVoterId(),
  feedbackTimeout: null,
  defaultFeedback: "Pulling trend signals…",
};

const modeSettings = [
  {
    min: 0,
    max: 24,
    label: "Normal",
    copy: "Practical ideas that still feel current and sharp.",
  },
  {
    min: 25,
    max: 49,
    label: "Fresh",
    copy: "Still realistic, but more distinct and more opinionated.",
  },
  {
    min: 50,
    max: 74,
    label: "Bold",
    copy: "Stronger mixes, stranger angles, and more memorable hooks.",
  },
  {
    min: 75,
    max: 100,
    label: "Crazy",
    copy: "Big swings, odd combinations, and ideas meant to stand out.",
  },
];

const elements = {
  generatedDate: document.querySelector("#generatedDate"),
  feedbackMessage: document.querySelector("#feedbackMessage"),
  ideasGrid: document.querySelector("#ideasGrid"),
  headlineList: document.querySelector("#headlineList"),
  availabilityList: document.querySelector("#availabilityList"),
  signalCountChip: document.querySelector("#signalCountChip"),
  sourceCountChip: document.querySelector("#sourceCountChip"),
  modelChip: document.querySelector("#modelChip"),
  sectionTitle: document.querySelector("#sectionTitle"),
  refreshButton: document.querySelector("#refreshButton"),
  intensityRange: document.querySelector("#intensityRange"),
  modeChip: document.querySelector("#modeChip"),
  modeCopy: document.querySelector("#modeCopy"),
  categoryButtons: [...document.querySelectorAll("[data-category]")],
};

updateModeUI();
renderLoadingState();
fetchIdeas();

elements.refreshButton.addEventListener("click", () => {
  fetchIdeas({ refresh: true });
});

elements.categoryButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextCategory = button.dataset.category || "all";
    if (nextCategory === state.category) {
      return;
    }

    state.category = nextCategory;
    elements.categoryButtons.forEach((pill) => {
      const active = pill.dataset.category === nextCategory;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-pressed", String(active));
    });
    renderLoadingState();
    fetchIdeas();
  });
});

let sliderTimeout = null;
elements.intensityRange.addEventListener("input", () => {
  state.intensity = Number(elements.intensityRange.value);
  updateModeUI();

  window.clearTimeout(sliderTimeout);
  sliderTimeout = window.setTimeout(() => {
    renderLoadingState();
    fetchIdeas();
  }, 250);
});

async function fetchIdeas({ refresh = false } = {}) {
  const requestId = Symbol("ideas");
  state.currentRequest = requestId;

  setFeedback(refresh ? "Refreshing today's batch…" : "Pulling trend signals…", { persist: true });

  try {
    const url = new URL("/api/ideas", window.location.origin);
    url.searchParams.set("category", state.category);
    url.searchParams.set("intensity", String(state.intensity));
    if (refresh) {
      url.searchParams.set("refresh", "1");
    }

    const response = await fetch(url, {
      headers: {
        "X-Voter-Id": state.voterId,
      },
    });
    if (!response.ok) {
      throw new Error("The idea feed could not load.");
    }

    const payload = await response.json();
    if (state.currentRequest !== requestId) {
      return;
    }

    renderPayload(payload);
  } catch (error) {
    if (state.currentRequest !== requestId) {
      return;
    }

    renderError(error instanceof Error ? error.message : "The idea feed could not load.");
  }
}

function renderPayload(payload) {
  elements.generatedDate.textContent = payload.generatedDateLabel || "Today";
  const sectionPrefix = payload.category === "all" ? "Top trending ideas" : `${payload.categoryLabel} ideas`;
  elements.sectionTitle.textContent = `${sectionPrefix} for ${payload.intensityBand.toLowerCase()} mode`;
  elements.signalCountChip.textContent = `${payload.signalSummary.totalSignals} live signals`;
  elements.sourceCountChip.textContent = `${payload.signalSummary.topSources.length} active sources`;
  elements.modelChip.textContent = payload.groqEnabled ? "Groq live" : "Groq not connected";
  setFeedback("Fresh ideas loaded.", { persist: true });

  renderIdeas(payload.ideas || []);
  renderHeadlines(payload.signalSummary.headlines || []);
  renderAvailability(payload.unavailableSources || []);
}

function renderIdeas(ideas) {
  elements.ideasGrid.replaceChildren();

  if (!ideas.length) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "No ideas showed up yet. Try another category or hit refresh.";
    elements.ideasGrid.append(empty);
    return;
  }

  ideas.forEach((idea, index) => {
    const card = document.createElement("article");
    card.className = "idea-card";
    card.style.setProperty("--rotation", `${index % 2 === 0 ? "-1.2deg" : "1.3deg"}`);

    const cardTop = document.createElement("div");
    cardTop.className = "idea-top";

    const sourceRow = document.createElement("div");
    sourceRow.className = "source-row";
    idea.sourceMix.forEach((source) => {
      const badge = document.createElement("span");
      badge.className = "source-badge";
      badge.textContent = source;
      sourceRow.append(badge);
    });

    const score = document.createElement("span");
    score.className = "score-pill";
    score.textContent = `${idea.trendScore}/100`;

    cardTop.append(sourceRow, score);

    const title = document.createElement("h3");
    title.textContent = idea.title;

    const ideaBlock = createCardSection("The idea", idea.idea);
    const whyBlock = createCardSection("The why", idea.why);
    const promptBlock = createCardSection("AI prompt", idea.starterPrompt, { prompt: true });

    const footer = document.createElement("div");
    footer.className = "idea-footer";
    const voteRow = createVoteRow(idea);

    footer.append(voteRow);
    card.append(cardTop, title, ideaBlock, whyBlock, promptBlock, footer);
    elements.ideasGrid.append(card);
  });
}

function createCardSection(labelText, bodyText, { prompt = false } = {}) {
  const block = document.createElement("div");
  block.className = "idea-section";

  const label = document.createElement("p");
  label.className = "idea-section-label";
  label.textContent = labelText;

  const body = document.createElement("p");
  body.className = prompt ? "idea-prompt" : "idea-section-body";
  body.textContent = bodyText;

  block.append(label, body);
  return block;
}

function createVoteRow(idea) {
  const voteRow = document.createElement("div");
  voteRow.className = "vote-row";

  const voteLabel = document.createElement("span");
  voteLabel.className = "vote-label";
  voteLabel.textContent = "Vote";

  const voteCluster = document.createElement("div");
  voteCluster.className = "vote-cluster";

  const upvote = createVoteControl({
    active: idea.userVote === "up",
    count: idea.votes?.up || 0,
    direction: "up",
    label: "Upvote idea",
  });

  const downvote = createVoteControl({
    active: idea.userVote === "down",
    count: idea.votes?.down || 0,
    direction: "down",
    label: "Downvote idea",
  });

  const updateControls = () => {
    upvote.count.textContent = String(idea.votes?.up || 0);
    downvote.count.textContent = String(idea.votes?.down || 0);
    upvote.button.classList.toggle("is-active-up", idea.userVote === "up");
    downvote.button.classList.toggle("is-active-down", idea.userVote === "down");
    upvote.button.setAttribute("aria-pressed", String(idea.userVote === "up"));
    downvote.button.setAttribute("aria-pressed", String(idea.userVote === "down"));
  };

  const submitVote = async (direction, controls) => {
    controls.up.button.disabled = true;
    controls.down.button.disabled = true;
    setFeedback("Saving vote…");

    try {
      const response = await fetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Voter-Id": state.voterId,
        },
        body: JSON.stringify({
          ideaId: idea.id,
          voterId: state.voterId,
          direction,
        }),
      });

      if (!response.ok) {
        throw new Error("Vote failed.");
      }

      const payload = await response.json();
      idea.votes = payload.votes;
      idea.userVote = payload.userVote;
      updateControls();
      flashFeedback("Vote saved.");
    } catch {
      flashFeedback("Vote could not be saved.");
    } finally {
      controls.up.button.disabled = false;
      controls.down.button.disabled = false;
    }
  };

  upvote.button.addEventListener("click", () => {
    const nextDirection = idea.userVote === "up" ? "clear" : "up";
    submitVote(nextDirection, { up: upvote, down: downvote });
  });

  downvote.button.addEventListener("click", () => {
    const nextDirection = idea.userVote === "down" ? "clear" : "down";
    submitVote(nextDirection, { up: upvote, down: downvote });
  });

  voteCluster.append(upvote.wrapper, downvote.wrapper);
  voteRow.append(voteLabel, voteCluster);
  updateControls();

  return voteRow;
}

function createVoteControl({ active, count, direction, label }) {
  const wrapper = document.createElement("div");
  wrapper.className = "vote-control";

  const button = document.createElement("button");
  button.className = "vote-button";
  button.type = "button";
  button.dataset.direction = direction;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", String(active));
  button.innerHTML = direction === "up" ? "&#128077;" : "&#128078;";

  const countLabel = document.createElement("span");
  countLabel.className = "vote-count";
  countLabel.textContent = String(count);

  wrapper.append(button, countLabel);

  return {
    wrapper,
    button,
    count: countLabel,
  };
}

function renderHeadlines(headlines) {
  elements.headlineList.replaceChildren();

  if (!headlines.length) {
    const empty = document.createElement("p");
    empty.className = "small-note";
    empty.textContent = "No live headlines yet.";
    elements.headlineList.append(empty);
    return;
  }

  headlines.forEach((headline) => {
    const link = document.createElement("a");
    link.className = "headline-item";
    link.href = headline.url;
    link.target = "_blank";
    link.rel = "noreferrer";

    const source = document.createElement("span");
    source.className = "headline-source";
    source.textContent = headline.source;

    const title = document.createElement("span");
    title.className = "headline-title";
    title.textContent = headline.title;

    const score = document.createElement("span");
    score.className = "headline-score";
    score.textContent = `${headline.score}`;

    link.append(source, title, score);
    elements.headlineList.append(link);
  });
}

function renderAvailability(unavailableSources) {
  elements.availabilityList.replaceChildren();

  const notes = unavailableSources.length
    ? unavailableSources
    : ["All configured sources responded for this batch."];

  notes.forEach((note) => {
    const item = document.createElement("p");
    item.className = "availability-item";
    item.textContent = note;
    elements.availabilityList.append(item);
  });
}

function renderLoadingState() {
  elements.ideasGrid.innerHTML = "";

  for (let index = 0; index < 6; index += 1) {
    const card = document.createElement("article");
    card.className = "idea-card skeleton-card";
    card.innerHTML = `
      <div class="skeleton-line short"></div>
      <div class="skeleton-line tall"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line medium"></div>
    `;
    elements.ideasGrid.append(card);
  }
}

function renderError(message) {
  elements.generatedDate.textContent = "Unavailable";
  elements.signalCountChip.textContent = "Signal error";
  elements.sourceCountChip.textContent = "Try refresh";
  elements.modelChip.textContent = "Feed offline";
  setFeedback(message, { persist: true });

  elements.ideasGrid.replaceChildren();
  const card = document.createElement("article");
  card.className = "empty-state";
  card.textContent = `${message} Try the refresh button in a second.`;
  elements.ideasGrid.append(card);
}

function updateModeUI() {
  const current = modeSettings.find(
    (setting) => state.intensity >= setting.min && state.intensity <= setting.max,
  );
  elements.modeChip.textContent = current.label;
  elements.modeCopy.textContent = current.copy;
  document.documentElement.style.setProperty("--slider-value", `${state.intensity}%`);
}

function setFeedback(message, { persist = false } = {}) {
  if (persist) {
    state.defaultFeedback = message;
  }

  elements.feedbackMessage.textContent = message;
}

function flashFeedback(message) {
  window.clearTimeout(state.feedbackTimeout);
  setFeedback(message);
  state.feedbackTimeout = window.setTimeout(() => {
    elements.feedbackMessage.textContent = state.defaultFeedback;
  }, 1400);
}

function getVoterId() {
  const storageKey = "idea-machine-voter-id";

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue) {
      return storedValue;
    }

    const nextValue = createVoterId();
    window.localStorage.setItem(storageKey, nextValue);
    return nextValue;
  } catch {
    return createVoterId();
  }
}

function createVoterId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID().replace(/[^a-z0-9-]/gi, "").toLowerCase();
  }

  return `visitor-${Math.random().toString(36).slice(2, 12)}`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
