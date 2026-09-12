(() => {
  "use strict";

  const GAME_SECONDS = 30;
  const TARGET_SCORE = 20;
  const BEST_SCORE_KEY = "golden-star-game-best-score";
  const READY = "READY";
  const PLAYING = "PLAYING";
  const GAME_OVER = "GAME_OVER";

  const element = (id) => document.getElementById(id);
  const ui = {
    app: element("game-app"),
    scoreboard: element("scoreboard"),
    score: element("score"),
    time: element("time-left"),
    best: element("best-score"),
    timerCard: element("timer-card"),
    timeBar: element("time-bar"),
    progress: element("goal-progress"),
    progressCount: element("progress-count"),
    status: element("status-text"),
    board: element("game-board"),
    star: element("star-button"),
    readyScene: element("ready-scene"),
    endScene: element("end-scene"),
    startArea: element("start-area"),
    start: element("start-button"),
    result: element("result-panel"),
    resultTitle: element("result-title"),
    resultDescription: element("result-description"),
    finalScore: element("final-score"),
    trophy: element("result-trophy"),
    newRecord: element("new-record"),
    restart: element("restart-button"),
    soundToggle: element("sound-toggle"),
    soundLabel: element("sound-label"),
    announcer: element("announcer"),
    effects: element("effects-layer"),
  };

  let state = READY;
  let score = 0;
  let bestScore = readBestScore();
  let timerId = null;
  let startedAt = 0;
  let startedWallTime = 0;
  let displayedSeconds = GAME_SECONDS;
  let starPosition = null;
  let soundEnabled = true;
  let warnedAboutTime = false;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const audioVersions = new WeakMap();

  const music = createAudio("background-music.mp3", 0.18, true);
  const clickSound = createAudio("click.mp3", 0.4);
  const successSound = createAudio("success.mp3", 0.45);
  const gameOverSound = createAudio("game-over.mp3", 0.45);
  const sounds = [music, clickSound, successSound, gameOverSound];

  function readBestScore() {
    try {
      const stored = Number(localStorage.getItem(BEST_SCORE_KEY));
      return Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
    } catch {
      // 로컬 파일이나 저장이 차단된 브라우저에서도 게임은 계속된다.
      return 0;
    }
  }

  function createAudio(file, volume, loop = false) {
    const audio = new Audio(`assets/sounds/${file}`);
    audio.preload = "auto";
    audio.volume = volume;
    audio.loop = loop;
    return audio;
  }

  function stopAudio(audio) {
    audioVersions.set(audio, (audioVersions.get(audio) || 0) + 1);
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // 아직 준비되지 않은 오디오의 재생 위치 초기화는 생략한다.
    }
  }

  function playAudio(audio, restart = true) {
    if (!soundEnabled) return;
    if (restart) stopAudio(audio);
    audio.muted = false;
    try {
      const playback = audio.play();
      if (playback) playback.catch(() => {});
    } catch {
      // 효과음 재생 실패가 점수나 타이머를 멈추지 않도록 한다.
    }
  }

  function prepareResultSounds() {
    // 시작 버튼의 사용자 입력 안에서 종료 효과음 재생 권한도 준비한다.
    if (!soundEnabled) return;
    [successSound, gameOverSound].forEach((audio) => {
      stopAudio(audio);
      const version = audioVersions.get(audio);
      audio.muted = true;
      try {
        const playback = audio.play();
        if (playback) {
          playback.then(() => {
            if (audioVersions.get(audio) !== version) return;
            stopAudio(audio);
            audio.muted = !soundEnabled;
          }).catch(() => {
            if (audioVersions.get(audio) === version) audio.muted = !soundEnabled;
          });
        } else {
          stopAudio(audio);
          audio.muted = !soundEnabled;
        }
      } catch {
        audio.muted = !soundEnabled;
      }
    });
  }

  function updateScore() {
    ui.score.textContent = String(score);
    ui.progress.value = Math.min(score, TARGET_SCORE);
    ui.progressCount.textContent = `${Math.min(score, TARGET_SCORE)} / ${TARGET_SCORE}`;
  }

  function announce(message) {
    ui.announcer.textContent = message;
  }

  function remainingMilliseconds() {
    // 타이머 호출 횟수 대신 실제 경과 시간을 사용하여 탭 전환에도 정확하다.
    const elapsed = Math.max(
      performance.now() - startedAt,
      Date.now() - startedWallTime,
      0,
    );
    return Math.max(0, GAME_SECONDS * 1000 - elapsed);
  }

  function stopTimer() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  function updateTimer() {
    if (state !== PLAYING) return;
    const remaining = remainingMilliseconds();
    const seconds = Math.ceil(remaining / 1000);
    if (seconds !== displayedSeconds) {
      displayedSeconds = seconds;
      ui.time.textContent = String(seconds);
    }
    ui.timeBar.style.width = `${(remaining / (GAME_SECONDS * 1000)) * 100}%`;
    ui.timerCard.classList.toggle("is-urgent", seconds <= 5);

    if (remaining <= 0) {
      endGame();
    } else if (seconds <= 5 && !warnedAboutTime) {
      warnedAboutTime = true;
      announce("5초 남았어요! 마지막 별까지 잡아 보세요.");
    }
  }

  function getStarBounds() {
    const width = ui.board.clientWidth;
    const height = ui.board.clientHeight;
    const starWidth = ui.star.offsetWidth;
    const starHeight = ui.star.offsetHeight;
    const spaceX = Math.max(0, width - starWidth);
    const spaceY = Math.max(0, height - starHeight);
    const marginX = Math.min(12, spaceX / 2);
    const marginY = Math.min(12, spaceY / 2);
    return {
      minX: marginX,
      maxX: spaceX - marginX,
      minY: marginY,
      maxY: spaceY - marginY,
      starWidth,
      starHeight,
      valid: width > 0 && height > 0 && starWidth > 0 && starHeight > 0,
    };
  }

  function setStarPosition(position) {
    starPosition = position;
    ui.star.style.left = `${position.x}px`;
    ui.star.style.top = `${position.y}px`;
  }

  function moveStar() {
    const bounds = getStarBounds();
    if (!bounds.valid) {
      setStarPosition({
        x: Math.max(0, (ui.board.clientWidth - bounds.starWidth) / 2),
        y: Math.max(0, (ui.board.clientHeight - bounds.starHeight) / 2),
      });
      return;
    }

    const randomPosition = () => ({
      x: bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
      y: bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
    });
    let next = randomPosition();
    if (starPosition) {
      const distance = (point) => Math.hypot(point.x - starPosition.x, point.y - starPosition.y);
      const minimumDistance = Math.min(
        Math.max(bounds.starWidth, bounds.starHeight) * 1.35,
        Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.4,
      );
      for (let attempt = 0; attempt < 16 && distance(next) < minimumDistance; attempt += 1) {
        next = randomPosition();
      }
      if (distance(next) < minimumDistance) {
        // 반복 추첨으로 충분히 이동하지 못하면 가장 먼 모서리를 선택한다.
        const corners = [
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          { x: bounds.minX, y: bounds.maxY },
          { x: bounds.maxX, y: bounds.maxY },
        ];
        next = corners.reduce((farthest, point) => distance(point) > distance(farthest) ? point : farthest);
      }
    }
    setStarPosition(next);
  }

  function keepStarInBounds() {
    if (state !== PLAYING || !starPosition) return;
    const bounds = getStarBounds();
    if (!bounds.valid) return;
    setStarPosition({
      x: Math.min(bounds.maxX, Math.max(bounds.minX, starPosition.x)),
      y: Math.min(bounds.maxY, Math.max(bounds.minY, starPosition.y)),
    });
  }

  function showCatchEffect() {
    if (reducedMotion.matches || !starPosition) return;
    const x = starPosition.x + ui.star.offsetWidth / 2;
    const y = starPosition.y + ui.star.offsetHeight / 2;
    const addEffect = (className, text = "") => {
      const effect = document.createElement("span");
      effect.className = className;
      effect.textContent = text;
      effect.style.left = `${x}px`;
      effect.style.top = `${y}px`;
      effect.setAttribute("aria-hidden", "true");
      effect.addEventListener("animationend", () => effect.remove(), { once: true });
      ui.effects.append(effect);
      return effect;
    };

    addEffect("score-pop", "+1");
    for (let index = 0; index < 5; index += 1) {
      const angle = (Math.PI * 2 * index) / 5 + Math.random() * 0.4;
      const distance = 26 + Math.random() * 26;
      const particle = addEffect("sparkle");
      particle.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      particle.style.setProperty("--dy", `${Math.sin(angle) * distance}px`);
    }
  }

  function startGame() {
    if (state === PLAYING) return;
    stopTimer();
    sounds.forEach(stopAudio);
    state = PLAYING;
    score = 0;
    starPosition = null;
    warnedAboutTime = false;
    displayedSeconds = GAME_SECONDS;
    startedAt = performance.now();
    startedWallTime = Date.now();

    ui.app.dataset.state = state;
    ui.app.classList.remove("goal-reached");
    ui.time.textContent = String(GAME_SECONDS);
    ui.timeBar.style.width = "100%";
    ui.timerCard.classList.remove("is-urgent");
    ui.readyScene.hidden = true;
    ui.endScene.hidden = true;
    ui.startArea.hidden = true;
    ui.start.disabled = true;
    ui.result.hidden = true;
    ui.restart.disabled = true;
    ui.trophy.hidden = true;
    ui.newRecord.hidden = true;
    ui.effects.replaceChildren();
    ui.star.hidden = false;
    ui.star.disabled = false;
    ui.status.textContent = "황금별을 클릭해서 20점을 모아 보세요!";
    updateScore();
    moveStar();
    // 작은 화면에서 시작·재시작 버튼을 누른 뒤 점수판과 별을 함께 보여준다.
    const scoreRect = ui.scoreboard.getBoundingClientRect();
    if (scoreRect.top < 12 || ui.board.getBoundingClientRect().bottom > window.innerHeight - 12) {
      window.scrollTo({ top: window.scrollY + scoreRect.top - 12, behavior: "auto" });
    }
    announce("게임 시작! 30초 동안 황금별 20개를 잡아 보세요.");

    prepareResultSounds();
    playAudio(music);
    timerId = window.setInterval(updateTimer, 100);
  }

  function catchStar() {
    if (state !== PLAYING) return;
    // 종료 직전 입력도 실제 종료 시각을 먼저 검사하여 추가 득점을 막는다.
    if (remainingMilliseconds() <= 0) {
      endGame();
      return;
    }
    score += 1;
    updateScore();
    showCatchEffect();
    playAudio(clickSound);
    moveStar();

    if (score === TARGET_SCORE) {
      ui.app.classList.add("goal-reached");
      ui.status.textContent = "목표 달성! 남은 시간 동안 최고 기록에 도전하세요.";
      announce("20점 목표 달성! 남은 시간 동안 계속 도전하세요.");
    }
  }

  function endGame() {
    if (state !== PLAYING) return;
    state = GAME_OVER;
    stopTimer();
    sounds.forEach(stopAudio);
    displayedSeconds = 0;
    const success = score >= TARGET_SCORE;
    const isNewRecord = score > bestScore;

    if (isNewRecord) {
      bestScore = score;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
      } catch {
        // 저장이 제한되어도 이번 페이지의 최고 기록은 표시한다.
      }
    }

    ui.app.dataset.state = state;
    ui.time.textContent = "0";
    ui.timeBar.style.width = "0%";
    ui.timerCard.classList.remove("is-urgent");
    ui.star.disabled = true;
    ui.star.hidden = true;
    ui.effects.replaceChildren();
    ui.endScene.hidden = false;
    ui.result.dataset.outcome = success ? "success" : "failure";
    ui.resultTitle.textContent = success ? "성공! 황금별 사냥꾼이 되었어요!" : "아쉬워요! 다시 도전해 보세요.";
    ui.resultDescription.textContent = success
      ? "20점 목표를 달성했어요. 다음에는 더 많은 별을 잡아 볼까요?"
      : `목표까지 ${TARGET_SCORE - score}점 남았어요. 한 번 더 도전해 보세요!`;
    ui.finalScore.textContent = String(score);
    ui.best.textContent = String(bestScore);
    ui.trophy.hidden = !success;
    ui.newRecord.hidden = !isNewRecord;
    ui.result.hidden = false;
    ui.restart.disabled = false;
    ui.status.textContent = success ? "멋져요! 20점 목표를 달성했어요." : "도전 완료! 다시 한번 황금별을 잡아 보세요.";
    announce(`게임 종료. 최종 ${score}점. ${success ? "목표 달성!" : "다시 도전해 보세요."}${isNewRecord ? " 새로운 최고 기록이에요!" : ""}`);
    playAudio(success ? successSound : gameOverSound);
    ui.restart.focus({ preventScroll: true });
    ui.result.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  ui.start.addEventListener("click", startGame);
  ui.restart.addEventListener("click", startGame);
  // 터치를 별도 등록하지 않아 모바일에서 한 번의 탭이 중복 득점되지 않는다.
  ui.star.addEventListener("click", catchStar);
  ui.star.tabIndex = -1;
  ui.star.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") event.preventDefault();
  });
  ui.star.addEventListener("dragstart", (event) => event.preventDefault());

  ui.soundToggle.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    sounds.forEach((audio) => { audio.muted = !soundEnabled; });
    ui.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    ui.soundLabel.textContent = soundEnabled ? "소리 켜짐" : "소리 꺼짐";
    if (!soundEnabled) {
      sounds.forEach(stopAudio);
    } else if (state === PLAYING) {
      prepareResultSounds();
      playAudio(music, false);
    }
  });

  window.addEventListener("resize", keepStarInBounds);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(keepStarInBounds);
    observer.observe(ui.board);
    observer.observe(ui.star);
  }
  document.addEventListener("visibilitychange", () => {
    if (state === PLAYING) updateTimer();
  });
  window.addEventListener("pageshow", () => {
    if (state === PLAYING) {
      updateTimer();
      // 뒤로 가기로 복귀한 페이지도 남은 플레이 시간 동안 배경음을 재개한다.
      if (state === PLAYING && soundEnabled && music.paused) playAudio(music, false);
    }
  });
  window.addEventListener("pagehide", () => {
    sounds.forEach(stopAudio);
  });

  ui.app.dataset.state = READY;
  ui.score.textContent = "0";
  ui.time.textContent = String(GAME_SECONDS);
  ui.best.textContent = String(bestScore);
  ui.progress.max = TARGET_SCORE;
  ui.progress.value = 0;
  ui.progressCount.textContent = `0 / ${TARGET_SCORE}`;
  ui.timeBar.style.width = "100%";
  ui.star.hidden = true;
  ui.star.disabled = true;
  ui.readyScene.hidden = false;
  ui.endScene.hidden = true;
  ui.startArea.hidden = false;
  ui.result.hidden = true;
  ui.trophy.hidden = true;
  ui.newRecord.hidden = true;
  ui.start.disabled = false;
  ui.restart.disabled = true;
  ui.soundToggle.setAttribute("aria-pressed", "true");
  ui.soundLabel.textContent = "소리 켜짐";
})();
