const jsPsych = initJsPsych({
  show_progress_bar: TASK_MODE_CONFIG === "gjt_outside",
  auto_update_progress_bar: false,
  message_progress_bar: "課題の進捗"
});

const sessionId = jsPsych.randomization.randomID(12);
const sessionStartMs = performance.now();
const sessionStartIso = new Date().toISOString();
let gjtStartMs = null;
let gjtEndMs = null;
let questionnaireStartMs = null;
let leapQEndMs = null;
let exposureEndMs = null;

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isLikelyMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia("(pointer: coarse)").matches;
}

function deviceType() {
  if (/iPad|Tablet/i.test(navigator.userAgent)) return "tablet";
  if (isLikelyMobile()) return "mobile";
  return "desktop_or_laptop";
}

jsPsych.data.addProperties({
  session_id: sessionId,
  study: STUDY_NAME,
  jspsych_version: "8.2.3",
  session_start_iso: sessionStartIso,
  user_agent: navigator.userAgent,
  device_type: deviceType(),
  viewport_width: window.innerWidth,
  viewport_height: window.innerHeight,
  screen_width: window.screen.width,
  screen_height: window.screen.height,
  device_pixel_ratio: window.devicePixelRatio || 1,
  language: navigator.language || "",
  touch_points: navigator.maxTouchPoints || 0
});

const timeline = [];
const TASK_MODE = TASK_MODE_CONFIG;
const exposureStartMs = { value: null };
const version = "pilot2_split_2026-09-26_v1";
jsPsych.data.addProperties({ task_mode: TASK_MODE, experiment_version: version, stimulus_set_id: "pilot2_32_v1" });

// タブ移動・画面離脱をjsPsychのinteraction dataに記録。
jsPsych.data.addProperties({ interaction_recording_enabled: true });

timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `
    <div class="task-card compact-card">
      <h1>英語課題</h1>
      <p>担当者から指定された参加者番号を入力してください。</p>
    </div>`,
  html: `
    <div class="participant-form">
      <label for="participant_id"><strong>参加者番号</strong></label>
      <input id="participant_id" name="participant_id" type="text" required
             autocomplete="off" autocapitalize="none" spellcheck="false"
             pattern="[A-Za-z0-9_-]{1,30}" maxlength="30">
    </div>`,
  button_label: "次へ",
  data: { phase: "participant_info" },
  on_finish: data => {
    const pid = cleanText(data.response.participant_id);
    jsPsych.data.addProperties({
      participant_id: pid,
      assigned_input_device: TASK_MODE === "gjt_outside" ? "physical_keyboard" : "smartphone"
    });
  }
});

// スマホSafariではフルスクリーンの挙動が不安定なため、PC系のみ全画面を試す。
const fullscreenConditional = {
  timeline: [{
    type: jsPsychFullscreen,
    fullscreen_mode: true,
    message: `<div class="task-card compact-card"><p>「全画面で開始」を押してください。</p></div>`,
    button_label: "全画面で開始",
    data: { phase: "fullscreen_start" }
  }],
  conditional_function: () => !isLikelyMobile()
};
if (TASK_MODE === "gjt_outside") timeline.push(fullscreenConditional);

async function saveToDataPipe(csvText, filename) {
  const response = await fetch("https://pipe.jspsych.org/api/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      experimentID: DATAPIPE_EXPERIMENT_ID,
      filename,
      data: csvText
    })
  });
  let result = {};
  try { result = await response.json(); } catch (_) {}
  if (!response.ok || result.error || result.success === false) {
    throw new Error(result.message || `DataPipe returned HTTP ${response.status}`);
  }
  return result;
}


function saveStage(stage, continueLabel) {
  const relevant = stage === "gjt" ? ["participant_info", "fullscreen_start", "gjt_instructions", "gjt_practice", "gjt_start", "gjt"] : ["participant_info", "outside_exposure_survey", "leapq_survey"];
  return {
    type: jsPsychHtmlButtonResponse,
    stimulus: `<div class="task-card save-message"><h2>${stage === "gjt" ? "GJT" : stage === "leapq" ? "LEAP-Q" : "Outside exposure"}の回答を保存します</h2><p>保存完了まで画面を閉じないでください。</p><div id="save-status" role="status">保存中…</div><button id="retry-save" type="button" hidden>保存を再試行</button></div>`,
    choices: [continueLabel],
    data: { phase: `${stage}_save_status`, task_stage: stage },
    on_load: function() {
      const button = document.querySelector(".jspsych-btn");
      const status = document.getElementById("save-status");
      const retry = document.getElementById("retry-save");
      button.disabled = true;
      const pid = jsPsych.data.get().values().find(row => row.participant_id)?.participant_id || "unknown";
      const safePid = pid.replace(/[^A-Za-z0-9_-]/g, "_");
      const filename = `${STUDY_NAME}_${stage}_${safePid}_${sessionId}_${new Date().toISOString().replace(/[:.]/g,"-")}.csv`;
      const csvText = jsPsych.data.get().filterCustom(row => relevant.includes(row.phase)).csv();
      let fallbackDownloaded = false;
      async function attempt() {
        retry.hidden = true;
        status.textContent = "保存中…";
        try {
          if (!DATAPIPE_EXPERIMENT_ID.trim()) throw new Error("DataPipe Experiment ID is empty");
          await saveToDataPipe(csvText, filename);
          status.textContent = "オンライン保存が完了しました。";
          button.disabled = false;
        } catch (error) {
          console.error("Save failed", error);
          if (ENABLE_LOCAL_CSV_FALLBACK && !fallbackDownloaded) {
            try {
              jsPsych.data.get().filterCustom(row => relevant.includes(row.phase)).localSave("csv", filename);
              fallbackDownloaded = true;
            } catch (downloadError) { console.error("Local save failed", downloadError); }
          }
          status.textContent = "オンライン保存に失敗しました。担当者に知らせ、再試行してください。";
          retry.hidden = false;
        }
      }
      retry.addEventListener("click", attempt);
      attempt();
    }
  };
}

