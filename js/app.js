/**
 * MB-500 Master Web Application
 * Handles routing, UI state, rendering, and interactions.
 */

class MB500App {
  constructor() {
    this.questions = [];
    this.topics = [];
    this.activeList = []; // filtered questions for current view
    this.currentIndex = 0;
    this.currentMode = 'practice'; // 'practice' | 'exam' | 'mistakes' | 'starred' | 'stats'
    this.language = window.appStorage.settings.language || 'ja';
    // Default to light theme
    if (!localStorage.getItem('mb500_theme_explicit')) {
      window.appStorage.saveSettings({ theme: 'light' });
      this.theme = 'light';
    } else {
      this.theme = window.appStorage.settings.theme || 'light';
    }
    this.filterTopic = 'all';
    this.filterType = 'all';
    this.searchQuery = '';
    this.showAnswerImmediately = false;
    this.answeredState = false; // whether current question in practice mode has been submitted
    this.userHotspotAnswers = {};
  }

  async init() {
    this.applyTheme(this.theme);
    this.setupEventListeners();

    try {
      const [qRes, tRes] = await Promise.all([
        fetch('./data/questions.json?v=7.0.4').then(r => r.json()),
        fetch('./data/topics.json?v=7.0.4').then(r => r.json())
      ]);

      this.questions = qRes;
      this.topics = tRes;

      this.populateTopicFilters();
      this.setMode('practice');
      this.updateGlobalBadges();

      // Register Service Worker with forced update
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js?v=6.0.2').then(reg => {
          reg.update();
        }).catch(err => {
          console.log('SW registration error:', err);
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('New Service Worker activated, refreshing cache...');
        });
      }
    } catch (err) {
      console.error('Data load error:', err);
      document.getElementById('question-container').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <h3>题库数据加载失败</h3>
          <p>请确保通过本地服务器访问（如 python3 server.py）。</p>
          <p style="color:var(--text-muted);font-size:0.85rem;">${err.message}</p>
        </div>
      `;
    }
  }

  applyTheme(theme, isExplicit = false) {
    this.theme = theme;
    if (isExplicit) {
      localStorage.setItem('mb500_theme_explicit', 'true');
    }
    document.documentElement.setAttribute('data-theme', theme);
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.innerHTML = theme === 'dark' ? '☀️' : '🌙';
      themeBtn.title = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
    }
    window.appStorage.saveSettings({ theme });
  }

  async forcePurgeCache() {
    if (confirm('是否清除浏览器离线缓存并强制更新至最新版本？')) {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
      }
      window.location.reload(true);
    }
  }

  setLanguage(lang) {
    this.language = lang;
    window.appStorage.saveSettings({ language: lang });
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    this.renderCurrent();
  }

  setMode(mode) {
    this.currentMode = mode;
    this.answeredState = false;

    // Update nav tabs (both desktop & mobile)
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.mode === mode);
    });

    const filterBar = document.getElementById('practice-filter-bar');
    if (filterBar) {
      filterBar.style.display = (mode === 'practice') ? 'block' : 'none';
    }

    const practiceView = document.getElementById('practice-view');
    const examView = document.getElementById('exam-view');
    const statsView = document.getElementById('stats-view');

    practiceView.style.display = 'none';
    examView.style.display = 'none';
    statsView.style.display = 'none';

    if (mode === 'practice') {
      practiceView.style.display = 'block';
      this.applyFilters();
    } else if (mode === 'mistakes') {
      practiceView.style.display = 'block';
      const mistakeIds = Object.keys(window.appStorage.mistakes).filter(id => !window.appStorage.mistakes[id].mastered);
      this.activeList = this.questions.filter(q => mistakeIds.includes(String(q.id)));
      this.currentIndex = 0;
      this.renderCurrent();
    } else if (mode === 'starred') {
      practiceView.style.display = 'block';
      this.activeList = this.questions.filter(q => window.appStorage.isStarred(q.id));
      this.currentIndex = 0;
      this.renderCurrent();
    } else if (mode === 'exam') {
      examView.style.display = 'block';
      this.renderExamHome();
    } else if (mode === 'stats') {
      statsView.style.display = 'block';
      this.renderStats();
    }

    this.updateGlobalBadges();
  }

  populateTopicFilters() {
    const sel = document.getElementById('topic-select');
    if (!sel) return;
    sel.innerHTML = '<option value="all">📚 所有章节 (Topic 1 ~ 20)</option>';
    this.topics.forEach(t => {
      sel.innerHTML += `<option value="${t.id}">Topic ${t.id}: ${t.name_ja} (${t.total_questions}题)</option>`;
    });
  }

  applyFilters() {
    let list = [...this.questions];

    if (this.filterTopic !== 'all') {
      list = list.filter(q => q.topic === parseInt(this.filterTopic));
    }

    if (this.filterType !== 'all') {
      list = list.filter(q => q.type === this.filterType);
    }

    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(item => 
        item.title.toLowerCase().includes(q) ||
        item.question_en.toLowerCase().includes(q) ||
        item.question_ja.includes(q) ||
        (item.ai_verdict && (item.ai_verdict.concept_en.toLowerCase().includes(q) || item.ai_verdict.concept_ja.includes(q)))
      );
    }

    this.activeList = list;
    this.currentIndex = 0;
    this.renderCurrent();
  }

  getCurrentQuestion() {
    if (!this.activeList || this.activeList.length === 0) return null;
    return this.activeList[this.currentIndex];
  }

  renderCurrent() {
    const container = document.getElementById('question-container');
    const q = this.getCurrentQuestion();

    if (!q) {
      let emptyMsg = '没有找到符合条件的题目';
      if (this.currentMode === 'mistakes') emptyMsg = '🎉 太棒了！当前没有任何未掌握的错题！';
      if (this.currentMode === 'starred') emptyMsg = '⭐ 暂无收藏题目，在做题时点击星星即可收藏难点题。';

      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${this.currentMode === 'mistakes' ? '🏆' : '🔍'}</div>
          <h3>${emptyMsg}</h3>
          <button class="btn btn-primary" onclick="window.mbApp.setMode('practice')">返回即时练习</button>
        </div>
      `;
      this.updateProgressControls();
      return;
    }

    window.appInteractions.resetCurrent();
    this.userHotspotAnswers = {};
    const isStarred = window.appStorage.isStarred(q.id);
    const prevAnswer = window.appStorage.answers[q.id];

    // Determine question text & options based on language
    let questionText = '';
    let noteText = '';
    if (this.language === 'en') {
      questionText = this.escapeHtml(q.question_en);
      noteText = q.note_en ? `<div class="question-note">${this.escapeHtml(q.note_en)}</div>` : '';
    } else if (this.language === 'ja') {
      questionText = this.escapeHtml(q.question_ja || q.question_en);
      noteText = q.note_ja ? `<div class="question-note">${this.escapeHtml(q.note_ja)}</div>` : '';
    } else {
      // Bilingual
      questionText = `
        <div class="bilingual-block">
          <div class="bilingual-ja">${this.escapeHtml(q.question_ja || q.question_en)}</div>
          <div class="bilingual-en">${this.escapeHtml(q.question_en)}</div>
        </div>
      `;
      noteText = q.note_ja ? `<div class="question-note bilingual-note"><p>${this.escapeHtml(q.note_ja)}</p><p class="en-sub">${this.escapeHtml(q.note_en)}</p></div>` : '';
    }

    // Type Badge
    const typeBadges = {
      'single_choice': '<span class="badge badge-blue">单选题</span>',
      'multi_choice': '<span class="badge badge-purple">多选题 (Select Multiple)</span>',
      'hotspot': '<span class="badge badge-amber">Hotspot 下拉/选择</span>',
      'drag_drop': '<span class="badge badge-emerald">Drag & Drop 拖拽/排序</span>',
      'exhibit_choice': '<span class="badge badge-indigo">图表题 Exhibit</span>'
    };

    // Images in question
    let questionImagesHtml = '';
    if (q.question_images && q.question_images.length > 0) {
      if (q.type === 'hotspot' && q.hotspot_boxes && q.hotspot_boxes.length > 0) {
        questionImagesHtml = `
          <div class="original-scan-toggle-wrap">
            <button type="button" class="btn-toggle-scan" onclick="window.mbApp.toggleOriginalScan()">
              🖼️ 切换查看原卷扫描件截图 (选填参考)
            </button>
            <div id="original-scan-box" class="original-scan-box" style="display:none; margin-top: 0.75rem;">
              ${q.question_images.map(img => `
                <div class="image-wrapper" onclick="window.mbApp.openLightbox('./${img}')">
                  <img src="./${img}" alt="Exhibit" loading="lazy" />
                  <div class="zoom-hint">🔍 点击放大图片</div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      } else {
        questionImagesHtml = `
          <div class="question-images">
            ${q.question_images.map(img => `
              <div class="image-wrapper" onclick="window.mbApp.openLightbox('./${img}')">
                <img src="./${img}" alt="Exhibit" loading="lazy" />
                <div class="zoom-hint">🔍 点击放大图片</div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    // Interactive Area (Options / Drag Drop / Hotspot)
    let interactiveHtml = '';
    if (q.type === 'single_choice' || q.type === 'multi_choice' || q.type === 'exhibit_choice') {
      interactiveHtml = this.renderOptionsHtml(q);
    } else if (q.type === 'drag_drop') {
      interactiveHtml = this.renderDragDropHtml(q);
    } else if (q.type === 'hotspot') {
      interactiveHtml = this.renderHotspotHtml(q);
    }

    container.innerHTML = `
      <div class="question-card" id="qcard-${q.id}">
        <div class="question-header">
          <div class="q-meta">
            <span class="topic-pill">Topic ${q.topic}</span>
            <span class="q-index-pill">#${q.q_num} (ID: ${q.id})</span>
            ${typeBadges[q.type] || ''}
            ${q.ai_verdict && q.ai_verdict.is_dump_wrong ? '<span class="badge badge-red pulse">⚠️ 题库官方答案疑似有误</span>' : ''}
          </div>
          <div class="q-actions">
            <button class="icon-btn ${isStarred ? 'starred' : ''}" onclick="window.mbApp.toggleCurrentStar()" title="收藏此题">
              ${isStarred ? '★' : '☆'}
            </button>
          </div>
        </div>

        <div class="topic-title-sub">${q.topic_name_ja}</div>
        ${noteText}

        <div class="question-body">
          <div class="question-text">${this.formatCodeSnippets(questionText)}</div>
          ${questionImagesHtml}
        </div>

        <div class="interactive-area" id="interactive-container">
          ${interactiveHtml}
        </div>

        <div class="question-footer">
          <div class="footer-left">
            <button class="btn btn-secondary" onclick="window.mbApp.toggleRevealAnswer()">
              ${this.answeredState ? '隐藏答案解析' : '👁️ 查看正解与深度解析'}
            </button>
            <button class="btn btn-primary" id="btn-submit-answer" onclick="window.mbApp.submitPracticeAnswer()">
              ✓ 提交作答
            </button>
          </div>
          <div class="footer-right">
            ${this.currentMode === 'mistakes' ? `
              <button class="btn btn-outline-success" onclick="window.mbApp.markCurrentMastered()">
                ✓ 标为已掌握
              </button>
            ` : ''}
          </div>
        </div>

        <div class="solution-container" id="solution-container" style="display: ${this.answeredState ? 'block' : 'none'};">
          ${this.renderSolutionHtml(q)}
        </div>
      </div>
    `;

    // Wire drag & drop if applicable
    if (q.type === 'drag_drop') {
      const containerEl = document.getElementById('interactive-container');
      window.appInteractions.setupDragAndDrop(containerEl, q);
    }

    this.updateProgressControls();
  }

  renderOptionsHtml(q) {
    const isMulti = (q.type === 'multi_choice');
    return `
      <div class="options-list ${isMulti ? 'multi' : 'single'}">
        ${q.options.map(opt => {
          let text = '';
          if (this.language === 'en') {
            text = this.escapeHtml(opt.text_en);
          } else if (this.language === 'ja') {
            text = this.escapeHtml(opt.text_ja || opt.text_en);
          } else {
            text = `
              <div class="bilingual-opt">
                <div>${this.escapeHtml(opt.text_ja || opt.text_en)}</div>
                <div class="en-sub">${this.escapeHtml(opt.text_en)}</div>
              </div>
            `;
          }

          return `
            <div class="option-card" data-key="${opt.key}" onclick="window.mbApp.handleOptionClick('${opt.key}', ${isMulti})">
              <div class="option-indicator">${opt.key}</div>
              <div class="option-content">${text}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  renderDragDropHtml(q) {
    let actions = [];
    if (q.drag_actions && q.drag_actions.length > 0) {
      actions = q.drag_actions;
    } else {
      const expText = q.explanation_en || q.explanation_ja || q.explanation || '';
      const stepMatches = expText.match(/Step\s*\d+\s*:\s*([^\n]+)/gi);
      const fallback = (stepMatches && stepMatches.length > 0)
        ? stepMatches.map(s => s.replace(/Step\s*\d+\s*:\s*/i, '').trim())
        : ['Action A', 'Action B', 'Action C', 'Action D'];
      actions = fallback.map(t => ({ text_en: t, text_ja: t }));
    }

    const slots = (q.drag_slots && q.drag_slots.length > 0)
      ? q.drag_slots
      : actions.map((_, idx) => ({ index: idx + 1, label_en: '', label_ja: '' }));

    const hasLabels = slots.some(s => s.label_en);

    const formatLang = (ja, en) => {
      if (this.language === 'en') return this.escapeHtml(en || ja);
      if (this.language === 'ja') return this.escapeHtml(ja || en);
      if (!ja || ja === en) return this.escapeHtml(en);
      return `<div class="bilingual-opt"><div>${this.escapeHtml(ja)}</div><div class="en-sub">${this.escapeHtml(en)}</div></div>`;
    };

    return `
      <div class="drag-drop-container">
        <div class="drag-instructions">
          💡 <strong>交互提示</strong>: 电脑端可直接拖拽，手机端可<strong>先点击下方操作项，再点击目标槽位</strong>即可自动填入！（共 ${actions.length} 个可选项 ➔ 填入 ${slots.length} 个目标槽位）
        </div>
        <div class="drag-slots-pool">
          <div class="pool-header">${hasLabels ? '🎯 目标匹配槽位 (Answer Area)' : '🎯 目标顺序槽位 (Target Order)'}</div>
          <div class="slots-grid">
            ${slots.map((slot, idx) => {
              const placeholderText = hasLabels
                ? `匹配第 ${idx + 1} 项 (点击或拖拽放入)`
                : `Step ${idx + 1} (点击或拖拽放入)`;
              return `
                <div class="drag-slot-row">
                  ${hasLabels ? `<div class="slot-req-label"><strong>#${idx + 1}:</strong> ${formatLang(slot.label_ja, slot.label_en)}</div>` : ''}
                  <div class="drop-slot" data-slot-index="${idx}" data-placeholder="${this.escapeHtml(placeholderText)}">
                    <span class="slot-placeholder">${this.escapeHtml(placeholderText)}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div class="drag-sources-pool">
          <div class="pool-header">📋 可选操作列表 (Actions Pool · 共 ${actions.length} 项)</div>
          <div class="sources-list">
            ${actions.map((act, idx) => `
              <div class="drag-item" draggable="true" data-id="item_${idx}">
                ${formatLang(act.text_ja, act.text_en)}
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }

  renderHotspotHtml(q) {
    if (!q.hotspot_boxes || q.hotspot_boxes.length === 0) return '';
    return `
      <div class="hotspot-answer-table-card">
        <div class="table-header-bar">
          <div class="table-title">
            <span class="table-icon">📋</span>
            <span>Answer Area (作答区域 - 请在下方各下拉框中选择配置)</span>
          </div>
        </div>
        <div class="table-responsive-wrapper">
          <table class="hotspot-native-table">
            <thead>
              <tr>
                <th class="col-req">Element / Requirement (要件・項目)</th>
                <th class="col-val">Value / Action (選択肢・設定値)</th>
              </tr>
            </thead>
            <tbody>
              ${q.hotspot_boxes.map(box => {
                const currentVal = this.userHotspotAnswers[box.box_id] || '';
                const reqTitleJa = box.title_ja || box.title_en;
                const reqTitleEn = box.title_en;
                return `
                  <tr class="hotspot-row" data-box-id="${box.box_id}">
                    <td class="req-cell">
                      <span class="box-badge">Box ${box.box_id}</span>
                      <div class="req-text-primary">${this.language === 'en' ? this.escapeHtml(reqTitleEn) : this.escapeHtml(reqTitleJa)}</div>
                      ${(this.language !== 'en' && reqTitleEn !== reqTitleJa) ? `<div class="req-text-secondary">${this.escapeHtml(reqTitleEn)}</div>` : ''}
                    </td>
                    <td class="val-cell">
                      <div class="select-wrapper">
                        <select class="native-dropdown ${currentVal ? 'has-value' : ''}" 
                          id="hotspot-select-${box.box_id}" 
                          data-box-id="${box.box_id}" 
                          onchange="window.mbApp.handleHotspotDropdownChange(${box.box_id}, this.value)">
                          <option value="" disabled ${!currentVal ? 'selected' : ''}>-- 请点击下拉选择 (Select option) --</option>
                          ${box.options.map(opt => `
                            <option value="${this.escapeHtml(opt)}" ${currentVal === opt ? 'selected' : ''}>
                              ${this.escapeHtml(opt)}
                            </option>
                          `).join('')}
                        </select>
                        <div class="dropdown-feedback" id="feedback-box-${box.box_id}"></div>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  handleHotspotDropdownChange(boxId, val) {
    if (this.answeredState) return;
    this.userHotspotAnswers[boxId] = val;
    if (window.appInteractions) {
      window.appInteractions.setHotspotSelection(boxId, val);
    }
    const selectEl = document.getElementById(`hotspot-select-${boxId}`);
    if (selectEl) {
      selectEl.classList.toggle('has-value', !!val);
    }
  }

  toggleOriginalScan() {
    const box = document.getElementById('original-scan-box');
    if (box) {
      const isHidden = (box.style.display === 'none' || !box.style.display);
      box.style.display = isHidden ? 'block' : 'none';
    }
  }

  extractSteps(q) {
    if (q.drag_steps && q.drag_steps.length > 0) {
      return q.drag_steps.map(s => typeof s === 'string' ? s : (s.action || s.text || String(s)));
    }
    const exp = q.explanation_en || q.explanation_ja || q.explanation || '';
    const matches = exp.match(/Step\s*\d+\s*:\s*([^\n]+)/gi);
    if (matches && matches.length > 0) {
      return matches.map(m => m.replace(/Step\s*\d+\s*:\s*/i, '').trim());
    }
    const verdict = q.ai_verdict && q.ai_verdict.correct_answer;
    if (verdict && verdict.includes('Step')) {
      const parts = verdict.split(/\|\s*Step\s*\d+\s*:\s*/i);
      return parts.map(p => p.replace(/^Step\s*\d+\s*:\s*/i, '').trim()).filter(Boolean);
    }
    return [q.ai_verdict ? q.ai_verdict.correct_answer : q.dump_answer].filter(Boolean);
  }

  renderSolutionHtml(q) {
    const verdict = q.ai_verdict || {};
    const isDumpWrong = verdict.is_dump_wrong;

    // Header badge
    let headerStatusHtml = '';
    if (isDumpWrong) {
      headerStatusHtml = `
        <div class="hero-header">
          <span class="hero-badge-tag" style="background-color:#fee2e2;color:#b91c1c;">【官方正解 · AI权威纠偏】</span>
          <span class="hero-alert-badge">⚠️ 题库官方答案疑似有误（原标为 ${this.escapeHtml(q.dump_answer || '错误选项')}），经微软官方文档与社区100%确认正解如下</span>
        </div>
      `;
    } else {
      headerStatusHtml = `
        <div class="hero-header">
          <span class="hero-badge-tag">【官方正解】</span>
          <span class="hero-agree-badge">✓ 官方题库 · 社区 · AI 100%一致认可</span>
        </div>
      `;
    }

    // Hero Answer Content depending on question type
    let heroAnswerContent = '';
    if (q.type === 'single_choice' || q.type === 'exhibit_choice') {
      const targetKey = (verdict.correct_answer || q.dump_answer || '').trim();
      const opt = (q.options || []).find(o => o.key.toUpperCase() === targetKey.toUpperCase());
      let optText = '';
      if (opt) {
        if (this.language === 'en') optText = opt.text_en;
        else if (this.language === 'ja') optText = opt.text_ja || opt.text_en;
        else optText = `${opt.text_ja || opt.text_en} (${opt.text_en})`;
      }
      heroAnswerContent = `
        <div class="mcq-hero-answer">
          <div class="mcq-hero-letter">${this.escapeHtml(targetKey)}</div>
          <div class="mcq-hero-text">${this.escapeHtml(targetKey)}. ${this.escapeHtml(optText || targetKey)}</div>
        </div>
      `;
    } else if (q.type === 'multi_choice') {
      const targetKeys = (verdict.correct_answer || q.dump_answer || '').trim();
      const matchedOpts = (q.options || []).filter(o => targetKeys.toUpperCase().includes(o.key.toUpperCase()));
      heroAnswerContent = `
        <div style="display:flex;flex-direction:column;gap:0.6rem;">
          <div style="font-size:0.95rem;font-weight:700;color:#065f46;">多选题正解组合: ${this.escapeHtml(targetKeys)}</div>
          ${matchedOpts.map(opt => {
            const optText = (this.language === 'en') ? opt.text_en : (opt.text_ja || opt.text_en);
            return `
              <div class="hotspot-hero-item">
                <span class="mcq-hero-letter" style="width:32px;height:32px;min-width:32px;font-size:1.1rem;">${opt.key}</span>
                <span class="hero-box-val" style="font-size:1rem;">${this.escapeHtml(optText)}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    } else if (q.type === 'hotspot') {
      if (q.hotspot_boxes && q.hotspot_boxes.length > 0) {
        heroAnswerContent = `
          <div class="hotspot-hero-grid">
            ${q.hotspot_boxes.map(box => `
              <div class="hotspot-hero-item">
                <span class="hero-box-tag">Box ${box.box_id}</span>
                <span class="hero-box-val">${this.escapeHtml(box.answer)}</span>
                <span class="hero-box-title">${this.language === 'en' ? this.escapeHtml(box.title_en) : this.escapeHtml(box.title_ja || box.title_en)}</span>
              </div>
            `).join('')}
          </div>
        `;
      } else {
        heroAnswerContent = `
          <div class="hotspot-hero-grid">
            <div class="hero-summary-text">
              ${this.escapeHtml(verdict.correct_answer || q.dump_answer)}
            </div>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-top:0.3rem;">
              💡 对应下方【官方解答图示】中的绿框选中项
            </div>
          </div>
        `;
      }
    } else if (q.type === 'drag_drop') {
      const steps = this.extractSteps(q);
      heroAnswerContent = `
        <div class="drag-hero-steps">
          ${steps.map((step, idx) => `
            <div class="drag-hero-step-row">
              <span class="hero-step-num">Step ${idx + 1}</span>
              <span class="hero-step-action">${this.escapeHtml(step)}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Solution Images (Answer diagrams) - PROMINENTLY DISPLAYED DIRECTLY UNDER HERO ANSWER
    let answerImagesHtml = '';
    if (q.answer_images && q.answer_images.length > 0) {
      answerImagesHtml = `
        <div class="hero-solution-image-card" style="margin-top: 1.25rem;">
          <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-primary); margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>🖼️ 官方解答标准图示 (Official Solution Exhibit - 对应上图绿框标注)</span>
          </div>
          <div class="answer-images-grid">
            ${q.answer_images.map(img => `
              <div class="image-wrapper" onclick="window.mbApp.openLightbox('./${img}')">
                <img src="./${img}" alt="Solution Exhibit" loading="lazy" />
                <div class="zoom-hint">🔍 点击放大图片</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Community votes
    let votesHtml = '';
    if (q.community_votes && Object.keys(q.community_votes).length > 0) {
      votesHtml = `
        <div class="vote-distribution" style="margin-top: 1.25rem;">
          <div class="vote-title">👥 社区投票分布 (Community Votes):</div>
          <div class="vote-bars">
            ${Object.entries(q.community_votes).map(([key, val]) => `
              <div class="vote-bar-item">
                <span class="vote-key">${key}</span>
                <div class="vote-progress-track">
                  <div class="vote-progress-fill" style="width: ${val};"></div>
                </div>
                <span class="vote-pct">${val}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Comments section
    let commentsHtml = '';
    if (q.comments && q.comments.length > 0) {
      commentsHtml = `
        <div class="comments-section" style="margin-top: 1.25rem;">
          <div class="section-title">💬 社区高赞讨论精选 (${q.comments.length} 条):</div>
          <div class="comments-list">
            ${q.comments.map(c => `
              <div class="comment-item">
                <div class="comment-header">
                  <span class="comment-user">👤 ${this.escapeHtml(c.user)}</span>
                  <span class="comment-time">${c.time}</span>
                  ${c.selected_answer ? `<span class="badge badge-blue">选择: ${this.escapeHtml(c.selected_answer)}</span>` : ''}
                  <span class="comment-upvotes">▲ ${c.upvotes}</span>
                </div>
                <div class="comment-body">${this.escapeHtml(c.text)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    const aiAnalysis = (this.language === 'en') ? (verdict.analysis_en || '') : (verdict.analysis_ja || verdict.analysis_en || '');
    const aiConcept = (this.language === 'en') ? (verdict.concept_en || '') : (verdict.concept_ja || verdict.concept_en || '');
    const aiStrategy = (this.language === 'en') ? (verdict.strategy_en || '') : (verdict.strategy_ja || verdict.strategy_en || '');
    const trapClarification = (this.language === 'en') ? (verdict.trap_clarification_en || '') : (verdict.trap_clarification_ja || verdict.trap_clarification_en || '');
    const finalVerdictText = (this.language === 'en') ? (verdict.verification_verdict_en || '') : (verdict.verification_verdict_ja || verdict.verification_verdict_en || '');

    // Box breakdowns for hotspot questions
    let boxBreakdownsHtml = '';
    if (verdict.box_breakdowns && verdict.box_breakdowns.length > 0) {
      boxBreakdownsHtml = `
        <div class="box-breakdowns-container">
          <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);margin-bottom:0.4rem;display:flex;align-items:center;gap:0.4rem;">
            <span>🔍 逐空深度核验与排除法对答案:</span>
          </div>
          ${verdict.box_breakdowns.map(b => {
            const req = (this.language === 'en') ? b.requirement_en : (b.requirement_ja || b.requirement_en);
            const why = (this.language === 'en') ? b.why_en : (b.why_ja || b.why_en);
            const whyNot = (this.language === 'en') ? (b.why_not_en || b.why_not_ja) : (b.why_not_ja || b.why_not_en);
            return `
              <div class="box-breakdown-card">
                <div class="bb-header">
                  <div class="bb-tag-answer">
                    <span class="bb-badge">Box ${b.box_id}</span>
                    <span class="bb-answer-text">${this.escapeHtml(b.answer)}</span>
                  </div>
                </div>
                <div class="bb-requirement">
                  <strong>🎯 对应题目要求:</strong> ${this.escapeHtml(req)}
                </div>
                <div class="bb-why-row">
                  <span style="color:#059669;font-weight:700;min-width:75px;">✅ 为何选它:</span>
                  <span>${this.escapeHtml(why)}</span>
                </div>
                ${whyNot ? `
                  <div class="bb-whynot-row">
                    <span style="color:#dc2626;font-weight:700;min-width:75px;">❌ 排除干扰:</span>
                    <span>${this.escapeHtml(whyNot)}</span>
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Comprehensive AI Thought Card
    const aiThoughtCardHtml = `
      <div class="ai-thought-card">
        <div class="ai-thought-header">
          <div class="ai-thought-title-group">
            <span class="ai-thought-icon">🧠</span>
            <div>
              <div class="ai-thought-title">AI 深度思考与逐项核验 (AI Reasoning & Step-by-Step Verification)</div>
              <div class="ai-thought-subtitle">基于微软官方技术标准 (Microsoft Learn)、考纲逻辑与社区高频争议全方位对标</div>
            </div>
          </div>
          ${aiConcept ? `<span class="badge badge-purple" style="font-size:0.8rem;padding:0.25rem 0.6rem;">${this.escapeHtml(aiConcept)}</span>` : ''}
        </div>

        ${aiStrategy ? `
          <div class="ai-strategy-box">
            <div class="ai-strategy-title">
              <span>💭 题意脉络与解题核心思路:</span>
            </div>
            <div>${this.escapeHtml(aiStrategy)}</div>
          </div>
        ` : ''}

        ${boxBreakdownsHtml}

        ${aiAnalysis ? `
          <div class="ai-analysis-block" style="margin-bottom: 1rem; border-left-color: #6366f1;">
            <div class="analysis-header" style="color: #4f46e5;">
              <span class="analysis-icon">💡</span>
              <span class="analysis-title">考点核心剖析与技术要领</span>
            </div>
            <div class="analysis-body">
              ${aiAnalysis.replace(/\n/g, '<br/>')}
            </div>
          </div>
        ` : ''}

        ${trapClarification ? `
          <div class="ai-trap-box">
            <div class="ai-trap-title">
              <span>⚠️ 考场避坑要点与高频争议对标</span>
            </div>
            <div>${this.escapeHtml(trapClarification)}</div>
          </div>
        ` : ''}

        ${finalVerdictText ? `
          <div class="ai-verdict-banner ${isDumpWrong ? 'alert' : ''}">
            <span>${isDumpWrong ? '🚨' : '🎯'}</span>
            <span>${this.escapeHtml(finalVerdictText)}</span>
          </div>
        ` : ''}
      </div>
    `;

    return `
      <div class="solution-card">
        <!-- 1. HERO ANSWER BANNER (INSTANT CLARITY) -->
        <div class="solution-hero-banner">
          ${headerStatusHtml}
          ${heroAnswerContent}
        </div>

        <!-- 2. OFFICIAL SOLUTION EXHIBIT IMAGE (DIRECTLY UNDER ANSWER) -->
        ${answerImagesHtml}

        <!-- 3. AI REASONING & STEP-BY-STEP VERIFICATION -->
        ${aiThoughtCardHtml}

        <!-- 4. OFFICIAL KNOWLEDGE EXPLANATION -->
        ${(q.explanation_ja || q.explanation_en || q.explanation) ? `
          <div class="official-explanation" style="margin-top: 1.25rem;">
            <div class="section-title">📖 知识点详解与考点延伸:</div>
            <div class="exp-text">${this.escapeHtml((this.language === 'ja' ? (q.explanation_ja || q.explanation_en) : (q.explanation_en || q.explanation_ja)) || q.explanation).replace(/\n/g, '<br/>')}</div>
          </div>
        ` : ''}

        <!-- 5. COMMUNITY VOTES & DISCUSSIONS -->
        ${votesHtml}
        ${commentsHtml}

        <!-- 6. MICROSOFT LEARN REFERENCES -->
        ${q.reference_urls && q.reference_urls.length > 0 ? `
          <div class="references-section" style="margin-top: 1.25rem;">
            <div class="section-title">🔗 微软官方文档参考 (Microsoft Learn):</div>
            <ul>
              ${q.reference_urls.map(url => `
                <li><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  handleOptionClick(key, isMulti) {
    const card = document.querySelector(`.option-card[data-key="${key}"]`);
    if (!card) return;

    if (isMulti) {
      window.appInteractions.handleMultiToggle(key, (selectedKeys) => {
        document.querySelectorAll('.option-card').forEach(c => {
          c.classList.toggle('selected', selectedKeys.includes(c.dataset.key));
        });
      });
    } else {
      window.appInteractions.handleSingleSelect(key, (selectedKey) => {
        document.querySelectorAll('.option-card').forEach(c => {
          c.classList.toggle('selected', c.dataset.key === selectedKey);
        });
      });
    }
  }

  submitPracticeAnswer() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    const grade = window.appInteractions.gradeQuestion(q);
    window.appStorage.recordAnswer(q.id, grade.userAnswer, grade.isCorrect, 'practice');

    // Highlight options for choice questions
    document.querySelectorAll('.option-card').forEach(card => {
      const k = card.dataset.key;
      const targetAns = (q.ai_verdict && q.ai_verdict.correct_answer) ? q.ai_verdict.correct_answer.toUpperCase() : '';
      if (targetAns.includes(k)) {
        card.classList.add('correct-answer');
      } else if (card.classList.contains('selected')) {
        card.classList.add('wrong-answer');
      }
    });

    // Highlight and evaluate native hotspot dropdowns
    if (q.type === 'hotspot' && q.hotspot_boxes) {
      q.hotspot_boxes.forEach(box => {
        const selectEl = document.getElementById(`hotspot-select-${box.box_id}`);
        const feedbackEl = document.getElementById(`feedback-box-${box.box_id}`);
        const userVal = (this.userHotspotAnswers[box.box_id] || '').trim();
        const isCorrect = (userVal.toLowerCase() === box.answer.trim().toLowerCase());
        
        if (selectEl) {
          selectEl.classList.remove('select-correct', 'select-wrong');
          selectEl.classList.add(isCorrect ? 'select-correct' : 'select-wrong');
        }
        if (feedbackEl) {
          if (isCorrect) {
            feedbackEl.innerHTML = `<span class="feedback-badge correct">✓ 选项正确</span>`;
          } else {
            feedbackEl.innerHTML = `
              <span class="feedback-badge wrong">✗ 未答对</span>
              <span class="feedback-correct-val">正解: <strong>${this.escapeHtml(box.answer)}</strong></span>
            `;
          }
        }
      });
    }

    this.answeredState = true;
    const solEl = document.getElementById('solution-container');
    if (solEl) {
      solEl.style.display = 'block';
      solEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    this.updateGlobalBadges();
  }

  toggleRevealAnswer() {
    const q = this.getCurrentQuestion();
    if (!q) return;

    this.answeredState = !this.answeredState;
    const solEl = document.getElementById('solution-container');
    if (solEl) {
      solEl.style.display = this.answeredState ? 'block' : 'none';
      if (this.answeredState) {
        // Highlight correct options for choice questions
        document.querySelectorAll('.option-card').forEach(card => {
          const k = card.dataset.key;
          const targetAns = (q.ai_verdict && q.ai_verdict.correct_answer) ? q.ai_verdict.correct_answer.toUpperCase() : '';
          if (targetAns.includes(k)) card.classList.add('correct-answer');
        });

        // Auto-fill and highlight native hotspot dropdowns
        if (q.type === 'hotspot' && q.hotspot_boxes) {
          q.hotspot_boxes.forEach(box => {
            const selectEl = document.getElementById(`hotspot-select-${box.box_id}`);
            const feedbackEl = document.getElementById(`feedback-box-${box.box_id}`);
            if (selectEl) {
              selectEl.value = box.answer;
              selectEl.classList.remove('select-wrong');
              selectEl.classList.add('select-correct');
            }
            if (feedbackEl) {
              feedbackEl.innerHTML = `<span class="feedback-badge correct">✓ 官方正解: <strong>${this.escapeHtml(box.answer)}</strong></span>`;
            }
          });
        }

        solEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  nextQuestion() {
    if (this.currentIndex < this.activeList.length - 1) {
      this.currentIndex += 1;
      this.answeredState = false;
      this.renderCurrent();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  prevQuestion() {
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
      this.answeredState = false;
      this.renderCurrent();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  jumpToQuestion(targetNum) {
    const idx = this.activeList.findIndex(q => q.id === targetNum || q.q_num === targetNum);
    if (idx !== -1) {
      this.currentIndex = idx;
      this.answeredState = false;
      this.renderCurrent();
    }
  }

  toggleCurrentStar() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    window.appStorage.toggleStar(q.id);
    this.renderCurrent();
    this.updateGlobalBadges();
  }

  markCurrentMastered() {
    const q = this.getCurrentQuestion();
    if (!q) return;
    window.appStorage.markMistakeMastered(q.id, true);
    this.nextQuestion();
    this.updateGlobalBadges();
  }

  updateProgressControls() {
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    const progressText = document.getElementById('progress-indicator');
    const jumpInput = document.getElementById('jump-input');

    const total = this.activeList.length;
    const cur = total > 0 ? this.currentIndex + 1 : 0;

    if (progressText) progressText.innerText = `${cur} / ${total}`;
    if (prevBtn) prevBtn.disabled = (this.currentIndex <= 0);
    if (nextBtn) nextBtn.disabled = (this.currentIndex >= total - 1);
    if (jumpInput) jumpInput.value = cur;
  }

  updateGlobalBadges() {
    const stats = window.appStorage.getStatistics(this.questions);
    const mistakeBadge = document.getElementById('badge-mistakes-count');
    const starredBadge = document.getElementById('badge-starred-count');
    const accuracyBadge = document.getElementById('header-accuracy');

    if (mistakeBadge) mistakeBadge.innerText = stats.mistakeCount;
    if (starredBadge) starredBadge.innerText = stats.starredCount;
    if (accuracyBadge) accuracyBadge.innerText = `${stats.accuracy}% (${stats.correctCount}/${stats.totalAnswered})`;
  }

  // --- Exam View ---
  renderExamHome() {
    const container = document.getElementById('exam-container');
    container.innerHTML = `
      <div class="exam-home-card">
        <div class="exam-header-banner">
          <h2>🎯 MB-500 全真模拟考试系统</h2>
          <p>模拟微软官方考试环境：700分及格 (总分1000分)，题型全真模拟，考后出具深度分析报告</p>
        </div>

        <div class="exam-modes-grid">
          <div class="mode-card" onclick="window.mbApp.startExamWithConfig('standard')">
            <div class="mode-icon">🏆</div>
            <h3>标准全真模考</h3>
            <p>50道精选题，随机全题库抽取，限时 120 分钟</p>
            <span class="btn btn-primary">立即开始 (50题)</span>
          </div>

          <div class="mode-card" onclick="window.mbApp.startExamWithConfig('quick')">
            <div class="mode-icon">⚡</div>
            <h3>快速高频自测</h3>
            <p>20道高频必考题，碎片化时间自测，限时 30 分钟</p>
            <span class="btn btn-outline-primary">快速开始 (20题)</span>
          </div>

          <div class="mode-card" onclick="window.mbApp.startExamWithConfig('all')">
            <div class="mode-icon">💯</div>
            <h3>400 题全题库马拉松</h3>
            <p>从第 1 题到 400 题全部通刷一遍，检验终极掌握率</p>
            <span class="btn btn-outline-primary">通刷全题库</span>
          </div>

          <div class="mode-card" onclick="window.mbApp.startExamWithConfig('mistakes')">
            <div class="mode-icon">❌</div>
            <h3>错题巩固专项考</h3>
            <p>只考当前错题本里的薄弱题目，各个击破</p>
            <span class="btn btn-outline-primary">错题专项</span>
          </div>
        </div>

        <div class="recent-exams-section">
          <h3>📜 历史模考记录 (${window.appStorage.exams.length})</h3>
          ${this.renderRecentExamsHtml()}
        </div>
      </div>
    `;
  }

  renderRecentExamsHtml() {
    if (window.appStorage.exams.length === 0) {
      return '<p class="text-muted">暂无模考记录，点击上方卡片开启你的第一次全真模拟！</p>';
    }

    return `
      <div class="exam-records-table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>模式</th>
              <th>总分 / 状态</th>
              <th>正确率</th>
              <th>用时</th>
            </tr>
          </thead>
          <tbody>
            ${window.appStorage.exams.slice(0, 5).map(e => `
              <tr>
                <td>${new Date(e.timestamp).toLocaleDateString()} ${new Date(e.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                <td><span class="badge badge-blue">${e.mode}</span></td>
                <td>
                  <strong class="${e.passed ? 'text-success' : 'text-danger'}">
                    ${e.scaledScore} / 1000 (${e.passed ? 'PASS 优秀' : 'FAIL 未及格'})
                  </strong>
                </td>
                <td>${e.accuracy}% (${e.correctCount}/${e.totalQuestions})</td>
                <td>${e.timeSpentFormatted}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  startExamWithConfig(mode) {
    window.appExam.startExam(this.questions, { mode });
    window.appExam.onTick = (timeStr) => {
      const timerEl = document.getElementById('exam-timer');
      if (timerEl) timerEl.innerText = `⏱️ ${timeStr}`;
    };
    this.renderExamInterface();
  }

  renderExamInterface() {
    const exam = window.appExam;
    const q = exam.questions[exam.currentIndex];
    const container = document.getElementById('exam-container');

    container.innerHTML = `
      <div class="exam-active-layout">
        <div class="exam-top-bar">
          <div class="exam-meta">
            <span>第 <strong>${exam.currentIndex + 1}</strong> / ${exam.questions.length} 题</span>
            <span class="badge badge-blue">Topic ${q.topic}</span>
          </div>
          <div class="exam-timer" id="exam-timer">⏱️ 02:00:00</div>
          <div class="exam-top-actions">
            <button class="btn btn-sm btn-outline-warning" onclick="window.mbApp.toggleExamFlag()">
              ${exam.flagged.has(exam.currentIndex) ? '🚩 已标记' : '⚐ 标记本题'}
            </button>
            <button class="btn btn-sm btn-danger" onclick="window.mbApp.confirmSubmitExam()">
              提交交卷
            </button>
          </div>
        </div>

        <div class="exam-card">
          <div class="question-body">
            <div class="question-text">${this.formatCodeSnippets(this.language === 'en' ? q.question_en : q.question_ja)}</div>
            ${q.question_images.map(img => `<img src="./${img}" class="exam-img" onclick="window.mbApp.openLightbox('./${img}')" />`).join('')}
          </div>

          <div class="exam-options">
            ${q.options.map(opt => `
              <div class="option-card ${(exam.userAnswers[exam.currentIndex]?.selected || '').includes(opt.key) ? 'selected' : ''}" 
                   onclick="window.mbApp.selectExamOption('${opt.key}', ${q.type === 'multi_choice'})">
                <div class="option-indicator">${opt.key}</div>
                <div class="option-content">${this.language === 'en' ? opt.text_en : opt.text_ja}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="exam-nav-bar">
          <button class="btn btn-secondary" onclick="window.mbApp.examPrev()" ${exam.currentIndex === 0 ? 'disabled' : ''}>上一题</button>
          <button class="btn btn-outline-primary" onclick="window.mbApp.togglePaletteDrawer()">📑 答题卡</button>
          <button class="btn btn-primary" onclick="window.mbApp.examNext()" ${exam.currentIndex === exam.questions.length - 1 ? 'disabled' : ''}>下一题</button>
        </div>

        <div class="palette-drawer" id="palette-drawer" style="display:none;">
          <div class="palette-grid">
            ${exam.questions.map((_, i) => {
              const isAnswered = !!exam.userAnswers[i];
              const isFlag = exam.flagged.has(i);
              const isCurrent = (i === exam.currentIndex);
              return `
                <div class="palette-item ${isAnswered ? 'answered' : ''} ${isFlag ? 'flagged' : ''} ${isCurrent ? 'current' : ''}"
                     onclick="window.mbApp.examJump(${i})">
                  ${i + 1}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  selectExamOption(key, isMulti) {
    const exam = window.appExam;
    const cur = exam.userAnswers[exam.currentIndex]?.selected || '';

    let nextAns = '';
    if (isMulti) {
      const set = new Set(cur.split(''));
      if (set.has(key)) set.delete(key);
      else set.add(key);
      nextAns = Array.from(set).sort().join('');
    } else {
      nextAns = key;
    }

    exam.recordAnswer(exam.currentIndex, { selected: nextAns });
    this.renderExamInterface();
  }

  toggleExamFlag() {
    window.appExam.toggleFlag(window.appExam.currentIndex);
    this.renderExamInterface();
  }

  togglePaletteDrawer() {
    const drawer = document.getElementById('palette-drawer');
    if (drawer) drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
  }

  examJump(i) {
    window.appExam.currentIndex = i;
    this.renderExamInterface();
  }

  examNext() {
    if (window.appExam.currentIndex < window.appExam.questions.length - 1) {
      window.appExam.currentIndex += 1;
      this.renderExamInterface();
    }
  }

  examPrev() {
    if (window.appExam.currentIndex > 0) {
      window.appExam.currentIndex -= 1;
      this.renderExamInterface();
    }
  }

  confirmSubmitExam() {
    const unanswered = window.appExam.questions.length - Object.keys(window.appExam.userAnswers).length;
    let msg = '确定要提交试卷吗？';
    if (unanswered > 0) {
      msg = `您还有 ${unanswered} 道题未作答，确定要现在交卷吗？`;
    }
    if (confirm(msg)) {
      const result = window.appExam.submitExam();
      this.renderExamResult(result);
    }
  }

  renderExamResult(result) {
    const container = document.getElementById('exam-container');
    container.innerHTML = `
      <div class="exam-result-card">
        <div class="result-banner ${result.passed ? 'banner-pass' : 'banner-fail'}">
          <div class="result-score-circle">
            <span class="score-num">${result.scaledScore}</span>
            <span class="score-total">/ 1000</span>
          </div>
          <div class="result-info">
            <h2>${result.passed ? '🎉 恭喜！模拟考试通过 (PASS)' : '💪 遗憾未通过 (FAIL)'}</h2>
            <p>微软及格线为 700 分。正确率: <strong>${result.accuracy}%</strong> (${result.correctCount}/${result.totalQuestions}) · 耗时: ${result.timeSpentFormatted}</p>
          </div>
        </div>

        <div class="result-actions">
          <button class="btn btn-primary" onclick="window.mbApp.startExamWithConfig('standard')">🔄 再来一套模考</button>
          <button class="btn btn-outline-danger" onclick="window.mbApp.setMode('mistakes')">❌ 查看错题本 (${result.wrongCount}道)</button>
          <button class="btn btn-secondary" onclick="window.mbApp.setMode('practice')">返回自由练习</button>
        </div>

        <div class="topic-breakdown-card">
          <h3>📊 各章节掌握率分析 (Topic Breakdown)</h3>
          <div class="topic-bars-list">
            ${result.topicBreakdown.map(tb => {
              const pct = tb.total > 0 ? Math.round((tb.correct / tb.total) * 100) : 0;
              return `
                <div class="topic-break-row">
                  <span class="t-name">Topic ${tb.topic}: ${tb.name}</span>
                  <div class="t-bar-wrap">
                    <div class="t-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                  <span class="t-pct">${pct}% (${tb.correct}/${tb.total})</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;
  }

  // --- Statistics View ---
  renderStats() {
    const container = document.getElementById('stats-container');
    const stats = window.appStorage.getStatistics(this.questions);

    container.innerHTML = `
      <div class="stats-view-card">
        <h2>📈 学习刷题总览与数据分析</h2>
        
        <div class="stats-kpi-grid">
          <div class="kpi-card">
            <div class="kpi-val">${stats.totalAnswered} / ${stats.totalQuestions}</div>
            <div class="kpi-label">已刷题数 (完成度 ${Math.round(stats.totalAnswered/stats.totalQuestions*100)}%)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val text-success">${stats.accuracy}%</div>
            <div class="kpi-label">综合正确率 (${stats.correctCount} 正确)</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val text-danger">${stats.mistakeCount}</div>
            <div class="kpi-label">待攻克错题</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-val text-warning">${stats.starredCount}</div>
            <div class="kpi-label">收藏重点题</div>
          </div>
        </div>

        <div class="topic-stats-section">
          <h3>📚 20 个章节深度掌握率</h3>
          <div class="topic-stats-grid">
            ${stats.topicStats.map(ts => {
              const pct = ts.answered > 0 ? Math.round((ts.correct / ts.answered) * 100) : 0;
              return `
                <div class="topic-stat-box">
                  <div class="ts-header">
                    <strong>Topic ${ts.topic}</strong>
                    <span>${ts.answered}/${ts.total} 题</span>
                  </div>
                  <div class="ts-name">${ts.name_ja}</div>
                  <div class="ts-bar-track">
                    <div class="ts-bar-fill" style="width: ${pct}%;"></div>
                  </div>
                  <div class="ts-footer">正确率: <strong>${pct}%</strong></div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="data-manage-section">
          <h3>💾 进度备份与跨设备同步</h3>
          <p>在电脑刷完题后，可导出进度文件，在手机端一键导入，无缝随时随地继续刷题！</p>
          <div class="data-actions">
            <button class="btn btn-outline-primary" onclick="window.mbApp.exportProgress()">📤 导出我的刷题数据</button>
            <button class="btn btn-outline-secondary" onclick="window.mbApp.importProgressPrompt()">📥 导入刷题数据</button>
            <button class="btn btn-outline-danger" onclick="window.mbApp.resetAllProgress()">🗑️ 重置所有做题记录</button>
          </div>
        </div>
      </div>
    `;
  }

  exportProgress() {
    const dataStr = window.appStorage.exportData();
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mb500_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  }

  importProgressPrompt() {
    const jsonStr = prompt('请粘贴导出的 JSON 刷题数据：');
    if (jsonStr) {
      if (window.appStorage.importData(jsonStr)) {
        alert('🎉 导入成功！正在刷新数据...');
        location.reload();
      } else {
        alert('❌ 导入失败，请检查数据格式是否正确。');
      }
    }
  }

  resetAllProgress() {
    if (confirm('⚠️ 警告：确定要重置所有做题历史和错题记录吗？此操作无法撤销！')) {
      window.appStorage.clearProgress();
      location.reload();
    }
  }

  // --- Lightbox Modal ---
  openLightbox(imgSrc) {
    const modal = document.getElementById('lightbox-modal');
    const imgEl = document.getElementById('lightbox-img');
    if (modal && imgEl) {
      imgEl.src = imgSrc;
      modal.style.display = 'flex';
    }
  }

  closeLightbox() {
    const modal = document.getElementById('lightbox-modal');
    if (modal) modal.style.display = 'none';
  }

  // --- Utilities ---
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  formatCodeSnippets(text) {
    if (!text) return '';
    // Format simple indentation / linebreaks
    return text.replace(/\n/g, '<br/>');
  }

  setupEventListeners() {
    // Mode navigation (desktop + mobile)
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
      el.addEventListener('click', () => {
        this.setMode(el.dataset.mode);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });

    // Language toggle buttons
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setLanguage(btn.dataset.lang);
      });
    });

    // Theme toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => {
        this.applyTheme(this.theme === 'dark' ? 'light' : 'dark', true);
      });
    }

    // Filter selects
    const topicSel = document.getElementById('topic-select');
    if (topicSel) {
      topicSel.addEventListener('change', (e) => {
        this.filterTopic = e.target.value;
        this.applyFilters();
      });
    }

    const typeSel = document.getElementById('type-select');
    if (typeSel) {
      typeSel.addEventListener('change', (e) => {
        this.filterType = e.target.value;
        this.applyFilters();
      });
    }

    // Search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value;
        this.applyFilters();
      });
    }

    // Jump input
    const jumpBtn = document.getElementById('btn-jump');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const val = parseInt(document.getElementById('jump-input').value);
        if (!isNaN(val)) this.jumpToQuestion(val);
      });
    }

    // Prev / Next buttons
    const prevBtn = document.getElementById('btn-prev');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevQuestion());

    const nextBtn = document.getElementById('btn-next');
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextQuestion());

    // Keyboard navigation (Desktop)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') this.nextQuestion();
      if (e.key === 'ArrowLeft') this.prevQuestion();
      if (e.key === ' ') {
        e.preventDefault();
        this.toggleRevealAnswer();
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.mbApp = new MB500App();
  window.mbApp.init();
});