timeline.push({type: jsPsychHtmlButtonResponse, stimulus: `<div class="task-card compact-card"><h2>Outside exposure</h2><p>過去7日間の授業外での英語接触について回答してください。</p></div>`, choices:["開始"], on_finish:()=>{questionnaireStartMs=performance.now();}});
// ---------- 過去7日間のoutside exposure ----------
timeline.push({
  type: jsPsychSurveyHtmlForm,
  preamble: `<div class="task-card compact-card">
    <div class="task-progress">Outside exposure</div>
    <h2>過去7日間の授業外での英語接触</h2>
    <p>学校の英語授業、学校から出された宿題、授業内の多読活動は含めないでください。</p>
    <p>授業の多読で使用している本を授業外で読んだ時間は、下の専用項目に回答してください。</p>
  </div>`,
  html: `<div class="questionnaire-form exposure-form">
    <fieldset>
      <legend><strong>1．授業の多読で使用している本を、授業外で読む</strong></legend>
      <div class="exposure-row"><label>行った日数<select name="er_outside_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="er_outside_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>2．それ以外の英語の文章を読む</strong></legend>
      <p class="question-help">英語の本、ウェブサイト、SNS、ニュース、漫画、ゲーム内の文章など。</p>
      <div class="exposure-row"><label>行った日数<select name="reading_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="reading_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>3．英語の動画・映画を見る</strong></legend>
      <p class="question-help">映画、ドラマ、YouTubeなど。日本語字幕・英語字幕を使った場合も含みます。</p>
      <div class="exposure-row"><label>行った日数<select name="video_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="video_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>4．英語を聞く</strong></legend>
      <p class="question-help">ポッドキャスト、ラジオ、音声教材など。動画を見ながら聞いた時間は含めません。</p>
      <div class="exposure-row"><label>行った日数<select name="listening_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="listening_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>

    <fieldset>
      <legend><strong>5．授業外で意図的に英語を学習する</strong></legend>
      <p class="question-help">英語学習アプリ、単語帳、問題集、オンライン英会話など。</p>
      <div class="exposure-row"><label>行った日数<select name="study_days" required>${[0,1,2,3,4,5,6,7].map(v => `<option value="${v}">${v}日</option>`).join("")}</select></label>
      <label>合計時間<input name="study_minutes" type="number" min="0" max="10080" step="1" required inputmode="numeric"><span>分</span></label></div>
    </fieldset>
  </div>`,
  button_label: "送信",
  data: {
    phase: "outside_exposure_survey",
    recall_period_days: 7,
    exposure_version: "weekly_v1",
    week_number: 0,
    survey_date_local: new Date().toLocaleDateString("sv-SE")
  },
  on_load: () => {
    exposureStartMs.value = performance.now();
    document.querySelectorAll(".exposure-row").forEach(row => {
      const select = row.querySelector("select");
      const input = row.querySelector('input[type="number"]');
      const sync = () => {
        if (select.value === "0") {
          input.value = "0";
        } else if (input.value === "0") {
          input.value = "";
        }
      };
      select.addEventListener("change", sync);
      sync();
    });
  },
  on_finish: data => {
    const r = data.response || {};
    const names = ["er_outside", "reading", "video", "listening", "study"];
    let totalMinutes = 0;
    let incidentalMinutes = 0;
    let inconsistencyCount = 0;
    names.forEach(name => {
      const days = Number(r[`${name}_days`]);
      const minutes = Number(r[`${name}_minutes`]);
      data[`${name}_days`] = days;
      data[`${name}_minutes`] = minutes;
      totalMinutes += minutes;
      if (["reading", "video", "listening"].includes(name)) incidentalMinutes += minutes;
      if ((days === 0 && minutes > 0) || (days > 0 && minutes === 0)) inconsistencyCount += 1;
    });
    data.exposure_total_minutes = totalMinutes;
    data.incidental_exposure_minutes = incidentalMinutes;
    data.intentional_study_minutes = data.study_minutes;
    data.er_outside_minutes_separate = data.er_outside_minutes;
    data.exposure_inconsistency_count = inconsistencyCount;
    delete data.response;
    exposureEndMs = performance.now();
    data.exposure_elapsed_ms = Math.round(exposureEndMs - exposureStartMs.value);
    data.questionnaire_total_rt_ms = Math.round(exposureEndMs - questionnaireStartMs);
  }
});


timeline.push(saveStage("outside", "終了"));
jsPsych.run(timeline);
